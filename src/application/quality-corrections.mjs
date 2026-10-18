import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRunInputs} from './run-inputs.mjs';
import {runOperation} from './operation-runner.mjs';
import {loadQualifiedQualityResources} from './quality-resources.mjs';
import {canonicalHash,canonicalJson} from '../domain/canonical-json.mjs';
import {canEditRun,correctionEpisodeState,classifyBoundedCorrection} from '../domain/invalidation.mjs';
import {getRunContract} from '../domain/run-snapshot.mjs';
import {verifyQualityReviewProvenance} from '../domain/quality-policy.mjs';
import {exactKeys} from '../domain/brand-schema.mjs';
import {validateIdentifier} from '../domain/identifiers.mjs';
import {PublicError,invalidArgument} from '../domain/errors.mjs';
import {assertQualityContractActive} from '../infrastructure/sqlite/migrations.mjs';
import {createConfinedRoot} from '../infrastructure/fs/confined-path.mjs';
import {stageBytes,promoteFile} from '../infrastructure/fs/atomic-files.mjs';
import {hashFile} from '../infrastructure/fs/hash-file.mjs';
import {DEFAULT_PACKAGE_ROOT} from '../infrastructure/resources.mjs';

const fail=(code,message)=>{throw new PublicError(code,message);};
const stale=()=>fail('QUALITY_EVIDENCE_STALE','Reserva de correção não corresponde às evidências atuais.');
const unavailable=()=>fail('QUALITY_CORRECTION_UNAVAILABLE','Correção exige reserva emitida pelo serviço e ajuste limitado comprovado.');
const equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
const refOf=(record,kind)=>({id:record.id,kind,version:record.version,sha256:canonicalHash(record)});
const scope=r=>{validateIdentifier(r.brandId);validateIdentifier(r.runId);};
const snapshotOf=row=>{const snapshot=JSON.parse(row.snapshot_json);if(canonicalHash(snapshot)!==row.snapshot_hash)fail('SNAPSHOT_HASH_MISMATCH','Snapshot diverge da identidade persistida.');return snapshot;};
function scopeFingerprint(plan){const {id,version,change,...rest}=plan;return canonicalHash({...rest,slides:plan.slides.map(({decorationChoices,...slide})=>slide)});}
async function readRecord(inputs,r,ref){
 exactKeys(ref,['id','kind','version','sha256']);validateIdentifier(ref.id);
 const file=await inputs.resolveArtifact(r.brandId,r.runId,ref.id);
 if(!equal(ref,{id:file.id,kind:file.kind,version:file.version,sha256:file.sha256}))stale();
 let record;try{record=JSON.parse(await readFile(file.path,'utf8'));}catch{stale();}
 if(canonicalHash(record)!==ref.sha256)stale();return record;
}
function assertIssued(db,r,episode,episodeRef){
 const operations=db.prepare("SELECT * FROM operations WHERE brand_id=? AND run_id=? AND operation='quality.correction.reserve'").all(r.brandId,r.runId);
 const issued=operations.some(row=>{const result=JSON.parse(row.result_json),request=result.request;
  return request&&row.canonical_version===1&&row.payload_hash===canonicalHash({operation:row.operation,...r,payload:request})&&result.runVersion===request.expectedVersion+1&&equal(request.defectRefs,episode.reservation?.defectRefs)&&equal(result.episodeRef??null,episodeRef)&&result.episodeId===episode.episodeId&&result.roundNumber===episode.reservation?.number;
 });
 if(!issued)unavailable();
}
async function reservationContext({db,inputs,brandId,runId,reservationRef}){
 const r={brandId,runId};scope(r);await inputs.correctionEpisodes(brandId,runId);
 const row=db.prepare("SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND kind='quality-correction-episode' ORDER BY version DESC LIMIT 1").get(brandId,runId);
 if(!row||row.id!==reservationRef?.id||reservationRef.kind!=='quality-correction-episode')unavailable();
 const episode=await readRecord(inputs,r,reservationRef);correctionEpisodeState(episode);
 if(!episode.reservation||episode.closedReason!==null)unavailable();assertIssued(db,r,episode,reservationRef);
 const previous=await readRecord(inputs,r,episode.reservation.previousPlanRef);
 if(scopeFingerprint(previous)!==episode.scopeFingerprint)stale();
 return {episode,previous};
}
/** Internal verifier shared by the generic input writer. A persisted ArtifactRef
 * is necessary but insufficient: the issuing operation, latest immutable version,
 * package authority, exact predecessor and recomputed adjustments all bind it. */
export async function verifyReservedCorrection({db,inputs,brandId,runId,plan,currentPlanRef,snapshot,packageRoot=DEFAULT_PACKAGE_ROOT}){
 const reservationRef=plan.change?.correctionEpisodeRef;
 const context=await reservationContext({db,inputs,brandId,runId,reservationRef});
 if(!equal(plan.change.previousPlanRef,context.episode.reservation.previousPlanRef)||!equal(currentPlanRef,context.episode.reservation.previousPlanRef))stale();
 const {qualifications}=await loadQualifiedQualityResources({packageRoot,snapshot});
 const adjustments=classifyBoundedCorrection({previous:context.previous,next:plan,qualifications});
 if(!equal(adjustments,context.episode.reservation.adjustments))stale();
 return {...context,qualifications};
}

/** Gate-only read: unresolved reservations cannot release production. Closed
 * plans must point backward to an issued reservation and have a matching closing
 * operation. Imported historical counters remain readable, not authoritative. */
export async function verifySettledCorrectionHistory({db,inputs,brandId,runId,plan,planRef,snapshot,packageRoot=DEFAULT_PACKAGE_ROOT}){
 const r={brandId,runId},states=await inputs.correctionEpisodes(brandId,runId);
 if(!states.length){if(plan.change.kind==='bounded-correction')stale();return null;}
 if(states.length!==1)stale();if(states[0].reserved)unavailable();
 const rows=db.prepare("SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND kind='quality-correction-episode' ORDER BY version").all(brandId,runId),history=[];
 for(const row of rows){const ref={id:row.id,kind:row.kind,version:row.version,sha256:row.hash};history.push({ref,record:await readRecord(inputs,r,ref)});}
 const latest=history.at(-1).record,{qualifications}=await loadQualifiedQualityResources({packageRoot,snapshot});
 const operations=db.prepare("SELECT * FROM operations WHERE brand_id=? AND run_id=? AND operation='quality.correction.complete'").all(brandId,runId);
 for(const item of history){
  if(item.record.reservation)assertIssued(db,r,item.record,item.ref);
  else if(!item.record.rounds.length||!operations.some(operation=>{const result=JSON.parse(operation.result_json);return result.request&&operation.canonical_version===1&&operation.payload_hash===canonicalHash({operation:operation.operation,...r,payload:result.request})&&equal(result.episodeRef,item.ref)&&equal(result.planRef,item.record.rounds.at(-1).newPlanRef);}))stale();
 }
 for(const round of latest.rounds){
  const reserved=history.find(item=>item.record.reservation?.number===round.number),closed=history.find(item=>item.record.rounds.length===round.number&&item.record.reservation===null);
  if(!reserved||!closed)stale();assertIssued(db,r,reserved.record,reserved.ref);
  const previous=await readRecord(inputs,r,round.previousPlanRef),next=await readRecord(inputs,r,round.newPlanRef);
  if(next.change.kind!=='bounded-correction'||!equal(next.change.correctionEpisodeRef,reserved.ref)||!equal(next.change.previousPlanRef,round.previousPlanRef)||!equal(classifyBoundedCorrection({previous,next,qualifications}),round.adjustments))stale();
  if(!operations.some(operation=>{const result=JSON.parse(operation.result_json);return result.request&&operation.canonical_version===1&&operation.payload_hash===canonicalHash({operation:operation.operation,...r,payload:result.request})&&equal(result.episodeRef,closed.ref)&&equal(result.reservationRef,reserved.ref)&&equal(result.planRef,round.newPlanRef)&&result.roundNumber===round.number;}))stale();
 }
 if(plan.change.kind==='bounded-correction'&&!equal(latest.rounds.at(-1)?.newPlanRef??null,planRef))stale();
 return {episodeId:latest.episodeId,roundsConsumed:states[0].roundsConsumed};
}

/** Internal persistence service. It neither grants review/consent nor renders.
 * No reset/open-episode operation exists. A material successor needs a separate
 * explicit-approval protocol, which is deliberately unavailable in this scope. */
export async function createQualityCorrections({root,db,packageRoot=DEFAULT_PACKAGE_ROOT,hooks={},sleep}){
 const inputs=await createRunInputs({root,db,packageRoot}),guard=await createConfinedRoot(root);
 const findRun=r=>db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(r.brandId,r.runId);
 const capture=r=>({run:findRun(r),operations:db.prepare('SELECT * FROM operations WHERE brand_id=? AND run_id=? AND request_id<>? ORDER BY request_id').all(r.brandId,r.runId,r.requestId),...Object.fromEntries(['steps','step_attempts','artifacts','approvals','confirmation_requests'].map(table=>[table,db.prepare(`SELECT * FROM ${table} WHERE brand_id=? AND run_id=? ORDER BY id`).all(r.brandId,r.runId)]))});
 const unchanged=(r,before)=>{if(!equal(capture(r),before))fail('RUN_VERSION_CONFLICT','Execução alterada durante a correção.');};
 function editable(r){
  scope(r);assertQualityContractActive(db);const row=findRun(r);if(!row)fail('RUN_NOT_FOUND','Execução não encontrada.');
  if(getRunContract(snapshotOf(row)).contractVersion!==2)fail('RUN_DERIVATION_REQUIRED','Correção exige contrato de qualidade.');
  if(db.prepare('SELECT status FROM brands WHERE id=?').get(r.brandId)?.status!=='active')fail('BRAND_ARCHIVED','Marca arquivada.');
  if(!canEditRun({status:row.status,leaseOwner:row.lease_owner,activeAttempt:Boolean(db.prepare("SELECT 1 FROM step_attempts WHERE brand_id=? AND run_id=? AND status='running'").get(r.brandId,r.runId)),activeStage:Boolean(db.prepare("SELECT 1 FROM steps WHERE brand_id=? AND run_id=? AND status='running'").get(r.brandId,r.runId))}))fail('RUN_NOT_EDITABLE','Execução exige encerrar ou reconciliar a tentativa.');
  if(row.version!==r.expectedVersion)fail('RUN_VERSION_CONFLICT','Execução alterada desde a leitura.');return row;
 }
 function request(input,operation,required,optional=[]){const r=JSON.parse(canonicalJson(input));exactKeys(r,['requestId','brandId','runId','expectedVersion',...required],optional);scope(r);if(!Number.isSafeInteger(r.expectedVersion)||r.expectedVersion<1)throw invalidArgument('Versão de execução inválida.');const {requestId,brandId,runId,...payload}=r;return {r,op:{requestId,brandId,runId,operation,payload}};}
 function replay(op,r){const sentinel=Symbol();try{return runOperation(db,op,()=>{editable(r);throw sentinel;});}catch(error){if(error!==sentinel)throw error;return null;}}
 async function get(input){
  const r=JSON.parse(canonicalJson(input));exactKeys(r,['brandId','runId']);scope(r);const states=await inputs.correctionEpisodes(r.brandId,r.runId);
  if(states.length>1)stale();
  const row=db.prepare("SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND kind='quality-correction-episode' ORDER BY version DESC LIMIT 1").get(r.brandId,r.runId);
  if(!row)return null;const episodeRef={id:row.id,kind:row.kind,version:row.version,sha256:row.hash},episode=await readRecord(inputs,r,episodeRef);
  return {episodeRef,episode,state:correctionEpisodeState(episode)};
 }
 async function verifyDefects(r,refs,planRef,{provenance=false}={}){
  if(!Array.isArray(refs)||!refs.length||new Set(refs.map(ref=>ref.id)).size!==refs.length)unavailable();
  for(const ref of refs){
   if(!/^(objective-report|quality-review):(preview|final)$/.test(ref.kind))unavailable();
   const record=await readRecord(inputs,r,ref),kind=ref.kind.split(':')[1];
   if(record.brandId!==r.brandId||record.runId!==r.runId||record.kind!==kind||!record.manifestRef)stale();
   const objective=ref.kind.startsWith('objective-report:');
   if(objective?record.result!=='failed'||!record.checks?.some(c=>c.result==='failed'):record.verdict!=='failed'||!record.findings?.some(f=>f.severity==='blocking'))unavailable();
   if(!objective){
    const request=db.prepare('SELECT * FROM confirmation_requests WHERE brand_id=? AND run_id=? AND id=?').get(r.brandId,r.runId,record.confirmationRequestId),operation=db.prepare("SELECT * FROM operations WHERE brand_id=? AND run_id=? AND operation='run.quality-review.decide'").all(r.brandId,r.runId).find(o=>JSON.parse(o.result_json).review?.id===record.id);
    verifyQualityReviewProvenance({review:record,reviewRef:ref,request,operation});
   }
   const manifest=await readRecord(inputs,r,record.manifestRef);
   if(record.manifestRef.kind!==`render-manifest:${kind}`||manifest.brandId!==r.brandId||manifest.runId!==r.runId||manifest.renderAttemptId!==record.renderAttemptId||!equal(manifest.planRef,planRef)||manifest.snapshotHash!==findRun(r).snapshot_hash)stale();
   const attempt=db.prepare("SELECT * FROM step_attempts WHERE brand_id=? AND run_id=? AND id=? AND status='succeeded'").get(r.brandId,r.runId,manifest.renderAttemptId);
   if(!attempt||attempt.result_artifact_id!==manifest.id)stale();
   if(provenance){const {createProductionGate}=await import('./production-gate.mjs');await(await createProductionGate({root,db,packageRoot})).inspectCorrectionDefect({brandId:r.brandId,runId:r.runId,defectRef:ref,planRef});}
  }
 }
 async function stageEpisode(r,episode){
  const bytes=Buffer.from(canonicalJson(episode)),relative=await stageBytes(guard,bytes,{hooks,sleep});
  const expected=canonicalHash(episode),check=async relative=>{const actual=await guard.withPaths([relative],hashFile);if(actual.sha256!==expected||actual.size!==bytes.length)fail('ARTIFACT_HASH_MISMATCH','Episódio diverge dos bytes persistidos.');};
  await hooks.hash?.();await check(relative);const relativePath=`runs/${r.brandId}/${r.runId}/${randomUUID()}/${episode.id}.bin`;
  await promoteFile(guard,relative,relativePath,{hooks,sleep});await check(relativePath);return {relativePath,size:bytes.length,check:()=>check(relativePath)};
 }
 function commitEpisode(r,op,episode,staged,before,result,eventType){
  let committed;return runOperation(db,op,({emit})=>{
   editable(r);unchanged(r,before);
   db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(episode.id,r.brandId,r.runId,'quality-correction-episode',episode.version,canonicalHash(episode),staged.relativePath,canonicalJson({size:staged.size}));
   if(eventType==='quality.correction.reserved')db.prepare("UPDATE runs SET version=version+1,status='blocked' WHERE brand_id=? AND id=?").run(r.brandId,r.runId);
   else db.prepare('UPDATE runs SET version=version+1 WHERE brand_id=? AND id=?').run(r.brandId,r.runId);
   db.prepare("UPDATE confirmation_requests SET status='cancelled',resolved_at=? WHERE brand_id=? AND run_id=? AND status='pending'").run(new Date().toISOString(),r.brandId,r.runId);
   emit({id:randomUUID(),eventType});committed=capture(r);const injected=hooks.commit?.();if(injected?.then)throw invalidArgument('Hook precisa ser síncrono.');
   return {status:'committed',result};
  },{beforeCommit:()=>unchanged(r,committed)});
 }
 async function verifyReplay(r,result){
  if(result.code==='QUALITY_CORRECTION_LIMIT')fail(result.code,'Duas rodadas já consumidas; é necessária decisão humana.');
  await get({brandId:r.brandId,runId:r.runId});await readRecord(inputs,r,result.episodeRef);return result;
 }
 async function reserve(input){
  const {r,op}=request(input,'quality.correction.reserve',['choices','defectRefs']);const prior=replay(op,r);if(prior)return verifyReplay(r,prior);
  const row=editable(r),snapshot=snapshotOf(row),current=await get({brandId:r.brandId,runId:r.runId}),before=capture(r);
  if(current?.state.roundsConsumed===2){
   let committed;runOperation(db,op,({emit})=>{editable(r);unchanged(r,before);db.prepare("UPDATE runs SET status='blocked',version=version+1 WHERE brand_id=? AND id=?").run(r.brandId,r.runId);db.prepare("UPDATE confirmation_requests SET status='cancelled',resolved_at=? WHERE brand_id=? AND run_id=? AND status='pending'").run(new Date().toISOString(),r.brandId,r.runId);emit({id:randomUUID(),eventType:'quality.correction.limit',diagnosticCode:'QUALITY_CORRECTION_LIMIT'});committed=capture(r);return {status:'committed',result:{code:'QUALITY_CORRECTION_LIMIT'}};},{beforeCommit:()=>unchanged(r,committed)});
   fail('QUALITY_CORRECTION_LIMIT','Duas rodadas já consumidas; é necessária decisão humana.');
  }
  if(current?.episode.reservation||current?.episode.closedReason!==null&&current)unavailable();
  const saved=await inputs.get(r.brandId,r.runId);if(!saved?.artifacts.plan)unavailable();const previous=await readRecord(inputs,r,saved.artifacts.plan);
  if(current&&(!equal(current.episode.rounds.at(-1)?.newPlanRef??current.episode.seedPlanRef,saved.artifacts.plan)||scopeFingerprint(previous)!==current.episode.scopeFingerprint))unavailable();
  const {qualifications}=await loadQualifiedQualityResources({packageRoot,snapshot});
  if(!Array.isArray(r.choices)||!r.choices.length||new Set(r.choices.map(c=>`${c.slideIndex}:${c.elementId}`)).size!==r.choices.length)unavailable();
  const next=structuredClone(previous);
  for(const choice of r.choices){exactKeys(choice,['slideIndex','elementId','optionId']);const slide=next.slides.find(s=>s.slideIndex===choice.slideIndex),target=slide?.decorationChoices.find(c=>c.elementId===choice.elementId);if(!target)unavailable();target.optionId=choice.optionId;}
  const adjustments=classifyBoundedCorrection({previous,next,qualifications});await verifyDefects(r,r.defectRefs,saved.artifacts.plan,{provenance:true});
  const episode={id:randomUUID(),episodeId:current?.episode.episodeId??randomUUID(),brandId:r.brandId,runId:r.runId,version:(current?.episode.version??0)+1,seedPlanRef:current?.episode.seedPlanRef??saved.artifacts.plan,scopeFingerprint:current?.episode.scopeFingerprint??scopeFingerprint(previous),rounds:current?.episode.rounds??[],reservation:{number:(current?.episode.rounds.length??0)+1,previousPlanRef:saved.artifacts.plan,defectRefs:r.defectRefs,adjustments},closedReason:null};
  correctionEpisodeState(episode);const staged=await stageEpisode(r,episode);
  if(!equal(await inputs.get(r.brandId,r.runId),saved)||!equal(await get({brandId:r.brandId,runId:r.runId}),current))stale();
  await verifyDefects(r,r.defectRefs,saved.artifacts.plan,{provenance:true});await loadQualifiedQualityResources({packageRoot,snapshot});await staged.check();
  const result={episodeRef:refOf(episode,'quality-correction-episode'),episodeId:episode.episodeId,roundNumber:episode.reservation.number,runVersion:r.expectedVersion+1,request:op.payload};
  return verifyReplay(r,commitEpisode(r,op,episode,staged,before,result,'quality.correction.reserved'));
 }
 async function complete(input){
  const {r,op}=request(input,'quality.correction.complete',['reservationRef']);const prior=replay(op,r);if(prior)return verifyReplay(r,prior);
  editable(r);const {episode,previous}=await reservationContext({db,inputs,...r}),snapshot=snapshotOf(findRun(r));
  const {qualifications}=await loadQualifiedQualityResources({packageRoot,snapshot});
  let expectedCloseVersion=r.expectedVersion;
  let saved=await inputs.get(r.brandId,r.runId);if(!saved?.artifacts.plan)stale();let plan=await readRecord(inputs,r,saved.artifacts.plan);
  if(equal(saved.artifacts.plan,episode.reservation.previousPlanRef)){
   plan=structuredClone(previous);plan.id=randomUUID();plan.version=db.prepare("SELECT COALESCE(MAX(version),0)+1 n FROM artifacts WHERE brand_id=? AND run_id=? AND kind='composition-plan'").get(r.brandId,r.runId).n;
   plan.change={kind:'bounded-correction',previousPlanRef:episode.reservation.previousPlanRef,correctionEpisodeRef:r.reservationRef};
   for(const adjustment of episode.reservation.adjustments)plan.slides.find(s=>s.slideIndex===adjustment.slideIndex).decorationChoices.find(c=>c.elementId===adjustment.elementId).optionId=adjustment.optionId;
   const writer=await createRunInputs({root,db,packageRoot,qualifications});
   saved=await writer.savePlan({requestId:`${r.requestId}:plan`,brandId:r.brandId,runId:r.runId,expectedVersion:r.expectedVersion,plan});
   expectedCloseVersion=saved.runVersion;await hooks.afterPlan?.();
  }else if(plan.change.kind!=='bounded-correction'||!equal(plan.change.correctionEpisodeRef,r.reservationRef)||!equal(plan.change.previousPlanRef,episode.reservation.previousPlanRef))stale();
  if(!equal(classifyBoundedCorrection({previous,next:plan,qualifications}),episode.reservation.adjustments))stale();
  // If the process stopped after savePlan, a fresh completion reconciles this
  // exact reserved successor. The same second reservation remains finishable.
  const closeRequest={...r,expectedVersion:expectedCloseVersion};editable(closeRequest);const before=capture(r);
  await reservationContext({db,inputs,...r});
  const closed={...episode,id:randomUUID(),version:episode.version+1,rounds:[...episode.rounds,{...episode.reservation,newPlanRef:saved.artifacts.plan,attemptIds:[]}],reservation:null,closedReason:episode.reservation.number===2?'limit-reached':null};
  correctionEpisodeState(closed);const staged=await stageEpisode(r,closed);
  await reservationContext({db,inputs,...r});if(!equal(await inputs.get(r.brandId,r.runId),saved))stale();await readRecord(inputs,r,saved.artifacts.plan);await verifyDefects(r,episode.reservation.defectRefs,episode.reservation.previousPlanRef);await loadQualifiedQualityResources({packageRoot,snapshot});await staged.check();
  const result={episodeRef:refOf(closed,'quality-correction-episode'),reservationRef:r.reservationRef,planRef:saved.artifacts.plan,roundNumber:episode.reservation.number,runVersion:closeRequest.expectedVersion+1,request:op.payload};
  return verifyReplay(r,commitEpisode(closeRequest,op,closed,staged,before,result,'quality.correction.closed'));
 }
 return Object.freeze({reserve,complete,get});
}
