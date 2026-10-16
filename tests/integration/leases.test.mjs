import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {initializeWorkspace,openWorkspace} from '../../src/infrastructure/sqlite/database.mjs';
import {acquireMaintenance,releaseMaintenance} from '../../src/infrastructure/sqlite/maintenance.mjs';
import {canonicalHash,canonicalJson} from '../../src/domain/canonical-json.mjs';
import {runOperation} from '../../src/application/operation-runner.mjs';

const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function api(){
 const value=await import('../../src/application/run-lease.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
 assert.equal(typeof value.acquireRunLease,'function','T14 lease coordination must exist');
 return value;
}
function clock(start=1000){
 let time=start,id=0;const timers=new Map();
 return {now:()=>time,set:value=>{time=value;},setInterval(fn,interval){const key=++id;timers.set(key,{fn,interval});return key;},clearInterval:key=>timers.delete(key),
  tick(){for(const timer of [...timers.values()])timer.fn();},get timers(){return [...timers.values()];}};
}
async function fixture(t,{version=2,schemaVersion=version}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'carousel-t14 memória ')),db=await initializeWorkspace(root,{schemaVersion}),connections=[db];
 t.after(async()=>{for(const connection of connections.reverse())if(connection.open)connection.close();await rm(root,{recursive:true,force:true});});
 // Only contract identity is relevant to coordination; no synthetic approval or render is produced.
 const renderer={id:version===2?'editorial-composed@1':'legacy-panorama@1'},snapshot={schemaVersion:version,contractVersion:version,canonicalVersion:1,renderer,runtime:{renderer},...(version===2?{pipelineVersion:2,qualityPolicyVersion:1}:{})};
 db.prepare('INSERT INTO brands(id) VALUES(?)').run(A);
 db.prepare("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES(?,1,'{}',?,'user-confirmed')").run(A,'a'.repeat(64));
 db.prepare("INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash,status,current_step) VALUES(?,?,1,?,?,'ready',?)").run(B,A,canonicalJson(snapshot),canonicalHash(snapshot),version===2?'preview-render':'render');
 const c=clock(),request={brandId:A,runId:B,owner:'executor-one',stage:version===2?'preview-render':'render'};
 return {root,db,connections,clock:c,request,options:{clock:c},leaseApi:await api()};
}
function operation(lease,requestId=randomUUID()) {return {requestId,operation:'synthetic.publish',brandId:lease.brandId,runId:lease.runId,payload:{fixture:true}};}
function publish({db,emit}) {db.prepare('UPDATE runs SET version=version+1 WHERE id=?').run(B);emit({id:randomUUID(),eventType:'synthetic.published'});return {status:'committed',result:{version:db.prepare('SELECT version FROM runs WHERE id=?').get(B).version}};}
const counts=db=>[db.prepare('SELECT version FROM runs WHERE id=?').get(B).version,db.prepare('SELECT count(*) n FROM operations').get().n,db.prepare('SELECT count(*) n FROM run_events').get().n];

test('lease owns one run for exactly 60 seconds and cannot be reacquired while valid',async t=>{
 const f=await fixture(t),{acquireRunLease,RUN_LEASE_TTL_MS,RUN_LEASE_HEARTBEAT_MS}=f.leaseApi;
 assert.equal(RUN_LEASE_TTL_MS,60000);assert.equal(RUN_LEASE_HEARTBEAT_MS,10000);
 const lease=acquireRunLease(f.db,f.request,f.options);
 assert.deepEqual(lease,{brandId:A,runId:B,owner:f.request.owner,fencingToken:1,expiresAt:61000});assert.equal(Object.isFrozen(lease),true);
 for(const owner of ['executor-two',f.request.owner])assert.throws(()=>acquireRunLease(f.db,{...f.request,owner},f.options),{code:'RUN_LEASE_HELD'});
 assert.deepEqual(counts(f.db),[1,0,0]);assert.equal(f.db.inTransaction,false);
});

test('renewal keeps token; release clears possession; next acquisition increases fencing token',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options);f.clock.set(11000);
 const renewed=a.renewRunLease(f.db,lease,f.options);assert.equal(renewed.expiresAt,71000);assert.equal(renewed.fencingToken,lease.fencingToken);
 a.releaseRunLease(f.db,lease,f.options);
 assert.equal(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner,null);
 const fresh=a.acquireRunLease(f.db,f.request,f.options);assert.equal(fresh.fencingToken,2);
 for(const fn of [()=>a.renewRunLease(f.db,lease,f.options),()=>a.releaseRunLease(f.db,lease,f.options),()=>a.revokeRunLease(f.db,lease,f.options)])assert.throws(fn,{code:'RUN_LEASE_LOST'});
});

for(const stage of ['preview-render','render']){
 test(`${stage}: expiry and same-owner takeover block old commits, renewal and release`,async t=>{
  const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,{...f.request,stage},f.options);f.clock.set(61000);
  assert.throws(()=>a.commitRunLease(f.db,lease,operation(lease),publish,f.options),{code:'RUN_LEASE_LOST'});
  const fresh=a.acquireRunLease(f.db,{...f.request,stage},f.options);assert.equal(fresh.fencingToken,2);
  for(const fn of [()=>a.commitRunLease(f.db,lease,operation(lease),publish,f.options),()=>a.renewRunLease(f.db,lease,f.options),()=>a.releaseRunLease(f.db,lease,f.options)])assert.throws(fn,{code:'RUN_LEASE_LOST'});
  assert.deepEqual(counts(f.db),[1,0,0]);assert.deepEqual(a.commitRunLease(f.db,fresh,operation(fresh),publish,f.options),{version:2});
 });
 test(`${stage}: revocation fences an executor before expiry`,async t=>{
  const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,{...f.request,stage},f.options);
  a.revokeRunLease(f.db,lease,f.options);assert.deepEqual(f.db.prepare('SELECT lease_owner,lease_expires_at,fencing_token FROM runs').get(),{lease_owner:null,lease_expires_at:null,fencing_token:2});
  assert.throws(()=>a.commitRunLease(f.db,lease,operation(lease),publish,f.options),{code:'RUN_LEASE_LOST'});assert.deepEqual(counts(f.db),[1,0,0]);
 });
}

test('fenced commits compare scoped owner and token inside their transaction and persist idempotently',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options);
 assert.throws(()=>a.assertRunLeaseOwned(f.db,lease,f.options),{code:'TRANSACTION_REQUIRED'});
 for(const forged of [{...lease,owner:'other'},{...lease,fencingToken:2}])assert.throws(()=>a.commitRunLease(f.db,forged,operation(forged),publish,f.options),{code:'RUN_LEASE_LOST'});
 assert.throws(()=>a.commitRunLease(f.db,lease,{...operation(lease),runId:A},publish,f.options),{code:'INVALID_ARGUMENT'});
 const request=operation(lease),result=a.commitRunLease(f.db,lease,request,ctx=>{assert.equal(f.db.inTransaction,true);return publish(ctx);},f.options);
 assert.deepEqual(result,{version:2});assert.deepEqual(a.commitRunLease(f.db,lease,request,()=>assert.fail('replayed mutation'),f.options),result);assert.deepEqual(counts(f.db),[2,1,1]);
 assert.throws(()=>a.commitRunLease(f.db,lease,{...request,payload:{different:true}},publish,f.options),{code:'IDEMPOTENCY_CONFLICT'});
});

test('expiration during a short commit rolls back state, event and idempotency result',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options),request=operation(lease);
 assert.throws(()=>a.commitRunLease(f.db,lease,request,ctx=>{const result=publish(ctx);f.clock.set(61000);return result;},f.options),{code:'RUN_LEASE_LOST'});
 assert.deepEqual(counts(f.db),[1,0,0]);assert.equal(f.db.inTransaction,false);
 const fresh=a.acquireRunLease(f.db,f.request,f.options);assert.deepEqual(a.commitRunLease(f.db,fresh,request,publish,f.options),{version:2});
});

test('expiry while persisting the operation result is checked before the protected commit',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options);
 // Real SQLite work occurs after the service callback. Advance only the injected
 // clock at that point, proving a guard before persistence would be too early.
 f.db.function('expire_lease_for_test',()=>{f.clock.set(61000);return 1;});
 f.db.exec('CREATE TEMP TRIGGER expire_on_result AFTER INSERT ON operations BEGIN SELECT expire_lease_for_test(); END;');
 assert.throws(()=>a.commitRunLease(f.db,lease,operation(lease),publish,f.options),{code:'RUN_LEASE_LOST'});
 assert.deepEqual(counts(f.db),[1,0,0]);assert.equal(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner,lease.owner);
});

test('a callback cannot revoke its lease then commit; every protected effect rolls back',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options);
 assert.throws(()=>a.commitRunLease(f.db,lease,operation(lease),ctx=>{const result=publish(ctx);f.db.prepare('UPDATE runs SET fencing_token=fencing_token+1 WHERE id=?').run(B);return result;},f.options),{code:'RUN_LEASE_LOST'});
 assert.deepEqual(counts(f.db),[1,0,0]);assert.equal(f.db.prepare('SELECT fencing_token FROM runs').get().fencing_token,lease.fencingToken);
});

test('async, pending and nested callbacks cannot publish protected results',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options);let called=false;
 assert.throws(()=>a.commitRunLease(f.db,lease,operation(lease),async()=>{called=true;},f.options),{code:'INVALID_OPERATION_CALLBACK'});assert.equal(called,false);
 assert.throws(()=>a.commitRunLease(f.db,lease,operation(lease),ctx=>{publish(ctx);return {status:'pending',result:{}};},f.options),{code:'OPERATION_NOT_COMMITTED'});
 assert.throws(()=>f.db.transaction(()=>a.acquireRunLease(f.db,f.request,f.options))(),{code:'NESTED_TRANSACTION'});
 assert.deepEqual(counts(f.db),[1,0,0]);
});

test('maintenance and lease acquisition exclude each other; heavy work leaves no transaction open',async t=>{
 const f=await fixture(t),a=f.leaseApi,other=await openWorkspace(f.root,{readonly:false});f.connections.push(other);
 const lock=acquireMaintenance(other,{owner:'backup',purpose:'test',now:f.clock.now});
 assert.throws(()=>a.acquireRunLease(f.db,f.request,f.options),{code:'WORKSPACE_MAINTENANCE'});releaseMaintenance(other,lock,{now:f.clock.now});
 const lease=a.acquireRunLease(f.db,f.request,f.options);assert.equal(f.db.inTransaction,false);
 await writeFile(path.join(f.root,'synthetic-prepared-output.txt'),'prepared outside transaction');
 other.transaction(()=>other.prepare('UPDATE brands SET current_revision=1 WHERE id=?').run(A)).immediate();
 assert.throws(()=>acquireMaintenance(other,{owner:'backup',purpose:'test',now:f.clock.now}),{code:'WORKSPACE_BUSY'});
 a.commitRunLease(f.db,lease,operation(lease),publish,f.options);
 assert.equal(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner,null);
 const fresh=acquireMaintenance(other,{owner:'backup',purpose:'test',now:f.clock.now});assert.equal(fresh.owner,'backup');
});

test('human review and approval never acquire leases or render attempts',async t=>{
 const f=await fixture(t),a=f.leaseApi;
 for(const stage of ['preview-review','quality-review','preview-approval','copy-approval','inputs'])assert.throws(()=>a.acquireRunLease(f.db,{...f.request,stage},f.options),{code:'RUN_LEASE_NOT_REQUIRED'});
 f.db.prepare("UPDATE runs SET status='waiting-approval',current_step='preview-review' WHERE id=?").run(B);
 assert.throws(()=>a.acquireRunLease(f.db,f.request,f.options),{code:'RUN_NOT_EXECUTABLE'});
 assert.equal(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner,null);assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM approvals').get().n,0);
});

test('publication releases the lease atomically before human review begins',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options);
 a.commitRunLease(f.db,lease,operation(lease),({db})=>{db.prepare("UPDATE runs SET status='waiting-approval',current_step='preview-review' WHERE id=?").run(B);return {status:'committed',result:{status:'waiting-approval'}};},f.options);
 assert.deepEqual(f.db.prepare('SELECT status,current_step,lease_owner,lease_expires_at FROM runs').get(),{status:'waiting-approval',current_step:'preview-review',lease_owner:null,lease_expires_at:null});
 const lock=acquireMaintenance(f.db,{owner:'backup',purpose:'test',now:f.clock.now});assert.equal(lock.owner,'backup');
});

test('leases never reopen terminal, blocked, draft or interrupted runs',async t=>{
 const f=await fixture(t),a=f.leaseApi;
 for(const status of ['completed','cancelled','blocked','draft','interrupted']){f.db.prepare('UPDATE runs SET status=? WHERE id=?').run(status,B);assert.throws(()=>a.acquireRunLease(f.db,f.request,f.options),{code:'RUN_NOT_EXECUTABLE'});}
});

test('contract identity and scope are checked; activated v1 requires derivation',async t=>{
 const legacy=await fixture(t,{version:1}),a=legacy.leaseApi;
 assert.throws(()=>a.acquireRunLease(legacy.db,{...legacy.request,stage:'preview-render'},legacy.options),{code:'INVALID_ARGUMENT'});
 const lease=a.acquireRunLease(legacy.db,legacy.request,legacy.options);assert.equal(lease.fencingToken,1);
 const activated=await fixture(t,{version:1,schemaVersion:2});assert.throws(()=>a.acquireRunLease(activated.db,activated.request,activated.options),{code:'RUN_DERIVATION_REQUIRED'});
 const f=await fixture(t);assert.throws(()=>a.acquireRunLease(f.db,{...f.request,brandId:B},f.options),{code:'RUN_NOT_FOUND'});
 f.db.prepare('UPDATE brands SET status=? WHERE id=?').run('archived',A);assert.throws(()=>a.acquireRunLease(f.db,f.request,f.options),{code:'BRAND_ARCHIVED'});
});

test('invalid clocks, overflow and exhausted fencing tokens fail without modifying the run',async t=>{
 const f=await fixture(t),a=f.leaseApi;
 for(const time of [-1,NaN,1.5,Number.MAX_SAFE_INTEGER]){f.clock.set(time);assert.throws(()=>a.acquireRunLease(f.db,f.request,f.options),{code:'INVALID_ARGUMENT'});}
 f.clock.set(1000);f.db.prepare('UPDATE runs SET fencing_token=? WHERE id=?').run(Number.MAX_SAFE_INTEGER,B);
 assert.throws(()=>a.acquireRunLease(f.db,f.request,f.options),{code:'RUN_FENCING_EXHAUSTED'});assert.equal(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner,null);
});

test('heartbeat renews every 10 seconds, stops on lease loss and cancels its timer',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options),heartbeat=a.startRunLeaseHeartbeat(f.db,lease,f.options);
 assert.equal(f.clock.timers.length,1);assert.equal(f.clock.timers[0].interval,10000);f.clock.set(11000);f.clock.tick();
 assert.equal(heartbeat.lease.expiresAt,71000);assert.equal(heartbeat.signal.aborted,false);
 a.revokeRunLease(f.db,lease,f.options);f.clock.set(21000);f.clock.tick();
 assert.equal(heartbeat.signal.aborted,true);assert.equal(heartbeat.signal.reason.code,'RUN_LEASE_LOST');assert.equal(f.clock.timers.length,0);heartbeat.stop();
 const fresh=a.acquireRunLease(f.db,f.request,f.options),next=a.startRunLeaseHeartbeat(f.db,fresh,f.options);next.stop();next.stop();assert.equal(f.clock.timers.length,0);
 f.clock.set(31000);f.clock.tick();assert.equal(f.db.prepare('SELECT lease_expires_at FROM runs').get().lease_expires_at,fresh.expiresAt);
});

test('a paused heartbeat cannot resurrect an expired lease',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options),heartbeat=a.startRunLeaseHeartbeat(f.db,lease,f.options);
 f.clock.set(61000);f.clock.tick();assert.equal(heartbeat.signal.aborted,true);assert.equal(heartbeat.signal.reason.code,'RUN_LEASE_LOST');assert.equal(f.clock.timers.length,0);
});

test('default system clock uses epoch time and a stoppable real heartbeat',async t=>{
 const f=await fixture(t),a=f.leaseApi,before=Date.now(),lease=a.acquireRunLease(f.db,f.request),after=Date.now();
 assert.ok(lease.expiresAt>=before+60000&&lease.expiresAt<=after+60000);
 const heartbeat=a.startRunLeaseHeartbeat(f.db,lease);assert.equal(heartbeat.signal.aborted,false);heartbeat.stop();
 a.releaseRunLease(f.db,lease);
});

test('revocation composes with a trusted transaction and rolls back with related state',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options);
 assert.equal(typeof a.revokeRunLeaseInTransaction,'function','T14 revocation must compose atomically');
 assert.throws(()=>a.revokeRunLeaseInTransaction(f.db,lease,f.options),{code:'TRANSACTION_REQUIRED'});
 assert.throws(()=>f.db.transaction(()=>{a.revokeRunLeaseInTransaction(f.db,lease,f.options);f.db.prepare("UPDATE runs SET status='interrupted' WHERE id=?").run(B);throw new Error('injected rollback');}).immediate(),/injected rollback/);
 assert.equal(f.db.prepare('SELECT lease_owner FROM runs').get().lease_owner,lease.owner);
 f.db.transaction(()=>{a.revokeRunLeaseInTransaction(f.db,lease,f.options);f.db.prepare("UPDATE runs SET status='interrupted' WHERE id=?").run(B);}).immediate();
 assert.deepEqual(f.db.prepare('SELECT status,lease_owner,fencing_token FROM runs').get(),{status:'interrupted',lease_owner:null,fencing_token:2});
 assert.throws(()=>a.commitRunLease(f.db,lease,operation(lease),publish,f.options),{code:'RUN_LEASE_LOST'});
});

test('schema is rechecked for renewal, release, revocation and final publication',async t=>{
 const f=await fixture(t),a=f.leaseApi,lease=a.acquireRunLease(f.db,f.request,f.options);f.db.pragma('user_version=3');
 for(const invoke of [()=>a.acquireRunLease(f.db,f.request,f.options),()=>a.renewRunLease(f.db,lease,f.options),()=>a.releaseRunLease(f.db,lease,f.options),()=>a.revokeRunLease(f.db,lease,f.options),()=>a.commitRunLease(f.db,lease,operation(lease),publish,f.options)])assert.throws(invoke,{code:'SCHEMA_TOO_NEW'});
 assert.deepEqual(counts(f.db),[1,0,0]);
});

test('final commit guard rejects async functions before mutation and thenables with rollback',async t=>{
 const f=await fixture(t);let called=false;
 assert.throws(()=>runOperation(f.db,operation(f.request),()=>{called=true;return publish({db:f.db,emit:()=>{}});},{now:f.clock.now,beforeCommit:async()=>{}}),{code:'INVALID_OPERATION_CALLBACK'});
 assert.equal(called,false);
 assert.throws(()=>runOperation(f.db,operation(f.request),publish,{now:f.clock.now,beforeCommit:()=>Promise.resolve()}),{code:'INVALID_OPERATION_CALLBACK'});
 assert.deepEqual(counts(f.db),[1,0,0]);
});
