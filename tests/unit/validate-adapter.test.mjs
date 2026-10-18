import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePreparedSnapshot} from '../../src/adapters/legacy/validate-adapter.mjs';
import {renderedQualityFixture} from '../helpers/quality-render-fixture.mjs';

test('adapter preserves v1 boundary and refuses preview as final validation',async()=>{
 await assert.rejects(validatePreparedSnapshot({snapshot:{contractVersion:1}}),{code:'RUN_DERIVATION_REQUIRED'});
 await assert.rejects(validatePreparedSnapshot({snapshot:{contractVersion:2,renderer:{id:'editorial-composed@1'}},manifest:{kind:'preview'}}),{code:'VALIDATE_OUTPUT_INVALID'});
});
test('actual Q06 raster semantics stay not-verified through the validate bridge',async()=>{
 const {input}=await renderedQualityFixture({selection:'all'}),report=await validatePreparedSnapshot({snapshot:input.composition.inputs.snapshot,manifest:input.manifest,composition:input.composition,files:input.files,resource:{qualifications:input.qualification}});
 assert.equal(report.result,'not-verified');assert.ok(report.checks.some(c=>c.code==='contrast'&&c.result==='not-verified'));assert.equal(Object.hasOwn(report,'approved'),false);
});
