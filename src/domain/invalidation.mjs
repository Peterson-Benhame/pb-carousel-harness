import {getStages} from './stage-graph.mjs';
import {canonicalHash,canonicalJson} from './canonical-json.mjs';
import {exactKeys} from './brand-schema.mjs';
import {validateIdentifier} from './identifiers.mjs';
import {PublicError,invalidArgument} from './errors.mjs';
import {validateLayoutQualification} from './layout-qualification.mjs';

const frozen=new Set(['rubric','checker','policy','qualification','font','renderer','brand']);
const starts=Object.freeze({copy:'copy-approval',concept:'concept-approval',assets:'assets-approval',plan:'preview-render',sample:'preview-render','preview-review':'preview-review','final-pixels':'validate','final-review':'quality-review','package-failure':'package'});
/** Dependency policy only. This neither changes evidence nor authorizes a stage.
 * Output/quality services must verify their objects before applying this policy. */
export function invalidationPlan({pipelineVersion=1,change}){
 const keys=getStages({pipelineVersion}).slice(1).map(s=>s.key);
 if(frozen.has(change))throw new PublicError('RUN_DERIVATION_REQUIRED','Recurso congelado exige uma nova execução derivada.');
 const first=pipelineVersion===1&&change==='plan'?'render':starts[change];
 if(!Object.hasOwn(starts,change)||!keys.includes(first))throw invalidArgument('Alteração incompatível com o pipeline.');
 const index=keys.indexOf(first);
 return Object.freeze({change,preserve:Object.freeze(keys.slice(0,index)),invalidate:Object.freeze(keys.slice(index))});
}
/** Compare verified material, never a caller-declared change category. */
export function classifyInputChange(previous,next){
 if(!previous)return 'copy';
 for(const [change,key]of [['copy','copy-approval'],['concept','concept-approval'],['assets','assets-approval']])if(previous.fingerprints[key]!==next.fingerprints[key])return change;
 const sorted=values=>[...values].sort((a,b)=>a.assetKey<b.assetKey?-1:a.assetKey>b.assetKey?1:0);
 if(canonicalHash(sorted(previous.artifacts.assets))!==canonicalHash(sorted(next.artifacts.assets)))return 'assets';
 return 'plan';
}
export function canEditRun({status,leaseOwner=null,activeAttempt=false,activeStage=false}){
 return ['draft','ready','waiting-approval','blocked'].includes(status)&&leaseOwner===null&&!activeAttempt&&!activeStage;
}
const stale=()=>{throw new PublicError('QUALITY_EVIDENCE_STALE','Episódio de correção não corresponde ao histórico persistido.');};
/** Read-only accounting for the correction issuer. Reservations consume a round.
 * This does not validate/authorize adjustments, create reservations or reset them. */
export function correctionEpisodeState(value){
 let e;
 const reference=(r,kind)=>{exactKeys(r,['id','kind','version','sha256']);validateIdentifier(r.id);if(typeof r.kind!=='string'||kind&&r.kind!==kind||!Number.isSafeInteger(r.version)||r.version<1||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256))stale();};
 try{e=JSON.parse(canonicalJson(value));exactKeys(e,['id','episodeId','brandId','runId','version','seedPlanRef','scopeFingerprint','rounds','reservation','closedReason']);for(const key of ['id','episodeId','brandId','runId'])validateIdentifier(e[key]);reference(e.seedPlanRef,'composition-plan');
  if(!Array.isArray(e.rounds))stale();
  for(const [round,reserved]of [...e.rounds.map(r=>[r,false]),...(e.reservation===null?[]:[[e.reservation,true]])]){
   exactKeys(round,['number','defectRefs','previousPlanRef','adjustments',...(reserved?[]:['newPlanRef','attemptIds'])]);reference(round.previousPlanRef,'composition-plan');
   if(!Array.isArray(round.defectRefs)||!Array.isArray(round.adjustments))stale();for(const ref of round.defectRefs)reference(ref);
   const changed=new Set();for(const adjustment of round.adjustments){
    exactKeys(adjustment,['kind','slideIndex','elementId','previousOptionId','optionId','deltaX','deltaY']);
    if(!['remove-decoration','move-decoration-anchor'].includes(adjustment.kind)||!Number.isSafeInteger(adjustment.slideIndex)||adjustment.slideIndex<1||['elementId','previousOptionId','optionId'].some(key=>typeof adjustment[key]!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(adjustment[key]))||!Number.isFinite(adjustment.deltaX)||!Number.isFinite(adjustment.deltaY)||Math.abs(adjustment.deltaX)>12||Math.abs(adjustment.deltaY)>12)stale();
    const key=`${adjustment.slideIndex}:${adjustment.elementId}`;if(changed.has(key))stale();changed.add(key);
   }
   if(!reserved){reference(round.newPlanRef,'composition-plan');if(!Array.isArray(round.attemptIds))stale();for(const id of round.attemptIds)validateIdentifier(id);}
  }
 }catch{stale();}
 if(!Number.isSafeInteger(e.version)||e.version<1||!/^[a-f0-9]{64}$/.test(e.scopeFingerprint)||!Array.isArray(e.rounds)||e.rounds.length>2||e.rounds.some((r,i)=>r.number!==i+1)||e.reservation!==null&&e.reservation.number!==e.rounds.length+1||e.closedReason!==null&&typeof e.closedReason!=='string')stale();
 let expected=e.seedPlanRef;for(const round of e.rounds){if(canonicalHash(round.previousPlanRef)!==canonicalHash(expected))stale();expected=round.newPlanRef;}
 if(e.reservation&&canonicalHash(e.reservation.previousPlanRef)!==canonicalHash(expected))stale();
 const roundsConsumed=e.rounds.length+Number(e.reservation!==null);if(roundsConsumed>2)stale();
 return Object.freeze({episodeId:e.episodeId,version:e.version,roundsConsumed,remaining:2-roundsConsumed,reserved:e.reservation!==null,closedReason:e.closedReason});
}
const equalCorrectionState=(a,b)=>canonicalHash({rounds:a.rounds,reservation:a.reservation})===canonicalHash({rounds:b.rounds,reservation:b.reservation});
export function verifyCorrectionHistory(previous,next){
 correctionEpisodeState(next);if(!previous)return;
 correctionEpisodeState(previous);
 if(previous.brandId!==next.brandId||previous.runId!==next.runId||previous.episodeId!==next.episodeId||previous.scopeFingerprint!==next.scopeFingerprint||canonicalHash(previous.seedPlanRef)!==canonicalHash(next.seedPlanRef)||next.version<=previous.version||next.rounds.length<previous.rounds.length||canonicalHash(next.rounds.slice(0,previous.rounds.length))!==canonicalHash(previous.rounds))stale();
 if(!previous.reservation&&next.rounds.length!==previous.rounds.length)stale();
 if(previous.reservation&&next.rounds.length>previous.rounds.length+1)stale();
 if(previous.reservation&&next.rounds.length===previous.rounds.length+1&&next.reservation!==null)stale();
 if(previous.reservation){const round=next.rounds[previous.reservation.number-1],reservation=next.reservation;if(round){for(const key of ['number','previousPlanRef','defectRefs','adjustments'])if(canonicalHash(round[key])!==canonicalHash(previous.reservation[key]))stale();}else if(canonicalHash(reservation)!==canonicalHash(previous.reservation))stale();}
 if(previous.closedReason!==null&&(next.closedReason!==previous.closedReason||!equalCorrectionState(previous,next)))stale();
}

const unavailable=()=>{throw new PublicError('QUALITY_CORRECTION_UNAVAILABLE','A alteração não é uma correção decorativa limitada comprovada.');};
/** Conservative classification only, never qualification authority. The service
 * must resolve these immutable records from its verified package first. Whole
 * qualified text/asset/brand regions bound their ink; a clear swept rectangle
 * proves the same safe domain without trusting caller-supplied pixel metrics. */
export function classifyBoundedCorrection({previous,next,qualifications}){
 const before=JSON.parse(canonicalJson(previous)),after=JSON.parse(canonicalJson(next));
 const content=p=>{const {id,version,change,...rest}=p;return {...rest,slides:p.slides.map(({decorationChoices,...slide})=>slide)};};
 if(!Array.isArray(before.slides)||!Array.isArray(after.slides)||canonicalHash(content(before))!==canonicalHash(content(after)))unavailable();
 const adjustments=[];
 for(let index=0;index<before.slides.length;index++){
  const a=before.slides[index],b=after.slides[index];
  if(!Array.isArray(a.decorationChoices)||!Array.isArray(b.decorationChoices)||a.decorationChoices.length!==b.decorationChoices.length)unavailable();
  if(new Set(a.decorationChoices.map(c=>c.elementId)).size!==a.decorationChoices.length||new Set(b.decorationChoices.map(c=>c.elementId)).size!==b.decorationChoices.length)unavailable();
  for(const choice of a.decorationChoices){
   const replacement=b.decorationChoices.find(c=>c.elementId===choice.elementId);
   if(!replacement)unavailable();
   if(canonicalHash(choice)===canonicalHash(replacement))continue;
   exactKeys(choice,['elementId','optionId']);exactKeys(replacement,['elementId','optionId']);
   const ref=a.qualificationRef,q=qualifications.find(q=>q.id===ref.id&&q.version===ref.version&&canonicalHash(q)===ref.sha256&&q.definitionHash===ref.definitionHash);
   if(!q||q.status!=='qualified')throw new PublicError('LAYOUT_NOT_QUALIFIED','Correção exige uma ficha qualificada e vinculada ao plano.');
   validateLayoutQualification(q);
   const d=q.definition,region=d.regions.find(r=>r.id===choice.elementId&&r.kind==='decoration');
   const old=d.decorationOptions.find(o=>o.id===choice.optionId&&o.elementId===choice.elementId),option=d.decorationOptions.find(o=>o.id===replacement.optionId&&o.elementId===choice.elementId);
   // The current renderer places fixed rectangles by region + offset. An
   // anchor change or continuity would require additional verified geometry.
   if(!region||!old||!option||!old.visible||old.anchorId!==option.anchorId||before.continuities.length||a.overlaps.some(o=>o.backElementId===choice.elementId||o.frontElementId===choice.elementId))unavailable();
   const deltaX=option.offsetX-old.offsetX,deltaY=option.offsetY-old.offsetY;
   if(Math.abs(deltaX)>12||Math.abs(deltaY)>12||option.visible&&deltaX===0&&deltaY===0)unavailable();
   const x=region.x+Math.min(old.offsetX,option.offsetX),y=region.y+Math.min(old.offsetY,option.offsetY),width=region.width+Math.abs(deltaX),height=region.height+Math.abs(deltaY);
   if(x<0||y<0||x+width>d.dimensions.width||y+height>d.dimensions.height)unavailable();
   for(const protectedRegion of d.regions.filter(r=>['text','asset','brand'].includes(r.kind))){
    const gap=Math.hypot(Math.max(0,x-protectedRegion.x-protectedRegion.width,protectedRegion.x-x-width),Math.max(0,y-protectedRegion.y-protectedRegion.height,protectedRegion.y-y-height));
    if(gap<Math.max(24,d.limits.minBlockGap))unavailable();
   }
   adjustments.push(Object.freeze({kind:option.visible?'move-decoration-anchor':'remove-decoration',slideIndex:a.slideIndex,elementId:choice.elementId,previousOptionId:choice.optionId,optionId:replacement.optionId,deltaX,deltaY}));
  }
 }
 if(!adjustments.length)unavailable();
 adjustments.sort((a,b)=>a.slideIndex-b.slideIndex||(a.elementId<b.elementId?-1:a.elementId>b.elementId?1:0));
 return Object.freeze(adjustments);
}
