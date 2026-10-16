import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PublicError, invalidArgument } from '../../domain/errors.mjs';

function migration(version, name) {
  const sql = readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
  return Object.freeze({version,name,sql,checksum:createHash('sha256').update(sql).digest('hex')});
}
export const SCHEMA_VERSION = 2;
export const initialMigration = migration(1, '001-initial.sql');
export const qualityActivationMigration = migration(2, '002-quality-contract-activation.sql');
const migrations = [initialMigration,qualityActivationMigration];
const error = (code, message) => new PublicError(code, message);

/** Check version before touching any domain table; reads never activate a contract. */
export function verifySchema(db) {
  const version = db.pragma('user_version', { simple: true });
  if (version > SCHEMA_VERSION) throw error('SCHEMA_TOO_NEW', 'O banco exige uma versão mais recente do aplicativo.');
  if (version < 1) throw error('SCHEMA_MIGRATION_REQUIRED', 'O workspace requer migração explícita.');
  let rows;
  try { rows = db.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all(); }
  catch { throw error('SCHEMA_INVALID', 'Metadados do schema inválidos.'); }
  if (rows.some(row => row.version > SCHEMA_VERSION)) throw error('SCHEMA_TOO_NEW', 'O banco exige uma versão mais recente do aplicativo.');
  if (rows.length !== version || rows.some((row,index) => row.version !== index+1 || row.name !== migrations[index].name)) throw error('SCHEMA_INVALID', 'Metadados do schema inválidos.');
  if (rows.some((row,index) => row.checksum !== migrations[index].checksum)) throw error('MIGRATION_CHECKSUM_MISMATCH', 'Checksum da migração não corresponde ao aplicativo.');
  if (version === 2) {
    let activation;
    try { activation = db.prepare('SELECT * FROM workspace_contract_activation').all(); }
    catch { throw error('SCHEMA_INVALID', 'Ativação do contrato inválida.'); }
    const row=activation[0];
    if (activation.length!==1 || row.singleton!==1 || row.contract_version!==2 || row.pipeline_version!==2 || row.minimum_protocol_version!==2 || row.quality_policy_version!==1 || typeof row.activated_at!=='string' || Number.isNaN(Date.parse(row.activated_at))) throw error('SCHEMA_INVALID', 'Ativação do contrato inválida.');
  } else if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='workspace_contract_activation'").get()) {
    throw error('SCHEMA_INVALID', 'Ativação e versão do schema não correspondem.');
  }
  return version;
}

/** Invoke inside the same transaction as every quality-contract-v2 mutation. */
export function assertQualityContractActive(db) {
  if (verifySchema(db) !== 2) throw error('WORKSPACE_ACTIVATION_REQUIRED', 'O workspace exige ativação explícita do contrato de qualidade.');
}

/** Only for explicitly created empty databases. Existing workspaces use the guarded activator. */
export function initializeSchema(db, {schemaVersion=1} = {}) {
  if (![1,2].includes(schemaVersion)) throw invalidArgument('Versão inicial de schema inválida.');
  db.transaction(() => {
    if (db.pragma('user_version', { simple: true }) !== 0 || db.prepare("SELECT count(*) n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get().n !== 0) throw error('SCHEMA_INVALID', 'Inicialização exige banco vazio.');
    for (const entry of migrations.slice(0,schemaVersion)) {
      db.exec(entry.sql);
      db.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES (?,?,?)').run(entry.version,entry.name,entry.checksum);
    }
    db.pragma(`user_version=${schemaVersion}`);
    verifySchema(db);
  }).immediate();
}
