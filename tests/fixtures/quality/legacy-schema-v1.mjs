// Frozen writer guard from commit 76fb7f3. Only fixture-relative imports differ.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PublicError } from '../../../src/domain/errors.mjs';

const sql = readFileSync(new URL('../../../src/infrastructure/sqlite/migrations/001-initial.sql', import.meta.url), 'utf8');
export const SCHEMA_VERSION = 1;
export const initialMigration = Object.freeze({ version: 1, name: '001-initial.sql', sql, checksum: createHash('sha256').update(sql).digest('hex') });
const error = (code, message) => new PublicError(code, message);

/** Check version before touching any domain table; no automatic migration. */
export function verifySchema(db) {
  const version = db.pragma('user_version', { simple: true });
  if (version > SCHEMA_VERSION) throw error('SCHEMA_TOO_NEW', 'O banco exige uma versão mais recente do aplicativo.');
  if (version < SCHEMA_VERSION) throw error('SCHEMA_MIGRATION_REQUIRED', 'O workspace requer migração explícita.');
  let rows;
  try { rows = db.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all(); }
  catch { throw error('SCHEMA_INVALID', 'Metadados do schema inválidos.'); }
  if (rows.some(row => row.version > SCHEMA_VERSION)) throw error('SCHEMA_TOO_NEW', 'O banco exige uma versão mais recente do aplicativo.');
  if (rows.length !== 1 || rows[0].version !== 1 || rows[0].name !== initialMigration.name) throw error('SCHEMA_INVALID', 'Metadados do schema inválidos.');
  if (rows[0].checksum !== initialMigration.checksum) throw error('MIGRATION_CHECKSUM_MISMATCH', 'Checksum da migração não corresponde ao aplicativo.');
}

/** Only for an explicitly created, empty database. Upgrades belong to T26. */
export function initializeSchema(db) {
  db.transaction(() => {
    if (db.pragma('user_version', { simple: true }) !== 0 || db.prepare("SELECT count(*) n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get().n !== 0) throw error('SCHEMA_INVALID', 'Inicialização exige banco vazio.');
    db.exec(initialMigration.sql);
    db.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES (?,?,?)').run(initialMigration.version,initialMigration.name,initialMigration.checksum);
    db.pragma(`user_version=${SCHEMA_VERSION}`);
  }).immediate();
  verifySchema(db);
}
