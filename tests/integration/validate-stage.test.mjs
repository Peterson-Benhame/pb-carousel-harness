import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rm,readdir,symlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {qualityServiceFixture,syntheticReview} from '../helpers/quality-service-fixture.mjs';
import {canonicalHash,canonicalJson} from '../../src/domain/canonical-json.mjs';
import {sha256} from '../../src/infrastructure/resources.mjs';

const module=await import('../../src/application/stages/validate-stage.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const request=f=>({requestId:randomUUID(),...f.scope,manifestId:f.final.manifestRef.id});
async function stage(f,options={}){assert.equal(typeof module.createValidateStage,'function');return (await f.from('src/application/stages/validate-stage.mjs')).createValidateStage({root:f.root,db:f.db,packageRoot:f.packageRoot,...options});}
async function bytes(f,reference){return readFile((await f.inputs.resolveArtifact(f.scope.brandId,f.scope.runId,reference.id)).path);}
async function fixture(t){
 assert.equal(typeof module.createValidateStage,'function');
 const f=await qualityServiceFixture(t,{render:false}),render=await (await f.from('src/application/stages/render-stage.mjs')).createRenderStage({root:f.root,db:f.db,packageRoot:f.packageRoot});
 const preview=await render.execute({requestId:randomUUID(),...f.scope,kind:'preview'}),pending=await f.service.request({requestId:randomUUID(),...f.scope,kind:'preview',manifestId:preview.manifestRef.id}),response=await syntheticReview(pending,{gateway:f.reviewGateway});
 await f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:response.answers},response.receipt);await f.grant('preview');
 f.final=await render.execute({requestId:randomUUID(),...f.scope,kind:'final'});f.manifest=JSON.parse(await bytes(f,f.final.manifestRef));return f;
}
const validationAttempts=f=>f.db.prepare("SELECT a.* FROM step_attempts a JOIN steps s ON s.id=a.step_id WHERE s.step_key='validate'").all();

test('T21 exposes an internal closed validate stage',()=>assert.equal(typeof module.createValidateStage,'function'));
test('T20 outputs pass real Q06 recomputation and advance only to final editorial review',async t=>{
 const f=await fixture(t),original=f.db.prepare('SELECT count(*) n FROM approvals').get().n,result=await (await stage(f)).execute(request(f));
 assert.equal(result.status,'succeeded');assert.equal(result.stage,'validate');assert.equal(result.nextStage,'quality-review');assert.deepEqual(result.manifestRef,f.final.manifestRef);assert.notEqual(result.attemptId,f.final.attemptId);
 const report=JSON.parse(await bytes(f,result.objectiveReportRef));assert.equal(report.result,'passed');assert.equal(report.renderAttemptId,f.final.attemptId);assert.deepEqual(report.manifestRef,f.final.manifestRef);
 assert.ok(report.checks.some(c=>c.expected==='metrics and scenes derived from exact input/font bytes'&&c.result==='passed'));
 const row=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(result.objectiveReportRef.id);assert.equal(row.relative_path,`runs/${f.scope.brandId}/${f.scope.runId}/${result.attemptId}/${row.id}.bin`);
 assert.equal(validationAttempts(f)[0].result_artifact_id,row.id);assert.equal(f.db.prepare('SELECT count(*) n FROM approvals').get().n,original);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='quality-review:final'").get().n,0);
 const run=f.db.prepare('SELECT * FROM runs WHERE id=?').get(f.scope.runId);assert.equal(run.status,'ready');assert.equal(run.current_step,'quality-review');assert.equal(run.lease_owner,null);
 const review=await f.gate.inspectReview({...f.scope,kind:'final',manifestId:f.manifest.id});assert.deepEqual(review.objectiveReportRef,result.objectiveReportRef);
 await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'package'}),{code:'EDITORIAL_REVIEW_REQUIRED'});
});
test('validate accepts no paths, bypass flags, renderer, kind or token from the caller',async t=>{
 assert.equal(typeof module.createValidateStage,'function');const f=await qualityServiceFixture(t,{render:false}),service=await stage(f),base={requestId:randomUUID(),...f.scope,manifestId:randomUUID()};
 for(const key of ['approved','outputDir','slug','renderer','kind','fencingToken','objectiveReport','allowUnqualified'])await assert.rejects(service.execute({...base,[key]:true}),{code:'INVALID_ARGUMENT'});
 assert.equal(validationAttempts(f).length,0);
});
for(const mutation of ['missing','corrupt','extra','directory','symlink','hardlink'])test(`validate rejects ${mutation} rendered output before acquiring a lease`,async t=>{
 const f=await fixture(t),file=await f.inputs.resolveArtifact(f.scope.brandId,f.scope.runId,f.manifest.files[0].artifactRef.id),directory=path.dirname(file.path);
 if(mutation==='missing')await rm(file.path);
 if(mutation==='corrupt')await writeFile(file.path,'corrupt');
 if(mutation==='extra')await writeFile(path.join(directory,'unlisted.txt'),'external');
 if(mutation==='directory')await mkdir(path.join(directory,'nested'));
 if(mutation==='symlink'){const backup=path.join(f.root,'external.png');await writeFile(backup,await readFile(file.path));await rm(file.path);await symlink(backup,file.path,'file');}
 if(mutation==='hardlink')await (await import('node:fs/promises')).link(file.path,path.join(f.root,'outside-output.png'));
 await assert.rejects((await stage(f)).execute(request(f)),error=>['RESOURCE_MISSING','ARTIFACT_HASH_MISMATCH','PATH_NOT_CONFINED','VALIDATE_OUTPUT_INVALID'].includes(error.code));assert.equal(validationAttempts(f).length,0);
});
async function replaceArtifact(f,reference,value){
 const row=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(reference.id),content=Buffer.isBuffer(value)?value:Buffer.from(canonicalJson(value));await writeFile(path.join(f.root,row.relative_path),content);
 const trigger=f.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='immutable_artifact'").get().sql;f.db.exec('DROP TRIGGER immutable_artifact');
 try{f.db.prepare('UPDATE artifacts SET hash=?,metadata_json=? WHERE id=?').run(sha256(content),canonicalJson({...JSON.parse(row.metadata_json),size:content.length}),reference.id);}finally{f.db.exec(trigger);}
 return {...reference,sha256:sha256(content)};
}
async function replaceManifest(f){f.final.manifestRef=await replaceArtifact(f,f.final.manifestRef,f.manifest);}
function noPublication(f,id){assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='objective-report:final'").get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM operations WHERE request_id=?').get(id).n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM run_events WHERE event_type='validate.succeeded'").get().n,0);}

test('self-consistent forged final pixels produce a failed objective artifact, never a review or consent',async t=>{
 const f=await fixture(t),file=f.manifest.files.find(f=>f.slideIndex===3),png=await sharp({create:{width:1080,height:1350,channels:4,background:'#ffffff'}}).png().toBuffer();
 file.artifactRef=await replaceArtifact(f,file.artifactRef,png);file.size=png.length;file.rgbaSha256=sha256(await sharp(png).ensureAlpha().raw().toBuffer());await replaceManifest(f);
 const service=await stage(f),r=request(f),result=await service.execute(r);assert.equal(result.status,'failed');assert.equal(result.errorCode,'QUALITY_CHECK_FAILED');assert.equal(result.nextStage,'validate');
 const report=JSON.parse(await bytes(f,result.objectiveReportRef));assert.equal(report.result,'failed');assert.ok(report.checks.some(c=>c.expected==='rendered PNG and RGBA derived from original glyphs and assets'&&c.result==='failed'));assert.ok(report.checks.some(c=>c.expected==='joined original slide RGBA'&&c.result==='failed'));
 assert.equal(validationAttempts(f)[0].status,'failed');assert.equal(f.db.prepare('SELECT status FROM runs').get().status,'blocked');assert.equal(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner,null);
 await assert.rejects(f.gate.inspectReview({...f.scope,kind:'final',manifestId:f.manifest.id}),{code:'QUALITY_EVIDENCE_INCOMPLETE'});
 const defect=await f.gate.inspectCorrectionDefect({...f.scope,defectRef:result.objectiveReportRef,planRef:f.manifest.planRef});assert.deepEqual(defect.defectRef,result.objectiveReportRef);
 assert.deepEqual(await service.execute(r),result);assert.equal(validationAttempts(f).length,1);
});
test('malformed metrics are rejected through a public validate diagnostic',async t=>{
 const f=await fixture(t);f.manifest.metricsRef=await replaceArtifact(f,f.manifest.metricsRef,{schemaVersion:1,selection:{},slides:null});await replaceManifest(f);
 await assert.rejects((await stage(f)).execute(request(f)),{code:'VALIDATE_OUTPUT_INVALID'});assert.equal(validationAttempts(f).length,0);
});
for(const variant of ['count','dimensions','panorama','extra-ref','other-attempt'])test(`manifest ${variant} mismatch cannot be validated`,async t=>{
 const f=await fixture(t);
 if(variant==='count')f.manifest.files.splice(2,1);
 if(variant==='dimensions')f.manifest.files[2].width=1079;
 if(variant==='panorama')f.manifest.files.pop();
 if(variant==='extra-ref')await f.persist('render-extra:final',{synthetic:true},1,randomUUID(),f.manifest.renderAttemptId);
 if(variant==='other-attempt')f.manifest.renderAttemptId=randomUUID();
 await replaceManifest(f);await assert.rejects((await stage(f)).execute(request(f)),e=>['INVALID_ARGUMENT','QUALITY_EVIDENCE_STALE','VALIDATE_OUTPUT_INVALID'].includes(e.code));assert.equal(validationAttempts(f).length,0);
});
test('the real candidate catalog and historical v1 run cannot be validated via a synthetic bypass',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),r={requestId:randomUUID(),...f.scope,manifestId:randomUUID()};
 const service=await module.createValidateStage({root:f.root,db:f.db,qualifications:f.qualifications,approved:true});await assert.rejects(service.execute(r),{code:'LAYOUT_NOT_QUALIFIED'});
 const legacy=await (await import('../helpers/legacy-render-fixture.mjs')).snapshot(),runId=randomUUID();legacy.brand.id=f.scope.brandId;
 f.db.prepare('INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES(?,?,1,?,?)').run(runId,f.scope.brandId,canonicalJson(legacy),canonicalHash(legacy));
 await assert.rejects((await stage(f)).execute({...r,runId}),{code:'RUN_DERIVATION_REQUIRED'});assert.equal(validationAttempts(f).length,0);
});
test('expired worker cannot confirm the objective artifact or release a successor lease',async t=>{
 const f=await fixture(t);let now=1_000;const clock={now:()=>now,setInterval:()=>0,clearInterval(){}};const r=request(f),service=await stage(f,{clock,hooks:{beforeCommit(){now+=60_001;}}});
 await assert.rejects(service.execute(r),{code:'RUN_LEASE_LOST'});noPublication(f,r.requestId);assert.equal(validationAttempts(f)[0].status,'running');assert.ok(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner);
});
test('attempt directories are exclusive and report bytes are rechecked after promotion',async t=>{
 const f=await fixture(t),r=request(f);let prefix;const service=await stage(f,{hooks:{async beforeValidate({attemptId}){prefix=path.join(f.root,'runs',f.scope.brandId,f.scope.runId,attemptId);await mkdir(prefix);await writeFile(path.join(prefix,'sentinel'),'preserve');}}});
 await assert.rejects(service.execute(r),{code:'VALIDATE_FAILED'});noPublication(f,r.requestId);assert.deepEqual(await readdir(prefix),['sentinel']);assert.equal(await readFile(path.join(prefix,'sentinel'),'utf8'),'preserve');
});
for(const mutation of ['render-bytes','report-bytes','report-extra','downstream'])test(`${mutation} alteration before commit never publishes validate`,async t=>{
 const f=await fixture(t),r=request(f),service=await stage(f,{hooks:{async beforeCommit({attemptId,objectiveReportRef}){
  if(mutation==='render-bytes')await writeFile((await f.inputs.resolveArtifact(f.scope.brandId,f.scope.runId,f.manifest.files[2].artifactRef.id)).path,'tampered');
  if(mutation==='report-bytes')await writeFile(path.join(f.root,'runs',f.scope.brandId,f.scope.runId,attemptId,`${objectiveReportRef.id}.bin`),'tampered');
  if(mutation==='report-extra')await writeFile(path.join(f.root,'runs',f.scope.brandId,f.scope.runId,attemptId,'unlisted'),'extra');
  if(mutation==='downstream')f.step('quality-review','a'.repeat(64));
 }}});await assert.rejects(service.execute(r),e=>['ARTIFACT_HASH_MISMATCH','VALIDATE_OUTPUT_INVALID','RUN_STATE_INCONSISTENT'].includes(e.code));noPublication(f,r.requestId);assert.equal(validationAttempts(f)[0].status,'failed');
});
for(const timing of ['stage','operation','release'])test(`${timing} trigger cannot turn validation publication into corrupted state`,async t=>{
 const f=await fixture(t),r=request(f);
 if(timing==='stage')f.db.exec("CREATE TRIGGER corrupt_validation AFTER UPDATE OF status ON steps WHEN NEW.step_key='validate' AND NEW.status='succeeded' BEGIN UPDATE steps SET status='failed' WHERE id=NEW.id; END");
 if(timing==='operation')f.db.exec("CREATE TRIGGER corrupt_validation AFTER INSERT ON operations WHEN NEW.operation='run.validate' BEGIN UPDATE operations SET result_json=json_set(result_json,'$.status','forged') WHERE request_id=NEW.request_id; END");
 if(timing==='release')f.db.exec("CREATE TRIGGER corrupt_validation AFTER UPDATE OF lease_owner ON runs WHEN OLD.lease_owner LIKE 'validate:%' AND NEW.lease_owner IS NULL BEGIN UPDATE steps SET status='failed' WHERE run_id=NEW.id AND step_key='validate'; END");
 await assert.rejects((await stage(f)).execute(r),{code:'RUN_STATE_INCONSISTENT'});noPublication(f,r.requestId);
});
test('failure publication cannot be changed to succeeded by a trigger',async t=>{
 const f=await fixture(t),r=request(f);f.db.exec("CREATE TRIGGER corrupt_failure AFTER INSERT ON operations WHEN NEW.operation='run.validate.failed' BEGIN UPDATE steps SET status='succeeded' WHERE run_id=NEW.run_id AND step_key='validate'; END");
 const service=await stage(f,{hooks:{afterValidate(){throw Error('synthetic failure');}}});await assert.rejects(service.execute(r),{code:'VALIDATE_FAILED'});noPublication(f,r.requestId);
 assert.equal(validationAttempts(f)[0].status,'running');assert.equal(f.db.prepare("SELECT status FROM steps WHERE step_key='validate'").get().status,'running');assert.ok(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner);
});
test('successful replay rechecks persisted report and output bytes without acquiring another lease',async t=>{
 const f=await fixture(t),r=request(f),service=await stage(f),result=await service.execute(r),before=canonicalJson(f.gate.capture(f.scope));
 assert.deepEqual(await service.execute(r),result);assert.equal(canonicalJson(f.gate.capture(f.scope)),before);assert.equal(validationAttempts(f).length,1);
 await assert.rejects(service.execute({...r,manifestId:randomUUID()}),{code:'IDEMPOTENCY_CONFLICT'});
 await writeFile((await f.inputs.resolveArtifact(f.scope.brandId,f.scope.runId,result.objectiveReportRef.id)).path,'corrupt');await assert.rejects(service.execute(r),{code:'ARTIFACT_HASH_MISMATCH'});assert.equal(validationAttempts(f).length,1);
});
async function worker(t,f,r,mode){
 const {fork}=await import('node:child_process'),child=fork(new URL('../helpers/validate-stage-worker.mjs',import.meta.url),[f.root,f.packageRoot,JSON.stringify(r),mode],{stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const messages=[],waiters=[];child.on('message',m=>{const i=waiters.findIndex(w=>w.type===m.type);if(i>=0)waiters.splice(i,1)[0].resolve(m);else messages.push(m);});
 const closed=new Promise(resolve=>child.on('exit',code=>{for(const w of waiters.splice(0))w.reject(Error(`Worker exit ${code}: ${stderr}`));resolve();}));
 t.after(async()=>{if(child.exitCode===null)child.kill();await closed;});
 return {child,closed,next:type=>{const i=messages.findIndex(m=>m.type===type);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>waiters.push({type,resolve,reject}));}};
}
test('a fresh process executes real final Q06 once and another replays without recomposition',async t=>{
 const f=await fixture(t),r=request(f),first=await worker(t,f,r,'spy'),a=await first.next('result');await first.closed;
 assert.equal(a.ok,true,a.code);assert.deepEqual(a.checks,['preview','final','preview']);
 const second=await worker(t,f,r,'spy'),b=await second.next('result');await second.closed;assert.equal(b.ok,true,b.code);assert.deepEqual(b.result,a.result);assert.deepEqual(b.checks,[]);assert.equal(validationAttempts(f).length,1);
});
test('concurrent validate cannot start and a revoked subprocess cannot publish its report',async t=>{
 const f=await fixture(t),r=request(f),held=await worker(t,f,r,'hold');await held.next('beforeCommit');
 await assert.rejects((await stage(f)).execute(request(f)),{code:'RUN_NOT_EXECUTABLE'});
 const {createRunControl}=await f.from('src/application/run-control.mjs');await createRunControl({db:f.db}).interrupt({requestId:randomUUID(),...f.scope});held.child.send({type:'continue'});
 const result=await held.next('result');await held.closed;assert.equal(result.ok,false);assert.equal(result.code,'RUN_LEASE_LOST');noPublication(f,r.requestId);assert.equal(validationAttempts(f).length,1);assert.equal(validationAttempts(f)[0].status,'interrupted');
});
test('validation results bind the input fingerprint and historical replay never resolves latest',async t=>{
 const f=await fixture(t),service=await stage(f),r=request(f),result=await service.execute(r);
 const originalFingerprint=f.db.prepare("SELECT fingerprint FROM steps WHERE step_key='validate'").get().fingerprint;assert.equal(result.stageFingerprint,originalFingerprint);
 const plan=structuredClone(f.plan);plan.id=randomUUID();plan.version=2;plan.previewSelection.slideIndices.push(3);plan.previewSelection.reasons.push({slideIndex:3,codes:[]});plan.change={kind:'material',previousPlanRef:f.ready.artifacts.plan,correctionEpisodeRef:null};
 await f.inputs.savePlan({requestId:randomUUID(),...f.scope,expectedVersion:f.db.prepare('SELECT version FROM runs').get().version,plan});
 const before=canonicalJson(f.gate.capture(f.scope));assert.deepEqual(await service.execute(r),result);assert.equal(canonicalJson(f.gate.capture(f.scope)),before);assert.equal(validationAttempts(f).length,1);
 f.db.prepare("UPDATE operations SET result_json=json_set(result_json,'$.stageFingerprint',?) WHERE request_id=?").run('a'.repeat(64),r.requestId);await assert.rejects(service.execute(r),{code:'QUALITY_EVIDENCE_STALE'});
});
test('malformed persisted replay result never leaks a native exception',async t=>{
 const f=await fixture(t),service=await stage(f),r=request(f);await service.execute(r);f.db.prepare("UPDATE operations SET result_json='null' WHERE request_id=?").run(r.requestId);
 await assert.rejects(service.execute(r),{code:'VALIDATE_OUTPUT_INVALID'});assert.equal(validationAttempts(f).length,1);
});
