import {PublicError,invalidArgument} from '../domain/errors.mjs';
import {validateIdentifier} from '../domain/identifiers.mjs';
import {exactKeys} from '../domain/brand-schema.mjs';
import {canonicalHash,canonicalJson} from '../domain/canonical-json.mjs';
import {getRunContract} from '../domain/run-snapshot.mjs';
import {getStages} from '../domain/stage-graph.mjs';
import {verifySchema} from '../infrastructure/sqlite/migrations.mjs';
import {assertMutationAllowed,immediateTransaction} from '../infrastructure/sqlite/maintenance.mjs';
import {clockTime,clockDeadline,systemClock} from '../infrastructure/clock.mjs';
import {runOperation} from './operation-runner.mjs';

export const RUN_LEASE_TTL_MS=60000;
export const RUN_LEASE_HEARTBEAT_MS=10000;
const fail=(code,message)=>{throw new PublicError(code,message);};
const lost=()=>fail('RUN_LEASE_LOST','Posse da execução expirada ou revogada.');
const scope=value=>{validateIdentifier(value.brandId);validateIdentifier(value.runId);};
const owner=value=>{if(typeof value!=='string'||!value.trim())throw invalidArgument('Titular da execução inválido.');};
function identity(value){
 const lease=JSON.parse(canonicalJson(value));
 exactKeys(lease,['brandId','runId','owner','fencingToken','expiresAt']);scope(lease);owner(lease.owner);
 if(!Number.isSafeInteger(lease.fencingToken)||lease.fencingToken<=0||!Number.isSafeInteger(lease.expiresAt)||lease.expiresAt<0)throw invalidArgument('Identidade de lease inválida.');
 return Object.freeze(lease);
}
function nextToken(token){
 if(!Number.isSafeInteger(token)||token<0||token>=Number.MAX_SAFE_INTEGER)fail('RUN_FENCING_EXHAUSTED','Contador de execução indisponível.');
 return token+1;
}
const readRun=(db,lease)=>db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(lease.brandId,lease.runId);
function writableContract(db,run){
 const schemaVersion=verifySchema(db),snapshot=JSON.parse(run.snapshot_json);
 if(canonicalHash(snapshot)!==run.snapshot_hash)fail('SNAPSHOT_HASH_MISMATCH','Snapshot diverge de seu hash persistido.');
 const contract=getRunContract(snapshot);
 if(schemaVersion===2&&contract.contractVersion===1)fail('RUN_DERIVATION_REQUIRED','O workspace ativado exige uma nova execução no contrato de qualidade 2.');
 if(schemaVersion===1&&contract.contractVersion===2)fail('WORKSPACE_ACTIVATION_REQUIRED','O workspace exige ativação explícita do contrato de qualidade.');
 return contract;
}
function sameOwner(run,lease){
 if(!run||run.lease_owner!==lease.owner||run.fencing_token!==lease.fencingToken)lost();
}
const clearLease=(db,lease)=>db.prepare('UPDATE runs SET lease_owner=NULL,lease_expires_at=NULL WHERE brand_id=? AND id=?').run(lease.brandId,lease.runId);

/** Internal coordination only: possession is not consent, a stage transition,
 * an attempt, or authorization to render. The trusted stage service must verify
 * its own prerequisites and production gate. Never expose these callbacks as a
 * CLI/plugin request. Acquisition and maintenance exclusion share one writer lock.
 */
export function acquireRunLease(db,request,{clock=systemClock}={}){
 const input=JSON.parse(canonicalJson(request));exactKeys(input,['brandId','runId','owner','stage']);scope(input);owner(input.owner);
 return immediateTransaction(db,()=>{
  verifySchema(db);
  const {time,expiresAt}=clockDeadline(clock,RUN_LEASE_TTL_MS);assertMutationAllowed(db,()=>time);
  const run=readRun(db,input);if(!run)fail('RUN_NOT_FOUND','Execução não encontrada.');
  const contract=writableContract(db,run),stage=getStages({pipelineVersion:contract.pipelineVersion}).find(stage=>stage.key===input.stage);
  if(!stage)throw invalidArgument('Etapa de execução inválida.');
  if(stage.kind!=='execution')fail('RUN_LEASE_NOT_REQUIRED','Etapa não utiliza lease de execução.');
  if(!['ready','running'].includes(run.status))fail('RUN_NOT_EXECUTABLE','Estado da execução não permite adquirir lease.');
  if(db.prepare('SELECT status FROM brands WHERE id=?').get(input.brandId)?.status!=='active')fail('BRAND_ARCHIVED','Marca arquivada.');
  if(run.lease_owner!==null&&run.lease_expires_at>time)fail('RUN_LEASE_HELD','Execução já possui um titular ativo.');
  const fencingToken=nextToken(run.fencing_token);
  db.prepare('UPDATE runs SET lease_owner=?,lease_expires_at=?,fencing_token=? WHERE brand_id=? AND id=?').run(input.owner,expiresAt,fencingToken,input.brandId,input.runId);
  return Object.freeze({brandId:input.brandId,runId:input.runId,owner:input.owner,fencingToken,expiresAt});
 });
}

/** Composable guard for trusted service transactions. Public publication uses
 * commitRunLease below, which owns the whole boundary, not a check-then-write API.
 * Caller-provided expiresAt is never used to establish current possession.
 */
export function assertRunLeaseOwned(db,value,{clock=systemClock}={}){
 if(!db.inTransaction)fail('TRANSACTION_REQUIRED','Verificação exige transação.');
 const lease=identity(value);verifySchema(db);
 const run=readRun(db,lease);sameOwner(run,lease);
 writableContract(db,run);
 const time=clockTime(clock);assertMutationAllowed(db,()=>time);
 if(run.lease_expires_at<=time)lost();
 return lease;
}

export function renewRunLease(db,value,{clock=systemClock}={}){
 const lease=identity(value);
 return immediateTransaction(db,()=>{
  const {time,expiresAt}=clockDeadline(clock,RUN_LEASE_TTL_MS);
  assertRunLeaseOwned(db,lease,{clock:{now:()=>time}});
  db.prepare('UPDATE runs SET lease_expires_at=? WHERE brand_id=? AND id=?').run(expiresAt,lease.brandId,lease.runId);
  return Object.freeze({...lease,expiresAt});
 });
}

export function releaseRunLease(db,value,{clock=systemClock}={}){
 const lease=identity(value);
 return immediateTransaction(db,()=>{assertRunLeaseOwned(db,lease,{clock});clearLease(db,lease);});
}

/** Internal revocation primitive; expired possession may be cleared, but an old
 * token cannot revoke a successor. T17 owns interrupt/cancel state and signaling.
 */
export function revokeRunLease(db,value,{clock=systemClock}={}){
 const lease=identity(value);
 return immediateTransaction(db,()=>revokeRunLeaseInTransaction(db,lease,{clock}));
}

/** Allows a future trusted control service to revoke and update attempt/run
 * state within its single T06 operation, without a check/revoke transaction gap.
 */
export function revokeRunLeaseInTransaction(db,value,{clock=systemClock}={}){
 if(!db.inTransaction)fail('TRANSACTION_REQUIRED','Verificação exige transação.');
 const lease=identity(value);verifySchema(db);assertMutationAllowed(db,()=>clockTime(clock));
 const run=readRun(db,lease);sameOwner(run,lease);writableContract(db,run);
 const fencingToken=nextToken(run.fencing_token);
 db.prepare('UPDATE runs SET lease_owner=NULL,lease_expires_at=NULL,fencing_token=? WHERE brand_id=? AND id=?').run(fencingToken,lease.brandId,lease.runId);
 return Object.freeze({brandId:lease.brandId,runId:lease.runId,fencingToken});
}

/** Prepared bytes must already be verified outside SQLite. The callback is short,
 * synchronous and DB-only, and returns T06's committed outcome. State, event,
 * operation result and release commit together. A lease expiring during the
 * callback rolls all of them back. Exact idempotent replay reads an already
 * committed result without invoking work; it never republishes under an old token.
 */
export function commitRunLease(db,value,request,mutate,{clock=systemClock,beforeCommit,afterRelease}={}){
 const lease=identity(value);
 for(const check of [beforeCommit,afterRelease])if(check!==undefined&&(typeof check!=='function'||['AsyncFunction','AsyncGeneratorFunction','GeneratorFunction'].includes(check.constructor?.name)))fail('INVALID_OPERATION_CALLBACK','A verificação final exige callback síncrono.');
 if(request?.brandId!==lease.brandId||request?.runId!==lease.runId)throw invalidArgument('Operação não corresponde ao escopo do lease.');
 if(typeof mutate!=='function'||['AsyncFunction','AsyncGeneratorFunction','GeneratorFunction'].includes(mutate.constructor?.name))fail('INVALID_OPERATION_CALLBACK','A operação exige callback síncrono.');
 return runOperation(db,request,context=>{
  assertRunLeaseOwned(db,lease,{clock});
  const outcome=mutate(context);
  if(!outcome||outcome.status!=='committed'||typeof outcome.then==='function')fail('OPERATION_NOT_COMMITTED','Operação ainda não possui resultado confirmado.');
  return outcome;
 },{now:()=>clockTime(clock),beforeCommit:()=>{
  const check=callback=>{const checked=callback?.();if(checked&&typeof checked.then==='function')fail('INVALID_OPERATION_CALLBACK','A verificação final exige callback síncrono.');};
  check(beforeCommit);assertRunLeaseOwned(db,lease,{clock});
  const deadline=readRun(db,lease).lease_expires_at;clearLease(db,lease);check(afterRelease);
  // Release is itself a write: triggers must not corrupt publication, fencing or
  // reacquire ownership after the last guard. The persisted deadline still binds.
  const run=readRun(db,lease),time=clockTime(clock);assertMutationAllowed(db,()=>time);
  if(!run||run.fencing_token!==lease.fencingToken||run.lease_owner!==null||run.lease_expires_at!==null||time>=deadline)lost();
  writableContract(db,run);
 }});
}

/** Abort is a cooperative signal only. Safety never depends on a worker handling
 * it or a timer firing: every publication is fenced by the database again.
 * stop() cancels renewal without releasing; successful publication releases.
 */
export function startRunLeaseHeartbeat(db,value,{clock=systemClock}={}){
 let lease=identity(value);
 if(typeof clock?.setInterval!=='function'||typeof clock?.clearInterval!=='function')throw invalidArgument('Agendador de lease inválido.');
 const controller=new AbortController();let stopped=false,timer;
 const stop=()=>{if(!stopped){stopped=true;clock.clearInterval(timer);}};
 timer=clock.setInterval(()=>{
  if(stopped)return;
  try{lease=renewRunLease(db,lease,{clock});}
  catch(error){stop();controller.abort(error);}
 },RUN_LEASE_HEARTBEAT_MS);
 timer?.unref?.();
 return Object.freeze({stop,signal:controller.signal,get lease(){return lease;}});
}
