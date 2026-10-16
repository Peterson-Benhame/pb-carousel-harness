import { PublicError, invalidArgument } from '../domain/errors.mjs';
import { canonicalJson, canonicalHash, CANONICAL_VERSION, assertCanonicalVersion } from '../domain/canonical-json.mjs';
import { verifySchema } from '../infrastructure/sqlite/migrations.mjs';
import { assertMutationAllowed, requireTopLevelTransaction, immediateTransaction } from '../infrastructure/sqlite/maintenance.mjs';

/** Synchronous, short DB-only mutation. No file writes, render work, or transaction
 * control in the callback. Return {status:'committed',result:<JSON>} only after all
 * references are ready; a pending file reservation is never a confirmed result.
 * Callbacks are trusted internal services, not an executable public/plugin API.
 */
export function runOperation(db,request,mutate,{now=Date.now,beforeCommit}={}) {
  const {requestId,operation,payload,brandId=null,runId=null}=request ?? {};
  if (typeof requestId!=='string' || !requestId.trim() || typeof operation!=='string' || !operation.trim() || (brandId!==null && (typeof brandId!=='string' || !brandId)) || (runId!==null && (typeof runId!=='string' || !runId || brandId===null))) throw invalidArgument('Solicitação de operação inválida.');
  if (typeof mutate!=='function' || ['AsyncFunction','AsyncGeneratorFunction','GeneratorFunction'].includes(mutate.constructor?.name)) throw new PublicError('INVALID_OPERATION_CALLBACK','A operação exige callback síncrono.');
  if (beforeCommit!==undefined && (typeof beforeCommit!=='function' || ['AsyncFunction','AsyncGeneratorFunction','GeneratorFunction'].includes(beforeCommit.constructor?.name))) throw new PublicError('INVALID_OPERATION_CALLBACK','A operação exige callback síncrono.');
  requireTopLevelTransaction(db);
  // Identity binds command and scope as well as payload; requestId is the lookup key.
  const identity={operation,brandId,runId,payload};
  const payloadHash=canonicalHash(identity);
  return immediateTransaction(db,()=>{
    verifySchema(db);
    const previous=db.prepare('SELECT * FROM operations WHERE request_id=?').get(requestId);
    if (previous) {
      assertCanonicalVersion(previous.canonical_version);
      if (previous.operation!==operation || previous.brand_id!==brandId || previous.run_id!==runId || previous.payload_hash!==payloadHash) throw new PublicError('IDEMPOTENCY_CONFLICT','requestId já utilizado com outra solicitação.');
      return JSON.parse(previous.result_json);
    }
    assertMutationAllowed(db,now);
    const emit=({id,eventType,attemptId=null,diagnosticCode=null})=>{
      if (!runId || typeof id!=='string' || !id || typeof eventType!=='string' || !eventType) throw invalidArgument('Evento exige identidade e escopo de execução.');
      db.prepare('INSERT INTO run_events(id,brand_id,run_id,attempt_id,event_type,correlation_id,diagnostic_code) VALUES (?,?,?,?,?,?,?)').run(id,brandId,runId,attemptId,eventType,requestId,diagnosticCode);
    };
    const outcome=mutate({db,emit});
    if (!outcome || outcome.status!=='committed' || typeof outcome.then==='function') throw new PublicError('OPERATION_NOT_COMMITTED','Operação ainda não possui resultado confirmado.');
    const resultJson=canonicalJson(outcome.result);
    db.prepare('INSERT INTO operations(request_id,brand_id,run_id,operation,payload_hash,canonical_version,result_json) VALUES (?,?,?,?,?,?,?)').run(requestId,brandId,runId,operation,payloadHash,CANONICAL_VERSION,resultJson);
    // Prepare the return value before the final trusted DB-only guard. Fencing
    // must also cover result serialization/insertion, not just the mutation.
    const result=JSON.parse(resultJson);
    if (beforeCommit) {
      const guarded=beforeCommit();
      if (guarded && typeof guarded.then==='function') throw new PublicError('INVALID_OPERATION_CALLBACK','A operação exige callback síncrono.');
    }
    // Exact replay above is a read of a past commit and invokes neither callback.
    return result;
  });
}
