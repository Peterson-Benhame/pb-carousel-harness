import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { initializeWorkspace, openWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import { canonicalJson, canonicalHash, CANONICAL_VERSION } from '../../src/domain/canonical-json.mjs';
import { PublicError, toPublicError } from '../../src/domain/errors.mjs';
import { runOperation } from '../../src/application/operation-runner.mjs';
import { acquireMaintenance, renewMaintenance, releaseMaintenance } from '../../src/infrastructure/sqlite/maintenance.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'carousel-t06-memória '));
  const db = await initializeWorkspace(root);
  const connections = [db], children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child,'exit'); }
    for (const connection of connections.reverse()) if (connection.open) connection.close();
    await rm(root,{recursive:true,force:true});
  });
  db.exec("INSERT INTO brands(id) VALUES ('b'); INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES ('b',1,'{}','"+'a'.repeat(64)+"','user-confirmed'); INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES ('r','b',1,'{}','"+'b'.repeat(64)+"');");
  return {root,db,connections,children};
}
const request = (extra={}) => ({requestId:'req',operation:'synthetic.change',brandId:'b',runId:'r',payload:{z:1,a:{y:2,x:3}},...extra});
function change({db,emit}) {
  db.exec("UPDATE runs SET version=version+1 WHERE id='r'");
  emit({id:'event',eventType:'synthetic.changed'});
  return {status:'committed',result:{version:db.prepare("SELECT version FROM runs WHERE id='r'").get().version}};
}
const counts = db => [db.prepare("SELECT version FROM runs WHERE id='r'").get().version,db.prepare('SELECT count(*) n FROM run_events').get().n,db.prepare('SELECT count(*) n FROM operations').get().n];

test('canonical v1 sorts recursively, preserves arrays and JSON special keys', () => {
  assert.equal(CANONICAL_VERSION,1);
  assert.equal(canonicalJson(JSON.parse('{"2":2,"10":10,"__proto__":{"z":1,"a":2},"a":[{"z":1,"a":2},3]}')), '{"10":10,"2":2,"__proto__":{"a":2,"z":1},"a":[{"a":2,"z":1},3]}');
  assert.equal(canonicalHash({b:2,a:1}),canonicalHash({a:1,b:2}));
  assert.notEqual(canonicalHash([1,2]),canonicalHash([2,1]));
  const cycle={}; cycle.self=cycle;
  for(const value of [undefined,NaN,Infinity,1n,new Date(),[,1],{a:undefined},cycle,Object.defineProperty({},'x',{enumerable:true,get(){throw new Error('getter executed');}})]) assert.throws(()=>canonicalJson(value),{code:'INVALID_JSON_VALUE'});
  assert.throws(()=>canonicalHash({},2),{code:'CANONICAL_VERSION_UNSUPPORTED'});
});
test('state, event and stored result commit together; reordered replay does not invoke callback',async t=>{
  const {db,root,connections}=await fixture(t);
  assert.deepEqual(runOperation(db,request(),change),{version:2});
  const second=await openWorkspace(root,{readonly:false}); connections.push(second);
  assert.deepEqual(runOperation(second,request({payload:{a:{x:3,y:2},z:1}}),()=>assert.fail('replayed mutation')),{version:2});
  assert.deepEqual(counts(db),[2,1,1]);
  const row=db.prepare('SELECT * FROM operations').get(); assert.equal(row.canonical_version,1); assert.equal(row.result_json,'{"version":2}');
  assert.equal(db.prepare('SELECT correlation_id FROM run_events').get().correlation_id,'req');
});
test('request identity includes payload, operation and brand/run scope',async t=>{
  const {db}=await fixture(t); runOperation(db,request(),change);
  for(const extra of [{payload:{z:2}},{operation:'other'},{brandId:null,runId:null},{runId:null}]) assert.throws(()=>runOperation(db,request(extra),()=>assert.fail()),{code:'IDEMPOTENCY_CONFLICT'});
  db.exec('UPDATE operations SET canonical_version=2');
  assert.throws(()=>runOperation(db,request(),()=>assert.fail()),{code:'CANONICAL_VERSION_UNSUPPORTED'});
});
test('exception, pending reservation, invalid result and deferred commit failure roll back every effect',async t=>{
  const {db}=await fixture(t);
  const callbacks=[ctx=>{change(ctx);throw new Error('injected');},ctx=>{change(ctx);return {status:'pending',result:{reservation:'file'}};},ctx=>{change(ctx);return {status:'committed',result:{bad:undefined}};},ctx=>{change(ctx);ctx.db.exec("UPDATE brands SET current_revision=99 WHERE id='b'");return {status:'committed',result:{ok:true}};}];
  for(const callback of callbacks){assert.throws(()=>runOperation(db,request(),callback));assert.deepEqual(counts(db),[1,0,0]);assert.equal(db.inTransaction,false);}
  assert.deepEqual(runOperation(db,request(),change),{version:2});
});
test('async callbacks, nested transactions and missing request IDs are rejected before effects',async t=>{
  const {db}=await fixture(t); let called=false;
  assert.throws(()=>runOperation(db,request(),async()=>{called=true;}),{code:'INVALID_OPERATION_CALLBACK'}); assert.equal(called,false);
  assert.throws(()=>db.transaction(()=>runOperation(db,request(),change))(),{code:'NESTED_TRANSACTION'});
  assert.throws(()=>runOperation(db,request({requestId:''}),change),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(counts(db),[1,0,0]);
});
test('maintenance excludes mutations; owner/token renewal and release are fenced',async t=>{
  const {db,root,connections}=await fixture(t); const other=await openWorkspace(root,{readonly:false});connections.push(other);
  const lock=acquireMaintenance(db,{owner:'backup',purpose:'backup',ttlMs:1000,now:()=>100});
  assert.throws(()=>runOperation(other,request(),change,{now:()=>101}),{code:'WORKSPACE_MAINTENANCE'});
  assert.throws(()=>acquireMaintenance(other,{owner:'other',purpose:'backup',ttlMs:1000,now:()=>101}),{code:'WORKSPACE_MAINTENANCE'});
  assert.throws(()=>releaseMaintenance(other,{...lock,owner:'other'},{now:()=>101}),{code:'MAINTENANCE_LOST'});
  renewMaintenance(db,lock,{ttlMs:2000,now:()=>200});
  assert.equal(db.prepare('SELECT expires_at FROM maintenance_coordination').get().expires_at,2200);
  releaseMaintenance(db,lock,{now:()=>201});
  assert.deepEqual(runOperation(other,request(),change,{now:()=>202}),{version:2});
});
test('expired maintenance can be reacquired; old token cannot renew or release',async t=>{
  const {db}=await fixture(t);
  const old=acquireMaintenance(db,{owner:'same',purpose:'backup',ttlMs:10,now:()=>100});
  const fresh=acquireMaintenance(db,{owner:'same',purpose:'backup',ttlMs:10,now:()=>110});
  assert.equal(fresh.fencingToken,old.fencingToken+1);
  for(const fn of [()=>renewMaintenance(db,old,{ttlMs:10,now:()=>111}),()=>releaseMaintenance(db,old,{now:()=>111}),()=>renewMaintenance(db,fresh,{ttlMs:10,now:()=>120})])assert.throws(fn,{code:'MAINTENANCE_LOST'});
});
test('maintenance refuses valid leases and unfinished attempts, including expired leases',async t=>{
  const {db}=await fixture(t);
  db.exec("UPDATE runs SET lease_owner='worker',lease_expires_at=200 WHERE id='r'");
  assert.throws(()=>acquireMaintenance(db,{owner:'x',purpose:'backup',now:()=>100}),{code:'WORKSPACE_BUSY'});
  db.exec("INSERT INTO steps(id,brand_id,run_id,step_key) VALUES ('s','b','r','render'); INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token) VALUES ('a','b','r','s',1,'worker',1)");
  assert.throws(()=>acquireMaintenance(db,{owner:'x',purpose:'backup',now:()=>300}),{code:'WORKSPACE_BUSY'});
  assert.equal(db.prepare('SELECT owner FROM maintenance_coordination').get().owner,null);
});
test('schema is checked again inside each mutation and maintenance transaction',async t=>{
  const {db}=await fixture(t); db.pragma('user_version=3');
  for(const fn of [()=>runOperation(db,request(),change),()=>acquireMaintenance(db,{owner:'x',purpose:'backup'})])assert.throws(fn,{code:'SCHEMA_TOO_NEW'});
  assert.deepEqual(counts(db),[1,0,0]);
});

const databaseUrl=new URL('../../src/infrastructure/sqlite/database.mjs',import.meta.url).href;
const runnerUrl=new URL('../../src/application/operation-runner.mjs',import.meta.url).href;
const maintenanceUrl=new URL('../../src/infrastructure/sqlite/maintenance.mjs',import.meta.url).href;
async function writer(f,mode) {
  const code=`import {openWorkspace} from ${JSON.stringify(databaseUrl)}; import {runOperation} from ${JSON.stringify(runnerUrl)}; import {acquireMaintenance} from ${JSON.stringify(maintenanceUrl)}; const db=await openWorkspace(process.argv[1],{readonly:false}); process.send('ready'); process.on('message',()=>{try {if(${JSON.stringify(mode)}==='maintenance'){acquireMaintenance(db,{owner:'child',purpose:'backup'});}else{runOperation(db,${JSON.stringify(request())},({db,emit})=>{db.exec("UPDATE runs SET version=version+1 WHERE id='r'");emit({id:'event',eventType:'synthetic.changed'});if(${JSON.stringify(mode)}==='lease')db.prepare("UPDATE runs SET lease_owner='synthetic-worker',lease_expires_at=? WHERE id='r'").run(Date.now()+60000);process.send('locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${['timeout','crash'].includes(mode)?6500:400});return {status:'committed',result:{version:2}};});}process.send('done');}catch(e){process.send({error:e.code||e.message});}finally{db.close();process.disconnect();}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,f.root],{stdio:['ignore','pipe','pipe','ipc']}); f.children.push(child);
  let stderr=''; child.stderr.on('data',chunk=>stderr+=chunk);
  const messages=[]; child.on('message',message=>messages.push(message));
  const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(stderr||`child exited ${code}`)));});
  await once(child,'message');
  return {child,messages,exited};
}
test('real writers serialize the same request: one mutation, one event, same result',async t=>{
  const f=await fixture(t),w=await writer(f,'commit'); w.child.send('go'); await once(w.child,'message');
  assert.deepEqual(runOperation(f.db,request(),()=>assert.fail('second writer executed')),{version:2});
  await w.exited; assert.deepEqual(counts(f.db),[2,1,1]);
});
test('real writer contention returns sanitized DATABASE_BUSY after configured 5000 ms and retry replays',async t=>{
  const f=await fixture(t),w=await writer(f,'timeout'); w.child.send('go'); await once(w.child,'message');
  assert.equal(f.db.pragma('busy_timeout',{simple:true}),5000);
  const start=performance.now(); assert.throws(()=>runOperation(f.db,request(),change),error=>{assert.ok(error instanceof PublicError);assert.equal(toPublicError(error).code,'DATABASE_BUSY');assert.equal(error.message,'Banco ocupado. Repita a solicitação com o mesmo requestId.');return true;}); const elapsed=performance.now()-start;
  assert.ok(elapsed>=4800 && elapsed<6200,`busy wait ${elapsed} ms`); t.diagnostic(`busy timeout observed: ${elapsed.toFixed(1)} ms`);
  await w.exited; assert.deepEqual(runOperation(f.db,request(),()=>assert.fail()),{version:2}); assert.deepEqual(counts(f.db),[2,1,1]);
});
test('maintenance acquired by another process blocks new mutations until release',async t=>{
  const f=await fixture(t),w=await writer(f,'maintenance'); w.child.send('go'); await w.exited;
  assert.deepEqual(w.messages,['ready','done']);
  assert.throws(()=>runOperation(f.db,request(),change),{code:'WORKSPACE_MAINTENANCE'}); assert.deepEqual(counts(f.db),[1,0,0]);
});

test('killed writer before commit leaves no state, event or confirmed result; retry succeeds',async t=>{
  const f=await fixture(t),w=await writer(f,'crash');
  const stopped=w.exited.catch(()=>{});
  w.child.send('go'); await once(w.child,'message');
  w.child.kill('SIGKILL'); await stopped;
  assert.deepEqual(counts(f.db),[1,0,0]);
  assert.deepEqual(runOperation(f.db,request(),change),{version:2});
  assert.deepEqual(counts(f.db),[2,1,1]);
});

test('maintenance waits for a concurrent mutation and observes its committed lease atomically',async t=>{
  const f=await fixture(t),w=await writer(f,'lease'); w.child.send('go'); await once(w.child,'message');
  assert.throws(()=>acquireMaintenance(f.db,{owner:'backup',purpose:'backup'}),{code:'WORKSPACE_BUSY'});
  await w.exited;
  assert.equal(f.db.prepare('SELECT owner FROM maintenance_coordination').get().owner,null);
  assert.deepEqual(counts(f.db),[2,1,1]);
});
