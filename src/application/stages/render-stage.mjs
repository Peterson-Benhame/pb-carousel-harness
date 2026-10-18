import {randomUUID} from 'node:crypto';
import {readFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createProductionGate} from '../production-gate.mjs';
import {runOperation} from '../operation-runner.mjs';
import {acquireRunLease,assertRunLeaseOwned,renewRunLease,releaseRunLease,commitRunLease,startRunLeaseHeartbeat} from '../run-lease.mjs';
import {renderPreparedSnapshot} from '../../adapters/legacy/render-adapter.mjs';
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
const ref=row=>({id:row.id,kind:row.kind,version:row.version,sha256:row.hash});
const options={pipelineVersion:2};
const stageKey=kind=>kind==='preview'?'preview-render':'render';
const nextKey=kind=>kind==='preview'?'preview-review':'validate';

/** Internal service used by future CLI/plugin transports. Request JSON contains
 * only identity and kind; it cannot replace gates, renderer, selection, paths,
 * executor, lease, clocks or receipts. Hooks are trusted fault-injection seams.
 * Rendering and filesystem work are always outside short SQLite transactions.
 */
export async function createRenderStage({root,db,packageRoot=DEFAULT_PACKAGE_ROOT,clock=systemClock,hooks={}}){
 const guard=await createConfinedRoot(root),gate=await createProductionGate({root,db,packageRoot});
 const time=()=>{const value=clockTime(clock);if(value>8640000000000000)throw invalidArgument('Data de execução inválida.');return new Date(value).toISOString();};
 const version=(scope,kind)=>db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM artifacts WHERE brand_id=? AND run_id=? AND kind=?').get(scope.brandId,scope.runId,kind).n;
 async function verify(item){
  let bytes;try{bytes=await guard.withPaths([item.relativePath],p=>readFile(p));}catch(e){if(e.code==='ENOENT')fail('RESOURCE_MISSING','Saída da tentativa está ausente.');throw e;}
  if(bytes.length!==item.size||sha256(bytes)!==item.sha256)fail('ARTIFACT_HASH_MISMATCH','Saída da tentativa diverge do manifesto.');return bytes;
 }
 async function verifyReplay(scope,result){
  const before=gate.capture(scope),row=before.artifacts.find(a=>a.id===result.manifestRef.id);
  if(!row||!same(ref(row),result.manifestRef))fail('QUALITY_EVIDENCE_STALE','Resultado confirmado não corresponde à operação.');
  const read=async reference=>{const a=before.artifacts.find(a=>a.id===reference.id);if(!a||!same(ref(a),reference))fail('QUALITY_EVIDENCE_STALE','Referência confirmada inválida.');return verify({relativePath:a.relative_path,size:JSON.parse(a.metadata_json).size,sha256:a.hash});};
  const m=validateRenderManifest(JSON.parse((await read(result.manifestRef)).toString('utf8')));
  const attempt=before.step_attempts.find(a=>a.id===result.attemptId);
  if(m.id!==row.id||m.version!==row.version||m.brandId!==scope.brandId||m.runId!==scope.runId||m.renderAttemptId!==result.attemptId||attempt?.status!=='succeeded'||attempt.result_artifact_id!==m.id)fail('QUALITY_EVIDENCE_STALE','Tentativa confirmada inválida.');
  for(const reference of [result.manifestRef,m.metricsRef,...m.files.map(f=>f.artifactRef)]){
   const a=before.artifacts.find(a=>a.id===reference.id);if(a?.relative_path!==`runs/${scope.brandId}/${scope.runId}/${m.renderAttemptId}/${reference.id}.bin`)fail('QUALITY_EVIDENCE_STALE','Arquivo pertence a outra tentativa.');await read(reference);
  }
  await read(m.upstream.assetsEvidenceRef);gate.unchanged({scope,stored:before});return result;
 }
 function assertReady(ctx,key){
  const rows=ctx.stored.steps.map(s=>({key:s.step_key,status:s.status,fingerprint:s.fingerprint}));
  if(ctx.run.status!=='ready'||ctx.run.current_step!==key||firstPendingStage(rows,options)!==key)fail('RUN_NOT_EXECUTABLE','A etapa solicitada não é a pendência atual.');
  if(ctx.stored.step_attempts.some(a=>a.status==='running')||ctx.stored.steps.some(s=>s.status==='running'))fail('RUN_STATE_INCONSISTENT','Tentativa anterior exige reconciliação.');
  const keys=getStages(options).map(s=>s.key);if(ctx.stored.steps.some(s=>keys.indexOf(s.step_key)>keys.indexOf(key)&&!['pending','invalidated'].includes(s.status)))fail('RUN_STATE_INCONSISTENT','Etapa posterior não foi invalidada.');
  const current=ctx.stored.steps.find(s=>s.step_key===key);if(current&&!['pending','invalidated','failed'].includes(current.status))fail('RUN_NOT_EXECUTABLE','Etapa não está disponível para execução.');
  if(ctx.run.version>=Number.MAX_SAFE_INTEGER-1)fail('RUN_VERSION_EXHAUSTED','Contador de versão indisponível.');
 }
 async function execute(input){
  const r=JSON.parse(canonicalJson(input));exactKeys(r,['requestId','brandId','runId','kind']);validateIdentifier(r.brandId);validateIdentifier(r.runId);
  if(!['preview','final'].includes(r.kind))throw invalidArgument('Tipo de render inválido.');
  const scope={brandId:r.brandId,runId:r.runId},key=stageKey(r.kind),operation={requestId:r.requestId,...scope,operation:'run.render',payload:{kind:r.kind}};
  const prepare=Symbol('prepare');let replay;
  try{replay=runOperation(db,operation,()=>{throw prepare;},{now:()=>clockTime(clock)});}catch(e){if(e!==prepare)throw e;}
  if(replay)return verifyReplay(scope,replay);
  const ctx=await gate.inspectRender({...scope,kind:r.kind});assertReady(ctx,key);
  let lease,heartbeat,runningState,started=false;const attemptId=randomUUID(),owner=`render:${randomUUID()}`;
  try{
   lease=acquireRunLease(db,{...scope,owner,stage:key},{clock});
   immediateTransaction(db,()=>{
    assertRunLeaseOwned(db,lease,{clock});
    gate.unchanged({...ctx,stored:{...ctx.stored,run:{...ctx.run,lease_owner:lease.owner,lease_expires_at:lease.expiresAt,fencing_token:lease.fencingToken}}});
    let stage=ctx.stored.steps.find(s=>s.step_key===key);const stepId=stage?.id??randomUUID();let status=stage?.status??'pending';
    if(status!=='pending')status=transitionStage(key,status,{type:'reset'},options);
    status=transitionStage(key,status,{type:'start'},options);
    db.prepare('INSERT INTO steps(id,brand_id,run_id,step_key,status,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT(brand_id,run_id,step_key) DO UPDATE SET status=excluded.status,fingerprint=excluded.fingerprint').run(stepId,...Object.values(scope),key,status,ctx.stageFingerprint);
    const number=db.prepare('SELECT COALESCE(MAX(attempt_number),0)+1 n FROM step_attempts WHERE brand_id=? AND run_id=? AND step_id=?').get(...Object.values(scope),stepId).n;
    db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,started_at,status) VALUES(?,?,?,?,?,?,?,?,'running')").run(attemptId,...Object.values(scope),stepId,number,lease.owner,lease.fencingToken,time());
    db.prepare('UPDATE runs SET status=?,current_step=?,version=version+1 WHERE brand_id=? AND id=?').run(transitionRun(ctx.run.status,{type:'start'}),key,...Object.values(scope));
    db.prepare('INSERT INTO run_events(id,brand_id,run_id,attempt_id,event_type,correlation_id) VALUES(?,?,?,?,?,?)').run(randomUUID(),...Object.values(scope),attemptId,`${key}.started`,r.requestId);
   });started=true;runningState=gate.capture(scope);
   const stableState=value=>({...value,run:{...value.run,lease_expires_at:null}});
   heartbeat=startRunLeaseHeartbeat(db,lease,{clock});
   await hooks.beforeRender?.({attemptId,stage:key});
   const directory=`runs/${scope.brandId}/${scope.runId}/${attemptId}`;
   await guard.withPaths([directory],p=>mkdir(path.dirname(p),{recursive:true}));
   await guard.withPaths([directory],p=>mkdir(p)); // exclusive attempt ownership, never reuse an existing directory
   immediateTransaction(db,()=>assertRunLeaseOwned(db,lease,{clock}));
   const composition=await renderPreparedSnapshot(ctx);
   await hooks.afterRender?.({attemptId,stage:key,activity:JSON.parse(canonicalJson(composition.activity))});
   const records=[],files=[];
   async function persist(kind,bytes,id=randomUUID()){
    const item={id,kind,version:version(scope,kind),sha256:sha256(bytes),size:bytes.length,relativePath:`runs/${scope.brandId}/${scope.runId}/${attemptId}/${id}.bin`};
    const staging=await stageBytes(guard,bytes);await verify({...item,relativePath:staging});
    await promoteFile(guard,staging,item.relativePath);records.push(item);
    await hooks.afterPromotion?.({attemptId,stage:key,artifactRef:{id:item.id,kind,version:item.version,sha256:item.sha256},relativePath:item.relativePath});
    await verify(item);return {id:item.id,kind,version:item.version,sha256:item.sha256};
   }
   async function image(value,role,slideIndex=null,pair=null){
    const width=role==='slide'?1080:role==='seam'?2160:1080*ctx.plan.slides.length;
    const meta=await sharp(value.png,{limitInputPixels:100_000_000}).metadata();
    if(meta.format!=='png'||meta.pages>1||meta.width!==width||meta.height!==1350||sha256(value.png)!==value.sha256||sha256(await sharp(value.png).ensureAlpha().raw().toBuffer())!==value.rgbaSha256)fail('RENDER_OUTPUT_INVALID','PNG produzido não corresponde às métricas.');
    const kind=role==='slide'?`render-slide:${r.kind}:${slideIndex}`:role==='seam'?`render-seam:${r.kind}:${pair.from}-${pair.to}`:'render-panorama:final';
    const artifactRef=await persist(kind,value.png);files.push({artifactRef,role,slideIndex,pair,mediaType:'image/png',width,height:1350,size:value.png.length,rgbaSha256:value.rgbaSha256});
   }
   for(const slide of composition.slides)await image(slide,'slide',slide.index);
   for(const seam of composition.seams)await image(seam,'seam',null,seam.pair);
   if(r.kind==='final')await image(composition.panorama,'panorama');
   if(ctx.preview)for(const prior of ctx.preview.manifest.files){
    const current=files.find(f=>f.role===prior.role&&f.slideIndex===prior.slideIndex&&same(f.pair,prior.pair));
    if(!current||current.artifactRef.sha256!==prior.artifactRef.sha256||current.rgbaSha256!==prior.rgbaSha256||current.size!==prior.size)fail('QUALITY_EVIDENCE_STALE','Lote não reproduz os pixels da amostra aprovada.');
   }
   const metrics={schemaVersion:1,selection:composition.selection,slides:composition.slides.map(({index,scene,metrics})=>({index,scene,metrics}))};
   const metricsRef=await persist(`composition-metrics:${r.kind}`,Buffer.from(canonicalJson(metrics)));
   const assetsEvidenceRef=ctx.preview?.manifest.upstream.assetsEvidenceRef??await persist(ctx.assetsApproval?'assets-evidence':'no-assets-evidence',Buffer.from(canonicalJson({schemaVersion:1,...scope,status:ctx.assetsApproval?'approved':'not-applicable',assetsFingerprint:ctx.fingerprints['assets-approval'],...(ctx.assetsApproval?{approvalId:ctx.assetsApproval.id}:{})})));
   const manifest=validateRenderManifest({schemaVersion:2,id:randomUUID(),...scope,version:version(scope,`render-manifest:${r.kind}`),kind:r.kind,renderAttemptId:attemptId,stageFingerprint:ctx.stageFingerprint,snapshotHash:ctx.run.snapshot_hash,inputsRef:ctx.inputsRef,planRef:ctx.saved.artifacts.plan,selection:ctx.selection,selectionHash:canonicalHash(ctx.selection),renderer:ctx.snapshot.renderer,runtimeHash:canonicalHash(ctx.snapshot.runtime),resourceManifestHash:ctx.snapshot.resourceManifestRef.sha256,qualifications:ctx.qualifications,fonts:ctx.snapshot.fonts,upstream:{copyApprovalId:ctx.copy.id,conceptApprovalId:ctx.concept.id,assetsEvidenceRef,...(ctx.preview?{previewManifestRef:ctx.preview.manifestRef,previewReviewRef:ctx.preview.reviewRef,previewApprovalId:ctx.preview.approval.id,approvedSelectionHash:ctx.preview.manifest.selectionHash}:{})},files,metricsRef,createdAt:time()});
   const manifestRef=await persist(`render-manifest:${r.kind}`,Buffer.from(canonicalJson(manifest)),manifest.id);
   await hooks.beforeCommit?.({attemptId,stage:key,manifestRef});
   heartbeat.stop();lease=renewRunLease(db,lease,{clock});
   // Re-read live authorization, resources and inputs after all heavy work.
   const current=await gate.inspectRender({...scope,kind:r.kind});
   if(!same(stableState(current.stored),stableState(runningState)))fail('RUN_STATE_INCONSISTENT','Estado da execução mudou durante a tentativa.');
   if(current.stageFingerprint!==ctx.stageFingerprint||!same(current.inputsRef,ctx.inputsRef))fail('QUALITY_EVIDENCE_STALE','Entradas alteradas durante a tentativa.');
   for(const item of records)await verify(item);
   if(!same((await guard.withPaths([directory],p=>readdir(p))).sort(),records.map(item=>`${item.id}.bin`).sort()))fail('RENDER_OUTPUT_INVALID','Diretório da tentativa contém saída não declarada.');
   const events=()=>db.prepare('SELECT * FROM run_events WHERE brand_id=? AND run_id=? ORDER BY id').all(...Object.values(scope));
   const publicationState=()=>{const value=gate.capture(scope);value.operations=value.operations.filter(o=>o.request_id!==r.requestId);return {...value,events:events()};};let published;
   const result={...scope,status:'succeeded',stage:key,attemptId,manifestRef,nextStage:nextKey(r.kind),runVersion:current.run.version+1};
   const expectedOperation={request_id:r.requestId,brand_id:scope.brandId,run_id:scope.runId,operation:operation.operation,payload_hash:canonicalHash({operation:operation.operation,...scope,payload:operation.payload}),canonical_version:CANONICAL_VERSION,result_json:canonicalJson(result)};
   const checkOperation=()=>{const {committed_at,...actual}=db.prepare('SELECT * FROM operations WHERE request_id=?').get(r.requestId)??{};if(typeof committed_at!=='string'||!same(actual,expectedOperation))fail('RUN_STATE_INCONSISTENT','Identidade ou resultado da operação foi alterado.');};
   return commitRunLease(db,lease,operation,({emit})=>{
    gate.unchanged(current);
    const attempt=current.stored.step_attempts.find(a=>a.id===attemptId),stage=current.stored.steps.find(s=>s.step_key===key);
    if(current.run.status!=='running'||current.run.current_step!==key||stage?.status!=='running'||attempt?.status!=='running'||attempt.executor!==lease.owner||attempt.fencing_token!==lease.fencingToken)fail('RUN_STATE_INCONSISTENT','Tentativa não corresponde à posse vigente.');
    const finishedAt=time(),eventId=randomUUID();
    // Derive expected rows from the verified pre-publication state. Capturing
    // already-mutated rows would trust a trigger that corrupts an UPDATE.
    published=JSON.parse(canonicalJson({...current.stored,events:events()}));
    Object.assign(published.run,{status:'ready',current_step:nextKey(r.kind),version:current.run.version+1});
    Object.assign(published.steps.find(s=>s.id===stage.id),{status:'succeeded'});
    Object.assign(published.step_attempts.find(a=>a.id===attemptId),{status:'succeeded',finished_at:finishedAt,result_artifact_id:manifest.id});
    const artifactRows=records.map(item=>({id:item.id,brand_id:scope.brandId,run_id:scope.runId,kind:item.kind,version:item.version,hash:item.sha256,relative_path:item.relativePath,metadata_json:canonicalJson({size:item.size})}));
    published.artifacts.push(...artifactRows);published.artifacts.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    for(const item of artifactRows)db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(item.id,item.brand_id,item.run_id,item.kind,item.version,item.hash,item.relative_path,item.metadata_json);
    db.prepare("UPDATE step_attempts SET status='succeeded',finished_at=?,result_artifact_id=? WHERE id=?").run(finishedAt,manifest.id,attemptId);
    db.prepare('UPDATE steps SET status=? WHERE id=?').run(transitionStage(key,stage.status,{type:'succeeded'},options),stage.id);
    db.prepare('UPDATE runs SET status=?,current_step=?,version=version+1 WHERE brand_id=? AND id=?').run(transitionRun(current.run.status,{type:'stage-succeeded'}),nextKey(r.kind),...Object.values(scope));
    emit({id:eventId,eventType:`${key}.succeeded`,attemptId});
    const event=db.prepare('SELECT * FROM run_events WHERE id=?').get(eventId);
    if(!event||event.brand_id!==scope.brandId||event.run_id!==scope.runId||event.attempt_id!==attemptId||event.event_type!==`${key}.succeeded`||event.correlation_id!==r.requestId||event.diagnostic_code!==null)fail('RUN_STATE_INCONSISTENT','Evento de publicação inconsistente.');
    published.events.push(event);published.events.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const injected=hooks.commit?.();if(injected?.then)throw invalidArgument('Hook de commit precisa ser síncrono.');
    return {status:'committed',result};
   },{clock,beforeCommit:()=>{checkOperation();if(!same(publicationState(),published))fail('RUN_STATE_INCONSISTENT','Estado publicado alterado antes da confirmação.');},afterRelease:()=>{checkOperation();const released={...published,run:{...published.run,lease_owner:null,lease_expires_at:null}};if(!same(publicationState(),released))fail('RUN_STATE_INCONSISTENT','Estado publicado alterado ao liberar a execução.');}});
  }catch(error){
   heartbeat?.stop();
   const problem=error instanceof PublicError?error:new PublicError('RENDER_FAILED','Não foi possível confirmar a tentativa de render.');
   if(lease)try{
    if(!started)releaseRunLease(db,lease,{clock});
    else commitRunLease(db,lease,{requestId:randomUUID(),...scope,operation:'run.render.failed',payload:{attemptId,errorCode:problem.code}},({emit})=>{
     const run=db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(...Object.values(scope)),attempt=db.prepare('SELECT * FROM step_attempts WHERE id=?').get(attemptId);
     if(run.status!=='running'||attempt?.status!=='running')fail('RUN_STATE_INCONSISTENT','Tentativa já encerrada.');
     db.prepare("UPDATE step_attempts SET status='failed',finished_at=?,error_code=? WHERE id=?").run(time(),problem.code,attemptId);
     db.prepare("UPDATE steps SET status='failed' WHERE id=?").run(attempt.step_id);
     db.prepare("UPDATE runs SET status='blocked',version=version+1 WHERE brand_id=? AND id=?").run(...Object.values(scope));
     emit({id:randomUUID(),eventType:`${key}.failed`,attemptId,diagnosticCode:problem.code});return {status:'committed',result:{...scope,attemptId,status:'failed',errorCode:problem.code}};
    },{clock});
   }catch{/* Revocation/expiry leaves authority with T17/T23; never repair under an old token. */}
   throw problem;
  }finally{heartbeat?.stop();}
 }
 return Object.freeze({execute});
}
