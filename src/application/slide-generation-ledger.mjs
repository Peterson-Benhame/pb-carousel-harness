import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runOperation } from './operation-runner.mjs';
import { createRunInputs } from './run-inputs.mjs';
import { canonicalHash, canonicalJson } from '../domain/canonical-json.mjs';
import { exactKeys } from '../domain/brand-schema.mjs';
import { validateIdentifier } from '../domain/identifiers.mjs';
import { PublicError, invalidArgument } from '../domain/errors.mjs';
import { assertGenerationLedgerActive } from '../infrastructure/sqlite/migrations.mjs';

export { activateSlideGenerationLedger } from '../infrastructure/sqlite/generation-ledger-activation.mjs';

const fail=(code,message)=>{throw new PublicError(code,message);};
const clone=value=>JSON.parse(canonicalJson(value));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export async function createSlideGenerationLedger({root,db,packageRoot}={}) {
 assertGenerationLedgerActive(db);
 const inputs=await createRunInputs({root,db,packageRoot});
 function scope(value){validateIdentifier(value.brandId);validateIdentifier(value.runId);if(!Number.isSafeInteger(value.slideIndex)||value.slideIndex<1)throw invalidArgument('Índice de lâmina inválido.');}
 function latest(kind,brandId,runId){return db.prepare('SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND kind=? ORDER BY version DESC LIMIT 1').get(brandId,runId,kind)??null;}
 async function current(value){
  scope(value);assertGenerationLedgerActive(db);
  const inputRow=latest('inputs',value.brandId,value.runId),saved=await inputs.get(value.brandId,value.runId);
  if(!inputRow||!saved||saved.id!==inputRow.id||!saved.artifacts?.plan)fail('GENERATION_IDENTITY_UNAVAILABLE','Geração exige inputs e plano atuais persistidos.');
  const planRef=saved.artifacts.plan,planFile=await inputs.resolveArtifact(value.brandId,value.runId,planRef.id);
  if(planFile.kind!==planRef.kind||planFile.version!==planRef.version||planFile.sha256!==planRef.sha256)fail('GENERATION_IDENTITY_STALE','Plano atual diverge do manifesto de inputs.');
  let plan;try{plan=JSON.parse(await readFile(planFile.path,'utf8'));}catch{fail('GENERATION_IDENTITY_UNAVAILABLE','Plano atual inválido.');}
  const contract=plan.semanticContracts?.find(item=>item?.slideIndex===value.slideIndex),copyFingerprint=saved.fingerprints?.['copy-approval'];
  if(plan.id!==planRef.id||plan.version!==planRef.version||!contract||!sha(copyFingerprint))fail('GENERATION_IDENTITY_UNAVAILABLE','Contrato semântico da lâmina indisponível.');
  const identity={planRevision:plan.version,contractFingerprint:canonicalHash(contract),copyFingerprint};
  return {identity,guard:{input:{id:inputRow.id,version:inputRow.version,sha256:inputRow.hash},plan:planRef}};
 }
 function stillCurrent(value,guard){
  const input=latest('inputs',value.brandId,value.runId),plan=latest('composition-plan',value.brandId,value.runId);
  if(!input||!plan||input.id!==guard.input.id||input.version!==guard.input.version||input.hash!==guard.input.sha256||plan.id!==guard.plan.id||plan.version!==guard.plan.version||plan.hash!==guard.plan.sha256)fail('GENERATION_IDENTITY_STALE','Inputs ou plano mudaram durante a reserva.');
 }
 function where(identity){return [identity.planRevision,identity.contractFingerprint,identity.copyFingerprint];}
 function attempt(row){return row?{id:row.id,mode:row.mode,automaticOrdinal:row.automatic_ordinal,status:row.status,manualIntentId:row.manual_intent_id,resultArtifactId:row.result_artifact_id,errorCode:row.error_code,createdAt:row.created_at,finishedAt:row.finished_at}:null;}
 function state(value,identity){
  const args=[value.brandId,value.runId,value.slideIndex,...where(identity)],used=db.prepare('SELECT count(*) n FROM slide_generation_attempts WHERE brand_id=? AND run_id=? AND slide_index=? AND plan_revision=? AND contract_fingerprint=? AND copy_fingerprint=? AND automatic_ordinal IS NOT NULL').get(...args).n;
  const attempts=db.prepare('SELECT * FROM slide_generation_attempts WHERE brand_id=? AND run_id=? AND slide_index=? AND plan_revision=? AND contract_fingerprint=? AND copy_fingerprint=? ORDER BY rowid').all(...args).map(attempt);
  return {schemaVersion:1,brandId:value.brandId,runId:value.runId,slideIndex:value.slideIndex,identity,automaticBudget:{limit:2,used,remaining:Math.max(0,2-used)},attempt:attempts.at(-1)??null,attempts};
 }
 async function reserveAutomatic(input){
  const value=clone(input);exactKeys(value,['requestId','brandId','runId','slideIndex']);scope(value);const resolved=await current(value);
  return runOperation(db,{requestId:value.requestId,brandId:value.brandId,runId:value.runId,operation:'run.slide-generation.reserve-automatic',payload:{slideIndex:value.slideIndex,identity:resolved.identity}},()=>{
   stillCurrent(value,resolved.guard);assertGenerationLedgerActive(db);
   const args=[value.brandId,value.runId,value.slideIndex,...where(resolved.identity)];
   if(db.prepare("SELECT 1 FROM slide_generation_attempts WHERE brand_id=? AND run_id=? AND slide_index=? AND plan_revision=? AND contract_fingerprint=? AND copy_fingerprint=? AND status='reserved'").get(...args))fail('GENERATION_ATTEMPT_ACTIVE','A lâmina já possui uma geração reservada.');
   const used=db.prepare('SELECT count(*) n FROM slide_generation_attempts WHERE brand_id=? AND run_id=? AND slide_index=? AND plan_revision=? AND contract_fingerprint=? AND copy_fingerprint=? AND automatic_ordinal IS NOT NULL').get(...args).n;
   if(used>=2)fail('AUTOMATIC_GENERATION_LIMIT_REACHED','A tentativa inicial e a correção automática já foram consumidas.');
   const ordinal=used+1,mode=ordinal===1?'automatic-initial':'automatic-correction',id=randomUUID();
   db.prepare('INSERT INTO slide_generation_attempts(id,brand_id,run_id,slide_index,plan_revision,contract_fingerprint,copy_fingerprint,mode,automatic_ordinal) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id,value.brandId,value.runId,value.slideIndex,...where(resolved.identity),mode,ordinal);
   return {status:'committed',result:state(value,resolved.identity)};
  });
 }
 async function reserveManualCorrection(input){
  const value=clone(input);exactKeys(value,['requestId','brandId','runId','slideIndex','manualIntentId']);scope(value);validateIdentifier(value.manualIntentId);const resolved=await current(value);
  return runOperation(db,{requestId:value.requestId,brandId:value.brandId,runId:value.runId,operation:'run.slide-generation.reserve-manual-correction',payload:{slideIndex:value.slideIndex,identity:resolved.identity,manualIntentId:value.manualIntentId}},()=>{
   stillCurrent(value,resolved.guard);assertGenerationLedgerActive(db);
   const args=[value.brandId,value.runId,value.slideIndex,...where(resolved.identity)];
   if(db.prepare("SELECT 1 FROM slide_generation_attempts WHERE brand_id=? AND run_id=? AND slide_index=? AND plan_revision=? AND contract_fingerprint=? AND copy_fingerprint=? AND status='reserved'").get(...args))fail('GENERATION_ATTEMPT_ACTIVE','A lâmina já possui uma geração reservada.');
   if(db.prepare('SELECT 1 FROM slide_generation_attempts WHERE manual_intent_id=?').get(value.manualIntentId))fail('MANUAL_CORRECTION_INTENT_USED','A intenção manual já foi consumida.');
   const fingerprint=canonicalHash({brandId:value.brandId,runId:value.runId,slideIndex:value.slideIndex,identity:resolved.identity});
   const intent=db.prepare('SELECT * FROM confirmation_requests WHERE id=? AND brand_id=? AND run_id=?').get(value.manualIntentId,value.brandId,value.runId);
   const approvals=db.prepare('SELECT * FROM approvals WHERE confirmation_request_id=? AND brand_id=? AND run_id=?').all(value.manualIntentId,value.brandId,value.runId);
   const approval=approvals[0];
   if(!intent||intent.kind!=='slide-generation-manual-correction'||intent.status!=='confirmed'||intent.object_fingerprint!==fingerprint||intent.object_artifact_id!==null||typeof intent.resolved_at!=='string'||approvals.length!==1||approval.kind!==intent.kind||approval.object_fingerprint!==fingerprint||approval.object_artifact_id!==null||approval.decision!=='approved'||approval.decided_at!==intent.resolved_at)fail('MANUAL_CORRECTION_INTENT_REQUIRED','Correção manual exige intenção humana confirmada para esta identidade.');
   const id=randomUUID();
   db.prepare('INSERT INTO slide_generation_attempts(id,brand_id,run_id,slide_index,plan_revision,contract_fingerprint,copy_fingerprint,mode,automatic_ordinal,manual_intent_id) VALUES(?,?,?,?,?,?,?,?,NULL,?)')
    .run(id,value.brandId,value.runId,value.slideIndex,...where(resolved.identity),'manual-correction',value.manualIntentId);
   return {status:'committed',result:state(value,resolved.identity)};
  });
 }
 function recordFailure(input){
  const value=clone(input);exactKeys(value,['requestId','brandId','runId','attemptId','errorCode']);validateIdentifier(value.brandId);validateIdentifier(value.runId);validateIdentifier(value.attemptId);
  if(typeof value.errorCode!=='string'||!/^[A-Z][A-Z0-9_]{1,63}$/.test(value.errorCode))throw invalidArgument('Código de falha de geração inválido.');
  return runOperation(db,{requestId:value.requestId,brandId:value.brandId,runId:value.runId,operation:'run.slide-generation.fail',payload:{attemptId:value.attemptId,errorCode:value.errorCode}},()=>{
   assertGenerationLedgerActive(db);
   const row=db.prepare('SELECT * FROM slide_generation_attempts WHERE id=? AND brand_id=? AND run_id=?').get(value.attemptId,value.brandId,value.runId);
   if(!row)fail('GENERATION_ATTEMPT_NOT_FOUND','Tentativa de geração não encontrada nesta execução.');
   if(row.status!=='reserved')fail('GENERATION_ATTEMPT_CLOSED','Tentativa de geração já encerrada.');
   db.prepare("UPDATE slide_generation_attempts SET status='failed',error_code=?,finished_at=? WHERE id=? AND brand_id=? AND run_id=?")
    .run(value.errorCode,new Date().toISOString(),value.attemptId,value.brandId,value.runId);
   return {status:'committed',result:state({brandId:value.brandId,runId:value.runId,slideIndex:row.slide_index},{planRevision:row.plan_revision,contractFingerprint:row.contract_fingerprint,copyFingerprint:row.copy_fingerprint})};
  });
 }
 function recordSuccess(input){
  const value=clone(input);exactKeys(value,['requestId','brandId','runId','attemptId','resultArtifactRef']);validateIdentifier(value.brandId);validateIdentifier(value.runId);validateIdentifier(value.attemptId);
  exactKeys(value.resultArtifactRef,['id','kind','version','sha256']);validateIdentifier(value.resultArtifactRef.id);
  if(typeof value.resultArtifactRef.kind!=='string'||!value.resultArtifactRef.kind||!Number.isSafeInteger(value.resultArtifactRef.version)||value.resultArtifactRef.version<1||!sha(value.resultArtifactRef.sha256))throw invalidArgument('Referência de resultado de geração inválida.');
  return runOperation(db,{requestId:value.requestId,brandId:value.brandId,runId:value.runId,operation:'run.slide-generation.succeed',payload:{attemptId:value.attemptId,resultArtifactRef:value.resultArtifactRef}},()=>{
   assertGenerationLedgerActive(db);
   const artifact=db.prepare('SELECT * FROM artifacts WHERE id=? AND brand_id=? AND run_id=?').get(value.resultArtifactRef.id,value.brandId,value.runId);
   if(!artifact||artifact.kind!==value.resultArtifactRef.kind||artifact.version!==value.resultArtifactRef.version||artifact.hash!==value.resultArtifactRef.sha256)fail('GENERATION_RESULT_INVALID','Resultado de geração não corresponde a um artifact persistido nesta execução.');
   const row=db.prepare('SELECT * FROM slide_generation_attempts WHERE id=? AND brand_id=? AND run_id=?').get(value.attemptId,value.brandId,value.runId);
   if(!row)fail('GENERATION_ATTEMPT_NOT_FOUND','Tentativa de geração não encontrada nesta execução.');
   if(row.status!=='reserved')fail('GENERATION_ATTEMPT_CLOSED','Tentativa de geração já encerrada.');
   db.prepare("UPDATE slide_generation_attempts SET status='succeeded',result_artifact_id=?,finished_at=? WHERE id=? AND brand_id=? AND run_id=?")
    .run(artifact.id,new Date().toISOString(),value.attemptId,value.brandId,value.runId);
   return {status:'committed',result:state({brandId:value.brandId,runId:value.runId,slideIndex:row.slide_index},{planRevision:row.plan_revision,contractFingerprint:row.contract_fingerprint,copyFingerprint:row.copy_fingerprint})};
  });
 }
 async function getCurrent(input){const value=clone(input);exactKeys(value,['brandId','runId','slideIndex']);const resolved=await current(value),result=state(value,resolved.identity);stillCurrent(value,resolved.guard);return clone(result);}
 return Object.freeze({reserveAutomatic,reserveManualCorrection,recordFailure,recordSuccess,getCurrent});
}
