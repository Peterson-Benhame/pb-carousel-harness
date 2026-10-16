import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { assertQualifiedLayout, LAYOUT_IDS, validateLayoutQualification } from '../../src/domain/layout-qualification.mjs';
const catalog = JSON.parse(await readFile(new URL('../../shared/layouts/editorial-composed-v1.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
const candidate = () => clone(catalog.qualifications[0]);

function edited(edit) {
  const record = candidate();
  edit(record);
  record.definitionHash = canonicalHash(record.definition);
  return record;
}
const invalid = action => assert.throws(action, {
  code: 'INVALID_ARGUMENT'
});

function assertFrozen(value) {
  if (value && typeof value === 'object') {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) assertFrozen(child);
  }
}

test('catalog contains exactly five closed, unqualified editorial candidates and no invented checker hashes', () => {
  assert.deepEqual(Object.keys(catalog).sort(), ['id', 'qualifications', 'rendererId', 'schemaVersion']);
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.rendererId, 'editorial-composed@1');
  assert.deepEqual(catalog.qualifications.map(record => record.definition.layoutId).sort(), [...LAYOUT_IDS].sort());
  assert.equal(catalog.qualifications.length, 5);
  for (const record of catalog.qualifications) {
    const result = validateLayoutQualification(record);
    assert.equal(result.status, 'candidate');
    assert.equal(result.release, null);
    assert.deepEqual(result.evidenceRefs, []);
    assert.equal(result.definition.checkerRef, null);
    assert.equal(result.definition.rubricRef, null);
    assert.equal(result.definitionHash, canonicalHash(result.definition));
    assert.equal(result.id, `qualification-${result.definition.layoutId}`);
    assert.throws(() => assertQualifiedLayout(result), {
      code: 'LAYOUT_NOT_QUALIFIED'
    });
    assertFrozen(result);
    assert.notEqual(result, record);
  }
});

test('candidate geometry and typography preserve every Q01 variant ceiling', () => {
  const expected = {
    'cover-editorial@1': {
      title: [72, 192, 936, 600, 72, 176, 1.06, 4],
      body: [72, 840, 936, 354, 34, 44, 1.25, 7],
      total: 7
    },
    'content-flow@1': {
      title: [72, 192, 936, 240, 54, 112, 1.10, 3],
      body: [72, 480, 936, 714, 34, 44, 1.28, 15],
      total: 15
    },
    'content-dense@1': {
      title: [72, 192, 936, 168, 54, 72, 1.10, 2],
      'body-left': [72, 408, 444, 786, 34, 38, 1.28, 16],
      'body-right': [564, 408, 444, 786, 34, 38, 1.28, 16],
      total: 30
    },
    'diagram-explainer@1': {
      title: [72, 192, 936, 192, 54, 88, 1.10, 3],
      body: [72, 984, 936, 210, 34, 40, 1.25, 4],
      total: 4
    },
    'cta-editorial@1': {
      title: [72, 240, 936, 288, 64, 112, 1.10, 3],
      body: [72, 576, 936, 528, 36, 48, 1.25, 8],
      total: 8
    },
  };
  for (const {
    definition: definition
  }
  of catalog.qualifications) {
    assert.deepEqual(definition.dimensions, {
      width: 1080,
      height: 1350
    });
    assert.deepEqual(definition.limits.safeTextBounds, {
      x: 60,
      y: 60,
      width: 960,
      height: 1250
    });
    assert.equal(definition.limits.minBlockGap, 24);
    assert.equal(definition.limits.minSurfaceInset, 12);
    assert.equal(definition.limits.minTextContrast, 4.5);
    assert.equal(definition.limits.minInformativeContrast, 3);
    assert.equal(definition.limits.maxClippedGlyphs, 0);
    assert.equal(definition.limits.maxUndeclaredCollisions, 0);
    assert.equal(definition.limits.maxBlockOccupancy, 1);
    assert.equal(definition.limits.maxRasterScale, 1);
    assert.equal(definition.limits.minDiagramLabelSize, 34);
    assert.equal(definition.limits.minInformativeStroke, 3);
    assert.equal(definition.limits.totalBodyLines, expected[definition.layoutId].total);
    for (const [id, want] of Object.entries(expected[definition.layoutId])) {
      if (id === 'total') continue;
      const region = definition.regions.find(r => r.id === id),
      rule = definition.limits.textRegions.find(r => r.regionId === id);
      const style = definition.styles.find(s => s.id ===(id === 'title' ? 'title': 'body'));
      assert.deepEqual([region.x, region.y, region.width, region.height, style.sizeMin, style.sizeMax, style.lineHeight, rule.maxLines],
        want);
    }
    const eyebrow = definition.regions.find(r => r.id === 'eyebrow'),
    logo = definition.regions.find(r => r.id === 'logo'),
    signature = definition.regions.find(r => r.id === 'signature');
    assert.deepEqual([eyebrow.x, eyebrow.y, eyebrow.width, eyebrow.height], [72, 64, 648, 96]);
    assert.deepEqual([logo.x, logo.y, logo.width, logo.height], [756, 64, 240, 80]);
    assert.deepEqual([signature.x, signature.y, signature.width, signature.height], [72, 1242, 936, 60]);
    assert.equal(definition.limits.logoProtection, 12);
    assert.equal(definition.limits.minLogoHeight, 24);
    assert.equal(definition.limits.maxSignatureLines, 1);
    assert.equal(definition.styles.find(s => s.id === 'signature').sizeMin, 24);
    assert.ok(definition.limits.textRegions.every(r => r.fields.every(field => ['eyebrow', 'title', 'body'].includes(field))));
  }
  const diagram = catalog.qualifications.find(record => record.definition.layoutId === 'diagram-explainer@1').definition;
  const asset = diagram.regions.find(r => r.id === 'diagram');
  assert.deepEqual([asset.x, asset.y, asset.width, asset.height], [72, 432, 936, 504]);
  assert.equal(diagram.limits.minAssetWidth, 720);
  assert.equal(diagram.limits.minAssetHeight, 360);
});

test('catalog offers only exact Anton/Manrope bindings without implicit Nimbus', () => {
  for (const {
    definition: definition
  }
  of catalog.qualifications) {
    assert.deepEqual([...new Set(definition.fontBindings.map(b => b.fontId))].sort(), ['Anton', 'Manrope']);
    assert.ok(definition.styles.every(s => definition.fontBindings.some(b => b.role === s.fontRole && b.weight === s.weight)));
    assert.ok(definition.fontBindings.every(b => b.role !== 'accent'));
    assert.equal(definition.styles.find(s => s.id === 'eyebrow').sizeMin, 30);
  }
});

test('validation does not mutate input and deeply freezes copied output', () => {
  const record = candidate();
  const before = clone(record);
  const result = validateLayoutQualification(record);
  assert.deepEqual(record, before);
  assertFrozen(result);
  record.definition.regions[0].x = 1;
  assert.equal(result.definition.regions[0].x, 72);
  assert.throws(() => {
    result.definition.fontBindings[0].axes.wght = 800;
  }, TypeError);
});

for (const [label, mutate] of [
  ['unknown root key', record => record.approved = true],
  ['unknown definition key', record => record.definition.svg = '<svg/>'],
  ['unknown region key', record => record.definition.regions[0].css = 'x'],
  ['unknown style key', record => record.definition.styles[0].fontPath = '/x'],
  ['unknown limits key', record => record.definition.limits.auto = true],
  ['unknown rule key', record => record.definition.limits.textRegions[0].expression = 'x'],
  ['unknown font key', record => record.definition.fontBindings[0].url = 'file:///x'],
  ['unknown axis', record => record.definition.fontBindings.find(b => b.fontId === 'Manrope').axes.slnt = 10],
  ['unsupported resource id', record => record.id = 'unlisted@1'],
  ['unsupported layout', record => record.definition.layoutId = 'free-form@1'],
  ['unsupported renderer', record => record.definition.rendererId = 'legacy-panorama@1'],
  ['unsupported surface', record => record.definition.surfaces = ['automatic']],
  ['unsupported field', record => record.definition.limits.textRegions[0].fields = ['code']],
  ['unknown region mapping', record => record.definition.limits.textRegions[0].regionId = 'missing'],
  ['unknown style mapping', record => record.definition.limits.textRegions[0].styleIds = ['missing']],
  ['brand as text', record => record.definition.limits.textRegions[0].regionId = 'logo'],
  ['duplicate region', record => record.definition.regions.push(clone(record.definition.regions[0]))],
  ['duplicate style', record => record.definition.styles.push(clone(record.definition.styles[0]))],
  ['duplicate reading order', record => record.definition.regions[1].readingOrder = record.definition.regions[0].readingOrder],
  ['negative geometry', record => record.definition.regions[0].x = -1],
  ['outside canvas', record => record.definition.regions[0].width = 2000],
  ['unbounded text', record => record.definition.limits.textRegions[0].maxLines = 0],
  ['three columns', record => record.definition.limits.maxColumns = 3],
  ['semantic assets above ceiling', record => record.definition.limits.maxSemanticAssets = 2],
  ['overlaps above ceiling', record => record.definition.limits.maxOverlaps = 3],
  ['body too small', record => record.definition.styles.find(s => s.id === 'body').sizeMin = 33],
  ['body line-height too low', record => record.definition.styles.find(s => s.id === 'body').lineHeight = 1.24],
  ['reversed size range', record => record.definition.styles.find(s => s.id === 'title').sizeMin = 999],
  ['unbound style weight', record => record.definition.styles.find(s => s.id === 'body').weight = 700],
  ['wrong font hash', record => record.definition.fontBindings[0].sha256 = 'a'.repeat(64)],
  ['wrong font role', record => record.definition.fontBindings[0].role = 'accent'],
  ['wrong static weight', record => record.definition.fontBindings.find(b => b.fontId === 'Anton').weight = 700],
  ['synthetic italic', record => record.definition.fontBindings.find(b => b.fontId === 'Manrope').style = 'italic'],
  ['axis differs from weight', record => record.definition.fontBindings.find(b => b.fontId === 'Manrope').axes.wght = 800],
  ['candidate released', record => record.release = {}],
  ['self certified', record => record.status = 'qualified'],
  ['candidate evidence', record => record.evidenceRefs = [{}]],
  ['unknown anchor region', record => record.definition.continuity.anchors = [{
    id: 'a',
    regionId: 'absent',
    x: 0,
    y: 0
  }]],
  ['unknown overlap element', record => {
    record.definition.limits.maxOverlaps = 1;
    record.definition.limits.allowedOverlaps = [{
      backElementId: 'x',
      frontElementId: 'title',
      purpose: 'highlight-background'
    }];
  }]
]) test(`reject ${label}`, () => invalid(() => validateLayoutQualification(edited(mutate))));

test('stale definition hash and non-canonical JSON are rejected without executing getters', () => {
  const record = candidate();
  record.definition.regions[0].x++;
  assert.throws(() => validateLayoutQualification(record), {
    code: 'ARTIFACT_HASH_MISMATCH'
  });
  for (const value of [NaN, Infinity, () => 1, undefined]) {
    const record = candidate();
    record.definition.regions[0].x = value;
    assert.throws(() => validateLayoutQualification(record));
  }
  let called = false;
  const withGetter = candidate();
  Object.defineProperty(withGetter.definition, 'html', {
    enumerable: true,
    get() {
      called = true;
      return '<script/>';
    }
  });
  assert.throws(() => validateLayoutQualification(withGetter), {
    code: 'INVALID_JSON_VALUE'
  });
  assert.equal(called, false);
  const cyc = candidate();
  cyc.definition.cycle = cyc;
  assert.throws(() => validateLayoutQualification(cyc), {
    code: 'INVALID_JSON_VALUE'
  });
});

test('the standalone schema closes every declared object and has explicit status/ref branches', async() => {
  const schema = JSON.parse(await readFile(new URL('../../shared/layout-qualification.schema.json', import.meta.url), 'utf8'));
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'object') assert.equal(value.additionalProperties, false);
    for (const child of Object.values(value)) walk(child);
  };
  walk(schema);
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.ok(schema.allOf.length >= 2);
});

function syntheticRelease(status = 'qualified') {
  const record = candidate();
  record.version = 2;
  record.status = status;
  record.definition.checkerRef = {
    id: 'editorial-objective-checkers@1',
    version: 1,
    sha256: 'a'.repeat(64)
  };
  record.definition.rubricRef = {
    id: 'editorial-quality@1',
    version: 1,
    sha256: 'b'.repeat(64)
  };
  record.definitionHash = canonicalHash(record.definition);
  record.evidenceRefs = ['qualification-fixture', 'qualification-metrics', 'qualification-review'].map(kind => ({
    id: `${kind}-${record.definition.layoutId}`,
    version: 1,
    sha256: 'c'.repeat(64),
    kind
  }));
  record.release = {
    decisionId: '00000000-0000-4000-8000-000000000001',
    decidedAt: '2026-10-16T00:00:00.000Z',
    reviewEvidenceRef: clone(record.evidenceRefs[2]),
    qualifiedEnvironments: status === 'qualified' ? [{
      platform: 'linux',
      arch: 'x64',
      node: 'v24.21.0',
      abi: '137',
      napi: '10',
      dependenciesHash: 'd'.repeat(64),
      rendererHash: 'e'.repeat(64),
      fontBindingsHash: canonicalHash(record.definition.fontBindings)
    }]: []
  };
  return record;
}

test('well-formed synthetic release data is structural only, never a production grant', () => {
  for (const status of ['qualified', 'rejected']) {
    const record = syntheticRelease(status);
    assert.equal(validateLayoutQualification(record).status, status);
    assert.throws(() => assertQualifiedLayout(record), {
      code: 'LAYOUT_NOT_QUALIFIED'
    });
    for (const key of ['checkerRef', 'rubricRef']) {
      const pending = clone(record);
      pending.definition[key] = null;
      pending.definitionHash = canonicalHash(pending.definition);
      invalid(() => validateLayoutQualification(pending));
    }
  }
});

test('pending Q06 references cannot be filled without changing the examined definition identity', () => {
  const record = candidate(),
  priorHash = record.definitionHash;
  record.definition.checkerRef = {
    id: 'editorial-objective-checkers@1',
    version: 1,
    sha256: 'a'.repeat(64)
  };
  record.definition.rubricRef = {
    id: 'editorial-quality@1',
    version: 1,
    sha256: 'b'.repeat(64)
  };
  assert.throws(() => validateLayoutQualification(record), {
    code: 'ARTIFACT_HASH_MISMATCH'
  });
  record.version = 2;
  record.definitionHash = canonicalHash(record.definition);
  assert.notEqual(record.definitionHash, priorHash);
  assert.equal(validateLayoutQualification(record).status, 'candidate');
  assert.throws(() => assertQualifiedLayout(record), {
    code: 'LAYOUT_NOT_QUALIFIED'
  });
});

for (const [label, mutate] of [
  ['unknown release field', record => record.release.approved = true],
  ['unknown evidence field', record => record.evidenceRefs[0].brandId = 'private'],
  ['unknown environment field', record => record.release.qualifiedEnvironments[0].fontPath = '/private'],
  ['missing inspection evidence', record => record.evidenceRefs.pop()],
  ['unlisted evidence identity', record => record.evidenceRefs[0].id = 'private-run@1'],
  ['no qualified environment', record => record.release.qualifiedEnvironments = []],
  ['stale environment bindings', record => record.release.qualifiedEnvironments[0].fontBindingsHash = 'a'.repeat(64)],
  ['unbounded generic platform', record => record.release.qualifiedEnvironments[0].platform = 'Windows'],
  ['malformed UTC instant', record => record.release.decidedAt = '2026-99-99T00:00:00.000Z'],
  ['future unknown checker id', record => record.definition.checkerRef.id = 'any-checker@1']
]) test(`reject release ${label}`, () => {
  const record = syntheticRelease();
  mutate(record);
  record.definitionHash = canonicalHash(record.definition);
  invalid(() => validateLayoutQualification(record));
});

test('optional Nimbus identity requires explicit exact italic binding and matching title span style', () => {
  const record = edited(record => {
    record.definition.fontBindings.push({
      role: 'accent',
      fontId: 'nimbus-roman-italic@1',
      sha256: 'b7c424e6cb79baddfcdcd9a9d87f9fc4fdd06f0e5160066e2b2e47bcd647c7b9',
      style: 'italic',
      weight: 400,
      axes: {}
    });
    record.definition.styles.push({
      ...clone(record.definition.styles.find(s => s.id === 'title')),
      id: 'title-accent',
      fontRole: 'accent',
      colorToken: 'accent'
    });
    record.definition.limits.textRegions.find(r => r.regionId === 'title').styleIds.push('title-accent');
    record.definition.styles.sort((a, b) => a.id < b.id ? - 1: a.id > b.id ? 1: 0);
    record.definition.limits.textRegions.find(r => r.regionId === 'title').styleIds.sort();
  });
  assert.equal(validateLayoutQualification(record).definition.fontBindings.at(-1).fontId, 'nimbus-roman-italic@1');
  assert.throws(() => assertQualifiedLayout(record), {
    code: 'LAYOUT_NOT_QUALIFIED'
  });
  for (const mutate of [record => record.definition.fontBindings.at(-1).sha256 = 'f'.repeat(64), record => record.definition.fontBindings.at(-1).style = 'normal',
    record => record.definition.fontBindings.at(-1).weight = 700, record => record.definition.fontBindings.at(-1).axes = {
    slnt: - 15.5
  }]) {
    const invalidBinding = clone(record);
    mutate(invalidBinding);
    invalidBinding.definitionHash = canonicalHash(invalidBinding.definition);
    invalid(() => validateLayoutQualification(invalidBinding));
  }
});

function syntheticDecoration() {
  return edited(record => {
    record.definition.regions.push({
      id: 'title-underlay',
      x: 72,
      y: 192,
      width: 936,
      height: 600,
      kind: 'decoration',
      readingOrder: 6
    });
    record.definition.continuity = {
      anchors: [{
        id: 'left',
        regionId: 'title-underlay',
        x: 0,
        y: 0.5
      }, {
        id: 'right',
        regionId: 'title-underlay',
        x: 1,
        y: 0.5
      }],
      pairs: [{
        id: 'horizontal',
        fromAnchorId: 'right',
        toAnchorId: 'left',
        semanticRoles: ['decorative']
      }],
      maxPairs: 1
    };
    record.definition.limits.allowedOverlaps = [{
      backElementId: 'title-underlay',
      frontElementId: 'title',
      purpose: 'highlight-background'
    }];
    record.definition.decorationOptions = [{
      id: 'underlay-hidden',
      elementId: 'title-underlay',
      anchorId: 'left',
      offsetX: 0,
      offsetY: 0,
      visible: false
    }];
  });
}

test('closed structural anchors, overlap purposes and decoration choices remain candidates', () => {
  const record = syntheticDecoration();
  assertFrozen(validateLayoutQualification(record));
  assert.throws(() => assertQualifiedLayout(record), {
    code: 'LAYOUT_NOT_QUALIFIED'
  });
});

for (const [label, mutate] of [
  ['out-of-range normalized anchor', record => record.definition.continuity.anchors[0].x = 1.01],
  ['anchor metadata extra', record => record.definition.continuity.anchors[0].transform = 'rotate(30)'],
  ['unknown pair anchor', record => record.definition.continuity.pairs[0].toAnchorId = 'absent'],
  ['essential crossing', record => record.definition.continuity.pairs[0].semanticRoles = ['essential']],
  ['pair beyond explicit ceiling', record => record.definition.continuity.maxPairs = 0],
  ['hidden brand', record => record.definition.limits.allowedOverlaps[0].frontElementId = 'logo'],
  ['arbitrary overlap purpose', record => record.definition.limits.allowedOverlaps[0].purpose = 'intentional'],
  ['text as underlay', record => record.definition.limits.allowedOverlaps[0].backElementId = 'eyebrow'],
  ['unknown decoration anchor', record => record.definition.decorationOptions[0].anchorId = 'absent'],
  ['semantic decoration', record => record.definition.decorationOptions[0].elementId = 'title'],
  ['free correction offset', record => record.definition.decorationOptions[0].offsetX = 13]
]) test(`reject continuity/overlap ${label}`, () => {
  const record = syntheticDecoration();
  mutate(record);
  record.definitionHash = canonicalHash(record.definition);
  invalid(() => validateLayoutQualification(record));
});

test('malformed nested entries fail with sanitized public diagnostics', () => {
  for (const mutate of [record => record.definition.regions[0] = null, record => record.definition.styles[0] = null, record => record.definition.limits.textRegions[0] = null,
    record => record.definition.continuity.anchors = [null]]) {
    invalid(() => validateLayoutQualification(edited(mutate)));
  }
});

test('unordered semantic sets cannot create alternate definition identities', () => {
  for (const mutate of [record => record.definition.surfaces.reverse(), record => record.definition.styles.reverse(), record => record.definition.fontBindings.reverse(),
    record => record.definition.limits.textRegions.find(r => r.regionId === 'title').styleIds.reverse()]) {
    invalid(() => validateLayoutQualification(edited(mutate)));
  }
  const record = clone(catalog.qualifications.find(record => record.definition.layoutId === 'content-flow@1'));
  record.definition.roles.reverse();
  record.definitionHash = canonicalHash(record.definition);
  invalid(() => validateLayoutQualification(record));
});
