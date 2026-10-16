import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash, canonicalJson } from '../../src/domain/canonical-json.mjs';
import { sha256 } from '../../src/infrastructure/resources.mjs';
import { metricsDocument, renderedQualityFixture } from '../helpers/quality-render-fixture.mjs';
const checker = await import('../../src/quality/objective-checks.mjs').catch(() => ({}));
const evaluate = input => { assert.equal(typeof checker.evaluateRenderedQuality, 'function', 'Q06 objective checker is required'); return checker.evaluateRenderedQuality(input); };
const clone = value => { if (Buffer.isBuffer(value)) return Buffer.from(value); if (Array.isArray(value)) return value.map(clone); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,clone(v)])); return value; };
let base;
async function input() { base ??= await renderedQualityFixture(); return clone(base.input); }
function metricEdit(input, edit) {
  edit(input.composition.slides[0].scene.elements, input);
  input.composition.slides[0].metrics.elements = clone(input.composition.slides[0].scene.elements);
  const bytes = Buffer.from(canonicalJson(metricsDocument(input.composition)));
  input.manifest.metricsRef.sha256 = sha256(bytes);
  input.files.find(f => f.id === input.manifest.metricsRef.id).bytes = bytes;
}
const has = (report, code, result) => report.checks.some(c => c.code === code && c.result === result);
test('known selected pixels with exact inputs pass objective checks without granting human approval', async () => {
  const value = await input(), before = canonicalHash(value.manifest), report = await evaluate(value);
  assert.equal(report.result, 'passed', JSON.stringify(report.checks.filter(c => c.result !== 'passed')));
  assert.equal(report.schemaVersion, 1); assert.equal(report.manifestRef.sha256, before);
  assert.equal(report.manifestRef.kind,`render-manifest:${value.manifest.kind}`);
  assert.equal(report.renderAttemptId, value.manifest.renderAttemptId);
  for (const code of ['copy-exact','text-bounds','collision','typography','contrast','asset-geometry','continuity-independent','file-integrity']) assert.ok(has(report, code, 'passed'), code);
  assert.equal(canonicalHash(value.manifest), before); assert.equal(Object.hasOwn(report, 'approved'), false);
  assert.ok(Object.isFrozen(report) && Object.isFrozen(report.checks));
});
for (const [label, code, edit] of [
  ['curve collides with title', 'collision', es => es.push({ id:'curve', kind:'decoration', bounds:{...es.find(e=>e.id==='title').bounds} })],
  ['glyph crosses safe area by one pixel', 'text-bounds', es => es.find(e=>e.id==='title').glyphs[0].inkBounds.x = 59],
  ['glyph clipped by block', 'text-bounds', es => es.find(e=>e.id==='title').bounds.width = 1],
  ['body overflow', 'typography', es => es.find(e=>e.id==='body').occupancy = 1.0000000000000002],
  ['body below minimum', 'typography', es => es.find(e=>e.id==='body').glyphs[0].fontSize = 33],
  ['font hash divergence', 'typography', es => es.find(e=>e.id==='title').glyphs[0].sha256 = '0'.repeat(64)],
  ['font weight divergence', 'typography', es => es.find(e=>e.id==='body').glyphs[0].weight = 451],
  ['font axes divergence', 'typography', es => es.find(e=>e.id==='body').glyphs[0].axes.wght = 451],
  ['logo below minimum', 'asset-geometry', es => es.find(e=>e.id==='logo').bounds.height = 23],
  ['logo deformation', 'asset-geometry', es => es.find(e=>e.id==='logo').bounds.width *= 2],
  ['missing logo', 'asset-geometry', es => es.splice(es.findIndex(e=>e.id==='logo'),1)],
  ['altered text', 'copy-exact', es => es.find(e=>e.id==='body').sourceText += '!'],
  ['missing text', 'copy-exact', es => es.splice(es.findIndex(e=>e.id==='body'),1)],
  ['essential continuity', 'continuity-independent', (_es,i) => i.composition.slides[0].scene.continuities.push({from:1,to:2,semanticRole:'essential'})],
]) test(`rejects ${label}`, async () => {
  const value=await input(); metricEdit(value, edit); const report=await evaluate(value);
  assert.equal(report.result,'failed'); assert.ok(has(report,code,'failed'),JSON.stringify(report.checks.filter(c=>c.result!=='passed')));
});
test('contrast below threshold fails and unknown transparency never passes',async()=>{
 for(const [color,result] of [['#F3F0E8','failed'],['#00000080','not-verified']]) {
  const value=await input(); value.composition.slides[0].scene.palette.text=color; metricEdit(value,()=>{});
  const report=await evaluate(value);assert.ok(has(report,'contrast',result));assert.notEqual(report.result,'passed');
 }
});
for(const [label,edit] of [
 ['PNG bytes',i=>i.files[0].bytes[20]^=1],
 ['pixel hash',i=>i.manifest.files[0].rgbaSha256='0'.repeat(64)],
 ['missing PNG',i=>i.files.splice(0,1)],
 ['extra PNG',i=>i.files.push({id:'unexpected',bytes:Buffer.from('extra')})],
 ['duplicate file identity',i=>i.files.push(clone(i.files[0]))],
 ['missing manifest slide',i=>i.manifest.files=[]],
 ['wrong selection',i=>i.manifest.selection.slideIndices=[2]],
 ['wrong plan identity',i=>i.manifest.planRef.sha256='0'.repeat(64)],
 ['wrong snapshot identity',i=>i.manifest.snapshotHash='0'.repeat(64)],
 ['wrong definition identity',i=>i.composition.slides[0].scene.definitionHash='0'.repeat(64)],
 ['unbound metrics',i=>i.manifest.metricsRef.sha256='0'.repeat(64)],
 ['mismatched metric element',i=>i.composition.slides[0].metrics.elements=[]],
]) test(`file-integrity detects ${label}`,async()=>{const value=await input();edit(value);const report=await evaluate(value);assert.ok(has(report,'file-integrity','failed'));assert.equal(report.result,'failed');});
test('missing source and missing glyph evidence are not-verified, never inferred passes',async()=>{
 const value=await input();delete value.composition.inputs;metricEdit(value,es=>delete es.find(e=>e.id==='title').glyphs);
 const report=await evaluate(value);assert.ok(has(report,'copy-exact','not-verified'));assert.ok(has(report,'text-bounds','not-verified'));assert.notEqual(report.result,'passed');
});
test('diagram missing, enlarged or below semantic measure fails; raster semantics remain unverified',async()=>{
 const fixture=await renderedQualityFixture({selection:[4]});
 let report=await evaluate(fixture.input);assert.notEqual(report.result,'passed');assert.ok(has(report,'contrast','not-verified'));
 for(const edit of [es=>es.splice(es.findIndex(e=>e.kind==='asset'),1),es=>es.find(e=>e.kind==='asset').scale=1.01,es=>es.find(e=>e.kind==='asset').minLabelSize=33,es=>es.find(e=>e.kind==='asset').minInformativeStroke=2]) {
  const value=clone(fixture.input);metricEdit(value,edit);report=await evaluate(value);assert.ok(has(report,'asset-geometry','failed'));
 }
});
test('malformed input is a safe argument error, not an exception or getter execution',async()=>{
 for(const value of [null,{}, {manifest:null,composition:null,files:[],qualification:[]}]) await assert.rejects(evaluate(value),e=>e.name==='PublicError');
 const value=await input();let called=false;Object.defineProperty(value.manifest,'danger',{enumerable:true,get(){called=true;return 1;}});
 await assert.rejects(evaluate(value),e=>e.name==='PublicError');assert.equal(called,false);
});
test('deleted or duplicated glyph cannot pass just because line text remains intact',async()=>{
 for(const edit of [es=>es.find(e=>e.id==='body').glyphs.shift(),es=>es.find(e=>e.id==='body').glyphs.push(es.find(e=>e.id==='body').glyphs[0])]) {
  const value=await input();metricEdit(value,edit);const report=await evaluate(value);assert.ok(has(report,'copy-exact','failed'));
 }
});
test('first outside gap, font maximum and line limit fail at each boundary',async()=>{
 for(const [code,edit] of [
  ['collision',es=>{const a=es.find(e=>e.id==='title');es.push({id:'near',kind:'decoration',bounds:{x:a.bounds.x,y:a.bounds.y+a.bounds.height+23,width:20,height:20}});}],
  ['typography',es=>es.find(e=>e.id==='title').glyphs[0].fontSize=177],
  ['typography',es=>{const a=es.find(e=>e.id==='body');while(a.lines.length<=7)a.lines.push({...a.lines[0]});}],
 ]) {const value=await input();metricEdit(value,edit);const report=await evaluate(value);assert.ok(has(report,code,'failed'));}
});
test('changed asset or logo bytes cannot borrow existing descriptors',async()=>{
 for(const resource of ['assets','logos']) {
  const value=resource==='assets'?clone((await renderedQualityFixture({selection:[4]})).input):await input();value.composition.inputs[resource][0].bytes[20]^=1;
  const report=await evaluate(value);assert.ok(has(report,'asset-geometry','failed'));
 }
});
test('source input objects mutated during async verification cannot replace captured evidence',async()=>{
 const value=await input(),pending=evaluate(value);value.files[0].bytes.fill(0);value.composition.inputs.carousel.slides[0].title='changed';
 assert.equal((await pending).result,'passed');
});
test('self-consistent white pixels and white SVG cannot reuse real text metrics',async()=>{
 const {default:sharp}=await import('sharp');
 for(const replaceSvg of [false,true]) {
  const value=await input(),blank=await sharp({create:{width:1080,height:1350,channels:4,background:'#ffffff'}}).png().toBuffer();
  const digest=sha256(blank),rgba=sha256(await sharp(blank).ensureAlpha().raw().toBuffer());
  Object.assign(value.composition.slides[0],{png:blank,sha256:digest,rgbaSha256:rgba});
  if(replaceSvg)value.composition.slides[0].svg='<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="white"/></svg>';
  value.files[0].bytes=blank;Object.assign(value.manifest.files[0],{size:blank.length,rgbaSha256:rgba});value.manifest.files[0].artifactRef.sha256=digest;
  const report=await evaluate(value);assert.equal(report.result,'failed');assert.ok(has(report,'file-integrity','failed'));
 }
});
test('one selected slide cannot impersonate a complete five-slide final',async()=>{
 const {f,result}=await renderedQualityFixture(),{qualityInput}=await import('../helpers/quality-render-fixture.mjs');
 const forged=clone(result);forged.selection.allSlides=true;forged.panorama={...forged.slides[0],width:1080,height:1350};
 const report=await evaluate(qualityInput(f,forged));assert.equal(report.result,'failed');assert.ok(has(report,'file-integrity','failed'));
});
test('missing original fonts cannot certify caller-supplied pixels',async()=>{
 const value=await input();delete value.composition.inputs.fonts;const report=await evaluate(value);assert.equal(report.result,'not-verified');assert.ok(has(report,'file-integrity','not-verified'));
});
test('verification never composes an overflow slide outside the requested subset',async()=>{
 const {qualityFixture,qualityInput}=await import('../helpers/quality-render-fixture.mjs'),{sealComposedFixture}=await import('../helpers/composed-render-fixture.mjs'),{composeCarousel}=await import('../../src/render/composed-carousel.mjs');
 const f=await qualityFixture(),source=f.carousel.slides[1],b=f.plan.slides[1].blocks.find(b=>b.id==='body');source.body='W'.repeat(1000);b.source.end=source.body.length;b.spans=[{start:0,end:source.body.length,styleId:'body'}];sealComposedFixture(f);
 const result=await composeCarousel({...f,selection:[1]});assert.equal((await evaluate(qualityInput(f,result))).result,'passed');
 await assert.rejects(composeCarousel({...f,selection:'all'}),{code:'COMPOSITION_LIMIT_EXCEEDED'});
});
test('preview may cover every slide while its manifest still omits the full panorama',async()=>{
 const value=(await renderedQualityFixture({selection:'all'})).input;
 const panorama=value.manifest.files.find(f=>f.role==='panorama');value.manifest.files=value.manifest.files.filter(f=>f!==panorama);value.files=value.files.filter(f=>f.id!==panorama.artifactRef.id);
 value.manifest.kind='preview';value.manifest.selection.policyId='representative-risk@1';value.manifest.selectionHash=canonicalHash(value.manifest.selection);
 const report=await evaluate(value);assert.equal(report.checks.filter(c=>c.result==='failed').length,0,JSON.stringify(report.checks.filter(c=>c.result==='failed')));
 assert.equal(report.result,'not-verified','diagram semantic evidence still requires inspection');
});
test('continuity verifies informative stroke and leaves standalone meaning for a human',async()=>{
 const {composedFixture,addComposedContinuity}=await import('../helpers/composed-render-fixture.mjs'),{qualityInput}=await import('../helpers/quality-render-fixture.mjs'),{composeCarousel}=await import('../../src/render/composed-carousel.mjs');
 const f=addComposedContinuity(await composedFixture()),result=await composeCarousel({...f,selection:[2,3]}),value=qualityInput(f,result),report=await evaluate(value);
 assert.equal(report.checks.filter(c=>c.result==='failed').length,0,JSON.stringify(report.checks.filter(c=>c.result==='failed')));assert.ok(has(report,'continuity-independent','not-verified'));
 metricEdit(value,es=>es.find(e=>e.segment).stroke=2);assert.ok(has(await evaluate(value),'asset-geometry','failed'));
});
test('malformed nested evidence fails with a sanitized public error',async()=>{
 for(const change of [v=>v.composition.slides=[null],v=>v.composition.slides[0].scene.elements=[null],v=>v.composition.inputs.plan=null,v=>v.composition.inputs.snapshot.brand=null,v=>v.composition.inputs.carousel.slides=null,v=>v.composition.inputs.plan.slides[0].blocks=null]) {
  const value=await input();change(value);await assert.rejects(evaluate(value),e=>e.name==='PublicError');
 }
});
test('null glyph, line and logo evidence never exposes a native TypeError',async()=>{
 for(const change of [v=>v.composition.slides[0].scene.elements.find(e=>e.id==='title').glyphs=[null],v=>v.composition.slides[0].scene.elements.find(e=>e.id==='title').lines=[null],v=>v.composition.inputs.snapshot.brand.config.logo=null]) {
  const value=await input();change(value);await assert.rejects(evaluate(value),e=>e.name==='PublicError'&&typeof e.code==='string');
 }
});
