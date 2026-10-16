import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { qualityStateEvidenceFixture } from '../helpers/quality-state-evidence-fixture.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';

const state = db => Object.fromEntries(['runs','steps','step_attempts','artifacts','approvals','confirmation_requests','operations','run_events'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const codes = view => view.diagnostics.map(d=>d.code);

test('real PNG bytes and Q06 reports reach the Q04 receipt boundary without granting quality',async t=>{
 const f=await qualityStateEvidenceFixture(t),before=state(f.db),view=await f.runtime.get(f.request);
 assert.equal(f.preview.objective.result,'passed',JSON.stringify(f.preview.objective.checks.filter(c=>c.result!=='passed')));
 assert.equal(f.final.objective.result,'passed',JSON.stringify(f.final.objective.checks.filter(c=>c.result!=='passed')));
 assert.equal(f.preview.objective.manifestRef.sha256,canonicalHash(f.preview.manifest));assert.equal(f.final.objective.manifestRef.kind,'render-manifest:final');
 assert.deepEqual(codes(view).filter(c=>!c.endsWith('_UNAVAILABLE')),[],JSON.stringify(view.diagnostics));
 assert.ok(codes(view).includes('QUALITY_REVIEW_VERIFICATION_UNAVAILABLE'));
 for(const kind of ['preview','final']){assert.equal(view.quality[kind].status,'blocked');assert.equal(view.quality[kind].humanReceiptVerified,false);assert.deepEqual(view.quality[kind].manifestRef,f[kind].manifestRef);assert.deepEqual(view.quality[kind].reviewRef,f[kind].reviewRef);}
 assert.equal(view.quality.status,'blocked');assert.notEqual(view.quality.status,'passed');assert.equal(view.stages.length,11);assert.deepEqual(state(f.db),before);
 assert.deepEqual(await f.runtime.resume(f.request),view);assert.deepEqual(state(f.db),before);
 for(const kind of ['preview','final'])for(const ref of [f[kind].manifestRef,f[kind].objectiveReportRef,f[kind].reviewRef,f[kind].manifest.metricsRef,...f[kind].manifest.files.map(file=>file.artifactRef)]){
  const row=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(ref.id);assert.equal(row.brand_id,f.request.brandId);assert.equal(row.run_id,f.request.runId);assert.ok(row.relative_path.includes(`/${f[kind].manifest.renderAttemptId}/`));
  assert.throws(()=>f.db.prepare('UPDATE artifacts SET version=version+1 WHERE id=?').run(ref.id),/immutable/);
 }
 assert.deepEqual(state(f.db),before);
});

test('the read model refuses a newer attempt borrowing an earlier manifest',async t=>{
 const f=await qualityStateEvidenceFixture(t),step=f.steps.get('render');
 f.db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,started_at,finished_at,status,result_artifact_id) VALUES(?,?,?,?,2,'synthetic-fixture',2,'2026-10-16T22:00:00.000Z','2026-10-16T22:01:00.000Z','succeeded',?)").run(randomUUID(),f.request.brandId,f.request.runId,step.id,f.final.manifestRef.id);
 const before=state(f.db),view=await f.runtime.get(f.request);assert.ok(codes(view).includes('QUALITY_EVIDENCE_STALE'));assert.equal(view.quality.final.status,'blocked');assert.deepEqual(state(f.db),before);
});

test('managed image bytes changed after reporting block the chain without database mutation',async t=>{
 const f=await qualityStateEvidenceFixture(t),image=f.written.find(w=>w.ref.id===f.final.manifest.files[0].artifactRef.id);
 await writeFile(image.filename,Buffer.from('changed PNG bytes'));
 const before=state(f.db),view=await f.runtime.get(f.request);assert.ok(codes(view).includes('ARTIFACT_HASH_MISMATCH'));assert.equal(view.quality.final.status,'blocked');assert.deepEqual(state(f.db),before);
});

test('managed plan bytes changed after reporting block the chain without reapproving',async t=>{
 const f=await qualityStateEvidenceFixture(t),plan=await f.inputs.resolveArtifact(f.request.brandId,f.request.runId,f.ready.artifacts.plan.id);
 await writeFile(plan.path,Buffer.from('{}'));
 const before=state(f.db),view=await f.runtime.get(f.request);assert.ok(codes(view).includes('ARTIFACT_HASH_MISMATCH'));assert.equal(view.quality.final.status,'blocked');assert.notEqual(view.quality.status,'passed');assert.deepEqual(state(f.db),before);
});

test('a hash-valid manifest referring to another plan hash is stale',async t=>{
 const f=await qualityStateEvidenceFixture(t,{omitFinalReview:true,mutateManifest:(manifest,kind)=>{if(kind==='final')manifest.planRef={...manifest.planRef,sha256:'f'.repeat(64)};}});
 const before=state(f.db),view=await f.runtime.get(f.request);assert.ok(codes(view).includes('QUALITY_EVIDENCE_STALE'));assert.equal(view.quality.final.status,'blocked');assert.deepEqual(state(f.db),before);
});

test('intact evidence distinguishes human editorial review from preview consent in next actions',async t=>{
 const f=await qualityStateEvidenceFixture(t),ordered=[...f.steps.keys()];
 for(const [pending,code,type,requires] of [
  ['preview-review','EDITORIAL_REVIEW_REQUIRED','request-quality-review',['Q05','T15']],
  ['quality-review','EDITORIAL_REVIEW_REQUIRED','request-quality-review',['Q05','T15']],
  ['preview-approval','PREVIEW_APPROVAL_REQUIRED','request-approval',['Q05']],
 ]){
  const position=ordered.indexOf(pending);
  for(const [index,key]of ordered.entries())f.db.prepare('UPDATE steps SET status=? WHERE run_id=? AND step_key=?').run(index<position?'succeeded':index===position?'waiting-approval':'pending',f.request.runId,key);
  f.db.prepare("UPDATE runs SET status='waiting-approval',current_step=? WHERE id=?").run(pending,f.request.runId);
  const before=state(f.db),view=await f.runtime.get(f.request);assert.equal(view.pending.stage,pending);assert.equal(view.pending.code,code,JSON.stringify(view.diagnostics));assert.equal(view.nextAction.type,type);assert.deepEqual(view.nextAction.requires,requires);assert.equal(view.nextAction.available,false);assert.notEqual(view.quality.status,'passed');assert.deepEqual(state(f.db),before);
 }
});

for(const field of ['stageFingerprint','inputsRef'])test(`a rehashed manifest with stale ${field} is refused`,async t=>{
 const f=await qualityStateEvidenceFixture(t,{omitFinalReview:true,mutateManifest:(manifest,kind)=>{if(kind==='final'){if(field==='stageFingerprint')manifest.stageFingerprint='f'.repeat(64);else manifest.inputsRef={...manifest.inputsRef,id:randomUUID()};}}});
 const before=state(f.db),view=await f.runtime.get(f.request);assert.ok(codes(view).includes('QUALITY_EVIDENCE_STALE'));assert.equal(view.quality.final.status,'blocked');assert.deepEqual(state(f.db),before);
});
