import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {initializeWorkspace} from '../../src/infrastructure/sqlite/database.mjs';
import {canonicalHash,canonicalJson} from '../../src/domain/canonical-json.mjs';
import {qualitySnapshotFixture} from '../fixtures/quality/snapshot-fixture.mjs';

const workerPath=fileURLToPath(new URL('../helpers/lease-worker.mjs',import.meta.url));
const runId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const start=1000;

async function fixture(t){
 const api=await import('../../src/application/run-lease.mjs').catch(error=>{
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
  return {};
 });
 assert.equal(typeof api.acquireRunLease,'function','T14 run lease API must be available');
 const {snapshot}=await qualitySnapshotFixture();
 const root=await mkdtemp(path.join(os.tmpdir(),'carousel-t14 lease race '));
 const db=await initializeWorkspace(root,{schemaVersion:2});
 const children=[];
 t.after(async()=>{
  await Promise.all(children.map(worker=>worker.close()));
  if(db.open)db.close();
  await rm(root,{recursive:true,force:true});
 });
 const brandId=snapshot.brand.id;
 db.prepare('INSERT INTO brands(id) VALUES(?)').run(brandId);
 db.prepare("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES(?,1,?,?,'user-confirmed')")
  .run(brandId,canonicalJson(snapshot.brand.config),snapshot.brand.revisionHash);
 db.prepare('UPDATE brands SET current_revision=1 WHERE id=?').run(brandId);
 db.prepare("INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash,status,current_step) VALUES(?,?,1,?,?,'ready','render')")
  .run(runId,brandId,canonicalJson(snapshot),canonicalHash(snapshot));
 return {root,db,children,scope:{brandId,runId}};
}

async function worker(f){
 const child=fork(workerPath,[f.root],{stdio:['ignore','pipe','pipe','ipc']});
 let stderr='',ended=false;
 child.stderr.on('data',chunk=>stderr+=chunk);
 child.stdout.resume();
 const history=[],waiters=new Set();
 function settle(waiter,error,value){
  clearTimeout(waiter.timer);
  waiters.delete(waiter);
  if(error)waiter.reject(error);else waiter.resolve(value);
 }
 child.on('message',message=>{
  history.push(message);
  for(const waiter of [...waiters])if(waiter.matches(message))settle(waiter,null,message);
 });
 const exited=new Promise(resolve=>{
  child.once('error',error=>{for(const waiter of [...waiters])settle(waiter,error);});
  child.once('exit',(code,signal)=>{
   ended=true;
   for(const waiter of [...waiters])settle(waiter,new Error(stderr||`Lease worker exited: ${code??signal}`));
   resolve({code,signal});
  });
 });
 function waitFor(type,id){
  const matches=message=>message.type===type&&(id===undefined||message.id===id);
  const prior=history.find(matches);
  if(prior)return Promise.resolve(prior);
  if(ended)return Promise.reject(new Error(stderr||'Lease worker already exited'));
  return new Promise((resolve,reject)=>{
   const waiter={matches,resolve,reject};
   waiter.timer=setTimeout(()=>settle(waiter,new Error(`Timed out waiting for worker ${type}`)),15000);
   waiters.add(waiter);
  });
 }
 const client={child,history,waitFor,async arm(job){
  const id=randomUUID(),armed=waitFor('armed',id);
  child.send({type:'prepare',id,job});
  await armed;
  return {id,go(){child.send({type:'go',id});},result:()=>waitFor('result',id),phase:type=>waitFor(type,id)};
 },async run(job){const task=await client.arm(job);task.go();return task.result();},async close(){
  if(!ended){
   // Normal shutdown proves that no heartbeat or polling timer keeps a worker
   // alive. Kill only as cleanup insurance for a failed test's unopened gate.
   const deadline=setTimeout(()=>child.kill(),1000);
   try{
    if(child.connected)child.send({type:'stop'});else child.kill();
    await exited;
   }finally{clearTimeout(deadline);}
  }
 }};
 f.children.push(client);
 await waitFor('ready');
 return client;
}

const acquire=(f,owner,extra={})=>({action:'acquire',request:{...f.scope,owner,stage:'render'},now:start,...extra});
function commit(f,extra={}){
 return {action:'commit',now:start+1,request:{...f.scope,requestId:randomUUID(),operation:'synthetic.lease.commit',payload:{synthetic:true}},artifactId:randomUUID(),eventId:randomUUID(),...extra};
}
function effects(f){
 return {
  run:f.db.prepare('SELECT * FROM runs WHERE id=?').get(runId),
  artifacts:f.db.prepare('SELECT * FROM artifacts ORDER BY id').all(),
  events:f.db.prepare('SELECT * FROM run_events ORDER BY id').all(),
  operations:f.db.prepare('SELECT * FROM operations ORDER BY request_id').all(),
 };
}
function success(response){assert.equal(response.ok,true,JSON.stringify(response));return response.value;}
function failure(response,code){assert.equal(response.ok,false,JSON.stringify(response));assert.equal(response.error.code,code,response.error.message);}

// The mutation that must break this test is a read/check followed by a lease
// write outside the same immediate transaction, or permitting two stage owners.
test('IPC-barrier acquisition in two real processes grants exactly one run-wide lease',async t=>{
 const f=await fixture(t),[a,b]=await Promise.all([worker(f),worker(f)]);
 const jobs=await Promise.all([a.arm(acquire(f,'worker-a',{request:{...f.scope,owner:'worker-a',stage:'preview-render'}})),b.arm(acquire(f,'worker-b'))]);
 jobs.forEach(job=>job.go());
 const outcomes=await Promise.all(jobs.map(job=>job.result()));
 const winners=outcomes.filter(outcome=>outcome.ok),losers=outcomes.filter(outcome=>!outcome.ok);
 assert.equal(winners.length,1,JSON.stringify(outcomes));assert.equal(losers.length,1);
 failure(losers[0],'RUN_LEASE_HELD');
 const winner=success(winners[0]),stored=f.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
 assert.equal(stored.lease_owner,winner.owner);assert.equal(stored.fencing_token,winner.fencingToken);
 assert.equal(winner.fencingToken,1);assert.equal(stored.lease_expires_at,winner.expiresAt);
 assert.equal(winner.expiresAt,start+60000);
 assert.equal(f.db.prepare('SELECT count(*) n FROM operations').get().n,0);
});

for(const first of ['lease','maintenance'])test(`real ${first}-first transaction excludes the competing maintenance/lease writer`,async t=>{
 const f=await fixture(t),[a,b]=await Promise.all([worker(f),worker(f)]),gate=`gate-${randomUUID()}`;
 const holding=await a.arm(first==='lease'?acquire(f,'worker-a',{transactionGate:gate}):{action:'maintenance',owner:'backup',now:start,transactionGate:gate});
 holding.go();await holding.phase('locked');
 const contender=await b.arm(first==='lease'?{action:'maintenance',owner:'backup',now:start}:acquire(f,'worker-b'));
 contender.go();await contender.phase('started');
 // While the first transaction is held open, the contender must be waiting on
 // SQLite, not succeeding based on a stale pre-transaction admission check.
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(b.history.some(message=>message.type==='result'&&message.id===contender.id),false);
 await writeFile(path.join(f.root,gate),'release');
 success(await holding.result());
 failure(await contender.result(),first==='lease'?'WORKSPACE_BUSY':'WORKSPACE_MAINTENANCE');
 const row=f.db.prepare('SELECT * FROM runs WHERE id=?').get(runId),lock=f.db.prepare('SELECT * FROM maintenance_coordination').get();
 if(first==='lease'){
  assert.equal(row.lease_owner,'worker-a');assert.equal(lock.owner,null);
  success(await a.run({action:'release',now:start+1}));
  success(await b.run({action:'maintenance',owner:'backup',now:start+2}));
 }else{
  assert.equal(row.lease_owner,null);assert.equal(lock.owner,'backup');
  success(await a.run({action:'release-maintenance',now:start+1}));
  success(await b.run(acquire(f,'worker-b',{now:start+2})));
 }
 assert.equal(f.db.prepare('SELECT count(*) n FROM operations').get().n,0);
});

for(const loss of ['expiry','takeover','revocation'])test(`delayed old process after ${loss} cannot persist result, event, or operation`,async t=>{
 const f=await fixture(t),[old,replacement]=await Promise.all([worker(f),worker(f)]);
 const lease=success(await old.run(acquire(f,'old-worker')));
 const now=loss==='revocation'?start+2:lease.expiresAt+1;
 const request=commit(f,{now});
 // Arm the old process with work before ownership changes. Its later commit
 // uses the original in-memory capability, never a refreshed database token.
 const delayed=await old.arm(request);
 let fresh;
 if(loss==='takeover')fresh=success(await replacement.run(acquire(f,'replacement',{now:lease.expiresAt})));
 if(loss==='revocation')success(await replacement.run({action:'revoke',lease,now:start+1}));
 const before=effects(f);
 delayed.go();failure(await delayed.result(),'RUN_LEASE_LOST');
 assert.deepEqual(effects(f),before);
 assert.equal(before.artifacts.length,0);assert.equal(before.events.length,0);assert.equal(before.operations.length,0);
 if(!fresh)fresh=success(await replacement.run(acquire(f,'replacement',{now})));
 assert.ok(fresh.fencingToken>lease.fencingToken);
 // A successful retry with the same operation ID proves the stale process did
 // not leave either a result or an idempotency reservation behind.
 assert.deepEqual(success(await replacement.run(request)),{artifactId:request.artifactId,owner:'replacement'});
 const after=effects(f);
 assert.equal(after.run.version,before.run.version+1);
 assert.equal(after.artifacts.length,1);assert.equal(after.events.length,1);assert.equal(after.operations.length,1);
 assert.equal(after.events[0].correlation_id,request.request.requestId);
 assert.deepEqual(JSON.parse(after.operations[0].result_json),{artifactId:request.artifactId,owner:'replacement'});
});
