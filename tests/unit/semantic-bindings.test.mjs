import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../../src/domain/semantic-bindings.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const bind = input => {
  assert.equal(typeof module.bindSemanticElements, 'function', 'semantic binding validator is required');
  return module.bindSemanticElements(input);
};

const text = 'Para [cliente], nossa [categoria de solução] entrega [benefício principal] por meio de [como fazemos isso].';
const bindings = [
  { elementId: 'client-plate', token: '[cliente]' },
  { elementId: 'solution-plate', token: '[categoria de solução]' },
  { elementId: 'benefit-plate', token: '[benefício principal]' },
  { elementId: 'method-plate', token: '[como fazemos isso]' },
];
const elementIds = bindings.map(binding => binding.elementId);

test('derives one visible label and exact source range for each approved copy token', () => {
  const result = bind({ text, bindings, elementIds });
  assert.deepEqual(result.bindings, [
    { elementId: 'client-plate', token: '[cliente]', label: 'CLIENTE', sourceStart: 5, sourceEnd: 14, sourceText: '[cliente]' },
    { elementId: 'solution-plate', token: '[categoria de solução]', label: 'CATEGORIA DE SOLUÇÃO', sourceStart: 22, sourceEnd: 44, sourceText: '[categoria de solução]' },
    { elementId: 'benefit-plate', token: '[benefício principal]', label: 'BENEFÍCIO PRINCIPAL', sourceStart: 53, sourceEnd: 74, sourceText: '[benefício principal]' },
    { elementId: 'method-plate', token: '[como fazemos isso]', label: 'COMO FAZEMOS ISSO', sourceStart: 87, sourceEnd: 106, sourceText: '[como fazemos isso]' },
  ]);
  assert.equal(result.text, text);
});

test('rejects a binding whose approved copy token is absent', () => {
  assert.throws(() => bind({ text: text.replace('[cliente]', 'cliente'), bindings, elementIds }), { code: 'SEMANTIC_BINDING_MISSING' });
});

test('rejects a copy token that appears more than once', () => {
  assert.throws(() => bind({ text: `${text} [cliente]`, bindings, elementIds }), { code: 'SEMANTIC_BINDING_DUPLICATE' });
});

test('rejects a semantic symbol without a copy binding', () => {
  assert.throws(() => bind({ text, bindings, elementIds: [...elementIds, 'mystery-symbol'] }), { code: 'SEMANTIC_SYMBOL_UNBOUND' });
});
