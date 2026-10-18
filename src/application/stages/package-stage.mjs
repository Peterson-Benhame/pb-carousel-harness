import {randomUUID} from 'node:crypto';
import {open} from 'node:fs/promises';
import {createProductionGate} from '../production-gate.mjs';
import {runOperation} from '../operation-runner.mjs';
import {acquireRunLease,assertRunLeaseOwned,renewRunLease,releaseRunLease,commitRunLease,startRunLeaseHeartbeat} from '../run-lease.mjs';
import {packageEntries,writeVerifiedPackage,verifyPackageZip,verifyPackageZipHandleSync} from '../../adapters/legacy/package-adapter.mjs';
import {canonicalHash,canonicalJson,CANONICAL_VERSION} from '../../domain/canonical-json.mjs';
import {fingerprintStage} from '../../domain/artifact-fingerprints.mjs';
import {exactKeys} from '../../domain/brand-schema.mjs';
import {validateIdentifier,validateSlug} from '../../domain/identifiers.mjs';
import {firstPendingStage,transitionStage} from '../../domain/stage-graph.mjs';
import {transitionRun} from '../../domain/run-state-machine.mjs';
import {PublicError,invalidArgument} from '../../domain/errors.mjs';
import {DEFAULT_PACKAGE_ROOT} from '../../infrastructure/resources.mjs';
import {createConfinedRoot} from '../../infrastructure/fs/confined-path.mjs';
import {promoteFile} from '../../infrastructure/fs/atomic-files.mjs';
import {immediateTransaction} from '../../infrastructure/sqlite/maintenance.mjs';
import {systemClock,clockTime} from '../../infrastructure/clock.mjs';

const fail=(code,message)=>{throw new PublicError(code,message);};
const clone=value=>JSON.parse(canonicalJson(value));
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const ref=row=>({id:row.id,kind:row.kind,version:row.version,sha256:row.hash});
const options={pipelineVersion:2};
const stable=state=>({...state,run:{...state.run,lease_expires_at:null}});
const ordered=rows=>rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);

/** Trusted package stage. The request chooses identity and a safe output slug;
 * all bytes, reviews and consent come from the existing production gate. */
export async function createPackageStage({root,db,packageRoot=DEFAULT_PACKAGE_ROOT,clock=systemClock,hooks={}}){
 const guard=await createConfinedRoot(root),gate=await createProductionGate({root,db,packageRoot});
 const time=()=>new Date(clockTime(clock)).toISOString();
 const capture=scope=>gate.capture(scope);
 function ready(ctx){
  const rows=ctx.stored.steps.map(s=>({key:s.step_key,status:s.status,fingerprint:s.fingerprint}));
  if(ctx.run.status!=='ready'||ctx.run.current_step!=='package'||firstPendingStage(rows,options)!=='package')fail('RUN_NOT_EXECUTABLE','Package não é a pendência atual da execução.');
  if(ctx.stored.step_attempts.some(a=>a.status==='running')||ctx.stored.steps.some(s=>s.status==='running'))fail('RUN_STATE_INCONSISTENT','Tentativa anterior exige reconciliação.');
  if(ctx.run.version>=Number.MAX_SAFE_INTEGER-1)fail('RUN_VERSION_EXHAUSTED','Contador de versão indisponível.');
 }
 async function inspected(scope,manifestId){
  const authority=await gate.assertProductionGate({...scope,phase:'package',manifestId});
  const view=await gate.inspectRendered({...scope,kind:'final',manifestId});
  if(!same(authority.manifestRef,view.manifestRef))fail('QUALITY_EVIDENCE_STALE','Manifesto final mudou durante o empacotamento.');
  gate.unchanged(view);
  return {...view,authority};
 }
 function inputs(ctx,entries){
  const texts=Object.fromEntries(entries.filter(e=>e.name.endsWith('.txt')).map(e=>[e.name,e.sha256]));
  const allowlist=entries.map(e=>({name:e.name,sha256:e.sha256}));
  const stageFingerprint=fingerprintStage({contractVersion:2,...ctx.scope,snapshotHash:ctx.run.snapshot_hash,executable:ctx.saved.executable,stage:'package',inputs:{manifestRef:ctx.manifestRef,objectiveReportRef:ctx.authority.objectiveReportRef,reviewRef:ctx.authority.reviewRef,texts,qualityPolicy:ctx.snapshot.qualityPolicy,allowlist}});
  return {stageFingerprint,allowlist};
 }
 async function replay(scope,result,manifestId,slug){
  const ctx=await inspected(scope,manifestId),entries=packageEntries(ctx),{stageFingerprint}=inputs(ctx,entries);
  const row=ctx.stored.artifacts.find(a=>a.id===result?.packageRef?.id),step=ctx.stored.steps.find(s=>s.step_key==='package'),attempt=ctx.stored.step_attempts.find(a=>a.id===result?.attemptId);
  const resultKeys=['brandId','runId','stage','status','attemptId','stageFingerprint','manifestRef','packageRef','slug','members','runVersion'];
  const latest=ctx.stored.step_attempts.filter(a=>a.step_id===step?.id).sort((a,b)=>b.attempt_number-a.attempt_number)[0];
  if(!result||Object.keys(result).length!==resultKeys.length||resultKeys.some(key=>!Object.hasOwn(result,key))||result.stage!=='package'||result.status!=='succeeded'||result.slug!==slug||result.brandId!==scope.brandId||result.runId!==scope.runId||!same(result.manifestRef,ctx.manifestRef)||stageFingerprint!==result.stageFingerprint||!row||!same(ref(row),result.packageRef)||row.relative_path!==`deliveries/${scope.brandId}/${slug}/${result.attemptId}.zip`||step?.status!=='succeeded'||step.fingerprint!==stageFingerprint||attempt?.status!=='succeeded'||latest?.id!==attempt.id||attempt.result_artifact_id!==row.id||ctx.run.status!=='completed'||ctx.run.current_step!==null||result.runVersion!==ctx.run.version)fail('PACKAGE_INTEGRITY_FAILED','Entrega histórica diverge da execução confirmada.');
  let verified;try{verified=await verifyPackageZip({guard,relativePath:row.relative_path,entries});}catch{fail('PACKAGE_INTEGRITY_FAILED','ZIP histórico indisponível ou inválido.');}
  let metadata;try{metadata=JSON.parse(row.metadata_json);}catch{fail('PACKAGE_INTEGRITY_FAILED','Metadados do ZIP histórico inválidos.');}
  if(!metadata||Object.keys(metadata).length!==2||verified.sha256!==row.hash||verified.size!==metadata.size||!same(verified.members,metadata.members)||!same(verified.members,result.members))fail('PACKAGE_INTEGRITY_FAILED','ZIP histórico diverge de seus membros confirmados.');
  gate.unchanged(ctx);return result;
 }
 async function execute(input){
  const request=clone(input);exactKeys(request,['requestId','brandId','runId','manifestId','slug']);
  for(const id of [request.brandId,request.runId,request.manifestId])validateIdentifier(id);validateSlug(request.slug);
  const scope={brandId:request.brandId,runId:request.runId},operation={requestId:request.requestId,...scope,operation:'run.package',payload:{manifestId:request.manifestId,slug:request.slug}};
  const prepare=Symbol('prepare');let previous,replayed=false;
  try{previous=runOperation(db,operation,()=>{throw prepare;},{now:()=>clockTime(clock)});replayed=true;}catch(error){if(error!==prepare)throw error;}
  if(replayed)return replay(scope,previous,request.manifestId,request.slug);
  const ctx=await inspected(scope,request.manifestId);ready(ctx);
  const entries=packageEntries(ctx),{stageFingerprint}=inputs(ctx,entries);
  const attemptId=randomUUID(),owner=`package:${randomUUID()}`,id=randomUUID(),kind='package',version=Math.max(0,...ctx.stored.artifacts.filter(a=>a.kind===kind).map(a=>a.version))+1;
  const staging=`staging/${randomUUID()}/package.zip`,destination=`deliveries/${scope.brandId}/${request.slug}/${attemptId}.zip`;
  let lease,heartbeat,started=false,runningState,finalFile;
  try{
   lease=acquireRunLease(db,{...scope,owner,stage:'package'},{clock});
   immediateTransaction(db,()=>{
    assertRunLeaseOwned(db,lease,{clock});
    const leased=capture(scope),expected=clone({...ctx.stored,run:{...ctx.run,lease_owner:lease.owner,lease_expires_at:lease.expiresAt,fencing_token:lease.fencingToken}});
    if(!same(leased,expected))fail('QUALITY_EVIDENCE_STALE','Estado mudou antes da tentativa de pacote.');
    const prior=leased.steps.find(s=>s.step_key==='package'),stepId=prior?.id??randomUUID();
    const status=transitionStage('package',prior?.status??'pending',{type:'start'},options);
    const number=Math.max(0,...leased.step_attempts.filter(a=>a.step_id===stepId).map(a=>a.attempt_number))+1;
    db.prepare('INSERT INTO steps(id,brand_id,run_id,step_key,status,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT(brand_id,run_id,step_key) DO UPDATE SET status=excluded.status,fingerprint=excluded.fingerprint').run(stepId,scope.brandId,scope.runId,'package',status,stageFingerprint);
    db.prepare('INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,started_at,status) VALUES(?,?,?,?,?,?,?,?,?)').run(attemptId,scope.brandId,scope.runId,stepId,number,lease.owner,lease.fencingToken,time(),'running');
    db.prepare('UPDATE runs SET status=?,current_step=?,version=version+1 WHERE brand_id=? AND id=?').run(transitionRun(ctx.run.status,{type:'start'}),'package',scope.brandId,scope.runId);
    db.prepare('INSERT INTO run_events(id,brand_id,run_id,attempt_id,event_type,correlation_id) VALUES(?,?,?,?,?,?)').run(randomUUID(),scope.brandId,scope.runId,attemptId,'package.started',request.requestId);
    runningState=capture(scope);
   });started=true;heartbeat=startRunLeaseHeartbeat(db,lease,{clock});
   await hooks.beforeZipWrite?.({attemptId,relativePath:staging});
   await writeVerifiedPackage({guard,relativePath:staging,entries});
   await hooks.afterZipWrite?.({attemptId,relativePath:staging});
   await verifyPackageZip({guard,relativePath:staging,entries});
   await promoteFile(guard,staging,destination);
   await hooks.afterPromotion?.({attemptId,relativePath:destination});
   const verified=await verifyPackageZip({guard,relativePath:destination,entries});
   await hooks.beforeCommit?.({attemptId,relativePath:destination});
   heartbeat.stop();lease=renewRunLease(db,lease,{clock});
   const current=await inspected(scope,request.manifestId);
   if(!same(stable(capture(scope)),stable(runningState))||inputs(current,packageEntries(current)).stageFingerprint!==stageFingerprint)fail('QUALITY_EVIDENCE_STALE','Entradas da entrega mudaram durante o ZIP.');
   if(verified.sha256!==((await verifyPackageZip({guard,relativePath:destination,entries})).sha256))fail('PACKAGE_INTEGRITY_FAILED','ZIP mudou antes do commit.');
   finalFile=await guard.withPaths([destination],async file=>({file,handle:await open(file,'r')}));
   const checkFinalBytes=()=>{const proof=verifyPackageZipHandleSync({...finalFile,entries});if(proof.sha256!==verified.sha256||proof.size!==verified.size||!same(proof.members,verified.members))fail('PACKAGE_INTEGRITY_FAILED','ZIP mudou durante a confirmação.');};
   const packageRef={id,kind,version,sha256:verified.sha256},artifact={id,brand_id:scope.brandId,run_id:scope.runId,kind,version,hash:verified.sha256,relative_path:destination,metadata_json:canonicalJson({size:verified.size,members:verified.members})};
   const result={...scope,stage:'package',status:'succeeded',attemptId,stageFingerprint,manifestRef:ctx.manifestRef,packageRef,slug:request.slug,members:verified.members,runVersion:current.run.version+1};
   const events=()=>db.prepare('SELECT * FROM run_events WHERE brand_id=? AND run_id=? ORDER BY id').all(scope.brandId,scope.runId);
   const publicationState=()=>{const value=capture(scope);value.operations=value.operations.filter(o=>o.request_id!==request.requestId);return {...value,events:events()};};
   const expectedOperation={request_id:request.requestId,brand_id:scope.brandId,run_id:scope.runId,operation:operation.operation,payload_hash:canonicalHash({operation:operation.operation,...scope,payload:operation.payload}),canonical_version:CANONICAL_VERSION,result_json:canonicalJson(result)};
   const checkOperation=()=>{const {committed_at,...actual}=db.prepare('SELECT * FROM operations WHERE request_id=?').get(request.requestId)??{};if(typeof committed_at!=='string'||!same(actual,expectedOperation))fail('RUN_STATE_INCONSISTENT','Operação do pacote alterada antes da confirmação.');};
   let published;
   return commitRunLease(db,lease,operation,({emit})=>{
    const run=db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(scope.brandId,scope.runId),attempt=db.prepare('SELECT * FROM step_attempts WHERE id=?').get(attemptId),step=db.prepare("SELECT * FROM steps WHERE brand_id=? AND run_id=? AND step_key='package'").get(scope.brandId,scope.runId);
    if(run.status!=='running'||run.current_step!=='package'||attempt?.status!=='running'||step?.status!=='running'||step.fingerprint!==stageFingerprint||!same(stable(capture(scope)),stable(runningState)))fail('RUN_STATE_INCONSISTENT','Estado do pacote mudou antes da confirmação.');
    const finishedAt=time(),eventId=randomUUID();published=clone(publicationState());
    Object.assign(published.run,{status:transitionRun(run.status,{type:'complete'}),current_step:null,version:run.version+1});
    Object.assign(published.steps.find(s=>s.id===step.id),{status:'succeeded'});
    Object.assign(published.step_attempts.find(a=>a.id===attemptId),{status:'succeeded',finished_at:finishedAt,result_artifact_id:id});
    published.artifacts.push(artifact);ordered(published.artifacts);
    db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(artifact.id,artifact.brand_id,artifact.run_id,artifact.kind,artifact.version,artifact.hash,artifact.relative_path,artifact.metadata_json);
    db.prepare("UPDATE step_attempts SET status='succeeded',finished_at=?,result_artifact_id=? WHERE id=?").run(finishedAt,id,attemptId);
    db.prepare("UPDATE steps SET status='succeeded' WHERE id=?").run(step.id);
    db.prepare('UPDATE runs SET status=?,current_step=NULL,version=version+1 WHERE brand_id=? AND id=?').run(transitionRun(run.status,{type:'complete'}),scope.brandId,scope.runId);
    emit({id:eventId,eventType:'package.succeeded',attemptId});
    const event=db.prepare('SELECT * FROM run_events WHERE id=?').get(eventId);
    if(!event||event.brand_id!==scope.brandId||event.run_id!==scope.runId||event.attempt_id!==attemptId||event.event_type!=='package.succeeded'||event.correlation_id!==request.requestId||event.diagnostic_code!==null)fail('RUN_STATE_INCONSISTENT','Evento do pacote inconsistente.');
    published.events.push(event);ordered(published.events);
    const injected=hooks.commit?.();if(injected?.then)throw invalidArgument('Hook de commit precisa ser síncrono.');
    return {status:'committed',result};
   },{clock,beforeCommit:()=>{checkOperation();if(!same(publicationState(),published))fail('RUN_STATE_INCONSISTENT','Estado do pacote alterado antes da confirmação.');checkFinalBytes();},afterRelease:()=>{checkOperation();if(!same(publicationState(),{...published,run:{...published.run,lease_owner:null,lease_expires_at:null}}))fail('RUN_STATE_INCONSISTENT','Estado do pacote alterado ao liberar a execução.');checkFinalBytes();}});
  }catch(error){
   heartbeat?.stop();const problem=error instanceof PublicError?error:new PublicError('PACKAGE_FAILED','Não foi possível confirmar o ZIP da entrega.');
   if(lease)try{
    if(!started)releaseRunLease(db,lease,{clock});
    else commitRunLease(db,lease,{requestId:randomUUID(),...scope,operation:'run.package.failed',payload:{attemptId,errorCode:problem.code}},({emit})=>{
     const run=db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(scope.brandId,scope.runId),attempt=db.prepare('SELECT * FROM step_attempts WHERE id=?').get(attemptId);
     if(run.status!=='running'||attempt?.status!=='running')fail('RUN_STATE_INCONSISTENT','Tentativa já encerrada.');
     db.prepare("UPDATE step_attempts SET status='failed',finished_at=?,error_code=? WHERE id=?").run(time(),problem.code,attemptId);
     db.prepare("UPDATE steps SET status='failed' WHERE id=?").run(attempt.step_id);
     db.prepare("UPDATE runs SET status='blocked',version=version+1 WHERE brand_id=? AND id=?").run(scope.brandId,scope.runId);
     emit({id:randomUUID(),eventType:'package.failed',attemptId,diagnosticCode:problem.code});
     return {status:'committed',result:{...scope,stage:'package',attemptId,status:'failed',errorCode:problem.code}};
    },{clock});
   }catch{/* Expired or revoked ownership is reconciled by run control. */}
   throw problem;
  }finally{heartbeat?.stop();await finalFile?.handle.close();}
 }
 return Object.freeze({execute});
}
