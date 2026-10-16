import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fingerprintStage,buildInputFingerprints} from '../../src/domain/artifact-fingerprints.mjs';
const fixture=JSON.parse(await readFile(new URL('../fixtures/quality/legacy-run-v1.json',import.meta.url),'utf8'));
const base={...fixture.context,contractVersion:2}, h=x=>x.repeat(64);
const ref=(kind='composition-plan')=>({id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',kind,version:1,sha256:h('c')});
const q={id:'qualification-cover-editorial@1',version:1,sha256:h('d'),definitionHash:h('e')};
const plan={planRef:ref(),qualificationRefs:[q],selection:{slideIndices:[1,2],seamPairs:[],policyId:'representative-risk@1'},riskInventory:{slides:[1,2]},fontBindings:[{fontId:'Anton',sha256:h('f')}],fonts:[{id:'Anton',sha256:h('f')}],renderer:{id:'editorial-composed@1',files:{renderer:h('a')}}};
test('Q04 frozen historical v1 identities remain byte-for-byte identical',()=>{
 assert.deepEqual(buildInputFingerprints(fixture.context),fixture.fingerprints);
 assert.deepEqual(buildInputFingerprints({...fixture.context,contractVersion:1,fingerprintVersion:1}),fixture.fingerprints);
});
test('Q04 v2 inputs include plan but copy and concept do not depend on plan data',()=>{
 const first=buildInputFingerprints({...base,...plan}),changed=structuredClone(plan);changed.planRef.sha256=h('b');
 const second=buildInputFingerprints({...base,...changed});
 assert.notEqual(first.inputs,second.inputs);assert.notEqual(first['preview-render'],second['preview-render']);
 for(const key of ['copy-approval','concept-approval','assets-approval'])assert.equal(first[key],second[key]);
 assert.equal(first.render,undefined,'render cannot be precomputed before preview consent');
 assert.notEqual(first.inputs,fixture.fingerprints.inputs);
});
test('Q04 v2 preview identity includes selection, qualifications, risk, bindings and actual renderer',()=>{
 const initial=buildInputFingerprints({...base,...plan})['preview-render'];
 for(const key of ['qualificationRefs','selection','riskInventory','fontBindings','fonts','renderer']){
  const changed=structuredClone(plan);
  if(key==='selection')changed[key].slideIndices=[1,3];else if(key==='riskInventory')changed[key].slides=[1,3];
  else if(key==='renderer')changed[key].files.renderer=h('b');else changed[key][0].sha256=h('b');
  assert.notEqual(buildInputFingerprints({...base,...changed})['preview-render'],initial,key);
 }
});
test('Q04 review stage identity binds manifest, attempt, pixels, metrics, report, rubric and checker',()=>{
 const inputs={manifestRef:ref('render-manifest:preview'),renderAttemptId:base.runId,files:[{sha256:h('a'),rgbaSha256:h('b')}],metricsRef:ref('composition-metrics:preview'),objectiveReportRef:ref('objective-report:preview'),rubricRef:{id:'editorial-quality@1',version:1,sha256:h('d')},checkerRefs:[{id:'editorial-objective-checkers@1',version:1,sha256:h('e')}]};
 const initial=fingerprintStage({...base,stage:'preview-review',inputs});
 for(const key of Object.keys(inputs)){
  const changed=structuredClone(inputs);
  if(key==='renderAttemptId')changed[key]=ref().id;else if(Array.isArray(changed[key]))changed[key][0].sha256=h('f');else changed[key].sha256=h('f');
  assert.notEqual(fingerprintStage({...base,stage:'preview-review',inputs:changed}),initial,key);
 }
 assert.throws(()=>fingerprintStage({...base,stage:'preview-review',inputs:{...inputs,ownResult:ref()}}),{code:'INVALID_ARGUMENT'});
});
test('Q04 contracts fail closed and executable changes can invalidate all editorial stages',()=>{
 for(const context of [{contractVersion:3},{contractVersion:2,fingerprintVersion:1},{contractVersion:1,fingerprintVersion:2}])assert.throws(()=>buildInputFingerprints({...base,...context,...plan}),{code:'RUN_CONTRACT_UNSUPPORTED'});
 const first=buildInputFingerprints({...base,...plan}),second=buildInputFingerprints({...base,...plan,executable:{version:'changed'}});
 for(const key of Object.keys(first))assert.notEqual(first[key],second[key]);
 assert.throws(()=>fingerprintStage({...base,stage:'quality-review',inputs:{}}),{code:'INVALID_ARGUMENT'});
});

test('Q04 unordered resource sets canonicalize without changing semantic identity',()=>{
 const context={...base,...plan,qualificationRefs:[q,{...q,id:'qualification-content-flow@1'}],fonts:[{id:'Anton',sha256:h('a')},{id:'Manrope',sha256:h('b')}],fontBindings:[{fontId:'Anton',weight:400,sha256:h('a')},{fontId:'Manrope',weight:450,sha256:h('b')}]};
 const expected=buildInputFingerprints(context),reversed=structuredClone(context);
 for(const key of ['qualificationRefs','fonts','fontBindings'])reversed[key].reverse();
 assert.deepEqual(buildInputFingerprints(reversed),expected);
});
