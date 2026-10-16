import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeWorkspace,openWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import { createBrandMemory } from '../../src/application/brand-memory.mjs';
import { confirmBrandProposal } from '../../src/interfaces/cli/human-confirmation.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const config=(name='Synthetic')=>({name,profile:'@synthetic',language:'pt-BR',audience:null,voice:null,preferences:[],fonts:{title:'Anton',body:'Manrope',mono:'JetBrains Mono'},themes:{light:{background:'#ffffff',text:'#000000',muted:'#555555',accent:'#ff0000',topics:[]}},logo:{enabled:false,variants:{},protection:12,minimumHeight:24},slideWidth:1080,slideHeight:1350,minimumSlideCount:12,maximumSlideCount:16,profileImage:''});
const request=(extra={})=>({requestId:'create-a',brandId:A,config:config(),...extra});
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'carousel-t08-memória '));const db=await initializeWorkspace(root),connections=[db];t.after(async()=>{for(const c of connections.reverse())if(c.open)c.close();await rm(root,{recursive:true,force:true});});return {db,root,connections,memory:createBrandMemory(db)};}
async function approve(p){return confirmBrandProposal(p,{input:{isTTY:true},output:{isTTY:true,write(){}},argv:[],ask:async()=> 'CONFIRMAR'});}
async function perform(memory,action,req){const p=memory.propose(action,req);return memory.commit(p,await approve(p));}
test('create, list scoped summaries, reopen and immutable complete revisions with provenance',async t=>{
 const {memory,db,root,connections}=await fixture(t);const first=await perform(memory,'brand.create',request());
 assert.equal(first.revision,1);assert.equal(first.provenance,'user-confirmed');assert.deepEqual(first.config,config());assert.equal(first.hash,canonicalHash(config()));
 await perform(memory,'brand.create',request({brandId:B,requestId:'create-b',config:config('Other')}));
 assert.equal(memory.list().length,2);assert.deepEqual(memory.list({brandId:A}).map(x=>x.brandId),[A]);assert.equal(memory.get(B,99),null);
 const other=await openWorkspace(root);connections.push(other);assert.deepEqual(createBrandMemory(other).get(A),first);
 const second=await perform(memory,'brand.update',request({requestId:'update-a',expectedRevision:1,config:{...config(),voice:'direct'}}));
 assert.equal(second.revision,2);assert.equal(memory.get(A,1).config.voice,null);assert.equal(memory.get(A).config.voice,'direct');
 assert.throws(()=>db.prepare("UPDATE brand_revisions SET config_json='{}' WHERE brand_id=?").run(A),/immutable/);
 assert.equal(db.prepare('SELECT count(*) n FROM confirmation_requests WHERE status=\'confirmed\'').get().n,3);
 assert.equal(db.prepare('SELECT count(*) n FROM operations').get().n,3);
});
test('no boolean/model consent; receipts cannot authorize altered proposal, scope or action',async t=>{
 const {memory,db}=await fixture(t),p=memory.propose('brand.create',request()),receipt=await approve(p);
 for(const fake of [null,{approved:true},{actor:'user'},JSON.parse(JSON.stringify(receipt))])assert.throws(()=>memory.commit(p,fake),{code:'APPROVAL_REQUIRED'});
 assert.throws(()=>memory.commit({...p,config:config('Changed')},receipt),{code:'APPROVAL_REQUIRED'});
 assert.throws(()=>memory.propose('brand.create',{...request(),actor:'user'}),{code:'INVALID_ARGUMENT'});
 assert.equal(db.prepare('SELECT count(*) n FROM brands').get().n,0);
});
test('CAS across two real connections rejects stale update without partial operation or confirmation',async t=>{
 const {memory,db,root,connections}=await fixture(t);await perform(memory,'brand.create',request());const other=await openWorkspace(root,{readonly:false});connections.push(other);const second=createBrandMemory(other);
 const p=memory.propose('brand.update',request({requestId:'stale',expectedRevision:1,config:config('Stale')})),receipt=await approve(p);
 await perform(second,'brand.update',request({requestId:'winner',expectedRevision:1,config:config('Winner')}));
 assert.throws(()=>memory.commit(p,receipt),{code:'BRAND_REVISION_CONFLICT'});assert.equal(memory.get(A).config.name,'Winner');
 assert.equal(db.prepare('SELECT count(*) n FROM operations').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM confirmation_requests').get().n,2);
});
test('exact replay survives reopen without new consent; mismatched request conflicts',async t=>{
 const {memory,root,connections}=await fixture(t),p=memory.propose('brand.create',request());const result=memory.commit(p,await approve(p));const other=await openWorkspace(root,{readonly:false});connections.push(other);assert.deepEqual(createBrandMemory(other).commit(p,null),result);
 assert.throws(()=>memory.commit({...p,config:config('Changed')},null),{code:'IDEMPOTENCY_CONFLICT'});
});
test('legacy import copies supplied fields/themes, is confirmed and never overwrites later preferences',async t=>{
 const {memory,db}=await fixture(t);const c=config();const {name,audience,voice,preferences,logo,themes,...legacyBrand}=c;
 const req={requestId:'legacy-1',brandId:A,name:'Imported',legacyBrand,legacyThemes:themes};const p=memory.propose('brand.importLegacy',req);
 assert.throws(()=>memory.commit(p,null),{code:'APPROVAL_REQUIRED'});const imported=memory.commit(p,await approve(p));assert.equal(imported.provenance,'legacy-import');assert.equal(imported.config.logo.enabled,false);assert.deepEqual(imported.config.logo.variants,{});assert.deepEqual(imported.config.themes,themes);assert.equal(imported.config.audience,null);
 await perform(memory,'brand.update',request({requestId:'later',expectedRevision:1,config:{...imported.config,voice:'Updated'}}));
 const again=memory.propose('brand.importLegacy',{...req,requestId:'legacy-2'});assert.deepEqual(memory.commit(again,null),imported);assert.equal(memory.get(A).revision,2);assert.equal(memory.get(A).config.voice,'Updated');
 assert.equal(db.prepare('SELECT count(*) n FROM brands').get().n,1);
 const changed=memory.propose('brand.importLegacy',{...req,requestId:'legacy-3',name:'Changed'});assert.throws(()=>memory.commit(changed,null),{code:'LEGACY_IMPORT_CONFLICT'});
});
test('transient editorial changes are detached and do not mutate permanent memory',async t=>{
 const {memory,db}=await fixture(t);await perform(memory,'brand.create',request());const transient=memory.forExecution(A,{voice:'More direct',preferences:['Short sentences']});assert.equal(transient.config.voice,'More direct');assert.equal(transient.hash,canonicalHash(transient.config));assert.equal(transient.base.hash,canonicalHash(transient.base.config));assert.notEqual(transient.hash,transient.base.hash);assert.equal(transient.base.revision,1);transient.config.themes.light.text='#123456';assert.equal(memory.get(A).config.voice,null);assert.equal(memory.get(A).config.themes.light.text,'#000000');assert.equal(db.prepare('SELECT count(*) n FROM brand_revisions').get().n,1);assert.throws(()=>memory.forExecution(A,{logo:{enabled:true}}),{code:'INVALID_ARGUMENT'});
});
test('incomplete/unknown config, unsupported fonts and logo enablement are rejected',async t=>{
 const {memory}=await fixture(t);
 for(const c of [{name:'partial'},{...config(),approved:true},{...config(),fonts:{...config().fonts,title:'Unknown'}},{...config(),logo:{...config().logo,enabled:true}}])assert.throws(()=>memory.propose('brand.create',request({config:c})),{code:'INVALID_ARGUMENT'});
});
test('maintenance, archived target and schema future refuse mutation without effects',async t=>{
 const {memory,db}=await fixture(t);const p=memory.propose('brand.create',request()),receipt=await approve(p);
 db.prepare("UPDATE maintenance_coordination SET owner='backup',purpose='backup',expires_at=?").run(Date.now()+60000);
 assert.throws(()=>memory.commit(p,receipt),{code:'WORKSPACE_MAINTENANCE'});assert.equal(db.prepare('SELECT count(*) n FROM brands').get().n,0);
 db.exec('UPDATE maintenance_coordination SET owner=NULL,purpose=NULL,expires_at=NULL');memory.commit(p,receipt);
 db.exec("UPDATE brands SET status='archived'");const update=memory.propose('brand.update',request({requestId:'update',expectedRevision:1}));assert.throws(()=>memory.commit(update,null),{code:'BRAND_ARCHIVED'});
 db.pragma('user_version=3');for(const fn of [()=>memory.get(A),()=>memory.list(),()=>memory.commit(update,null)])assert.throws(fn,{code:'SCHEMA_TOO_NEW'});
});
test('failed confirmation insert rolls back revision and pointer; identical retry succeeds',async t=>{
 const {memory,db}=await fixture(t);await perform(memory,'brand.create',request());const p=memory.propose('brand.update',request({requestId:'update',expectedRevision:1,config:config('Next')})),receipt=await approve(p);
 db.exec("CREATE TRIGGER fail_confirmation BEFORE INSERT ON confirmation_requests BEGIN SELECT RAISE(ABORT,'injected confirmation failure'); END");
 assert.throws(()=>memory.commit(p,receipt),/injected/);assert.equal(memory.get(A).revision,1);assert.equal(db.prepare('SELECT count(*) n FROM brand_revisions').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM operations').get().n,1);
 db.exec('DROP TRIGGER fail_confirmation');assert.equal(memory.commit(p,receipt).revision,2);
});
test('a fresh Node process retrieves the same persisted brand',async t=>{
 const {memory,root}=await fixture(t);const expected=await perform(memory,'brand.create',request());
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const databaseUrl=new URL('../../src/infrastructure/sqlite/database.mjs',import.meta.url).href,brandUrl=new URL('../../src/application/brand-memory.mjs',import.meta.url).href;
 const script=`import {openWorkspace} from ${JSON.stringify(databaseUrl)};import {createBrandMemory} from ${JSON.stringify(brandUrl)};const db=await openWorkspace(process.argv[1]);try{console.log(JSON.stringify(createBrandMemory(db).get(process.argv[2])));}finally{db.close();}`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,root,A]);assert.deepEqual(JSON.parse(stdout),expected);
});
test('committed receipt cannot authorize a second workspace, while committed replay needs no receipt',async t=>{
 const first=await fixture(t),second=await fixture(t);const p=first.memory.propose('brand.create',request()),receipt=await approve(p);
 const saved=first.memory.commit(p,receipt);assert.deepEqual(first.memory.commit(p,null),saved);
 assert.throws(()=>second.memory.commit(p,receipt),{code:'APPROVAL_REQUIRED'});assert.equal(second.memory.get(A),null);
});
