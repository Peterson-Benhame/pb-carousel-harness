import test from 'node:test';
import assert from 'node:assert/strict';
import {composedFixture,sealComposedFixture,addComposedContinuity} from '../helpers/composed-render-fixture.mjs';
import {canonicalHash} from '../../src/domain/canonical-json.mjs';
import * as compositor from '../../src/render/composed-carousel.mjs';

test('preflight measures every slide with the same geometry, without composing final SVGs or rasterizing',async()=>{
 assert.equal(typeof compositor.measureCompositionPlan,'function');const f=await composedFixture(),m=await compositor.measureCompositionPlan(f),rendered=await compositor.composeCarousel(f);
 assert.equal(m.slides.length,5);assert.deepEqual(m.activity,{measuredIndices:[1,2,3,4,5],composedIndices:[],rasterizedIndices:[]});
 for(const slide of m.slides){assert.ok(!Object.hasOwn(slide,'svg'));assert.ok(!Object.hasOwn(slide,'png'));assert.deepEqual(slide.metrics,rendered.slides[slide.index-1].metrics);assert.equal(m.riskInventory.slides[slide.index-1].density,slide.metrics.density);}
});
test('preflight blocks off-selection overflow and measures actual seam/diagram risks',async()=>{
 assert.equal(typeof compositor.measureCompositionPlan,'function');const f=addComposedContinuity(await composedFixture()),m=await compositor.measureCompositionPlan(f);
 assert.equal(m.riskInventory.seams.length,1);assert.ok(Number.isFinite(m.riskInventory.seams[0].minTextDistance));assert.equal(m.riskInventory.seams[0].hasSemanticCrossing,true);assert.equal(m.riskInventory.slides[1].minDiagramLabelSize,34);
 const slide=f.carousel.slides[4];slide.body='W'.repeat(1000);const b=f.plan.slides[4].blocks.find(b=>b.source.field==='body');b.source.end=slide.body.length;b.spans=[{start:0,end:slide.body.length,styleId:'body'}];sealComposedFixture(f);
 await assert.rejects(compositor.measureCompositionPlan(f),{code:'COMPOSITION_LIMIT_EXCEEDED'});
});
