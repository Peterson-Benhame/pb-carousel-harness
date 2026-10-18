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


import { randomUUID } from 'node:crypto';
import { PublicError } from '../../domain/errors.mjs';
import { fingerprintQualityReviewProposal } from '../../domain/quality-evidence.mjs';
import { getReviewRubric } from '../../quality/review-rubric.mjs';
import { openQualityPresentation } from './quality-presentation.mjs';

const qualityReceipts = new WeakMap();
const reviewUnavailable = () => new PublicError('QUALITY_REVIEW_UNAVAILABLE','A revisão exige apresentação dos pixels e confirmação humana no terminal local.');
const reviewRequired = () => new PublicError('EDITORIAL_REVIEW_REQUIRED','É necessária confirmação humana local da revisão exata.');
const reviewStale = () => new PublicError('QUALITY_EVIDENCE_STALE','O objeto ou as respostas mudaram; refaça a revisão local.');
function freezeReview(value) { if(value && typeof value==='object'){Object.values(value).forEach(freezeReview);Object.freeze(value);}return value; }
function answersHash(proposal,answers) { return fingerprintQualityReviewProposal({objectFingerprint:proposal.objectFingerprint,confirmationRequestId:proposal.confirmationRequestId,...answers}); }

/** Internal terminal gateway. Streams/ask are terminal-adapter seams, never
 * CLI/plugin JSON options. There is no presenter/verifier callback and no exported
 * receipt issuer: a pixel session plus every answer and final confirmation are
 * mandatory. This is local attestation, not hostile-process/OS authentication.
 */
export async function confirmQualityReviewProposal(proposal,{presentation,input=process.stdin,output=process.stderr,argv=process.argv.slice(2),ask}={}) {
 if(input.isTTY!==true || output.isTTY!==true || argv.some(arg=>/^--(?:yes|y|approve(?:d)?|confirm(?:ed)?|actor|json)(?:=|$)/i.test(arg) || arg==='-y'))throw reviewUnavailable();
 let session,rl;
 try {
  session=await openQualityPresentation(presentation,proposal);
  const snapshot=session.proposal;
  output.write(`Revisão editorial ${snapshot.kind}. Objeto e arquivos exatos:\n${JSON.stringify(snapshot,null,2)}\nSHA-256 da proposta: ${canonicalHash(snapshot)}\nAbra no navegador deste computador: ${session.url}\nInspecione cada janela 1:1, móvel a 1/3 (360 px por lâmina), emendas e panorama quando presente. O panorama tem também visão geral. Se a apresentação falhar, não confirme.\n`);
  if(!ask){
   rl=createInterface({input,output,terminal:true});const controller=new AbortController();
   rl.once('close',()=>controller.abort());rl.once('SIGINT',()=>{controller.abort();rl.close();});
   ask=prompt=>rl.question(prompt,{signal:controller.signal});
  }
  const code=await ask('Digite o código do navegador para atestar a inspeção de todos os pixels; CANCELAR cancela: ');
  if(code===null || code===undefined || code==='' || code==='CANCELAR')return null;
  const coverage=session.attest(code),criteria=[],findings=[];
  for(const file of snapshot.manifest.files) {
   const target={role:file.role,slideIndex:file.slideIndex,pair:file.pair,elementId:null};
   output.write(`\nAlvo: ${JSON.stringify(target)}\n`);
   for(const criterion of getReviewRubric(1).criteria) {
    output.write(`${criterion.id}: ${criterion.instruction}\n`);
    let result;
    for(;;) {
     const answer=await ask(`Resultado ${criterion.id}: ATENDE, FALHA ou NAO-VERIFICADO (CANCELAR cancela): `);
     if(answer===null || answer===undefined || answer==='' || answer==='CANCELAR')return null;
     result={ATENDE:'met',FALHA:'failed','NAO-VERIFICADO':'not-verified'}[answer];
     if(result)break;output.write('Escolha um dos três resultados explícitos.\n');
    }
    let observation;
    for(;;) {
     observation=await ask('Observação obrigatória deste critério (CANCELAR cancela): ');
     if(observation===null || observation===undefined || observation==='CANCELAR')return null;
     if(typeof observation==='string' && observation.trim().length && observation.length<=4000)break;
     output.write('Descreva a observação em 1 a 4000 caracteres.\n');
    }
    criteria.push({criterionId:criterion.id,target,result,observation});
    // All failures are blocking. The gateway offers no downgrade for clipping,
    // illegibility, collisions, omissions or incorrect identity.
    if(result==='failed')findings.push({id:randomUUID(),criterionId:criterion.id,target,severity:'blocking',description:observation});
   }
  }
  findings.sort((a,b)=>a.id<b.id?-1:1);
  const answers=freezeReview(JSON.parse(canonicalJson({coverage,criteria,findings}))),reviewProposalHash=answersHash(snapshot,answers);
  output.write(`\nResumo exato da revisão (não é consentimento de produção):\n${JSON.stringify(answers,null,2)}\nSHA-256 das respostas: ${reviewProposalHash}\n`);
  if(await ask('Digite CONFIRMAR para registrar estas respostas exatas; qualquer outra resposta cancela: ')!=='CONFIRMAR')return null;
  const receipt=Object.freeze({});
  qualityReceipts.set(receipt,Object.freeze({id:randomUUID(),sessionId:randomUUID(),channel:'local-terminal',confirmedAt:new Date().toISOString(),proposalHash:canonicalHash(snapshot),reviewProposalHash,answersHash:canonicalHash(answers)}));
  return {answers,receipt};
 }catch(error){if(['AbortError','ERR_USE_AFTER_CLOSE'].includes(error.name) || error.code==='ERR_USE_AFTER_CLOSE')return null;throw error;}
 finally{rl?.close();await session?.close();}
}

export function requireQualityReviewConfirmation(receipt,proposal,answers) {
 const evidence=receipt && qualityReceipts.get(receipt);
 if(!evidence)throw reviewRequired();
 try {
  if(evidence.proposalHash!==canonicalHash(proposal) || evidence.answersHash!==canonicalHash(answers) || evidence.reviewProposalHash!==answersHash(proposal,answers))throw reviewStale();
 }catch{throw reviewStale();}
 const {answersHash:internal,...result}=evidence;
 return Object.freeze(result);
}
/** Called only after durable commit; transaction rollback keeps the capability. */
export function consumeQualityReviewConfirmation(receipt) { if(receipt)qualityReceipts.delete(receipt); }
