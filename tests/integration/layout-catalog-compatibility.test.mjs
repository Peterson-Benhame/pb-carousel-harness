import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { validateCompositionPlan } from '../../src/domain/composition-plan.mjs';
import { compositionFixture } from '../fixtures/quality/composition-fixture.mjs';

for (const scenario of [
  {
    name: 'cover',
    id: 'qualification-cover-editorial@1',
    slideIndex: 0,
    versions: [
      { version: 2, definitionHash: '036fec3e6443d99ff9412584bf68d40a1514558264800150127ad2b8b42ac0fd' },
      { version: 1, definitionHash: 'cabe9da307927f9193361c51d628b5eeded3d608d70450effc386e0c6651b931' },
    ],
  },
  {
    name: 'content flow',
    id: 'qualification-content-flow@1',
    slideIndex: 1,
    versions: [
      { version: 2, definitionHash: '31b468d368c1ccc04bc14fe91436104abe134fe9ff1f858def586b5589e194d6' },
      { version: 1, definitionHash: 'd87d32754a95ef18da756b0e130e2ae84d5f589857991f0167d4e6a6fb17f77e' },
    ],
  },
]) {
  test('catalog keeps the frozen V1 ' + scenario.name + ' plan valid beside the V2 candidate', async () => {
    const fixture = await compositionFixture(3);
    const versions = fixture.qualifications
      .filter(record => record.id === scenario.id)
      .map(record => ({ version: record.version, definitionHash: record.definitionHash }));
    assert.deepEqual(versions, scenario.versions);

    const frozen = fixture.qualifications.find(record => record.id === scenario.id && record.version === 1);
    const slide = fixture.plan.slides[scenario.slideIndex];
    slide.qualificationRef = { id: frozen.id, version: frozen.version, sha256: canonicalHash(frozen), definitionHash: frozen.definitionHash };
    fixture.plan.riskInventory.slides[scenario.slideIndex].fontBindingsHash = canonicalHash(frozen.definition.fontBindings);
    const validated = validateCompositionPlan(fixture);
    assert.equal(validated.slides[scenario.slideIndex].qualificationRef.version, 1);
  });
}
