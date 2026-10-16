import {readFile} from 'node:fs/promises';
import {createApprovals} from './approvals.mjs';
import {createRunInputs} from './run-inputs.mjs';
import {verifySchema} from '../infrastructure/sqlite/migrations.mjs';
import {canonicalHash,canonicalJson} from '../domain/canonical-json.mjs';
import {validateIdentifier} from '../domain/identifiers.mjs';
import {exactKeys} from '../domain/brand-schema.mjs';
import {getStages,projectStages,firstPendingStage} from '../domain/stage-graph.mjs';
import {getRunContract} from '../domain/run-snapshot.mjs';
import {isTerminalRun} from '../domain/run-state-machine.mjs';
import {PublicError} from '../domain/errors.mjs';

const fail=(code,message)=>{throw new PublicError(code,message);};
const action=(type,requires=[])=>({type,available:requires.length===0,requires});
/** T13 is a read model, not an executor. No event, approval, callback or arbitrary
 * target state can be submitted. resume is intentionally the same query as get.
 * Leases, consent, invalidation, controls and execution remain separate services.
 */
export async function createRunRuntime({root,db}){
 const inputs=await createRunInputs({root,db}),approvalService=await createApprovals({root,db});
 function capture(brandId,runId){
  return db.transaction(()=>({
   run:db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(brandId,runId)??null,
   brand:db.prepare('SELECT status FROM brands WHERE id=?').get(brandId)??null,
   steps:db.prepare('SELECT * FROM steps WHERE brand_id=? AND run_id=? ORDER BY step_key').all(brandId,runId),
   attempts:db.prepare('SELECT * FROM step_attempts WHERE brand_id=? AND run_id=? ORDER BY step_id,attempt_number').all(brandId,runId),
   approvals:db.prepare('SELECT * FROM approvals WHERE brand_id=? AND run_id=? ORDER BY id').all(brandId,runId),
   artifacts:db.prepare('SELECT * FROM artifacts WHERE brand_id=? AND run_id=? ORDER BY kind,version').all(brandId,runId),
  })).deferred();
 }
 async function get(input){
  const request=JSON.parse(canonicalJson(input));exactKeys(request,['brandId','runId']);
  const {brandId,runId}=request;validateIdentifier(brandId);validateIdentifier(runId);verifySchema(db);
  const stored=capture(brandId,runId),{run}=stored;if(!run)fail('RUN_NOT_FOUND','Execução não encontrada.');
  const snapshot=JSON.parse(run.snapshot_json),contract=getRunContract(snapshot),graphOptions={pipelineVersion:contract.pipelineVersion},keys=getStages(graphOptions).map(stage=>stage.key);
  const diagnostics=[];
  const diagnose=code=>{if(!diagnostics.some(d=>d.code===code))diagnostics.push({code});};
  const inconsistent=()=>diagnose('RUN_STATE_INCONSISTENT');
  let stages;
  try{stages=projectStages(stored.steps.map(s=>({key:s.step_key,status:s.status,fingerprint:s.fingerprint})),graphOptions);}
  catch(error){if(error.code!=='RUN_STATE_INCONSISTENT')throw error;inconsistent();stages=projectStages([],graphOptions);}
  if(canonicalHash(JSON.parse(run.snapshot_json))!==run.snapshot_hash)diagnose('SNAPSHOT_HASH_MISMATCH');
  if(run.current_step!==null&&!keys.includes(run.current_step))inconsistent();
  let saved=null;
  try{saved=await inputs.get(brandId,runId);}
  catch(error){if(!(error instanceof PublicError))throw error;diagnose(error.code);}
  const inputStage=stages[0],terminal=isTerminalRun(run.status);
  if(saved){
   if(saved.snapshotHash!==run.snapshot_hash||inputStage.fingerprint!==saved.fingerprints.inputs||inputStage.status!==(saved.inputsComplete?'succeeded':'pending'))inconsistent();
   if(!terminal&&(run.status==='draft')===saved.inputsComplete)inconsistent();
   for(const stage of stages)if(stage.status==='succeeded'&&saved.fingerprints[stage.key]&&stage.fingerprint!==saved.fingerprints[stage.key])inconsistent();
  }else if(!terminal&&(run.status!=='draft'||inputStage.status!=='pending'))inconsistent();
  let unmet=false;
  for(const stage of stages){
   if(unmet&&!['pending','invalidated'].includes(stage.status))inconsistent();
   if(stage.status!=='succeeded')unmet=true;
   const absentAssets=stage.key==='assets-approval'&&saved?.inputsComplete&&saved.creativeAssets==='not-applicable'&&stage.fingerprint===saved.fingerprints[stage.key];
   if(stage.kind==='approval'&&stage.status==='succeeded'&&!absentAssets){
    // T15 verifies persisted gateway provenance. Legacy/imported flags remain
    // unverified; reading does not grant consent or implement the Q05 gate.
    const kind=({'copy-approval':'copy','concept-approval':'concept','assets-approval':'creative-assets','preview-approval':'preview'})[stage.key];
    try{await approvalService.verify({brandId,runId,kind});}
    catch(error){if(!(error instanceof PublicError))throw error;diagnose('APPROVAL_VERIFICATION_UNAVAILABLE');}
    if(!stored.approvals.some(a=>a.decision==='approved'&&a.object_fingerprint===stage.fingerprint))inconsistent();
   }
  }
  const byStep=new Map(stored.steps.map(s=>[s.id,s])),attempts=stored.attempts.map(a=>({
   id:a.id,step:byStep.get(a.step_id)?.step_key??null,number:a.attempt_number,status:a.status,
   executor:a.executor,fencingToken:a.fencing_token,startedAt:a.started_at,finishedAt:a.finished_at,
   resultArtifactId:a.result_artifact_id,errorCode:a.error_code,
  })).sort((a,b)=>keys.indexOf(a.step)-keys.indexOf(b.step)||a.number-b.number);
  const active=attempts.filter(a=>a.status==='running');
  for(const a of attempts)if(!keys.includes(a.step)||stages.find(s=>s.key===a.step)?.kind!=='execution'||(a.status==='running')!==(a.finishedAt===null))inconsistent();
  if(run.status==='running'){
   if(active.length!==1||active[0]?.step!==run.current_step||run.lease_owner!==active[0]?.executor||run.fencing_token!==active[0]?.fencingToken||stages.find(s=>s.key===run.current_step)?.status!=='running')inconsistent();
  }else if(active.length||run.lease_owner!==null)inconsistent();
  const results=[];let packageBytesVerified=false;
  for(const stage of stages.filter(s=>s.status==='succeeded')){
   if(stage.kind==='execution')diagnose('RESULT_VERIFICATION_UNAVAILABLE');
   if(stage.kind==='review')diagnose('QUALITY_REVIEW_VERIFICATION_UNAVAILABLE');
   const latest=attempts.filter(a=>a.step===stage.key).at(-1);
   if(!latest||latest.status!=='succeeded'||!latest.resultArtifactId){if(stage.kind==='execution')inconsistent();continue;}
   try{
    const result=await inputs.resolveArtifact(brandId,runId,latest.resultArtifactId);
    if(stage.key==='package'&&result.kind==='package')packageBytesVerified=true;
    results.push({id:result.id,kind:result.kind,version:result.version,sha256:result.sha256,size:result.size,integrity:'verified-bytes'});
   }catch(error){if(!(error instanceof PublicError))throw error;diagnose(error.code);}
  }
  const nextStage=firstPendingStage(stages,graphOptions);
  if(run.status==='completed'&&(nextStage!==null||!packageBytesVerified))inconsistent();
  if(!terminal&&run.current_step!==null&&run.current_step!==nextStage)inconsistent();
  if(!terminal&&nextStage===null)inconsistent();
  if(run.status==='waiting-approval'&&(!['approval','review'].includes(stages.find(s=>s.key===nextStage)?.kind)||stages.find(s=>s.key===nextStage)?.status!=='waiting-approval'))inconsistent();
  if(stored.brand?.status!=='active')diagnose('BRAND_ARCHIVED');
  const editable=['draft','ready'].includes(run.status)&&run.lease_owner===null&&!active.length&&!stored.approvals.length&&stored.steps.every(s=>s.step_key==='inputs'||s.status==='pending');
  let pending=null,nextAction;
  if(run.status==='completed')nextAction=action('inspect-results');
  else if(run.status==='cancelled')nextAction=action('derive-run',stored.brand?.status==='active'?[]:['active-brand']);
  else{
   pending={stage:nextStage,code:'STAGE_PENDING'};
   if(diagnostics.some(d=>!['APPROVAL_VERIFICATION_UNAVAILABLE','RESULT_VERIFICATION_UNAVAILABLE','QUALITY_REVIEW_VERIFICATION_UNAVAILABLE'].includes(d.code))){pending.code='RUN_STATE_INCONSISTENT';nextAction=action('inspect-run');}
   else if(run.status==='interrupted'){pending.code='RECONCILIATION_REQUIRED';nextAction=action('reconcile-run',['T14','T23']);}
   else if(run.status==='blocked'){pending.code='CORRECTION_REQUIRED';nextAction=action('correct-run',['T16']);}
   else if(run.status==='running'){pending.code='ATTEMPT_RUNNING';nextAction=action('inspect-attempt');}
   else if(nextStage==='inputs'){
    Object.assign(pending,{code:'INPUTS_REQUIRED',missing:saved?.missing??['carousel','concept'],issues:saved?.issues??[]});
    nextAction=action('edit-inputs',editable?[]:['T16']);
   }else if(stages.find(s=>s.key===nextStage)?.kind==='review'){pending.code='EDITORIAL_REVIEW_REQUIRED';nextAction=action('request-quality-review',['Q05','T15']);}
   else if(stages.find(s=>s.key===nextStage)?.kind==='approval'){pending.code=nextStage==='preview-approval'?'PREVIEW_APPROVAL_REQUIRED':'APPROVAL_REQUIRED';nextAction=nextStage!=='preview-approval'&&diagnostics.some(d=>d.code==='APPROVAL_VERIFICATION_UNAVAILABLE')?action('inspect-run'):action('request-approval',nextStage==='preview-approval'?['Q05']:[]);}
   else{pending.code='EXECUTION_UNAVAILABLE';nextAction=action('resume-stage',['T14','T15',...({render:['T18','T20'],validate:['T21'],package:['T22']}[nextStage]??['T23'])]);}
  }
  const quality={policyVersion:contract.qualityPolicyVersion,status:contract.contractVersion===1?'not-evaluated':'pending',preview:null,final:null};
  if(contract.contractVersion===2){
   const {validateQualityReview,validateRenderManifest,verifyQualityEvidence}=await import('../domain/quality-evidence.mjs');
   // Q04 can prove structural links and managed byte integrity. Trusted human
   // receipts and the complete production gate belong to Q05/T15; never infer a
   // quality pass from stored status, imported JSON, or an approved=true field.
   const readRef=async ref=>{
    const file=await inputs.resolveArtifact(brandId,runId,ref.id);
    if(file.kind!==ref.kind||file.version!==ref.version||file.sha256!==ref.sha256)fail('QUALITY_EVIDENCE_STALE','Referência de qualidade não corresponde aos bytes registrados.');
    return JSON.parse(await readFile(file.path,'utf8'));
   };
   const artifactRef=row=>({id:row.id,kind:row.kind,version:row.version,sha256:row.hash});
   let previewManifest=null;
   for(const kind of ['preview','final']){
    const manifestRow=stored.artifacts.filter(a=>a.kind===`render-manifest:${kind}`).at(-1),reviewRow=stored.artifacts.filter(a=>a.kind===`quality-review:${kind}`).at(-1);
    if(!manifestRow&&!reviewRow)continue;
    const value={status:'pending',manifestRef:manifestRow?artifactRef(manifestRow):null,reviewRef:reviewRow?artifactRef(reviewRow):null,humanReceiptVerified:false};quality[kind]=value;
    try{
     if(!manifestRow)fail('QUALITY_EVIDENCE_INCOMPLETE','Manifesto de qualidade ausente.');
     const manifest=validateRenderManifest(await readRef(value.manifestRef));
     const stage=kind==='preview'?'preview-render':'render',attempt=attempts.filter(a=>a.step===stage).at(-1);
     if(manifest.brandId!==brandId||manifest.runId!==runId||manifest.id!==manifestRow.id||manifest.version!==manifestRow.version||manifest.snapshotHash!==run.snapshot_hash||manifest.kind!==kind||!attempt||attempt.id!==manifest.renderAttemptId||attempt.status!=='succeeded'||attempt.resultArtifactId!==manifest.id)fail('QUALITY_EVIDENCE_STALE','Manifesto não corresponde à tentativa atual.');
     const persistedStage=stages.find(value=>value.key===stage),inputsRow=stored.artifacts.filter(a=>a.kind==='inputs').at(-1);
     if(!saved||!inputsRow||!saved.artifacts.plan||canonicalHash(manifest.inputsRef)!==canonicalHash(artifactRef(inputsRow))||canonicalHash(manifest.planRef)!==canonicalHash(saved.artifacts.plan)||manifest.stageFingerprint!==persistedStage?.fingerprint||(kind==='preview'&&manifest.stageFingerprint!==saved.fingerprints['preview-render']))fail('QUALITY_EVIDENCE_STALE','Manifesto não corresponde às entradas, plano e fingerprint atuais.');
     const plan=await readRef(manifest.planRef);
     for(const output of manifest.files){const file=await inputs.resolveArtifact(brandId,runId,output.artifactRef.id);if(file.kind!==output.artifactRef.kind||file.version!==output.artifactRef.version||file.sha256!==output.artifactRef.sha256||file.size!==output.size)fail('QUALITY_EVIDENCE_STALE','Arquivo não corresponde ao manifesto.');}
     await readRef(manifest.metricsRef);
     if(kind==='preview')previewManifest=manifest;
     if(!reviewRow)continue;
     const review=validateQualityReview(await readRef(value.reviewRef));
     if(review.id!==reviewRow.id||review.version!==reviewRow.version)fail('QUALITY_EVIDENCE_STALE','Parecer não corresponde ao registro.');
     const objectiveReport=await readRef(review.objectiveReportRef);
     verifyQualityEvidence({review,manifest,objectiveReport,snapshot,plan,...(kind==='final'?{previewManifest}:{}),expected:{brandId,runId,kind,renderAttemptId:attempt.id,manifestRef:value.manifestRef,objectiveReportRef:review.objectiveReportRef}});
     value.status='blocked';diagnose('QUALITY_REVIEW_VERIFICATION_UNAVAILABLE');
    }catch(error){if(!(error instanceof PublicError)&&!(error instanceof SyntaxError))throw error;value.status='blocked';diagnose(error instanceof PublicError?error.code:'QUALITY_EVIDENCE_INCOMPLETE');}
   }
   if(diagnostics.some(d=>!['APPROVAL_VERIFICATION_UNAVAILABLE','RESULT_VERIFICATION_UNAVAILABLE'].includes(d.code))||run.status==='blocked')quality.status='blocked';
   if(pending){pending.objectId=quality[nextStage==='quality-review'?'final':'preview']?.manifestRef?.id??null;}
   nextAction.objectId=pending?.objectId??null;
   if(diagnostics.some(d=>d.code.startsWith('QUALITY_')&&!d.code.endsWith('_UNAVAILABLE'))&&pending){pending.code='QUALITY_EVIDENCE_INCOMPLETE';nextAction={...action('inspect-run'),objectId:pending.objectId};}
  }else if(db.pragma('user_version',{simple:true})===2&&!terminal){
   pending={stage:nextStage,code:'RUN_DERIVATION_REQUIRED',objectId:null};nextAction={...action('derive-run',stored.brand?.status==='active'?[]:['active-brand']),objectId:null};
  }
  // File hashing happens outside SQLite transactions. Detect intervening changes
  // instead of mixing input versions or presenting a stale run as current.
  if(canonicalHash(capture(brandId,runId))!==canonicalHash(stored))fail('RUN_VERSION_CONFLICT','Execução alterada durante a consulta.');
  return {brandId,runId,status:run.status,version:run.version,currentStep:terminal?run.current_step:nextStage,terminal,stages,attempts,pending,nextAction,diagnostics,results,quality};
 }
 return Object.freeze({get,resume:get});
}
