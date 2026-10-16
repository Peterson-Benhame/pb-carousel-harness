import { randomUUID } from 'node:crypto';
import { canonicalHash } from './canonical-json.mjs';
import { PublicError } from './errors.mjs';

const receipts=new WeakMap();
export const approvalRequired=()=>new PublicError('APPROVAL_REQUIRED','É necessária confirmação humana local da proposta exata.');
/** Trusted in-process adapter capability only, never a public command, plugin
 * operation or JSON endpoint. An arbitrary process with module/database access is
 * outside the local confirmation boundary; this is not OS authentication.
 */
export function issueBrandConfirmation(proposal) {
 const receipt=Object.freeze({});
 receipts.set(receipt,Object.freeze({id:randomUUID(),fingerprint:canonicalHash(proposal),channel:'local-terminal',confirmedAt:new Date().toISOString()}));
 return receipt;
}
export function requireBrandConfirmation(receipt,proposal) {
 const evidence=receipt&&receipts.get(receipt);
 if(!evidence||evidence.fingerprint!==canonicalHash(proposal))throw approvalRequired();
 return evidence;
}

// Consume only after the DB transaction succeeds. Rollback retains the receipt.
export function consumeBrandConfirmation(receipt) { if(receipt)receipts.delete(receipt); }
