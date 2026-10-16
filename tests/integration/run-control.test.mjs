import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {initializeWorkspace} from '../../src/infrastructure/sqlite/database.mjs';
import {canonicalHash,canonicalJson} from '../../src/domain/canonical-json.mjs';
import {acquireRunLease,commitRunLease} from '../../src/application/run-lease.mjs';
import {acquireMaintenance,releaseMaintenance} from '../../src/infrastructure/sqlite/maintenance.mjs';
import {transitionRun} from '../../src/domain/run-state-machine.mjs';

const brandId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',runId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function api(){const m=await import('../../src/application/run-control.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});assert.equal(typeof m.createRunControl,'function','T17 run control service must exist');return m;}
async function fixture(t,{stage='preview-render',status='running',version=2,schemaVersion=version,signalAttempt}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'carousel-t17 control ')),db=await initializeWorkspace(root,{schemaVersion}),cleanups=[];
 t.after(async()=>{for(const cleanup of cleanups)await cleanup();if(db.open)db.close();await rm(root,{recursive:true,force:true});});
 const renderer={id:version===2?'editorial-composed@1':'legacy-panorama@1'},snapshot={schemaVersion:version,contractVersion:version,canonicalVersion:1,renderer,runtime:{renderer},...(version===2?{pipelineVersion:2,qualityPolicyVersion:1}:{})};
 db.prepare('INSERT INTO brands(id) VALUES(?)').run(brandId);db.prepare("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES(?,1,'{}',?,'user-confirmed')").run(brandId,'a'.repeat(64));
 db.prepare("INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash,status,current_step) VALUES(?,?,1,?,?,'ready',?)").run(runId,brandId,canonicalJson(snapshot),canonicalHash(snapshot),stage);
 const clock={now:()=>1000},scope={brandId,runId},stepId=randomUUID();db.prepare('INSERT INTO steps(id,brand_id,run_id,step_key,status,fingerprint) VALUES(?,?,?,?,?,?)').run(stepId,brandId,runId,stage,status==='running'?'running':status==='waiting-approval'?'waiting-approval':'pending','b'.repeat(64));
 let lease=null,attemptId=null;
 if(status==='running'){lease=acquireRunLease(db,{...scope,owner:'synthetic-executor',stage},{clock});attemptId=randomUUID();db.prepare('INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token) VALUES(?,?,?,?,1,?,?)').run(attemptId,brandId,runId,stepId,lease.owner,lease.fencingToken);}
 db.prepare('UPDATE runs SET status=? WHERE id=?').run(status,runId);
 const service=await (await api()).createRunControl({db,clock,...(signalAttempt?{signalAttempt}:{})});
 return {root,db,scope,clock,lease,attemptId,stepId,service,cleanups,request:()=>({requestId:randomUUID(),...scope})};
}
const run=f=>f.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
const attempt=f=>f.db.prepare('SELECT * FROM step_attempts WHERE id=?').get(f.attemptId);
const count=(f,table)=>f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
function publish(f,id=randomUUID()){return commitRunLease(f.db,f.lease,{requestId:id,...f.scope,operation:'synthetic.publish',payload:{}},()=>{f.db.prepare('UPDATE runs SET version=version+1 WHERE id=?').run(runId);return {status:'committed',result:{published:true}};},{clock:f.clock});}

for(const stage of ['preview-render','render'])test(`${stage}: interrupt atomically revokes possession, ends attempt, and fences a delayed publisher`,async t=>{
 let f;const notifications=[];f=await fixture(t,{stage,signalAttempt(value){assert.equal(f.db.inTransaction,false);assert.equal(run(f).status,'interrupted');notifications.push(value);}});
 const result=await f.service.interrupt(f.request());assert.equal(result.status,'interrupted');assert.equal(result.attemptId,f.attemptId);assert.equal(result.runVersion,2);assert.equal(result.fencingToken,2);
 assert.equal(run(f).lease_owner,null);assert.equal(run(f).lease_expires_at,null);assert.equal(attempt(f).status,'interrupted');assert.equal(attempt(f).finished_at,new Date(1000).toISOString());assert.equal(attempt(f).result_artifact_id,null);
 assert.equal(f.db.prepare('SELECT status FROM steps WHERE id=?').get(f.stepId).status,'pending');assert.throws(()=>publish(f),{code:'RUN_LEASE_LOST'});assert.equal(count(f,'artifacts'),0);assert.equal(count(f,'operations'),1);assert.equal(count(f,'run_events'),1);
 assert.deepEqual(notifications,[{...f.scope,attemptId:f.attemptId,owner:f.lease.owner,fencingToken:f.lease.fencingToken,reason:'interrupted'}]);
});

test('interrupt replays exactly once and never revokes a later reconciled successor',async t=>{
 let calls=0;const f=await fixture(t,{signalAttempt(){calls++;}}),request=f.request(),result=await f.service.interrupt(request);
 assert.deepEqual(await f.service.interrupt(request),result);assert.equal(calls,1);assert.equal(count(f,'run_events'),1);
 assert.throws(()=>acquireRunLease(f.db,{...f.scope,stage:'preview-render',owner:'successor'},{clock:f.clock}),{code:'RUN_NOT_EXECUTABLE'});
 // Test-only trusted reconciliation of an empty synthetic partial. T23 owns real
 // byte verification/recovery; control never treats caller JSON as that evidence.
 f.db.prepare('UPDATE runs SET status=? WHERE id=?').run(transitionRun('interrupted',{type:'reconciled',blocked:false}),runId);
 const fresh=acquireRunLease(f.db,{...f.scope,stage:'preview-render',owner:'successor'},{clock:f.clock}),before=f.db.serialize();
 assert.deepEqual(await f.service.interrupt(request),result);assert.deepEqual(f.db.serialize(),before);assert.equal(run(f).fencing_token,fresh.fencingToken);assert.equal(calls,1);
 await assert.rejects(f.service.cancel(request),{code:'IDEMPOTENCY_CONFLICT'});
});

test('signal failure cannot roll back a durable interruption or authorize late publication',async t=>{
 let calls=0;const f=await fixture(t,{signalAttempt(){calls++;throw Error('Executor ignored signal');}}),request=f.request();
 const result=await f.service.interrupt(request);assert.equal(result.status,'interrupted');assert.throws(()=>publish(f),{code:'RUN_LEASE_LOST'});assert.deepEqual(await f.service.interrupt(request),result);assert.equal(calls,1);
});

test('cancel is terminal, records cancelled attempt, and cannot be resumed with an execution lease',async t=>{
 const f=await fixture(t),request=f.request(),result=await f.service.cancel(request);assert.equal(result.status,'cancelled');assert.equal(attempt(f).status,'cancelled');assert.equal(run(f).lease_owner,null);assert.equal(run(f).fencing_token,2);assert.deepEqual(await f.service.cancel(request),result);
 assert.throws(()=>publish(f),{code:'RUN_LEASE_LOST'});assert.throws(()=>acquireRunLease(f.db,{...f.scope,owner:'successor',stage:'preview-render'},{clock:f.clock}),{code:'RUN_NOT_EXECUTABLE'});
 await assert.rejects(f.service.interrupt(f.request()),{code:'RUN_DERIVATION_REQUIRED'});await assert.rejects(f.service.cancel(f.request()),{code:'RUN_DERIVATION_REQUIRED'});
 assert.throws(()=>transitionRun('cancelled',{type:'reconciled',blocked:false}),{code:'RUN_TRANSITION_INVALID'});
});

for(const stage of ['copy-approval','preview-review','preview-approval','quality-review'])test(`cancel invalidates pending ${stage} without manufacturing a rejection`,async t=>{
 const f=await fixture(t,{stage,status:'waiting-approval'}),pending=randomUUID(),historical=randomUUID();
 f.db.prepare('INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,status) VALUES(?,?,?,?,?,?)').run(pending,brandId,runId,stage,'c'.repeat(64),'pending');
 f.db.prepare('INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,status) VALUES(?,?,?,?,?,?)').run(historical,brandId,runId,'copy','d'.repeat(64),'confirmed');
 await f.service.cancel(f.request());assert.equal(f.db.prepare('SELECT status FROM confirmation_requests WHERE id=?').get(pending).status,'cancelled');assert.equal(f.db.prepare('SELECT status FROM confirmation_requests WHERE id=?').get(historical).status,'confirmed');assert.equal(f.db.prepare('SELECT status FROM steps WHERE id=?').get(f.stepId).status,'invalidated');assert.equal(count(f,'approvals'),0);assert.equal(count(f,'step_attempts'),0);
});

test('interrupt is execution-only; idle, waiting, blocked, and terminal runs are not silently reopened',async t=>{
 for(const status of ['draft','ready','waiting-approval','blocked','interrupted','completed']){const f=await fixture(t,{status}),before=f.db.serialize();await assert.rejects(f.service.interrupt(f.request()),{code:status==='completed'?'RUN_TERMINAL':'RUN_NOT_INTERRUPTIBLE'});assert.deepEqual(f.db.serialize(),before);}
});

test('cancel works from each idle nonterminal state without a lease',async t=>{
 for(const status of ['draft','ready','blocked','interrupted']){const f=await fixture(t,{status});assert.equal((await f.service.cancel(f.request())).status,'cancelled');assert.equal(run(f).lease_owner,null);assert.equal(count(f,'step_attempts'),0);}
});

test('maintenance rolls back control; an exact replay remains a read during maintenance',async t=>{
 const f=await fixture(t,{status:'ready'}),request=f.request(),lock=acquireMaintenance(f.db,{owner:'backup',purpose:'test',now:f.clock.now}),before=f.db.serialize();await assert.rejects(f.service.cancel(request),{code:'WORKSPACE_MAINTENANCE'});assert.deepEqual(f.db.serialize(),before);releaseMaintenance(f.db,lock,{now:f.clock.now});const result=await f.service.cancel(request),next=acquireMaintenance(f.db,{owner:'backup',purpose:'test',now:f.clock.now});assert.deepEqual(await f.service.cancel(request),result);releaseMaintenance(f.db,next,{now:f.clock.now});
});

test('a failed operation insert rolls back revocation, attempt, step and run without signaling',async t=>{
 let calls=0;const f=await fixture(t,{signalAttempt(){calls++;}}),before=f.db.serialize();f.db.exec("CREATE TEMP TRIGGER fail_control BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT,'synthetic interruption failure'); END;");await assert.rejects(f.service.interrupt(f.request()),/synthetic interruption failure/);assert.deepEqual(f.db.serialize(),before);assert.equal(calls,0);
});

async function worker(t,f){
 const root=f.root;
 const {fork}=await import('node:child_process'),{fileURLToPath}=await import('node:url'),child=fork(fileURLToPath(new URL('../helpers/run-control-worker.mjs',import.meta.url)),[root],{stdio:['ignore','ignore','pipe','ipc']});
 const pending=[],queued=[];let stderr='',exited=false;child.stderr.on('data',data=>stderr+=data);
 child.on('message',message=>{const at=pending.findIndex(p=>p.type===message.type);if(at<0)queued.push(message);else{const [p]=pending.splice(at,1);clearTimeout(p.timer);p.resolve(message);}});
 const closed=new Promise(resolve=>{child.once('exit',()=>{exited=true;for(const p of pending){clearTimeout(p.timer);p.reject(Error(stderr||'Worker exited'));}resolve();});});
 const wait=type=>{const at=queued.findIndex(m=>m.type===type);if(at>=0)return Promise.resolve(queued.splice(at,1)[0]);return new Promise((resolve,reject)=>{const p={type,resolve,reject};p.timer=setTimeout(()=>reject(Error(`Timed out waiting for ${type}: ${stderr}`)),10000);pending.push(p);});};
 f.cleanups.push(async()=>{if(exited)return;const timer=setTimeout(()=>child.kill(),1000);try{child.send({type:'stop'});await closed;}finally{clearTimeout(timer);}assert.equal(child.connected,false);});
 await wait('ready');return {child,wait,async send(message,type='result'){const ready=wait(type);child.send(message);return ready;}};
}

for(const kind of ['interrupt','cancel'])for(const stage of ['preview-render','render'])test(`${kind} ${stage}: a live process ignores the signal but cannot publish with its original lease`,async t=>{
 const f=await fixture(t,{stage}),old=await worker(t,f);await old.send({type:'arm',lease:f.lease},'armed');
 const service=(await api()).createRunControl({db:f.db,clock:f.clock,signalAttempt(){old.child.send({type:'signal'});}}),request=f.request(),result=await service[kind](request);await old.wait('ignored');
 const before=f.db.serialize(),late=await old.send({type:'publish',requestId:randomUUID(),attemptId:f.attemptId});assert.deepEqual(late,{type:'result',ok:false,code:'RUN_LEASE_LOST'});assert.deepEqual(f.db.serialize(),before);assert.equal(count(f,'artifacts'),0);assert.equal(count(f,'run_events'),1);
 assert.deepEqual(await old.send({type:'replay',kind,request}),{type:'result',ok:true,result});assert.deepEqual(f.db.serialize(),before);
});

test('a genuine local approval displayed before cancel cannot commit afterward',async t=>{
 const {qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),{createApprovals}=await import('../../src/application/approvals.mjs'),{confirmApprovalProposal}=await import('../../src/interfaces/cli/human-confirmation.mjs');
 const f=await qualityStateFixture(t),saved=await f.save();await f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan:f.plan(saved)});
 const approvals=await createApprovals({root:f.dataDir,db:f.db}),pending=await approvals.request({requestId:randomUUID(),...f.request,kind:'copy'}),receipt=await confirmApprovalProposal(pending.proposal,{input:{isTTY:true},output:{isTTY:true,write(){}},argv:[],ask:async()=>'CONFIRMAR'});
 const service=(await api()).createRunControl({db:f.db});await service.cancel({requestId:randomUUID(),...f.request});const before=f.db.serialize();await assert.rejects(approvals.decide({requestId:randomUUID(),proposal:pending.proposal,decision:'approved'},receipt),{code:'RUN_NOT_APPROVABLE'});assert.deepEqual(f.db.serialize(),before);assert.equal(count(f,'approvals'),0);assert.equal(f.db.prepare('SELECT status FROM confirmation_requests WHERE id=?').get(pending.proposal.confirmationRequestId).status,'cancelled');
});

test('operation-result trigger cannot reopen possession after control mutation',async t=>{
 const f=await fixture(t),before=f.db.serialize();f.db.exec("CREATE TEMP TRIGGER reopen_control AFTER INSERT ON operations WHEN NEW.operation='run.interrupt' BEGIN UPDATE runs SET lease_owner='late',lease_expires_at=60000,status='running'; END;");await assert.rejects(f.service.interrupt(f.request()),{code:'RUN_STATE_INCONSISTENT'});assert.deepEqual(f.db.serialize(),before);
});

test('cancel revokes a lease acquired before its execution attempt was registered',async t=>{
 const f=await fixture(t,{status:'ready'}),lease=acquireRunLease(f.db,{...f.scope,owner:'reserved',stage:'preview-render'},{clock:f.clock});f.lease=lease;const result=await f.service.cancel(f.request());assert.equal(result.attemptId,null);assert.equal(result.fencingToken,lease.fencingToken+1);assert.throws(()=>publish(f),{code:'RUN_LEASE_LOST'});
});

test('invalid request fields, wrong scope, contract mismatch, and exhausted counters fail without mutation',async t=>{
 const f=await fixture(t),before=f.db.serialize();for(const extra of [{actor:'user'},{fencingToken:1},{status:'ready'},{reason:'cancel'},{reconciled:true}])await assert.rejects(f.service.interrupt({...f.request(),...extra}),{code:'INVALID_ARGUMENT'});
 await assert.rejects(f.service.interrupt({...f.request(),brandId:randomUUID()}),{code:'RUN_NOT_FOUND'});assert.deepEqual(f.db.serialize(),before);
 f.db.prepare('UPDATE runs SET fencing_token=? WHERE id=?').run(Number.MAX_SAFE_INTEGER,runId);f.db.prepare('UPDATE step_attempts SET fencing_token=? WHERE id=?').run(Number.MAX_SAFE_INTEGER,f.attemptId);const exhausted=f.db.serialize();await assert.rejects(f.service.interrupt(f.request()),{code:'RUN_FENCING_EXHAUSTED'});assert.deepEqual(f.db.serialize(),exhausted);
 const legacy=await fixture(t,{status:'ready',version:1,schemaVersion:2,stage:'render'});await assert.rejects(legacy.service.cancel(legacy.request()),{code:'RUN_DERIVATION_REQUIRED'});
});

test('unsafe run version and out-of-range timestamp are typed errors without mutation',async t=>{
 const f=await fixture(t);f.db.prepare('UPDATE runs SET version=? WHERE id=?').run(Number.MAX_SAFE_INTEGER,runId);const before=f.db.serialize();await assert.rejects(f.service.interrupt(f.request()),{code:'RUN_VERSION_EXHAUSTED'});assert.deepEqual(f.db.serialize(),before);
 f.db.prepare('UPDATE runs SET version=1 WHERE id=?').run(runId);const clock={now:()=>Number.MAX_SAFE_INTEGER},service=(await api()).createRunControl({db:f.db,clock}),clockBefore=f.db.serialize();await assert.rejects(service.interrupt(f.request()),{code:'INVALID_ARGUMENT'});assert.deepEqual(f.db.serialize(),clockBefore);
});

test('internal control resource is present without exposing a public CLI stop or grant operation',async()=>{
 const {loadResourcesManifest}=await import('../../src/infrastructure/resources.mjs'),manifest=await loadResourcesManifest();assert.ok(manifest.requiredFiles.includes('src/application/run-control.mjs'));
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{stdout,stderr}=await promisify(execFile)(process.execPath,['bin/peterson-carousel.mjs','--help'],{cwd:new URL('../../',import.meta.url)});assert.equal(/interrupt|cancel|approve|grant/.test(stdout+stderr),false);
});

test('control diagnostics keep both frozen renderer dependency hashes coherent',async()=>{
 const {inspectPackage}=await import('../../src/infrastructure/resources.mjs');for(const rendererId of ['legacy-panorama@1','editorial-composed@1']){const report=await inspectPackage({rendererId});assert.deepEqual(report.diagnostics.filter(d=>d.code==='RUNTIME_MISMATCH'),[]);}
});

test('required run control declares its lease and clock transitive dependencies',async()=>{
 const {loadResourcesManifest}=await import('../../src/infrastructure/resources.mjs'),manifest=await loadResourcesManifest();for(const file of ['src/application/run-lease.mjs','src/infrastructure/clock.mjs'])assert.ok(manifest.requiredFiles.includes(file),`${file} must be a required diagnostic resource`);
});

async function copiedDiagnosticPackage(t){
 const {mkdir,readFile,writeFile}=await import('node:fs/promises'),{loadResourcesManifest}=await import('../../src/infrastructure/resources.mjs'),manifest=await loadResourcesManifest(),root=await mkdtemp(path.join(os.tmpdir(),'carousel-t17 package '));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const file of new Set([...manifest.requiredFiles,...manifest.renderers.flatMap(r=>r.files)])){const dest=path.join(root,file);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,await readFile(new URL(`../../${file}`,import.meta.url)));}return {root,manifest};
}

test('missing transitive lease or clock is diagnosed before a control package is usable',async t=>{
 const {readFile,writeFile}=await import('node:fs/promises'),{inspectPackage}=await import('../../src/infrastructure/resources.mjs'),f=await copiedDiagnosticPackage(t);
 for(const file of ['src/application/run-lease.mjs','src/infrastructure/clock.mjs']){const target=path.join(f.root,file),original=await readFile(target);await rm(target);const view=await inspectPackage({packageRoot:f.root,manifest:f.manifest});assert.ok(view.diagnostics.some(d=>d.code==='PACKAGE_INCOMPLETE'&&d.resource===file));await writeFile(target,original);}
});

test('lease and clock byte changes are part of saved executable identity and block a stale plan',async t=>{
 const {readFile,writeFile}=await import('node:fs/promises'),{qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),copy=await copiedDiagnosticPackage(t),f=await qualityStateFixture(t,{packageRoot:copy.root}),saved=await f.save();
 for(const file of ['src/application/run-lease.mjs','src/infrastructure/clock.mjs']){assert.ok(saved.executable.files[file]);const target=path.join(copy.root,file),original=await readFile(target);await writeFile(target,Buffer.concat([original,Buffer.from('\n// Synthetic tamper') ]));await assert.rejects(f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan:f.plan(saved)}),{code:'RUNTIME_MISMATCH'});await writeFile(target,original);}
});

async function approvalExecutionFixture(t){
 const {qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),{createApprovals}=await import('../../src/application/approvals.mjs'),{confirmApprovalProposal}=await import('../../src/interfaces/cli/human-confirmation.mjs');
 const f=await qualityStateFixture(t),saved=await f.save();f.ready=await f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan:f.plan(saved)});const approvals=await createApprovals({root:f.dataDir,db:f.db});
 for(const kind of ['copy','concept']){const pending=await approvals.request({requestId:randomUUID(),...f.request,kind}),receipt=await confirmApprovalProposal(pending.proposal,{input:{isTTY:true},output:{isTTY:true,write(){}},argv:[],ask:async()=>'CONFIRMAR'});await approvals.decide({requestId:randomUUID(),proposal:pending.proposal,decision:'approved'},receipt);}await approvals.request({requestId:randomUUID(),...f.request,kind:'creative-assets'});
 const stage='preview-render',lease=acquireRunLease(f.db,{...f.request,stage,owner:'test-executor'}),stepId=f.step(stage,'running',f.ready.fingerprints[stage]),attemptId=randomUUID();f.db.prepare('INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token) VALUES(?,?,?,?,1,?,?)').run(attemptId,f.request.brandId,f.request.runId,stepId,lease.owner,lease.fencingToken);f.db.prepare("UPDATE runs SET status='running' WHERE id=?").run(f.request.runId);
 return {...f,lease,attemptId,control:(await api()).createRunControl({db:f.db})};
}

test('runtime reads actual interruption without reopening it, while input and plan edits await reconciliation',async t=>{
 const f=await approvalExecutionFixture(t);await f.control.interrupt({requestId:randomUUID(),...f.request});const {createRunRuntime}=await import('../../src/application/run-runtime.mjs'),runtime=await createRunRuntime({root:f.dataDir,db:f.db}),before=f.db.serialize(),view=await runtime.resume(f.request);
 assert.equal(view.status,'interrupted');assert.equal(view.terminal,false);assert.equal(view.pending.code,'RECONCILIATION_REQUIRED');assert.equal(view.nextAction.type,'reconcile-run');assert.deepEqual(view.nextAction.requires,['T23']);assert.equal(view.results.length,0);assert.equal(view.diagnostics.some(d=>d.code==='RUN_STATE_INCONSISTENT'),false);assert.deepEqual(await runtime.resume(f.request),view);assert.deepEqual(f.db.serialize(),before);
 await assert.rejects(f.inputs.save({requestId:randomUUID(),...f.request,expectedVersion:view.version}),{code:'RUN_NOT_EDITABLE'});await assert.rejects(f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:view.version,plan:f.plan(f.ready)}),{code:'RUN_NOT_EDITABLE'});assert.deepEqual(f.db.serialize(),before);
});

test('actual cancellation offers derive and a legitimate derived run receives no historical consent',async t=>{
 const f=await approvalExecutionFixture(t);await f.control.cancel({requestId:randomUUID(),...f.request});const {createRunRuntime}=await import('../../src/application/run-runtime.mjs'),view=await (await createRunRuntime({root:f.dataDir,db:f.db})).resume(f.request);assert.equal(view.status,'cancelled');assert.equal(view.nextAction.type,'derive-run');assert.equal(view.terminal,true);
 const {loadResourcesManifest}=await import('../../src/infrastructure/resources.mjs'),{runDoctor}=await import('../../src/application/doctor.mjs'),{qualitySnapshotFixture}=await import('../fixtures/quality/snapshot-fixture.mjs'),{createRunService}=await import('../../src/application/run-service.mjs'),manifest=await loadResourcesManifest();Object.assign(manifest.qualifiedRuntime,{node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules});
 const options={dataDir:f.dataDir,manifest},runtime=(await runDoctor({...options,rendererId:'editorial-composed@1'})).runtime,{qualityResources}=await qualitySnapshotFixture({runtime,manifest,config:f.snapshot.brand.config}),service=createRunService(f.db,{...options,qualityResources}),derived=await service.derive({requestId:randomUUID(),brandId:f.request.brandId,brandRevision:1,theme:'synthetic',parentRunId:f.request.runId});
 assert.equal(derived.status,'draft');assert.equal(derived.parentRunId,f.request.runId);assert.notEqual(derived.id,f.request.runId);assert.deepEqual(derived.approvals,[]);assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_requests WHERE run_id=?').get(derived.id).n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts WHERE run_id=?').get(derived.id).n,0);assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(f.request.runId).status,'cancelled');assert.equal(f.db.prepare('SELECT count(*) n FROM approvals WHERE run_id=?').get(f.request.runId).n,2);
});

test('an asynchronous notifier cannot hold control open and retains the exact old attempt identity',async t=>{
 let unblock,started;const pending=new Promise(resolve=>{unblock=resolve;}),f=await fixture(t,{signalAttempt:async identity=>{started=identity;await pending;}}),result=await f.service.interrupt(f.request());assert.equal(result.status,'interrupted');assert.ok(Object.isFrozen(started));
 f.db.prepare("UPDATE runs SET status='ready' WHERE id=?").run(runId);const successor=acquireRunLease(f.db,{...f.scope,stage:'preview-render',owner:f.lease.owner},{clock:f.clock});assert.equal(started.fencingToken,f.lease.fencingToken);assert.notEqual(started.fencingToken,successor.fencingToken);assert.equal(started.attemptId,f.attemptId);unblock();await pending;assert.equal(run(f).fencing_token,successor.fencingToken);
});

test('T16 integration: reconciled interruption permits a scoped revision without losing valid copy consent',async t=>{
 const f=await approvalExecutionFixture(t),oldApprovals=f.db.prepare('SELECT * FROM approvals WHERE run_id=? ORDER BY id').all(f.request.runId);await f.control.interrupt({requestId:randomUUID(),...f.request});
 const oldAttempt=f.db.prepare('SELECT * FROM step_attempts WHERE id=?').get(f.attemptId),carousel=await f.inputs.resolveArtifact(f.request.brandId,f.request.runId,f.ready.artifacts.carousel.id),concept=await f.file('reconciled-direction.md','Explicit changed direction after reconciliation');
 // Test-only reconciliation boundary: no partial output was registered. T23
 // supplies the real byte checks before this internal state transition.
 f.db.prepare('UPDATE runs SET status=?,version=version+1 WHERE id=?').run(transitionRun('interrupted',{type:'reconciled',blocked:false}),f.request.runId);
 const version=f.db.prepare('SELECT version FROM runs WHERE id=?').get(f.request.runId).version,saved=await f.inputs.save({requestId:randomUUID(),...f.request,expectedVersion:version,carousel:{sourcePath:carousel.path,sha256:carousel.sha256},concept});
 assert.equal(saved.status,'draft');assert.equal(saved.artifacts.plan,null);assert.equal(f.db.prepare("SELECT status FROM steps WHERE run_id=? AND step_key='copy-approval'").get(f.request.runId).status,'succeeded');assert.equal(f.db.prepare("SELECT status FROM steps WHERE run_id=? AND step_key='concept-approval'").get(f.request.runId).status,'invalidated');
 const plan=f.plan(saved);plan.version=2;plan.change={kind:'material',previousPlanRef:f.ready.artifacts.plan,correctionEpisodeRef:null};await f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan});
 const {createApprovals}=await import('../../src/application/approvals.mjs'),approvals=await createApprovals({root:f.dataDir,db:f.db});assert.equal((await approvals.verify({...f.request,kind:'copy'})).id,oldApprovals.find(a=>a.kind==='copy').id);await assert.rejects(approvals.verify({...f.request,kind:'concept'}),{code:'APPROVAL_REQUIRED'});assert.equal((await approvals.request({requestId:randomUUID(),...f.request,kind:'concept'})).status,'pending');
 assert.deepEqual(f.db.prepare('SELECT * FROM step_attempts WHERE id=?').get(f.attemptId),oldAttempt);assert.deepEqual(f.db.prepare('SELECT * FROM approvals WHERE run_id=? ORDER BY id').all(f.request.runId),oldApprovals);
 assert.throws(()=>commitRunLease(f.db,f.lease,{requestId:randomUUID(),...f.request,operation:'synthetic.old.publish',payload:{}},()=>({status:'committed',result:{}})),{code:'RUN_LEASE_LOST'});
});
