import {randomUUID} from 'node:crypto';
import {runOperation} from './operation-runner.mjs';
import {revokeRunLeaseInTransaction} from './run-lease.mjs';
import {canonicalHash,canonicalJson} from '../domain/canonical-json.mjs';
import {exactKeys} from '../domain/brand-schema.mjs';
import {validateIdentifier} from '../domain/identifiers.mjs';
import {getRunContract} from '../domain/run-snapshot.mjs';
import {transitionRun,transitionAttempt} from '../domain/run-state-machine.mjs';
import {transitionStage} from '../domain/stage-graph.mjs';
import {PublicError,invalidArgument} from '../domain/errors.mjs';
import {verifySchema} from '../infrastructure/sqlite/migrations.mjs';
import {clockTime,systemClock} from '../infrastructure/clock.mjs';

const fail=(code,message)=>{throw new PublicError(code,message);};
/** Trusted internal stop service. Request data cannot choose a token, executor,
 * state, signal callback or reconciliation result. No render/approval/public CLI
 * is supplied here. T23 must reconcile bytes before an interrupted run is ready.
 * The optional process notifier is best-effort, post-commit, and never awaited:
 * safety and prompt control completion must not depend on process cooperation.
 */
export function createRunControl({db,clock=systemClock,signalAttempt}={}){
 if(signalAttempt!==undefined&&typeof signalAttempt!=='function')throw invalidArgument('Sinalizador de tentativa inválido.');
 const capture=r=>({run:db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(r.brandId,r.runId)??null,
  ...Object.fromEntries(['steps','step_attempts','confirmation_requests','approvals','artifacts'].map(table=>[table,db.prepare(`SELECT * FROM ${table} WHERE brand_id=? AND run_id=? ORDER BY id`).all(r.brandId,r.runId)]))});
 async function control(input,kind){
  const r=JSON.parse(canonicalJson(input));exactKeys(r,['requestId','brandId','runId']);validateIdentifier(r.brandId);validateIdentifier(r.runId);
  let notification=null,committed;
  const result=runOperation(db,{...r,operation:`run.${kind}`,payload:{}},({emit})=>{
   const stored=capture(r),run=stored.run;if(!run)fail('RUN_NOT_FOUND','Execução não encontrada.');
   if(run.status==='cancelled')fail('RUN_DERIVATION_REQUIRED','Execução cancelada é terminal; continuar exige uma derivação.');
   if(run.status==='completed')fail('RUN_TERMINAL','Execução concluída é terminal.');
   const snapshot=JSON.parse(run.snapshot_json);if(canonicalHash(snapshot)!==run.snapshot_hash)fail('SNAPSHOT_HASH_MISMATCH','Snapshot diverge de seu hash persistido.');
   const contract=getRunContract(snapshot),schema=verifySchema(db);
   if(schema===2&&contract.contractVersion===1)fail('RUN_DERIVATION_REQUIRED','Execução histórica exige derivação para o contrato de qualidade.');
   if(schema===1&&contract.contractVersion===2)fail('WORKSPACE_ACTIVATION_REQUIRED','O workspace exige ativação explícita do contrato de qualidade.');
   if(kind==='interrupt'&&run.status!=='running')fail('RUN_NOT_INTERRUPTIBLE','Somente uma tentativa em execução pode ser interrompida.');
   const active=stored.step_attempts.filter(a=>a.status==='running'),attempt=active[0],stage=stored.steps.find(s=>s.id===attempt?.step_id);
   if(run.status==='running'?(active.length!==1||!stage||stage.step_key!==run.current_step||stage.status!=='running'||attempt.finished_at!==null||run.lease_owner!==attempt.executor||run.fencing_token!==attempt.fencing_token):(active.length!==0||stored.steps.some(s=>s.status==='running')))fail('RUN_STATE_INCONSISTENT','Tentativa ativa não corresponde ao estado da execução.');
   if(!Number.isSafeInteger(run.version)||run.version>=Number.MAX_SAFE_INTEGER)fail('RUN_VERSION_EXHAUSTED','Contador de versão indisponível.');
   const status=transitionRun(run.status,{type:kind}),time=clockTime(clock);if(time>8640000000000000)throw invalidArgument('Data de controle inválida.');
   const finishedAt=new Date(time).toISOString();
   let fencingToken=run.fencing_token;
   if(run.lease_owner!==null){({fencingToken}=revokeRunLeaseInTransaction(db,{brandId:r.brandId,runId:r.runId,owner:run.lease_owner,fencingToken:run.fencing_token,expiresAt:run.lease_expires_at},{clock}));}
   if(attempt){
    db.prepare('UPDATE step_attempts SET status=?,finished_at=?,result_artifact_id=NULL,error_code=? WHERE id=? AND brand_id=? AND run_id=?').run(transitionAttempt(attempt.status,status),finishedAt,kind==='interrupt'?'RUN_INTERRUPTED':'RUN_CANCELLED',attempt.id,r.brandId,r.runId);
    db.prepare('UPDATE steps SET status=? WHERE id=? AND brand_id=? AND run_id=?').run(transitionStage(stage.step_key,stage.status,{type:'attempt-interrupted'},{pipelineVersion:contract.pipelineVersion}),stage.id,r.brandId,r.runId);
    notification={brandId:r.brandId,runId:r.runId,attemptId:attempt.id,owner:attempt.executor,fencingToken:attempt.fencing_token,reason:status};
   }
   // A pending human request is not a negative review. Preserve immutable
   // historical approvals/artifacts; revoke only unresolved capabilities.
   for(const step of stored.steps.filter(s=>s.status==='waiting-approval'))db.prepare('UPDATE steps SET status=? WHERE id=? AND brand_id=? AND run_id=?').run(transitionStage(step.step_key,step.status,{type:'invalidate'},{pipelineVersion:contract.pipelineVersion}),step.id,r.brandId,r.runId);
   db.prepare("UPDATE confirmation_requests SET status='cancelled',resolved_at=? WHERE brand_id=? AND run_id=? AND status='pending'").run(finishedAt,r.brandId,r.runId);
   db.prepare('UPDATE runs SET status=?,version=version+1 WHERE brand_id=? AND id=?').run(status,r.brandId,r.runId);
   emit({id:randomUUID(),eventType:`run.${status}`,attemptId:attempt?.id??null});
   committed=capture(r);
   return {status:'committed',result:{brandId:r.brandId,runId:r.runId,status,runVersion:run.version+1,fencingToken,attemptId:attempt?.id??null}};
  },{now:()=>clockTime(clock),beforeCommit:()=>{if(canonicalHash(capture(r))!==canonicalHash(committed))fail('RUN_STATE_INCONSISTENT','Execução alterada durante o controle.');}});
  // Exact idempotent replay does not run the transaction body or notify again.
  // No persisted result claims the signal was delivered or the process exited.
  if(notification&&signalAttempt){try{Promise.resolve(signalAttempt(Object.freeze(notification))).catch(()=>{});}catch{}}
  return result;
 }
 return Object.freeze({interrupt:input=>control(input,'interrupt'),cancel:input=>control(input,'cancel')});
}
