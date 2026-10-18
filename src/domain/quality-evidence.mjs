import { canonicalHash, canonicalJson } from './canonical-json.mjs';
import { validateIdentifier } from './identifiers.mjs';
import { invalidArgument, PublicError } from './errors.mjs';
import { QUALIFICATION_IDS } from './layout-qualification.mjs';
import { EDITORIAL_SNAPSHOT_FILES, HISTORICAL_EDITORIAL_SNAPSHOT_FILES } from './run-snapshot.mjs';
import { getReviewRubric } from '../quality/review-rubric.mjs';

export const QUALITY_REVIEW_VERSION = 1;
export const RENDER_MANIFEST_VERSION = 2;
const RUBRIC = getReviewRubric(1);
const CRITERIA = RUBRIC.criteria.map(c => c.id);
const CHECK_CODES = ['copy-exact','text-bounds','collision','typography','contrast','asset-geometry','continuity-independent','file-integrity'];
const RENDERER_FILES = Object.freeze([...EDITORIAL_SNAPSHOT_FILES].sort());
const HISTORICAL_RENDERER_FILES = Object.freeze([...HISTORICAL_EDITORIAL_SNAPSHOT_FILES].sort());
const RENDERER_FILE_SETS = Object.freeze([HISTORICAL_RENDERER_FILES, RENDERER_FILES]);
const FONT_IDS = ['Anton','Manrope','JetBrains Mono','nimbus-roman-italic@1'];
const OBJECT_FIELDS = ['brandId','runId','kind','renderAttemptId','manifestRef','planHash','selectionHash','qualificationRefs','objectiveReportRef','rubricRef','checkerRefs'];
const PROPOSAL_FIELDS = ['objectFingerprint','confirmationRequestId','coverage','criteria','findings'];
const REVIEW_FIELDS = ['schemaVersion','id','brandId','runId','version','kind','renderAttemptId','objectFingerprint','reviewProposalHash','manifestRef','manifestHash','planHash','selectionHash','qualificationRefs','objectiveReportRef','rubricRef','checkerRefs','method','reviewer','confirmationRequestId','reviewedAt','coverage','criteria','findings','verdict'];
const MANIFEST_FIELDS = ['schemaVersion','id','brandId','runId','version','kind','renderAttemptId','stageFingerprint','snapshotHash','inputsRef','planRef','selection','selectionHash','renderer','runtimeHash','resourceManifestHash','qualifications','fonts','upstream','files','metricsRef','createdAt'];
const fail = () => { throw invalidArgument('Registro de evidência de qualidade inválido ou incompatível.'); };
const check = condition => { if (!condition) fail(); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isHash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const positive = v => Number.isSafeInteger(v) && v > 0;
const eq = (a,b) => canonicalJson(a) === canonicalJson(b);
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const pick = (v,fields) => Object.fromEntries(fields.map(k => [k,v[k]]));
function plain(value) { return JSON.parse(canonicalJson(value)); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function keys(value, required, optional = []) { check(object(value) && required.every(k => Object.hasOwn(value,k)) && Object.keys(value).every(k => required.includes(k) || optional.includes(k))); }
function list(value,min=0) { check(Array.isArray(value) && value.length >= min); return value; }
function unique(value,key=x=>x) { check(new Set(value.map(key)).size === value.length); }
function ordered(value,key=x=>x) { for(let i=1;i<value.length;i++)check(compare(key(value[i-1]),key(value[i]))<0); }
function identifier(value) { validateIdentifier(value); }
function hash(value) { check(isHash(value)); }
function text(value) { check(typeof value === 'string' && value.trim().length > 0); }
function time(value) { check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value));const date=new Date(value);check(Number.isFinite(date.valueOf()) && date.toISOString().slice(0,19)===value.slice(0,19)); }
function kind(value) { check(['preview','final'].includes(value)); }
function artifact(value,expected) { keys(value,['id','kind','version','sha256']);identifier(value.id);check((Array.isArray(expected)?expected:[expected]).includes(value.kind) && positive(value.version));hash(value.sha256); }
function resource(value,expected) { keys(value,['id','version','sha256']);check(value.id===expected && positive(value.version));hash(value.sha256); }
function qualification(value) { keys(value,['id','version','sha256','definitionHash']);check(QUALIFICATION_IDS.includes(value.id) && positive(value.version));hash(value.sha256);hash(value.definitionHash); }
function qualifications(value) { list(value,1).forEach(qualification);unique(value,q=>q.id);ordered(value,q=>q.id); }
function checkers(value) { check(list(value,1).length===1);resource(value[0],'editorial-objective-checkers@1'); }
function pair(value) { keys(value,['from','to']);check(positive(value.from) && value.to===value.from+1); }
function indices(value) { list(value,1).forEach(i=>check(positive(i)));ordered(value); }
function pairs(value,slides) { list(value).forEach(p=>{pair(p);if(slides)check(slides.includes(p.from)&&slides.includes(p.to));});ordered(value,p=>p.from); }
function target(value,allowManifest=false) {
  keys(value,['role','slideIndex','pair','elementId']);
  check((allowManifest?['slide','seam','panorama','manifest']:['slide','seam','panorama']).includes(value.role));
  if(value.role==='slide')check(positive(value.slideIndex)&&value.pair===null);
  else if(value.role==='seam'){check(value.slideIndex===null);pair(value.pair);}
  else check(value.slideIndex===null&&value.pair===null);
  check(value.elementId===null || typeof value.elementId==='string' && /^[a-z][a-z0-9:-]{0,159}$/.test(value.elementId));
}
const rootTarget = t => ({...t,elementId:null});
const targetKey = t => canonicalJson(rootTarget(t));
function coverage(value,reviewKind) {
  keys(value,['files','slides','seams','panorama','fullResolution','mobileWidth']);
  indices(value.slides);pairs(value.seams,value.slides);check(typeof value.fullResolution==='boolean' && value.mobileWidth===360);
  if(value.panorama!==null)identifier(value.panorama);
  if(reviewKind==='preview')check(value.panorama===null && value.slides.length<=6);
  if(reviewKind==='final')check(value.panorama!==null && value.slides.every((n,i)=>n===i+1));
  list(value.files,1).forEach(f=>{keys(f,['artifactId','sha256','rgbaSha256','viewedFull','viewedMobile']);identifier(f.artifactId);hash(f.sha256);hash(f.rgbaSha256);check(typeof f.viewedFull==='boolean'&&typeof f.viewedMobile==='boolean');});
  unique(value.files,f=>f.artifactId);ordered(value.files,f=>f.artifactId);
  check(value.files.length===value.slides.length+value.seams.length+Number(value.panorama!==null));
  if(value.panorama!==null)check(value.files.some(f=>f.artifactId===value.panorama));
}
function coverageTargets(c) { return [...c.slides.map(slideIndex=>({role:'slide',slideIndex,pair:null,elementId:null})),...c.seams.map(pair=>({role:'seam',slideIndex:null,pair,elementId:null})),...(c.panorama===null?[]:[{role:'panorama',slideIndex:null,pair:null,elementId:null}])]; }
function checklist(criteria,findings,c) {
  const targets=new Set(coverageTargets(c).map(targetKey));
  list(criteria).forEach(item=>{keys(item,['criterionId','target','result','observation']);check(CRITERIA.includes(item.criterionId)&&RUBRIC.results.includes(item.result));target(item.target);check(targets.has(targetKey(item.target)));text(item.observation);});
  unique(criteria,c=>canonicalJson([c.criterionId,c.target]));
  list(findings).forEach(f=>{keys(f,['id','criterionId','target','severity','description']);identifier(f.id);check(CRITERIA.includes(f.criterionId)&&['blocking','advisory'].includes(f.severity));target(f.target);check(targets.has(targetKey(f.target)));text(f.description);});
  unique(findings,f=>f.id);ordered(findings,f=>f.id);
}
function completeCoverage(review) {
  return review.coverage.fullResolution && review.coverage.files.every(f=>f.viewedFull&&f.viewedMobile)
    && coverageTargets(review.coverage).every(t=>CRITERIA.every(id=>review.criteria.some(c=>c.criterionId===id&&eq(c.target,t))));
}
function validateObjectFields(v) {
  keys(v,OBJECT_FIELDS);identifier(v.brandId);identifier(v.runId);identifier(v.renderAttemptId);kind(v.kind);
  artifact(v.manifestRef,`render-manifest:${v.kind}`);artifact(v.objectiveReportRef,`objective-report:${v.kind}`);hash(v.planHash);hash(v.selectionHash);
  qualifications(v.qualificationRefs);resource(v.rubricRef,'editorial-quality@1');checkers(v.checkerRefs);
}
/** The identity excludes the review/receipt created after a decision. It proves
 * only exact JSON identity, never provenance, byte integrity or consent. */
export function fingerprintQualityReviewObject(value) { const v=plain(value);validateObjectFields(v);return canonicalHash({contractVersion:2,...v}); }
/** Bind the exact checklist and declared pixel coverage to the request. */
export function fingerprintQualityReviewProposal(value) {
  const v=plain(value);keys(v,PROPOSAL_FIELDS);hash(v.objectFingerprint);identifier(v.confirmationRequestId);coverage(v.coverage);checklist(v.criteria,v.findings,v.coverage);return canonicalHash(v);
}
/** Structural validation only. A declared passed verdict and syntactically
 * valid human-local IDs are not a trusted human receipt. This function cannot
 * issue/consume a capability, authorize production, or attest pixel viewing. */
export function validateQualityReview(value) {
  const v=plain(value);keys(v,REVIEW_FIELDS);check(v.schemaVersion===1&&positive(v.version));identifier(v.id);
  validateObjectFields(pick(v,OBJECT_FIELDS));hash(v.objectFingerprint);hash(v.reviewProposalHash);hash(v.manifestHash);
  check(v.manifestHash===v.manifestRef.sha256&&v.objectFingerprint===fingerprintQualityReviewObject(pick(v,OBJECT_FIELDS)));
  check(v.method==='human-local-assisted@1');keys(v.reviewer,['kind','gateway','sessionId','receiptId']);
  check(v.reviewer.kind==='human-local'&&v.reviewer.gateway==='local-terminal');identifier(v.reviewer.sessionId);identifier(v.reviewer.receiptId);identifier(v.confirmationRequestId);time(v.reviewedAt);
  coverage(v.coverage,v.kind);checklist(v.criteria,v.findings,v.coverage);
  check(v.reviewProposalHash===fingerprintQualityReviewProposal(pick(v,PROPOSAL_FIELDS)));
  check(['passed','failed','not-verified'].includes(v.verdict));
  const failed=v.criteria.some(c=>c.result==='failed')||v.findings.some(f=>f.severity==='blocking');
  if(failed)check(v.verdict==='failed');
  if(v.verdict==='passed')check(!failed&&completeCoverage(v)&&v.criteria.every(c=>c.result==='met'));
  return freeze(v);
}
function selection(value,manifestKind) {
  keys(value,['slideIndices','seamPairs','policyId']);indices(value.slideIndices);pairs(value.seamPairs,value.slideIndices);
  check(value.policyId===(manifestKind==='preview'?'representative-risk@1':'all-slides@1'));
  if(manifestKind==='preview')check(value.slideIndices.length<=6);
  else check(value.slideIndices.every((n,i)=>n===i+1));
}
function renderer(value) { keys(value,['id','files']);check(value.id==='editorial-composed@1');check(RENDERER_FILE_SETS.some(files=>eq(Object.keys(value.files).sort(),files)));Object.values(value.files).forEach(hash); }
function fonts(value) { list(value,1).forEach(f=>{keys(f,['id','sha256']);check(FONT_IDS.includes(f.id));hash(f.sha256);});unique(value,f=>f.id);ordered(value,f=>f.id); }
const fileTarget = f => ({role:f.role,slideIndex:f.slideIndex,pair:f.pair,elementId:null});
/** JSON/relations only. No filesystem/database/lease/PNG decoder is consulted.
 * Runtime code must still resolve scoped refs and recheck actual bytes. */
export function validateRenderManifest(value) {
  const v=plain(value);keys(v,MANIFEST_FIELDS);check(v.schemaVersion===2&&positive(v.version));
  for(const k of ['id','brandId','runId','renderAttemptId'])identifier(v[k]);kind(v.kind);
  for(const k of ['stageFingerprint','snapshotHash','selectionHash','runtimeHash','resourceManifestHash'])hash(v[k]);
  artifact(v.inputsRef,'inputs');artifact(v.planRef,'composition-plan');artifact(v.metricsRef,`composition-metrics:${v.kind}`);
  selection(v.selection,v.kind);check(canonicalHash(v.selection)===v.selectionHash);renderer(v.renderer);qualifications(v.qualifications);fonts(v.fonts);time(v.createdAt);
  const upstreamKeys=['copyApprovalId','conceptApprovalId','assetsEvidenceRef'];
  if(v.kind==='final')upstreamKeys.push('previewManifestRef','previewReviewRef','previewApprovalId','approvedSelectionHash');
  keys(v.upstream,upstreamKeys);identifier(v.upstream.copyApprovalId);identifier(v.upstream.conceptApprovalId);
  artifact(v.upstream.assetsEvidenceRef,['assets-evidence','assets-approval','no-assets-evidence']);
  if(v.kind==='final'){artifact(v.upstream.previewManifestRef,'render-manifest:preview');artifact(v.upstream.previewReviewRef,'quality-review:preview');identifier(v.upstream.previewApprovalId);hash(v.upstream.approvedSelectionHash);check(v.upstream.previewManifestRef.id!==v.id);}
  const expected=[...v.selection.slideIndices.map(slideIndex=>({role:'slide',slideIndex,pair:null,elementId:null})),...v.selection.seamPairs.map(pair=>({role:'seam',slideIndex:null,pair,elementId:null})),...(v.kind==='final'?[{role:'panorama',slideIndex:null,pair:null,elementId:null}]:[])];
  list(v.files,1).forEach(f=>{keys(f,['artifactRef','role','slideIndex','pair','mediaType','width','height','size','rgbaSha256']);target(fileTarget(f));artifact(f.artifactRef,f.role==='slide'?`render-slide:${v.kind}:${f.slideIndex}`:f.role==='seam'?`render-seam:${v.kind}:${f.pair.from}-${f.pair.to}`:'render-panorama:final');hash(f.rgbaSha256);
    check(f.mediaType==='image/png'&&f.height===1350&&positive(f.size)&&f.width===(f.role==='slide'?1080:f.role==='seam'?2160:1080*v.selection.slideIndices.length));});
  check(eq(v.files.map(fileTarget),expected));
  unique([v.id,v.inputsRef.id,v.planRef.id,v.metricsRef.id,...v.files.map(f=>f.artifactRef.id)]);
  return freeze(v);
}
function objective(report,manifest) {
  keys(report,['schemaVersion','brandId','runId','kind','renderAttemptId','manifestRef','checkerRefs','checks','result']);check(report.schemaVersion===1);checkers(report.checkerRefs);
  for(const k of ['brandId','runId','kind','renderAttemptId'])check(report[k]===manifest[k]);
  artifact(report.manifestRef,`render-manifest:${manifest.kind}`);check(eq(report.manifestRef,{id:manifest.id,kind:`render-manifest:${manifest.kind}`,version:manifest.version,sha256:canonicalHash(manifest)}));
  list(report.checks,1).forEach(c=>{keys(c,['code','target','fileHash','expected','observed','result']);check(CHECK_CODES.includes(c.code)&&['passed','failed','not-verified'].includes(c.result));target(c.target,true);check(typeof c.expected==='string'&&typeof c.observed==='string');
    if(c.target.role==='manifest')check(c.fileHash===null);
    else {const file=manifest.files.find(f=>targetKey(fileTarget(f))===targetKey(c.target));check(!!file&&c.fileHash===file.artifactRef.sha256);}
  });
  const result=report.checks.some(c=>c.result==='failed')?'failed':report.checks.some(c=>c.result==='not-verified')?'not-verified':'passed';check(report.result===result);
  if(result==='passed')check(CHECK_CODES.every(code=>report.checks.some(c=>c.code===code)));
}
function verifyPreviewFinal(manifest,preview,plan) {
  const p=validateRenderManifest(preview);check(p.kind==='preview'&&manifest.id!==p.id&&manifest.renderAttemptId!==p.renderAttemptId);
  unique([p.id,p.metricsRef.id,...p.files.map(f=>f.artifactRef.id),manifest.id,manifest.metricsRef.id,...manifest.files.map(f=>f.artifactRef.id)]);
  check(eq(manifest.upstream.previewManifestRef,{id:p.id,kind:'render-manifest:preview',version:p.version,sha256:canonicalHash(p)})&&manifest.upstream.approvedSelectionHash===p.selectionHash);
  for(const key of ['brandId','runId','snapshotHash','runtimeHash','resourceManifestHash','inputsRef','planRef','renderer','fonts'])check(eq(manifest[key],p[key]));
  for(const key of ['copyApprovalId','conceptApprovalId','assetsEvidenceRef'])check(eq(manifest.upstream[key],p.upstream[key]));
  check(eq(p.selection,pick(plan.previewSelection,['slideIndices','seamPairs','policyId'])));
  check(p.qualifications.every(q=>manifest.qualifications.some(final=>eq(final,q))));
  for(const f of p.files){const final=manifest.files.find(v=>eq(fileTarget(v),fileTarget(f)));check(!!final&&final.artifactRef.id!==f.artifactRef.id&&final.artifactRef.sha256===f.artifactRef.sha256&&final.rgbaSha256===f.rgbaSha256&&final.size===f.size);}
}
function verify(input) {
  const v=plain(input);keys(v,['review','manifest','objectiveReport','snapshot','plan','expected'],['previewManifest']);
  const r=validateQualityReview(v.review),m=validateRenderManifest(v.manifest),s=v.snapshot,p=v.plan,e=v.expected;
  keys(e,['brandId','runId','kind','renderAttemptId','manifestRef','objectiveReportRef']);
  for(const k of ['brandId','runId','kind','renderAttemptId'])check(e[k]===r[k]&&r[k]===m[k]);
  artifact(e.manifestRef,`render-manifest:${e.kind}`);artifact(e.objectiveReportRef,`objective-report:${e.kind}`);
  check(eq(r.manifestRef,e.manifestRef)&&eq(r.objectiveReportRef,e.objectiveReportRef));
  check(eq(r.manifestRef,{id:m.id,kind:`render-manifest:${m.kind}`,version:m.version,sha256:canonicalHash(m)}));
  check(r.objectiveReportRef.sha256===canonicalHash(v.objectiveReport));objective(v.objectiveReport,m);
  check(r.planHash===m.planRef.sha256&&r.selectionHash===m.selectionHash&&eq(r.qualificationRefs,m.qualifications)&&eq(r.checkerRefs,v.objectiveReport.checkerRefs));
  check(object(s)&&s.schemaVersion===2&&s.contractVersion===2&&s.pipelineVersion===2&&s.canonicalVersion===1&&s.qualityPolicyVersion===1&&s.brand?.id===r.brandId&&canonicalHash(s)===m.snapshotHash);
  check(object(p)&&p.schemaVersion===1&&p.brandId===m.brandId&&p.runId===m.runId&&p.id===m.planRef.id&&p.version===m.planRef.version&&canonicalHash(p)===m.planRef.sha256&&p.snapshotHash===m.snapshotHash&&p.rendererId===m.renderer.id);
  check(eq(s.renderer,m.renderer)&&eq(s.runtime.renderer,m.renderer)&&canonicalHash(s.runtime)===m.runtimeHash&&eq(s.fonts,m.fonts)&&s.resourceManifestRef.sha256===m.resourceManifestHash);
  check(eq(s.qualityPolicy.rubricRef,r.rubricRef)&&eq(s.qualityPolicy.checkerRefs,r.checkerRefs));
  list(s.qualifications,1);check(m.qualifications.every(q=>s.qualifications.some(allowed=>eq(q,allowed))));
  list(p.slides,1);check(p.slides.every((slide,i)=>slide.slideIndex===i+1));
  check(m.selection.slideIndices.every(i=>i<=p.slides.length));
  const used=[...new Map(m.selection.slideIndices.map(i=>p.slides[i-1].qualificationRef).map(q=>[q.id,q])).values()].sort((a,b)=>compare(a.id,b.id));check(eq(used,m.qualifications));
  const planSelection=m.kind==='preview'?pick(p.previewSelection,['slideIndices','seamPairs','policyId']):{slideIndices:p.slides.map(s=>s.slideIndex),seamPairs:[...new Map(list(p.continuities).map(c=>[c.from,{from:c.from,to:c.to}])).values()].sort((a,b)=>a.from-b.from),policyId:'all-slides@1'};
  check(eq(planSelection,m.selection));
  check(eq(r.coverage.slides,m.selection.slideIndices)&&eq(r.coverage.seams,m.selection.seamPairs)&&r.coverage.panorama===(m.files.find(f=>f.role==='panorama')?.artifactRef.id??null));
  check(r.coverage.files.length===m.files.length);
  for(const f of m.files){const c=r.coverage.files.find(c=>c.artifactId===f.artifactRef.id);check(!!c&&c.sha256===f.artifactRef.sha256&&c.rgbaSha256===f.rgbaSha256);}
  if(m.kind==='final')verifyPreviewFinal(m,v.previewManifest,p);else check(!Object.hasOwn(v,'previewManifest'));
  if(r.verdict==='passed')check(v.objectiveReport.result==='passed');
  return freeze({objectFingerprint:r.objectFingerprint,reviewProposalHash:r.reviewProposalHash,manifestHash:r.manifestHash,objectiveResult:v.objectiveReport.result,coverageComplete:completeCoverage(r),humanReceiptVerified:false,productionEligible:false});
}
/** Check exact declared links against explicit expected scoped artifact refs.
 * This is not assertProductionGate: it does not resolve artifact rows/bytes,
 * validate qualification release, verify a human receipt or grant authority.
 * Snapshot/plan full structural validation belongs to their own validators.
 * All incoherent/malformed chains fail closed with one sanitized stale error. */
export function verifyQualityEvidence(input) {
  try { return verify(input); }
  catch { throw new PublicError('QUALITY_EVIDENCE_STALE','Evidência de qualidade não corresponde ao objeto e à tentativa esperados.'); }
}
