import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeWorkspace, openWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import { createRepositories } from '../../src/infrastructure/sqlite/repositories.mjs';
import { initialMigration } from '../../src/infrastructure/sqlite/migrations.mjs';

const connections = new WeakMap();
function owned(t, db) { connections.get(t).push(db); return db; }

async function sandbox(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'carousel-t05-'));
  const opened = [];
  connections.set(t, opened);
  t.after(async () => {
    // One ordered cleanup: Windows refuses to unlink an open SQLite database.
    for (const db of opened.reverse()) if (db.open) db.close();
    await rm(parent, { recursive: true, force: true });
  });
  return path.join(parent, 'memória sintética');
}
async function initialized(t) {
  const root = await sandbox(t);
  const db = owned(t, await initializeWorkspace(root));
  return { root, db };
}
function brand(db, id) {
  db.prepare('INSERT INTO brands(id) VALUES (?)').run(id);
  db.prepare("INSERT INTO brand_revisions(brand_id, revision, config_json, hash, provenance) VALUES (?,1,'{}',?,'user-confirmed')").run(id, 'a'.repeat(64));
  db.prepare('UPDATE brands SET current_revision=1 WHERE id=?').run(id);
}
function run(db, brandId, id) {
  db.prepare("INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES (?,?,1,'{}',?)").run(id, brandId, 'b'.repeat(64));
}
const constraint = fn => assert.throws(fn, error => error.code?.startsWith('SQLITE_CONSTRAINT'));

test('queries never create a missing workspace; errors are typed', async t => {
  const root = await sandbox(t);
  await assert.rejects(openWorkspace(root), { code: 'WORKSPACE_NOT_INITIALIZED' });
  await assert.rejects(stat(root), { code: 'ENOENT' });
});
test('explicit initialization creates 12 entities and 3 technical tables, idempotently', async t => {
  const { root, db } = await initialized(t);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name).sort();
  assert.deepEqual(names, ['brands','brand_revisions','assets','runs','artifacts','steps','step_attempts','approvals','run_events','operations','schema_migrations','workspace_settings','maintenance_coordination','confirmation_requests','cleanup_jobs'].sort());
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.prepare('SELECT count(*) n FROM brands').get().n, 0);
  const second = owned(t, await initializeWorkspace(root)); second.close();
  assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n, 1);
});
test('each writable and read-only connection verifies mandatory pragmas; reads cannot write', async t => {
  const { root, db } = await initialized(t);
  const ro = owned(t, await openWorkspace(root));
  const rw = owned(t, await openWorkspace(root, { readonly: false }));
  for (const connection of [db, ro, rw]) {
    for (const [key, value] of Object.entries({journal_mode:'delete', synchronous:2, busy_timeout:5000, foreign_keys:1})) assert.equal(connection.pragma(key, { simple:true }), value);
  }
  assert.throws(() => ro.exec("INSERT INTO brands(id) VALUES ('no')"), { code:'SQLITE_READONLY' });
});
test('brand revisions, run origins and artifacts enforce brand ownership and versions', async t => {
  const { db } = await initialized(t); brand(db,'a'); brand(db,'b'); run(db,'a','ra'); run(db,'b','rb');
  constraint(() => db.prepare('UPDATE brands SET current_revision=2 WHERE id=?').run('a'));
  constraint(() => db.exec("UPDATE brand_revisions SET config_json='{}' WHERE brand_id='a'"));
  constraint(() => db.exec("UPDATE runs SET snapshot_json='{}' WHERE id='ra'"));
  constraint(() => db.exec("UPDATE runs SET source_run_id='rb' WHERE id='ra'"));
  constraint(() => db.exec("UPDATE runs SET version=0 WHERE id='ra'"));
  constraint(() => db.exec("UPDATE runs SET fencing_token=-1 WHERE id='ra'"));
  constraint(() => db.exec("UPDATE runs SET lease_owner='owner' WHERE id='ra'"));
  constraint(() => db.exec("INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path) VALUES ('x','a','rb','copy',1,'"+'a'.repeat(64)+"','runs/x/copy.json')"));
  constraint(() => db.exec("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES ('a',1,'{}','"+'a'.repeat(64)+"','user-confirmed')"));
});
test('scoped repositories never resolve valid IDs from another brand', async t => {
  const { db } = await initialized(t); brand(db,'a'); brand(db,'b'); run(db,'a','ra');
  db.prepare("INSERT INTO assets(id,brand_id,hash,relative_path,kind,width,height) VALUES ('asset','a',?,'blobs/a/image.png','logo',1,1)").run('a'.repeat(64));
  const repos = createRepositories(db);
  assert.equal(repos.getAsset('b','asset'), null); assert.equal(repos.getRun('b','ra'), null);
  assert.equal(repos.getAsset('a','asset').id,'asset'); assert.equal(repos.getRun('a','ra').id,'ra');
  assert.equal(repos.getBrandRevision('b',2),null); assert.equal(repos.listBrands().length,2);
});
test('future schema blocks both open modes and initialization without changing database', async t => {
 const { root, db } = await initialized(t); db.pragma('user_version=4'); db.close();
  const before = await readFile(path.join(root,'harness.sqlite'));
  for (const readonly of [true,false]) await assert.rejects(openWorkspace(root,{readonly}), {code:'SCHEMA_TOO_NEW'});
  await assert.rejects(initializeWorkspace(root), {code:'SCHEMA_TOO_NEW'});
  assert.deepEqual(await readFile(path.join(root,'harness.sqlite')),before);
});
test('checksums and version metadata must agree; never migrate automatically', async t => {
  const { root, db } = await initialized(t);
  assert.equal(db.prepare('SELECT checksum FROM schema_migrations WHERE version=1').get().checksum, initialMigration.checksum);
  db.exec("UPDATE schema_migrations SET checksum='tampered'");
  await assert.rejects(openWorkspace(root), {code:'MIGRATION_CHECKSUM_MISMATCH'});
  db.prepare('UPDATE schema_migrations SET checksum=?').run(initialMigration.checksum);
  db.pragma('user_version=0');
  await assert.rejects(openWorkspace(root), {code:'SCHEMA_MIGRATION_REQUIRED'});
});
test('attempts, confirmations, approvals, events and operations reject cross-brand/run references', async t => {
  const { db } = await initialized(t); brand(db,'a'); brand(db,'b'); run(db,'a','ra'); run(db,'b','rb'); run(db,'a','ra2');
  for (const [b,r] of [['a','ra'],['b','rb'],['a','ra2']]) {
    db.prepare("INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path) VALUES (?,?,?,'copy',1,?,?)").run(`art-${r}`,b,r,'a'.repeat(64),`runs/${r}/copy.json`);
    db.prepare("INSERT INTO steps(id,brand_id,run_id,step_key) VALUES (?,?,?,'render')").run(`step-${r}`,b,r);
    db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token) VALUES (?,?,?,?,1,'executor',1)").run(`attempt-${r}`,b,r,`step-${r}`);
    db.prepare("INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,object_artifact_id) VALUES (?,?,?,'copy',?,?)").run(`confirmation-${r}`,b,r,'a'.repeat(64),`art-${r}`);
  }
  for (const other of ['rb','ra2']) {
    constraint(() => db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token) VALUES ('bad','a','ra',?,2,'executor',1)").run(`step-${other}`));
    constraint(() => db.prepare("UPDATE step_attempts SET result_artifact_id=? WHERE id='attempt-ra'").run(`art-${other}`));
    constraint(() => db.prepare("UPDATE confirmation_requests SET object_artifact_id=? WHERE id='confirmation-ra'").run(`art-${other}`));
    constraint(() => db.prepare("INSERT INTO approvals(id,brand_id,run_id,kind,object_fingerprint,decision,confirmation_request_id,evidence_json) VALUES ('bad','a','ra','copy',?,'approved',?,'{}')").run('a'.repeat(64),`confirmation-${other}`));
    constraint(() => db.prepare("INSERT INTO run_events(id,brand_id,run_id,attempt_id,event_type,correlation_id) VALUES ('bad','a','ra',?,'started','req')").run(`attempt-${other}`));
  }
  constraint(() => db.prepare("INSERT INTO operations(request_id,brand_id,run_id,operation,payload_hash,canonical_version,result_json) VALUES ('req','a','rb','test',?,1,'{}')").run('a'.repeat(64)));
  constraint(() => db.exec("INSERT INTO steps(id,brand_id,run_id,step_key) VALUES ('dupe','a','ra','render')"));
  constraint(() => db.exec("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token) VALUES ('dupe','a','ra','step-ra',1,'executor',1)"));
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
test('technical coordination is singleton, versioned and cleanup survives deleted domain IDs', async t => {
  const { db } = await initialized(t);
  constraint(() => db.exec("UPDATE maintenance_coordination SET owner='owner'"));
  constraint(() => db.exec('INSERT INTO maintenance_coordination(singleton) VALUES(2)'));
  constraint(() => db.exec("INSERT INTO workspace_settings(singleton,revision,resources_json) VALUES (1,0,'{}')"));
  db.exec("INSERT INTO workspace_settings(singleton,revision,resources_json) VALUES (1,1,'{}')");
  constraint(() => db.exec("INSERT INTO workspace_settings(singleton,revision,resources_json) VALUES (1,2,'{}')"));
  db.exec("INSERT INTO cleanup_jobs(id,brand_id,resource_kind,resource_id) VALUES ('cleanup','deleted-brand','asset','deleted-asset')");
  assert.deepEqual(db.pragma('table_info(cleanup_jobs)').map(x=>x.name),['id','brand_id','resource_kind','resource_id','status']);
  assert.equal(db.prepare('SELECT status FROM cleanup_jobs').get().status,'pending');
});
test('new process reads persisted synthetic revision through a read-only repository', async t => {
  const { root, db } = await initialized(t); brand(db,'synthetic'); db.close();
  const { spawnSync } = await import('node:child_process');
  const code = `import {openWorkspace} from ${JSON.stringify(new URL('../../src/infrastructure/sqlite/database.mjs',import.meta.url).href)}; import {createRepositories} from ${JSON.stringify(new URL('../../src/infrastructure/sqlite/repositories.mjs',import.meta.url).href)}; const db=await openWorkspace(process.argv[1]); console.log(JSON.stringify(createRepositories(db).getBrandRevision('synthetic',1))); db.close();`;
  const child = spawnSync(process.execPath,['--input-type=module','-e',code,root],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr); assert.equal(JSON.parse(child.stdout).brand_id,'synthetic');
});
test('repository rechecks future schema before domain reads', async t => {
  const { db } = await initialized(t); const repos=createRepositories(db);
 db.pragma('user_version=4'); assert.throws(()=>repos.listBrands(),{code:'SCHEMA_TOO_NEW'});
});
test('failed explicit init removes only its new file and succeeds on retry', async t => {
  const root = await sandbox(t);
  const Database = (await import('better-sqlite3')).default;
  const original = Database.prototype.pragma;
  Database.prototype.pragma = function (...args) {
    Database.prototype.pragma = original;
    throw new Error('synthetic pragma failure');
  };
  try { await assert.rejects(initializeWorkspace(root),/synthetic pragma failure/); }
  finally { Database.prototype.pragma = original; }
  await assert.rejects(stat(path.join(root,'harness.sqlite')),{code:'ENOENT'});
  const db = owned(t, await initializeWorkspace(root)); db.close();
});
test('failed init preserves a preexisting empty database', async t => {
  const root = await sandbox(t);
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(root); await writeFile(path.join(root,'harness.sqlite'),'');
  await assert.rejects(initializeWorkspace(root),{code:'SCHEMA_MIGRATION_REQUIRED'});
  assert.equal((await stat(path.join(root,'harness.sqlite'))).size,0);
});
