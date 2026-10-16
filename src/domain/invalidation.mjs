import {getStages} from './stage-graph.mjs';
import {canonicalHash,canonicalJson} from './canonical-json.mjs';
import {exactKeys} from './brand-schema.mjs';
import {validateIdentifier} from './identifiers.mjs';
import {PublicError,invalidArgument} from './errors.mjs';

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
/** Read-only accounting for Q05's future issuer. Reservations consume a round.
 * This does not validate/authorize adjustments, create reservations or reset them. */
export function correctionEpisodeState(value){
 let e;
 const reference=(r,kind)=>{exactKeys(r,['id','kind','version','sha256']);validateIdentifier(r.id);if(typeof r.kind!=='string'||kind&&r.kind!==kind||!Number.isSafeInteger(r.version)||r.version<1||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256))stale();};
 try{e=JSON.parse(canonicalJson(value));exactKeys(e,['id','episodeId','brandId','runId','version','seedPlanRef','scopeFingerprint','rounds','reservation','closedReason']);for(const key of ['id','episodeId','brandId','runId'])validateIdentifier(e[key]);reference(e.seedPlanRef,'composition-plan');
  if(!Array.isArray(e.rounds))stale();
  for(const [round,reserved]of [...e.rounds.map(r=>[r,false]),...(e.reservation===null?[]:[[e.reservation,true]])]){
   exactKeys(round,['number','defectRefs','previousPlanRef','adjustments',...(reserved?[]:['newPlanRef','attemptIds'])]);reference(round.previousPlanRef,'composition-plan');
   if(!Array.isArray(round.defectRefs)||!Array.isArray(round.adjustments))stale();for(const ref of round.defectRefs)reference(ref);
   if(!reserved){reference(round.newPlanRef,'composition-plan');if(!Array.isArray(round.attemptIds))stale();for(const id of round.attemptIds)validateIdentifier(id);}
  }
 }catch{stale();}
 if(!Number.isSafeInteger(e.version)||e.version<1||!/^[a-f0-9]{64}$/.test(e.scopeFingerprint)||!Array.isArray(e.rounds)||e.rounds.length>2||e.rounds.some((r,i)=>r.number!==i+1)||e.reservation!==null&&e.reservation.number!==e.rounds.length+1||e.closedReason!==null&&typeof e.closedReason!=='string')stale();
 const roundsConsumed=e.rounds.length+Number(e.reservation!==null);if(roundsConsumed>2)stale();
 return Object.freeze({episodeId:e.episodeId,version:e.version,roundsConsumed,remaining:2-roundsConsumed,reserved:e.reservation!==null,closedReason:e.closedReason});
}
export function verifyCorrectionHistory(previous,next){
 correctionEpisodeState(next);if(!previous)return;
 correctionEpisodeState(previous);
 if(previous.episodeId!==next.episodeId||previous.scopeFingerprint!==next.scopeFingerprint||canonicalHash(previous.seedPlanRef)!==canonicalHash(next.seedPlanRef)||next.version<=previous.version||next.rounds.length<previous.rounds.length||canonicalHash(next.rounds.slice(0,previous.rounds.length))!==canonicalHash(previous.rounds))stale();
 if(previous.reservation){const round=next.rounds[previous.reservation.number-1],reservation=next.reservation;if(round){for(const key of ['number','previousPlanRef','defectRefs','adjustments'])if(canonicalHash(round[key])!==canonicalHash(previous.reservation[key]))stale();}else if(canonicalHash(reservation)!==canonicalHash(previous.reservation))stale();}
 if(previous.closedReason!==null&&next.closedReason!==previous.closedReason)stale();
}
