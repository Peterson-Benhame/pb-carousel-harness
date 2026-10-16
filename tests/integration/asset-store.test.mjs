import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createConfinedRoot } from '../../src/infrastructure/fs/confined-path.mjs';
import { promoteFile } from '../../src/infrastructure/fs/atomic-files.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { initializeWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import { createAssetStore } from '../../src/application/asset-store.mjs';
import { acquireMaintenance } from '../../src/infrastructure/sqlite/maintenance.mjs';
const bytes=Buffer.from([0,255,17,128,13,10,0,42]);
const sha256=createHash('sha256').update(bytes).digest('hex');
async function fixture(t, options={}) {
 const root=await mkdtemp(path.join(os.tmpdir(),'carousel-t07-memória '));
 const db=await initializeWorkspace(root);
 t.after(async()=>{if(db.open)db.close();await rm(root,{recursive:true,force:true});});
 db.exec("INSERT INTO brands(id) VALUES ('brand-a'),('brand-b')");
 const sourcePath=path.join(root,'source-private.bin'); await writeFile(sourcePath,bytes);
 const store=await createAssetStore({root,db,...options});
 const request={requestId:'request-1',brandId:'brand-a',sourcePath,sha256,kind:'synthetic',width:1,height:1,originalName:'original.bin'};
 return {root,db,store,request};
}
const counts=db=>[db.prepare('SELECT count(*) n FROM assets').get().n,db.prepare('SELECT count(*) n FROM operations').get().n];
test('original bytes survive source removal; replay and reads verify managed files and isolate brands',async t=>{
 const {root,db,store,request}=await fixture(t); const result=await store.importFile(request);
 assert.deepEqual(await readFile((await store.resolve(request.brandId,result.id)).path),bytes);
 await unlink(request.sourcePath); assert.deepEqual(await store.importFile(request),result);
 assert.deepEqual(counts(db),[1,1]);
 const row=db.prepare('SELECT * FROM assets').get(); assert.equal(JSON.stringify(row).includes(root),false); assert.equal(row.hash,sha256);
 assert.deepEqual(JSON.parse(row.metadata_json),{originalName:'original.bin',size:bytes.length});
 await assert.rejects(store.resolve('brand-b',result.id),{code:'RESOURCE_MISSING'});
 await assert.rejects(store.importFile({...request,width:2}),{code:'IDEMPOTENCY_CONFLICT'});
 const managed=(await store.resolve('brand-a',result.id)).path; await writeFile(managed,'tampered');
 await assert.rejects(store.importFile(request),{code:'ASSET_HASH_MISMATCH'});
 await unlink(managed); await assert.rejects(store.resolve('brand-a',result.id),{code:'RESOURCE_MISSING'});
});
for(const phase of ['write','close','hash','promotion','commit']) test(`${phase} failure publishes no reference or operation; explicit retry succeeds`,async t=>{
 let fail=true; const {db,store,request,root}=await fixture(t,{hooks:{[phase]:()=>{if(fail)throw Object.assign(new Error('injected'),{code:'EIO'});}}});
 await assert.rejects(store.importFile(request)); assert.deepEqual(counts(db),[0,0]);
 assert.deepEqual(await readFile(request.sourcePath),bytes);
 if(phase==='commit')assert.ok((await readdir(path.join(root,'blobs','brand-a',sha256))).length>0);
 fail=false; await store.importFile(request); assert.deepEqual(counts(db),[1,1]);
});
test('only transient filesystem failures retry twice at 500/1500ms',async t=>{
 let calls=0;const waits=[];const {store,request,db}=await fixture(t,{sleep:async ms=>waits.push(ms),hooks:{write:async()=>{calls++;throw Object.assign(new Error('busy'),{code:'EBUSY'});}}});
 await assert.rejects(store.importFile(request),{code:'EBUSY'});assert.equal(calls,3);assert.deepEqual(waits,[500,1500]);assert.deepEqual(counts(db),[0,0]);
});
test('hash errors never retry even when their code is transient',async t=>{
 let calls=0;const waits=[];const {store,request}=await fixture(t,{sleep:async ms=>waits.push(ms),hooks:{hash:async()=>{calls++;throw Object.assign(new Error('busy hash'),{code:'EBUSY'});}}});
 await assert.rejects(store.importFile(request));assert.equal(calls,1);assert.deepEqual(waits,[]);
});
test('hash mismatch, bad descriptor and traversal never retry or publish',async t=>{
 const waits=[];const {store,request,db}=await fixture(t,{sleep:async ms=>waits.push(ms)});
 await assert.rejects(store.importFile({...request,sha256:'a'.repeat(64)}),{code:'ASSET_HASH_MISMATCH'});
 for(const changes of [{brandId:'../escape'},{originalName:'../private'},{width:0},{sha256:'bad'}])await assert.rejects(store.importFile({...request,...changes}));
 assert.deepEqual(waits,[]);assert.deepEqual(counts(db),[0,0]);
});
test('maintenance acquired during file work blocks final commit',async t=>{
 let db;const f=await fixture(t,{hooks:{promotion:async()=>{acquireMaintenance(db,{owner:'backup',purpose:'test'});}}});db=f.db;
 await assert.rejects(f.store.importFile(f.request),{code:'WORKSPACE_MAINTENANCE'});assert.deepEqual(counts(db),[0,0]);
});

test('partial real write stays isolated in staging',async t=>{
 const f=await fixture(t,{hooks:{write:()=>{throw Object.assign(new Error('disk full'),{code:'ENOSPC'});}}});
 const large=Buffer.alloc(256*1024,73);await writeFile(f.request.sourcePath,large);
 await assert.rejects(f.store.importFile({...f.request,sha256:createHash('sha256').update(large).digest('hex')}),{code:'ENOSPC'});
 const [directory]=await readdir(path.join(f.root,'staging'));const partial=await readFile(path.join(f.root,'staging',directory,'original.bin'));
 assert.ok(partial.length>0 && partial.length<large.length);assert.deepEqual(counts(f.db),[0,0]);
});
test('deferred SQLite commit failure leaves complete orphan, no durable success',async t=>{
 let db;const f=await fixture(t,{hooks:{commit:()=>db.exec("UPDATE brands SET current_revision=99 WHERE id='brand-a'")}});db=f.db;
 await assert.rejects(f.store.importFile(f.request),{code:'SQLITE_CONSTRAINT_FOREIGNKEY'});assert.deepEqual(counts(db),[0,0]);assert.equal(db.inTransaction,false);
 const files=await readdir(path.join(f.root,'blobs','brand-a',sha256));assert.equal(files.length,1);assert.deepEqual(await readFile(path.join(f.root,'blobs','brand-a',sha256,files[0])),bytes);
});
test('concurrent identical requests commit one reference and replay one result',async t=>{
 const f=await fixture(t);const [a,b]=await Promise.all([f.store.importFile(f.request),f.store.importFile(f.request)]);
 assert.deepEqual(a,b);assert.deepEqual(counts(f.db),[1,1]);
});
test('promotion cannot overwrite an existing file',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'staged.bin'),bytes);await writeFile(path.join(f.root,'final.bin'),'existing');
 await assert.rejects(promoteFile(await createConfinedRoot(f.root),'staged.bin','final.bin'),{code:'EEXIST'});
 assert.equal(await readFile(path.join(f.root,'final.bin'),'utf8'),'existing');assert.deepEqual(await readFile(path.join(f.root,'staged.bin')),bytes);
});
test('transient promotion retry succeeds, while configuration errors receive no retries',async t=>{
 let calls=0;const waits=[];const f=await fixture(t,{sleep:async ms=>waits.push(ms),hooks:{promotion:()=>{if(++calls<3)throw Object.assign(new Error('busy'),{code:'EBUSY'});}}});
 await f.store.importFile(f.request);assert.equal(calls,3);assert.deepEqual(waits,[500,1500]);assert.deepEqual(counts(f.db),[1,1]);
 let attempts=0;const errors=[];const store=await createAssetStore({root:f.root,db:f.db,sleep:async ms=>errors.push(ms),hooks:{promotion:()=>{attempts++;throw Object.assign(new Error('permissions'),{code:'EPERM'});}}});
 await assert.rejects(store.importFile({...f.request,requestId:'second'}),{code:'EPERM'});assert.equal(attempts,1);assert.deepEqual(errors,[]);
});
test('process killed after promotion and INSERT cannot publish a committed reference',async t=>{
 const f=await fixture(t);
 const databaseUrl=new URL('../../src/infrastructure/sqlite/database.mjs',import.meta.url).href;
 const assetUrl=new URL('../../src/application/asset-store.mjs',import.meta.url).href;
 const code=`import {openWorkspace} from ${JSON.stringify(databaseUrl)};import {createAssetStore} from ${JSON.stringify(assetUrl)};const db=await openWorkspace(process.argv[1],{readonly:false});const store=await createAssetStore({root:process.argv[1],db,hooks:{commit:()=>{process.send('before-commit');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);}}});await store.importFile(JSON.parse(process.argv[2]));db.close();`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,f.root,JSON.stringify(f.request)],{stdio:['ignore','pipe','pipe','ipc']});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const exited=once(child,'exit');
 t.after(async()=>{if(child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');await exited;}});
 await Promise.race([once(child,'message'),exited.then(()=>{throw new Error(stderr||'child exited before commit');})]);
 child.kill('SIGKILL');await exited;
 assert.deepEqual(counts(f.db),[0,0]);
 const files=await readdir(path.join(f.root,'blobs','brand-a',sha256));assert.equal(files.length,1);
 await f.store.importFile(f.request);assert.deepEqual(counts(f.db),[1,1]);
});
test('modified bytes between staging verification and promotion never get a reference',async t=>{
 let root;const f=await fixture(t,{hooks:{promotion:async()=>{const [directory]=await readdir(path.join(root,'staging'));await writeFile(path.join(root,'staging',directory,'original.bin'),'changed');}}});root=f.root;
 await assert.rejects(f.store.importFile(f.request),{code:'ASSET_HASH_MISMATCH'});assert.deepEqual(counts(f.db),[0,0]);
});
test('maintenance and unknown brands reject before creating staging',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.store.importFile({...f.request,brandId:'unknown'}),{code:'BRAND_NOT_FOUND'});
 acquireMaintenance(f.db,{owner:'backup',purpose:'test'});
 await assert.rejects(f.store.importFile(f.request),{code:'WORKSPACE_MAINTENANCE'});
 await assert.rejects(readdir(path.join(f.root,'staging')),{code:'ENOENT'});assert.deepEqual(counts(f.db),[0,0]);
});
