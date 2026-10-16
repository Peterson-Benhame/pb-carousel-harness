import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import { createBrandMemory } from '../../src/application/brand-memory.mjs';
import { confirmBrandProposal } from '../../src/interfaces/cli/human-confirmation.mjs';
import { runDoctor } from '../../src/application/doctor.mjs';
import { inspectWorkspace } from '../../src/application/workspace-inspect.mjs';
import { loadResourcesManifest, resolveResources } from '../../src/infrastructure/resources.mjs';
const packageRoot=fileURLToPath(new URL('../../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const codes=r=>r.diagnostics.map(d=>d.code);
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'carousel-t10 recursos '));const connections=[];t.after(async()=>{for(const db of connections.reverse())if(db.open)db.close();await rm(root,{recursive:true,force:true});});const dataDir=path.join(root,'workspace'),fontRoot=path.join(root,'authorized fonts');await mkdir(fontRoot);const manifest=await loadResourcesManifest();for(const font of manifest.fonts){const bytes=Buffer.from(`SYNTHETIC, NOT A FONT: ${font.id}`);font.sha256=hash(bytes);await writeFile(path.join(fontRoot,font.file),bytes);}return {root,dataDir,fontRoot,manifest,connections};}
async function openFixture(f){const db=await initializeWorkspace(f.dataDir);f.connections.push(db);return db;}
async function tree(root){const out={};async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else out[path.relative(root,file)]=hash(await readFile(file));}}await walk(root);return out;}
test('baseline manifest preserves exactly three existing font IDs and approved byte hashes',async()=>{
 const m=await loadResourcesManifest();assert.deepEqual(m.fonts.map(({id,sha256})=>[id,sha256]),[['Anton','a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab'],['Manrope','d0639be45d0af36e798172419d7bd173c4bd4f29e2b76cbb69db1d11bf8b0a40'],['JetBrains Mono','48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda']]);
});
test('explicit authorized root resolves synthetic bytes by hash, without copies or mutations',async t=>{const f=await fixture(t),before=await tree(f.root);const r=await resolveResources(f);assert.deepEqual(r.diagnostics,[]);assert.equal(r.fonts.length,3);for(const font of r.fonts){assert.equal(font.status,'available');assert.equal(path.dirname(font.path),f.fontRoot);}assert.deepEqual(await tree(f.root),before);});
test('no configured font root never falls back to repository fonts',async t=>{const f=await fixture(t);const r=await resolveResources({manifest:f.manifest});assert.equal(r.fonts.length,3);assert.equal(r.diagnostics.length,3);assert.ok(codes(r).every(c=>c==='RESOURCE_MISSING'));});
test('missing font and divergent bytes are distinct, with no fallback',async t=>{const f=await fixture(t);await rm(path.join(f.fontRoot,f.manifest.fonts[0].file));await writeFile(path.join(f.fontRoot,f.manifest.fonts[1].file),'changed');const r=await resolveResources(f);assert.deepEqual(codes(r),['RESOURCE_MISSING','RUNTIME_MISMATCH']);assert.equal(r.diagnostics[0].resource,'Anton');assert.equal(r.diagnostics[1].resource,'Manrope');assert.equal(r.fonts[1].path,undefined);});
test('unsafe manifest paths and malformed hashes are rejected before resource reads',async t=>{const f=await fixture(t);for(const file of ['../outside.ttf','/absolute.ttf','a\\..\\escape.ttf']){const manifest=structuredClone(f.manifest);manifest.fonts[0].file=file;await assert.rejects(resolveResources({...f,manifest}),{code:'PACKAGE_INCOMPLETE'});}const manifest=structuredClone(f.manifest);manifest.fonts[0].sha256='bad';await assert.rejects(resolveResources({...f,manifest}),{code:'PACKAGE_INCOMPLETE'});});
test('workspace absent remains absent and reports explicit initialization requirement',async t=>{const f=await fixture(t),before=await tree(f.root);const r=await inspectWorkspace({dataDir:f.dataDir});assert.equal(r.available,false);assert.ok(codes(r).includes('WORKSPACE_NOT_INITIALIZED'));assert.deepEqual(await tree(f.root),before);});
test('real SQLite inspection is read-only and loads authorized font directory from settings',async t=>{const f=await fixture(t);const db=await openFixture(f);db.prepare('INSERT INTO workspace_settings(singleton,revision,resources_json,authorized_font_directory) VALUES(1,1,?,?)').run('{}',f.fontRoot);db.close();const before=await tree(f.root);const r=await inspectWorkspace({dataDir:f.dataDir});assert.equal(r.available,true);assert.equal(r.settings.authorizedFontDirectory,f.fontRoot);assert.equal(r.schemaVersion,1);assert.deepEqual(await tree(f.root),before);});
test('future schema is refused without mutations',async t=>{const f=await fixture(t);const db=await openFixture(f);db.pragma('user_version=3');db.close();const before=await tree(f.root),r=await inspectWorkspace({dataDir:f.dataDir});assert.equal(r.available,false);assert.ok(codes(r).includes('SCHEMA_TOO_NEW'));assert.deepEqual(await tree(f.root),before);});
test('doctor reports real effective native identity and independent plugin/font blockers without mutations',async t=>{const f=await fixture(t);(await openFixture(f)).close();const before=await tree(f.root);const r=await runDoctor({...f,fontRoot:undefined});assert.equal(r.runtime.node,process.version);assert.equal(r.runtime.platform,process.platform);assert.equal(r.runtime.dependencies['better-sqlite3'].version,'13.0.3');assert.match(r.runtime.dependencies['better-sqlite3'].sqlite,/^3\./);assert.equal(r.runtime.dependencies.sharp.version,'0.34.5');assert.ok(r.runtime.dependencies.sharp.vips);assert.equal(r.readiness.query,true);assert.equal(r.readiness.renderPrerequisites,false);assert.ok(codes(r).includes('PLUGIN_UNCONFIGURED'));assert.ok(codes(r).includes('RESOURCE_MISSING'));assert.equal(codes(r).includes('RUNTIME_INCOMPATIBLE'),process.platform!=='win32'||process.arch!=='x64'||process.version!=='v24.21.0');assert.deepEqual(await tree(f.root),before);});
test('font absence does not prevent real confirmed registration or queries',async t=>{const f=await fixture(t),db=await openFixture(f);const memory=createBrandMemory(db);const config={name:'Synthetic',profile:'@synthetic',language:'pt-BR',audience:null,voice:null,preferences:[],fonts:{title:'Anton',body:'Manrope',mono:'JetBrains Mono'},themes:{light:{background:'#ffffff',text:'#000000',muted:'#555555',accent:'#ff0000',topics:[]}},logo:{enabled:false,variants:{},protection:12,minimumHeight:24},slideWidth:1080,slideHeight:1350,minimumSlideCount:12,maximumSlideCount:16,profileImage:''};const p=memory.propose('brand.create',{requestId:'t10-create',brandId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',config});const receipt=await confirmBrandProposal(p,{input:{isTTY:true},output:{isTTY:true,write(){}},argv:[],ask:async()=> 'CONFIRMAR'});memory.commit(p,receipt);const r=await runDoctor({dataDir:f.dataDir});assert.equal(memory.list().length,1);assert.equal(r.readiness.query,true);assert.equal(r.readiness.renderPrerequisites,false);});
test('missing renderer dependency is diagnosed without blocking SQLite query (explicit probe fault)',async t=>{const f=await fixture(t);(await openFixture(f)).close();const {probeDependency}=await import('../../src/infrastructure/resources.mjs');const r=await runDoctor({...f,dependencyProbe:async(name,options)=>{if(name==='sharp')throw Error('SECRET native loader path');return probeDependency(name,options);}});assert.equal(r.readiness.query,true);assert.equal(r.readiness.renderPrerequisites,false);assert.ok(r.diagnostics.some(d=>d.code==='DEPENDENCY_UNAVAILABLE'&&d.resource==='sharp'));assert.ok(!JSON.stringify(r).includes('SECRET'));});
test('missing SQLite dependency explicitly blocks memory (probe fault, not real native absence)',async t=>{const f=await fixture(t);(await openFixture(f)).close();const {probeDependency}=await import('../../src/infrastructure/resources.mjs');const r=await runDoctor({...f,dependencyProbe:async(name,options)=>{if(name==='better-sqlite3')throw Error('injected');return probeDependency(name,options);}});assert.equal(r.readiness.query,false);assert.ok(r.diagnostics.some(d=>d.code==='DEPENDENCY_UNAVAILABLE'&&d.resource==='better-sqlite3'));});
test('missing package/manifest returns incomplete package rather than throwing or repairing',async t=>{const f=await fixture(t);const r=await runDoctor({dataDir:f.dataDir,packageRoot:f.root});assert.ok(codes(r).includes('PACKAGE_INCOMPLETE'));assert.equal(r.readiness.renderPrerequisites,false);assert.deepEqual(await readdir(f.root),['authorized fonts']);});
test('expected runtime mismatch blocks render independently of resource availability',async t=>{const f=await fixture(t);(await openFixture(f)).close();const first=await runDoctor(f);const expectedRuntime=structuredClone(first.runtime);expectedRuntime.dependencies.sharp.vips='different';const r=await runDoctor({...f,expectedRuntime});assert.ok(r.diagnostics.some(d=>d.code==='RUNTIME_MISMATCH'&&d.resource==='runtime'));assert.equal(r.readiness.query,true);assert.equal(r.readiness.renderPrerequisites,false);});
test('help and doctor module imports never eagerly load native packages',async t=>{const f=await fixture(t),loader=path.join(f.root,'reject-native.mjs');await writeFile(loader,`export async function resolve(specifier,context,next){if(/better-sqlite3|sharp|fontkit|archiver/.test(specifier))throw Error('native forbidden');return next(specifier,context);}`);const script=`await import(${JSON.stringify(new URL('../../src/application/doctor.mjs',import.meta.url).href)});await import(${JSON.stringify(new URL('../../src/interfaces/cli/main.mjs',import.meta.url).href)});`;const result=spawnSync(process.execPath,['--no-warnings','--experimental-loader',pathToFileURL(loader).href,'--input-type=module','-e',script],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const help=spawnSync(process.execPath,['--no-warnings','--experimental-loader',pathToFileURL(loader).href,path.join(packageRoot,'bin/peterson-carousel.mjs'),'--help'],{encoding:'utf8'});assert.equal(help.status,0,help.stderr);});
test('synthetic current-platform matrix demonstrates readiness without claiming real font qualification',async t=>{const f=await fixture(t);(await openFixture(f)).close();Object.assign(f.manifest.qualifiedRuntime,{node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules});const r=await runDoctor(f);assert.equal(r.readiness.renderPrerequisites,true);assert.deepEqual(r.renderBlockers,[]);assert.equal(r.readiness.plugin,false);assert.ok(codes(r).includes('PLUGIN_UNCONFIGURED'));});
test('explicitly incompatible platform matrix blocks render while queries remain available',async t=>{const f=await fixture(t);(await openFixture(f)).close();f.manifest.qualifiedRuntime.platform='intentionally-incompatible';const r=await runDoctor(f);assert.ok(codes(r).includes('RUNTIME_INCOMPATIBLE'));assert.equal(r.readiness.renderPrerequisites,false);assert.equal(r.readiness.query,true);});
test('runtime identity excludes font and workspace locations',async t=>{const a=await fixture(t),b=await fixture(t);(await openFixture(a)).close();(await openFixture(b)).close();const first=await runDoctor(a),second=await runDoctor(b);assert.deepEqual(first.runtime,second.runtime);assert.ok(!JSON.stringify(first.runtime).includes(a.root));});
test('doctor reads configured font root without requiring an override',async t=>{const f=await fixture(t),db=await openFixture(f);db.prepare('INSERT INTO workspace_settings(singleton,revision,resources_json,authorized_font_directory) VALUES(1,1,?,?)').run('{}',f.fontRoot);db.close();const r=await runDoctor({dataDir:f.dataDir,manifest:f.manifest});assert.ok(!codes(r).includes('RESOURCE_MISSING'));assert.equal(r.resources.fonts.every(f=>f.status==='available'),true);});
test('required-file absence is PACKAGE_INCOMPLETE even when package manifest remains present',async t=>{const f=await fixture(t),copy=path.join(f.root,'package');for(const file of f.manifest.requiredFiles){const target=path.join(copy,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,await readFile(path.join(packageRoot,file)));}await rm(path.join(copy,'shared/carousel.schema.json'));const {inspectPackage}=await import('../../src/infrastructure/resources.mjs');const r=await inspectPackage({packageRoot:copy,manifest:f.manifest});assert.ok(r.diagnostics.some(d=>d.code==='PACKAGE_INCOMPLETE'&&d.resource==='shared/carousel.schema.json'));});
test('all missing native imports are recoverable in an actual child process',async t=>{const f=await fixture(t),loader=path.join(f.root,'reject-all.mjs');await writeFile(loader,`export async function resolve(specifier,context,next){if(/better-sqlite3|sharp|fontkit|archiver/.test(specifier))throw Error('SECRET loader error');return next(specifier,context);}`);const script=`const {runDoctor}=await import(${JSON.stringify(new URL('../../src/application/doctor.mjs',import.meta.url).href)});console.log(JSON.stringify(await runDoctor({dataDir:${JSON.stringify(f.dataDir)}})));`;const result=spawnSync(process.execPath,['--no-warnings','--experimental-loader',pathToFileURL(loader).href,'--input-type=module','-e',script],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const r=JSON.parse(result.stdout);assert.equal(r.diagnostics.filter(d=>d.code==='DEPENDENCY_UNAVAILABLE').length,4);assert.equal(r.readiness.query,false);assert.equal(r.readiness.renderPrerequisites,false);assert.ok(!result.stdout.includes('SECRET'));});
test('qualified native engine mismatch is blocked even when npm package versions match',async t=>{const f=await fixture(t);(await openFixture(f)).close();Object.assign(f.manifest.qualifiedRuntime,{node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules,native:{sqlite:'unqualified',vips:'unqualified'}});const r=await runDoctor(f);assert.ok(codes(r).includes('RUNTIME_INCOMPATIBLE'));assert.equal(r.readiness.renderPrerequisites,false);});
test('missing SQLite still reports the purely resolved workspace root without creating it',async t=>{const f=await fixture(t);const r=await runDoctor({...f,dependencyProbe:async()=>{throw Error('injected dependency failure');}});assert.equal(r.workspace.root,f.dataDir);assert.equal(r.readiness.register,false);assert.deepEqual(await readdir(f.root),['authorized fonts']);});
test('unsupported runtime permits inspection but does not advertise registration readiness',async t=>{const f=await fixture(t);(await openFixture(f)).close();f.manifest.qualifiedRuntime.node='v0.0.0';const r=await runDoctor(f);assert.equal(r.readiness.query,true);assert.equal(r.readiness.register,false);});
test('manifest includes executable and transitive renderer validator, with validator identity hash',async()=>{const manifest=await loadResourcesManifest();assert.ok(manifest.requiredFiles.includes('bin/peterson-carousel.mjs'));assert.ok(manifest.requiredFiles.includes('scripts/validate-carousel.mjs'));assert.ok(manifest.renderer.files.includes('scripts/validate-carousel.mjs'));const {inspectPackage}=await import('../../src/infrastructure/resources.mjs');const r=await inspectPackage({manifest});assert.equal(r.renderer.files['scripts/validate-carousel.mjs'],hash(await readFile(path.join(packageRoot,'scripts/validate-carousel.mjs'))));});

// Q02: declarative resource identities, not permission to run a candidate renderer.
const composedId='editorial-composed@1',nimbusId='nimbus-roman-italic@1';
const implementedComposedPaths=['src/render/composed-carousel.mjs','src/render/text-layout.mjs','src/render/composition-geometry.mjs','src/quality/objective-checks.mjs','src/quality/review-rubric.mjs'];
function legacyManifest(manifest){const {renderers,optionalFonts,...legacy}=structuredClone(manifest);legacy.schemaVersion=1;return legacy;}
async function copyPackage(f){const root=path.join(f.root,'package');for(const file of new Set([...f.manifest.requiredFiles,...f.manifest.renderers[1].files])){const target=path.join(root,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,await readFile(path.join(packageRoot,file)));}return root;}
test('manifest v2 names the current legacy identity and actual composed candidate',async()=>{
 const manifest=await loadResourcesManifest();assert.equal(manifest.schemaVersion,2);
 const legacy=manifest.renderers.find(r=>r.id==='legacy-panorama@1'),composed=manifest.renderers.find(r=>r.id===composedId);
 assert.deepEqual(legacy.files.slice(0,3),manifest.renderer.files);assert.ok(legacy.files.includes('src/adapters/legacy/render-context.mjs'));assert.equal(legacy.status,'active');assert.equal(composed.status,'candidate');
 for(const file of implementedComposedPaths){assert.ok(composed.files.includes(file));assert.equal(Object.hasOwn(composed.hashes,file),true);}
 for(const file of composed.files)assert.equal(composed.hashes[file],hash(await readFile(path.join(packageRoot,file))));
 assert.deepEqual(manifest.optionalFonts.map(f=>f.id),[nimbusId]);
});
test('historical v1 manifests preserve their original identity shape without borrowing current dependencies',async t=>{
 const f=await fixture(t);(await openFixture(f)).close();
 const current=await runDoctor(f),historical=await runDoctor({...f,manifest:legacyManifest(f.manifest)});
 const historicalFiles=historical.runtime.renderer.files;assert.deepEqual(Object.keys(historicalFiles),f.manifest.renderer.files);
 for(const [file,sha] of Object.entries(historicalFiles))assert.equal(current.runtime.renderer.files[file],sha);
 assert.equal(current.runtime.renderer.id,'legacy-panorama@1');assert.equal(historical.runtime.renderer.id,'legacy-panorama@1');
 assert.ok(Object.hasOwn(current.runtime.renderer.files,'src/adapters/legacy/render-context.mjs'));
 assert.deepEqual({...current.runtime,renderer:null},{...historical.runtime,renderer:null});
});
test('an optional unused Nimbus is neither searched nor a baseline render blocker',async t=>{
 const f=await fixture(t);const resolved=await resolveResources({...f,requiredFontIds:['Anton']});
 assert.deepEqual(resolved.fonts.map(font=>font.id),['Anton']);assert.deepEqual(resolved.diagnostics,[]);
 assert.equal(Object.hasOwn(resolved.fonts[0],'expectedSha256'),true);
});
test('Nimbus use remains blocked while missing authorized resources are diagnosed independently',async t=>{
 const f=await fixture(t),before=await tree(f.root);
 const resolved=await resolveResources({...f,requiredFontIds:[nimbusId]});
 assert.deepEqual(codes(resolved),['FONT_USE_UNAUTHORIZED','FONT_LICENSE_UNVERIFIED','RESOURCE_MISSING']);
 assert.equal(resolved.fonts[0].status,'missing');assert.equal(resolved.fonts[0].useStatus,'unauthorized');assert.equal(resolved.fonts[0].path,undefined);assert.equal(resolved.fonts[0].sha256,undefined);
 assert.deepEqual(await tree(f.root),before);
 const altered=structuredClone(f.manifest);altered.optionalFonts[0].authorization='granted';await assert.rejects(resolveResources({...f,manifest:altered,requiredFontIds:[nimbusId]}),{code:'PACKAGE_INCOMPLETE'});
});
test('resource subsets reject unknown and duplicate font IDs without interpreting them as paths',async t=>{
 const f=await fixture(t);for(const requiredFontIds of [['/tmp/a.ttf'],['Times New Roman'],['Anton','Anton'],'Anton',null])await assert.rejects(resolveResources({...f,requiredFontIds}),{code:'INVALID_ARGUMENT'});
 const resolved=await resolveResources({...f,requiredFontIds:[]});assert.deepEqual(resolved,{fonts:[],diagnostics:[]});
});
test('composed candidate stays unqualified without borrowing legacy identity',async t=>{
 const f=await fixture(t);(await openFixture(f)).close();const r=await runDoctor({...f,rendererId:composedId});
 assert.equal(r.runtime.renderer.id,composedId);assert.equal(r.readiness.renderPrerequisites,false);
 assert.ok(codes(r).includes('LAYOUT_NOT_QUALIFIED'));
 assert.ok(!r.diagnostics.some(d=>d.code==='PACKAGE_INCOMPLETE'));
 assert.equal(Object.hasOwn(r.runtime.renderer.files,'scripts/render-carousel.mjs'),false);
});
test('changing or removing a composed contract, schema, or layout yields mismatch or incomplete',async t=>{
 const f=await fixture(t),copy=await copyPackage(f);const {inspectPackage}=await import('../../src/infrastructure/resources.mjs');
 for(const file of ['src/domain/brand-schema.mjs','shared/composition-plan.schema.json','shared/layouts/editorial-composed-v1.json']){
  const target=path.join(copy,file),original=await readFile(target);await writeFile(target,Buffer.concat([original,Buffer.from('\n')]));
  const changed=await inspectPackage({packageRoot:copy,manifest:f.manifest,rendererId:composedId});assert.ok(changed.diagnostics.some(d=>d.code==='RUNTIME_MISMATCH'&&d.resource===file));
  await rm(target);const missing=await inspectPackage({packageRoot:copy,manifest:f.manifest,rendererId:composedId});assert.ok(missing.diagnostics.some(d=>d.code==='PACKAGE_INCOMPLETE'&&d.resource===file));await writeFile(target,original);
 }
});
test('strict manifest parsing rejects unlisted paths, omitted Q02 hashes and executable input without evaluating it',async t=>{
 const f=await fixture(t);
 for(const mutate of [m=>{m.script='run()';},m=>{m.renderer.files.push('src/domain/unapproved.mjs');},m=>{m.requiredFiles.push('src/domain/unapproved.mjs');},m=>{m.renderers[1].files.push('src/domain/unapproved.mjs');},m=>{delete m.renderers[1].hashes['src/domain/brand-schema.mjs'];},m=>{m.renderers[1].hashes['unapproved.mjs']='a'.repeat(64);}]){
  const manifest=structuredClone(f.manifest);mutate(manifest);await assert.rejects(resolveResources({...f,manifest}),{code:'PACKAGE_INCOMPLETE'});
 }
 let invoked=false;const manifest=structuredClone(f.manifest);Object.defineProperty(manifest,'schemaVersion',{enumerable:true,get(){invoked=true;return 2;}});
 await assert.rejects(resolveResources({...f,manifest}),{code:'PACKAGE_INCOMPLETE'});assert.equal(invoked,false);
});
test('font subset rejects accessor data before invoking it or reading resources',async t=>{
 const f=await fixture(t);let invoked=false;const requiredFontIds=['Anton'];
 Object.defineProperty(requiredFontIds,'0',{enumerable:true,get(){invoked=true;return 'Anton';}});
 await assert.rejects(resolveResources({...f,requiredFontIds}),{code:'INVALID_ARGUMENT'});assert.equal(invoked,false);
});
test('missing candidate-only resources leave the legacy renderer readable and unchanged',async t=>{
 const f=await fixture(t),copy=await copyPackage(f);const {inspectPackage}=await import('../../src/infrastructure/resources.mjs');
 const before=await inspectPackage({packageRoot:copy,manifest:f.manifest});
 await rm(path.join(copy,'shared/layouts/editorial-composed-v1.json'));
 const legacy=await inspectPackage({packageRoot:copy,manifest:f.manifest});
 assert.deepEqual(legacy.renderer,before.renderer);assert.deepEqual(legacy.diagnostics,[]);
 const composed=await inspectPackage({packageRoot:copy,manifest:f.manifest,rendererId:composedId});
 assert.ok(composed.diagnostics.some(d=>d.code==='PACKAGE_INCOMPLETE'&&d.resource==='shared/layouts/editorial-composed-v1.json'));
});
test('actual compositor and Q06 modules require exact hashes without granting qualification',async t=>{
 const f=await fixture(t),copy=await copyPackage(f);const {inspectPackage}=await import('../../src/infrastructure/resources.mjs');
 const candidate=await inspectPackage({packageRoot:copy,manifest:f.manifest,rendererId:composedId});assert.deepEqual(codes(candidate),['LAYOUT_NOT_QUALIFIED']);
 assert.ok(['src/quality/objective-checks.mjs','src/quality/review-rubric.mjs'].every(file=>f.manifest.renderers[1].files.includes(file)));
 for(const file of implementedComposedPaths){const target=path.join(copy,file),original=await readFile(target);await writeFile(target,Buffer.concat([original,Buffer.from('\n')]));
 const changed=await inspectPackage({packageRoot:copy,manifest:f.manifest,rendererId:composedId});assert.ok(changed.diagnostics.some(d=>d.code==='RUNTIME_MISMATCH'&&d.resource===file));
 await rm(target);const missing=await inspectPackage({packageRoot:copy,manifest:f.manifest,rendererId:composedId});assert.ok(missing.diagnostics.some(d=>d.code==='PACKAGE_INCOMPLETE'&&d.resource===file));await writeFile(target,original);}
});
test('legacy doctor cannot advertise readiness by overriding its mandatory font requirements',async t=>{
 const f=await fixture(t);(await openFixture(f)).close();
 Object.assign(f.manifest.qualifiedRuntime,{node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules});
 for(const font of f.manifest.fonts.slice(1))await rm(path.join(f.fontRoot,font.file));
 for(const requiredFontIds of [[],['Anton']]){
  const report=await runDoctor({...f,requiredFontIds});assert.equal(report.readiness.renderPrerequisites,false);
  assert.deepEqual(report.resources.fonts.map(font=>font.id),['Anton','Manrope','JetBrains Mono']);
  for(const id of ['Manrope','JetBrains Mono'])assert.ok(report.diagnostics.some(d=>d.code==='RESOURCE_MISSING'&&d.resource===id));
 }
});

test('Nimbus diagnostic hashing never grants use or exposes a usable font path',async t=>{
 const f=await fixture(t),font=f.manifest.optionalFonts[0],bytes=Buffer.from('SYNTHETIC, NOT A FONT: NIMBUS');
 font.sha256=hash(bytes);await writeFile(path.join(f.fontRoot,font.file),bytes);
 const available=await resolveResources({...f,requiredFontIds:[nimbusId]});
 assert.deepEqual(codes(available),['FONT_USE_UNAUTHORIZED','FONT_LICENSE_UNVERIFIED']);
 assert.equal(available.fonts[0].availability,'available');assert.equal(available.fonts[0].status,'blocked');
 assert.equal(available.fonts[0].sha256,font.sha256);assert.equal(available.fonts[0].path,undefined);
 await writeFile(path.join(f.fontRoot,font.file),'CHANGED SYNTHETIC BYTES');
 const mismatch=await resolveResources({...f,requiredFontIds:[nimbusId]});
 assert.deepEqual(codes(mismatch),['FONT_USE_UNAUTHORIZED','FONT_LICENSE_UNVERIFIED','RUNTIME_MISMATCH']);
 assert.equal(mismatch.fonts[0].status,'mismatch');assert.equal(mismatch.fonts[0].path,undefined);
 const unconfigured=await resolveResources({manifest:f.manifest,requiredFontIds:[nimbusId]});
 assert.ok(codes(unconfigured).includes('RESOURCE_MISSING'));assert.equal(unconfigured.fonts[0].sha256,undefined);
});
