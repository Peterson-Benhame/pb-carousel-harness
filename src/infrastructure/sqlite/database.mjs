import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { PublicError, invalidArgument } from '../../domain/errors.mjs';
import { createConfinedRoot } from '../fs/confined-path.mjs';
import { initializeSchema, verifySchema, assertQualityContractActive } from './migrations.mjs';

const failure = (code,message) => new PublicError(code,message);
async function driver() {
  try { return (await import('better-sqlite3')).default; }
  catch { throw failure('SQLITE_UNAVAILABLE','Dependência SQLite indisponível para este runtime.'); }
}
function connect(Database, filename, readonly) {
  let db;
  try { db = new Database(filename, { readonly, fileMustExist: true, timeout: 5000 }); }
  catch (error) {
    if (!error.code?.startsWith('SQLITE_')) throw failure('SQLITE_UNAVAILABLE','Dependência SQLite indisponível para este runtime.');
    throw failure('WORKSPACE_OPEN_FAILED','Não foi possível abrir o banco local.');
  }
  return db;
}
function configure(db) {
  // DELETE must already be present on queries: do not change persistent journal mode while inspecting.
  if (db.pragma('journal_mode', { simple:true }) !== 'delete') throw failure('SQLITE_CONFIGURATION_INVALID','O banco requer journal_mode DELETE.');
  db.pragma('synchronous=FULL'); db.pragma('busy_timeout=5000'); db.pragma('foreign_keys=ON');
  for (const [name,value] of Object.entries({journal_mode:'delete',synchronous:2,busy_timeout:5000,foreign_keys:1})) {
    if (db.pragma(name, {simple:true}) !== value) throw failure('SQLITE_CONFIGURATION_INVALID','Configuração SQLite incompatível.');
  }
}
async function exists(guard) {
  return guard.withPaths(['harness.sqlite'], async filename => {
    try { return (await stat(filename)).isFile(); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
}
export async function openWorkspace(root, { readonly = true } = {}) {
  const guard = await createConfinedRoot(root);
  if (!await exists(guard)) throw failure('WORKSPACE_NOT_INITIALIZED','Workspace não inicializado.');
  const Database = await driver();
  return guard.withPaths(['harness.sqlite'], filename => {
    const db = connect(Database,filename,readonly);
    try { verifySchema(db); configure(db); return db; }
    catch (error) { db.close(); throw error; }
  });
}
export async function initializeWorkspace(root, {schemaVersion=1} = {}) {
  if (![1,2].includes(schemaVersion)) throw invalidArgument('Versão inicial de schema inválida.');
  async function existing() {
    const db = await openWorkspace(root,{readonly:false});
    try { if (schemaVersion===2) assertQualityContractActive(db); return db; }
    catch (error) { db.close(); throw error; }
  }
  const guard = await createConfinedRoot(root);
  if (await exists(guard)) return existing();
  const Database = await driver();
  await mkdir(guard.root,{recursive:true});
  let ownedFile;
  await guard.withPaths(['harness.sqlite'],async filename => {
    try {
      const file = await open(filename,'wx');
      try { ownedFile = await file.stat(); } finally { await file.close(); }
    }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  });
  if (!ownedFile) return existing();
  try {
    return await guard.withPaths(['harness.sqlite'],filename => {
      const db = connect(Database,filename,false);
      try { configure(db); initializeSchema(db,{schemaVersion}); return db; }
      catch (error) { db.close(); throw error; }
    });
  } catch (error) {
    // Remove only this call's exclusively created file, after all SQLite handles close.
    // A preexisting or replaced file is never ours to delete. Same local TOCTOU limit as T04.
    await guard.withPaths(['harness.sqlite'],async filename => {
      let current;
      try { current = await stat(filename); }
      catch (statError) { if (statError.code === 'ENOENT') return; throw statError; }
      if (current.dev === ownedFile.dev && current.ino === ownedFile.ino && current.birthtimeMs === ownedFile.birthtimeMs) await unlink(filename);
    });
    throw error;
  }
}
