import { canonicalHash, canonicalJson } from '../../../src/domain/canonical-json.mjs';
import { getReviewRubric } from '../../../src/quality/review-rubric.mjs';
import resources from '../../../shared/resources.manifest.json' with { type: 'json' };

// Deliberately synthetic identifiers/hashes and declared observations. These
// fixtures never issue a human receipt, qualify a layout or read actual pixels.
export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const digest = label => canonicalHash({ synthetic: label });
export const ref = (n, kind, sha256 = digest(n)) => ({ id: id(n), kind, version: 1, sha256 });
export const objectFields = r => Object.fromEntries(['brandId','runId','kind','renderAttemptId','manifestRef','planHash','selectionHash','qualificationRefs','objectiveReportRef','rubricRef','checkerRefs'].map(k => [k,r[k]]));
export function sealReview(review) {
  review.manifestHash = review.manifestRef.sha256;
  review.objectFingerprint = canonicalHash({ contractVersion: 2, ...objectFields(review) });
  review.reviewProposalHash = canonicalHash(Object.fromEntries(['objectFingerprint','confirmationRequestId','coverage','criteria','findings'].map(k => [k,review[k]])));
  return review;
}
export function evidenceFixture(kind = 'preview') {
  const checkerRefs = [{ id: 'editorial-objective-checkers@1', version: 1, sha256: digest('checker') }];
  const rubricRef = { id: 'editorial-quality@1', version: 1, sha256: digest('rubric-module') };
  const q = { id: 'qualification-content-flow@1', version: 1, sha256: digest('synthetic-candidate'), definitionHash: digest('definition') };
  const renderer = { id: 'editorial-composed@1', files: Object.fromEntries(resources.renderers.find(r => r.id === 'editorial-composed@1').files.map(p => [p, digest(p)])) };
  const fonts = [{ id: 'Anton', sha256: digest('font') }];
  const snapshot = { schemaVersion: 2, contractVersion: 2, pipelineVersion: 2, canonicalVersion: 1, qualityPolicyVersion: 1,
    brand: { id: id(1) }, renderer, runtime: { renderer, node: 'synthetic' }, fonts, fontBindings: [], qualifications: [q],
    qualityPolicy: { rubricRef, checkerRefs }, resourceManifestRef: { id: 'resources-manifest@2', version: 2, sha256: digest('resources') } };
  const plan = { schemaVersion: 1, id: id(3), brandId: id(1), runId: id(2), version: 1, snapshotHash: canonicalHash(snapshot),
    rendererId: renderer.id, slides: [1,2,3].map(slideIndex => ({slideIndex,qualificationRef:q})), continuities: [{from:1,to:2}],
    previewSelection: { slideIndices:[1,2], seamPairs:[{from:1,to:2}], policyId:'representative-risk@1' } };
  const selection = kind === 'preview' ? structuredClone(plan.previewSelection) : {slideIndices:[1,2,3],seamPairs:[{from:1,to:2}],policyId:'all-slides@1'};
  const files = [];
  const add = (role, slideIndex = null, pair = null) => files.push({ artifactRef: ref(20+files.length+(kind==='final'?100:0),role==='slide'?`render-slide:${kind}:${slideIndex}`:role==='seam'?`render-seam:${kind}:${pair.from}-${pair.to}`:'render-panorama:final',digest({role,slideIndex,pair})), role, slideIndex, pair,
    mediaType:'image/png',width:role==='slide'?1080:role==='seam'?2160:selection.slideIndices.length*1080,height:1350,size:100,rgbaSha256:digest({pixels:role,slideIndex,pair}) });
  selection.slideIndices.forEach(i=>add('slide',i)); selection.seamPairs.forEach(p=>add('seam',null,p)); if(kind==='final')add('panorama');
  const manifest = { schemaVersion:2,id:id(kind==='final'?104:4),brandId:id(1),runId:id(2),version:1,kind,renderAttemptId:id(kind==='final'?105:5),stageFingerprint:digest('stage'),snapshotHash:canonicalHash(snapshot),
    inputsRef:ref(6,'inputs'),planRef:ref(3,'composition-plan',canonicalHash(plan)),selection,selectionHash:canonicalHash(selection),renderer,
    runtimeHash:canonicalHash(snapshot.runtime),resourceManifestHash:snapshot.resourceManifestRef.sha256,qualifications:[q],fonts,
    upstream:{copyApprovalId:id(7),conceptApprovalId:id(8),assetsEvidenceRef:ref(9,'assets-evidence')},files,metricsRef:ref(kind==='final'?110:10,`composition-metrics:${kind}`),createdAt:'2026-10-16T21:00:00.000Z' };
  let previewManifest;
  if(kind==='final') {
    previewManifest=evidenceFixture().manifest;
    Object.assign(manifest.upstream,{previewManifestRef:ref(4,'render-manifest:preview',canonicalHash(previewManifest)),previewReviewRef:ref(11,'quality-review:preview'),previewApprovalId:id(12),approvedSelectionHash:previewManifest.selectionHash});
  }
  const manifestRef = ref(kind==='final'?104:4,`render-manifest:${kind}`,canonicalHash(manifest));
  const objectiveReport = { schemaVersion:1,brandId:id(1),runId:id(2),kind,renderAttemptId:manifest.renderAttemptId,manifestRef,checkerRefs,
    checks: ['copy-exact','text-bounds','collision','typography','contrast','asset-geometry','continuity-independent','file-integrity'].map(code=>({code,target:{role:'manifest',slideIndex:null,pair:null,elementId:null},fileHash:null,expected:'synthetic',observed:'synthetic',result:'passed'})),result:'passed' };
  const objectiveReportRef=ref(kind==='final'?113:13,`objective-report:${kind}`,canonicalHash(objectiveReport));
  const targets=files.map(f=>({role:f.role,slideIndex:f.slideIndex,pair:f.pair,elementId:null}));
  const review = sealReview({ schemaVersion:1,id:id(kind==='final'?114:14),brandId:id(1),runId:id(2),version:1,kind,renderAttemptId:manifest.renderAttemptId,
    objectFingerprint:'',reviewProposalHash:'',manifestRef,manifestHash:manifestRef.sha256,planHash:manifest.planRef.sha256,selectionHash:manifest.selectionHash,qualificationRefs:[q],objectiveReportRef,rubricRef,checkerRefs,
    method:'human-local-assisted@1',reviewer:{kind:'human-local',gateway:'local-terminal',sessionId:id(15),receiptId:id(16)},confirmationRequestId:id(17),reviewedAt:'2026-10-16T21:01:00.000Z',
    coverage:{files:files.map(f=>({artifactId:f.artifactRef.id,sha256:f.artifactRef.sha256,rgbaSha256:f.rgbaSha256,viewedFull:true,viewedMobile:true})).sort((a,b)=>a.artifactId.localeCompare(b.artifactId)),slides:selection.slideIndices,seams:selection.seamPairs,panorama:files.find(f=>f.role==='panorama')?.artifactRef.id??null,fullResolution:true,mobileWidth:360},
    criteria:targets.flatMap(target=>getReviewRubric(1).criteria.map(c=>({criterionId:c.id,target,result:'met',observation:'Synthetic declared observation; no trusted human review.'}))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),findings:[],verdict:'passed' });
  return JSON.parse(canonicalJson({review,manifest,objectiveReport,snapshot,plan,expected:{brandId:id(1),runId:id(2),kind,renderAttemptId:manifest.renderAttemptId,manifestRef,objectiveReportRef},...(previewManifest?{previewManifest}:{})}));
}
