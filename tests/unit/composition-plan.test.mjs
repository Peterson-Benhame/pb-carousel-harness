import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { compositionFixture, resetRiskHash, artifactRef, BRAND_ID, RUN_ID } from '../fixtures/quality/composition-fixture.mjs';

const missing = error => { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {}; };
const composition = await import('../../src/domain/composition-plan.mjs').catch(missing);
const requireApi = () => assert.equal(typeof composition.validateCompositionPlan, 'function', 'pure CompositionPlan validator must exist');
const validate = input => { requireApi(); return composition.validateCompositionPlan(input); };
const reject = (input, code = 'COMPOSITION_INVALID') => assert.throws(() => validate(input), { code });
const fixture = async count => { requireApi(); return compositionFixture(count); };

// Production changes that drop a range, allow a foreign reference or erase a
// nonempty unsupported field must make these assertions fail.
test('valid no-asset plan preserves all JSON and returns an independent deeply frozen value', async () => {
  const f = await fixture(); const before = structuredClone(f);
  const value = validate(f);
  assert.deepEqual(value, before.plan); assert.deepEqual(f, before);
  assert.notEqual(value, f.plan); assert.ok(Object.isFrozen(value.slides[0].blocks[0].source));
  assert.throws(() => { value.slides[0].blocks[0].source.start = 2; }, TypeError);
  assert.equal(value.slides[0].qualificationRef.sha256, canonicalHash(f.qualifications[0]));
});

test('truncated, duplicated, missing and reordered source ranges cannot reconstruct the copy', async () => {
  for (const mutate of [
    f => { f.plan.slides[0].blocks[2].source.end--; f.plan.slides[0].blocks[2].spans[0].end--; },
    f => { f.plan.slides[0].blocks.push(structuredClone(f.plan.slides[0].blocks[2])); },
    f => { f.plan.slides[0].blocks.pop(); },
    f => { f.plan.slides[0].blocks.reverse(); },
    f => { f.plan.slides[0].blocks[1].source.field = 'body'; },
  ]) { const f = await fixture(); mutate(f); reject(f); }
});

test('spans are relative, contiguous, ordered and cover the exact source without editable text', async () => {
  const f = await fixture(); const block = f.plan.slides[0].blocks[1];
  block.spans = [{ start: 0, end: 3, styleId: 'title' }, { start: 3, end: block.source.end, styleId: 'title' }];
  assert.deepEqual(validate(f).slides[0].blocks[1], block);
  for (const mutate of [
    b => { b.spans[1].start = 4; }, b => { b.spans[1].start = 2; },
    b => { b.spans.reverse(); }, b => { b.spans[0].text = 'Edited'; },
    b => { b.spans[0].styleId = 'other'; }, b => { b.spans[0].end = 0; },
  ]) { const changed = structuredClone(f); mutate(changed.plan.slides[0].blocks[1]); reject(changed); }
});

test('UTF-16 ranges never split surrogate pairs, combining marks or ZWJ grapheme clusters', async () => {
  for (const text of ['A😀B', 'Ae\u0301B', 'A👩‍💻B']) {
    const f = await fixture(); f.carousel.slides[0].title = text;
    const block = f.plan.slides[0].blocks[1]; block.source.end = text.length;
    block.spans = [{ start: 0, end: text.length, styleId: 'title' }];
    assert.equal(validate(f).slides[0].blocks[1].source.end, text.length);
    block.spans = [{ start: 0, end: 2, styleId: 'title' }, { start: 2, end: text.length, styleId: 'title' }];
    reject(f);
  }
});

test('exact spaces, punctuation, accents and long words are preserved structurally without claiming fit', async () => {
  const f = await fixture(); const text = `  Ação e cafe\u0301: ${'W'.repeat(1000)}!\n  `;
  f.carousel.slides[1].body = text;
  const block = f.plan.slides[1].blocks[2]; block.source.end = text.length; block.spans[0].end = text.length;
  assert.equal(validate(f).slides[1].blocks[2].source.end, text.length);
  assert.equal(f.carousel.slides[1].body, text);
});

test('code and number are rejected when present and nonempty, including numeric zero', async () => {
  for (const [field, value] of [['code', 'x'], ['code', ' '], ['number', 0], ['number', -0], ['number', '0'], ['number', 1e21]]) {
    const f = await fixture(); f.carousel.slides[1][field] = value; reject(f, 'COMPOSITION_FIELD_UNSUPPORTED');
  }
  const f = await fixture(); f.carousel.slides[1].code = ''; f.carousel.slides[1].number = '';
  assert.equal(validate(f).slides.length, 3);
});

test('plan, nested blocks and refs reject free coordinates, paths, executable keys and unsafe JSON before invocation', async () => {
  for (const mutate of [
    f => { f.plan.script = 'exec()'; }, f => { f.plan.slides[0].blocks[0].x = 0; },
    f => { f.plan.carouselRef.path = '../foreign.bin'; }, f => { f.plan.slides[0].blocks[0].source.text = 'extra'; },
    f => { f.plan.slides[0].decorationChoices.push({ elementId: 'free', optionId: 'css:expression()' }); },
    f => { f.plan.slides[0].overlaps.push({ backElementId: 'title', frontElementId: 'body', purpose: 'highlight-background', intentional: true }); },
  ]) { const f = await fixture(); mutate(f); reject(f); }
  const f = await fixture(); let called = false;
  Object.defineProperty(f.plan, 'evil', { enumerable: true, get() { called = true; throw Error('must not execute'); } });
  assert.throws(() => validate(f), { code: 'INVALID_JSON_VALUE' }); assert.equal(called, false);
  for (const value of [NaN, Infinity, () => 1, undefined]) {
    const changed = await fixture(); changed.plan.version = value;
    assert.throws(() => validate(changed), { code: 'INVALID_JSON_VALUE' });
  }
});

test('unknown layout, wrong role or surface, reused blocks and qualification bytes are refused', async () => {
  for (const mutate of [
    f => { f.plan.slides[1].layoutId = 'unknown@1'; },
    f => { f.plan.slides[1].contentRole = 'cta'; },
    f => { f.plan.slides[1].surface = 'neon'; },
    f => { f.plan.slides[1].blocks[0].id = 'title'; },
    f => { f.plan.slides[1].blocks[0].regionId = 'logo'; },
    f => { f.plan.slides[1].qualificationRef.sha256 = 'f'.repeat(64); },
    f => { f.plan.slides[1].qualificationRef.definitionHash = 'f'.repeat(64); },
    f => { f.plan.slides[1].qualificationRef.version++; },
  ]) { const f = await fixture(); mutate(f); reject(f); }
});

test('risk inventory is complete, bound to layout/fonts/surface and rejects unknown or excessive measured density', async () => {
  const f = await fixture(); f.plan.riskInventory.slides[1].density = 1; resetRiskHash(f);
  assert.equal(validate(f).riskInventory.slides[1].density, 1);
  const overflow = structuredClone(f); overflow.plan.riskInventory.slides[1].density = 1.000001; resetRiskHash(overflow);
  reject(overflow, 'COMPOSITION_LIMIT_EXCEEDED');
  for (const mutate of [
    g => { g.plan.riskInventory.slides.pop(); }, g => { g.plan.riskInventory.slides[1].density = null; },
    g => { g.plan.riskInventory.slides[1].fontBindingsHash = 'f'.repeat(64); },
    g => { g.plan.riskInventory.slides[1].surface = 'dark'; },
    g => { g.plan.riskInventory.slides[1].minDiagramLabelSize = 34; },
  ]) { const changed = structuredClone(f); mutate(changed); resetRiskHash(changed); reject(changed); }
});

test('preview selection requires the cover, representative internal and densest internal with immutable risk hash', async () => {
  const f = await fixture(5); f.plan.riskInventory.slides[2].density = 0.9; resetRiskHash(f);
  const selected = composition.derivePreviewSelection({ slides: f.plan.slides, riskInventory: f.plan.riskInventory });
  assert.deepEqual(selected.slideIndices, [1, 2, 3]);
  assert.deepEqual(selected.reasons, [{ slideIndex: 1, codes: ['cover'] }, { slideIndex: 2, codes: ['representative'] }, { slideIndex: 3, codes: ['densest'] }]);
  f.plan.previewSelection = selected; assert.deepEqual(validate(f).previewSelection, selected);
  const stale = structuredClone(f); stale.plan.previewSelection.riskInventoryHash = 'f'.repeat(64); reject(stale);
  const omitted = structuredClone(f); omitted.plan.previewSelection.slideIndices = [1, 2]; omitted.plan.previewSelection.reasons.pop(); reject(omitted, 'PREVIEW_SELECTION_UNSUPPORTED');
});

test('preview tie-breaks are deterministic and density unknown never becomes zero', async () => {
  const f = await fixture(6); const selected = composition.derivePreviewSelection(f.plan);
  assert.deepEqual(selected.slideIndices, [1, 2]);
  f.plan.riskInventory.slides[1].density = null;
  assert.throws(() => composition.derivePreviewSelection(f.plan), { code: 'COMPOSITION_INVALID' });
});

test('preview rejects a family without a representative internal and selection above six', async () => {
  const f = await fixture(8); f.plan.previewSelection.slideIndices = [1, 2, 3, 4, 5, 6, 7];
  f.plan.previewSelection.reasons = f.plan.previewSelection.slideIndices.map(slideIndex => ({ slideIndex, codes: slideIndex === 1 ? ['cover'] : ['representative'] }));
  reject(f, 'PREVIEW_SELECTION_UNSUPPORTED');
  const pair = await fixture(2); assert.throws(() => composition.derivePreviewSelection(pair.plan), { code: 'PREVIEW_SELECTION_UNSUPPORTED' });
});

test('change references are typed and bounded correction cannot masquerade as initial', async () => {
  for (const mutate of [
    f => { f.plan.change.previousPlanRef = artifactRef('composition-plan'); },
    f => { f.plan.change.kind = 'bounded-correction'; },
    f => { f.plan.change.kind = 'material'; f.plan.change.previousPlanRef = artifactRef('carousel'); },
  ]) { const f = await fixture(); mutate(f); reject(f); }
  const f = await fixture(); f.plan.change = { kind: 'material', previousPlanRef: artifactRef('composition-plan', '3'), correctionEpisodeRef: null };
  assert.equal(validate(f).change.kind, 'material');
});

import { addDiagram } from '../fixtures/quality/composition-fixture.mjs';

test('diagram refs require matching run, brand, bytes, canonical key and metadata without fallback', async () => {
  const f = addDiagram(await fixture());
  f.plan.previewSelection = composition.derivePreviewSelection(f.plan);
  assert.equal(validate(f).assets[0].assetKey, 'diagram-2');
  for (const mutate of [
    g => { g.assets[0].brandId = RUN_ID; }, g => { g.assets[0].runId = BRAND_ID; },
    g => { g.assets[0].artifactRef.sha256 = 'f'.repeat(64); }, g => { g.assets[0].assetKey = 'other'; },
    g => { g.assets = []; }, g => { g.plan.slides[1].assets[0].fit = 'cover'; },
    g => { g.plan.slides[1].assets[0].anchorIds = ['unknown']; },
    g => { g.assets[0].metadata.path = '/system/font.ttf'; },
    g => { g.plan.assets.push(structuredClone(g.plan.assets[0])); },
  ]) { const changed = structuredClone(f); mutate(changed); reject(changed); }
});

test('diagram declared output geometry and risk metadata enforce minimum labels, strokes and visible size', async () => {
  const f = addDiagram(await fixture()); f.plan.previewSelection = composition.derivePreviewSelection(f.plan);
  assert.equal(validate(f).riskInventory.slides[1].minDiagramLabelSize, 34);
  for (const mutate of [
    g => { g.assets[0].metadata.minLabelSize = 33.99; },
    g => { g.assets[0].metadata.minInformativeStroke = 2.99; },
    g => { g.assets[0].metadata.width = 719; },
    g => { g.assets[0].metadata.height = 359; },
  ]) { const changed = structuredClone(f); mutate(changed); reject(changed, 'COMPOSITION_LIMIT_EXCEEDED'); }
  const unknown = structuredClone(f); unknown.assets[0].metadata.minLabelSize = null; reject(unknown);
});

test('diagram preview picks measured smallest labels before stroke and occupancy', async () => {
  const f = addDiagram(addDiagram(await fixture(5), 2), 3);
  f.assets[0].metadata.minLabelSize = 40;
  f.plan.riskInventory.slides[1].minDiagramLabelSize = 40;
  f.plan.riskInventory.slides[1].density = 0.9;
  f.plan.previewSelection = composition.derivePreviewSelection(f.plan);
  assert.ok(f.plan.previewSelection.reasons.find(r => r.slideIndex === 3).codes.includes('diagram-risk'));
  assert.deepEqual(validate(f).previewSelection.slideIndices, [1, 2, 3]);
});

test('essential, nonadjacent, undeclared and unbound continuity is refused', async () => {
  for (const semanticRole of ['essential', 'supporting', 'decorative']) {
    const f = addDiagram(await fixture());
    f.plan.continuities = [{ from: 1, to: 2, assetKey: 'diagram-2', anchorPairId: 'unknown', semanticRole }];
    f.plan.previewSelection = composition.derivePreviewSelection(f.plan);
    reject(f);
  }
});

test('risk selection covers both sides of highest and additional risky seams, with a hard six-slide bound', async () => {
  const f = await fixture(8);
  f.plan.riskInventory.seams = [
    { from: 2, to: 3, semanticRole: 'decorative', minTextDistance: 100, hasDeclaredOverlap: false, hasSemanticCrossing: false },
    { from: 4, to: 5, semanticRole: 'supporting', minTextDistance: 100, hasDeclaredOverlap: false, hasSemanticCrossing: false },
    { from: 6, to: 7, semanticRole: 'decorative', minTextDistance: 47, hasDeclaredOverlap: false, hasSemanticCrossing: false },
  ];
  let selected = composition.derivePreviewSelection(f.plan);
  assert.deepEqual(selected.slideIndices, [1, 2, 4, 5, 6, 7]);
  assert.deepEqual(selected.seamPairs, [{ from: 4, to: 5 }, { from: 6, to: 7 }]);
  f.plan.riskInventory.seams[0].hasDeclaredOverlap = true;
  assert.throws(() => composition.derivePreviewSelection(f.plan), { code: 'PREVIEW_SELECTION_UNSUPPORTED' });
});

test('dense two-column body reconstructs left to right with an exact grapheme boundary', async () => {
  const f = await fixture(); const q = f.qualifications.find(item => item.definition.layoutId === 'content-dense@1');
  const slide = f.plan.slides[1]; slide.layoutId = q.definition.layoutId;
  slide.qualificationRef = { id: q.id, version: q.version, sha256: canonicalHash(q), definitionHash: q.definitionHash };
  const end = f.carousel.slides[1].body.length;
  slide.blocks.splice(2, 1,
    { id: 'body-left', regionId: 'body-left', source: { field: 'body', start: 0, end: 6 }, spans: [{ start: 0, end: 6, styleId: 'body' }], alignment: 'left' },
    { id: 'body-right', regionId: 'body-right', source: { field: 'body', start: 6, end }, spans: [{ start: 0, end: end - 6, styleId: 'body' }], alignment: 'left' });
  Object.assign(f.plan.riskInventory.slides[1], { layoutId: q.definition.layoutId, fontBindingsHash: canonicalHash(q.definition.fontBindings) });
  f.plan.previewSelection = composition.derivePreviewSelection(f.plan);
  assert.equal(validate(f).slides[1].blocks.length, 4);
  const reordered = structuredClone(f); reordered.plan.slides[1].blocks.splice(2, 2, ...reordered.plan.slides[1].blocks.slice(2).reverse()); reject(reordered);
});

test('candidate continuity checks source declarations, normalized anchor bindings and complete risk pairs', async () => {
  const f = addDiagram(await fixture(4), 2);
  const q = f.qualifications.find(item => item.definition.layoutId === 'diagram-explainer@1');
  q.version = 2;
  q.definition.continuity = {
    anchors: [{ id: 'left', regionId: 'diagram', x: 0, y: 0.5 }, { id: 'right', regionId: 'diagram', x: 1, y: 0.5 }],
    pairs: [{ id: 'shared-support', fromAnchorId: 'right', toAnchorId: 'left', semanticRoles: ['supporting'] }], maxPairs: 1,
  };
  q.definitionHash = canonicalHash(q.definition);
  for (const index of [1, 2]) {
    const slide = f.plan.slides[index]; slide.layoutId = q.definition.layoutId;
    slide.qualificationRef = { id: q.id, version: q.version, sha256: canonicalHash(q), definitionHash: q.definitionHash };
    slide.assets = [{ assetKey: 'diagram-2', regionId: 'diagram', fit: 'contain', anchorIds: [index === 1 ? 'right' : 'left'] }];
    Object.assign(f.plan.riskInventory.slides[index], { layoutId: q.definition.layoutId, fontBindingsHash: canonicalHash(q.definition.fontBindings), minDiagramLabelSize: 34, minInformativeStroke: 3 });
  }
  f.assets[0].metadata.anchors = [{ id: 'left', x: 0, y: 0.5 }, { id: 'right', x: 1, y: 0.5 }];
  f.carousel.continuity = [{ from: 2, to: 3, assetId: 'diagram-2' }];
  f.plan.continuities = [{ from: 2, to: 3, assetKey: 'diagram-2', anchorPairId: 'shared-support', semanticRole: 'supporting' }];
  f.plan.riskInventory.seams = [{ from: 2, to: 3, semanticRole: 'supporting', minTextDistance: 48, hasDeclaredOverlap: false, hasSemanticCrossing: true }];
  f.plan.previewSelection = composition.derivePreviewSelection(f.plan);
  assert.deepEqual(validate(f).previewSelection.seamPairs, [{ from: 2, to: 3 }]);
  for (const mutate of [
    g => { g.carousel.continuity = []; }, g => { g.plan.continuities[0].to = 4; },
    g => { g.plan.riskInventory.seams = []; resetRiskHash(g); },
    g => { g.plan.slides[2].assets[0].anchorIds = ['right']; },
    g => { g.assets[0].metadata.anchors.pop(); },
  ]) { const changed = structuredClone(f); mutate(changed); reject(changed); }
});

test('diagram layout never silently accepts an empty semantic region', async () => {
  const f = addDiagram(await fixture()); f.plan.assets = []; f.assets = []; f.carousel.assets = []; f.plan.slides[1].assets = [];
  f.plan.riskInventory.slides[1].minDiagramLabelSize = null; f.plan.riskInventory.slides[1].minInformativeStroke = null;
  f.plan.previewSelection = composition.derivePreviewSelection(f.plan);
  reject(f);
});

test('artifact IDs cannot alias different kinds or the plan itself', async () => {
  for (const mutate of [
    f => { f.plan.conceptRef.id = f.plan.carouselRef.id; },
    f => { f.plan.carouselRef.id = f.plan.id; },
  ]) { const f = await fixture(); mutate(f); reject(f); }
});

test('change history refs cannot alias current inputs, current plan or one another', async () => {
  for (const mutate of [
    f => { f.plan.change = { kind: 'material', previousPlanRef: { ...artifactRef('composition-plan'), id: f.plan.carouselRef.id }, correctionEpisodeRef: null }; },
    f => { f.plan.change = { kind: 'bounded-correction', previousPlanRef: artifactRef('composition-plan', '3'), correctionEpisodeRef: { ...artifactRef('quality-correction-episode', '4'), id: f.plan.id } }; },
    f => { f.plan.change = { kind: 'bounded-correction', previousPlanRef: artifactRef('composition-plan', '3'), correctionEpisodeRef: artifactRef('quality-correction-episode', '3') }; },
  ]) { const f = await fixture(); mutate(f); reject(f); }
});

test('null nested collection items fail with sanitized domain errors', async () => {
  for (const mutate of [
    f => { f.plan.slides[0].decorationChoices = [null]; },
    f => { f.plan.slides[0].overlaps = [null]; },
    f => { f.assets[0].metadata.anchors = [null]; },
    f => { f.plan.assets = [null]; },
    f => { f.carousel.continuity = [{ from: 1, to: 2, assetId: 'diagram-2' }]; f.plan.continuities = [null]; },
  ]) {
    const f = addDiagram(await fixture()); f.plan.previewSelection = composition.derivePreviewSelection(f.plan);
    mutate(f); reject(f);
  }
});

test('text block identities cannot impersonate another reserved region or decoration', async () => {
  for (const id of ['logo', 'signature', 'body']) {
    const f = await fixture(); f.plan.slides[0].blocks[1].id = id; reject(f);
  }
});

test('normalization sorts semantic sets while retaining reading order and leaving inputs untouched', async () => {
  const f = addDiagram(addDiagram(await fixture(5), 2), 3);
  f.plan.previewSelection = composition.derivePreviewSelection(f.plan);
  const canonical = validate(f);
  const permuted = structuredClone(f);
  permuted.plan.assets.reverse();
  for (const reason of permuted.plan.previewSelection.reasons) reason.codes.reverse();
  const before = structuredClone(permuted);
  const normalized = validate(permuted);
  assert.deepEqual(normalized, canonical);
  assert.deepEqual(permuted, before);
  assert.deepEqual(normalized.slides[0].blocks.map(block => block.source.field), ['eyebrow', 'title', 'body']);
  assert.equal(canonicalHash(normalized), canonicalHash(canonical));
});
