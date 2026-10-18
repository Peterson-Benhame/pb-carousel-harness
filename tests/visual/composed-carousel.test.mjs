import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { sha256 } from '../../src/infrastructure/resources.mjs';
import { composedFixture, sealComposedFixture } from '../helpers/composed-render-fixture.mjs';
const module = await import('../../src/render/composed-carousel.mjs').catch(() => ({}));
const compose = args => { assert.equal(typeof module.composeCarousel, 'function', 'Q03 composeCarousel implementation is required'); return module.composeCarousel(args); };
for (const identity of ['amber', 'blue']) test(`composes five candidate variants with exact copy, real glyphs, identity, logo and footer: ${identity}`, async () => {
  const f = await composedFixture({ identity }), before = canonicalHash({ carousel: f.carousel, plan: f.plan, snapshot: f.snapshot, qualifications: f.qualifications });
  const result = await compose(f);
  assert.equal(result.rendererId, 'editorial-composed@1');
  assert.deepEqual(result.selection.slideIndices, [1, 2, 3, 4, 5]);
  assert.deepEqual(result.activity.composedIndices, [1, 2, 3, 4, 5]); assert.deepEqual(result.activity.rasterizedIndices, [1, 2, 3, 4, 5]);
  for (const slide of result.slides) {
    assert.equal(slide.worldX, (slide.index - 1) * 1080);
    assert.deepEqual(await sharp(slide.png).metadata().then(({width,height}) => ({width,height})), {width:1080,height:1350});
    assert.equal(slide.sha256, sha256(slide.png)); assert.equal(slide.rgbaSha256, sha256(await sharp(slide.png).ensureAlpha().raw().toBuffer()));
    for (const field of ['eyebrow','title','body']) assert.equal(slide.scene.elements.filter(e => e.kind === 'text' && e.source?.field === field).map(e => e.sourceText).join(''), f.carousel.slides[slide.index - 1][field]);
    assert.ok(slide.metrics.density > 0 && slide.metrics.density <= 1);
    assert.ok(slide.scene.elements.find(e => e.id === 'logo')); assert.equal(slide.scene.elements.find(e => e.id === 'signature').sourceText, f.snapshot.brand.config.profile);
    assert.ok(slide.metrics.fonts.every(font => f.snapshot.fonts.some(expected => expected.id === font.id && expected.sha256 === font.sha256)));
    assert.ok(slide.svg.includes('<path')); assert.ok(!slide.svg.includes('<text'));
  }
  assert.equal(canonicalHash({ carousel:f.carousel,plan:f.plan,snapshot:f.snapshot,qualifications:f.qualifications }), before);
  assert.ok(f.qualifications.every(q => q.status === 'candidate' && q.release === null)); assert.equal(Object.hasOwn(result,'approved'),false); assert.equal(Object.hasOwn(result,'qualificationStatus'),false);
});
test('empty profile has no synthetic signature; logo off has no placeholder', async () => {
  const f = await composedFixture({logo:false}); f.snapshot.brand.config.profile = ''; sealComposedFixture(f);
  const result = await compose({...f,selection:[1]});
  assert.ok(!result.slides[0].scene.elements.some(e => ['logo','signature'].includes(e.id)));
});
test('resource/copy/snapshot changes are rejected without fallback or input mutation', async () => {
  for (const change of [f=>f.resources.fonts[0].bytes[0]^=1,f=>f.resources.assets[0].bytes[0]^=1,f=>f.resources.logos[0].bytes[0]^=1,f=>f.carousel.slides[0].title+='!',f=>f.snapshot.brand.id='dddddddd-dddd-4ddd-8ddd-dddddddddddd',f=>f.snapshot.renderer.files['src/render/composed-carousel.mjs']='0'.repeat(64)]) {
    const f = await composedFixture(); change(f); await assert.rejects(compose(f),error => ['RUNTIME_MISMATCH','ASSET_HASH_MISMATCH','SNAPSHOT_HASH_MISMATCH','COMPOSITION_INVALID'].includes(error.code));
  }
});
test('unbreakable overflow blocks instead of shrinking below the candidate minimum', async () => {
  const f = await composedFixture(), s=f.carousel.slides[0], b=f.plan.slides[0].blocks.find(b=>b.source.field==='title');
  s.title='W'.repeat(100); b.source.end=s.title.length; b.spans=[{start:0,end:s.title.length,styleId:'title'}]; sealComposedFixture(f);
  await assert.rejects(compose(f),{code:'COMPOSITION_LIMIT_EXCEEDED'});
});
test('unconfirmed surface cannot be created by implicit color inversion', async () => {
  const f=await composedFixture(); delete f.snapshot.brand.config.themes.synthetic.surfaceBindings.dark; f.snapshot.theme.values=f.snapshot.brand.config.themes.synthetic; sealComposedFixture(f);
  await assert.rejects(compose(f),error=>['COMPOSITION_INVALID','INVALID_ARGUMENT'].includes(error.code));
});
test('renderer context dispatch is explicit and never defaults editorial inputs to legacy', async()=>{
 const context=await import('../../src/adapters/legacy/render-context.mjs');assert.equal(typeof context.resolveRenderContext,'function');
 const f=await composedFixture();const {fontRoot}=await import('../helpers/legacy-render-fixture.mjs');
 const resources=await context.resolveRenderContext({snapshot:f.snapshot,fontRoot,qualifications:f.qualifications,assetData:f.resources.assets,logoData:f.resources.logos});
 assert.deepEqual(resources.fonts.map(f=>f.id).sort(),['Anton','Manrope']);
 await assert.rejects(context.resolveRenderContext({snapshot:{...f.snapshot,renderer:{id:'invented@1'}}}),{code:'RUN_CONTRACT_UNSUPPORTED'});
});
test('manifest hashes every actual compositor module without claiming qualification',async()=>{
 const {loadResourcesManifest,inspectPackage}=await import('../../src/infrastructure/resources.mjs');const manifest=await loadResourcesManifest(),entry=manifest.renderers.find(r=>r.id==='editorial-composed@1');
 for(const file of ['src/render/composed-carousel.mjs','src/render/text-layout.mjs','src/render/composition-geometry.mjs','src/adapters/legacy/logo-layout.mjs','src/adapters/legacy/render-context.mjs'])assert.match(entry.hashes[file]??'',/^[a-f0-9]{64}$/);
 assert.equal(entry.status,'candidate');const report=await inspectPackage({rendererId:entry.id});assert.deepEqual(report.diagnostics.map(d=>d.code),['LAYOUT_NOT_QUALIFIED']);
});
test('enabled logo requires complete frozen references and cannot be supplied only by ID',async()=>{
 for(const refs of [undefined,[],[null]]){const f=await composedFixture();if(refs===undefined)delete f.snapshot.logos;else f.snapshot.logos=refs;sealComposedFixture(f);await assert.rejects(compose(f),{code:'SNAPSHOT_HASH_MISMATCH'});}
});
test('runtime native engine and N-API identities cannot drift behind the same renderer hash',async()=>{
 for(const change of [f=>f.snapshot.runtime.napi='999',f=>f.snapshot.runtime.dependencies.sharp.vips='different',f=>f.snapshot.runtime.dependencies.fontkit.version='different']){const f=await composedFixture();change(f);sealComposedFixture(f);await assert.rejects(compose(f),{code:'RUNTIME_MISMATCH'});}
});
test('non-JSON getters, symbols, cycles and prototype payloads fail safely without executing content',async()=>{
 for(const kind of ['getter','symbol','cycle','prototype']){const f=await composedFixture();let called=false;
 if(kind==='getter')Object.defineProperty(f.resources,'extra',{enumerable:true,get(){called=true;return 1;}});
 if(kind==='symbol')f.resources[Symbol('hidden')]=()=>{called=true;};
 if(kind==='cycle')f.resources.self=f.resources;
 if(kind==='prototype')f.resources=JSON.parse('{"__proto__":{"fonts":[]}}');
 await assert.rejects(compose(f),error=>['INVALID_ARGUMENT','INVALID_JSON_VALUE'].includes(error.code));assert.equal(called,false);}
});
test('a stricter candidate occupancy limit is enforced, not silently widened to one',async()=>{
 const f=await composedFixture();f.qualifications[0].definition.limits.maxBlockOccupancy=0.01;sealComposedFixture(f);await assert.rejects(compose({...f,selection:[1]}),{code:'COMPOSITION_LIMIT_EXCEEDED'});
});
test('declared decoration over a text zone is suppressed without changing approved copy',async()=>{
 const f=await composedFixture(),q=f.qualifications.find(q=>q.definition.layoutId==='cover-editorial@1'),d=q.definition;
 d.regions.push({id:'title-fill',x:60,y:180,width:960,height:624,kind:'decoration',readingOrder:9});
 d.continuity.anchors.push({id:'fill-origin',regionId:'title-fill',x:0,y:0});d.decorationOptions.push({id:'show-fill',elementId:'title-fill',anchorId:'fill-origin',offsetX:0,offsetY:0,visible:true});
 d.limits.allowedOverlaps=[{backElementId:'title-fill',frontElementId:'title',purpose:'highlight-background'}];
 const s=f.plan.slides[0];s.decorationChoices=[{elementId:'title-fill',optionId:'show-fill'}];s.overlaps=[...d.limits.allowedOverlaps];sealComposedFixture(f);
 const result=await compose({...f,selection:[1]}),slide=result.slides[0];
 assert.equal(slide.scene.elements.some(element=>element.id==='title-fill'),false);
 assert.equal(slide.scene.elements.find(element=>element.id==='title').sourceText,f.carousel.slides[0].title);
});
test('stricter logo height or protection from the candidate is never ignored',async()=>{
 for(const change of [d=>d.limits.minLogoHeight=56,d=>d.limits.logoProtection=28]){const f=await composedFixture();change(f.qualifications[0].definition);sealComposedFixture(f);await assert.rejects(compose({...f,selection:[1]}),{code:'LOGO_LAYOUT_INVALID'});}
});
test('resource bytes and immutable metadata are owned before asynchronous composition',async()=>{
 const f=await composedFixture(),expected=await compose({...f,selection:[1]}),pending=compose({...f,selection:[1]});
 f.resources.fonts[0].bytes.fill(0);f.resources.logos[0].bytes.fill(0);f.resources.assets[0].bytes.fill(0);f.carousel.slides[0].title='MUTATED';f.plan.slides[0].surface='dark';
 const actual=await pending;assert.deepEqual(actual.slides[0].png,expected.slides[0].png);
});
test('explicit dispatcher detaches buffers before dynamic import and rejects accessor routing',async()=>{
 const {resolveRenderContext}=await import('../../src/adapters/legacy/render-context.mjs'),{fontRoot}=await import('../helpers/legacy-render-fixture.mjs');
 let called=false;const forged={};Object.defineProperty(forged,'snapshot',{enumerable:true,get(){called=true;return {};}});await assert.rejects(resolveRenderContext(forged),{code:'INVALID_ARGUMENT'});assert.equal(called,false);
 const f=await composedFixture(),hash=f.resources.logos[0].sha256,pending=resolveRenderContext({snapshot:f.snapshot,fontRoot,qualifications:f.qualifications,assetData:f.resources.assets,logoData:f.resources.logos});f.resources.logos[0].bytes.fill(0);f.qualifications[0].status='rejected';const actual=await pending;assert.equal(sha256(actual.logos[0].bytes),hash);assert.equal(actual.qualifications[0].status,'candidate');
});
test('required optional Nimbus absence is diagnosed without fallback or a skipped render',async()=>{
 const f=await composedFixture(),q=f.qualifications.find(q=>q.definition.layoutId==='cover-editorial@1'),d=q.definition;
 const binding={role:'accent',fontId:'nimbus-roman-italic@1',sha256:'b7c424e6cb79baddfcdcd9a9d87f9fc4fdd06f0e5160066e2b2e47bcd647c7b9',style:'italic',weight:400,axes:{}};
 const {canonicalJson}=await import('../../src/domain/canonical-json.mjs');d.fontBindings.push(binding);d.fontBindings.sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:1);
 d.styles.push({...d.styles.find(s=>s.id==='title'),id:'title-accent',fontRole:'accent'});d.styles.sort((a,b)=>a.id<b.id?-1:1);d.limits.textRegions.find(r=>r.regionId==='title').styleIds.push('title-accent');d.limits.textRegions.find(r=>r.regionId==='title').styleIds.sort();
 f.plan.slides[0].blocks.find(b=>b.id==='title').spans[1].styleId='title-accent';f.snapshot.brand.config.fonts.accent=binding.fontId;f.snapshot.fonts.push({id:binding.fontId,sha256:binding.sha256});sealComposedFixture(f);
 await assert.rejects(compose({...f,selection:[1]}),{code:'RESOURCE_MISSING'});
});
test('malformed compositor boundaries return domain diagnostics rather than native exceptions',async()=>{
 for(const change of [f=>f.snapshot=null,f=>f.resources=null,f=>f.plan=null,f=>f.carousel=null,f=>f.resources.fonts=[null],f=>f.resources.assets=[null],f=>f.resources.logos=[null],f=>f.snapshot.fonts=null,f=>f.snapshot.fonts=[null],f=>f.snapshot.qualifications={},f=>f.snapshot.fontBindings={}]){const f=await composedFixture();change(f);await assert.rejects(compose(f),e=>e.name==='PublicError'&&typeof e.code==='string');}
 const {resolveRenderContext}=await import('../../src/adapters/legacy/render-context.mjs');await assert.rejects(resolveRenderContext(null),e=>e.name==='PublicError');
 const f=await composedFixture();f.snapshot.fontBindings=null;await assert.rejects(module.resolveComposedRenderResources({snapshot:f.snapshot}),e=>e.name==='PublicError');
});
test('stricter occupancy participates in fitting when an authorized smaller size works',async()=>{
 const f=await composedFixture({logo:false}),s=f.carousel.slides[0],b=f.plan.slides[0].blocks.find(b=>b.id==='title');s.title='A\nB\nC\nD';b.source.end=s.title.length;b.spans=[{start:0,end:s.title.length,styleId:'title'}];f.qualifications[0].definition.limits.maxBlockOccupancy=0.75;sealComposedFixture(f);
 const result=await compose({...f,selection:[1]}),title=result.slides[0].scene.elements.find(e=>e.id==='title');assert.ok(title.fontSize>=72&&title.fontSize<176);assert.ok(title.occupancy<=0.75);assert.equal(title.sourceText,s.title);
});
test('stricter logo protection refits the original PNG when the visible minimum still fits',async()=>{
 const f=await composedFixture();f.qualifications[0].definition.limits.logoProtection=16;sealComposedFixture(f);const result=await compose({...f,selection:[1]});assert.ok(result.slides[0].scene.elements.find(e=>e.id==='logo').bounds.height>=24);
});
