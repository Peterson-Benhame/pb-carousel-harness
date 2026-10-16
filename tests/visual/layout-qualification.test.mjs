import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { assertQualifiedLayout } from '../../src/domain/layout-qualification.mjs';
import { renderedQualityFixture } from '../helpers/quality-render-fixture.mjs';
const objective = await import('../../src/quality/objective-checks.mjs').catch(() => ({}));
const rubric = await import('../../src/quality/review-rubric.mjs').catch(() => ({}));
test('versioned review rubric requires human inspection of every image at full size and360 px',()=>{
 assert.equal(typeof rubric.getReviewRubric,'function','Q06 review rubric is required');
 const r=rubric.getReviewRubric(1);assert.equal(r.id,'editorial-quality@1');assert.equal(r.version,1);
 assert.deepEqual(r.criteria.map(c=>c.id),['legibility','hierarchy','composition','rhythm','visual-semantics','brand-finish']);
 assert.ok(r.criteria.every(c=>c.required&&c.method==='human-local-assisted@1'));
 assert.equal(r.coverage.mobileWidth,360);assert.equal(r.coverage.fullResolution,true);
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.criteria));assert.throws(()=>rubric.getReviewRubric(2),{code:'INVALID_ARGUMENT'});
 assert.equal(Object.hasOwn(r,'passed'),false);assert.equal(canonicalHash(r),canonicalHash(rubric.getReviewRubric(1)));
});
for(const identity of ['amber','blue']) for(const surface of ['light','dark']) for(const boundary of [false,true]) {
 test(`candidate matrix: ${identity}, ${surface}, ${boundary?'line limits':'representative'}`,async()=>{
  assert.equal(typeof objective.evaluateRenderedQuality,'function','Q06 objective checker is required');
  const {f,input}=await renderedQualityFixture({identity,surface,boundary,selection:'all'});
  const report=await objective.evaluateRenderedQuality(input);
  assert.equal(input.composition.slides.length,5);
  assert.equal(report.checks.filter(c=>c.result==='failed').length,0,JSON.stringify(report.checks.filter(c=>c.result==='failed')));
  assert.equal(report.result,'not-verified','raster semantic/contrast inspection cannot be invented');
  for(const record of f.qualifications) {assert.equal(record.status,'candidate');assert.equal(record.release,null);assert.throws(()=>assertQualifiedLayout(record),{code:'LAYOUT_NOT_QUALIFIED'});}
 });
}
test('catalog remains unreleased; installed checker modules are recorded by actual hash',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../shared/resources.manifest.json',import.meta.url),'utf8'));
 const renderer=manifest.renderers.find(r=>r.id==='editorial-composed@1');
 for(const file of ['src/quality/objective-checks.mjs','src/quality/review-rubric.mjs']) assert.match(renderer.hashes[file]??'',/^[a-f0-9]{64}$/);
 assert.equal(renderer.status,'candidate');
 const catalog=JSON.parse(await readFile(new URL('../../shared/layouts/editorial-composed-v1.json',import.meta.url),'utf8'));
 assert.ok(catalog.qualifications.every(q=>q.status==='candidate'&&q.release===null&&q.evidenceRefs.length===0));
});
for(const index of [1,2,3,4,5]) for(const field of ['title','body']) test(`first line beyond candidate limit is rejected: slide ${index} ${field}`,async()=>{
 const {qualityFixture}=await import('../helpers/quality-render-fixture.mjs'),{sealComposedFixture}=await import('../helpers/composed-render-fixture.mjs'),{composeCarousel}=await import('../../src/render/composed-carousel.mjs');
 const f=await qualityFixture({boundary:true}),entry=f.plan.slides[index-1],source=f.carousel.slides[index-1],blocks=entry.blocks.filter(b=>b.source.field===field);
 if(blocks.length===1) {source[field]+='\nIDEIA';blocks[0].source.end=source[field].length;blocks[0].spans=[{start:0,end:source[field].length,styleId:field}];}
 else {
  const parts=[Array(17).fill('Ação.').join('\n')+' ',Array(13).fill('Ação.').join('\n')];source[field]=parts.join('');let offset=0;
  blocks.forEach((b,i)=>{b.source={field,start:offset,end:offset+parts[i].length};b.spans=[{start:0,end:parts[i].length,styleId:field}];offset+=parts[i].length;});
 }
 sealComposedFixture(f);await assert.rejects(composeCarousel({...f,selection:[index]}),{code:'COMPOSITION_LIMIT_EXCEEDED'});
});
test('dense total first excess31 lines fails while both columns respect16',async()=>{
 const {qualityFixture}=await import('../helpers/quality-render-fixture.mjs'),{sealComposedFixture}=await import('../helpers/composed-render-fixture.mjs'),{composeCarousel}=await import('../../src/render/composed-carousel.mjs');
 const f=await qualityFixture({boundary:true}),entry=f.plan.slides[2],parts=[Array(16).fill('Ação.').join('\n')+' ',Array(15).fill('Ação.').join('\n')];f.carousel.slides[2].body=parts.join('');let offset=0;
 entry.blocks.filter(b=>b.source.field==='body').forEach((b,i)=>{b.source={field:'body',start:offset,end:offset+parts[i].length};b.spans=[{start:0,end:parts[i].length,styleId:'body'}];offset+=parts[i].length;});
 sealComposedFixture(f);await assert.rejects(composeCarousel({...f,selection:[3]}),{code:'COMPOSITION_LIMIT_EXCEEDED'});
});
test('accented three-line diagram title may fail real ink height despite nominal line ceiling',async()=>{
 const {qualityFixture}=await import('../helpers/quality-render-fixture.mjs'),{sealComposedFixture}=await import('../helpers/composed-render-fixture.mjs'),{composeCarousel}=await import('../../src/render/composed-carousel.mjs');
 const f=await qualityFixture({boundary:true}),title='AÇÃO\nAÇÃO\nAÇÃO',block=f.plan.slides[3].blocks.find(b=>b.id==='title');f.carousel.slides[3].title=title;block.source.end=title.length;block.spans=[{start:0,end:title.length,styleId:'title'}];sealComposedFixture(f);
 await assert.rejects(composeCarousel({...f,selection:[4]}),{code:'COMPOSITION_LIMIT_EXCEEDED'});
});
for(const role of ['context','summary']) test(`internal candidate layouts preserve the supported ${role} role`,async()=>{
 const {qualityFixture,qualityInput}=await import('../helpers/quality-render-fixture.mjs'),{sealComposedFixture}=await import('../helpers/composed-render-fixture.mjs'),{composeCarousel}=await import('../../src/render/composed-carousel.mjs');
 const f=await qualityFixture();for(const index of [1,2,3]){f.carousel.slides[index].role=role;f.plan.slides[index].contentRole=role;}sealComposedFixture(f);
 const result=await composeCarousel({...f,selection:[2,3,4]}),report=await objective.evaluateRenderedQuality(qualityInput(f,result));
 assert.equal(report.checks.filter(c=>c.result==='failed').length,0,JSON.stringify(report.checks.filter(c=>c.result==='failed')));
});
