import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {initializeWorkspace} from '../../src/infrastructure/sqlite/database.mjs';
import {createBrandMemory} from '../../src/application/brand-memory.mjs';
import {createRunService} from '../../src/application/run-service.mjs';
import {createRunInputs} from '../../src/application/run-inputs.mjs';
import {confirmBrandProposal} from '../../src/interfaces/cli/human-confirmation.mjs';
import {loadResourcesManifest,sha256} from '../../src/infrastructure/resources.mjs';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const keys=['inputs','copy-approval','concept-approval','assets-approval','render','validate','package'];
const config=()=>({name:'Synthetic',profile:'@synthetic',language:'pt-BR',audience:null,voice:null,preferences:[],fonts:{title:'Anton',body:'Manrope',mono:'JetBrains Mono'},themes:{light:{background:'#ffffff',text:'#000000',muted:'#555555',accent:'#ff0000',topics:[]}},logo:{enabled:false,variants:{},protection:12,minimumHeight:24},slideWidth:1080,slideHeight:1350,minimumSlideCount:12,maximumSlideCount:16,profileImage:''});
const carousel=()=>({slug:'synthetic-carousel',theme:'light',voiceMode:'default',objective:'save',slides:Array.from({length:12},(_,i)=>({index:i+1,role:i===0?'cover':i===11?'cta':'content',eyebrow:'Synthetic',title:`Title ${i}`,body:'Body',visualSlot:'none'})),caption:'Caption',cta:'Save',hashtags:['#synthetic'],altText:'Synthetic',sources:[{title:'Example',url:'https://example.com'}],continuity:[],assets:[]});
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'carousel-t13 memória ')),dataDir=path.join(root,'workspace'),db=await initializeWorkspace(dataDir);
 t.after(async()=>{if(db.open)db.close();await rm(root,{recursive:true,force:true});});
 const memory=createBrandMemory(db),proposal=memory.propose('brand.create',{requestId:randomUUID(),brandId:A,config:config()});
 // Synthetic local-human adapter is test setup, not a production run approval.
 memory.commit(proposal,await confirmBrandProposal(proposal,{input:{isTTY:true},output:{isTTY:true,write(){}},argv:[],ask:async()=> 'CONFIRMAR'}));
 const manifest=await loadResourcesManifest();Object.assign(manifest.qualifiedRuntime,{node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules});
 const runs=createRunService(db,{dataDir,manifest}),run=await runs.create({requestId:randomUUID(),brandId:A,brandRevision:1,theme:'light'}),inputs=await createRunInputs({root:dataDir,db});
 const module=await import('../../src/application/run-runtime.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});assert.equal(typeof module.createRunRuntime,'function','T13 runtime must exist');
 const runtime=await module.createRunRuntime({root:dataDir,db}),request={brandId:A,runId:run.id};
 async function file(name,bytes){const sourcePath=path.join(root,name);await writeFile(sourcePath,bytes);return {sourcePath,sha256:sha256(bytes)};}
 async function save({concept=true}={}){return inputs.save({requestId:randomUUID(),...request,expectedVersion:runs.get(A,run.id).version,carousel:await file('carousel.json',JSON.stringify(carousel())),...(concept?{concept:await file('concept.md','Explicit synthetic concept')}:{})});}
 function step(key,status='succeeded',fingerprint='a'.repeat(64)){const id=randomUUID();db.prepare('INSERT INTO steps(id,brand_id,run_id,step_key,status,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT(brand_id,run_id,step_key) DO UPDATE SET status=excluded.status,fingerprint=excluded.fingerprint').run(id,A,run.id,key,status,fingerprint);return db.prepare('SELECT id FROM steps WHERE run_id=? AND step_key=?').get(run.id,key).id;}
 return {root,dataDir,db,runs,run,inputs,runtime,request,save,step};
}
const state=db=>db.serialize();
const has=(view,code)=>view.diagnostics.some(d=>d.code===code);

test('new T11 run projects all seven pending stages and offers only the supported input action',async t=>{
 const f=await fixture(t),before=state(f.db),view=await f.runtime.get(f.request);
 assert.equal(view.status,'draft');assert.equal(view.currentStep,'inputs');assert.deepEqual(view.stages.map(s=>s.key),keys);assert.ok(view.stages.every(s=>s.status==='pending'&&!s.persisted));
 assert.equal(view.pending.stage,'inputs');assert.equal(view.pending.code,'INPUTS_REQUIRED');assert.deepEqual(view.nextAction,{type:'edit-inputs',available:true,requires:[]});assert.deepEqual(view.diagnostics,[]);assert.deepEqual(state(f.db),before);
});

test('complete T12 inputs stop at the copy gate; repeated resume is a deterministic read without consent or attempts',async t=>{
 const f=await fixture(t);await f.save();const before=state(f.db),view=await f.runtime.resume(f.request);
 assert.equal(view.status,'ready');assert.equal(view.currentStep,'copy-approval');assert.equal(view.pending.code,'APPROVAL_REQUIRED');assert.equal(view.pending.stage,'copy-approval');assert.deepEqual(view.nextAction,{type:'request-approval',available:true,requires:[]});
 assert.deepEqual(await f.runtime.resume(f.request),view);assert.deepEqual(state(f.db),before);assert.equal(f.db.prepare('SELECT count(*) n FROM approvals').get().n,0);assert.deepEqual(view.attempts,[]);
});

test('removing required concept in T12 moves ready back to draft and reports the exact missing input',async t=>{
 const f=await fixture(t);await f.save();await f.save({concept:false});const view=await f.runtime.get(f.request);
 assert.equal(view.status,'draft');assert.equal(view.pending.stage,'inputs');assert.deepEqual(view.pending.missing,['concept']);assert.equal(view.nextAction.available,true);assert.equal(view.stages[0].status,'pending');
});

test('no creative assets never skips copy or concept and stored success does not substitute for approval verification',async t=>{
 const f=await fixture(t);await f.save();f.step('copy-approval');f.db.prepare("UPDATE runs SET current_step='concept-approval' WHERE id=?").run(f.run.id);
 const view=await f.runtime.get(f.request);assert.equal(view.pending.stage,'concept-approval');assert.equal(view.stages[3].status,'pending');assert.deepEqual(view.nextAction,{type:'inspect-run',available:true,requires:[]});assert.ok(has(view,'APPROVAL_VERIFICATION_UNAVAILABLE'));assert.ok(has(view,'RUN_STATE_INCONSISTENT'));
});

test('runtime exposes no transition, approval, completion or executor callbacks and rejects request flags',async t=>{
 const f=await fixture(t);assert.deepEqual(Object.keys(f.runtime).sort(),['get','resume']);const before=state(f.db);
 for(const patch of [{approved:true},{actor:'user'},{status:'completed'},{event:{type:'approval-granted'}},{execute:true},{requestId:randomUUID()}])await assert.rejects(f.runtime.resume({...f.request,...patch}),{code:'INVALID_ARGUMENT'});
 assert.deepEqual(state(f.db),before);
});

test('completed resume returns existing output bytes metadata without changing any row or starting work',async t=>{
 const f=await fixture(t),saved=await f.save();for(const key of keys)f.step(key,'succeeded',saved.fingerprints[key]??'a'.repeat(64));
 // Direct SQL fixture represents historical records only; no renderer/ZIP is executed.
 const bytes=Buffer.from('synthetic historical package'),id=randomUUID(),relative='synthetic-package.bin';await writeFile(path.join(f.dataDir,relative),bytes);
 f.db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(id,A,f.run.id,'package',1,sha256(bytes),relative,JSON.stringify({size:bytes.length}));
 f.db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,status,finished_at,result_artifact_id) VALUES(?,?,?,?,1,'synthetic',1,'succeeded','2026-10-16 00:00:00',?)").run(randomUUID(),A,f.run.id,f.step('package'),id);
 f.db.prepare("UPDATE runs SET status='completed',current_step='package' WHERE id=?").run(f.run.id);const before=state(f.db),view=await f.runtime.resume(f.request);
 assert.equal(view.status,'completed');assert.equal(view.terminal,true);assert.equal(view.pending,null);assert.deepEqual(view.nextAction,{type:'inspect-results',available:true,requires:[]});
 assert.deepEqual(view.results,[{id,kind:'package',version:1,sha256:sha256(bytes),size:bytes.length,integrity:'verified-bytes'}]);assert.deepEqual(await f.runtime.resume(f.request),view);assert.deepEqual(state(f.db),before);
 await assert.rejects(f.save(),{code:'RUN_NOT_EDITABLE'});
});

test('completed without package evidence is reported as inconsistent and never regenerated',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE runs SET status='completed' WHERE id=?").run(f.run.id);const before=state(f.db),view=await f.runtime.resume(f.request);
 assert.equal(view.status,'completed');assert.ok(has(view,'RUN_STATE_INCONSISTENT'));assert.deepEqual(view.results,[]);assert.equal(view.nextAction.type,'inspect-results');assert.deepEqual(state(f.db),before);
});

test('cancelled remains terminal and can only continue as a derived execution',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE runs SET status='cancelled' WHERE id=?").run(f.run.id);const before=state(f.db),view=await f.runtime.resume(f.request);
 assert.equal(view.terminal,true);assert.equal(view.pending,null);assert.deepEqual(view.nextAction,{type:'derive-run',available:true,requires:[]});assert.deepEqual(state(f.db),before);await assert.rejects(f.save(),{code:'RUN_NOT_EDITABLE'});
});

test('ready without verified inputs cannot promise progress or infer succeeded inputs',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE runs SET status='ready',current_step='copy-approval' WHERE id=?").run(f.run.id);const view=await f.runtime.resume(f.request);
 assert.equal(view.status,'ready');assert.ok(has(view,'RUN_STATE_INCONSISTENT'));assert.equal(view.pending.stage,'inputs');assert.equal(view.nextAction.type,'inspect-run');assert.equal(view.stages[0].status,'pending');
});

test('tampered input bytes produce a conservative diagnosis without mutating persisted ready state',async t=>{
 const f=await fixture(t),saved=await f.save(),artifact=await f.inputs.resolveArtifact(A,f.run.id,saved.artifacts.concept.id);await writeFile(artifact.path,'tampered');const before=state(f.db),view=await f.runtime.resume(f.request);
 assert.equal(view.status,'ready');assert.ok(has(view,'ARTIFACT_HASH_MISMATCH'));assert.equal(view.nextAction.type,'inspect-run');assert.deepEqual(state(f.db),before);
});

test('stale input fingerprint and unknown stored stage names fail closed in the projection',async t=>{
 const f=await fixture(t);await f.save();f.step('inputs','succeeded','b'.repeat(64));f.step('unknown','succeeded');const before=state(f.db),view=await f.runtime.get(f.request);
 assert.ok(has(view,'RUN_STATE_INCONSISTENT'));assert.equal(view.nextAction.type,'inspect-run');assert.equal(view.stages.length,7);assert.deepEqual(state(f.db),before);
});

test('running with no active attempt is inconsistent; reading attempt history never resumes ended attempts',async t=>{
 const f=await fixture(t);await f.save();f.db.prepare("UPDATE runs SET status='running',current_step='render' WHERE id=?").run(f.run.id);assert.ok(has(await f.runtime.get(f.request),'RUN_STATE_INCONSISTENT'));
 const step=f.step('render','running');for(const [index,status] of ['succeeded','failed','interrupted','cancelled','running'].entries())f.db.prepare('INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,status,finished_at,error_code) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),A,f.run.id,step,index+1,'synthetic',1,status,status==='running'?null:'2026-10-16 00:00:00',status==='failed'?'SYNTHETIC_FAILURE':null);
 const before=state(f.db),view=await f.runtime.get(f.request);assert.deepEqual(view.attempts.map(a=>a.status),['succeeded','failed','interrupted','cancelled','running']);assert.equal(view.attempts[0].step,'render');assert.equal(view.attempts[1].errorCode,'SYNTHETIC_FAILURE');assert.deepEqual(state(f.db),before);
});

test('blocked and interrupted report future correction/reconciliation boundaries rather than claiming resume',async t=>{
 const f=await fixture(t);await f.save();for(const [status,type,requires] of [['blocked','correct-run',['T16']],['interrupted','reconcile-run',['T14','T23']]]){
  f.db.prepare('UPDATE runs SET status=? WHERE id=?').run(status,f.run.id);const view=await f.runtime.resume(f.request);assert.equal(view.status,status);assert.deepEqual(view.nextAction,{type,available:false,requires});
 }
});

test('queries are scoped and reproducible in a new read-only process with file URL imports',async t=>{
 const f=await fixture(t);await f.save();await assert.rejects(f.runtime.get({brandId:B,runId:f.run.id}),{code:'RUN_NOT_FOUND'});const expected=await f.runtime.get(f.request);
 const script=`import {openWorkspace} from ${JSON.stringify(new URL('../../src/infrastructure/sqlite/database.mjs',import.meta.url).href)};import {createRunRuntime} from ${JSON.stringify(new URL('../../src/application/run-runtime.mjs',import.meta.url).href)};const db=await openWorkspace(process.argv[1]);try{console.log(JSON.stringify(await (await createRunRuntime({root:process.argv[1],db})).resume({brandId:process.argv[2],runId:process.argv[3]})));}finally{db.close();}`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,f.dataDir,A,f.run.id]);assert.deepEqual(JSON.parse(stdout),expected);
});

test('runtime and both domain modules are part of the diagnostic resource manifest',async()=>{
 const manifest=await loadResourcesManifest();for(const file of ['src/application/run-runtime.mjs','src/domain/run-state-machine.mjs','src/domain/stage-graph.mjs'])assert.ok(manifest.requiredFiles.includes(file),file);
});

async function history(f){
 const saved=await f.save();for(const key of keys)f.step(key,'succeeded',saved.fingerprints[key]??'a'.repeat(64));
 for(const kind of ['copy-approval','concept-approval','assets-approval']){
  const id=randomUUID(),fingerprint=saved.fingerprints[kind];
  f.db.prepare("INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,status) VALUES(?,?,?,?,?,'confirmed')").run(id,A,f.run.id,kind,fingerprint);
  f.db.prepare("INSERT INTO approvals(id,brand_id,run_id,kind,object_fingerprint,decision,confirmation_request_id,evidence_json) VALUES(?,?,?,?,?,'approved',?,'{\"synthetic\":true}')").run(randomUUID(),A,f.run.id,kind,fingerprint,id);
 }
 f.db.prepare("UPDATE runs SET status='completed',current_step='package' WHERE id=?").run(f.run.id);
 async function output(stage,{kind=stage,number=1,status='succeeded'}={}){
  const id=randomUUID(),bytes=Buffer.from('Synthetic historical output'),relative=`${id}.bin`;await writeFile(path.join(f.dataDir,relative),bytes);
  f.db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(id,A,f.run.id,kind,number,sha256(bytes),relative,JSON.stringify({size:bytes.length}));
  const step=f.db.prepare('SELECT id FROM steps WHERE run_id=? AND step_key=?').get(f.run.id,stage).id;
  f.db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,status,finished_at,result_artifact_id) VALUES(?,?,?,?,?,'synthetic',1,?,'2026-10-16 00:00:00',?)").run(randomUUID(),A,f.run.id,step,number,status,id);
  return {id,path:path.join(f.dataDir,relative)};
 }
 await output('render');await output('validate');
 return output;
}

test('a package-kind artifact from the wrong stage is never evidence of completed packaging',async t=>{
 const f=await fixture(t),output=await history(f);await output('render',{kind:'package',number:2});const view=await f.runtime.resume(f.request);
 assert.ok(has(view,'RUN_STATE_INCONSISTENT'));assert.equal(view.status,'completed');assert.equal(view.nextAction.type,'inspect-results');
});

test('later failed attempt excludes historical successful output from current results',async t=>{
 const f=await fixture(t),output=await history(f);await output('package');await output('package',{number:2,status:'failed'});const before=state(f.db),view=await f.runtime.resume(f.request);
 assert.ok(view.results.every(r=>r.kind!=='package'));assert.ok(has(view,'RUN_STATE_INCONSISTENT'));assert.deepEqual(state(f.db),before);
});

test('completed result verification reports deleted bytes without changing terminal state',async t=>{
 const f=await fixture(t),output=await history(f),artifact=await output('package');const initial=await f.runtime.resume(f.request);assert.equal(has(initial,'RUN_STATE_INCONSISTENT'),false);assert.ok(has(initial,'APPROVAL_VERIFICATION_UNAVAILABLE'));assert.ok(has(initial,'RESULT_VERIFICATION_UNAVAILABLE'));
 await rm(artifact.path);const before=state(f.db),view=await f.runtime.resume(f.request);assert.equal(view.status,'completed');assert.ok(has(view,'RESOURCE_MISSING'));assert.ok(view.results.every(r=>r.kind!=='package'));assert.deepEqual(state(f.db),before);
});

test('persisted approval records never make unavailable execution available',async t=>{
 const f=await fixture(t);await history(f);for(const key of ['render','validate','package'])f.step(key,'pending');f.db.prepare("UPDATE runs SET status='ready',current_step='render' WHERE id=?").run(f.run.id);
 const before=state(f.db),view=await f.runtime.resume(f.request);assert.equal(view.pending.stage,'render');assert.equal(view.pending.code,'EXECUTION_UNAVAILABLE');assert.deepEqual(view.nextAction,{type:'resume-stage',available:false,requires:['T14','T15','T18','T20']});assert.ok(has(view,'APPROVAL_VERIFICATION_UNAVAILABLE'));assert.deepEqual(state(f.db),before);
});

test('explicit absence of creative assets permits its recorded success without manufacturing asset approval',async t=>{
 const f=await fixture(t);await history(f);f.db.prepare("DELETE FROM approvals WHERE run_id=? AND kind='assets-approval'").run(f.run.id);for(const key of ['render','validate','package'])f.step(key,'pending');f.db.prepare("UPDATE runs SET status='ready',current_step='render' WHERE id=?").run(f.run.id);
 const before=state(f.db),view=await f.runtime.get(f.request);assert.equal(has(view,'RUN_STATE_INCONSISTENT'),false);assert.equal(view.pending.stage,'render');assert.equal(view.nextAction.available,false);assert.deepEqual(state(f.db),before);
});

for(const stage of ['validate','package'])test(`historical outputs awaiting ${stage} report unavailable verification without inventing inconsistency`,async t=>{
 const f=await fixture(t);await history(f);for(const key of keys.slice(keys.indexOf(stage)))f.step(key,'pending');f.db.prepare("UPDATE runs SET status='ready',current_step=? WHERE id=?").run(stage,f.run.id);
 const view=await f.runtime.get(f.request);assert.equal(has(view,'RUN_STATE_INCONSISTENT'),false);assert.ok(has(view,'RESULT_VERIFICATION_UNAVAILABLE'));assert.equal(view.pending.stage,stage);assert.equal(view.pending.code,'EXECUTION_UNAVAILABLE');assert.deepEqual(view.nextAction,{type:'resume-stage',available:false,requires:['T14','T15',stage==='validate'?'T21':'T22']});
});

test('succeeded execution stage without any attempt output is inconsistent even before completed',async t=>{
 const f=await fixture(t);await history(f);f.db.prepare("DELETE FROM step_attempts WHERE run_id=? AND step_id=(SELECT id FROM steps WHERE run_id=? AND step_key='render')").run(f.run.id,f.run.id);f.step('validate','pending');f.step('package','pending');f.db.prepare("UPDATE runs SET status='ready',current_step='validate' WHERE id=?").run(f.run.id);
 const view=await f.runtime.get(f.request);assert.ok(has(view,'RUN_STATE_INCONSISTENT'));assert.equal(view.nextAction.type,'inspect-run');
});

test('Q04 historical read model explicitly has no new quality seal and preserves all bytes',async t=>{
 const f=await fixture(t);await f.save();const before=state(f.db),view=await f.runtime.resume(f.request);
 assert.deepEqual(view.quality,{policyVersion:null,status:'not-evaluated',preview:null,final:null});
 assert.deepEqual(state(f.db),before);assert.equal(view.stages.length,7);
});

test('Q04 v2 read model projects eleven stages without activating or approving anything',async t=>{
 const {qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),f=await qualityStateFixture(t),{createRunRuntime}=await import('../../src/application/run-runtime.mjs'),runtime=await createRunRuntime({root:f.dataDir,db:f.db});
 const before=state(f.db),view=await runtime.get(f.request);
 assert.equal(view.stages.length,11);assert.equal(view.quality.policyVersion,1);assert.equal(view.quality.status,'pending');
 assert.deepEqual(view.nextAction,{type:'edit-inputs',available:true,requires:[],objectId:null});assert.equal(view.pending.objectId,null);
 assert.deepEqual(await runtime.resume(f.request),view);assert.deepEqual(state(f.db),before);
 const saved=await f.save(),ready=await f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan:f.plan(saved)}),after=state(f.db),next=await runtime.get(f.request);
 assert.equal(ready.status,'ready');assert.equal(next.pending.stage,'copy-approval');assert.equal(next.nextAction.type,'request-approval');assert.equal(next.nextAction.available,true);assert.equal(next.quality.status,'pending');assert.deepEqual(state(f.db),after);
});
test('Q04 review waits and preview consent are separate read actions and cannot mint a quality pass',async t=>{
 const {qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),f=await qualityStateFixture(t),{createRunRuntime}=await import('../../src/application/run-runtime.mjs'),runtime=await createRunRuntime({root:f.dataDir,db:f.db});
 const saved=await f.save(),ready=await f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan:f.plan(saved)});
 // Fixture rows represent historical state; no API emits a receipt or approval.
 const stages=(await runtime.get(f.request)).stages;
 for(const pending of ['preview-review','preview-approval','quality-review']){
  f.db.exec('DELETE FROM approvals; DELETE FROM confirmation_requests; DELETE FROM steps');
  for(const stage of stages){const position=stages.findIndex(s=>s.key===pending),index=stages.indexOf(stage),status=index<position?'succeeded':index===position?'waiting-approval':'pending';f.step(stage.key,status,ready.fingerprints[stage.key]??'a'.repeat(64));
   if(stage.kind==='approval'&&status==='succeeded'&&stage.key!=='assets-approval'){
    const id=randomUUID(),fingerprint=ready.fingerprints[stage.key]??'a'.repeat(64);f.db.prepare("INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,status) VALUES(?,?,?,?,?,'confirmed')").run(id,f.request.brandId,f.request.runId,stage.key,fingerprint);
    f.db.prepare("INSERT INTO approvals(id,brand_id,run_id,kind,object_fingerprint,decision,confirmation_request_id,evidence_json) VALUES(?,?,?,?,?,'approved',?,'{}')").run(randomUUID(),f.request.brandId,f.request.runId,stage.key,fingerprint,id);
   }
  }
  f.db.prepare("UPDATE runs SET status='waiting-approval',current_step=? WHERE id=?").run(pending,f.request.runId);
  const before=state(f.db),view=await runtime.get(f.request);
  assert.equal(view.quality.status,'blocked');assert.notEqual(view.quality.status,'passed');assert.deepEqual(state(f.db),before);
  // Missing execution evidence blocks the chain; it never turns an approval into a review.
  assert.ok(view.diagnostics.some(d=>d.code==='RUN_STATE_INCONSISTENT'||d.code==='QUALITY_EVIDENCE_INCOMPLETE'));
 }
});
test('Q04 unknown snapshot combinations fail closed rather than falling back to seven stages',async t=>{
 const {qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),f=await qualityStateFixture(t),{createRunRuntime}=await import('../../src/application/run-runtime.mjs');
 const snapshot={...f.snapshot,pipelineVersion:1},id=randomUUID();f.db.prepare('INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES(?,?,1,?,?)').run(id,f.request.brandId,JSON.stringify(snapshot),'a'.repeat(64));
 await assert.rejects((await createRunRuntime({root:f.dataDir,db:f.db})).get({...f.request,runId:id}),{code:'RUN_CONTRACT_UNSUPPORTED'});
});
