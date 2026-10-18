import test from 'node:test';
import assert from 'node:assert/strict';

test('Q05 review service exists without a public actor/approve grant', async()=>{
 const module=await import('../../src/application/quality-review.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
 assert.equal(typeof module.createQualityReview,'function');
 assert.equal(module.issueReviewReceipt,undefined);
});

import {randomUUID} from 'node:crypto';
import {qualityServiceFixture,syntheticReview} from '../helpers/quality-service-fixture.mjs';
const request=f=>({requestId:randomUUID(),...f.scope,kind:'preview',manifestId:f.preview.manifest.id});

test('review request verifies real rendered pixels/objective and waits without a lease or consent',async t=>{
 const f=await qualityServiceFixture(t),r=request(f),pending=await f.service.request(r);
 assert.equal(pending.status,'pending');assert.equal(pending.proposal.kind,'preview');
 assert.equal(f.db.prepare('SELECT count(*) n FROM approvals WHERE run_id=?').get(f.scope.runId).n,2);
 assert.equal(f.db.prepare('SELECT lease_owner FROM runs WHERE id=?').get(f.scope.runId).lease_owner,null);
 assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='objective-report:preview'").get().n,1);
 assert.deepEqual((await f.service.request(r)).proposal,pending.proposal);
});

test('service commits only a genuine gateway capability, keeps consent separate and verifies persisted provenance',async t=>{
 const f=await qualityServiceFixture(t),pending=await f.service.request(request(f));
 const result=await syntheticReview(pending,{gateway:f.reviewGateway});
 for(const fake of [null,{}, {actor:'human',approved:true},JSON.parse(JSON.stringify(result.receipt))])await assert.rejects(f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:result.answers},fake),{code:'EDITORIAL_REVIEW_REQUIRED'});
 const decision={requestId:randomUUID(),proposal:pending.proposal,answers:result.answers},saved=await f.service.decide(decision,result.receipt);
 assert.equal(saved.review.verdict,'passed');assert.equal(f.db.prepare('SELECT current_step FROM runs WHERE id=?').get(f.scope.runId).current_step,'preview-approval');
 assert.deepEqual(await f.service.decide(decision,null),saved);
 assert.equal((await f.service.get({...f.scope,reviewId:saved.review.id})).humanReceiptVerified,true);
 await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'render'}),{code:'APPROVAL_REQUIRED'});
 await f.grant('preview');assert.equal((await f.gate.assertProductionGate({...f.scope,phase:'render'})).phase,'render');
});

import {writeFile,readFile} from 'node:fs/promises';
import {createRunControl} from '../../src/application/run-control.mjs';

test('negative human verdict blocks editorial review and never grants preview consent',async t=>{
 const f=await qualityServiceFixture(t),pending=await f.service.request(request(f)),response=await syntheticReview(pending,{gateway:f.reviewGateway,result:'FALHA'}),saved=await f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:response.answers},response.receipt);
 assert.equal(saved.review.verdict,'failed');assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(f.scope.runId).status,'blocked');assert.equal(f.db.prepare('SELECT status FROM confirmation_requests WHERE id=?').get(saved.review.confirmationRequestId).status,'rejected');
 assert.equal((await f.service.get({...f.scope,reviewId:saved.review.id})).humanReceiptVerified,true);await assert.rejects(f.gate.assertProductionGate({...f.scope,phase:'render'}),{code:'QUALITY_REVIEW_FAILED'});
});
test('changed checklist after local confirmation cannot reuse the receipt',async t=>{
 const f=await qualityServiceFixture(t),pending=await f.service.request(request(f)),response=await syntheticReview(pending,{gateway:f.reviewGateway});const changed=structuredClone(response.answers);changed.criteria[0].observation='Changed after attestation';await assert.rejects(f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:changed},response.receipt),{code:'QUALITY_EVIDENCE_STALE'});
});
test('cancelled pending review refuses late confirmation without creating a negative verdict',async t=>{
 const f=await qualityServiceFixture(t),pending=await f.service.request(request(f)),response=await syntheticReview(pending,{gateway:f.reviewGateway});await createRunControl({db:f.db}).cancel({requestId:randomUUID(),...f.scope});await assert.rejects(f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:response.answers},response.receipt),{code:'RUN_CANCELLED'});assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE kind='quality-review:preview'").get().n,0);
});
test('bytes replaced after display fail before decision commit',async t=>{
 const f=await qualityServiceFixture(t),pending=await f.service.request(request(f)),response=await syntheticReview(pending,{gateway:f.reviewGateway}),file=await f.inputs.resolveArtifact(f.scope.brandId,f.scope.runId,f.preview.manifest.files[0].artifactRef.id);await writeFile(file.path,'not the displayed image');await assert.rejects(f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:response.answers},response.receipt),{code:'ARTIFACT_HASH_MISMATCH'});
});
test('read model recognizes genuine persisted review without minting preview consent',async t=>{
 const f=await qualityServiceFixture(t),pending=await f.service.request(request(f)),response=await syntheticReview(pending,{gateway:f.reviewGateway});await f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:response.answers},response.receipt);const {createRunRuntime}=await f.from('src/application/run-runtime.mjs'),runtime=await createRunRuntime({root:f.root,db:f.db,packageRoot:f.packageRoot}),before=f.db.serialize(),view=await runtime.get(f.scope);assert.equal(view.quality.preview.status,'passed');assert.equal(view.quality.preview.humanReceiptVerified,true);assert.equal(view.nextAction.type,'request-approval');assert.equal(view.nextAction.available,true);assert.deepEqual(f.db.serialize(),before);
});

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

test('review provenance survives a new process and forged operation/request metadata fails closed',async t=>{
 const f=await qualityServiceFixture(t),pending=await f.service.request(request(f)),response=await syntheticReview(pending,{gateway:f.reviewGateway}),decision={requestId:randomUUID(),proposal:pending.proposal,answers:response.answers},saved=await f.service.decide(decision,response.receipt);
 const script=`import {openWorkspace} from ${JSON.stringify(pathToFileURL(path.join(f.packageRoot,'src/infrastructure/sqlite/database.mjs')).href)};import {createQualityReview} from ${JSON.stringify(pathToFileURL(path.join(f.packageRoot,'src/application/quality-review.mjs')).href)};const db=await openWorkspace(process.argv[1],{readonly:false});try{const service=await createQualityReview({root:process.argv[1],db});console.log(JSON.stringify(await service.decide(${JSON.stringify(decision)},null)));}finally{db.close();}`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,f.root]);assert.deepEqual(JSON.parse(stdout),saved);
 f.db.prepare("UPDATE confirmation_requests SET resolved_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(saved.review.confirmationRequestId);await assert.rejects(f.service.get({...f.scope,reviewId:saved.review.id}),{code:'QUALITY_EVIDENCE_STALE'});
});
test('transaction races roll back review/request/stage together and preserve the unconsumed capability',async t=>{
 let f,change=false;f=await qualityServiceFixture(t,{hooks:{beforeCommit(){if(change)f.db.prepare("UPDATE confirmation_requests SET status='cancelled' WHERE kind='review-preview'").run();}}});
 const pending=await f.service.request(request(f)),response=await syntheticReview(pending,{gateway:f.reviewGateway}),decision={requestId:randomUUID(),proposal:pending.proposal,answers:response.answers},before=f.db.serialize();change=true;
 await assert.rejects(f.service.decide(decision,response.receipt),{code:'QUALITY_EVIDENCE_STALE'});assert.deepEqual(f.db.serialize(),before);change=false;assert.equal((await f.service.decide(decision,response.receipt)).review.verdict,'passed');
});
test('expired request or forged cross-run review payload cannot consume the shown receipt',async t=>{
 const f=await qualityServiceFixture(t),pending=await f.service.request(request(f)),response=await syntheticReview(pending,{gateway:f.reviewGateway});
 await assert.rejects(f.service.decide({requestId:randomUUID(),proposal:{...pending.proposal,runId:randomUUID()},answers:response.answers},response.receipt),{code:'RUN_NOT_FOUND'});
 f.db.prepare("UPDATE confirmation_requests SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(pending.proposal.confirmationRequestId);await assert.rejects(f.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:response.answers},response.receipt),{code:'QUALITY_EVIDENCE_STALE'});
});
