import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const runner = await import('../../verification/layout-qualification-runner.mjs').catch(() => ({}));
const expectedLayouts = [
  'cover-editorial@1',
  'content-flow@1',
  'content-dense@1',
  'diagram-explainer@1',
  'cta-editorial@1',
];

test('qualification runner writes real review pixels without manufacturing human approval', async () => {
  assert.equal(typeof runner.runLayoutQualification, 'function', 'qualification runner is required');
  const root = await mkdtemp(path.join(tmpdir(), 'peterson-layout-qualification '));
  try {
    const references = {};
    for (const [key, fileName, color] of [
      ['cover', 'capa.png', '#F3F0E8'],
      ['interior', 'interna.png', '#191919'],
    ]) {
      const filePath = path.join(root, fileName);
      await writeFile(filePath, await sharp({ create: { width: 1080, height: 1350, channels: 4, background: color } }).png().toBuffer());
      references[key] = { libraryFileId: `test-${key}`, fileName, filePath, purpose: `approved-v2-${key}-reference` };
    }
    const catalogUrl = new URL('../../shared/layouts/editorial-composed-v1.json', import.meta.url);
    const beforeCatalog = await readFile(catalogUrl);
    const outputRoot = path.join(root, 'bundle');
    const result = await runner.runLayoutQualification({ outputRoot, references });
    assert.equal(result.status, 'pending-human-review');
    assert.equal(result.layoutCount, 5);
    assert.equal(result.objectiveResult, 'not-verified');
    assert.deepEqual(await readFile(catalogUrl), beforeCatalog, 'candidate catalog must remain untouched');

    const fixture = JSON.parse(await readFile(path.join(outputRoot, 'qualification-fixture.json'), 'utf8'));
    const metrics = JSON.parse(await readFile(path.join(outputRoot, 'qualification-metrics.json'), 'utf8'));
    const objective = JSON.parse(await readFile(path.join(outputRoot, 'objective-report.json'), 'utf8'));
    const review = JSON.parse(await readFile(path.join(outputRoot, 'review-request.json'), 'utf8'));
    assert.deepEqual(fixture.layouts.map(layout => layout.layoutId), expectedLayouts);
    assert.ok(fixture.layouts.every(layout => layout.status === 'candidate' && layout.release === null));
    assert.deepEqual(fixture.layouts.map(layout => layout.version), [2, 2, 1, 1, 1]);
    assert.deepEqual(fixture.references.map(reference => reference.libraryFileId), ['test-cover', 'test-interior']);
    assert.equal(metrics.layouts.length, 5);
    assert.equal(objective.result, 'not-verified');
    assert.ok(objective.checks.some(check => check.result === 'not-verified'));
    assert.equal(objective.checks.some(check => check.result === 'failed'), false);
    assert.equal(Object.hasOwn(objective, 'approved'), false);
    assert.equal(review.status, 'pending-human-review');
    assert.equal(review.method, 'human-local-assisted@1');
    assert.deepEqual(review.visualAssessment.referenceLibraryFileIds, ['test-cover', 'test-interior']);
    assert.deepEqual(review.visualAssessment.improvements.map(item => item.id), [
      'cover-editorial-structure',
      'content-flow-structure',
      'modular-diagram-density',
    ]);
    assert.deepEqual(review.visualAssessment.blockers.map(item => item.id), ['serif-italic-font-unavailable']);
    assert.match(review.visualAssessment.blockers[0].reason, /not authorized/i);
    for (const forbidden of ['reviewer', 'receipt', 'verdict', 'reviewedAt']) assert.equal(Object.hasOwn(review, forbidden), false);

    const coverElements = metrics.layouts[0].scene.elements;
    const flowElements = metrics.layouts[1].scene.elements;
    assert.equal(coverElements.filter(element => element.kind === 'asset').length, 1);
    assert.ok(coverElements.some(element => element.kind === 'decoration'));
    assert.equal(flowElements.filter(element => element.kind === 'asset').length, 1);
    const flowBody = flowElements.find(element => element.source?.field === 'body');
    assert.match(flowBody.sourceText, /^01[\s\S]+\n\n02[\s\S]+\n\n03/);
    assert.ok(flowBody.lines.length >= 5);
    assert.ok(flowElements.some(element => element.kind === 'decoration'));

    for (let index = 1; index <= 5; index++) {
      const full = await sharp(path.join(outputRoot, 'full', `${String(index).padStart(2, '0')}.png`)).metadata();
      const mobile = await sharp(path.join(outputRoot, 'mobile', `${String(index).padStart(2, '0')}.png`)).metadata();
      assert.deepEqual([full.width, full.height], [1080, 1350]);
      assert.deepEqual([mobile.width, mobile.height], [360, 450]);
    }
    const panorama = await sharp(path.join(outputRoot, 'panorama.png')).metadata();
    const panoramaMobile = await sharp(path.join(outputRoot, 'panorama-360.png')).metadata();
    const coverComparison = await sharp(path.join(outputRoot, 'review', 'compare-cover.png')).metadata();
    const interiorComparison = await sharp(path.join(outputRoot, 'review', 'compare-interior.png')).metadata();
    const diagramComparison = await sharp(path.join(outputRoot, 'review', 'compare-diagram.png')).metadata();
    assert.deepEqual([panorama.width, panorama.height], [5400, 1350]);
    assert.deepEqual([panoramaMobile.width, panoramaMobile.height], [1800, 450]);
    assert.deepEqual([coverComparison.width, coverComparison.height], [720, 450]);
    assert.deepEqual([interiorComparison.width, interiorComparison.height], [720, 450]);
    assert.deepEqual([diagramComparison.width, diagramComparison.height], [720, 450]);

    const diagram = await sharp(path.join(outputRoot, 'full', '04.png'))
      .extract({ left: 72, top: 432, width: 936, height: 504 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    let orangePixels = 0;
    let creamPixels = 0;
    for (let offset = 0; offset < diagram.length; offset += 4) {
      const [red, green, blue, alpha] = diagram.subarray(offset, offset + 4);
      if (alpha > 0 && red >= 180 && green >= 50 && green <= 155 && blue <= 100) orangePixels += 1;
      if (alpha > 0 && red >= 225 && green >= 215 && blue >= 195) creamPixels += 1;
    }
    assert.ok(orangePixels >= 5_000, `expected modular orange layers, got ${orangePixels} pixels`);
    assert.ok(creamPixels >= 5_000, `expected modular cream layers, got ${creamPixels} pixels`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
