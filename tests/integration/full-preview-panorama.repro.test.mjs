import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { qualityServiceFixture } from '../helpers/quality-service-fixture.mjs';
import { renderedQualityFixture } from '../helpers/quality-render-fixture.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { sha256 } from '../../src/infrastructure/resources.mjs';

async function alteredPanorama(image) {
  const raster = await sharp(image.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  raster.data[0] ^= 1;
  const png = await sharp(raster.data, { raw: { width: raster.info.width, height: raster.info.height, channels: 4 } }).png().toBuffer();
  return { ...image, png, sha256: sha256(png), rgbaSha256: sha256(await sharp(png).ensureAlpha().raw().toBuffer()) };
}

test('full-slide preview remains eligible for Q06 editorial review', async t => {
  const f = await qualityServiceFixture(t, { render: false, previewAll: true });
  const render = await (await f.from('src/application/stages/render-stage.mjs')).createRenderStage({
    root: f.root, db: f.db, packageRoot: f.packageRoot,
  });
  const preview = await render.execute({ requestId: randomUUID(), ...f.scope, kind: 'preview' });
  const manifestPath = (await f.inputs.resolveArtifact(f.scope.brandId, f.scope.runId, preview.manifestRef.id)).path;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.deepEqual(manifest.selection.slideIndices, [1, 2, 3]);
  assert.equal(manifest.files.some(file => file.role === 'panorama'), false);
  const view = await f.gate.inspectRendered({ ...f.scope, kind: 'preview', manifestId: preview.manifestRef.id });
  assert.equal(view.composition.selection.allSlides, true);
  assert.equal(view.composition.panorama, null);
  const objective = await (await f.from('src/quality/objective-checks.mjs')).evaluateRenderedQuality({
    manifest: view.manifest, composition: view.composition, files: view.files,
    qualification: view.resource.qualifications,
  });
  assert.equal(objective.result, 'passed');
  const pending = await f.service.request({ requestId: randomUUID(), ...f.scope, kind: 'preview', manifestId: preview.manifestRef.id });
  assert.equal(pending.status, 'pending');
});

test('final panorama remains required by Q06 after the preview correction', async () => {
  const { input } = await renderedQualityFixture({ selection: 'all' });
  const { evaluateRenderedQuality } = await import('../../src/quality/objective-checks.mjs');
  const clean = await evaluateRenderedQuality(input);
  assert.notEqual(clean.result, 'failed');
  const original = input.composition.panorama;
  input.composition.panorama = null;
  const missing = await evaluateRenderedQuality(input);
  assert.equal(missing.result, 'failed');
  assert.ok(missing.checks.some(check => check.result === 'failed' && check.expected === 'rendered PNG and RGBA derived from original glyphs and assets'));
  input.composition.panorama = await alteredPanorama(original);
  const forged = await evaluateRenderedQuality(input);
  assert.equal(forged.result, 'failed');
  assert.ok(forged.checks.some(check => check.result === 'failed' && check.expected === 'rendered PNG and RGBA derived from original glyphs and assets'));
});

test('an in-memory preview panorama remains byte verified when present', async () => {
  const { input } = await renderedQualityFixture({ selection: 'all' });
  const panorama = input.manifest.files.find(file => file.role === 'panorama');
  input.manifest.files = input.manifest.files.filter(file => file !== panorama);
  input.files = input.files.filter(file => file.id !== panorama.artifactRef.id);
  input.manifest.kind = 'preview';
  input.manifest.selection.policyId = 'representative-risk@1';
  input.manifest.selectionHash = canonicalHash(input.manifest.selection);
  const { evaluateRenderedQuality } = await import('../../src/quality/objective-checks.mjs');
  const valid = await evaluateRenderedQuality(input);
  assert.equal(valid.checks.some(check => check.result === 'failed'), false);
  input.composition.panorama = await alteredPanorama(input.composition.panorama);
  const altered = await evaluateRenderedQuality(input);
  assert.equal(altered.result, 'failed');
  assert.ok(altered.checks.some(check => check.result === 'failed' && check.expected === 'rendered PNG and RGBA derived from original glyphs and assets'));
});
