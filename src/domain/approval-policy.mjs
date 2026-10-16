import {randomUUID} from 'node:crypto';
import {canonicalHash,canonicalJson} from './canonical-json.mjs';
import {exactKeys} from './brand-schema.mjs';
import {validateIdentifier} from './identifiers.mjs';
import {PublicError,invalidArgument} from './errors.mjs';

export const APPROVAL_STAGES=Object.freeze({copy:'copy-approval',concept:'concept-approval','creative-assets':'assets-approval',preview:'preview-approval'});
export const approvalRequired=()=>new PublicError('APPROVAL_REQUIRED','É necessária confirmação humana local do objeto exato.');
export const approvalStale=()=>new PublicError('APPROVAL_STALE','O objeto ou a execução mudou; revise um novo pedido de aprovação.');
const receipts=new WeakMap();
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function approvalStage(kind){if(!Object.hasOwn(APPROVAL_STAGES,kind))throw invalidArgument('Tipo de aprovação inválido.');return APPROVAL_STAGES[kind];}
const pick=(value,fields)=>Object.fromEntries(fields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
/** The exact editorial projection used by the versioned input fingerprints. */
export function approvalCopy(carousel){const copy=pick(carousel,['voiceMode','objective','slideCountException','slideCountExceptionReason','caption','cta','hashtags','altText','sources']);copy.slides=carousel.slides.map(s=>pick(s,['index','role','eyebrow','title','body','code','number','imageAlt']));return copy;}
export function approvalVisual(carousel){return {...pick(carousel,['theme','continuity']),slides:carousel.slides.map(s=>pick(s,['index','visualSlot']))};}
export function validateApprovalProposal(value){
 const p=JSON.parse(canonicalJson(value));exactKeys(p,['schemaVersion','brandId','runId','kind','confirmationRequestId','runVersion','objectFingerprint','objectArtifactRef','object']);
 if(p.schemaVersion!==1||!Number.isSafeInteger(p.runVersion)||p.runVersion<1||!hash(p.objectFingerprint))throw invalidArgument('Proposta de aprovação inválida.');
 for(const id of [p.brandId,p.runId,p.confirmationRequestId])validateIdentifier(id);approvalStage(p.kind);
 exactKeys(p.objectArtifactRef,['id','kind','version','sha256']);validateIdentifier(p.objectArtifactRef.id);
 if(!Number.isSafeInteger(p.objectArtifactRef.version)||p.objectArtifactRef.version<1||!hash(p.objectArtifactRef.sha256)||typeof p.objectArtifactRef.kind!=='string'||p.object===null||typeof p.object!=='object'||Array.isArray(p.object))throw invalidArgument('Objeto de aprovação inválido.');
 return p;
}
export function approvalDecision(value){if(!['approved','rejected'].includes(value))throw invalidArgument('Decisão inválida.');return value;}
/** Trusted in-process adapter boundary, like T08. Never a CLI/plugin operation.
 * This is not authentication against a process with unrestricted module/DB access. */
export function issueApprovalConfirmation(proposal,decision){const p=validateApprovalProposal(proposal);approvalDecision(decision);const receipt=Object.freeze({});receipts.set(receipt,Object.freeze({id:randomUUID(),channel:'local-terminal',confirmedAt:new Date().toISOString(),proposalHash:canonicalHash({proposal:p,decision}),decision}));return receipt;}
export function requireApprovalConfirmation(receipt,proposal,decision){const e=receipt&&receipts.get(receipt);if(!e||e.decision!==decision||e.proposalHash!==canonicalHash({proposal:validateApprovalProposal(proposal),decision}))throw approvalRequired();return e;}
export function consumeApprovalConfirmation(receipt){if(receipt)receipts.delete(receipt);}
