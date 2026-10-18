import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {qualityServiceFixture,syntheticReview} from '../helpers/quality-service-fixture.mjs';
import {canonicalHash,canonicalJson} from '../../src/domain/canonical-json.mjs';
import {sha256} from '../../src/infrastructure/resources.mjs';

const module=await import('../../src/application/stages/render-stage.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const request=(f,kind='preview')=>({requestId:randomUUID(),...f.scope,kind});
async function stage(f,options={}){assert.equal(typeof module.createRenderStage,'function');const local=await f.from('src/application/stages/render-stage.mjs');return local.createRenderStage({root:f.root,db:f.db,packageRoot:f.packageRoot,...options});}
async function readArtifact(f,reference){const file=await f.inputs.resolveArtifact(f.scope.brandId,f.scope.runId,reference.id);assert.equal(file.sha256,reference.sha256);return readFile(file.path);}
async function reviewPreview(f,manifestId){const pending=await f.service.request({requestId:randomUUID(),...f.scope,kind:'preview',manifestId});const response=await syntheticReview(pending,{gateway:f.reviewGateway});await f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:response.answers},response.receipt);await f.grant('preview');}

test('T20 exposes a closed isolated render stage',()=>{assert.equal(typeof module.createRenderStage,'function');});
test('preview really renders only the selected slides and publishes an owned manifest without approving it',async t=>{
 const f=await qualityServiceFixture(t,{render:false});let activity;
 const service=await stage(f,{hooks:{afterRender(value){activity=value.activity;}}}),result=await service.execute(request(f));
 assert.equal(result.status,'succeeded');assert.equal(result.stage,'preview-render');assert.equal(result.nextStage,'preview-review');
 const manifest=JSON.parse(await readArtifact(f,result.manifestRef));assert.deepEqual(manifest.selection.slideIndices,[1,2]);assert.deepEqual(activity,{composedIndices:[1,2],rasterizedIndices:[1,2]});
 assert.deepEqual(manifest.files.map(f=>f.role),['slide','slide']);assert.equal(manifest.renderAttemptId,result.attemptId);
 for(const reference of [result.manifestRef,manifest.metricsRef,...manifest.files.map(f=>f.artifactRef)]){
  const row=f.db.prepare('SELECT relative_path FROM artifacts WHERE id=?').get(reference.id);assert.equal(row.relative_path,`runs/${f.scope.brandId}/${f.scope.runId}/${result.attemptId}/${reference.id}.bin`);
 }
 for(const file of manifest.files){const bytes=await readArtifact(f,file.artifactRef);assert.equal(bytes.length,file.size);assert.equal(sha256(await sharp(bytes).ensureAlpha().raw().toBuffer()),file.rgbaSha256);}
 const run=f.db.prepare('SELECT * FROM runs WHERE id=?').get(f.scope.runId);assert.equal(run.status,'ready');assert.equal(run.current_step,'preview-review');assert.equal(run.lease_owner,null);
 assert.equal(f.db.prepare("SELECT count(*) n FROM approvals WHERE kind='preview'").get().n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind LIKE 'quality-review:%'").get().n,0);
 assert.equal((await f.gate.inspectReview({...f.scope,kind:'preview',manifestId:manifest.id})).objectiveReport.result,'passed');
});

test('full render requires the exact reviewed/consented preview and retains its byte and pixel hashes',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),service=await stage(f),preview=await service.execute(request(f));
 await assert.rejects(service.execute(request(f,'final')),error=>['QUALITY_EVIDENCE_INCOMPLETE','EDITORIAL_REVIEW_REQUIRED','PREVIEW_APPROVAL_REQUIRED'].includes(error.code));
 await reviewPreview(f,preview.manifestRef.id);const final=await service.execute(request(f,'final'));
 const p=JSON.parse(await readArtifact(f,preview.manifestRef)),m=JSON.parse(await readArtifact(f,final.manifestRef));assert.equal(final.nextStage,'validate');assert.equal(m.files.length,4);assert.equal(m.files.at(-1).role,'panorama');
 assert.notEqual(m.renderAttemptId,p.renderAttemptId);assert.deepEqual(m.upstream.assetsEvidenceRef,p.upstream.assetsEvidenceRef);
 for(const file of p.files){const rendered=m.files.find(g=>g.slideIndex===file.slideIndex&&g.role===file.role);assert.notEqual(rendered.artifactRef.id,file.artifactRef.id);assert.equal(rendered.artifactRef.sha256,file.artifactRef.sha256);assert.equal(rendered.rgbaSha256,file.rgbaSha256);}
 assert.equal((await f.gate.assertProductionGate({...f.scope,phase:'validate'})).manifestRef.id,m.id);
 assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(f.scope.runId).status,'ready');
});

for(const field of ['approved','selection','outputDir','slug','renderer','verifyReviewReceipt','fencingToken'])test(`request cannot override ${field}`,async t=>{
 const f=await qualityServiceFixture(t,{render:false}),service=await stage(f);await assert.rejects(service.execute({...request(f),[field]:true}),{code:'INVALID_ARGUMENT'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
});
test('missing copy/concept approvals block before acquiring a lease or rendering',async t=>{
 const f=await qualityServiceFixture(t,{approve:false,render:false}),service=await stage(f);await assert.rejects(service.execute(request(f)),{code:'APPROVAL_REQUIRED'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);assert.equal(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner,null);
});
test('the actual candidate catalog stays blocked even when construction supplies a fake qualification list',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),service=await module.createRenderStage({root:f.root,db:f.db,qualifications:f.qualifications,approved:true});await assert.rejects(service.execute(request(f)),{code:'LAYOUT_NOT_QUALIFIED'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
});
test('snapshot and managed logo survive original input removal and later brand preferences, without copying logo/fonts into outputs',async t=>{
 const f=await qualityServiceFixture(t,{render:false,logo:true});
 await rm(path.join(f.root,'source-carousel.json'));await rm(path.join(f.root,'source-concept.md'));
 const changed={...f.snapshot.brand.config,profile:'@later_revision'};f.db.prepare("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES(?,2,?,?,'user-confirmed')").run(f.scope.brandId,canonicalJson(changed),canonicalHash(changed));f.db.prepare('UPDATE brands SET current_revision=2 WHERE id=?').run(f.scope.brandId);
 await writeFile(path.join(f.packageRoot,'shared/brand.json'),canonicalJson(changed));
 const output=await (await stage(f)).execute(request(f)),m=JSON.parse(await readArtifact(f,output.manifestRef)),metrics=JSON.parse(await readArtifact(f,m.metricsRef));
 assert.ok(metrics.slides.every(s=>s.scene.elements.some(e=>e.id==='logo')));
 assert.ok(metrics.slides.every(s=>s.scene.elements.find(e=>e.id==='signature').sourceText===f.snapshot.brand.config.profile));
 const rows=f.db.prepare('SELECT * FROM artifacts WHERE relative_path LIKE ?').all(`runs/${f.scope.brandId}/${f.scope.runId}/${output.attemptId}/%`);
 assert.equal(rows.length,5);assert.ok(rows.every(a=>!a.kind.includes('font')&&!a.kind.includes('logo')));
 for(const row of rows)assert.ok(!f.logoData.some(logo=>logo.sha256===row.hash));
});
test('an unselected overflow blocks full-plan preflight before any render attempt',async t=>{
 const f=await qualityServiceFixture(t,{render:false,measure:false,editCarousel(carousel){carousel.slides[2].body='W'.repeat(1000);}});let composed=false;
 await assert.rejects((await stage(f,{hooks:{beforeRender(){composed=true;}}})).execute(request(f)),{code:'COMPOSITION_LIMIT_EXCEEDED'});
 assert.equal(composed,false);assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
});
test('replay verifies committed bytes without another attempt and conflicts on a changed request',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),service=await stage(f),r=request(f),result=await service.execute(r);assert.deepEqual(await service.execute(r),result);assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,1);
 await assert.rejects(service.execute({...r,kind:'final'}),{code:'IDEMPOTENCY_CONFLICT'});
 const m=JSON.parse(await readArtifact(f,result.manifestRef)),file=await f.inputs.resolveArtifact(f.scope.brandId,f.scope.runId,m.files[0].artifactRef.id);await writeFile(file.path,'tamper');await assert.rejects(service.execute(r),{code:'ARTIFACT_HASH_MISMATCH'});
});
for(const target of ['inputs','output','runtime','approval'])test(`post-render ${target} changes prevent publication`,async t=>{
 const f=await qualityServiceFixture(t,{render:false});let promoted;
 const service=await stage(f,{hooks:{afterPromotion(item){promoted??=item;},async beforeCommit(){
  if(target==='inputs'){const file=await f.inputs.resolveArtifact(f.scope.brandId,f.scope.runId,f.ready.artifacts.carousel.id);await writeFile(file.path,'tampered input');}
  if(target==='output')await writeFile(path.join(f.root,promoted.relativePath),'tampered output');
  if(target==='runtime')await writeFile(path.join(f.packageRoot,'src/render/text-layout.mjs'),'tampered runtime');
  if(target==='approval')f.db.prepare("UPDATE confirmation_requests SET status='cancelled' WHERE kind='copy'").run();
 }}});
 await assert.rejects(service.execute(request(f)),error=>['ARTIFACT_HASH_MISMATCH','RUNTIME_MISMATCH','APPROVAL_REQUIRED'].includes(error.code));
 assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);assert.equal(f.db.prepare('SELECT status FROM step_attempts').get().status,'failed');assert.equal(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner,null);
});
for(const kind of ['interrupt','cancel'])test(`${kind} after promotion fences the worker and never confirms its outputs`,async t=>{
 const f=await qualityServiceFixture(t,{render:false}),{createRunControl}=await f.from('src/application/run-control.mjs'),control=createRunControl({db:f.db});
 const service=await stage(f,{hooks:{async beforeCommit(){await control[kind]({requestId:randomUUID(),...f.scope});}}});
 await assert.rejects(service.execute(request(f)),{code:'RUN_LEASE_LOST'});
 assert.equal(f.db.prepare('SELECT status FROM runs').get().status,kind==='cancel'?'cancelled':'interrupted');assert.equal(f.db.prepare('SELECT result_artifact_id FROM step_attempts').get().result_artifact_id,null);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);
});
test('expired lease at the commit boundary rolls back artifacts, operation, stage and success event',async t=>{
 const f=await qualityServiceFixture(t,{render:false});let now=Date.now();const clock={now:()=>now,setInterval:()=>1,clearInterval(){}};
 const service=await stage(f,{clock,hooks:{commit(){now+=60001;}}}),r=request(f);
 await assert.rejects(service.execute(r),{code:'RUN_LEASE_LOST'});assert.equal(f.db.prepare('SELECT status FROM step_attempts').get().status,'running');assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM operations WHERE request_id=?').get(r.requestId).n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM run_events WHERE event_type='preview-render.succeeded'").get().n,0);
});
test('a material plan successor allocates new bytes and never inherits the prior preview decision',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),service=await stage(f),first=await service.execute(request(f));await reviewPreview(f,first.manifestRef.id);
 const before=await readArtifact(f,first.manifestRef),plan=JSON.parse(canonicalJson(f.plan));plan.id=randomUUID();plan.version=2;plan.previewSelection.slideIndices.push(3);plan.previewSelection.reasons.push({slideIndex:3,codes:[]});
 // A material plan has its own identity; input service computes invalidation.
 plan.change={kind:'material',previousPlanRef:f.ready.artifacts.plan,correctionEpisodeRef:null};
 await f.inputs.savePlan({requestId:randomUUID(),...f.scope,expectedVersion:f.db.prepare('SELECT version FROM runs').get().version,plan});
 const second=await service.execute(request(f));assert.notEqual(second.attemptId,first.attemptId);assert.deepEqual(await readArtifact(f,first.manifestRef),before);
 const current=f.db.prepare('SELECT current_step FROM runs').get();assert.equal(current.current_step,'preview-review');await assert.rejects(service.execute(request(f,'final')),error=>['EDITORIAL_REVIEW_REQUIRED','QUALITY_EVIDENCE_INCOMPLETE','QUALITY_EVIDENCE_STALE'].includes(error.code));
 const attempts=f.db.prepare('SELECT attempt_number FROM step_attempts ORDER BY attempt_number').all();assert.deepEqual(attempts.map(a=>a.attempt_number),[1,2]);
});

for(const mutation of ['hook','trigger'])test(`a ${mutation} cannot alter published state while retaining a valid lease`,async t=>{
 const f=await qualityServiceFixture(t,{render:false});
 if(mutation==='trigger')f.db.exec("CREATE TRIGGER corrupt_render AFTER INSERT ON operations WHEN NEW.operation='run.render' BEGIN UPDATE steps SET status='failed' WHERE step_key='preview-render'; END;");
 const service=await stage(f,{hooks:mutation==='hook'?{commit(){f.db.prepare("UPDATE steps SET status='failed' WHERE step_key='preview-render'").run();}}:{}});
 await assert.rejects(service.execute(request(f)),{code:'RUN_STATE_INCONSISTENT'});
 assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM run_events WHERE event_type='preview-render.succeeded'").get().n,0);
});
test('an incompatible logo variant is detected before any attempt starts',async t=>{
 const f=await qualityServiceFixture(t,{render:false,logo:'dark-only',measure:false}),service=await stage(f);await assert.rejects(service.execute(request(f)),{code:'LOGO_VARIANT_MISSING'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
});
test('creative approved:true data never replaces the actual asset consent',async t=>{
 const f=await qualityServiceFixture(t,{render:false,approve:false,creative:true}),service=await stage(f);await f.grant('copy');await f.grant('concept');
 assert.ok(f.carousel.assets.every(a=>a.approved));await assert.rejects(service.execute(request(f)),{code:'APPROVAL_REQUIRED'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
 await f.grant('creative-assets');await rm(path.join(f.root,'source-creative.png'));const result=await service.execute(request(f)),m=JSON.parse(await readArtifact(f,result.manifestRef));const evidence=JSON.parse(await readArtifact(f,m.upstream.assetsEvidenceRef));assert.equal(evidence.status,'approved');assert.ok(evidence.approvalId);
 const metrics=JSON.parse(await readArtifact(f,m.metricsRef));assert.ok(metrics.slides.some(s=>s.scene.elements.some(e=>e.kind==='asset')));
});

test('each attempt reserves an exclusive directory and never writes into a preexisting one',async t=>{
 const f=await qualityServiceFixture(t,{render:false});let directory;
 const service=await stage(f,{hooks:{async beforeRender({attemptId}){directory=path.join(f.root,'runs',f.scope.brandId,f.scope.runId,attemptId);await (await import('node:fs/promises')).mkdir(directory);await writeFile(path.join(directory,'sentinel'),'preserve');}}});
 await assert.rejects(service.execute(request(f)),{code:'RENDER_FAILED'});assert.deepEqual(await readdir(directory),['sentinel']);assert.equal(await readFile(path.join(directory,'sentinel'),'utf8'),'preserve');assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);
});
test('activated production refuses a historical run instead of taking the legacy bypass',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),legacy=await (await import('../helpers/legacy-render-fixture.mjs')).snapshot(),runId=randomUUID();legacy.brand.id=f.scope.brandId;
 f.db.prepare('INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES(?,?,1,?,?)').run(runId,f.scope.brandId,canonicalJson(legacy),canonicalHash(legacy));
 await assert.rejects((await stage(f)).execute({...request(f),runId}),{code:'RUN_DERIVATION_REQUIRED'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts WHERE run_id=?').get(runId).n,0);
});
test('managed input tamper blocks before a render attempt, despite an unchanged request fingerprint',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),file=await f.inputs.resolveArtifact(f.scope.brandId,f.scope.runId,f.ready.artifacts.carousel.id);await writeFile(file.path,'tampered');await assert.rejects((await stage(f)).execute(request(f)),{code:'ARTIFACT_HASH_MISMATCH'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
});
test('a configured directory with wrong font bytes blocks before a render attempt',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),directory=path.join(f.root,'wrong-fonts');await (await import('node:fs/promises')).mkdir(directory);for(const font of f.manifest.fonts)await writeFile(path.join(directory,font.file),'unapproved font');f.db.prepare('UPDATE workspace_settings SET authorized_font_directory=?').run(directory);
 await assert.rejects((await stage(f)).execute(request(f)),{code:'RUNTIME_MISMATCH'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
});

test('T21 can inspect the exact rendered composition without requiring a future validation or review',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),result=await (await stage(f)).execute(request(f));assert.equal(typeof f.gate.inspectRendered,'function');
 const target=await f.gate.inspectRendered({...f.scope,kind:'preview',manifestId:result.manifestRef.id});assert.deepEqual(target.manifestRef,result.manifestRef);assert.equal(target.files.length,3);assert.deepEqual(target.composition.inputs.carousel,f.carousel);
});

test('an unexpected file added to the attempt directory prevents confirmation',async t=>{
 const f=await qualityServiceFixture(t,{render:false});const service=await stage(f,{hooks:{async beforeCommit({attemptId}){await writeFile(path.join(f.root,'runs',f.scope.brandId,f.scope.runId,attemptId,'unlisted.txt'),'must not deliver');}}});
 await assert.rejects(service.execute(request(f)),{code:'RENDER_OUTPUT_INVALID'});assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);
});

async function worker(t,f,r,mode){
 const {fork}=await import('node:child_process'),child=fork(new URL('../helpers/render-stage-worker.mjs',import.meta.url),[f.root,f.packageRoot,JSON.stringify(r),mode],{stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const messages=[],waiters=[];child.on('message',m=>{const index=waiters.findIndex(w=>w.type===m.type);if(index>=0)waiters.splice(index,1)[0].resolve(m);else messages.push(m);});
 child.on('exit',code=>{if(code!==0)for(const waiter of waiters.splice(0))waiter.reject(Error(`Worker exit ${code}: ${stderr}`));});t.after(()=>{if(child.exitCode===null)child.kill();});
 return {child,next:type=>{const index=messages.findIndex(m=>m.type===type);if(index>=0)return Promise.resolve(messages.splice(index,1)[0]);return new Promise((resolve,reject)=>waiters.push({type,resolve,reject}));}};
}
test('a separate process observes real selected composition calls, and another process replays without rendering',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),r=request(f),first=await worker(t,f,r,'spy'),a=await first.next('result');assert.equal(a.ok,true,a.code);assert.deepEqual(a.spy,{composedIndices:[1,2],rasterizedIndices:[1,2]});
 const second=await worker(t,f,r,'spy'),b=await second.next('result');assert.equal(b.ok,true,b.code);assert.deepEqual(b.result,a.result);assert.deepEqual(b.spy,{composedIndices:[],rasterizedIndices:[]});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,1);
});
test('a concurrent executor cannot start another attempt and a process revoked after promotion cannot publish',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),held=await worker(t,f,request(f),'hold');await held.next('beforeCommit');
 await assert.rejects((await stage(f)).execute(request(f)),{code:'RUN_NOT_EXECUTABLE'});
 const {createRunControl}=await f.from('src/application/run-control.mjs');await createRunControl({db:f.db}).interrupt({requestId:randomUUID(),...f.scope});held.child.send({type:'continue'});
 const result=await held.next('result');assert.equal(result.ok,false);assert.equal(result.code,'RUN_LEASE_LOST');assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);
});
test('a missing managed logo returns a bounded prerequisite error before rendering',async t=>{
 const f=await qualityServiceFixture(t,{render:false,logo:true}),row=f.db.prepare('SELECT relative_path FROM assets LIMIT 1').get();await rm(path.join(f.root,row.relative_path));
 await assert.rejects((await stage(f)).execute(request(f)),{code:'RESOURCE_MISSING'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
});

test('an attempt directory swapped for a junction or symlink cannot redirect output',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),outside=path.join(f.root,'unrelated'),fs=await import('node:fs/promises');await fs.mkdir(outside);
 const service=await stage(f,{hooks:{async beforeRender({attemptId}){await fs.symlink(outside,path.join(f.root,'runs',f.scope.brandId,f.scope.runId,attemptId),'junction');}}});
 await assert.rejects(service.execute(request(f)),{code:'PATH_NOT_CONFINED'});assert.deepEqual(await readdir(outside),[]);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);
});
test('a render never preserves a downstream succeeded flag from an inconsistent prior attempt',async t=>{
 const f=await qualityServiceFixture(t,{render:false});f.step('preview-review','a'.repeat(64));
 await assert.rejects((await stage(f)).execute(request(f)),{code:'RUN_STATE_INCONSISTENT'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
});

test('a trigger cannot corrupt stage success before the publication snapshot is captured',async t=>{
 const f=await qualityServiceFixture(t,{render:false});f.db.exec("CREATE TRIGGER corrupt_stage AFTER UPDATE OF status ON steps WHEN NEW.step_key='preview-render' AND NEW.status='succeeded' BEGIN UPDATE steps SET status='failed' WHERE id=NEW.id; END;");
 await assert.rejects((await stage(f)).execute(request(f)),{code:'RUN_STATE_INCONSISTENT'});assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);
});
test('a downstream decision inserted during rendering is not adopted at commit',async t=>{
 const f=await qualityServiceFixture(t,{render:false});const service=await stage(f,{hooks:{beforeCommit(){f.step('preview-review','a'.repeat(64));}}});
 await assert.rejects(service.execute(request(f)),{code:'RUN_STATE_INCONSISTENT'});assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);
});

test('lease-release triggers cannot change a committed stage after the last publication guard',async t=>{
 const f=await qualityServiceFixture(t,{render:false});f.db.exec("CREATE TRIGGER corrupt_release AFTER UPDATE OF lease_owner ON runs WHEN OLD.lease_owner IS NOT NULL AND NEW.lease_owner IS NULL BEGIN UPDATE steps SET status='failed' WHERE run_id=NEW.id AND step_key='preview-render'; END;");
 await assert.rejects((await stage(f)).execute(request(f)),{code:'RUN_STATE_INCONSISTENT'});assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);
});
test('declared densities cannot choose an easier sample instead of the measured densest internal slide',async t=>{
 const f=await qualityServiceFixture(t,{render:false,measure:false,count:4,editCarousel(c){c.slides[2].body='Uma ideia que merece espaço. '.repeat(12);}});
 await assert.rejects((await stage(f)).execute(request(f)),{code:'COMPOSITION_PREFLIGHT_STALE'});assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
});

for(const timing of ['operation','release'])for(const field of ['result_json','payload_hash'])test(`${timing} trigger cannot corrupt the current operation ${field}`,async t=>{
 const f=await qualityServiceFixture(t,{render:false});
 const mutation=field==='result_json'?"result_json=json_set(result_json,'$.status','forged')":"payload_hash='"+'f'.repeat(64)+"'";
 if(timing==='operation')f.db.exec(`CREATE TRIGGER corrupt_operation AFTER INSERT ON operations WHEN NEW.operation='run.render' BEGIN UPDATE operations SET ${mutation} WHERE request_id=NEW.request_id; END;`);
 else f.db.exec(`CREATE TRIGGER corrupt_operation_after_release AFTER UPDATE OF lease_owner ON runs WHEN OLD.lease_owner IS NOT NULL AND NEW.lease_owner IS NULL BEGIN UPDATE operations SET ${mutation} WHERE run_id=NEW.id AND operation='run.render'; END;`);
 await assert.rejects((await stage(f)).execute(request(f)),{code:'RUN_STATE_INCONSISTENT'});
 assert.equal(f.db.prepare("SELECT count(*) n FROM operations WHERE operation='run.render'").get().n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='render-manifest:preview'").get().n,0);
});

test('one-line eyebrow does not hide the genuinely denser internal slide from preview',async t=>{
 const f=await qualityServiceFixture(t,{render:false,count:4,editCarousel(c){c.slides[2].body='Uma ideia que merece espaço. '.repeat(12);}});
 assert.ok(f.plan.riskInventory.slides[2].density>f.plan.riskInventory.slides[1].density);
 assert.ok(f.plan.previewSelection.slideIndices.includes(3));
 let activity;const result=await (await stage(f,{hooks:{afterRender(result){activity=result.activity;}}})).execute(request(f));
 assert.deepEqual(activity.composedIndices,f.plan.previewSelection.slideIndices);assert.ok(activity.composedIndices.includes(3));assert.ok(!activity.composedIndices.includes(4));
 const reviewed=await f.gate.inspectReview({...f.scope,kind:'preview',manifestId:result.manifestRef.id});assert.equal(reviewed.objectiveReport.result,'passed');
 for(const slide of reviewed.composition.slides)assert.equal(slide.metrics.density,f.plan.riskInventory.slides[slide.index-1].density);
});
