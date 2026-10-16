import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { evidenceFixture, id, digest, ref, objectFields, sealReview } from '../fixtures/quality/evidence-fixture.mjs';
import * as api from '../../src/domain/quality-evidence.mjs';
const invalid = fn => assert.throws(fn, error => error.name==='PublicError');
const stale = fn => assert.throws(fn, {code:'QUALITY_EVIDENCE_STALE'});

test('quality review is detached deep-frozen JSON without granting trust',()=>{
  assert.equal(typeof api.validateQualityReview,'function','Q04 pure review validator must exist');
  const {review}=evidenceFixture();const result=api.validateQualityReview(review);
  assert.deepEqual(result,review);assert.notEqual(result,review);assert.ok(Object.isFrozen(result.criteria[0].target));
  review.coverage.files[0].sha256=digest('changed');assert.notEqual(result.coverage.files[0].sha256,review.coverage.files[0].sha256);
  assert.equal(Object.hasOwn(result,'humanReceiptVerified'),false);assert.equal(Object.hasOwn(result,'approved'),false);
});
test('fingerprints implement the exact non-circular contract',()=>{
  const {review}=evidenceFixture();assert.equal(typeof api.fingerprintQualityReviewObject,'function');
  assert.equal(api.fingerprintQualityReviewObject(objectFields(review)),review.objectFingerprint);
  assert.equal(api.fingerprintQualityReviewProposal(Object.fromEntries(['objectFingerprint','confirmationRequestId','coverage','criteria','findings'].map(k=>[k,review[k]]))),review.reviewProposalHash);
  const changed=structuredClone(review);changed.id=id(201);changed.reviewedAt='2026-10-16T22:00:00.000Z';
  assert.equal(api.validateQualityReview(changed).objectFingerprint,review.objectFingerprint);
});
for(const kind of ['preview','final'])test(`${kind} manifest and review bind exact declared evidence without approving it`,()=>{
  const f=evidenceFixture(kind);assert.equal(typeof api.validateRenderManifest,'function');assert.deepEqual(api.validateRenderManifest(f.manifest),f.manifest);
  const result=api.verifyQualityEvidence(f);assert.equal(result.humanReceiptVerified,false);assert.equal(result.productionEligible,false);assert.equal(result.coverageComplete,true);assert.equal(result.objectiveResult,'passed');assert.ok(Object.isFrozen(result));
});
for(const [label,edit] of [
 ['unknown top-level key',r=>r.approved=true],['nested actor',r=>r.reviewer.actor='me'],['version',r=>r.schemaVersion=2],['unsupported method',r=>r.method='ai@1'],['bad UUID',r=>r.id='bad'],['uppercase hash',r=>r.planHash='A'.repeat(64)],['unknown rubric',r=>r.rubricRef.id='other@1'],['unknown checker',r=>r.checkerRefs[0].id='other@1'],['unknown qualification',r=>r.qualificationRefs[0].id='arbitrary@1'],['invalid date',r=>r.reviewedAt='2026-02-30T00:00:00.000Z'],['forged redundant hash',r=>r.manifestHash=digest('other')],['stale object hash',r=>r.renderAttemptId=id(70)],['stale proposal',r=>r.criteria[0].observation+=' changed'],['duplicate file',r=>r.coverage.files.push(r.coverage.files[0])],['missing criterion',r=>{r.criteria.pop();sealReview(r);}],['unviewed file',r=>{r.coverage.files[0].viewedMobile=false;sealReview(r);}],['wrong mobile scale',r=>{r.coverage.mobileWidth=320;sealReview(r);}],['preview panorama',r=>{r.coverage.panorama=id(20);sealReview(r);}],['unknown target',r=>{r.criteria[0].target.slideIndex=99;sealReview(r);}],['failed criterion with pass',r=>{r.criteria[0].result='failed';sealReview(r);}],['blocking finding with pass',r=>{r.findings.push({id:id(88),criterionId:'legibility',target:r.criteria[0].target,severity:'blocking',description:'Synthetic clipping'});sealReview(r);}]
]) test(`review rejects ${label}`,()=>{const {review}=evidenceFixture();edit(review);invalid(()=>api.validateQualityReview(review));});
test('non-JSON input cannot execute getters, toJSON or custom prototypes',()=>{
 for(const method of ['validateQualityReview','validateRenderManifest']){
  const f=evidenceFixture(),record=method==='validateQualityReview'?f.review:f.manifest;let invoked=false;
  Object.defineProperty(record,'trap',{enumerable:true,get(){invoked=true;return true;}});invalid(()=>api[method](record));assert.equal(invoked,false);
  for(const value of [null,undefined,NaN,new Date(),Object.assign(Object.create({}),{}),{toJSON(){throw Error('must not run');}}])invalid(()=>api[method](value));
 }
});
for(const [label,edit] of [
 ['extra field',m=>m.path='/tmp/a'],['version',m=>m.schemaVersion=1],['selection hash',m=>m.selectionHash=digest('wrong')],['missing image',m=>m.files.pop()],['duplicate file',m=>m.files.push(m.files[0])],['image dimensions',m=>m.files[0].width=360],['wrong artifact kind',m=>m.files[0].artifactRef.kind='zip'],['self reference',m=>m.metricsRef.id=m.id],['unknown renderer file',m=>m.renderer.files['/tmp/evil.mjs']=digest('evil')],['missing renderer file',m=>delete m.renderer.files[Object.keys(m.renderer.files)[0]]],['preview with final policy',m=>{m.selection.policyId='all-slides@1';m.selectionHash=canonicalHash(m.selection);}],['preview final upstream',m=>m.upstream.previewApprovalId=id(33)],['nonadjacent seam',m=>{m.selection.seamPairs=[{from:1,to:3}];m.selectionHash=canonicalHash(m.selection);}]
])test(`manifest rejects ${label}`,()=>{const {manifest}=evidenceFixture();edit(manifest);invalid(()=>api.validateRenderManifest(manifest));});
for(const [label,edit] of [
 ['another brand',f=>f.expected.brandId=id(51)],['another run',f=>f.expected.runId=id(52)],['another attempt',f=>f.expected.renderAttemptId=id(53)],['another kind',f=>f.expected.kind='final'],['another manifest artifact',f=>f.expected.manifestRef={...f.expected.manifestRef,id:id(54)}],['another objective artifact',f=>f.expected.objectiveReportRef={...f.expected.objectiveReportRef,id:id(55)}],['other image bytes',f=>f.manifest.files[0].artifactRef.sha256=digest('bytes')],['other pixel hash',f=>f.manifest.files[0].rgbaSha256=digest('pixels')],['other plan',f=>f.plan.version++],['other snapshot',f=>f.snapshot.runtime.node='different'],['other selection',f=>f.manifest.selection.slideIndices=[1]],['other qualification',f=>f.manifest.qualifications[0].definitionHash=digest('new definition')],['other rubric',f=>f.review.rubricRef.sha256=digest('rubric')],['other checker',f=>f.objectiveReport.checkerRefs[0].sha256=digest('checker2')],['other objective',f=>f.objectiveReport.checks[0].observed='changed'],['other reviewed file',f=>{f.review.coverage.files[0].sha256=digest('file');sealReview(f.review);}]
])test(`pure evidence verifier refuses replay with ${label}`,()=>{const f=evidenceFixture();edit(f);stale(()=>api.verifyQualityEvidence(f));});
test('not-verified and failed remain diagnostic records without upgrading to passed',()=>{
 for(const outcome of ['not-verified','failed']){const f=evidenceFixture();f.review.criteria[0].result=outcome;f.review.verdict=outcome;sealReview(f.review);assert.equal(api.validateQualityReview(f.review).verdict,outcome);assert.equal(api.verifyQualityEvidence(f).productionEligible,false);}
});
test('final must retain separate preview identity and identical approved slide/seam hashes',()=>{
 for(const edit of [f=>delete f.previewManifest,f=>f.previewManifest.id=f.manifest.id,f=>f.previewManifest.renderAttemptId=f.manifest.renderAttemptId,f=>f.manifest.files[0].artifactRef.sha256=digest('different encoding'),f=>f.manifest.files[0].rgbaSha256=digest('different pixels'),f=>f.manifest.upstream.approvedSelectionHash=digest('other selection')]){const f=evidenceFixture('final');edit(f);stale(()=>api.verifyQualityEvidence(f));}
});

test('public evidence schemas close every record and agree with both fixture variants',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const [filename,key,version] of [['quality-review','review',1],['render-manifest','manifest',2]]){
  const schema=JSON.parse(await readFile(new URL(`../../shared/${filename}.schema.json`,import.meta.url),'utf8'));
  assert.equal(schema.properties.schemaVersion.const,version);
  const walk=node=>{if(!node||typeof node!=='object')return;if(node.type==='object'){assert.equal(node.additionalProperties,false);assert.deepEqual([...node.required].sort(),Object.keys(node.properties).sort());}Object.values(node).forEach(walk);};walk(schema);
  for(const kind of ['preview','final'])assert.deepEqual(Object.keys(evidenceFixture(kind)[key]).sort(),[...schema.required].sort());
  assert.equal(schema.$comment.includes('receipt'),true);
 }
});

// Rebind dependent JSON hashes deliberately, so these cases exercise relations
// rather than failing merely at the first stale top-level digest.
function rebind(f){
 f.manifest.selectionHash=canonicalHash(f.manifest.selection);
 const m=ref(Number(f.manifest.id.slice(-12)),`render-manifest:${f.manifest.kind}`,canonicalHash(f.manifest));
 f.objectiveReport.manifestRef=structuredClone(m);f.review.manifestRef=structuredClone(m);f.expected.manifestRef=structuredClone(m);
 f.review.objectiveReportRef.sha256=canonicalHash(f.objectiveReport);f.expected.objectiveReportRef=structuredClone(f.review.objectiveReportRef);sealReview(f.review);return f;
}
for(const [label,edit] of [
 ['snapshot binding',f=>f.manifest.snapshotHash=digest('new snapshot')],
 ['plan binding',f=>f.manifest.planRef.sha256=digest('new plan')],
 ['reviewed image bytes',f=>f.manifest.files[0].artifactRef.sha256=digest('new bytes')],
 ['reviewed pixels',f=>f.manifest.files[0].rgbaSha256=digest('new pixels')],
 ['snapshot checker identity',f=>{f.review.checkerRefs[0].sha256=digest('new checker');f.objectiveReport.checkerRefs=structuredClone(f.review.checkerRefs);}],
 ['snapshot rubric identity',f=>f.review.rubricRef.sha256=digest('new rubric')],
 ['objective extra key',f=>f.objectiveReport.approved=true],
 ['objective invented result',f=>f.objectiveReport.checks[0].result='failed'],
 ['objective failed result with review passed',f=>{f.objectiveReport.checks[0].result='failed';f.objectiveReport.result='failed';}],
 ['objective arbitrary check',f=>f.objectiveReport.checks[0].code='arbitrary'],
 ['objective unbound file',f=>{f.objectiveReport.checks[0].target={role:'slide',slideIndex:1,pair:null,elementId:null};f.objectiveReport.checks[0].fileHash=digest('wrong');}],
 ['objective free form expected',f=>f.objectiveReport.checks[0].expected={allow:true}],
 ['objective omitted checker',f=>f.objectiveReport.checks.pop()],
])test(`recomputed report hashes cannot bypass ${label}`,()=>{const f=evidenceFixture();edit(f);rebind(f);stale(()=>api.verifyQualityEvidence(f));});
test('final render cannot reuse a different preview image or metrics artifact identity',()=>{
 for(const edit of [f=>f.manifest.files[0].artifactRef.id=f.previewManifest.files[1].artifactRef.id,f=>f.manifest.metricsRef.id=f.previewManifest.metricsRef.id]){
  const f=evidenceFixture('final');edit(f);f.review.coverage.files=f.manifest.files.map(x=>({artifactId:x.artifactRef.id,sha256:x.artifactRef.sha256,rgbaSha256:x.rgbaSha256,viewedFull:true,viewedMobile:true})).sort((a,b)=>a.artifactId<b.artifactId?-1:1);rebind(f);stale(()=>api.verifyQualityEvidence(f));
 }
});
test('invalid target, ref, duplicate criterion and noncanonical sets cannot be smuggled behind a fresh proposal hash',()=>{
 for(const edit of [r=>r.criteria.push(structuredClone(r.criteria[0])),r=>r.coverage.files.reverse(),r=>r.checkerRefs.push(structuredClone(r.checkerRefs[0])),r=>r.qualificationRefs.push(structuredClone(r.qualificationRefs[0])),r=>r.criteria[0].target.elementId='../file',r=>r.coverage.slides=[2,1],r=>r.coverage.seams=[{from:1,to:3}],r=>r.manifestRef.path='outside']){
  const {review}=evidenceFixture();edit(review);sealReview(review);invalid(()=>api.validateQualityReview(review));
 }
});
test('missing checklist or viewing facts can be recorded only as not-verified',()=>{
 for(const edit of [r=>r.criteria=[],r=>r.coverage.files[0].viewedFull=false,r=>r.coverage.fullResolution=false]){
  const f=evidenceFixture();edit(f.review);f.review.verdict='not-verified';sealReview(f.review);assert.equal(api.validateQualityReview(f.review).verdict,'not-verified');assert.equal(api.verifyQualityEvidence(f).coverageComplete,false);
 }
});

test('rehashed final chain cannot substitute a preview selection or qualification',()=>{
 for(const edit of [
  f=>{f.previewManifest.qualifications[0].definitionHash=digest('different preview definition');},
  f=>{const p=f.previewManifest;p.selection={slideIndices:[1],seamPairs:[],policyId:'representative-risk@1'};p.selectionHash=canonicalHash(p.selection);p.files=p.files.filter(file=>file.role==='slide'&&file.slideIndex===1);},
 ]){
  const f=evidenceFixture('final');edit(f);f.manifest.upstream.previewManifestRef.sha256=canonicalHash(f.previewManifest);f.manifest.upstream.approvedSelectionHash=f.previewManifest.selectionHash;rebind(f);stale(()=>api.verifyQualityEvidence(f));
 }
});

test('UTC ISO timestamps preserve valid fractional precision without accepting impossible dates',()=>{
 for(const value of ['2026-10-16T21:01:00Z','2026-10-16T21:01:00.1Z','2026-10-16T21:01:00.123456Z']){
  const f=evidenceFixture();f.review.reviewedAt=value;f.manifest.createdAt=value;assert.equal(api.validateQualityReview(f.review).reviewedAt,value);assert.equal(api.validateRenderManifest(f.manifest).createdAt,value);
 }
 for(const value of ['2026-02-30T00:00:00.1Z','2026-10-16T24:00:00Z','2026-10-16T21:01:60Z','2026-10-16']){const f=evidenceFixture();f.review.reviewedAt=value;invalid(()=>api.validateQualityReview(f.review));}
});

test('contract 2 refs reject generic legacy aliases and mixed preview/final artifact kinds',()=>{
 for(const kind of ['preview','final']){
  for(const edit of [
   f=>f.review.manifestRef.kind='render-manifest',f=>f.review.manifestRef.kind=`render-manifest:${kind==='preview'?'final':'preview'}`,
   f=>f.review.objectiveReportRef.kind='objective-report',f=>f.review.objectiveReportRef.kind=`objective-report:${kind==='preview'?'final':'preview'}`,
  ]){const f=evidenceFixture(kind);edit(f);sealReview(f.review);invalid(()=>api.validateQualityReview(f.review));}
  for(const edit of [
   f=>f.manifest.inputsRef.kind='run-inputs',f=>f.manifest.metricsRef.kind='render-metrics',f=>f.manifest.metricsRef.kind=`composition-metrics:${kind==='preview'?'final':'preview'}`,
   f=>f.manifest.files[0].artifactRef.kind='render-slide',f=>f.manifest.files[0].artifactRef.kind=`render-slide:${kind}:2`,f=>f.manifest.files[0].artifactRef.kind=`render-slide:${kind==='preview'?'final':'preview'}:1`,
   f=>f.manifest.files.find(x=>x.role==='seam').artifactRef.kind=`render-seam:${kind}:2-3`,
  ]){const f=evidenceFixture(kind);edit(f);invalid(()=>api.validateRenderManifest(f.manifest));}
 }
});

test('public schemas enumerate only Q01 persisted scoped artifact kinds',async()=>{
 const {readFile}=await import('node:fs/promises');
 const review=JSON.parse(await readFile(new URL('../../shared/quality-review.schema.json',import.meta.url),'utf8'));
 const manifest=JSON.parse(await readFile(new URL('../../shared/render-manifest.schema.json',import.meta.url),'utf8'));
 assert.deepEqual(review.$defs.manifestRef.properties.kind.enum,['render-manifest:preview','render-manifest:final']);
 assert.deepEqual(review.$defs.objectiveRef.properties.kind.enum,['objective-report:preview','objective-report:final']);
 assert.equal(manifest.$defs.inputsRef.properties.kind.const,'inputs');
 assert.deepEqual(manifest.$defs.metricsRef.properties.kind.enum,['composition-metrics:preview','composition-metrics:final']);
 assert.equal(manifest.$defs.manifestRef.properties.kind.const,'render-manifest:preview');assert.equal(manifest.$defs.reviewRef.properties.kind.const,'quality-review:preview');
});
