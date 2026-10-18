import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,unlink,stat} from 'node:fs/promises';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {makeQualityPackage,qualityServiceFixture,syntheticReview} from '../helpers/quality-service-fixture.mjs';
import {canonicalJson} from '../../src/domain/canonical-json.mjs';

const module=await import('../../src/application/stages/package-stage.mjs').catch(error=>{
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
 return {};
});
const request=f=>({requestId:randomUUID(),...f.scope,manifestId:f.final.manifestRef.id,slug:'synthetic-carousel'});
async function stage(f,options={}){
 return (await f.from('src/application/stages/package-stage.mjs')).createPackageStage({root:f.root,db:f.db,packageRoot:f.packageRoot,...options});
}

async function prepared(t){
 const f=await qualityServiceFixture(t,{render:false});
 const render=await (await f.from('src/application/stages/render-stage.mjs')).createRenderStage({root:f.root,db:f.db,packageRoot:f.packageRoot});
 const preview=await render.execute({requestId:randomUUID(),...f.scope,kind:'preview'});
 const first=await f.service.request({requestId:randomUUID(),...f.scope,kind:'preview',manifestId:preview.manifestRef.id});
 const answered=await syntheticReview(first,{gateway:f.reviewGateway});
 await f.service.decide({requestId:randomUUID(),proposal:first.proposal,answers:answered.answers},answered.receipt);
 await f.grant('preview');
 f.final=await render.execute({requestId:randomUUID(),...f.scope,kind:'final'});
 const validate=await (await f.from('src/application/stages/validate-stage.mjs')).createValidateStage({root:f.root,db:f.db,packageRoot:f.packageRoot});
 f.validation=await validate.execute({requestId:randomUUID(),...f.scope,manifestId:f.final.manifestRef.id});
 assert.equal(f.validation.status,'succeeded');
 return f;
}
async function approveFinal(f){
 const pending=await f.service.request({requestId:randomUUID(),...f.scope,kind:'final',manifestId:f.final.manifestRef.id});
 const answered=await syntheticReview(pending,{gateway:f.reviewGateway});
 await f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:answered.answers},answered.receipt);
}
const state=f=>Object.fromEntries(f.db.prepare("SELECT step_key,status FROM steps WHERE step_key IN ('render','validate','package')").all().map(r=>[r.step_key,r.status]));

test('T22 exposes a closed internal package stage',()=>assert.equal(typeof module.createPackageStage,'function'));
test('installed quality package contains the T22 stage and adapter',async t=>{
 const pkg=await makeQualityPackage(t);
 const resources=await import(pathToFileURL(path.join(pkg.packageRoot,'src/infrastructure/resources.mjs')).href);
 const manifest=await resources.loadResourcesManifest({packageRoot:pkg.packageRoot});
 assert.ok(manifest.requiredFiles.includes('src/application/stages/package-stage.mjs'));
 const service=await import(pathToFileURL(path.join(pkg.packageRoot,'src/application/stages/package-stage.mjs')).href);
 assert.equal(typeof service.createPackageStage,'function');
});

test('package requires final review, rejects adverse slugs, verifies ZIP, then alone completes the run',async t=>{
 const f=await prepared(t),service=await stage(f),base=request(f);
 await assert.rejects(service.execute(base),{code:'EDITORIAL_REVIEW_REQUIRED'});
 assert.equal(f.db.prepare("SELECT count(*) n FROM step_attempts a JOIN steps s ON s.id=a.step_id WHERE s.step_key='package'").get().n,0);
 await approveFinal(f);
 for(const slug of ['../escape','CON','a/b','a\\b','evil.zip','-bad','a'.repeat(81)])await assert.rejects(service.execute({...base,requestId:randomUUID(),slug}),{code:'INVALID_ARGUMENT'});
 const result=await service.execute(base);
 assert.equal(result.status,'succeeded');assert.equal(result.stage,'package');
 assert.equal(result.packageRef.kind,'package');
 assert.deepEqual(state(f),{render:'succeeded',validate:'succeeded',package:'succeeded'});
 const run=f.db.prepare('SELECT * FROM runs WHERE id=?').get(f.scope.runId);assert.equal(run.status,'completed');assert.equal(run.lease_owner,null);
 const runtime=await (await f.from('src/application/run-runtime.mjs')).createRunRuntime({root:f.root,db:f.db,packageRoot:f.packageRoot});
 const projected=await runtime.get(f.scope);
 assert.ok(!projected.diagnostics.some(d=>d.code==='RUN_STATE_INCONSISTENT'));
 const row=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(result.packageRef.id);
 assert.equal(row.relative_path,`deliveries/${f.scope.brandId}/synthetic-carousel/${result.attemptId}.zip`);
 const zip=await readFile(path.join(f.root,row.relative_path));assert.equal(zip.subarray(0,2).toString(),'PK');
 const adapter=await import('../../src/adapters/legacy/package-adapter.mjs');
 assert.deepEqual(result.members.map(m=>m.name),['slides/01.png','slides/02.png','slides/03.png','panorama.png','legenda.txt','referencias.txt']);
 assert.ok(result.members.every(m=>m.sha256&&Number.isSafeInteger(m.crc32)));
 const replay=await service.execute(base);assert.deepEqual(replay,result);
 assert.equal(f.db.prepare("SELECT count(*) n FROM step_attempts a JOIN steps s ON s.id=a.step_id WHERE s.step_key='package'").get().n,1);
 assert.equal(typeof adapter.verifyPackageZip,'function');
 const operation=f.db.prepare('SELECT result_json FROM operations WHERE request_id=?').get(base.requestId),malformed={...JSON.parse(operation.result_json),runVersion:999};
 f.db.prepare('UPDATE operations SET result_json=? WHERE request_id=?').run(canonicalJson(malformed),base.requestId);
 await assert.rejects(service.execute(base),{code:'PACKAGE_INTEGRITY_FAILED'});
 f.db.prepare('UPDATE operations SET result_json=? WHERE request_id=?').run(operation.result_json,base.requestId);
 const metadata=row.metadata_json,fake={...JSON.parse(metadata),members:[]};
 f.db.exec('DROP TRIGGER immutable_artifact');f.db.prepare('UPDATE artifacts SET metadata_json=? WHERE id=?').run(canonicalJson(fake),row.id);
 await assert.rejects(service.execute(base),{code:'PACKAGE_INTEGRITY_FAILED'});
 f.db.prepare('UPDATE artifacts SET metadata_json=? WHERE id=?').run(metadata,row.id);
 await unlink(path.join(f.root,row.relative_path));
 await assert.rejects(service.execute(base),{code:'PACKAGE_INTEGRITY_FAILED'});
});

test('ZIP corruption fails package without revoking successful render and validate',async t=>{
 const f=await prepared(t);await approveFinal(f);
 const service=await stage(f,{hooks:{afterZipWrite:async({relativePath})=>{
  const target=path.join(f.root,relativePath),bytes=await readFile(target);bytes[0]^=1;await writeFile(target,bytes);
 }}});
 await assert.rejects(service.execute(request(f)),{code:'PACKAGE_INTEGRITY_FAILED'});
 assert.deepEqual(state(f),{render:'succeeded',validate:'succeeded',package:'failed'});
 const run=f.db.prepare('SELECT * FROM runs WHERE id=?').get(f.scope.runId);assert.notEqual(run.status,'completed');
 assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='package'").get().n,0);
});

test('post-promotion failure leaves an unreferenced, attempt-scoped ZIP',async t=>{
 const f=await prepared(t);await approveFinal(f);let promoted;
 const service=await stage(f,{hooks:{afterPromotion:async info=>{promoted=info;throw Error('synthetic fault');}}});
 await assert.rejects(service.execute(request(f)),{code:'PACKAGE_FAILED'});
 assert.ok(promoted?.attemptId);assert.ok(promoted.relativePath.endsWith(`/${promoted.attemptId}.zip`));
 assert.ok((await stat(path.join(f.root,promoted.relativePath))).size>22);
 assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='package'").get().n,0);
 assert.deepEqual(state(f),{render:'succeeded',validate:'succeeded',package:'failed'});
 // Simulate a future trusted recovery action without implementing run control in T22.
 f.db.prepare("UPDATE steps SET status='pending' WHERE step_key='package'").run();
 f.db.prepare("UPDATE runs SET status='ready',current_step='package',version=version+1 WHERE id=?").run(f.scope.runId);
 const retried=await (await stage(f)).execute(request(f));
 const row=f.db.prepare('SELECT relative_path FROM artifacts WHERE id=?').get(retried.packageRef.id);
 assert.notEqual(row.relative_path,promoted.relativePath);
 assert.ok((await stat(path.join(f.root,row.relative_path))).size>22);
});

test('commit tampering rolls back publication and leaves prior stages successful',async t=>{
 const f=await prepared(t);await approveFinal(f);
 const service=await stage(f,{hooks:{commit:()=>f.db.prepare('UPDATE runs SET version=version+4 WHERE id=?').run(f.scope.runId)}});
 await assert.rejects(service.execute(request(f)),{code:'RUN_STATE_INCONSISTENT'});
 assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='package'").get().n,0);
 assert.deepEqual(state(f),{render:'succeeded',validate:'succeeded',package:'failed'});
 assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(f.scope.runId).status,'blocked');
});

test('ZIP bytes changed inside commit cannot complete the run',async t=>{
 const f=await prepared(t);await approveFinal(f);let promoted;
 const service=await stage(f,{hooks:{afterPromotion:info=>{promoted=info;},commit:()=>{
  const target=path.join(f.root,promoted.relativePath),bytes=readFileSync(target);bytes[0]^=1;writeFileSync(target,bytes);
 }}});
 await assert.rejects(service.execute(request(f)),{code:'PACKAGE_INTEGRITY_FAILED'});
 assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='package'").get().n,0);
 assert.deepEqual(state(f),{render:'succeeded',validate:'succeeded',package:'failed'});
 assert.notEqual(f.db.prepare('SELECT status FROM runs WHERE id=?').get(f.scope.runId).status,'completed');
});

test('lease expiry during ZIP work cannot publish a package',async t=>{
 const f=await prepared(t);await approveFinal(f);
 const service=await stage(f,{hooks:{afterPromotion:async()=>f.db.prepare('UPDATE runs SET lease_expires_at=0 WHERE id=?').run(f.scope.runId)}});
 await assert.rejects(service.execute(request(f)),{code:'RUN_LEASE_LOST'});
 assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='package'").get().n,0);
 assert.equal(f.db.prepare("SELECT status FROM steps WHERE step_key='package'").get().status,'running');
});

test('final review revoked during ZIP work blocks package confirmation',async t=>{
 const f=await prepared(t);await approveFinal(f);
 const service=await stage(f,{hooks:{afterPromotion:async()=>f.db.prepare("UPDATE steps SET status='pending' WHERE step_key='quality-review'").run()}});
 await assert.rejects(service.execute(request(f)),{code:'EDITORIAL_REVIEW_REQUIRED'});
 assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='package'").get().n,0);
 assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(f.scope.runId).status,'blocked');
});
