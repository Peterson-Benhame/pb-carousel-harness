import { runOperation } from '../../application/operation-runner.mjs';
import { canonicalJson } from '../../domain/canonical-json.mjs';
import { exactKeys } from '../../domain/brand-schema.mjs';
import { PublicError } from '../../domain/errors.mjs';
import { generationLedgerMigration, verifySchema } from './migrations.mjs';

const fail = (code,message) => { throw new PublicError(code,message); };

/** Explicit V2→V3 activation. Exact request replay is handled by runOperation. */
export function activateSlideGenerationLedger(db,input) {
 const request=JSON.parse(canonicalJson(input));exactKeys(request,['requestId']);
 return runOperation(db,{requestId:request.requestId,operation:'workspace.slide-generation-ledger.activate',payload:{schemaVersion:3}},()=>{
  const version=verifySchema(db);
  if(version===3)return {status:'committed',result:{status:'already-active',schemaVersion:3}};
  if(version!==2)fail('WORKSPACE_ACTIVATION_REQUIRED','O ledger de geração exige um workspace com contrato de qualidade ativo.');
  db.exec(generationLedgerMigration.sql);
  db.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES (?,?,?)')
   .run(generationLedgerMigration.version,generationLedgerMigration.name,generationLedgerMigration.checksum);
  db.pragma('user_version=3');verifySchema(db);
  return {status:'committed',result:{status:'activated',schemaVersion:3}};
 });
}
