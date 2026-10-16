import test from 'node:test';
import assert from 'node:assert/strict';
import { composedFixture, sealComposedFixture } from '../helpers/composed-render-fixture.mjs';
const module = await import('../../src/render/composed-carousel.mjs').catch(() => ({}));
const compose = args => { assert.equal(typeof module.composeCarousel, 'function', 'Q03 subset composer implementation is required'); return module.composeCarousel(args); };
test('sparse preview composes/rasterizes only original indices and equals full output byte-for-byte', async () => {
 const f=await composedFixture(), preview=await compose({...f,selection:[1,4]}),full=await compose(f);
 assert.deepEqual(preview.activity,{composedIndices:[1,4],rasterizedIndices:[1,4]});
 assert.deepEqual(preview.slides.map(s=>s.index),[1,4]); assert.equal(preview.panorama,null);
 for(const slide of preview.slides){const batch=full.slides.find(s=>s.index===slide.index);assert.deepEqual(slide.png,batch.png);assert.equal(slide.svg,batch.svg);assert.deepEqual(slide.metrics,batch.metrics);}
});
test('off-selection overflow cannot trigger hidden composition or rasterization',async()=>{
 const f=await composedFixture(),s=f.carousel.slides[1],b=f.plan.slides[1].blocks.find(b=>b.source.field==='body');s.body='W'.repeat(1000);b.source.end=s.body.length;b.spans=[{start:0,end:s.body.length,styleId:'body'}];sealComposedFixture(f);
 const preview=await compose({...f,selection:[1,4]});assert.deepEqual(preview.activity.rasterizedIndices,[1,4]);await assert.rejects(compose(f),{code:'COMPOSITION_LIMIT_EXCEEDED'});
});
test('invalid selection never broadens into all-slides',async()=>{
 const f=await composedFixture();for(const selection of [undefined,[],[0],[6],[4,1],[1,1]])await assert.rejects(compose({...f,selection}),error=>['INVALID_ARGUMENT','COMPOSITION_INVALID'].includes(error.code));
});
test('real composition and raster entry spies see only requested slides, independent of returned counters',async()=>{
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('../helpers/composition-spy.mjs',import.meta.url))],{encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);const actual=JSON.parse(child.stdout);assert.deepEqual(actual.spy,{composedIndices:[1,4],rasterizedIndices:[1,4]});
 const f=await composedFixture(),output=await compose({...f,selection:[1,4]});assert.deepEqual(actual.slides,output.slides.map(s=>({index:s.index,sha256:s.sha256,rgbaSha256:s.rgbaSha256})));
});
test('declared continuity joins real anchored geometry without composing the missing neighbor',async()=>{
 const {addComposedContinuity}=await import('../helpers/composed-render-fixture.mjs');const f=addComposedContinuity(await composedFixture());
 const single=await compose({...f,selection:[2]}),preview=await compose({...f,selection:[2,3]}),full=await compose(f);
 assert.deepEqual(single.activity,{composedIndices:[2],rasterizedIndices:[2]});assert.equal(single.seams.length,0);
 assert.deepEqual(single.slides[0].png,preview.slides[0].png);
 assert.deepEqual(preview.seams[0].png,full.seams[0].png);assert.equal(preview.seams[0].width,2160);
 const left=preview.slides[0].scene.continuities[0],right=preview.slides[1].scene.continuities[0];assert.deepEqual(left,right);
 assert.equal(left.fromPoint.x,2088);assert.equal(left.toPoint.x,2232);
 assert.equal(left.segments[0].x2,1080);assert.equal(left.segments[1].x1,0);assert.equal(left.segments[0].y2,left.segments[1].y1);
 for(const slide of preview.slides){const asset=slide.scene.elements.find(e=>e.kind==='asset');assert.equal(asset.bounds.width,800);assert.equal(asset.bounds.height,400);assert.ok(slide.scene.elements.some(e=>e.id.startsWith('continuity-')));}
});
test('diagonal declared continuity attaches without covering either complete semantic image',async()=>{
 const {addComposedContinuity}=await import('../helpers/composed-render-fixture.mjs');const f=addComposedContinuity(await composedFixture());f.qualifications.find(q=>q.definition.layoutId==='diagram-explainer@1').definition.continuity.anchors.find(a=>a.id==='left').y=0.6;sealComposedFixture(f);
 const r=await compose({...f,selection:[2,3]});const links=r.slides[0].scene.continuities[0];assert.equal(links.segments[0].y2,links.segments[1].y1);assert.ok(links.toPoint.y>links.fromPoint.y);
 for(const s of r.slides){const asset=s.scene.elements.find(e=>e.kind==='asset'),connector=s.scene.elements.find(e=>e.id.startsWith('continuity-'));assert.equal(asset.bounds.width,800);assert.equal(asset.bounds.height,400);assert.ok(s.index===2?connector.bounds.x>=asset.bounds.x+asset.bounds.width:connector.bounds.x+connector.bounds.width<=asset.bounds.x);}
});
