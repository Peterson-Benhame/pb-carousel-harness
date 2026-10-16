import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {initializeWorkspace,openWorkspace} from '../../src/infrastructure/sqlite/database.mjs';
import {createBrandMemory} from '../../src/application/brand-memory.mjs';
import {confirmBrandProposal} from '../../src/interfaces/cli/human-confirmation.mjs';
import {loadResourcesManifest,sha256} from '../../src/infrastructure/resources.mjs';
import {canonicalHash} from '../../src/domain/canonical-json.mjs';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const config=()=>({name:'Synthetic',profile:'@synthetic',language:'pt-BR',audience:null,voice:null,preferences:[],fonts:{title:'Anton',body:'Manrope',mono:'JetBrains Mono'},themes:{light:{background:'#ffffff',text:'#000000',muted:'#555555',accent:'#ff0000',topics:[]}},logo:{enabled:false,variants:{},protection:12,minimumHeight:24},slideWidth:1080,slideHeight:1350,minimumSlideCount:12,maximumSlideCount:16,profileImage:''});
async function persist(memory,brandId=A,c=config(),expectedRevision){const p=memory.propose(expectedRevision?'brand.update':'brand.create',{requestId:randomUUID(),brandId,config:c,...(expectedRevision?{expectedRevision}:{})});return memory.commit(p,await confirmBrandProposal(p,{input:{isTTY:true},output:{isTTY:true,write(){}},argv:[],ask:async()=> 'CONFIRMAR'}));}
async function fixture(t,{schemaVersion=1,quality=false}={}){const root=await mkdtemp(path.join(os.tmpdir(),'carousel-t11 snapshots ')),dataDir=path.join(root,'workspace'),fontRoot=path.join(root,'fonts');await mkdir(fontRoot);const db=await initializeWorkspace(dataDir,{schemaVersion}),connections=[db];t.after(async()=>{for(const c of connections.reverse())if(c.open)c.close();await rm(root,{recursive:true,force:true});});const memory=createBrandMemory(db);await persist(memory);const manifest=await loadResourcesManifest();Object.assign(manifest.qualifiedRuntime,{node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules});for(const f of manifest.fonts){const bytes=Buffer.from(`SYNTHETIC, NOT A FONT: ${f.id}`);if(!quality)f.sha256=sha256(bytes);await writeFile(path.join(fontRoot,f.file),bytes);}const options={dataDir,fontRoot,manifest};const module=await import('../../src/application/run-service.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});assert.equal(typeof module.createRunService,'function','T11 createRunService must exist');return {root,db,memory,options,connections,service:module.createRunService(db,options),createRunService:module.createRunService};}
const request=(extra={})=>({requestId:randomUUID(),brandId:A,brandRevision:1,theme:'light',...extra});
test('create freezes complete explicit brand, theme, resources and effective native runtime; reopen reads original',async t=>{const f=await fixture(t),run=await f.service.create(request());assert.equal(run.status,'draft');assert.equal(run.parentRunId,null);assert.equal(run.snapshot.brand.revision,1);assert.deepEqual(run.snapshot.brand.config,config());assert.deepEqual(run.snapshot.theme,{id:'light',values:config().themes.light});assert.deepEqual(run.snapshot.dimensions,{width:1080,height:1350});assert.deepEqual(run.snapshot.approvalPolicy,{mode:'guided',required:['copy','concept','creative-assets']});assert.equal(run.snapshot.contractVersion,1);assert.equal(run.snapshot.renderer.id,'legacy-panorama@1');assert.equal(run.snapshot.runtime.node,process.version);assert.ok(run.snapshot.runtime.dependencies.sharp.vips);assert.deepEqual(run.snapshot.fonts,f.options.manifest.fonts.map(({id,sha256})=>({id,sha256})));assert.equal(run.snapshotHash,canonicalHash(run.snapshot));assert.ok(!JSON.stringify(run).includes(f.root));assert.ok(!JSON.stringify(run.snapshot).includes('authorizedFontDirectory'));assert.deepEqual(run.approvals,[]);const other=await openWorkspace(f.options.dataDir);f.connections.push(other);assert.deepEqual(f.createRunService(other).get(A,run.id),run);assert.deepEqual(f.service.list({brandId:A}),[run]);});
test('later brand revision and detached return mutations never change prior snapshot; override is run-only',async t=>{const f=await fixture(t),r=await f.service.create(request({adjustments:{voice:'brief'}})),original=structuredClone(r);await persist(f.memory,A,{...config(),voice:'new default'},1);r.snapshot.brand.config.name='tamper';assert.deepEqual(f.service.get(A,r.id),original);assert.equal(f.memory.get(A,1).config.voice,null);assert.equal((await f.service.create(request())).snapshot.brand.config.voice,null);assert.equal((await f.service.create(request({brandRevision:2}))).snapshot.brand.config.voice,'new default');assert.throws(()=>f.db.prepare("UPDATE runs SET snapshot_json='{}' WHERE id=?").run(r.id),/immutable/);});
test('derive records scoped material lineage with new ID and no copied consent or artifacts',async t=>{const f=await fixture(t),parent=await f.service.create(request()),artifact=randomUUID(),confirmation=randomUUID();f.db.prepare("INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path) VALUES(?,?,?,'copy',1,?,'synthetic/copy.json')").run(artifact,A,parent.id,'a'.repeat(64));f.db.prepare("INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,status) VALUES(?,?,?,'copy',?,'confirmed')").run(confirmation,A,parent.id,'b'.repeat(64));f.db.prepare("INSERT INTO approvals(id,brand_id,run_id,kind,object_fingerprint,decision,confirmation_request_id,evidence_json) VALUES(?,?,?,'copy',?,'approved',?,'{}')").run(randomUUID(),A,parent.id,'b'.repeat(64),confirmation);await persist(f.memory,A,{...config(),voice:'revision two'},1);const child=await f.service.derive(request({brandRevision:2,parentRunId:parent.id,materialArtifactIds:[artifact]}));assert.notEqual(child.id,parent.id);assert.equal(child.parentRunId,parent.id);assert.equal(child.status,'draft');assert.equal(child.snapshot.brand.revision,2);assert.deepEqual(child.approvals,[]);assert.deepEqual(child.snapshot.materialReferences,[{runId:parent.id,artifactId:artifact,kind:'copy',version:1,sha256:'a'.repeat(64)}]);assert.equal(f.db.prepare('SELECT count(*) n FROM artifacts WHERE run_id=?').get(child.id).n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_requests WHERE run_id=?').get(child.id).n,0);});
test('scope rejects cross-brand parent/material and querying other brands exposes nothing',async t=>{const f=await fixture(t);await persist(f.memory,B);const parent=await f.service.create(request());assert.equal(f.service.get(B,parent.id),null);assert.deepEqual(f.service.list({brandId:B}),[]);await assert.rejects(f.service.derive(request({brandId:B,parentRunId:parent.id})),{code:'RUN_NOT_FOUND'});await assert.rejects(f.service.derive(request({parentRunId:parent.id,materialArtifactIds:[randomUUID()]})),{code:'ARTIFACT_NOT_FOUND'});assert.equal(f.service.list({brandId:A}).length,1);});
test('explicit revision, theme and supported editorial adjustments are mandatory and validated',async t=>{const f=await fixture(t);for(const extra of [{brandRevision:undefined},{brandRevision:0},{brandRevision:99},{theme:'absent'},{adjustments:{logo:{enabled:true}}},{approved:true},{runtime:{node:'fake'}}])await assert.rejects(f.service.create(request(extra)));assert.equal(f.service.list({brandId:A}).length,0);});
test('replay returns original after brand/resource changes, while changed payload conflicts',async t=>{const f=await fixture(t),req=request(),first=await f.service.create(req);await rm(f.options.fontRoot,{recursive:true});f.options.manifest.qualifiedRuntime.node='incompatible';assert.deepEqual(await f.service.create(req),first);await assert.rejects(f.service.create({...req,theme:'other'}),{code:'IDEMPOTENCY_CONFLICT'});assert.equal(f.service.list({brandId:A}).length,1);});
test('missing fonts remain external expected references and never imply render readiness',async t=>{const f=await fixture(t);await rm(f.options.fontRoot,{recursive:true});const run=await f.service.create(request());assert.equal(run.snapshot.resourceState.renderPrerequisites,false);assert.ok(run.snapshot.resourceState.blockers.some(x=>x.code==='RESOURCE_MISSING'));assert.ok(run.snapshot.fonts.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)));assert.ok(run.snapshot.runtime.fonts.every(x=>x.sha256===null));});
test('incompatible mutable runtime blocks new runs but permits stored snapshot queries',async t=>{const f=await fixture(t),run=await f.service.create(request());f.options.manifest.qualifiedRuntime.node='incompatible';await assert.rejects(f.service.create(request()),{code:'RUNTIME_INCOMPATIBLE'});assert.equal(f.service.get(A,run.id).id,run.id);});
test('maintenance, archived brand, future schema and failed insert preserve atomicity',async t=>{const f=await fixture(t);f.db.exec("CREATE TRIGGER reject_run BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT,'injected failure'); END");const req=request();await assert.rejects(f.service.create(req),/injected failure/);assert.equal(f.db.prepare('SELECT count(*) n FROM operations WHERE request_id=?').get(req.requestId).n,0);f.db.exec('DROP TRIGGER reject_run');await f.service.create(req);f.db.prepare("UPDATE maintenance_coordination SET owner='backup',purpose='backup',expires_at=?").run(Date.now()+60000);await assert.rejects(f.service.create(request()),{code:'WORKSPACE_MAINTENANCE'});f.db.exec("UPDATE maintenance_coordination SET owner=NULL,purpose=NULL,expires_at=NULL; UPDATE brands SET status='archived'");await assert.rejects(f.service.create(request()),{code:'BRAND_ARCHIVED'});f.db.pragma('user_version=3');assert.throws(()=>f.service.list({brandId:A}),{code:'SCHEMA_TOO_NEW'});await assert.rejects(f.service.create(request()),{code:'SCHEMA_TOO_NEW'});});
test('schema and package completeness declare all T11 production files',async()=>{const manifest=await loadResourcesManifest();for(const file of ['src/application/run-service.mjs','src/domain/run-snapshot.mjs','shared/run-snapshot.schema.json'])assert.ok(manifest.requiredFiles.includes(file),`${file} required`);const schema=JSON.parse(await readFile(new URL('../../shared/run-snapshot.schema.json',import.meta.url),'utf8'));assert.equal(schema.oneOf.length,2);for(const branch of Object.values(schema.$defs)){assert.equal(branch.additionalProperties,false);for(const key of ['brand','theme','dimensions','approvalPolicy','logos','fonts','runtime','renderer','materialReferences'])assert.ok(branch.required.includes(key));assert.equal(branch.properties.fonts.items.additionalProperties,false);}assert.equal(schema.$defs.v1.properties.schemaVersion.const,1);assert.equal(schema.$defs.v2.properties.pipelineVersion.const,2);});
test('real PNG association freezes original ID/hash and verifies managed bytes before a new run',async t=>{const f=await fixture(t);const {createLogoImport}=await import('../../src/application/logo-import.mjs');const sharp=(await import('sharp')).default;const sourcePath=path.join(f.root,'synthetic-logo.png'),bytes=await sharp({create:{width:3,height:2,channels:4,background:'#f00'}}).png().toBuffer();await writeFile(sourcePath,bytes);const logos=await createLogoImport({root:f.options.dataDir,db:f.db}),asset=await logos.importFile({requestId:randomUUID(),brandId:A,sourcePath}),p=await logos.proposeAssociation({requestId:randomUUID(),brandId:A,expectedRevision:1,assetId:asset.id,surfaces:['light'],enabled:true});await logos.commit(p,await confirmBrandProposal(p,{input:{isTTY:true},output:{isTTY:true,write(){}},argv:[],ask:async()=> 'CONFIRMAR'}));await rm(sourcePath);const run=await f.service.create(request({brandRevision:2}));assert.deepEqual(run.snapshot.logos,[{surface:'light',id:asset.id,sha256:sha256(bytes)}]);const managed=await logos.resolve(A,'light');await writeFile(managed.path,'tampered');await assert.rejects(f.service.create(request({brandRevision:2})),{code:'ASSET_HASH_MISMATCH'});assert.deepEqual(f.service.get(A,run.id),run);});
test('a separate Node process reads persisted identity without runtime resources',async t=>{const f=await fixture(t),run=await f.service.create(request());const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');const script=`import {openWorkspace} from ${JSON.stringify(new URL('../../src/infrastructure/sqlite/database.mjs',import.meta.url).href)};import {createRunService} from ${JSON.stringify(new URL('../../src/application/run-service.mjs',import.meta.url).href)};const db=await openWorkspace(process.argv[1]);try{console.log(JSON.stringify(createRunService(db).get(process.argv[2],process.argv[3])));}finally{db.close();}`;const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,f.options.dataDir,A,run.id]);assert.deepEqual(JSON.parse(stdout),run);});
test('default approved manifest enforces actual runtime qualification without injected matrix',async t=>{const f=await fixture(t),manifest=await loadResourcesManifest(),{runDoctor}=await import('../../src/application/doctor.mjs');const actual=await runDoctor({dataDir:f.options.dataDir}),service=f.createRunService(f.db,{dataDir:f.options.dataDir});if(actual.diagnostics.some(d=>d.code==='RUNTIME_INCOMPATIBLE'))await assert.rejects(service.create(request()),{code:'RUNTIME_INCOMPATIBLE'});else {const run=await service.create(request());assert.deepEqual(run.snapshot.fonts,manifest.fonts.map(({id,sha256})=>({id,sha256})));assert.equal(run.snapshot.resourceState.renderPrerequisites,false);}assert.equal(actual.readiness.query,true);assert.ok(Array.isArray(service.list({brandId:A})));});
test('divergent external font records expected and effective hashes separately with render blocker',async t=>{const f=await fixture(t),font=f.options.manifest.fonts[0],bytes=Buffer.from('CHANGED SYNTHETIC, NOT A FONT');await writeFile(path.join(f.options.fontRoot,font.file),bytes);const run=await f.service.create(request());assert.equal(run.snapshot.fonts[0].sha256,font.sha256);assert.equal(run.snapshot.runtime.fonts[0].sha256,sha256(bytes));assert.equal(run.snapshot.resourceState.renderPrerequisites,false);assert.ok(run.snapshot.resourceState.blockers.some(d=>d.code==='RUNTIME_MISMATCH'&&d.resource===font.id));});
test('existing artifact from sibling run or foreign brand cannot become parent material',async t=>{const f=await fixture(t);await persist(f.memory,B);const parent=await f.service.create(request()),sibling=await f.service.create(request()),foreign=await f.service.create(request({brandId:B}));for(const run of [sibling,foreign]){const id=randomUUID();f.db.prepare("INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path) VALUES(?,?,?,'copy',1,?,?)").run(id,run.brandId,run.id,'a'.repeat(64),`synthetic/${id}.json`);await assert.rejects(f.service.derive(request({parentRunId:parent.id,materialArtifactIds:[id]})),{code:'ARTIFACT_NOT_FOUND'});}assert.equal(f.service.list({brandId:A}).length,2);});

test('Q02 v2 brand configuration cannot leak into a v1 snapshot before Q04 activation', async t => {
  const f = await fixture(t);
  const historical = await f.service.create(request());
  const nextConfig = { ...config(), configVersion: 2 };
  nextConfig.fonts.accent = 'nimbus-roman-italic@1';
  nextConfig.themes.light.surfaceBindings = {
    light: { background: 'background', text: 'text', muted: 'muted', accent: 'accent' },
  };
  await persist(f.memory, A, nextConfig, 1);
  const next = request({ brandRevision: 2 });
  const derived = request({ brandRevision: 2, parentRunId: historical.id });
  const attempts = await Promise.allSettled([f.service.create(next), f.service.derive(derived)]);
  assert.deepEqual(attempts.map(attempt => [attempt.status, attempt.reason?.code]), [
    ['rejected', 'RUN_CONTRACT_UNSUPPORTED'], ['rejected', 'RUN_CONTRACT_UNSUPPORTED'],
  ]);
  assert.equal(f.service.list({ brandId: A }).length, 1);
  assert.deepEqual(f.service.get(A, historical.id), historical);
  assert.equal(f.db.prepare('SELECT count(*) n FROM operations WHERE request_id=?').get(next.requestId).n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM operations WHERE request_id=?').get(derived.requestId).n, 0);
  assert.deepEqual(f.memory.get(A, 2).config, nextConfig);
});

test('v1 snapshot builder rejects a composed renderer identity even with a historical brand', async t => {
  const f = await fixture(t);
  const historical = await f.service.create(request());
  const { buildRunSnapshot } = await import('../../src/domain/run-snapshot.mjs');
  const runtime = structuredClone(historical.snapshot.runtime);
  runtime.renderer.id = 'editorial-composed@1';
  assert.throws(() => buildRunSnapshot({
    brand: f.memory.get(A, 1), theme: 'light', fonts: historical.snapshot.fonts,
    logos: [], runtime, resourceState: historical.snapshot.resourceState,
  }), { code: 'RUN_CONTRACT_UNSUPPORTED' });
  assert.deepEqual(f.service.get(A, historical.id), historical);
});

test('Q04 snapshot v2 freezes released references and dispatches without rewriting v1', async () => {
  const api = await import('../../src/domain/run-snapshot.mjs');
  const {qualitySnapshotFixture} = await import('../fixtures/quality/snapshot-fixture.mjs');
  const {input,qualityResources} = await qualitySnapshotFixture();
  const snapshot = api.buildRunSnapshot(input);
  assert.equal(snapshot.contractVersion,2);
  assert.equal(snapshot.pipelineVersion,2);
  assert.equal(snapshot.qualityPolicyVersion,1);
  assert.deepEqual(snapshot.approvalPolicy.required,['copy','concept','creative-assets','preview']);
  assert.equal(snapshot.renderer.id,'editorial-composed@1');
  assert.deepEqual(snapshot.runtime.renderer,snapshot.renderer);
  assert.deepEqual(snapshot.qualifications,qualityResources.qualifications.map(q=>({id:q.id,version:q.version,sha256:canonicalHash(q),definitionHash:q.definitionHash})).sort((a,b)=>a.id.localeCompare(b.id)));
  assert.ok(snapshot.fontBindings.every(binding => binding.role !== 'accent'));
  assert.equal(snapshot.resourceManifestRef.version,2);
  for (const key of ['plan','previewSelection','review','consent','manifest']) assert.equal(Object.hasOwn(snapshot,key),false);
  assert.deepEqual(api.validateRunSnapshot(snapshot),snapshot);
  assert.deepEqual(api.getRunContract(snapshot),{schemaVersion:2,contractVersion:2,canonicalVersion:1,pipelineVersion:2,qualityPolicyVersion:1});
});

test('Q04 snapshot rejects candidates, incomplete releases, incoherent contracts and font inventions', async () => {
  const api = await import('../../src/domain/run-snapshot.mjs');
  const {qualitySnapshotFixture} = await import('../fixtures/quality/snapshot-fixture.mjs');
  const {compositionFixture} = await import('../fixtures/quality/composition-fixture.mjs');
  const {input} = await qualitySnapshotFixture();
  assert.throws(()=>api.buildRunSnapshot({...input,qualifications:[]}),{code:'LAYOUT_NOT_QUALIFIED'});
  const candidates = (await compositionFixture()).qualifications;
  assert.throws(()=>api.buildRunSnapshot({...input,qualifications:candidates}),{code:'LAYOUT_NOT_QUALIFIED'});
  assert.throws(()=>api.buildRunSnapshot({...input,qualifications:input.qualifications.filter(q=>q.definition.layoutId==='cover-editorial@1')}),{code:'LAYOUT_NOT_QUALIFIED'});
  const snapshot = api.buildRunSnapshot(input);
  for (const edit of [s=>s.pipelineVersion=1,s=>s.qualityPolicyVersion=2,s=>s.canonicalVersion=2,s=>s.contractVersion=1,s=>s.runtime.renderer.id='legacy-panorama@1']) {
    const wrong=structuredClone(snapshot);edit(wrong);assert.throws(()=>api.validateRunSnapshot(wrong),{code:'RUN_CONTRACT_UNSUPPORTED'});
  }
  for (const edit of [s=>s.fontBindings[0].axes.unknown=4,s=>s.fontBindings[0].fontId='/tmp/font.ttf',s=>s.fontBindings[0].sha256='f'.repeat(64),s=>s.qualityPolicy.maxCorrectionRounds=3,s=>s.resourceManifestRef.version=1,s=>s.previewSelection={}]) {
    const wrong=structuredClone(snapshot);edit(wrong);assert.throws(()=>api.validateRunSnapshot(wrong));
  }
  const wrong=structuredClone(input);wrong.fontBindings[0].weight=999;
  assert.throws(()=>api.buildRunSnapshot(wrong));
});

test('Q04 creation requires explicit activation, defaults to v2 on schema2 and never accepts public quality overrides', async t => {
  const f=await fixture(t);
  await assert.rejects(f.service.create(request({contractVersion:2})),{code:'WORKSPACE_ACTIVATION_REQUIRED'});
  for (const contractVersion of [3,null,0,'2',false]) await assert.rejects(f.service.create(request({contractVersion})),{code:'RUN_CONTRACT_UNSUPPORTED'});
  for(const extra of [{allowUnqualified:true},{qualifications:[]},{qualityPolicy:{}},{fontBindings:[]}]) await assert.rejects(f.service.create(request(extra)));
  const active=await fixture(t,{schemaVersion:2,quality:true});
  await assert.rejects(active.service.create(request()),{code:'LAYOUT_NOT_QUALIFIED'});
  await assert.rejects(active.service.create(request({contractVersion:1})),{code:'RUN_DERIVATION_REQUIRED'});
  assert.equal(active.db.prepare('SELECT count(*) n FROM runs').get().n,0);
  assert.equal(active.db.prepare("SELECT count(*) n FROM operations WHERE operation='run.create'").get().n,0);
});

async function trustedQualityService(f) {
  const {runDoctor}=await import('../../src/application/doctor.mjs');
  const {qualitySnapshotFixture}=await import('../fixtures/quality/snapshot-fixture.mjs');
  const runtime=(await runDoctor({...f.options,rendererId:'editorial-composed@1'})).runtime;
  const {qualityResources}=await qualitySnapshotFixture({runtime,manifest:f.options.manifest,config:config(),theme:'light'});
  return f.createRunService(f.db,{...f.options,qualityResources});
}

test('Q04 trusted synthetic releases permit immutable v2 identity and replay without granting approvals', async t => {
  const f=await fixture(t,{schemaVersion:2,quality:true}),service=await trustedQualityService(f),req=request();
  const run=await service.create(req);
  assert.equal(run.snapshot.contractVersion,2);
  assert.equal(run.snapshot.renderer.id,'editorial-composed@1');
  assert.deepEqual(run.snapshot.renderer,run.snapshot.runtime.renderer);
  assert.deepEqual(run.approvals,[]);
  assert.equal(run.snapshot.resourceState.renderPrerequisites,false);
  assert.ok(run.snapshot.resourceState.blockers.some(item=>item.code==='LAYOUT_NOT_QUALIFIED'));
  assert.equal(run.snapshotHash,canonicalHash(run.snapshot));
  assert.equal(run.snapshot.resourceManifestRef.sha256,canonicalHash(f.options.manifest));
  assert.deepEqual(await service.create(req),run);
  assert.equal(service.get(A,run.id).snapshotHash,run.snapshotHash);
  await assert.rejects(service.create(request({contractVersion:1})),{code:'RUN_DERIVATION_REQUIRED'});
});

test('Q04 activated workspace reads unchanged v1 and derives v2 material without historical approval replay', async t => {
  const f=await fixture(t,{quality:true}),req=request(),historical=await f.service.create(req),artifact=randomUUID(),confirmation=randomUUID();
  f.db.prepare("INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path) VALUES(?,?,?,'copy',1,?,'synthetic/copy.json')").run(artifact,A,historical.id,'a'.repeat(64));
  f.db.prepare("INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,status) VALUES(?,?,?,'copy',?,'confirmed')").run(confirmation,A,historical.id,'b'.repeat(64));
  f.db.prepare("INSERT INTO approvals(id,brand_id,run_id,kind,object_fingerprint,decision,confirmation_request_id,evidence_json) VALUES(?,?,?,'copy',?,'approved',?,'{}')").run(randomUUID(),A,historical.id,'b'.repeat(64),confirmation);
  const before=f.db.prepare('SELECT snapshot_json,snapshot_hash FROM runs WHERE id=?').get(historical.id);
  // Synthetic migration state; the production activation/backup path is tested separately.
  const {qualityActivationMigration:m}=await import('../../src/infrastructure/sqlite/migrations.mjs');
  f.db.transaction(()=>{f.db.exec(m.sql);f.db.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)').run(m.version,m.name,m.checksum);f.db.pragma('user_version=2');}).immediate();
  const service=await trustedQualityService(f);
  assert.equal(service.get(A,historical.id).snapshotHash,historical.snapshotHash);
  await assert.rejects(service.create(req),{code:'RUN_DERIVATION_REQUIRED'});
  const child=await service.derive(request({parentRunId:historical.id,materialArtifactIds:[artifact]}));
  assert.equal(child.snapshot.contractVersion,2);
  assert.equal(child.parentRunId,historical.id);
  assert.deepEqual(child.approvals,[]);
  assert.deepEqual(child.snapshot.materialReferences,[{runId:historical.id,artifactId:artifact,kind:'copy',version:1,sha256:'a'.repeat(64)}]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_requests WHERE run_id=?').get(child.id).n,0);
  assert.deepEqual(f.db.prepare('SELECT snapshot_json,snapshot_hash FROM runs WHERE id=?').get(historical.id),before);
});

test('Q04 composed implementation identity has the exact allowlist, never a label or partial file map', async () => {
  const {qualitySnapshotFixture}=await import('../fixtures/quality/snapshot-fixture.mjs');
  const {buildRunSnapshot,validateRunSnapshot}=await import('../../src/domain/run-snapshot.mjs');
  const {input,snapshot}=await qualitySnapshotFixture();
  for (const edit of [files=>delete files['src/render/text-layout.mjs'],files=>files['src/any-unlisted-file.mjs']='a'.repeat(64)]) {
    const wrong=structuredClone(input);edit(wrong.runtime.renderer.files);assert.throws(()=>buildRunSnapshot(wrong));
    const stored=structuredClone(snapshot);edit(stored.renderer.files);edit(stored.runtime.renderer.files);assert.throws(()=>validateRunSnapshot(stored));
  }
});

test('Q04 font references are canonical only in v2 and expected hashes cannot be invented', async () => {
  const {qualitySnapshotFixture}=await import('../fixtures/quality/snapshot-fixture.mjs');
  const {buildRunSnapshot,validateRunSnapshot}=await import('../../src/domain/run-snapshot.mjs');
  const {input,snapshot}=await qualitySnapshotFixture();
  assert.deepEqual(snapshot.fonts.map(font=>font.id),['Anton','JetBrains Mono','Manrope']);
  const wrong=structuredClone(snapshot);wrong.fonts.find(font=>font.id==='JetBrains Mono').sha256='f'.repeat(64);
  assert.throws(()=>validateRunSnapshot(wrong));
  const shuffled=structuredClone(input);shuffled.fonts.reverse();
  assert.deepEqual(buildRunSnapshot(shuffled).fonts,snapshot.fonts);
});

test('Q04 default v1 builder keeps the captured pre-Q04 canonical bytes and historical shape', async () => {
  const {qualitySnapshotFixture}=await import('../fixtures/quality/snapshot-fixture.mjs');
  const {buildRunSnapshot,getRunContract,validateRunSnapshot}=await import('../../src/domain/run-snapshot.mjs');
  const {input}=await qualitySnapshotFixture({theme:'light'});
  delete input.contractVersion;
  input.runtime={package:{name:'fixture',version:'1.0.0'},node:'v24.19.0',platform:'linux',arch:'x64',abi:'137',napi:'10',
    renderer:{id:'legacy-panorama@1',files:{'scripts/render-carousel.mjs':'a'.repeat(64)}},
    dependencies:Object.fromEntries(['better-sqlite3','sharp','fontkit','archiver'].map(id=>[id,{version:'synthetic'}])),
    fonts:input.fonts.map(({id,sha256})=>({id,sha256}))};
  const snapshot=buildRunSnapshot(input);
  assert.equal(canonicalHash(snapshot),'514848a898190f532ba78910dcf22fdae310eb0c05881baf524e347d4397aea6');
  assert.deepEqual(snapshot.fonts.map(font=>font.id),['Anton','Manrope','JetBrains Mono']);
  assert.deepEqual(getRunContract(snapshot),{schemaVersion:1,contractVersion:1,canonicalVersion:1,pipelineVersion:1,qualityPolicyVersion:null});
  assert.deepEqual(validateRunSnapshot(snapshot),snapshot);
  assert.equal(Object.hasOwn(snapshot,'pipelineVersion'),false);
});

test('Q04 declared optional accent stays a reference and does not block qualified no-accent bindings', async t => {
  const f=await fixture(t,{schemaVersion:2,quality:true});
  const next={...config(),configVersion:2,fonts:{...config().fonts,accent:'nimbus-roman-italic@1'}};
  await persist(f.memory,A,next,1);
  const service=await trustedQualityService(f);
  const run=await service.create(request({brandRevision:2}));
  assert.equal(run.snapshot.brand.config.fonts.accent,'nimbus-roman-italic@1');
  assert.ok(run.snapshot.fonts.some(font=>font.id==='nimbus-roman-italic@1'));
  assert.ok(run.snapshot.fontBindings.every(binding=>binding.role!=='accent'));
  assert.ok(run.snapshot.resourceState.blockers.every(blocker=>blocker.resource!=='nimbus-roman-italic@1'));
  assert.ok(run.snapshot.runtime.fonts.every(font=>font.id!=='nimbus-roman-italic@1'));
});

test('Q04 service readers reject a stored snapshot hash mismatch without rewriting history', async t => {
  const f=await fixture(t),source=await f.service.create(request()),id=randomUUID();
  const {canonicalJson}=await import('../../src/domain/canonical-json.mjs');
  f.db.prepare('INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES(?,?,1,?,?)').run(id,A,canonicalJson(source.snapshot),'f'.repeat(64));
  assert.throws(()=>f.service.get(A,id),{code:'SNAPSHOT_HASH_MISMATCH'});
  assert.equal(f.db.prepare('SELECT snapshot_hash FROM runs WHERE id=?').get(id).snapshot_hash,'f'.repeat(64));
});
