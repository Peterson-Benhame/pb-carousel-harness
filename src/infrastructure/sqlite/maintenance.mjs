import { PublicError, invalidArgument } from '../../domain/errors.mjs';
import { verifySchema } from './migrations.mjs';
const failure = (code,message) => new PublicError(code,message);
export function requireTopLevelTransaction(db) {
  if (db.inTransaction) throw failure('NESTED_TRANSACTION','A operação exige uma transação própria.');
}
/** Common transaction boundary: keep busy diagnostics public and payload-free. */
export function immediateTransaction(db, work) {
  requireTopLevelTransaction(db);
  try { return db.transaction(work).immediate(); }
  catch (error) {
    if (error.code === 'SQLITE_BUSY' || error.code?.startsWith('SQLITE_BUSY_')) throw failure('DATABASE_BUSY','Banco ocupado. Repita a solicitação com o mesmo requestId.');
    throw error;
  }
}
function timestamp(now) {
  const value=now();
  if (!Number.isSafeInteger(value) || value<0) throw invalidArgument('Relógio inválido.');
  return value;
}
function expiry(time,ttlMs) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs<=0 || !Number.isSafeInteger(time+ttlMs)) throw invalidArgument('Duração de manutenção inválida.');
  return time+ttlMs;
}
/** Call only inside the same immediate transaction as the protected mutation. */
export function assertMutationAllowed(db, now = Date.now) {
  if (!db.inTransaction) throw failure('TRANSACTION_REQUIRED','Verificação exige transação.');
  const lock=db.prepare('SELECT owner,expires_at FROM maintenance_coordination WHERE singleton=1').get();
  if (!lock) throw failure('SCHEMA_INVALID','Coordenação de manutenção ausente.');
  if (lock.owner !== null && lock.expires_at>timestamp(now)) throw failure('WORKSPACE_MAINTENANCE','Workspace em manutenção.');
}
/** Revalidate ownership within the same short transaction as the protected commit. */
export function assertMaintenanceOwned(db,lock,{now=Date.now}={}) {
  if (!db.inTransaction) throw failure('TRANSACTION_REQUIRED','Verificação exige transação.');
  if (!lock || typeof lock.owner!=='string' || !Number.isSafeInteger(lock.fencingToken)) throw invalidArgument('Identidade de manutenção inválida.');
  const current=db.prepare('SELECT * FROM maintenance_coordination WHERE singleton=1').get();
  if (!current || current.owner!==lock.owner || current.fencing_token!==lock.fencingToken || current.expires_at<=timestamp(now)) throw failure('MAINTENANCE_LOST','Posse da manutenção expirada ou revogada.');
}
export function assertNoActiveExecutions(db,now=Date.now) {
  if (!db.inTransaction) throw failure('TRANSACTION_REQUIRED','Verificação exige transação.');
  const active=db.prepare("SELECT 1 FROM runs WHERE lease_owner IS NOT NULL AND lease_expires_at>? UNION ALL SELECT 1 FROM step_attempts WHERE status='running' LIMIT 1").get(timestamp(now));
  if (active) throw failure('WORKSPACE_BUSY','Workspace possui execução ativa ou tentativa não reconciliada.');
}
export function acquireMaintenance(db,{owner,purpose,ttlMs=60000,now=Date.now}={}) {
  if (typeof owner!=='string' || !owner.trim() || typeof purpose!=='string' || !purpose.trim()) throw invalidArgument('Titular e finalidade são obrigatórios.');
  requireTopLevelTransaction(db);
  return immediateTransaction(db,()=>{
    verifySchema(db);
    const time=timestamp(now), expiresAt=expiry(time,ttlMs);
    assertMutationAllowed(db,()=>time);
    assertNoActiveExecutions(db,()=>time);
    db.prepare('UPDATE maintenance_coordination SET owner=?,purpose=?,expires_at=?,fencing_token=fencing_token+1 WHERE singleton=1').run(owner,purpose,expiresAt);
    const fencingToken=db.prepare('SELECT fencing_token FROM maintenance_coordination WHERE singleton=1').get().fencing_token;
    return {owner,fencingToken,expiresAt};
  });
}
function changeLock(db,lock,now,update) {
  requireTopLevelTransaction(db);
  if (!lock || typeof lock.owner!=='string' || !Number.isSafeInteger(lock.fencingToken)) throw invalidArgument('Identidade de manutenção inválida.');
  return immediateTransaction(db,()=>{
    verifySchema(db); const time=timestamp(now);
    assertMaintenanceOwned(db,lock,{now:()=>time});
    return update(time);
  });
}
export function renewMaintenance(db,lock,{ttlMs=60000,now=Date.now}={}) {
  return changeLock(db,lock,now,time=>{
    const expiresAt=expiry(time,ttlMs);
    db.prepare('UPDATE maintenance_coordination SET expires_at=? WHERE singleton=1').run(expiresAt);
    return {owner:lock.owner,fencingToken:lock.fencingToken,expiresAt};
  });
}
export function releaseMaintenance(db,lock,{now=Date.now}={}) {
  return changeLock(db,lock,now,()=>{
    db.exec('UPDATE maintenance_coordination SET owner=NULL,purpose=NULL,expires_at=NULL WHERE singleton=1');
  });
}
