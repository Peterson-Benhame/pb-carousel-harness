import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRunInputs} from './run-inputs.mjs';
import {runOperation} from './operation-runner.mjs';
import {canonicalHash,canonicalJson} from '../domain/canonical-json.mjs';
import {exactKeys} from '../domain/brand-schema.mjs';
import {validateIdentifier} from '../domain/identifiers.mjs';
import {PublicError,invalidArgument} from '../domain/errors.mjs';
import {buildInputFingerprints,fingerprintStage} from '../domain/artifact-fingerprints.mjs';
import {getRunContract} from '../domain/run-snapshot.mjs';
import {getStages} from '../domain/stage-graph.mjs';
import {transitionRun} from '../domain/run-state-machine.mjs';
import {approvalStage,approvalCopy,approvalVisual,validateApprovalProposal,approvalDecision,approvalRequired,approvalStale,requireApprovalConfirmation,consumeApprovalConfirmation} from '../domain/approval-policy.mjs';
import {verifySchema,assertQualityContractActive} from '../infrastructure/sqlite/migrations.mjs';
import {validateRenderManifest,validateQualityReview,verifyQualityEvidence} from '../domain/quality-evidence.mjs';
import {createConfinedRoot} from '../infrastructure/fs/confined-path.mjs';

const fail=(code,message)=>{throw new PublicError(code,message);};
const equal=(a,b)=>canonicalHash(a)===canonicalHash(b);
const clone=value=>JSON.parse(canonicalJson(value));
const ref=row=>({id:row.id,kind:row.kind,version:row.version,sha256:row.hash});
const scope=r=>{validateIdentifier(r.brandId);validateIdentifier(r.runId);};
/** T15 internal consent service. Requests never grant human consent. Q05 owns
 * quality-review issuance and its trusted persisted receipt verifier; the default
 * preview path fails closed. No renderer, public grant endpoint or invalidation. */
export async function createApprovals({root,db,hooks={},verifyReviewReceipt}){
 const inputs=await createRunInputs({root,db}),guard=await createConfinedRoot(root);
 function capture(r){return {run:db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(r.brandId,r.runId)??null,brand:db.prepare('SELECT status FROM brands WHERE id=?').get(r.brandId)??null,...Object.fromEntries(['steps','step_attempts','artifacts','approvals','confirmation_requests'].map(table=>[table,db.prepare(`SELECT * FROM ${table} WHERE brand_id=? AND run_id=? ORDER BY id`).all(r.brandId,r.runId)]))};}
 function unchanged(ctx){if(!equal(capture(ctx.request),ctx.stored))throw approvalStale();}
 function writable(ctx){const schema=verifySchema(db);if(schema===2&&ctx.contract.contractVersion===1)fail('RUN_DERIVATION_REQUIRED','Execução histórica exige derivação para o contrato de qualidade.');if(ctx.contract.contractVersion===2)assertQualityContractActive(db);if(ctx.stored.brand?.status!=='active')fail('BRAND_ARCHIVED','Marca arquivada.');if(ctx.stored.run.lease_owner!==null||ctx.stored.step_attempts.some(a=>a.status==='running'))fail('RUN_BUSY','A execução precisa encerrar a tentativa antes de pedir consentimento.');if(!['ready','waiting-approval'].includes(ctx.stored.run.status))fail('RUN_NOT_APPROVABLE','Estado da execução não permite aprovação.');}
 async function readRef(ctx,reference,json=true){
  const row=ctx.stored.artifacts.find(a=>a.id===reference.id);if(!row||!equal(ref(row),reference))fail('ARTIFACT_NOT_FOUND','Artefato não encontrado neste escopo e versão.');
  const bytes=await guard.withPaths([row.relative_path],async file=>{try{return await readFile(file);}catch(e){if(e.code==='ENOENT')fail('RESOURCE_MISSING','Artefato gerenciado indisponível.');throw e;}});
  if(createHash('sha256').update(bytes).digest('hex')!==row.hash||bytes.length!==JSON.parse(row.metadata_json).size)fail('ARTIFACT_HASH_MISMATCH','Bytes do artefato divergem da identidade registrada.');
  if(!json)return bytes;try{return JSON.parse(bytes.toString('utf8'));}catch{fail('ARTIFACT_HASH_MISMATCH','Documento gerenciado inválido.');}
 }
 async function context(r){
  scope(r);verifySchema(db);const stored=capture(r);if(!stored.run)fail('RUN_NOT_FOUND','Execução não encontrada.');const snapshot=JSON.parse(stored.run.snapshot_json);if(canonicalHash(snapshot)!==stored.run.snapshot_hash)fail('SNAPSHOT_HASH_MISMATCH','Snapshot não corresponde à identidade registrada.');
  const ctx={request:{brandId:r.brandId,runId:r.runId},stored,snapshot,contract:getRunContract(snapshot)};ctx.saved=await inputs.get(r.brandId,r.runId);if(!ctx.saved?.inputsComplete)fail('INPUTS_REQUIRED','Entradas completas são necessárias para aprovação.');
  ctx.carousel=await readRef(ctx,ctx.saved.artifacts.carousel);ctx.concept=(await readRef(ctx,ctx.saved.artifacts.concept,false)).toString('utf8');ctx.plan=ctx.saved.artifacts.plan?await readRef(ctx,ctx.saved.artifacts.plan):null;
  const qualifications=ctx.plan?[...new Map(ctx.plan.slides.map(s=>[s.qualificationRef.id,s.qualificationRef])).values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0):[];
  ctx.fingerprints=buildInputFingerprints({contractVersion:ctx.contract.contractVersion,...ctx.request,snapshotHash:stored.run.snapshot_hash,executable:ctx.saved.executable,carousel:ctx.carousel,conceptHash:ctx.saved.artifacts.concept.sha256,assets:ctx.saved.artifacts.assets.map(a=>({id:a.assetKey,sha256:a.sha256})),...(ctx.plan?{planRef:ctx.saved.artifacts.plan,qualificationRefs:qualifications,selection:ctx.plan.previewSelection,riskInventory:ctx.plan.riskInventory,fontBindings:snapshot.fontBindings,fonts:snapshot.fonts,renderer:snapshot.renderer}:{})});
  if(!equal(ctx.fingerprints,ctx.saved.fingerprints)||stored.steps.find(s=>s.step_key==='inputs')?.fingerprint!==ctx.fingerprints.inputs||stored.steps.find(s=>s.step_key==='inputs')?.status!=='succeeded')throw approvalStale();
  unchanged(ctx);return ctx;
 }
 async function objectFor(ctx,kind){const stage=approvalStage(kind),s=ctx.saved;
  if(kind==='copy')return {objectFingerprint:ctx.fingerprints[stage],objectArtifactRef:s.artifacts.carousel,object:{copy:approvalCopy(ctx.carousel)}};
  if(kind==='concept')return {objectFingerprint:ctx.fingerprints[stage],objectArtifactRef:s.artifacts.concept,object:{copyFingerprint:ctx.fingerprints['copy-approval'],concept:ctx.concept,visual:approvalVisual(ctx.carousel)}};
  if(kind==='creative-assets'){const row=ctx.stored.artifacts.find(a=>a.id===s.id);return {objectFingerprint:ctx.fingerprints[stage],objectArtifactRef:ref(row),object:{conceptFingerprint:ctx.fingerprints['concept-approval'],assets:s.artifacts.assets}};}
  const latest=kind=>ctx.stored.artifacts.filter(a=>a.kind===kind).sort((a,b)=>b.version-a.version)[0];
  const manifestRow=latest('render-manifest:preview');if(!manifestRow)fail('PREVIEW_REQUIRED','Amostra vigente é necessária antes do consentimento.');
  const manifestRef=ref(manifestRow),manifest=validateRenderManifest(await readRef(ctx,manifestRef));
  const renderStage=ctx.stored.steps.find(s=>s.step_key==='preview-render'),attempt=ctx.stored.step_attempts.filter(a=>a.step_id===renderStage?.id).sort((a,b)=>b.attempt_number-a.attempt_number)[0];
  const inputsRef=ref(ctx.stored.artifacts.find(a=>a.id===s.id));
  if(manifest.id!==manifestRef.id||manifest.version!==manifestRef.version||manifest.brandId!==ctx.request.brandId||manifest.runId!==ctx.request.runId||manifest.kind!=='preview'||manifest.snapshotHash!==ctx.stored.run.snapshot_hash||!equal(manifest.inputsRef,inputsRef)||!equal(manifest.planRef,s.artifacts.plan)||manifest.stageFingerprint!==ctx.fingerprints['preview-render']||renderStage?.status!=='succeeded'||renderStage.fingerprint!==manifest.stageFingerprint||attempt?.status!=='succeeded'||attempt.id!==manifest.renderAttemptId||attempt.result_artifact_id!==manifest.id)fail('QUALITY_EVIDENCE_STALE','Amostra não corresponde à execução, entradas e tentativa atuais.');
  for(const file of manifest.files){const bytes=await readRef(ctx,file.artifactRef,false);if(bytes.length!==file.size)fail('QUALITY_EVIDENCE_STALE','Tamanho de imagem diverge do manifesto.');}
  await readRef(ctx,manifest.metricsRef);
  const copy=verified(ctx,'copy'),concept=verified(ctx,'concept');
  if(manifest.upstream.copyApprovalId!==copy.id||manifest.upstream.conceptApprovalId!==concept.id)fail('QUALITY_EVIDENCE_STALE','Amostra não corresponde aos consentimentos atuais.');
  await readRef(ctx,manifest.upstream.assetsEvidenceRef);
  const reviewRow=latest('quality-review:preview');if(!reviewRow)fail('EDITORIAL_REVIEW_REQUIRED','Amostra precisa de parecer editorial antes do consentimento.');
  const reviewRef=ref(reviewRow),review=validateQualityReview(await readRef(ctx,reviewRef));
  if(review.id!==reviewRef.id||review.version!==reviewRef.version)fail('QUALITY_EVIDENCE_STALE','Parecer não corresponde ao registro persistido.');
  const objectiveReport=await readRef(ctx,review.objectiveReportRef);
  const proof=verifyQualityEvidence({review,manifest,objectiveReport,snapshot:ctx.snapshot,plan:ctx.plan,expected:{...ctx.request,kind:'preview',renderAttemptId:attempt.id,manifestRef,objectiveReportRef:review.objectiveReportRef}});
  if(objectiveReport.result==='failed')fail('QUALITY_CHECK_FAILED','Amostra reprovada nos controles objetivos.');
  if(review.verdict==='failed')fail('QUALITY_REVIEW_FAILED','Amostra reprovada no parecer editorial.');
  if(objectiveReport.result!=='passed'||review.verdict!=='passed'||!proof.coverageComplete)fail('QUALITY_EVIDENCE_INCOMPLETE','Amostra exige evidência completa de revisão.');
  const reviewFingerprint=fingerprintStage({contractVersion:2,...ctx.request,snapshotHash:ctx.stored.run.snapshot_hash,executable:s.executable,stage:'preview-review',inputs:{manifestRef,renderAttemptId:manifest.renderAttemptId,files:manifest.files,metricsRef:manifest.metricsRef,objectiveReportRef:review.objectiveReportRef,rubricRef:review.rubricRef,checkerRefs:review.checkerRefs}}),reviewStage=ctx.stored.steps.find(s=>s.step_key==='preview-review');
  if(reviewStage?.status!=='succeeded'||reviewStage.fingerprint!==reviewFingerprint)fail('QUALITY_EVIDENCE_STALE','Etapa de revisão não corresponde à amostra e ao parecer.');
  ctx.reviewEvidence={review,reviewRef,manifestRef};trustedReview(ctx);
  const object={manifestRef,reviewRef,planRef:manifest.planRef,selection:manifest.selection,selectionHash:manifest.selectionHash,files:manifest.files};
  const objectFingerprint=fingerprintStage({contractVersion:2,...ctx.request,snapshotHash:ctx.stored.run.snapshot_hash,executable:s.executable,stage:'preview-approval',inputs:{reviewRef,manifestRef,planHash:manifest.planRef.sha256,selectionHash:manifest.selectionHash}});
  ctx.fingerprints['preview-approval']=objectFingerprint;unchanged(ctx);return {objectFingerprint,objectArtifactRef:manifestRef,object};
 }
 function trustedReview(ctx){
  if(!ctx.reviewEvidence)return;
  // Only a trusted in-process Q05 dependency may supply this DB-only guard. It
  // is not data in an approval request, and a declared human/boolean is no proof.
  if(typeof verifyReviewReceipt!=='function')fail('QUALITY_REVIEW_VERIFICATION_UNAVAILABLE','Verificação confiável do recibo editorial ainda indisponível.');
  if(['AsyncFunction','AsyncGeneratorFunction','GeneratorFunction'].includes(verifyReviewReceipt.constructor?.name))throw invalidArgument('Verificador de recibo precisa ser síncrono.');
  const result=verifyReviewReceipt({...ctx.reviewEvidence,db});if(result?.then)throw invalidArgument('Verificador de recibo precisa ser síncrono.');
 }
 function record(row){return {id:row.id,brandId:row.brand_id,runId:row.run_id,kind:row.kind,objectFingerprint:row.object_fingerprint,objectArtifactRef:JSON.parse(row.evidence_json).proposal.objectArtifactRef,decision:row.decision,confirmationRequestId:row.confirmation_request_id,decidedAt:row.decided_at,evidence:JSON.parse(row.evidence_json)};}
 function verified(ctx,kind,selected=null){
  const fingerprint=ctx.fingerprints[approvalStage(kind)],row=selected??[...ctx.stored.approvals].reverse().find(a=>a.kind===kind&&a.object_fingerprint===fingerprint&&a.decision==='approved');if(!row)throw approvalRequired();
  let result,p,e;try{result=record(row);e=result.evidence;p=validateApprovalProposal(e.proposal);}catch{throw approvalRequired();}
  const request=ctx.stored.confirmation_requests.find(r=>r.id===row.confirmation_request_id),stage=ctx.stored.steps.find(s=>s.step_key===approvalStage(kind));
  if(e.schemaVersion!==1||e.channel!=='local-terminal'||e.decision!==row.decision||e.confirmedAt!==row.decided_at||e.proposalHash!==canonicalHash({proposal:p,decision:row.decision})||p.brandId!==row.brand_id||p.runId!==row.run_id||p.kind!==row.kind||p.objectFingerprint!==row.object_fingerprint||p.confirmationRequestId!==row.confirmation_request_id||p.objectArtifactRef.id!==row.object_artifact_id||request?.status!==(row.decision==='approved'?'confirmed':'rejected')||request.kind!==kind||request.object_fingerprint!==fingerprint||request.object_artifact_id!==row.object_artifact_id||request.resolved_at!==row.decided_at||stage?.status!==(row.decision==='approved'?'succeeded':'failed')||stage.fingerprint!==fingerprint)throw approvalRequired();
  try{validateIdentifier(e.receiptId);}catch{throw approvalRequired();}
  const operation=db.prepare('SELECT * FROM operations WHERE request_id=?').get(e.operationRequestId);
  if(!operation||operation.operation!=='run.approval.decide'||operation.brand_id!==p.brandId||operation.run_id!==p.runId||operation.payload_hash!==canonicalHash({operation:'run.approval.decide',brandId:p.brandId,runId:p.runId,payload:{proposal:p,decision:row.decision}})||!equal(JSON.parse(operation.result_json),result))throw approvalRequired();
  return result;
 }
 function predecessors(ctx,kind){
  trustedReview(ctx);
  if(kind!=='copy')verified(ctx,'copy');if(['creative-assets','preview'].includes(kind))verified(ctx,'concept');
  if(kind==='preview'){if(ctx.saved.creativeAssets==='not-applicable'){const stage=ctx.stored.steps.find(s=>s.step_key==='assets-approval');if(stage?.status!=='succeeded'||stage.fingerprint!==ctx.fingerprints['assets-approval'])throw approvalRequired();}else verified(ctx,'creative-assets');}
 }
 function pendingRequest(row){if(!row||row.status!=='pending'||row.expires_at!==null&&(!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=Date.now()))throw approvalStale();}
 function putStage(ctx,key,status,fingerprint){db.prepare('INSERT INTO steps(id,brand_id,run_id,step_key,status,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT(brand_id,run_id,step_key) DO UPDATE SET status=excluded.status,fingerprint=excluded.fingerprint').run(randomUUID(),ctx.request.brandId,ctx.request.runId,key,status,fingerprint);}
 const nextStage=(ctx,key)=>{const stages=getStages({pipelineVersion:ctx.contract.pipelineVersion});return stages[stages.findIndex(s=>s.key===key)+1]?.key??null;};
 function proposal(ctx,row,object){return {schemaVersion:1,...ctx.request,kind:row.kind,confirmationRequestId:row.id,runVersion:ctx.stored.run.version,...object};}
 async function request(input){
  const r=clone(input);exactKeys(r,['requestId','brandId','runId','kind']);scope(r);const key=approvalStage(r.kind),ctx=await context(r),object=await objectFor(ctx,r.kind);writable(ctx);predecessors(ctx,r.kind);
  const operation={requestId:r.requestId,...ctx.request,operation:'run.approval.request',payload:{kind:r.kind}};
  return runOperation(db,operation,({emit})=>{
   unchanged(ctx);writable(ctx);predecessors(ctx,r.kind);
   const stage=ctx.stored.steps.find(s=>s.step_key===key);
   if(stage?.status==='succeeded'){if(r.kind==='creative-assets'&&ctx.saved.creativeAssets==='not-applicable')return {status:'committed',result:{status:'not-applicable',kind:r.kind,...ctx.request,objectFingerprint:object.objectFingerprint}};return {status:'committed',result:{status:'approved',approval:verified(ctx,r.kind)}};}
   if(ctx.stored.run.current_step!==key||stage&&!['pending','waiting-approval'].includes(stage.status))throw approvalRequired();
   if(r.kind==='creative-assets'&&ctx.saved.creativeAssets==='not-applicable'){
    if(ctx.carousel.assets.length||ctx.saved.artifacts.assets.length)throw approvalStale();putStage(ctx,key,'succeeded',object.objectFingerprint);db.prepare("UPDATE runs SET status='ready',version=version+1,current_step=? WHERE brand_id=? AND id=?").run(nextStage(ctx,key),r.brandId,r.runId);emit({id:randomUUID(),eventType:'assets.not-applicable'});return {status:'committed',result:{status:'not-applicable',kind:r.kind,...ctx.request,objectFingerprint:object.objectFingerprint}};
   }
   const existing=ctx.stored.confirmation_requests.find(q=>q.kind===r.kind&&q.status==='pending');if(existing){pendingRequest(existing);if(existing.object_fingerprint!==object.objectFingerprint||existing.object_artifact_id!==object.objectArtifactRef.id)throw approvalStale();return {status:'committed',result:{status:'pending',proposal:proposal(ctx,existing,object)}};}
   if(ctx.stored.run.status!=='ready')throw approvalStale();
   const id=randomUUID();db.prepare('INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,object_artifact_id) VALUES(?,?,?,?,?,?)').run(id,r.brandId,r.runId,r.kind,object.objectFingerprint,object.objectArtifactRef.id);
   putStage(ctx,key,'waiting-approval',object.objectFingerprint);db.prepare('UPDATE runs SET status=?,version=version+1,current_step=? WHERE brand_id=? AND id=?').run(transitionRun(ctx.stored.run.status,{type:'approval-required'}),key,r.brandId,r.runId);emit({id:randomUUID(),eventType:'approval.requested'});
   const p=proposal(ctx,{id,kind:r.kind},object);p.runVersion++;return {status:'committed',result:{status:'pending',proposal:p}};
  });
 }
 async function get(input){const r=clone(input);exactKeys(r,['brandId','runId','confirmationRequestId']);validateIdentifier(r.confirmationRequestId);const ctx=await context(r),row=ctx.stored.confirmation_requests.find(q=>q.id===r.confirmationRequestId);if(!row)fail('APPROVAL_NOT_FOUND','Pedido não encontrado nesta execução.');const object=await objectFor(ctx,row.kind);if(row.object_fingerprint!==object.objectFingerprint||row.object_artifact_id!==object.objectArtifactRef.id)throw approvalStale();const decision=ctx.stored.approvals.find(a=>a.confirmation_request_id===row.id);return decision?{status:row.status,approval:verified(ctx,row.kind,decision)}:{status:row.status,proposal:proposal(ctx,row,object)};}
 async function decide(input,receipt){
  const r=clone(input);exactKeys(r,['requestId','proposal','decision']);const p=validateApprovalProposal(r.proposal);approvalDecision(r.decision);
  const operation={requestId:r.requestId,brandId:p.brandId,runId:p.runId,operation:'run.approval.decide',payload:{proposal:p,decision:r.decision}};
  // Exact retry after a committed decision does not need the consumed capability.
  const previous=db.prepare('SELECT request_id FROM operations WHERE request_id=?').get(r.requestId);
  if(previous){
   const result=runOperation(db,operation,()=>{throw approvalRequired();}),ctx=await context(p);
   if(p.kind==='preview')await objectFor(ctx,p.kind);
   const row=ctx.stored.approvals.find(a=>a.id===result.id);if(!row||!equal(verified(ctx,p.kind,row),result))throw approvalStale();
   await readRef(ctx,p.objectArtifactRef,false);unchanged(ctx);return result;
  }
  const ctx=await context(p),object=await objectFor(ctx,p.kind);writable(ctx);predecessors(ctx,p.kind);
  const request=ctx.stored.confirmation_requests.find(q=>q.id===p.confirmationRequestId);if(!request||request.status!=='pending'||request.kind!==p.kind||request.object_fingerprint!==object.objectFingerprint||request.object_artifact_id!==object.objectArtifactRef.id||!equal(p,proposal(ctx,request,object)))throw approvalStale();
  pendingRequest(request);const evidence=requireApprovalConfirmation(receipt,p,r.decision);let committedState;
  const result=runOperation(db,operation,({emit})=>{
   unchanged(ctx);writable(ctx);predecessors(ctx,p.kind);pendingRequest(request);requireApprovalConfirmation(receipt,p,r.decision);
   const key=approvalStage(p.kind),storedStage=ctx.stored.steps.find(s=>s.step_key===key);if(ctx.stored.run.current_step!==key||storedStage?.status!=='waiting-approval'||storedStage.fingerprint!==p.objectFingerprint)throw approvalStale();
   const result={id:randomUUID(),...ctx.request,kind:p.kind,objectFingerprint:p.objectFingerprint,objectArtifactRef:p.objectArtifactRef,decision:r.decision,confirmationRequestId:p.confirmationRequestId,decidedAt:evidence.confirmedAt,evidence:{schemaVersion:1,channel:evidence.channel,receiptId:evidence.id,proposalHash:evidence.proposalHash,decision:r.decision,confirmedAt:evidence.confirmedAt,operationRequestId:r.requestId,proposal:p}};
   db.prepare('INSERT INTO approvals(id,brand_id,run_id,kind,object_fingerprint,object_artifact_id,decision,confirmation_request_id,evidence_json,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(result.id,p.brandId,p.runId,p.kind,p.objectFingerprint,p.objectArtifactRef.id,r.decision,p.confirmationRequestId,canonicalJson(result.evidence),evidence.confirmedAt);
   db.prepare('UPDATE confirmation_requests SET status=?,resolved_at=? WHERE id=? AND brand_id=? AND run_id=?').run(r.decision==='approved'?'confirmed':'rejected',evidence.confirmedAt,p.confirmationRequestId,p.brandId,p.runId);
   putStage(ctx,key,r.decision==='approved'?'succeeded':'failed',p.objectFingerprint);db.prepare('UPDATE runs SET status=?,version=version+1,current_step=? WHERE brand_id=? AND id=?').run(transitionRun(ctx.stored.run.status,{type:r.decision==='approved'?'approval-granted':'approval-rejected'}),r.decision==='approved'?nextStage(ctx,key):key,p.brandId,p.runId);emit({id:randomUUID(),eventType:r.decision==='approved'?'approval.granted':'approval.rejected'});
   committedState=capture(ctx.request);const hooked=hooks.beforeCommit?.();if(hooked?.then)throw invalidArgument('Hook precisa ser síncrono.');return {status:'committed',result};
  },{beforeCommit:()=>{pendingRequest(request);trustedReview(ctx);if(!equal(capture(ctx.request),committedState))throw approvalStale();}});
  consumeApprovalConfirmation(receipt);return result;
 }
 async function verify(input){const r=clone(input);exactKeys(r,['brandId','runId','kind']);approvalStage(r.kind);const ctx=await context(r);if(r.kind==='preview')await objectFor(ctx,r.kind);const result=verified(ctx,r.kind);await readRef(ctx,result.objectArtifactRef,false);unchanged(ctx);return result;}
 return Object.freeze({request,get,decide,verify});
}
