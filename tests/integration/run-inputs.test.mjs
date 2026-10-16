import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {initializeWorkspace,openWorkspace} from '../../src/infrastructure/sqlite/database.mjs';
import {createBrandMemory} from '../../src/application/brand-memory.mjs';
import {createRunService} from '../../src/application/run-service.mjs';
import {confirmBrandProposal} from '../../src/interfaces/cli/human-confirmation.mjs';
import {loadResourcesManifest,sha256} from '../../src/infrastructure/resources.mjs';
import {acquireMaintenance} from '../../src/infrastructure/sqlite/maintenance.mjs';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const config=()=>({name:'Synthetic',profile:'@synthetic',language:'pt-BR',audience:null,voice:null,preferences:[],fonts:{title:'Anton',body:'Manrope',mono:'JetBrains Mono'},themes:{light:{background:'#ffffff',text:'#000000',muted:'#555555',accent:'#ff0000',topics:[]}},logo:{enabled:false,variants:{},protection:12,minimumHeight:24},slideWidth:1080,slideHeight:1350,minimumSlideCount:12,maximumSlideCount:16,profileImage:''});
const carousel=(assets=[])=>({slug:'synthetic-carousel',theme:'light',voiceMode:'default',objective:'save',slides:Array.from({length:12},(_,i)=>({index:i+1,role:i===0?'cover':i===11?'cta':'content',eyebrow:'Synthetic',title:`Title ${i}`,body:'Body',visualSlot:'none'})),caption:'Caption',cta:'Save',hashtags:['#synthetic'],altText:'Synthetic slides',sources:[{title:'Example',url:'https://example.com'}],continuity:[],assets});
async function fixture(t,options={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'carousel-t12 memória ')),dataDir=path.join(root,'workspace');
 const db=await initializeWorkspace(dataDir),connections=[db];
 t.after(async()=>{for(const c of connections.reverse())if(c.open)c.close();await rm(root,{recursive:true,force:true});});
 const memory=createBrandMemory(db);
 for(const brandId of [A,B]){const p=memory.propose('brand.create',{requestId:randomUUID(),brandId,config:config()});memory.commit(p,await confirmBrandProposal(p,{input:{isTTY:true},output:{isTTY:true,write(){}},argv:[],ask:async()=> 'CONFIRMAR'}));}
 const manifest=await loadResourcesManifest();Object.assign(manifest.qualifiedRuntime,{node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules});
 const runs=createRunService(db,{dataDir,manifest}),run=await runs.create({requestId:randomUUID(),brandId:A,brandRevision:1,theme:'light'});
 const module=await import('../../src/application/run-inputs.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
 assert.equal(typeof module.createRunInputs,'function','T12 createRunInputs must exist');
 const service=await module.createRunInputs({root:dataDir,db,...options});
 async function file(name,bytes){const sourcePath=path.join(root,name);await writeFile(sourcePath,bytes);return {sourcePath,sha256:sha256(bytes)};}
 async function request({value=carousel(),concept='Documented visual concept',assets=[],...extra}={}){return {requestId:randomUUID(),brandId:A,runId:run.id,expectedVersion:runs.get(A,run.id).version,...(value===null?{}:{carousel:await file(`carousel-${randomUUID()}.json`,typeof value==='string'?value:JSON.stringify(value))}),...(concept===null?{}:{concept:await file(`concept-${randomUUID()}.md`,concept)}),assets,...extra};}
 return {root,dataDir,db,connections,runs,run,service,file,request,createRunInputs:module.createRunInputs};
}
const counts=db=>({artifacts:db.prepare('SELECT count(*) n FROM artifacts').get().n,inputsOperations:db.prepare("SELECT count(*) n FROM operations WHERE operation='run.inputs.save'").get().n});

test('complete inputs copy originals and persist an immutable, scoped manifest without granting consent',async t=>{
 const f=await fixture(t),asset=await f.file('explicit asset.bin',Buffer.from([0,255,13,10])),req=await f.request({value:carousel([{id:'drawing',path:'assets/drawing.png',transparent:true,approved:true}]),assets:[{id:'drawing',...asset}]}),saved=await f.service.save(req);
 assert.equal(saved.version,1);assert.equal(saved.runVersion,2);assert.equal(saved.status,'ready');assert.equal(saved.inputsComplete,true);assert.deepEqual(saved.missing,[]);assert.equal(saved.artifacts.assets.length,1);
 for(const [ref,source] of [[saved.artifacts.carousel,req.carousel],[saved.artifacts.concept,req.concept],[saved.artifacts.assets[0],asset]]){const managed=await f.service.resolveArtifact(A,f.run.id,ref.id);assert.deepEqual(await readFile(managed.path),await readFile(source.sourcePath));assert.equal(managed.sha256,source.sha256);await rm(source.sourcePath);}
 assert.deepEqual(await f.service.get(A,f.run.id),saved);assert.deepEqual(await f.service.save(req),saved);
 assert.equal(f.db.prepare('SELECT count(*) n FROM approvals').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_requests').get().n,2); // brand proposals only
 assert.deepEqual(f.db.prepare('SELECT step_key,status FROM steps WHERE run_id=?').all(f.run.id),[{step_key:'inputs',status:'succeeded'}]);
 assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM artifacts').all()).includes(f.root));assert.ok(!JSON.stringify(saved).includes(f.root));
});

test('partial material and absent/blank concept remain draft; each saved set replaces current material',async t=>{
 const f=await fixture(t),first=await f.service.save(await f.request({concept:null}));
 assert.equal(first.status,'draft');assert.deepEqual(first.missing,['concept']);assert.equal(first.inputsComplete,false);
 const complete=await f.service.save(await f.request());assert.equal(complete.status,'ready');assert.equal(complete.version,2);
 const partial=await f.service.save(await f.request({value:null,concept:'   '}));assert.equal(partial.status,'draft');assert.deepEqual(partial.missing,['carousel','concept']);assert.equal(partial.artifacts.carousel,null);
 assert.equal(f.db.prepare("SELECT status FROM steps WHERE run_id=? AND step_key='inputs'").get(f.run.id).status,'pending');
 assert.deepEqual(await f.service.get(A,f.run.id,1),first);assert.deepEqual(await f.service.list(A,f.run.id),[first,complete,partial]);
});

test('referenced paths never grant filesystem access and missing explicitly supplied assets prevent completion',async t=>{
 const f=await fixture(t);await mkdir(path.join(f.root,'assets'));await writeFile(path.join(f.root,'assets','hidden.png'),'DO NOT IMPORT');
 const value=carousel([{id:'hidden',path:'assets/hidden.png',transparent:true,approved:true}]),saved=await f.service.save(await f.request({value}));
 assert.equal(saved.inputsComplete,false);assert.deepEqual(saved.missing,['asset:hidden']);assert.deepEqual(saved.artifacts.assets,[]);assert.equal(saved.status,'draft');
});

test('structurally incomplete JSON is versioned as draft and a later valid version can complete inputs',async t=>{
 const f=await fixture(t),value=carousel();delete value.caption;const invalid=await f.service.save(await f.request({value}));
 assert.equal(invalid.status,'draft');assert.ok(invalid.issues.includes('CAROUSEL_INVALID'));assert.equal(invalid.inputsComplete,false);
 assert.equal((await f.service.save(await f.request())).status,'ready');
});

test('a complete empty creative-assets list is recorded without approving concept or other stages',async t=>{
 const f=await fixture(t),saved=await f.service.save(await f.request());assert.equal(saved.inputsComplete,true);assert.equal(saved.creativeAssets,'not-applicable');
 assert.equal(f.db.prepare('SELECT count(*) n FROM approvals').get().n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM steps WHERE step_key!='inputs'").get().n,0);
});

test('older material remains immutable and scoped across sibling runs and brands',async t=>{
 const f=await fixture(t),one=await f.service.save(await f.request()),value=carousel();value.slides[0].title='Changed';const two=await f.service.save(await f.request({value}));
 assert.notEqual(one.artifacts.carousel.id,two.artifacts.carousel.id);assert.notEqual(one.fingerprints['copy-approval'],two.fingerprints['copy-approval']);assert.deepEqual(await f.service.get(A,f.run.id,1),one);
 const sibling=await f.runs.create({requestId:randomUUID(),brandId:A,brandRevision:1,theme:'light'});
 assert.equal(await f.service.get(B,f.run.id),null);assert.deepEqual(await f.service.list(B,f.run.id),[]);
 await assert.rejects(f.service.resolveArtifact(A,sibling.id,one.artifacts.carousel.id),{code:'ARTIFACT_NOT_FOUND'});
 await assert.rejects(f.service.resolveArtifact(B,f.run.id,one.artifacts.carousel.id),{code:'ARTIFACT_NOT_FOUND'});
 await assert.rejects(f.service.save(await f.request({brandId:B})),{code:'RUN_NOT_FOUND'});
 assert.throws(()=>f.db.prepare("UPDATE artifacts SET kind='changed' WHERE id=?").run(one.artifacts.carousel.id),/immutable/);
});

test('replay excludes transport paths but rejects changes to content identity and verifies managed bytes',async t=>{
 const f=await fixture(t),req=await f.request(),saved=await f.service.save(req);await rm(req.carousel.sourcePath);await rm(req.concept.sourcePath);
 assert.deepEqual(await f.service.save({...req,carousel:{...req.carousel,sourcePath:'absent'},concept:{...req.concept,sourcePath:'also absent'}}),saved);
 await assert.rejects(f.service.save({...req,carousel:{...req.carousel,sha256:'a'.repeat(64)}}),{code:'IDEMPOTENCY_CONFLICT'});
 const resolved=await f.service.resolveArtifact(A,f.run.id,saved.artifacts.carousel.id);await writeFile(resolved.path,'tamper');
 await assert.rejects(f.service.get(A,f.run.id),{code:'ARTIFACT_HASH_MISMATCH'});await assert.rejects(f.service.save(req),{code:'ARTIFACT_HASH_MISMATCH'});
 await rm(resolved.path);await assert.rejects(f.service.get(A,f.run.id),{code:'RESOURCE_MISSING'});
});

test('manifest itself is verified before reading references',async t=>{
 const f=await fixture(t),saved=await f.service.save(await f.request()),row=f.db.prepare('SELECT relative_path FROM artifacts WHERE id=?').get(saved.id);await writeFile(path.join(f.dataDir,row.relative_path),'{}');
 await assert.rejects(f.service.get(A,f.run.id),{code:'ARTIFACT_HASH_MISMATCH'});
});

test('invalid source hashes, JSON bytes and undeclared supplied assets never publish a version',async t=>{
 const f=await fixture(t),req=await f.request();await assert.rejects(f.service.save({...req,carousel:{...req.carousel,sha256:'a'.repeat(64)}}),{code:'ARTIFACT_HASH_MISMATCH'});
 await assert.rejects(f.service.save(await f.request({value:'not JSON'})),{code:'CAROUSEL_INVALID'});
 const asset=await f.file('not-referenced.bin','bytes');await assert.rejects(f.service.save(await f.request({assets:[{id:'extra',...asset}]})),{code:'ASSET_NOT_REFERENCED'});
 assert.deepEqual(counts(f.db),{artifacts:0,inputsOperations:0});assert.equal(f.runs.get(A,f.run.id).status,'draft');
});

for(const mutate of [v=>{v.slug='../escape';},v=>{v.assets=[{id:'a',path:'../secret',transparent:true,approved:true}];},v=>{v.assets=[{id:'a',path:'assets/CON.png',transparent:true,approved:true}];},v=>{v.assets=[{id:'a',path:'assets/a.png:stream',transparent:true,approved:true}];}])test('unsafe slug or asset references are rejected without publication',async t=>{
 const f=await fixture(t),value=carousel();mutate(value);await assert.rejects(f.service.save(await f.request({value})),{code:'INVALID_ARGUMENT'});assert.equal(counts(f.db).artifacts,0);
});

test('duplicate asset identities or normalized paths are rejected',async t=>{
 const f=await fixture(t);for(const assets of [[{id:'same',path:'a.png'},{id:'same',path:'b.png'}],[{id:'one',path:'a.png'},{id:'two',path:'A.png'}]]){const value=carousel(assets.map(a=>({...a,transparent:true,approved:true})));await assert.rejects(f.service.save(await f.request({value})),{code:'INVALID_ARGUMENT'});}assert.equal(counts(f.db).artifacts,0);
});

for(const phase of ['write','close','hash','promotion','commit'])test(`${phase} failure leaves no published artifact, input stage or operation; explicit retry works`,async t=>{
 let fail=true;const f=await fixture(t,{hooks:{[phase]:()=>{if(fail)throw Object.assign(new Error('injected'),{code:'EIO'});}}}),req=await f.request();
 await assert.rejects(f.service.save(req));assert.deepEqual(counts(f.db),{artifacts:0,inputsOperations:0});assert.equal(f.runs.get(A,f.run.id).version,1);assert.equal(f.db.prepare('SELECT count(*) n FROM steps').get().n,0);
 if(phase==='commit')assert.ok((await readdir(path.join(f.dataDir,'runs',A,f.run.id))).length>0);
 fail=false;assert.equal((await f.service.save(req)).inputsComplete,true);
});

test('two SQLite connections publish one identical set and divergent requests use compare-and-swap',async t=>{
 const f=await fixture(t),otherDb=await openWorkspace(f.dataDir,{readonly:false});f.connections.push(otherDb);const other=await f.createRunInputs({root:f.dataDir,db:otherDb}),req=await f.request(),[a,b]=await Promise.all([f.service.save(req),other.save(req)]);assert.deepEqual(a,b);assert.deepEqual(counts(f.db),{artifacts:3,inputsOperations:1});
 const r1=await f.request({concept:'First changed concept'}),r2=await f.request({concept:'Other concept'}),out=await Promise.allSettled([f.service.save(r1),other.save(r2)]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.equal(out.find(x=>x.status==='rejected').reason.code,'RUN_VERSION_CONFLICT');assert.equal((await f.service.list(A,f.run.id)).length,2);
});

test('maintenance arriving during promotion blocks the entire input commit',async t=>{
 let db;const f=await fixture(t,{hooks:{promotion:()=>acquireMaintenance(db,{owner:'backup',purpose:'test'})}});db=f.db;
 await assert.rejects(f.service.save(await f.request()),{code:'WORKSPACE_MAINTENANCE'});assert.deepEqual(counts(db),{artifacts:0,inputsOperations:0});
});

test('terminal, active and unreconciled run states cannot be edited by this input service',async t=>{
 const f=await fixture(t);for(const status of ['completed','cancelled','running','interrupted','waiting-approval','blocked']){f.db.prepare('UPDATE runs SET status=? WHERE id=?').run(status,f.run.id);await assert.rejects(f.service.save(await f.request()),{code:'RUN_NOT_EDITABLE'});}
 f.db.prepare("UPDATE runs SET status='draft',lease_owner='active',lease_expires_at=? WHERE id=?").run(Date.now()+60000,f.run.id);await assert.rejects(f.service.save(await f.request()),{code:'RUN_NOT_EDITABLE'});assert.equal(counts(f.db).artifacts,0);
});

test('deferred constraint failure rolls back the whole set and request identity',async t=>{
 let db;const f=await fixture(t,{hooks:{commit:()=>db.prepare('UPDATE brands SET current_revision=99 WHERE id=?').run(A)}});db=f.db;
 await assert.rejects(f.service.save(await f.request()),{code:'SQLITE_CONSTRAINT_FOREIGNKEY'});assert.deepEqual(counts(db),{artifacts:0,inputsOperations:0});assert.equal(f.runs.get(A,f.run.id).version,1);
});

test('saved inputs can be queried in a fresh process without source files or personal globals',async t=>{
 const f=await fixture(t),req=await f.request(),saved=await f.service.save(req);await rm(req.carousel.sourcePath);await rm(req.concept.sourcePath);
 const script=`import {openWorkspace} from ${JSON.stringify(new URL('../../src/infrastructure/sqlite/database.mjs',import.meta.url).href)};import {createRunInputs} from ${JSON.stringify(new URL('../../src/application/run-inputs.mjs',import.meta.url).href)};const db=await openWorkspace(process.argv[1]);try{console.log(JSON.stringify(await (await createRunInputs({root:process.argv[1],db})).get(process.argv[2],process.argv[3])));}finally{db.close();}`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,f.dataDir,A,f.run.id]);assert.deepEqual(JSON.parse(stdout),saved);
});

test('legacy validator is lazy with unchanged default lookup; explicit context never reads personal globals',async()=>{
 const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';let reads=0,mode='deny';const original=fs.readFileSync;fs.readFileSync=(file,...rest)=>{if(String(file).replaceAll('\\\\','/').endsWith('/shared/themes.json')){reads++;if(mode==='deny')throw Error('PERSONAL_GLOBAL_DENIED');return JSON.stringify({'synthetic-theme':{}});}return original(file,...rest);};syncBuiltinESMExports();const {validateCarousel}=await import(${JSON.stringify(new URL('../../scripts/validate-carousel.mjs',import.meta.url).href)});const value=${JSON.stringify(carousel())};if(validateCarousel(value,{themes:['light']}).length||reads)throw Error('Explicit context read globals');try{validateCarousel(value);throw Error('Legacy did not resolve defaults');}catch(e){if(e.message!=='PERSONAL_GLOBAL_DENIED')throw e;}mode='synthetic';value.theme='synthetic-theme';if(validateCarousel(value).length)throw Error('Legacy defaults changed');value.theme='unknown';if(!validateCarousel(value).some(e=>e.startsWith('theme must be')))throw Error('Legacy theme constraint missing');console.log(reads);`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script]);assert.equal(stdout.trim(),'3');
});

test('fingerprints are canonical, scope-bound, executable-bound and selective by stage',async()=>{
 const module=await import('../../src/domain/artifact-fingerprints.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});assert.equal(typeof module.buildInputFingerprints,'function','T12 fingerprints must exist');
 const args={brandId:A,runId:randomUUID(),snapshotHash:'a'.repeat(64),executable:{package:{name:'synthetic',version:'1'},files:{'code.mjs':'b'.repeat(64)}},carousel:carousel([{id:'drawing',path:'a.png',transparent:true,approved:true}]),conceptHash:'c'.repeat(64),assets:[{id:'drawing',sha256:'d'.repeat(64)}]},base=module.buildInputFingerprints(args);
 assert.deepEqual(Object.keys(base).sort(),['assets-approval','concept-approval','copy-approval','inputs','render'].sort());
 const compare=(change)=>module.buildInputFingerprints({...args,...change});
 for(const change of [{brandId:B},{runId:randomUUID()},{snapshotHash:'e'.repeat(64)},{executable:{...args.executable,package:{name:'synthetic',version:'2'}}}])for(const key of Object.keys(base))assert.notEqual(compare(change)[key],base[key],key);
 const assetChange=compare({assets:[{id:'drawing',sha256:'e'.repeat(64)}]});assert.equal(assetChange['copy-approval'],base['copy-approval']);assert.equal(assetChange['concept-approval'],base['concept-approval']);assert.notEqual(assetChange['assets-approval'],base['assets-approval']);assert.notEqual(assetChange.render,base.render);
 const conceptChange=compare({conceptHash:'e'.repeat(64)});assert.equal(conceptChange['copy-approval'],base['copy-approval']);assert.notEqual(conceptChange['concept-approval'],base['concept-approval']);
 const changedCopy=structuredClone(args.carousel);changedCopy.caption='New caption';for(const key of Object.keys(base))assert.notEqual(compare({carousel:changedCopy})[key],base[key]);
 const reordered=Object.fromEntries(Object.entries(args.carousel).reverse());assert.deepEqual(compare({carousel:reordered}),base);
 const reversed=structuredClone(args.carousel);reversed.slides.reverse();assert.notEqual(compare({carousel:reversed})['copy-approval'],base['copy-approval']);
});

test('package manifest declares the T12 executable modules without adding private defaults to release',async()=>{
 const manifest=await loadResourcesManifest();for(const file of ['src/application/run-inputs.mjs','src/domain/artifact-fingerprints.mjs'])assert.ok(manifest.requiredFiles.includes(file),`${file} required`);
});


test('visual composition changes concept scope while preserving copy; asset bytes preserve both',async()=>{
 const {buildInputFingerprints}=await import('../../src/domain/artifact-fingerprints.mjs'),args={brandId:A,runId:randomUUID(),snapshotHash:'a'.repeat(64),executable:{version:'1'},carousel:carousel(),conceptHash:'b'.repeat(64),assets:[]},base=buildInputFingerprints(args),visual=structuredClone(args.carousel);visual.slides[0].visualSlot='left';
 const next=buildInputFingerprints({...args,carousel:visual});assert.equal(next['copy-approval'],base['copy-approval']);assert.notEqual(next['concept-approval'],base['concept-approval']);assert.notEqual(next['assets-approval'],base['assets-approval']);
});

test('malformed optional descriptors cannot silently remove a supplied material',async t=>{
 const f=await fixture(t);for(const value of [false,0,'',null]){const req=await f.request();await assert.rejects(f.service.save({...req,carousel:value}),{code:'INVALID_ARGUMENT'});}await assert.rejects(f.service.save({...await f.request(),assets:null}),{code:'INVALID_ARGUMENT'});assert.equal(counts(f.db).artifacts,0);
});

test('unchanged ready material preserves downstream history but a live attempt still blocks edits',async t=>{
 const f=await fixture(t),saved=await f.service.save(await f.request()),confirmation=randomUUID(),step=randomUUID();
 f.db.prepare("INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,status) VALUES(?,?,?,'copy',?,'confirmed')").run(confirmation,A,f.run.id,'a'.repeat(64));
 f.db.prepare("INSERT INTO approvals(id,brand_id,run_id,kind,object_fingerprint,decision,confirmation_request_id,evidence_json) VALUES(?,?,?,'copy',?,'approved',?,'{}')").run(randomUUID(),A,f.run.id,'a'.repeat(64),confirmation);
 assert.deepEqual(await f.service.save(await f.request()),saved);f.db.exec('DELETE FROM approvals');
 f.db.prepare("INSERT INTO steps(id,brand_id,run_id,step_key,status) VALUES(?,?,?,'render','succeeded')").run(step,A,f.run.id);assert.deepEqual(await f.service.save(await f.request()),saved);
 f.db.prepare("UPDATE steps SET status='pending' WHERE id=?").run(step);
 f.db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token) VALUES(?,?,?,?,1,'synthetic',1)").run(randomUUID(),A,f.run.id,step);await assert.rejects(f.service.save(await f.request()),{code:'RUN_NOT_EDITABLE'});
 assert.deepEqual(await f.service.get(A,f.run.id),saved);
});

test('a process killed inside the input commit leaves only unreferenced complete files',async t=>{
 const f=await fixture(t),req=await f.request(),script=`import {writeSync} from 'node:fs';import {openWorkspace} from ${JSON.stringify(new URL('../../src/infrastructure/sqlite/database.mjs',import.meta.url).href)};import {createRunInputs} from ${JSON.stringify(new URL('../../src/application/run-inputs.mjs',import.meta.url).href)};const db=await openWorkspace(process.argv[1],{readonly:false});await (await createRunInputs({root:process.argv[1],db,hooks:{commit:()=>{writeSync(1,'T12_COMMIT_ENTERED');process.kill(process.pid,'SIGKILL');}}})).save(JSON.parse(process.argv[2]));`;
 await assert.rejects(promisify(execFile)(process.execPath,['--input-type=module','-e',script,f.dataDir,JSON.stringify(req)]),error=>error.stdout.includes('T12_COMMIT_ENTERED'));
 assert.ok((await readdir(path.join(f.dataDir,'runs',A,f.run.id))).length>0);
 assert.deepEqual(counts(f.db),{artifacts:0,inputsOperations:0});assert.equal(f.runs.get(A,f.run.id).version,1);assert.equal(f.db.prepare('SELECT count(*) n FROM steps').get().n,0);assert.equal((await f.service.save(req)).inputsComplete,true);
});

test('input fingerprints treat JSON serialization differences canonically, while preserving original bytes',async t=>{
 const f=await fixture(t),value=carousel(),first=await f.service.save(await f.request({value})),formatted=JSON.stringify(Object.fromEntries(Object.entries(value).reverse()),null,2),second=await f.service.save(await f.request({value:formatted}));
 assert.deepEqual(first.fingerprints,second.fingerprints);assert.notEqual(first.artifacts.carousel.sha256,second.artifacts.carousel.sha256);
});


test('save in a fresh process validates with the snapshot while all personal globals are denied',async t=>{
 const f=await fixture(t),req=await f.request(),script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.readFileSync;fs.readFileSync=(file,...rest)=>{if(/\\/shared\\/(themes|brand)\\.json$/.test(String(file).replaceAll('\\\\','/')))throw Error('PERSONAL_GLOBAL_DENIED');return original(file,...rest);};syncBuiltinESMExports();const {openWorkspace}=await import(${JSON.stringify(new URL('../../src/infrastructure/sqlite/database.mjs',import.meta.url).href)});const {createRunInputs}=await import(${JSON.stringify(new URL('../../src/application/run-inputs.mjs',import.meta.url).href)});const db=await openWorkspace(process.argv[1],{readonly:false});try{console.log(JSON.stringify(await (await createRunInputs({root:process.argv[1],db})).save(JSON.parse(process.argv[2]))));}finally{db.close();}`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,f.dataDir,JSON.stringify(req)]),saved=JSON.parse(stdout);assert.equal(saved.inputsComplete,true);assert.deepEqual(await f.service.get(A,f.run.id),saved);
});

test('archived brands and future schemas block new saves and schema-incompatible queries',async t=>{
 const f=await fixture(t),req=await f.request();f.db.prepare("UPDATE brands SET status='archived' WHERE id=?").run(A);await assert.rejects(f.service.save(req),{code:'BRAND_ARCHIVED'});f.db.prepare("UPDATE brands SET status='active' WHERE id=?").run(A);f.db.pragma('user_version=3');await assert.rejects(f.service.save(req),{code:'SCHEMA_TOO_NEW'});await assert.rejects(f.service.get(A,f.run.id),{code:'SCHEMA_TOO_NEW'});await assert.rejects(f.service.list(A,f.run.id),{code:'SCHEMA_TOO_NEW'});assert.equal(counts(f.db).artifacts,0);
});

test('Q04 composition plans have an explicit save operation and cannot be attached to v1 history',async t=>{
 const f=await fixture(t);
 assert.equal(typeof f.service.savePlan,'function');
 await assert.rejects(f.service.savePlan({requestId:randomUUID(),brandId:A,runId:f.run.id,expectedVersion:1,plan:{}}),{code:'RUN_DERIVATION_REQUIRED'});
 assert.equal(counts(f.db).artifacts,0);
});

test('Q04 v2 inputs require an immutable scoped plan before structural readiness',async t=>{
 const {qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),f=await qualityStateFixture(t),saved=await f.save();
 assert.equal(saved.schemaVersion,2);assert.equal(saved.contractVersion,2);assert.equal(saved.inputsComplete,false);assert.deepEqual(saved.missing,['composition-plan']);
 const plan=f.plan(saved),before=f.db.prepare('SELECT snapshot_json FROM runs WHERE id=?').get(f.request.runId).snapshot_json;
 const complete=await f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan});
 assert.equal(complete.inputsComplete,true);assert.equal(complete.status,'ready');assert.equal(complete.version,2);
 assert.equal(complete.artifacts.plan.kind,'composition-plan');assert.equal(complete.artifacts.plan.sha256,(await import('../../src/domain/canonical-json.mjs')).canonicalHash(plan));
 assert.equal(f.db.prepare('SELECT snapshot_json FROM runs WHERE id=?').get(f.request.runId).snapshot_json,before);
 assert.equal(f.db.prepare('SELECT count(*) n FROM approvals').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM step_attempts').get().n,0);
 assert.deepEqual(await f.inputs.get(f.request.brandId,f.request.runId,1),saved);
 assert.deepEqual(await f.inputs.get(f.request.brandId,f.request.runId),complete);
});
test('Q04 plan replay is immutable and scoped with no hidden approval or stale substitution',async t=>{
 const {qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),f=await qualityStateFixture(t),saved=await f.save();
 const request={requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan:f.plan(saved)},result=await f.inputs.savePlan(request);
 assert.deepEqual(await f.inputs.savePlan(request),result);
 await assert.rejects(f.inputs.savePlan({...request,plan:{...request.plan,copyFingerprint:'a'.repeat(64)}}),{code:'IDEMPOTENCY_CONFLICT'});
 for(const patch of [{brandId:B},{runId:randomUUID()},{snapshotHash:'a'.repeat(64)},{copyFingerprint:'b'.repeat(64)},{carouselRef:{...request.plan.carouselRef,sha256:'c'.repeat(64)}}]){
  const next={...request,requestId:randomUUID(),expectedVersion:result.runVersion,plan:{...request.plan,...patch}};
  await assert.rejects(f.inputs.savePlan(next),error=>['COMPOSITION_INVALID','COMPOSITION_PLAN_STALE'].includes(error.code));
 }
 const managed=await f.inputs.resolveArtifact(f.request.brandId,f.request.runId,result.artifacts.plan.id);await writeFile(managed.path,'tamper');
 await assert.rejects(f.inputs.get(f.request.brandId,f.request.runId),{code:'ARTIFACT_HASH_MISMATCH'});
});
test('Q04 active v2 workspace refuses mutable historical v1 save including operation replay',async t=>{
 const f=await fixture(t),request=await f.request(),saved=await f.service.save(request);
 const {qualityActivationMigration}=await import('../../src/infrastructure/sqlite/migrations.mjs');
 f.db.transaction(()=>{f.db.exec(qualityActivationMigration.sql);f.db.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)').run(2,qualityActivationMigration.name,qualityActivationMigration.checksum);f.db.pragma('user_version=2');}).immediate();
 await assert.rejects(f.service.save(request),{code:'RUN_DERIVATION_REQUIRED'});
 assert.deepEqual(await f.service.get(A,f.run.id),saved);
});

test('T16 identical material after a persisted plan preserves that plan as a no-op',async t=>{
 const {qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),f=await qualityStateFixture(t),saved=await f.save();
 const ready=await f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan:f.plan(saved)});
 const before=f.db.prepare('SELECT * FROM artifacts').all();assert.deepEqual(await f.save(),ready);assert.deepEqual(f.db.prepare('SELECT * FROM artifacts').all(),before);
});
test('Q04 v1 historical queries retain persisted executable identity without reading installed resources',async t=>{
 const f=await fixture(t),saved=await f.service.save(await f.request());
 const {createRunInputs}=await import('../../src/application/run-inputs.mjs'),reader=await createRunInputs({root:f.dataDir,db:f.db,packageRoot:path.join(f.root,'missing-package')});
 assert.deepEqual(await reader.get(A,f.run.id),saved);assert.deepEqual((await reader.get(A,f.run.id)).executable,saved.executable);
});

test('Q04 saving a plan verifies the current executable instead of adopting historical identity',async t=>{
 const {qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),f=await qualityStateFixture(t),saved=await f.save(),{createRunInputs}=await import('../../src/application/run-inputs.mjs');
 const writer=await createRunInputs({root:f.dataDir,db:f.db,qualifications:f.qualifications,packageRoot:path.join(f.root,'missing-package')}),before=f.db.serialize();
 await assert.rejects(writer.savePlan({requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan:f.plan(saved)}),{code:'PACKAGE_INCOMPLETE'});
 assert.deepEqual(f.db.serialize(),before);
});

test('Q04 changed installed code cannot inherit the executable frozen by earlier inputs',async t=>{
 const {qualityStateFixture}=await import('../helpers/quality-state-fixture.mjs'),f=await qualityStateFixture(t),saved=await f.save(),{createRunInputs}=await import('../../src/application/run-inputs.mjs'),{copyFile,appendFile}=await import('node:fs/promises');
 const manifest=await loadResourcesManifest(),packageRoot=path.join(f.root,'package-copy');
 for(const name of manifest.requiredFiles){const target=path.join(packageRoot,name);await mkdir(path.dirname(target),{recursive:true});await copyFile(new URL(`../../${name}`,import.meta.url),target);}
 await appendFile(path.join(packageRoot,'src/domain/stage-graph.mjs'),'\n// Synthetic changed executable\n');
 const writer=await createRunInputs({root:f.dataDir,db:f.db,qualifications:f.qualifications,packageRoot}),before=f.db.serialize();
 await assert.rejects(writer.savePlan({requestId:randomUUID(),...f.request,expectedVersion:saved.runVersion,plan:f.plan(saved)}),{code:'RUNTIME_MISMATCH'});
 assert.deepEqual(f.db.serialize(),before);
});
