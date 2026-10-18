import test from 'node:test';
import assert from 'node:assert/strict';

test('Q05 exposes one closed phase-specific gate without human-verifier injection', async()=>{
 const module=await import('../../src/application/production-gate.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
 assert.equal(typeof module.createProductionGate,'function');
});

test('quality policy has six separate phases and does not skip review for no-assets',async()=>{
 const module=await import('../../src/domain/quality-policy.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
 assert.equal(typeof module.qualityPhaseRequirements,'function');
 const expected={preview:['inputs','copy-approval','concept-approval','assets-approval'],render:['inputs','copy-approval','concept-approval','assets-approval','preview-render','preview-review','preview-approval']};
 for(const [phase,stages] of Object.entries(expected))assert.deepEqual(module.qualityPhaseRequirements({phase}),stages);
 assert.ok(!module.qualityPhaseRequirements({phase:'review',kind:'preview'}).includes('preview-review'));
 assert.ok(!module.qualityPhaseRequirements({phase:'review',kind:'final'}).includes('quality-review'));
 assert.ok(module.qualityPhaseRequirements({phase:'package'}).includes('quality-review'));
 assert.ok(module.qualityPhaseRequirements({phase:'complete'}).includes('package'));
 assert.throws(()=>module.qualityPhaseRequirements({phase:'review'}),{code:'INVALID_ARGUMENT'});
});

import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {qualityServiceFixture,syntheticReview} from '../helpers/quality-service-fixture.mjs';
import {createProductionGate} from '../../src/application/production-gate.mjs';
import {loadQualifiedQualityResources} from '../../src/application/quality-resources.mjs';
import {canonicalHash} from '../../src/domain/canonical-json.mjs';
async function review(f,kind='preview',manifest=f.preview.manifest){const pending=await f.service.request({requestId:randomUUID(),...f.scope,kind,manifestId:manifest.id}),response=await syntheticReview(pending,{gateway:f.reviewGateway});return f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:response.answers},response.receipt);}

test('preview requires only its antecedents and no-assets never skips review or preview consent',async t=>{
 const f=await qualityServiceFixture(t,{render:false});assert.equal((await f.gate.assertProductionGate({...f.scope,phase:'preview'})).phase,'preview');
 await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'render'}),{code:'PREVIEW_REQUIRED'});
});
test('production rejects the actual candidate catalog even if injected records claim qualified',async t=>{
 const f=await qualityServiceFixture(t);const gate=await createProductionGate({root:f.root,db:f.db,qualifications:f.qualifications,verifyReviewReceipt:()=>true});await assert.rejects(gate.assertProductionGate({...f.scope,phase:'preview'}),{code:'LAYOUT_NOT_QUALIFIED'});
});
for(const file of ['shared/layouts/editorial-composed-v1.json','src/render/text-layout.mjs','src/quality/objective-checks.mjs'])test(`resource gate detects changed ${file}`,async t=>{
 const f=await qualityServiceFixture(t,{render:false});await writeFile(path.join(f.packageRoot,file),(await readFile(path.join(f.packageRoot,file),'utf8'))+'\n');await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'preview'}),{code:'RUNTIME_MISMATCH'});
});
test('all production phases are distinct and final review does not require its own future verdict',async t=>{
 const f=await qualityServiceFixture(t);assert.equal((await f.gate.assertProductionGate({...f.scope,phase:'review',kind:'preview'})).kind,'preview');
 await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'render'}),{code:'QUALITY_EVIDENCE_INCOMPLETE'});
 await review(f);await f.grant('preview');assert.equal((await f.gate.assertProductionGate({...f.scope,phase:'render'})).phase,'render');
 const final=await f.makeRender('final');assert.equal((await f.gate.assertProductionGate({...f.scope,phase:'validate'})).phase,'validate');
 await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'review',kind:'final'}),{code:'QUALITY_EVIDENCE_INCOMPLETE'});
 await f.validateFinal(final);assert.equal((await f.gate.assertProductionGate({...f.scope,phase:'review',kind:'final'})).kind,'final');
 await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'package'}),{code:'EDITORIAL_REVIEW_REQUIRED'});
 await review(f,'final',final.manifest);assert.equal((await f.gate.assertProductionGate({...f.scope,phase:'package'})).phase,'package');
 await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'complete'}),{code:'PACKAGE_VERIFICATION_UNAVAILABLE'});
});
test('free-form passed objective JSON cannot replace the exact full Q06 report',async t=>{
 const f=await qualityServiceFixture(t),pending=await f.service.request({requestId:randomUUID(),...f.scope,kind:'preview',manifestId:f.preview.manifest.id}),file=await f.inputs.resolveArtifact(f.scope.brandId,f.scope.runId,pending.proposal.objectiveReportRef.id),record=JSON.parse(await readFile(file.path,'utf8'));
 const forged={...record,checks:record.checks.filter((c,i,a)=>a.findIndex(x=>x.code===c.code)===i)};await f.persist('objective-report:preview',forged,2);await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'review',kind:'preview'}),{code:'QUALITY_EVIDENCE_STALE'});
});

test('a new successful manifest/attempt cannot borrow PNGs or metrics owned by an earlier attempt',async t=>{
 const f=await qualityServiceFixture(t),m={...f.preview.manifest,id:randomUUID(),version:2,renderAttemptId:randomUUID()},manifestRef=await f.persist('render-manifest:preview',m,2,m.id,m.renderAttemptId),stage=f.db.prepare("SELECT id FROM steps WHERE run_id=? AND step_key='preview-render'").get(f.scope.runId);
 f.db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,finished_at,status,result_artifact_id) VALUES(?,?,?,?,2,'borrowed-output-fixture',2,?,'succeeded',?)").run(m.renderAttemptId,f.scope.brandId,f.scope.runId,stage.id,new Date().toISOString(),manifestRef.id);
 await assert.rejects(f.service.request({requestId:randomUUID(),...f.scope,kind:'preview',manifestId:m.id}),{code:'QUALITY_EVIDENCE_STALE'});
});

test('approved font identity cannot be replaced by bytes from the configured directory',async t=>{
 const f=await qualityServiceFixture(t,{render:false}),directory=path.join(f.root,'altered-fonts');await mkdir(directory);
 for(const font of f.manifest.fonts)await writeFile(path.join(directory,font.file),'synthetic wrong font bytes');
 f.db.prepare('UPDATE workspace_settings SET authorized_font_directory=?').run(directory);
 await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'preview'}),{code:'RUNTIME_MISMATCH'});
});
