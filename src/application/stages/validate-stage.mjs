import {randomUUID} from 'node:crypto';
import {readFile,mkdir,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createProductionGate,qualityValidationStageFingerprint as fingerprint} from '../production-gate.mjs';
import {runOperation} from '../operation-runner.mjs';
import {acquireRunLease,assertRunLeaseOwned,renewRunLease,releaseRunLease,commitRunLease,startRunLeaseHeartbeat} from '../run-lease.mjs';
import {validatePreparedSnapshot} from '../../adapters/legacy/validate-adapter.mjs';
import {canonicalHash,canonicalJson,CANONICAL_VERSION} from '../../domain/canonical-json.mjs';
import {exactKeys} from '../../domain/brand-schema.mjs';
import {validateIdentifier} from '../../domain/identifiers.mjs';
import {validateRenderManifest} from '../../domain/quality-evidence.mjs';
import {firstPendingStage,transitionStage,getStages} from '../../domain/stage-graph.mjs';
import {transitionRun} from '../../domain/run-state-machine.mjs';
import {PublicError,invalidArgument} from '../../domain/errors.mjs';
import {DEFAULT_PACKAGE_ROOT,sha256} from '../../infrastructure/resources.mjs';
import {createConfinedRoot} from '../../infrastructure/fs/confined-path.mjs';
import {stageBytes,promoteFile} from '../../infrastructure/fs/atomic-files.mjs';
import {immediateTransaction} from '../../infrastructure/sqlite/maintenance.mjs';
import {systemClock,clockTime} from '../../infrastructure/clock.mjs';

const fail=(code,message)=>{throw new PublicError(code,message);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const clone=value=>JSON.parse(canonicalJson(value));
const sort=rows=>rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
const ref=row=>({id:row.id,kind:row.kind,version:row.version,sha256:row.hash});
const options={pipelineVersion:2};
const reportCode=report=>report.result==='passed'?null:report.result==='failed'?'QUALITY_CHECK_FAILED':'QUALITY_EVIDENCE_INCOMPLETE';

/** Internal execution service. Identity-only request, exact render manifest,
 * no paths, callbacks, reports or approvals from a CLI/plugin caller. Q06 and
 * filesystem verification run outside SQLite; publication is fenced/atomic. */
export async function createValidateStage({root,db,packageRoot=DEFAULT_PACKAGE_ROOT,clock=systemClock,hooks={}}){
 const guard=await createConfinedRoot(root),gate=await createProductionGate({root,db,packageRoot});
 const time=()=>{const value=clockTime(clock);if(value>8640000000000000)throw invalidArgument('Data de execução inválida.');return new Date(value).toISOString();};
 const directory=(scope,id)=>`runs/${scope.brandId}/${scope.runId}/${id}`;
 const events=scope=>db.prepare('SELECT * FROM run_events WHERE brand_id=? AND run_id=? ORDER BY id').all(scope.brandId,scope.runId);
 const capture=scope=>({...gate.capture(scope),events:events(scope)});
 const stable=value=>({...value,run:{...value.run,lease_expires_at:null}});
 const consistent=(actual,expected)=>{if(!same(actual,expected))fail('RUN_STATE_INCONSISTENT','Estado da validação foi alterado durante a tentativa.');};
 async function inventory(ctx,attemptId,references){
  const prefix=directory(ctx.scope,attemptId),expected=references.map(r=>`${r.id}.bin`).sort();
  const rows=ctx.stored.artifacts.filter(a=>a.relative_path.startsWith(`${prefix}/`));
  if(!same(rows.map(a=>a.relative_path.slice(prefix.length+1)).sort(),expected))fail('VALIDATE_OUTPUT_INVALID','Inventário da tentativa diverge das saídas esperadas.');
  let names;try{names=await guard.withPaths([prefix],p=>readdir(p));}catch(e){if(e.code==='ENOENT')fail('RESOURCE_MISSING','Diretório da tentativa está ausente.');throw e;}
  if(!same(names.sort(),expected))fail('VALIDATE_OUTPUT_INVALID','Diretório da tentativa contém saída ausente ou inesperada.');
  for(const reference of references){
   const relative=`${prefix}/${reference.id}.bin`,row=rows.find(a=>a.id===reference.id);
   if(!row||!same(ref(row),reference)||row.relative_path!==relative)fail('QUALITY_EVIDENCE_STALE','Saída não pertence à tentativa exata.');
   const stat=await guard.withPaths([relative],p=>lstat(p));
   if(!stat.isFile()||stat.nlink!==1)fail('PATH_NOT_CONFINED','Saída da tentativa possui vínculo externo.');
   await gate.readRef(ctx,reference,false);
  }
 }
 const renderRefs=ctx=>[ctx.manifestRef,ctx.manifest.metricsRef,...ctx.manifest.files.map(f=>f.artifactRef)];
 async function inspect(scope,manifestId){
  try{const ctx=await gate.inspectRendered({...scope,kind:'final',manifestId});await inventory(ctx,ctx.manifest.renderAttemptId,renderRefs(ctx));gate.unchanged(ctx);return ctx;}
  catch(error){if(error instanceof PublicError)throw error;fail('VALIDATE_OUTPUT_INVALID','Estrutura das saídas da etapa validate inválida.');}
 }
 function ready(ctx){
  const rows=ctx.stored.steps.map(s=>({key:s.step_key,status:s.status,fingerprint:s.fingerprint}));
  if(ctx.run.status!=='ready'||ctx.run.current_step!=='validate'||firstPendingStage(rows,options)!=='validate')fail('RUN_NOT_EXECUTABLE','Validate não é a pendência atual da execução.');
  if(ctx.stored.step_attempts.some(a=>a.status==='running')||ctx.stored.steps.some(s=>s.status==='running'))fail('RUN_STATE_INCONSISTENT','Tentativa anterior exige reconciliação.');
  const keys=getStages(options).map(s=>s.key);if(ctx.stored.steps.some(s=>keys.indexOf(s.step_key)>keys.indexOf('validate')&&!['pending','invalidated'].includes(s.status)))fail('RUN_STATE_INCONSISTENT','Etapa posterior não foi invalidada.');
  if(ctx.run.version>=Number.MAX_SAFE_INTEGER-1)fail('RUN_VERSION_EXHAUSTED','Contador de versão indisponível.');
 }
 async function replay(scope,result,manifestId){
  const ctx={scope,stored:gate.capture(scope)},m=validateRenderManifest(await gate.readRef(ctx,result.manifestRef)),report=await gate.readRef(ctx,result.objectiveReportRef);
  const attempt=ctx.stored.step_attempts.find(a=>a.id===result.attemptId),render=ctx.stored.step_attempts.find(a=>a.id===m.renderAttemptId),step=ctx.stored.steps.find(s=>s.id===attempt?.step_id);
  if(result.brandId!==scope.brandId||result.runId!==scope.runId||result.stage!=='validate'||result.manifestRef.id!==manifestId||m.id!==manifestId||m.kind!=='final'||m.brandId!==scope.brandId||m.runId!==scope.runId||m.version!==result.manifestRef.version||render?.status!=='succeeded'||render.result_artifact_id!==m.id||step?.step_key!=='validate'||attempt?.status!==result.status||attempt.result_artifact_id!==result.objectiveReportRef.id||!same(report.manifestRef,result.manifestRef)||report.renderAttemptId!==m.renderAttemptId||report.brandId!==scope.brandId||report.runId!==scope.runId||report.kind!=='final'||reportCode(report)!==(result.errorCode??null)||result.status!==(report.result==='passed'?'succeeded':'failed'))fail('QUALITY_EVIDENCE_STALE','Resultado confirmado diverge da validação registrada.');
  const run=ctx.stored.run,snapshot=JSON.parse(run.snapshot_json),saved=await gate.readRef(ctx,m.inputsRef);
  if(canonicalHash(snapshot)!==run.snapshot_hash||m.snapshotHash!==run.snapshot_hash||snapshot.contractVersion!==2||saved.schemaVersion!==2||saved.id!==m.inputsRef.id||saved.version!==m.inputsRef.version||saved.brandId!==scope.brandId||saved.runId!==scope.runId||saved.snapshotHash!==m.snapshotHash||!same(saved.artifacts.plan,m.planRef)||!same(report.checkerRefs,snapshot.qualityPolicy.checkerRefs))fail('QUALITY_EVIDENCE_STALE','Identidade histórica da validação inválida.');
  Object.assign(ctx,{run,snapshot,saved,manifest:m,manifestRef:result.manifestRef});if(fingerprint(ctx)!==result.stageFingerprint)fail('QUALITY_EVIDENCE_STALE','Fingerprint histórico da validação divergente.');
  await inventory(ctx,m.renderAttemptId,renderRefs(ctx));await inventory(ctx,result.attemptId,[result.objectiveReportRef]);
  for(const reference of [saved.artifacts.carousel,saved.artifacts.concept,m.planRef,m.upstream.assetsEvidenceRef,m.upstream.previewManifestRef,m.upstream.previewReviewRef,...saved.artifacts.assets.map(({assetKey,...r})=>r)])await gate.readRef(ctx,reference,false);
  gate.unchanged(ctx);return result;
 }
 async function execute(input){
  const r=clone(input);exactKeys(r,['requestId','brandId','runId','manifestId']);validateIdentifier(r.brandId);validateIdentifier(r.runId);validateIdentifier(r.manifestId);
  const scope={brandId:r.brandId,runId:r.runId},operation={requestId:r.requestId,...scope,operation:'run.validate',payload:{manifestId:r.manifestId}};
  const prepare=Symbol('prepare');let previous,replayed=false;
  try{previous=runOperation(db,operation,()=>{throw prepare;},{now:()=>clockTime(clock)});replayed=true;}catch(e){if(e!==prepare)throw e;}
  if(replayed){try{return await replay(scope,previous,r.manifestId);}catch(error){if(error instanceof PublicError)throw error;fail('VALIDATE_OUTPUT_INVALID','Resultado histórico da etapa validate inválido.');}}
  const ctx=await inspect(scope,r.manifestId);ready(ctx);const stageFingerprint=fingerprint(ctx);
  let lease,heartbeat,runningState,started=false;const attemptId=randomUUID(),owner=`validate:${randomUUID()}`;
  try{
   lease=acquireRunLease(db,{...scope,owner,stage:'validate'},{clock});
   immediateTransaction(db,()=>{
    assertRunLeaseOwned(db,lease,{clock});
    const leased={...ctx.stored,run:{...ctx.run,lease_owner:lease.owner,lease_expires_at:lease.expiresAt,fencing_token:lease.fencingToken}};gate.unchanged({...ctx,stored:leased});
    const expected=clone({...leased,events:events(scope)}),prior=expected.steps.find(s=>s.step_key==='validate'),stepId=prior?.id??randomUUID();let status=prior?.status??'pending';
    if(status!=='pending')status=transitionStage('validate',status,{type:'reset'},options);status=transitionStage('validate',status,{type:'start'},options);
    const step={id:stepId,brand_id:scope.brandId,run_id:scope.runId,step_key:'validate',status,fingerprint:stageFingerprint};
    if(prior)Object.assign(prior,step);else expected.steps.push(step);sort(expected.steps);
    const number=Math.max(0,...expected.step_attempts.filter(a=>a.step_id===stepId).map(a=>a.attempt_number))+1,startedAt=time();
    const attempt={id:attemptId,brand_id:scope.brandId,run_id:scope.runId,step_id:stepId,attempt_number:number,executor:lease.owner,fencing_token:lease.fencingToken,started_at:startedAt,finished_at:null,status:'running',result_artifact_id:null,error_code:null};expected.step_attempts.push(attempt);sort(expected.step_attempts);
    Object.assign(expected.run,{status:transitionRun(ctx.run.status,{type:'start'}),current_step:'validate',version:ctx.run.version+1});
    const event={id:randomUUID(),brand_id:scope.brandId,run_id:scope.runId,attempt_id:attemptId,event_type:'validate.started',correlation_id:r.requestId,diagnostic_code:null,created_at:startedAt};expected.events.push(event);sort(expected.events);
    db.prepare('INSERT INTO steps(id,brand_id,run_id,step_key,status,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT(brand_id,run_id,step_key) DO UPDATE SET status=excluded.status,fingerprint=excluded.fingerprint').run(step.id,step.brand_id,step.run_id,step.step_key,step.status,step.fingerprint);
    db.prepare('INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,started_at,status) VALUES(?,?,?,?,?,?,?,?,?)').run(attempt.id,attempt.brand_id,attempt.run_id,attempt.step_id,attempt.attempt_number,attempt.executor,attempt.fencing_token,attempt.started_at,attempt.status);
    db.prepare('UPDATE runs SET status=?,current_step=?,version=version+1 WHERE brand_id=? AND id=?').run(expected.run.status,'validate',scope.brandId,scope.runId);
    db.prepare('INSERT INTO run_events(id,brand_id,run_id,attempt_id,event_type,correlation_id,created_at) VALUES(?,?,?,?,?,?,?)').run(event.id,event.brand_id,event.run_id,event.attempt_id,event.event_type,event.correlation_id,event.created_at);
    consistent(capture(scope),expected);runningState=expected;
   });started=true;heartbeat=startRunLeaseHeartbeat(db,lease,{clock});
   await hooks.beforeValidate?.({attemptId,manifestRef:ctx.manifestRef});
   const report=await validatePreparedSnapshot(ctx),errorCode=reportCode(report),status=errorCode?'failed':'succeeded';
   await hooks.afterValidate?.({attemptId,result:report.result});
   const id=randomUUID(),kind='objective-report:final',version=Math.max(0,...ctx.stored.artifacts.filter(a=>a.kind===kind).map(a=>a.version))+1,reportBytes=Buffer.from(canonicalJson(report));
   const objectiveReportRef={id,kind,version,sha256:sha256(reportBytes)},prefix=directory(scope,attemptId),relativePath=`${prefix}/${id}.bin`;
   await guard.withPaths([prefix],p=>mkdir(path.dirname(p),{recursive:true}));await guard.withPaths([prefix],p=>mkdir(p));
   const staging=await stageBytes(guard,reportBytes);await promoteFile(guard,staging,relativePath);
   await hooks.afterPromotion?.({attemptId,objectiveReportRef,relativePath});
   await hooks.beforeCommit?.({attemptId,manifestRef:ctx.manifestRef,objectiveReportRef});
   heartbeat.stop();lease=renewRunLease(db,lease,{clock});
   const current=await inspect(scope,r.manifestId);consistent(stable({...current.stored,events:events(scope)}),stable(runningState));
   if(fingerprint(current)!==stageFingerprint)fail('QUALITY_EVIDENCE_STALE','Entradas da validação foram alteradas.');
   const artifact={id,brand_id:scope.brandId,run_id:scope.runId,kind,version,hash:objectiveReportRef.sha256,relative_path:relativePath,metadata_json:canonicalJson({size:reportBytes.length})};
   await inventory({...current,stored:{...current.stored,artifacts:[...current.stored.artifacts,artifact]}},attemptId,[objectiveReportRef]);
   const result={...scope,status,stage:'validate',attemptId,stageFingerprint,manifestRef:ctx.manifestRef,objectiveReportRef,...(errorCode?{errorCode}:{}),nextStage:errorCode?'validate':'quality-review',runVersion:current.run.version+1};
   const expectedOperation={request_id:r.requestId,brand_id:scope.brandId,run_id:scope.runId,operation:operation.operation,payload_hash:canonicalHash({operation:operation.operation,...scope,payload:operation.payload}),canonical_version:CANONICAL_VERSION,result_json:canonicalJson(result)};
   const checkOperation=()=>{const {committed_at,...actual}=db.prepare('SELECT * FROM operations WHERE request_id=?').get(r.requestId)??{};if(typeof committed_at!=='string')fail('RUN_STATE_INCONSISTENT','Operação de validação ausente.');consistent(actual,expectedOperation);};
   const published=clone({...current.stored,events:events(scope)}),finishedAt=time(),attempt=published.step_attempts.find(a=>a.id===attemptId),step=published.steps.find(s=>s.step_key==='validate');
   Object.assign(published.run,{status:transitionRun(current.run.status,{type:errorCode?'block':'stage-succeeded'}),current_step:result.nextStage,version:result.runVersion});
   Object.assign(step,{status:transitionStage('validate',step.status,{type:errorCode?'failed':'succeeded'},options)});Object.assign(attempt,{status,finished_at:finishedAt,result_artifact_id:id,error_code:errorCode});published.artifacts.push(artifact);sort(published.artifacts);
   const publicationState=()=>{const value=capture(scope);value.operations=value.operations.filter(o=>o.request_id!==r.requestId);return value;};
   return commitRunLease(db,lease,operation,({emit})=>{
    gate.unchanged(current);consistent(events(scope),runningState.events);
    db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(artifact.id,artifact.brand_id,artifact.run_id,artifact.kind,artifact.version,artifact.hash,artifact.relative_path,artifact.metadata_json);
    db.prepare('UPDATE step_attempts SET status=?,finished_at=?,result_artifact_id=?,error_code=? WHERE id=?').run(status,finishedAt,id,errorCode,attemptId);
    db.prepare('UPDATE steps SET status=? WHERE id=?').run(status,step.id);
    db.prepare('UPDATE runs SET status=?,current_step=?,version=version+1 WHERE brand_id=? AND id=?').run(published.run.status,result.nextStage,scope.brandId,scope.runId);
    const eventId=randomUUID();emit({id:eventId,eventType:`validate.${status}`,attemptId,diagnosticCode:errorCode});const event=db.prepare('SELECT * FROM run_events WHERE id=?').get(eventId);
    const {created_at,...body}=event??{};if(typeof created_at!=='string')fail('RUN_STATE_INCONSISTENT','Evento da validação ausente.');consistent(body,{id:eventId,brand_id:scope.brandId,run_id:scope.runId,attempt_id:attemptId,event_type:`validate.${status}`,correlation_id:r.requestId,diagnostic_code:errorCode});published.events.push(event);sort(published.events);
    const injected=hooks.commit?.();if(injected?.then)throw invalidArgument('Hook de commit precisa ser síncrono.');return {status:'committed',result};
   },{clock,beforeCommit:()=>{checkOperation();consistent(publicationState(),published);},afterRelease:()=>{checkOperation();consistent(publicationState(),{...published,run:{...published.run,lease_owner:null,lease_expires_at:null}});}});
  }catch(error){
   heartbeat?.stop();const problem=error instanceof PublicError?error:new PublicError('VALIDATE_FAILED','Não foi possível confirmar a etapa validate.');
   if(lease)try{
    if(!started)releaseRunLease(db,lease,{clock});
    else {
     const failureOperation={requestId:randomUUID(),...scope,operation:'run.validate.failed',payload:{attemptId,errorCode:problem.code}},result={...scope,stage:'validate',attemptId,status:'failed',errorCode:problem.code};let expected;
     const failureState=()=>{const state=capture(scope);state.operations=state.operations.filter(o=>o.request_id!==failureOperation.requestId);return state;};
     const checkFailureOperation=()=>{const {committed_at,...actual}=db.prepare('SELECT * FROM operations WHERE request_id=?').get(failureOperation.requestId)??{};if(typeof committed_at!=='string')fail('RUN_STATE_INCONSISTENT','Operação da falha ausente.');consistent(actual,{request_id:failureOperation.requestId,brand_id:scope.brandId,run_id:scope.runId,operation:failureOperation.operation,payload_hash:canonicalHash({operation:failureOperation.operation,...scope,payload:failureOperation.payload}),canonical_version:CANONICAL_VERSION,result_json:canonicalJson(result)});};
     commitRunLease(db,lease,failureOperation,({emit})=>{
      expected=capture(scope);const attempt=expected.step_attempts.find(a=>a.id===attemptId),step=expected.steps.find(s=>s.id===attempt?.step_id);
      if(expected.run.status!=='running'||expected.run.current_step!=='validate'||attempt?.status!=='running'||attempt.executor!==lease.owner||attempt.fencing_token!==lease.fencingToken||step?.status!=='running')fail('RUN_STATE_INCONSISTENT','Tentativa já encerrada.');
      const finishedAt=time();Object.assign(expected.run,{status:'blocked',version:expected.run.version+1});Object.assign(step,{status:'failed'});Object.assign(attempt,{status:'failed',finished_at:finishedAt,error_code:problem.code});
      db.prepare("UPDATE step_attempts SET status='failed',finished_at=?,error_code=? WHERE id=?").run(finishedAt,problem.code,attemptId);db.prepare("UPDATE steps SET status='failed' WHERE id=?").run(attempt.step_id);db.prepare("UPDATE runs SET status='blocked',version=version+1 WHERE brand_id=? AND id=?").run(scope.brandId,scope.runId);
      const id=randomUUID();emit({id,eventType:'validate.failed',attemptId,diagnosticCode:problem.code});const event=db.prepare('SELECT * FROM run_events WHERE id=?').get(id),{created_at,...body}=event??{};
      if(typeof created_at!=='string')fail('RUN_STATE_INCONSISTENT','Evento da falha ausente.');consistent(body,{id,brand_id:scope.brandId,run_id:scope.runId,attempt_id:attemptId,event_type:'validate.failed',correlation_id:failureOperation.requestId,diagnostic_code:problem.code});expected.events.push(event);sort(expected.events);return {status:'committed',result};
     },{clock,beforeCommit:()=>{checkFailureOperation();consistent(failureState(),expected);},afterRelease:()=>{checkFailureOperation();consistent(failureState(),{...expected,run:{...expected.run,lease_owner:null,lease_expires_at:null}});}});
    }
   }catch{/* An expired/revoked worker cannot repair the state. T17/T23 own recovery. */}
   throw problem;
  }finally{heartbeat?.stop();}
 }
 return Object.freeze({execute});
}
