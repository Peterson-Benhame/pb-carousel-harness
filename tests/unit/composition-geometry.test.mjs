import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeSelection, slideFrame, containAsset, resolveSurface,
  boxGap, containsBox, intersects, contrastRatio, assertCompositionGeometry,
} from '../../src/render/composition-geometry.mjs';

const invalid = { code: 'INVALID_ARGUMENT' };
const exceeded = { code: 'COMPOSITION_LIMIT_EXCEEDED' };
const rect = (x = 72, y = 192, width = 120, height = 60) => ({ x, y, width, height });
const element = (id, bounds, kind = 'text', glyphs) => ({ id, kind, bounds, ...(glyphs ? { glyphs } : {}) });
const catalog = JSON.parse(await readFile(new URL('../../shared/layouts/editorial-composed-v1.json', import.meta.url), 'utf8'));
const definition = catalog.qualifications.find(q => q.definition.layoutId === 'diagram-explainer@1').definition;
const metadata = () => ({ width: 800, height: 400, semantic: true, minLabelSize: 34, minInformativeStroke: 3, anchors: [{ id: 'center', x: 0.5, y: 0.5 }] });
const region = definition.regions.find(region => region.id === 'diagram');
const theme = () => ({ background: '#ffffff', text: '#111111', muted: '#555555', accent: '#bb1100', secondaryAccent: '#0000aa', surfaceBindings: {
  light: { background: 'background', text: 'text', muted: 'muted', accent: 'accent' },
  dark: { background: 'text', text: 'background', muted: 'background', accent: 'accent', secondaryAccent: 'secondaryAccent' },
} });

// Removing strict selection validation would permit implicit/full render or reordered indices.
test('selection preserves sparse canonical indices without expanding to the whole carousel', () => {
  const input = [1, 4, 5], continuities = [{ from: 2, to: 3 }, { from: 4, to: 5 }];
  assert.deepEqual(normalizeSelection(input, 6, continuities), { slideIndices: [1, 4, 5], seamPairs: [{ from: 4, to: 5 }], allSlides: false });
  assert.deepEqual(input, [1, 4, 5]);
});
test('all selection includes every index and only real deduplicated continuity pairs', () => {
  assert.deepEqual(normalizeSelection('all', 3, [{ from: 2, to: 3 }, { from: 1, to: 2 }, { from: 2, to: 3 }]), {
    slideIndices: [1, 2, 3], seamPairs: [{ from: 1, to: 2 }, { from: 2, to: 3 }], allSlides: true,
  });
  assert.equal(normalizeSelection([1, 2, 3], 3, []).allSlides, true);
});
test('selection refuses missing, empty, repeated, unsorted and out-of-range indices', () => {
  for (const input of [undefined, null, [], [2, 1], [1, 1], [0], [4], [1.5], [NaN], '1', { slideIndices: [1], extra: true }]) {
    assert.throws(() => normalizeSelection(input, 3, []), invalid);
  }
  for (const count of [0, -1, 1.5, Infinity]) assert.throws(() => normalizeSelection('all', count, []), invalid);
});
test('explicit seam selection is retained and cannot select fictitious or unselected sides', () => {
  const continuities = [{ from: 1, to: 2 }, { from: 2, to: 3 }];
  const input = { slideIndices: [1, 2, 3], seamPairs: [{ from: 2, to: 3 }] };
  assert.deepEqual(normalizeSelection(input, 3, continuities), { ...input, allSlides: true });
  for (const selection of [
    { slideIndices: [1], seamPairs: [{ from: 1, to: 2 }] },
    { slideIndices: [1, 3], seamPairs: [{ from: 1, to: 3 }] },
    { slideIndices: [1, 2, 3], seamPairs: [{ from: 2, to: 3 }, { from: 1, to: 2 }] },
    { slideIndices: [1, 2], seamPairs: [{ from: 1, to: 2 }, { from: 1, to: 2 }] },
  ]) assert.throws(() => normalizeSelection(selection, 3, continuities), invalid);
  assert.throws(() => normalizeSelection({ slideIndices: [1, 2], seamPairs: [{ from: 1, to: 2 }] }, 3, []), invalid);
});
test('selection rejects malformed continuity geometry even if the pair is not selected', () => {
  for (const continuity of [{ from: 0, to: 1 }, { from: 1, to: 3 }, { from: 3, to: 4 }, { from: 1.5, to: 2.5 }]) {
    assert.throws(() => normalizeSelection([1], 3, [continuity]), invalid);
  }
});
test('slide frames retain world coordinates for the original one-based slide index', () => {
  assert.deepEqual(slideFrame(5, { width: 1080, height: 1350 }), { index: 5, worldX: 4320, width: 1080, height: 1350 });
  for (const index of [0, -1, NaN, 1.5]) assert.throws(() => slideFrame(index, { width: 1080, height: 1350 }), invalid);
  assert.throws(() => slideFrame(2, { width: Infinity, height: 1350 }), invalid);
});

// Removing scale-aware minima would accept illegible downscaled diagrams.
test('contained asset preserves aspect, never upscales and maps normalized anchors to output coordinates', () => {
  assert.deepEqual(containAsset(metadata(), region, definition.limits), {
    bounds: { x: 140, y: 484, width: 800, height: 400 }, scale: 1,
    minLabelSize: 34, minInformativeStroke: 3, anchors: [{ id: 'center', x: 540, y: 684 }],
  });
});
test('downscaled asset reports actual label, stroke and anchor geometry', () => {
  const source = { ...metadata(), width: 1600, height: 800, minLabelSize: 68, minInformativeStroke: 6, anchors: [{ id: 'edge', x: 1, y: 0 }] };
  assert.deepEqual(containAsset(source, { x: 100, y: 200, width: 800, height: 500 }, definition.limits), {
    bounds: { x: 100, y: 250, width: 800, height: 400 }, scale: 0.5,
    minLabelSize: 34, minInformativeStroke: 3, anchors: [{ id: 'edge', x: 900, y: 250 }],
  });
});
test('semantic asset rejects first output pixel or readability value below candidate minima', () => {
  for (const source of [
    { ...metadata(), width: 719 }, { ...metadata(), height: 359 },
    { ...metadata(), minLabelSize: 33.999 }, { ...metadata(), minInformativeStroke: 2.999 },
    { ...metadata(), width: 1600, height: 800 },
  ]) assert.throws(() => containAsset(source, region, definition.limits), exceeded);
});
test('decorative assets keep their size without semantic minima and cannot impersonate measurable diagrams', () => {
  const source = { width: 30, height: 20, semantic: false, minLabelSize: null, minInformativeStroke: null, anchors: [] };
  assert.equal(containAsset(source, region, definition.limits).scale, 1);
  assert.throws(() => containAsset({ ...metadata(), minLabelSize: null }, region, definition.limits), invalid);
  assert.throws(() => containAsset({ ...source, minLabelSize: 34 }, region, definition.limits), invalid);
});
test('asset rejects nonfinite dimensions, invalid normalized anchors and invalid scale limits', () => {
  for (const source of [
    { ...metadata(), width: 0 }, { ...metadata(), height: Infinity },
    { ...metadata(), anchors: [{ id: 'a', x: 1.001, y: 0 }] },
    { ...metadata(), anchors: [{ id: 'a', x: 0, y: -0.001 }] },
    { ...metadata(), anchors: [{ id: 'a', x: 0, y: 0 }, { id: 'a', x: 1, y: 1 }] },
  ]) assert.throws(() => containAsset(source, region, definition.limits), invalid);
  assert.throws(() => containAsset(metadata(), region, { ...definition.limits, maxRasterScale: 2 }), invalid);
});

test('surface bindings resolve only explicitly authorized token roles without color changes', () => {
  const input = theme();
  assert.deepEqual(resolveSurface(input, 'dark'), { background: '#111111', text: '#ffffff', muted: '#ffffff', accent: '#bb1100', secondaryAccent: '#0000aa' });
  assert.equal(input.background, '#ffffff');
});
test('surface resolution refuses absent bindings, unavailable roles and mismatched luminance', () => {
  const absent = theme(); delete absent.surfaceBindings;
  assert.throws(() => resolveSurface(absent, 'light'), invalid);
  for (const surface of ['sepia', undefined]) assert.throws(() => resolveSurface(theme(), surface), invalid);
  for (const binding of [undefined, { ...theme().surfaceBindings.light, accent: 'missing' }, { ...theme().surfaceBindings.light, accent: '#123456' }]) {
    const input = theme(); input.surfaceBindings.light = binding;
    assert.throws(() => resolveSurface(input, 'light'), invalid);
  }
  const input = theme(); input.surfaceBindings.dark = input.surfaceBindings.light;
  assert.throws(() => resolveSurface(input, 'dark'), exceeded);
  const dark = theme(); dark.background = '#000000';
  assert.throws(() => resolveSurface(dark, 'light'), exceeded);
});
test('contrast ratio uses linearized sRGB luminance and is symmetric', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('#abcdef', '#abcdef'), 1);
  assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.478089453577214) < 1e-12);
  assert.throws(() => contrastRatio('white', '#000000'), invalid);
});

test('rectangle helpers distinguish touching edges, containment and Euclidean nearest-edge gap', () => {
  const base = rect(10, 10, 20, 20);
  assert.equal(intersects(base, rect(30, 10, 10, 10)), false);
  assert.equal(intersects(base, rect(29.999, 10, 10, 10)), true);
  assert.equal(intersects(base, rect(20, 20, 0, 10)), false);
  assert.equal(containsBox(base, rect(10, 10, 20, 20)), true);
  assert.equal(containsBox(base, rect(10, 10, 20.000001, 20)), false);
  assert.equal(boxGap(base, rect(33, 34, 10, 10)), 5);
  assert.equal(boxGap(base, rect(20, 20, 10, 10)), 0);
  for (const helper of [boxGap, containsBox, intersects]) assert.throws(() => helper(base, rect(NaN)), invalid);
});

test('geometry accepts measured ink exactly at safe limits and minimum independent gap', () => {
  const elements = [element('one', rect(60, 60, 50, 50)), element('two', rect(134, 60, 50, 50)), element('last', rect(970, 1260, 50, 50))];
  assert.equal(assertCompositionGeometry({ elements, definition, overlaps: [] }), true);
});
test('geometry refuses each first safe-bound exceedance with no epsilon allowance', () => {
  for (const bounds of [rect(59.999, 60, 1, 1), rect(60, 59.999, 1, 1), rect(1020, 60, 0.001, 1), rect(60, 1310, 1, 0.001)]) {
    assert.throws(() => assertCompositionGeometry({ elements: [element('text', bounds)], definition, overlaps: [] }), exceeded);
  }
});
test('geometry checks individual glyph ink against the safe area and declared element bounds', () => {
  const bounds = rect(72, 192, 120, 60);
  assert.equal(assertCompositionGeometry({ elements: [element('text', bounds, 'text', [{ bounds: rect(72, 192, 20, 30) }])], definition }), true);
  for (const glyph of [rect(71.999, 192, 20, 30), rect(72, 192, 120.001, 30), rect(NaN)]) {
    assert.throws(() => assertCompositionGeometry({ elements: [element('text', bounds, 'text', [{ bounds: glyph }])], definition }), error => ['INVALID_ARGUMENT', 'COMPOSITION_LIMIT_EXCEEDED'].includes(error.code));
  }
});
test('geometry refuses independent collisions and insufficient horizontal, vertical or diagonal spacing', () => {
  const first = element('one', rect(72, 192, 100, 60));
  for (const second of [rect(171, 192, 100, 60), rect(195.999, 192, 100, 60), rect(72, 275.999, 100, 60), rect(184, 264, 100, 60)]) {
    assert.throws(() => assertCompositionGeometry({ elements: [first, element('two', second)], definition }), exceeded);
  }
});
test('geometry allows only declared qualified decoration-behind-content overlaps', () => {
  const overlap = { backElementId: 'highlight', frontElementId: 'title', purpose: 'highlight-background' };
  const candidate = { ...definition, limits: { ...definition.limits, allowedOverlaps: [overlap] } };
  const elements = [element('highlight', rect(72, 192, 120, 60), 'decoration'), element('title', rect(84, 204, 96, 36))];
  assert.equal(assertCompositionGeometry({ elements, definition: candidate, overlaps: [overlap] }), true);
  assert.throws(() => assertCompositionGeometry({ elements, definition, overlaps: [overlap] }), exceeded);
  assert.throws(() => assertCompositionGeometry({ elements, definition: candidate, overlaps: [] }), exceeded);
  assert.throws(() => assertCompositionGeometry({ elements: [...elements].reverse(), definition: candidate, overlaps: [overlap] }), exceeded);
  assert.throws(() => assertCompositionGeometry({ elements: [{ ...elements[0], kind: 'text' }, elements[1]], definition: candidate, overlaps: [overlap] }), exceeded);
});
test('geometry refuses invalid elements, duplicate IDs and nonfinite measured bounds', () => {
  for (const elements of [[element('bad', rect(Infinity))], [element('same', rect()), element('same', rect(72, 500))], [element('bad', rect(), 'unknown')]]) {
    assert.throws(() => assertCompositionGeometry({ elements, definition }), invalid);
  }
});
test('geometry ignores zero-ink glyphs for collisions and does not clip non-text decoration to text-safe bounds', () => {
  assert.equal(assertCompositionGeometry({ elements: [element('blank', rect(72, 192, 0, 0)), element('text', rect()), element('edge', rect(0, 0, 20, 20), 'decoration')], definition }), true);
  assert.throws(() => assertCompositionGeometry({ elements: [element('edge', rect(-1, 0, 20, 20), 'decoration')], definition }), exceeded);
});

test('geometry reads native text-layout inkBounds and ignores measured whitespace with null ink', () => {
  const bounds = rect(72, 192, 120, 60);
  const glyphs = [{ inkBounds: rect(72, 192, 20, 30) }, { inkBounds: null }];
  assert.equal(assertCompositionGeometry({ elements: [element('text', bounds, 'text', glyphs)], definition }), true);
  assert.throws(() => assertCompositionGeometry({ elements: [element('text', bounds, 'text', [{ inkBounds: rect(71.999, 192, 20, 30) }])], definition }), exceeded);
});

// Continuity geometry is derived from metadata and regions, never by composing neighbors.
const geometryModule = await import('../../src/render/composition-geometry.mjs');
const anchored = (...args) => {
  assert.equal(typeof geometryModule.placeAnchoredAsset, 'function', 'anchored placement must be implemented');
  return geometryModule.placeAnchoredAsset(...args);
};
const continuity = input => {
  assert.equal(typeof geometryModule.resolveContinuityGeometry, 'function', 'continuity geometry must be implemented');
  return geometryModule.resolveContinuityGeometry(input);
};
function continuityFixture() {
  const record = structuredClone(catalog.qualifications.find(q => q.definition.layoutId === 'diagram-explainer@1'));
  record.definition.continuity = {
    anchors: [{ id: 'left', regionId: 'diagram', x: 0, y: 0.5 }, { id: 'right', regionId: 'diagram', x: 1, y: 0.5 }],
    pairs: [{ id: 'shared-support', fromAnchorId: 'right', toAnchorId: 'left', semanticRoles: ['decorative', 'supporting'] }], maxPairs: 1,
  };
  const descriptor = { assetKey: 'diagram-two', metadata: { ...metadata(), anchors: [{ id: 'left', x: 0, y: 0.5 }, { id: 'right', x: 1, y: 0.5 }] } };
  const slides = Array.from({ length: 4 }, (_, index) => ({ slideIndex: index + 1, qualificationRef: { id: record.id, version: record.version },
    assets: index === 1 || index === 2 ? [{ assetKey: descriptor.assetKey, regionId: 'diagram', fit: 'contain', anchorIds: [index === 1 ? 'right' : 'left'] }] : [],
  }));
  return { plan: { slides, continuities: [{ from: 2, to: 3, assetKey: descriptor.assetKey, anchorPairId: 'shared-support', semanticRole: 'supporting' }] },
    qualifications: [record], assets: [{ descriptor, bytes: Buffer.from('opaque bytes remain untouched') }], dimensions: { width: 1080, height: 1350 } };
}
test('anchored containment places the actual asset edge at its authorized region edge without crop', () => {
  const f = continuityFixture(), source = f.assets[0].descriptor.metadata, anchors = f.qualifications[0].definition.continuity.anchors;
  const result = anchored(source, region, definition.limits, ['right'], anchors);
  assert.deepEqual(result.bounds, { x: 208, y: 484, width: 800, height: 400 });
  assert.equal(result.scale, 1);
  assert.deepEqual(result.anchors.find(a => a.id === 'right'), { id: 'right', x: 1008, y: 684 });
  assert.equal(containsBox(region, result.bounds), true);
  assert.deepEqual(anchored(source, region, definition.limits, [], anchors), containAsset(source, region, definition.limits));
});
test('anchored containment refuses absent, mismatched or inconsistent anchor constraints', () => {
  const f = continuityFixture(), source = f.assets[0].descriptor.metadata, anchors = f.qualifications[0].definition.continuity.anchors;
  for (const requested of [['unknown'], ['right', 'right'], ['left', 'right']]) assert.throws(() => anchored(source, region, definition.limits, requested, anchors), error => ['INVALID_ARGUMENT', 'COMPOSITION_LIMIT_EXCEEDED'].includes(error.code));
  assert.throws(() => anchored(source, region, definition.limits, ['right'], [{ id: 'right', regionId: 'other', x: 1, y: 0.5 }]), invalid);
  const centeredAnchor = { ...source, anchors: [{ id: 'right', x: 0.5, y: 0.5 }] };
  assert.throws(() => anchored(centeredAnchor, region, definition.limits, ['right'], anchors), exceeded);
  assert.throws(() => anchored({ ...source, anchors: [] }, region, definition.limits, ['right'], anchors), invalid);
});
test('consistent multiple anchor constraints preserve the full semantic raster', () => {
  const f = continuityFixture(), source = f.assets[0].descriptor.metadata;
  const target = { id: 'diagram', x: 72, y: 432, width: 800, height: 504 };
  const result = anchored(source, target, definition.limits, ['left', 'right'], f.qualifications[0].definition.continuity.anchors);
  assert.deepEqual(result.bounds, { x: 72, y: 484, width: 800, height: 400 });
});
test('continuity resolves original world indices and connected local seam endpoints', () => {
  const f = continuityFixture(), before = structuredClone(f), result = continuity(f);
  assert.deepEqual(result, [{ ...f.plan.continuities[0], fromPoint: { x: 2088, y: 684 }, toPoint: { x: 2232, y: 684 }, segments: [
    { slideIndex: 2, x1: 1008, y1: 684, x2: 1080, y2: 684, bounds: { x: 1008, y: 682.5, width: 72, height: 3 } },
    { slideIndex: 3, x1: 0, y1: 684, x2: 72, y2: 684, bounds: { x: 0, y: 682.5, width: 72, height: 3 } },
  ] }]);
  assert.deepEqual(f, { ...before, assets: before.assets.map((a, i) => ({ ...a, bytes: f.assets[i].bytes })) });
  assert.deepEqual(continuity({ ...f, plan: { ...f.plan, continuities: [] } }), []);
});
test('diagonal continuity clips a single world line at the exact seam without rasterizing another slide', () => {
  const f = continuityFixture(), q = f.qualifications[0];
  q.definition.continuity.anchors[0].y = 0.6;
  const result = continuity(f)[0], [left, right] = result.segments;
  assert.equal(left.x2, 1080); assert.equal(right.x1, 0);
  assert.equal(left.y2, right.y1);
  assert.equal(left.y1, result.fromPoint.y); assert.equal(right.y2, result.toPoint.y);
  assert.equal(left.y2, (result.fromPoint.y + result.toPoint.y) / 2);
  assert.equal(result.toPoint.y, 432 + 504 * 0.6);
  assert.ok(left.bounds.height > 3);
  assert.ok(left.bounds.x + left.bounds.width <= 1080);
  assert.ok(right.bounds.x >= 0);
});
test('continuity blocks essential roles, missing placements and undeclared or wrong candidate pairs', () => {
  const variants = [
    f => { f.plan.continuities[0].semanticRole = 'essential'; },
    f => { f.plan.continuities[0].anchorPairId = 'unknown'; },
    f => { f.plan.continuities[0].to = 4; },
    f => { f.plan.slides[2].assets = []; },
    f => { f.plan.slides[2].assets[0].anchorIds = ['right']; },
    f => { f.qualifications[0].definition.continuity.pairs[0].semanticRoles = ['decorative']; },
    f => { f.assets[0].descriptor.metadata.anchors.pop(); },
    f => { f.qualifications[0].definition.continuity.maxPairs = 0; },
  ];
  for (const mutate of variants) { const f = continuityFixture(); mutate(f); assert.throws(() => continuity(f), error => ['INVALID_ARGUMENT', 'COMPOSITION_LIMIT_EXCEEDED'].includes(error.code)); }
});

test('highlight surfaces enforce the exact twelve-pixel text-ink inset despite declared overlap', () => {
  const overlap = { backElementId: 'highlight', frontElementId: 'title', purpose: 'highlight-background' };
  const candidate = { ...definition, limits: { ...definition.limits, allowedOverlaps: [overlap] } };
  const back = element('highlight', rect(72, 192, 120, 60), 'decoration');
  for (const ink of [rect(83.999, 204, 96, 36), rect(84, 203.999, 96, 36), rect(84, 204, 96.001, 36), rect(84, 204, 96, 36.001)]) {
    assert.throws(() => assertCompositionGeometry({ elements: [back, element('title', ink)], definition: candidate, overlaps: [overlap] }), exceeded);
  }
  assert.equal(assertCompositionGeometry({ elements: [back, element('title', rect(84, 204, 96, 36))], definition: candidate, overlaps: [overlap] }), true);
});
test('decorative underlay does not invent a text-surface inset requirement', () => {
  const overlap = { backElementId: 'underlay', frontElementId: 'title', purpose: 'decorative-underlay' };
  const candidate = { ...definition, limits: { ...definition.limits, allowedOverlaps: [overlap] } };
  assert.equal(assertCompositionGeometry({ elements: [element('underlay', rect(), 'decoration'), element('title', rect(80, 200, 100, 30))], definition: candidate, overlaps: [overlap] }), true);
});
test('continuity accepts the same portable asset keys as the composition contract',()=>{
 const f=continuityFixture(),key='Diagrama_2 ação';f.assets[0].descriptor.assetKey=key;f.plan.continuities[0].assetKey=key;for(const slide of f.plan.slides)for(const placement of slide.assets)placement.assetKey=key;
 assert.equal(continuity(f)[0].assetKey,key);
});
