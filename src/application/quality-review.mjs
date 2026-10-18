import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {canonicalHash,canonicalJson} from '../domain/canonical-json.mjs';
import {exactKeys} from '../domain/brand-schema.mjs';
import {validateIdentifier} from '../domain/identifiers.mjs';
import {fingerprintQualityReviewObject,fingerprintQualityReviewProposal,validateQualityReview,verifyQualityEvidence} from '../domain/quality-evidence.mjs';
import {reviewStage,deriveQualityVerdict,verifyQualityReviewProvenance} from '../domain/quality-policy.mjs';
import {transitionRun} from '../domain/run-state-machine.mjs';
import {PublicError,invalidArgument} from '../domain/errors.mjs';
import {createConfinedRoot} from '../infrastructure/fs/confined-path.mjs';
import {stageBytes,promoteFile} from '../infrastructure/fs/atomic-files.mjs';
import {sha256,DEFAULT_PACKAGE_ROOT} from '../infrastructure/resources.mjs';
import {createQualityPresentation} from '../interfaces/cli/quality-presentation.mjs';
import {requireQualityReviewConfirmation,consumeQualityReviewConfirmation} from '../interfaces/cli/human-confirmation.mjs';
import {createProductionGate,qualityReviewStageFingerprint} from './production-gate.mjs';
import {runOperation} from './operation-runner.mjs';
const fail=(code,message)=>{throw new PublicError(code,message);};
const stale=()=>fail('QUALITY_EVIDENCE_STALE','Pedido ou evidência mudou desde a apresentação.');
const equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
const clone=v=>JSON.parse(canonicalJson(v));
const ref=row=>({id:row.id,kind:row.kind,version:row.version,sha256:row.hash});
const objectFields=['brandId','runId','kind','renderAttemptId','manifestRef','planHash','selectionHash','qualificationRefs','objectiveReportRef','rubricRef','checkerRefs'];
export async function createQualityReview({root,db,packageRoot=DEFAULT_PACKAGE_ROOT,hooks={},sleep}){
 const guard=await createConfinedRoot(root),gate=await createProductionGate({root,db,packageRoot});
 const operationFor=(id,scope)=>db.prepare('SELECT * FROM operations WHERE request_id=? AND brand_id=? AND run_id=?').get(id,scope.brandId,scope.runId);
 function writable(ctx){if(ctx.run.lease_owner!==null||ctx.stored.step_attempts.some(a=>a.status==='running'))fail('RUN_BUSY','A revisão não pode reter execução ativa.');if(!['ready','waiting-approval'].includes(ctx.run.status))fail('RUN_NOT_REVIEWABLE','Estado da execução não permite parecer.');}
 function pending(row){if(!row||row.status!=='pending'||row.expires_at!==null&&(!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=Date.now()))stale();}
 function object(ctx,objectiveReportRef){const m=ctx.manifest;return {...ctx.scope,kind:m.kind,renderAttemptId:m.renderAttemptId,manifestRef:ctx.manifestRef,planHash:m.planRef.sha256,selectionHash:m.selectionHash,qualificationRefs:m.qualifications,objectiveReportRef,rubricRef:ctx.snapshot.qualityPolicy.rubricRef,checkerRefs:ctx.snapshot.qualityPolicy.checkerRefs};}
 function proposal(ctx,request,objectiveReportRef,runVersion=ctx.run.version){const obj=object(ctx,objectiveReportRef);return {schemaVersion:1,...ctx.scope,kind:ctx.manifest.kind,confirmationRequestId:request.id,runVersion,objectFingerprint:fingerprintQualityReviewObject(obj),manifestRef:ctx.manifestRef,objectiveReportRef,manifest:ctx.manifest,rubricRef:obj.rubricRef,checkerRefs:obj.checkerRefs};}
 async function publish(ctx,kind,version,bytes,id=randomUUID()){
  const staging=await stageBytes(guard,bytes,{hooks,sleep}),relativePath=`runs/${ctx.scope.brandId}/${ctx.scope.runId}/${randomUUID()}/${id}.bin`;
  await promoteFile(guard,staging,relativePath,{hooks,sleep});const checked=await guard.withPaths([relativePath],p=>readFile(p));if(!checked.equals(bytes))fail('ARTIFACT_HASH_MISMATCH','Artefato alterado durante persistência.');return {ref:{id,kind,version,sha256:sha256(bytes)},relativePath,size:bytes.length};
 }
 const insert=(ctx,file,metadata={})=>db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(file.ref.id,ctx.scope.brandId,ctx.scope.runId,file.ref.kind,file.ref.version,file.ref.sha256,file.relativePath,canonicalJson({size:file.size,...metadata}));
 function putStage(ctx,status,fingerprint){db.prepare('INSERT INTO steps(id,brand_id,run_id,step_key,status,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT(brand_id,run_id,step_key) DO UPDATE SET status=excluded.status,fingerprint=excluded.fingerprint').run(randomUUID(),ctx.scope.brandId,ctx.scope.runId,reviewStage(ctx.manifest.kind),status,fingerprint);}
 async function presented(ctx,result){const presentation=await createQualityPresentation(result.proposal,ctx.files.filter(f=>ctx.manifest.files.some(x=>x.artifactRef.id===f.id)).map(f=>({artifactId:f.id,bytes:f.bytes})));gate.unchanged(ctx);return {...result,presentation};}
 async function requestQualityReview(input){const r=clone(input);exactKeys(r,['brandId','runId','kind','manifestId','requestId']);validateIdentifier(r.manifestId);const ctx=await gate.inspectReview({brandId:r.brandId,runId:r.runId,kind:r.kind,manifestId:r.manifestId});writable(ctx);
  const op={requestId:r.requestId,...ctx.scope,operation:'run.quality-review.request',payload:{kind:r.kind,manifestId:r.manifestId}},previous=operationFor(r.requestId,ctx.scope);
  if(previous){const result=runOperation(db,op,()=>{throw Error('unreachable');});const row=ctx.stored.confirmation_requests.find(q=>q.id===result.proposal.confirmationRequestId);pending(row);if(!equal(result.proposal,proposal(ctx,row,ctx.objectiveReportRef)))stale();return presented(ctx,result);}
  const key=reviewStage(r.kind);if(ctx.run.current_step!==key)fail('QUALITY_EVIDENCE_INCOMPLETE','Revisão fora da etapa atual.');
  const old=ctx.stored.confirmation_requests.find(q=>q.kind===`review-${r.kind}`&&q.status==='pending');
  if(old){pending(old);const p=proposal(ctx,old,ctx.objectiveReportRef);if(p.objectFingerprint!==old.object_fingerprint||p.manifestRef.id!==old.object_artifact_id)stale();return presented(ctx,{status:'pending',proposal:p});}
  if(ctx.run.status!=='ready')stale();
  let staged=null,objectiveReportRef=ctx.objectiveReportRef;
  if(!objectiveReportRef){const version=Math.max(0,...ctx.stored.artifacts.filter(a=>a.kind===`objective-report:${r.kind}`).map(a=>a.version))+1;staged=await publish(ctx,`objective-report:${r.kind}`,version,Buffer.from(canonicalJson(ctx.objectiveReport)));objectiveReportRef=staged.ref;}
  const id=randomUUID(),p=proposal(ctx,{id},objectiveReportRef,ctx.run.version+1),fingerprint=qualityReviewStageFingerprint(ctx,ctx.manifest,ctx.manifestRef,objectiveReportRef);let committed;
  const result=runOperation(db,op,({emit})=>{gate.unchanged(ctx);writable(ctx);if(staged)insert(ctx,staged,{operationRequestId:r.requestId});
   db.prepare('INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,object_artifact_id) VALUES(?,?,?,?,?,?)').run(id,r.brandId,r.runId,`review-${r.kind}`,p.objectFingerprint,r.manifestId);putStage(ctx,'waiting-approval',fingerprint);
   db.prepare('UPDATE runs SET status=?,version=version+1,current_step=? WHERE brand_id=? AND id=?').run(transitionRun(ctx.run.status,{type:'review-required'}),key,r.brandId,r.runId);emit({id:randomUUID(),eventType:'quality.review-required'});committed=gate.capture(ctx.scope);const injected=hooks.beforeCommit?.();if(injected?.then)throw invalidArgument('Hook precisa ser síncrono.');return {status:'committed',result:{status:'pending',proposal:p}};
  },{beforeCommit:()=>{const state=gate.capture(ctx.scope);state.operations=state.operations.filter(o=>o.request_id!==r.requestId);if(!equal(state,committed))stale();}});
  const fresh=await gate.inspectReview({brandId:r.brandId,runId:r.runId,kind:r.kind,manifestId:r.manifestId});return presented(fresh,result);
 }
 async function getQualityReview(input){const r=clone(input);exactKeys(r,['brandId','runId','reviewId']);validateIdentifier(r.reviewId);
  const row=db.prepare('SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND id=?').get(r.brandId,r.runId,r.reviewId);if(!row||!['quality-review:preview','quality-review:final'].includes(row.kind))fail('QUALITY_REVIEW_NOT_FOUND','Parecer não encontrado nesta execução.');
  const kind=row.kind.split(':')[1],stored=gate.capture({brandId:r.brandId,runId:r.runId});const temporary={scope:{brandId:r.brandId,runId:r.runId},stored};const review=validateQualityReview(await gate.readRef(temporary,ref(row)));
  const ctx=await gate.inspectReview({brandId:r.brandId,runId:r.runId,kind,manifestId:review.manifestRef.id}),operation=ctx.stored.operations.find(o=>o.operation==='run.quality-review.decide'&&JSON.parse(o.result_json).review?.id===review.id),request=ctx.stored.confirmation_requests.find(q=>q.id===review.confirmationRequestId);
  const latest=ctx.stored.artifacts.filter(a=>a.kind===row.kind).sort((a,b)=>b.version-a.version)[0],stage=ctx.stored.steps.find(s=>s.step_key===reviewStage(kind));if(latest?.id!==row.id||stage?.status!==(review.verdict==='passed'?'succeeded':'failed')||stage.fingerprint!==qualityReviewStageFingerprint(ctx,ctx.manifest,ctx.manifestRef,ctx.objectiveReportRef))stale();
  verifyQualityReviewProvenance({review,reviewRef:ref(row),request,operation});verifyQualityEvidence({review,manifest:ctx.manifest,objectiveReport:ctx.objectiveReport,snapshot:ctx.snapshot,plan:ctx.plan,...(kind==='final'?{previewManifest:ctx.preview.manifest}:{}),expected:{...ctx.scope,kind,renderAttemptId:ctx.manifest.renderAttemptId,manifestRef:ctx.manifestRef,objectiveReportRef:ctx.objectiveReportRef}});gate.unchanged(ctx);return {review,reviewRef:ref(row),humanReceiptVerified:true};
 }
 async function decide(input,receipt){const r=clone(input);exactKeys(r,['requestId','proposal','answers']);const p=r.proposal;exactKeys(r.answers,['coverage','criteria','findings']);
  const op={requestId:r.requestId,brandId:p.brandId,runId:p.runId,operation:'run.quality-review.decide',payload:{proposal:p,answers:r.answers}};
  if(operationFor(r.requestId,p)){const result=runOperation(db,op,()=>{throw Error('unreachable');});const verified=await getQualityReview({brandId:p.brandId,runId:p.runId,reviewId:result.review.id});if(!equal(verified.review,result.review))stale();return result;}
  const ctx=await gate.inspectReview({brandId:p.brandId,runId:p.runId,kind:p.kind,manifestId:p.manifestRef.id});writable(ctx);const request=ctx.stored.confirmation_requests.find(q=>q.id===p.confirmationRequestId);pending(request);
  if(!equal(p,proposal(ctx,request,ctx.objectiveReportRef))||request.object_fingerprint!==p.objectFingerprint||request.object_artifact_id!==p.manifestRef.id||ctx.run.current_step!==reviewStage(p.kind))stale();
  const receiptEvidence=requireQualityReviewConfirmation(receipt,p,r.answers),version=Math.max(0,...ctx.stored.artifacts.filter(a=>a.kind===`quality-review:${p.kind}`).map(a=>a.version))+1;
  const obj=object(ctx,ctx.objectiveReportRef),record={schemaVersion:1,id:randomUUID(),...obj,version,objectFingerprint:p.objectFingerprint,reviewProposalHash:fingerprintQualityReviewProposal({objectFingerprint:p.objectFingerprint,confirmationRequestId:p.confirmationRequestId,...r.answers}),manifestHash:p.manifestRef.sha256,method:'human-local-assisted@1',reviewer:{kind:'human-local',gateway:'local-terminal',sessionId:receiptEvidence.sessionId,receiptId:receiptEvidence.id},confirmationRequestId:p.confirmationRequestId,reviewedAt:receiptEvidence.confirmedAt,...r.answers,verdict:deriveQualityVerdict({objectiveResult:ctx.objectiveReport.result,...r.answers})};
  const review=validateQualityReview(record);verifyQualityEvidence({review,manifest:ctx.manifest,objectiveReport:ctx.objectiveReport,snapshot:ctx.snapshot,plan:ctx.plan,...(p.kind==='final'?{previewManifest:ctx.preview.manifest}:{}),expected:{...ctx.scope,kind:p.kind,renderAttemptId:ctx.manifest.renderAttemptId,manifestRef:ctx.manifestRef,objectiveReportRef:ctx.objectiveReportRef}});
  const file=await publish(ctx,`quality-review:${p.kind}`,version,Buffer.from(canonicalJson(review)),review.id);
  // Presentation and file IO happen without SQLite transaction or render lease.
  // Re-resolve every source after staging before the short guarded commit.
  const fresh=await gate.inspectReview({brandId:p.brandId,runId:p.runId,kind:p.kind,manifestId:p.manifestRef.id});if(!equal(fresh.stored,ctx.stored))stale();requireQualityReviewConfirmation(receipt,p,r.answers);
  const result={review,reviewRef:file.ref,evidence:{schemaVersion:1,operationRequestId:r.requestId,proposal:p,answers:r.answers,receipt:receiptEvidence}};let committed;
  const saved=runOperation(db,op,({emit})=>{gate.unchanged(ctx);writable(ctx);pending(request);requireQualityReviewConfirmation(receipt,p,r.answers);insert(ctx,file,{operationRequestId:r.requestId});const passed=review.verdict==='passed';
   db.prepare('UPDATE confirmation_requests SET status=?,resolved_at=? WHERE id=? AND brand_id=? AND run_id=?').run(passed?'confirmed':'rejected',review.reviewedAt,request.id,p.brandId,p.runId);putStage(ctx,passed?'succeeded':'failed',qualityReviewStageFingerprint(ctx,ctx.manifest,ctx.manifestRef,ctx.objectiveReportRef));
   db.prepare('UPDATE runs SET status=?,version=version+1,current_step=? WHERE brand_id=? AND id=?').run(transitionRun(ctx.run.status,{type:passed?'review-passed':'review-failed'}),passed?(p.kind==='preview'?'preview-approval':'package'):reviewStage(p.kind),p.brandId,p.runId);emit({id:randomUUID(),eventType:passed?'quality.review-passed':'quality.review-failed'});committed=gate.capture(ctx.scope);const injected=hooks.beforeCommit?.();if(injected?.then)throw invalidArgument('Hook precisa ser síncrono.');return {status:'committed',result};
  },{beforeCommit:()=>{const state=gate.capture(ctx.scope);state.operations=state.operations.filter(o=>o.request_id!==r.requestId);if(!equal(state,committed))stale();verifyQualityReviewProvenance({review,reviewRef:file.ref,request:db.prepare('SELECT * FROM confirmation_requests WHERE id=?').get(request.id),operation:operationFor(r.requestId,p)});}});
  consumeQualityReviewConfirmation(receipt);return saved;
 }
 return Object.freeze({requestQualityReview,getQualityReview,request:requestQualityReview,get:getQualityReview,decide});
}
