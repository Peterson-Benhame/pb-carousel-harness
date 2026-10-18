import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { sha256 } from '../../src/infrastructure/resources.mjs';

const module = await import('../../verification/value-proposition-preview.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const run = input => {
  assert.equal(typeof module.runValuePropositionPreview, 'function', 'value proposition preview runner is required');
  return module.runValuePropositionPreview(input);
};
const slide = Object.freeze({
  index: 8,
  eyebrow: 'PROPOSTA DE VALOR',
  title: 'Escreva a promessa em uma frase',
  body: 'Para [cliente], nossa [categoria de solução] entrega [benefício principal] por meio de [como fazemos isso].\nUse números no benefício somente quando houver evidência.',
});

test('writes one traceable 08/12 preview from the approved value proposition copy', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'peterson-value-proposition '));
  const outputRoot = path.join(parent, 'preview');
  try {
    const result = await run({ outputRoot, slide, totalSlides: 12 });
    assert.deepEqual(result, {
      status: 'pending-human-review',
      slideIndex: 8,
      totalSlides: 12,
      outputRoot,
      image: 'preview-08-proposta-de-valor.png',
      semanticMap: 'semantic-map.json',
      record: 'preview-record.json',
    });

    const png = await readFile(path.join(outputRoot, result.image));
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1350);
    assert.equal(metadata.hasAlpha, true);

    const semanticMapBuffer = await readFile(path.join(outputRoot, result.semanticMap));
    const semanticMap = JSON.parse(semanticMapBuffer.toString('utf8'));
    assert.equal(semanticMap.copy.body, slide.body);
    assert.equal(semanticMap.copy.sha256, canonicalHash(slide.body));
    assert.equal(semanticMap.relationship, 'parallel-fields-no-causal-sequence');
    assert.deepEqual(semanticMap.bindings.map(binding => [binding.elementId, binding.label]), [
      ['client-plate', 'CLIENTE'],
      ['solution-plate', 'CATEGORIA DE SOLUÇÃO'],
      ['benefit-plate', 'BENEFÍCIO PRINCIPAL'],
      ['method-plate', 'COMO FAZEMOS ISSO'],
    ]);
    assert.deepEqual(semanticMap.semanticElementIds, semanticMap.bindings.map(binding => binding.elementId));

    const record = JSON.parse(await readFile(path.join(outputRoot, result.record), 'utf8'));
    assert.equal(record.status, 'pending-human-review');
    assert.equal(record.png.sha256, sha256(png));
    assert.equal(record.semanticMap.sha256, sha256(semanticMapBuffer));
    assert.equal(record.copy.sha256, canonicalHash(slide.body));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
