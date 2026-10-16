import { createInterface } from 'node:readline/promises';
import { canonicalJson, canonicalHash } from '../../domain/canonical-json.mjs';
import { approvalRequired, issueBrandConfirmation, requireBrandConfirmation } from '../../domain/brand-confirmation.mjs';
export { requireBrandConfirmation }; 


/** Internal terminal adapter. Injected streams/ask exist for deterministic tests,
 * never as JSON/plugin arguments. TTY checks are not a hostile-process boundary.
 * Receipts are process-local capabilities, not serializable actor/approved flags.
 */
export async function confirmBrandProposal(proposal,{input=process.stdin,output=process.stderr,argv=process.argv.slice(2),ask}={}) {
 if(input.isTTY!==true||output.isTTY!==true||argv.some(arg=>/^--(?:yes|y|approve(?:d)?|confirm(?:ed)?|actor|json)(?:=|$)/i.test(arg)||arg==='-y'))throw approvalRequired();
 const snapshot=JSON.parse(canonicalJson(proposal)),fingerprint=canonicalHash(snapshot);
 output.write(`Alteração permanente de marca. Revise todos os valores:\n${JSON.stringify(snapshot,null,2)}\nSHA-256: ${fingerprint}\n`);
 let rl,answer;
 try {
  if(!ask){
   rl=createInterface({input,output,terminal:true});
   const controller=new AbortController();
   rl.once('close',()=>controller.abort());
   rl.once('SIGINT',()=>{controller.abort();rl.close();});
   ask=()=>rl.question('Digite CONFIRMAR para salvar; qualquer outra resposta cancela: ',{signal:controller.signal});
  }
  answer=await ask();
 } catch(error){if(['AbortError','ERR_USE_AFTER_CLOSE'].includes(error.name)||error.code==='ERR_USE_AFTER_CLOSE')return null;throw error;}
 finally {rl?.close();}
 if(answer!=='CONFIRMAR')return null;
 return issueBrandConfirmation(snapshot);
}

import {validateApprovalProposal,issueApprovalConfirmation,approvalRequired as runApprovalRequired} from '../../domain/approval-policy.mjs';
/** Internal consent adapter. Review attestation is a different gateway/receipt.
 * No actor, approval flag, serialized receipt or conversation is accepted here. */
export async function confirmApprovalProposal(proposal,{input=process.stdin,output=process.stderr,argv=process.argv.slice(2),ask}={}) {
 if(input.isTTY!==true||output.isTTY!==true||argv.some(arg=>/^--(?:yes|y|approve(?:d)?|confirm(?:ed)?|actor|json)(?:=|$)/i.test(arg)||arg==='-y'))throw runApprovalRequired();
 const snapshot=validateApprovalProposal(proposal);
 output.write(`Consentimento de ${snapshot.kind}. Revise o objeto completo:\n${JSON.stringify(snapshot,null,2)}\nSHA-256: ${snapshot.objectFingerprint}\n`);
 let rl,answer;
 try {
  if(!ask){rl=createInterface({input,output,terminal:true});const controller=new AbortController();rl.once('close',()=>controller.abort());rl.once('SIGINT',()=>{controller.abort();rl.close();});ask=()=>rl.question('Digite CONFIRMAR para aprovar, REJEITAR para rejeitar; outra resposta cancela: ',{signal:controller.signal});}
  answer=await ask();
 }catch(error){if(['AbortError','ERR_USE_AFTER_CLOSE'].includes(error.name)||error.code==='ERR_USE_AFTER_CLOSE')return null;throw error;}
 finally{rl?.close();}
 if(!['CONFIRMAR','REJEITAR'].includes(answer))return null;
 return issueApprovalConfirmation(snapshot,answer==='CONFIRMAR'?'approved':'rejected');
}
