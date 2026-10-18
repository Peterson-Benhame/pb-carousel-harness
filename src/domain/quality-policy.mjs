import {canonicalHash,canonicalJson} from './canonical-json.mjs';
import {exactKeys} from './brand-schema.mjs';
import {validateIdentifier} from './identifiers.mjs';
import {validateQualityReview,fingerprintQualityReviewProposal} from './quality-evidence.mjs';
import {PublicError,invalidArgument} from './errors.mjs';

const stages=['inputs','copy-approval','concept-approval','assets-approval','preview-render','preview-review','preview-approval','render','validate','quality-review','package'];
const equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
const stale=()=>{throw new PublicError('QUALITY_EVIDENCE_STALE','Evidência editorial não corresponde ao pedido e à operação persistidos.');};
export function qualityPhaseRequirements({phase,kind}={}){
 const end={preview:4,render:7,validate:8,package:10,complete:11};
 if(phase==='review'){if(!['preview','final'].includes(kind))throw invalidArgument('Tipo de parecer obrigatório.');return Object.freeze(stages.slice(0,kind==='preview'?5:9));}
 if(!Object.hasOwn(end,phase)||kind!==undefined)throw invalidArgument('Fase de produção inválida.');
 return Object.freeze(stages.slice(0,end[phase]));
}
export function reviewStage(kind){if(!['preview','final'].includes(kind))throw invalidArgument('Tipo de parecer inválido.');return kind==='preview'?'preview-review':'quality-review';}
export function deriveQualityVerdict({objectiveResult,coverage,criteria,findings}){
 if(objectiveResult==='failed'||criteria.some(c=>c.result==='failed')||findings.some(f=>f.severity==='blocking'))return 'failed';
 const targets=[...coverage.slides.map(slideIndex=>({role:'slide',slideIndex,pair:null,elementId:null})),...coverage.seams.map(pair=>({role:'seam',slideIndex:null,pair,elementId:null})),...(coverage.panorama?[{role:'panorama',slideIndex:null,pair:null,elementId:null}]:[])];
 const complete=targets.every(target=>['legibility','hierarchy','composition','rhythm','visual-semantics','brand-finish'].every(id=>criteria.some(c=>c.criterionId===id&&equal(c.target,target))));
 if(!complete||objectiveResult!=='passed'||!coverage.fullResolution||coverage.mobileWidth!==360||coverage.files.some(f=>!f.viewedFull||!f.viewedMobile)||criteria.some(c=>c.result!=='met'))return 'not-verified';
 return 'passed';
}
/** Pure provenance checks. Only the private human gateway issues a live receipt.
 * Persisted authority is the matching request + service operation + artifact;
 * raw reviewer/actor flags and arbitrary verifier callbacks never suffice. */
export function verifyQualityReviewProvenance({review,reviewRef,request,operation}){
 try{
  const r=validateQualityReview(review);
  if(!reviewRef||reviewRef.id!==r.id||reviewRef.kind!==`quality-review:${r.kind}`||reviewRef.version!==r.version||reviewRef.sha256!==canonicalHash(r))stale();
  if(!request||request.id!==r.confirmationRequestId||request.brand_id!==r.brandId||request.run_id!==r.runId||request.kind!==`review-${r.kind}`||request.object_fingerprint!==r.objectFingerprint||request.object_artifact_id!==r.manifestRef.id||request.status!==(r.verdict==='passed'?'confirmed':'rejected')||request.resolved_at!==r.reviewedAt)stale();
  if(!operation||operation.operation!=='run.quality-review.decide'||operation.brand_id!==r.brandId||operation.run_id!==r.runId||operation.canonical_version!==1)stale();
  const result=JSON.parse(operation.result_json);exactKeys(result,['review','reviewRef','evidence']);
  if(!equal(result.review,r)||!equal(result.reviewRef,reviewRef))stale();
  const e=result.evidence;exactKeys(e,['schemaVersion','operationRequestId','proposal','answers','receipt']);
  if(e.schemaVersion!==1||e.operationRequestId!==operation.request_id)stale();
  const p=e.proposal,a=e.answers,c=e.receipt;
  exactKeys(p,['schemaVersion','brandId','runId','kind','confirmationRequestId','runVersion','objectFingerprint','manifestRef','objectiveReportRef','manifest','rubricRef','checkerRefs']);
  if(p.schemaVersion!==1||!Number.isSafeInteger(p.runVersion)||p.runVersion<1||canonicalHash(p.manifest)!==r.manifestRef.sha256||!equal(p.rubricRef,r.rubricRef)||!equal(p.checkerRefs,r.checkerRefs))stale();
  exactKeys(c,['id','sessionId','channel','confirmedAt','proposalHash','reviewProposalHash']);validateIdentifier(c.id);validateIdentifier(c.sessionId);
  exactKeys(a,['coverage','criteria','findings']);
  for(const key of ['brandId','runId','kind','confirmationRequestId','objectFingerprint','manifestRef','objectiveReportRef'])if(!equal(p[key],r[key]))stale();
  if(!equal(a.coverage,r.coverage)||!equal(a.criteria,r.criteria)||!equal(a.findings,r.findings))stale();
  if(c.channel!=='local-terminal'||c.id!==r.reviewer.receiptId||c.sessionId!==r.reviewer.sessionId||c.confirmedAt!==r.reviewedAt||c.proposalHash!==canonicalHash(p)||c.reviewProposalHash!==r.reviewProposalHash||c.reviewProposalHash!==fingerprintQualityReviewProposal({objectFingerprint:r.objectFingerprint,confirmationRequestId:r.confirmationRequestId,...a}))stale();
  if(operation.payload_hash!==canonicalHash({operation:'run.quality-review.decide',brandId:r.brandId,runId:r.runId,payload:{proposal:p,answers:a}}))stale();
  return Object.freeze({humanReceiptVerified:true,operationRequestId:operation.request_id,reviewProposalHash:r.reviewProposalHash});
 }catch{stale();}
}
export function qualificationRendererHash(renderer){return canonicalHash({identityVersion:1,id:renderer.id,files:Object.fromEntries(Object.entries(renderer.files).filter(([file])=>file!=='shared/layouts/editorial-composed-v1.json'))});}
