import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { initializeWorkspace, openWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import * as migrations from '../../src/infrastructure/sqlite/migrations.mjs';
import {verifySchema as verifyLegacySchema} from '../fixtures/quality/legacy-schema-v1.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';

const initialChecksum = 'b44eaae8591b96af5ba6a0d66983c4ef885552402042c99ade5f0530b69a9181';
const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture(t, options) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'carousel-q04-ativação '));
  const root = path.join(parent, 'original'), backupRoot = path.join(parent, 'backup');
  const connections = [];
  t.after(async () => {
    for (const db of connections.reverse()) if (db.open) db.close();
    await rm(parent, {recursive:true,force:true});
  });
  const db = await initializeWorkspace(root,options); connections.push(db);
  const own = connection => {connections.push(connection);return connection;};
  return {parent,root,backupRoot,db,own};
}

test('historical schema stays at 1 on read and refuses the quality mutation guard', async t => {
  const f=await fixture(t); const reader=f.own(await openWorkspace(f.root));
  assert.equal(reader.pragma('user_version',{simple:true}),1);
  assert.equal(migrations.initialMigration.checksum,initialChecksum);
  assert.equal(typeof migrations.assertQualityContractActive,'function');
  assert.throws(()=>migrations.assertQualityContractActive(reader),{code:'WORKSPACE_ACTIVATION_REQUIRED'});
  assert.equal(reader.prepare("SELECT count(*) n FROM sqlite_master WHERE name='workspace_contract_activation'").get().n,0);
});

test('explicit empty schema 2 records migration 002 and a singleton immutable activation', async t => {
  const {db,root,own}=await fixture(t,{schemaVersion:2});
  assert.equal(db.pragma('user_version',{simple:true}),2);
  assert.equal(db.prepare('SELECT checksum FROM schema_migrations WHERE version=1').get().checksum,initialChecksum);
  assert.equal(db.prepare('SELECT checksum FROM schema_migrations WHERE version=2').get().checksum,migrations.qualityActivationMigration.checksum);
  const row=db.prepare('SELECT * FROM workspace_contract_activation').get();
  assert.deepEqual({...row,activated_at:'timestamp'},{singleton:1,contract_version:2,pipeline_version:2,minimum_protocol_version:2,quality_policy_version:1,activated_at:'timestamp'});
  assert.ok(!Number.isNaN(Date.parse(row.activated_at)));
  for(const sql of ["UPDATE workspace_contract_activation SET activated_at='changed'",'DELETE FROM workspace_contract_activation',"INSERT OR REPLACE INTO workspace_contract_activation(singleton) VALUES(1)","INSERT INTO workspace_contract_activation(singleton) VALUES(2)"]){
    assert.throws(()=>db.exec(sql),error=>error.code?.startsWith('SQLITE_CONSTRAINT'));
  }
  migrations.assertQualityContractActive(own(await openWorkspace(root)));
});

test('asking to initialize an existing schema 1 as 2 never migrates it automatically',async t=>{
  const {root,db}=await fixture(t);
  await assert.rejects(initializeWorkspace(root,{schemaVersion:2}),{code:'WORKSPACE_ACTIVATION_REQUIRED'});
  assert.equal(db.pragma('user_version',{simple:true}),1);
});

test('schema 2 requires both exact migration checksums and real activation metadata',async t=>{
  const {db,root}=await fixture(t,{schemaVersion:2});
  db.exec("UPDATE schema_migrations SET checksum='tampered' WHERE version=2");
  await assert.rejects(openWorkspace(root),{code:'MIGRATION_CHECKSUM_MISMATCH'});
});

async function activator() { return import('../../src/infrastructure/sqlite/quality-activation.mjs'); }
async function synthetic(t) {
  const f=await fixture(t),snapshot={schemaVersion:1,synthetic:true};
  f.db.prepare('INSERT INTO brands(id) VALUES (?)').run('brand');
  f.db.prepare("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES ('brand',1,'{}',?,'user-confirmed')").run(canonicalHash({}));
  f.db.prepare("INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash,status) VALUES ('run','brand',1,?,?,'completed')").run(JSON.stringify(snapshot),canonicalHash(snapshot));
  const artifactBytes=Buffer.from('synthetic render bytes'),assetBytes=Buffer.from('synthetic logo bytes');
  const artifactPath='runs/brand/run/generation/artifact.bin',assetPath=`blobs/brand/${digest(assetBytes)}/asset.bin`;
  for (const [relative,bytes] of [[artifactPath,artifactBytes],[assetPath,assetBytes],['fonts/private.ttf','unmanaged-font'],['sources/private.json','unmanaged-source']]) {
    await mkdir(path.dirname(path.join(f.root,relative)),{recursive:true});
    await writeFile(path.join(f.root,relative),bytes);
  }
  f.db.prepare("INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES ('artifact','brand','run','render',1,?,?,?)").run(digest(artifactBytes),artifactPath,JSON.stringify({size:artifactBytes.length}));
  f.db.prepare("INSERT INTO assets(id,brand_id,kind,width,height,hash,relative_path,metadata_json) VALUES ('asset','brand','logo',1,1,?,?,?)").run(digest(assetBytes),assetPath,JSON.stringify({size:assetBytes.length}));
  const qualifiedRuntime={node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules,dependencies:{'better-sqlite3':JSON.parse(await readFile(new URL('../../node_modules/better-sqlite3/package.json',import.meta.url),'utf8')).version},native:{sqlite:f.db.prepare('SELECT sqlite_version() version').get().version}};
  return {...f,qualifiedRuntime,artifactPath,assetPath};
}
const history=db=>Object.fromEntries(['brands','brand_revisions','runs','artifacts','assets','approvals','steps','step_attempts','run_events','operations'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const options=f=>({root:f.root,backupRoot:f.backupRoot,qualifiedRuntime:f.qualifiedRuntime,owner:'synthetic-activation'});

test('activation uses a native consistent backup and proves independent restore before preserving history in schema 2',async t=>{
  const f=await synthetic(t),before=history(f.db),{activateQualityContract,restoreQualityContractBackup}=await activator();
  let nativeBackups=0;
  const original=Database.prototype.backup;
  Database.prototype.backup=function(...args){nativeBackups++;return original.apply(this,args);};
  let result;
  try { result=await activateQualityContract(options(f)); }
  finally { Database.prototype.backup=original; }
  assert.ok(nativeBackups>=1,'the open database must be copied by SQLite backup, never filesystem copy');
  assert.equal(result.schemaVersion,2);assert.equal(result.restoreVerified,true);
  assert.deepEqual(history(f.db),before);assert.equal(f.db.pragma('user_version',{simple:true}),2);
  assert.equal(f.db.prepare('SELECT owner FROM maintenance_coordination').get().owner,null);
  const manifestBytes=await readFile(path.join(f.backupRoot,'manifest.json'));
  assert.equal((await readFile(path.join(f.backupRoot,'manifest.sha256'),'utf8')).trim(),digest(manifestBytes));
  const manifest=JSON.parse(manifestBytes);
  assert.equal(manifest.schemaVersion,1);assert.equal(manifest.migrations[0].checksum,initialChecksum);
  assert.deepEqual(manifest.files.map(x=>x.relativePath).sort(),[f.artifactPath,f.assetPath].sort());
  for(const excluded of ['fonts/private.ttf','sources/private.json']) await assert.rejects(stat(path.join(f.backupRoot,'files',excluded)),{code:'ENOENT'});
  const destinationRoot=path.join(f.parent,'restored');
  await restoreQualityContractBackup({backupRoot:f.backupRoot,destinationRoot});
  const restored=f.own(await openWorkspace(destinationRoot));
  assert.equal(restored.pragma('user_version',{simple:true}),1);assert.deepEqual(history(restored),before);
  assert.equal(restored.prepare('SELECT owner FROM maintenance_coordination').get().owner,null);
  assert.deepEqual(await readFile(path.join(destinationRoot,f.artifactPath)),await readFile(path.join(f.root,f.artifactPath)));
  assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(restored.pragma('foreign_key_check'),[]);
});

test('failure inside activation transaction rolls back DDL, checksum and user_version together',async t=>{
  const f=await synthetic(t),before=history(f.db),{activateQualityContract}=await activator();
  await assert.rejects(activateQualityContract({...options(f),hooks:{beforeCommit(){throw new Error('synthetic commit failure');}}}),/synthetic commit failure/);
  assert.equal(f.db.pragma('user_version',{simple:true}),1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM schema_migrations').get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='workspace_contract_activation'").get().n,0);
  assert.deepEqual(history(f.db),before);
  assert.equal(f.db.prepare('SELECT owner FROM maintenance_coordination').get().owner,null);
});

test('expired maintenance or replaced fencing token aborts before activation',async t=>{
  const {activateQualityContract}=await activator();
  for(const lose of ['expire','replace']){
    const f=await synthetic(t);let now=100;
    await assert.rejects(activateQualityContract({...options(f),now:()=>now,ttlMs:1000,hooks:{afterBackup(){
      if(lose==='expire')now=1100;
      else f.db.exec("UPDATE maintenance_coordination SET owner='other',fencing_token=fencing_token+1");
    }}}),{code:'MAINTENANCE_LOST'});
    assert.equal(f.db.pragma('user_version',{simple:true}),1);
    if(lose==='replace')assert.equal(f.db.prepare('SELECT owner FROM maintenance_coordination').get().owner,'other');
  }
});

test('activation renews maintenance during work and checks the lock again after its final hook',async t=>{
  const f=await synthetic(t),{activateQualityContract}=await activator();let now=100,expiry;
  await assert.rejects(activateQualityContract({...options(f),now:()=>now,ttlMs:1000,hooks:{afterBackup(){now=500;},afterRestoreProof(){expiry=f.db.prepare('SELECT expires_at FROM maintenance_coordination').get().expires_at;},beforeCommit(){now=10000;}}}),{code:'MAINTENANCE_LOST'});
  assert.ok(expiry>=1500);assert.equal(f.db.pragma('user_version',{simple:true}),1);
});

test('active leases and running attempts are refused before creating a backup',async t=>{
  const {activateQualityContract}=await activator();
  for(const active of ['lease','attempt']){
    const f=await synthetic(t);
    if(active==='lease') f.db.prepare("UPDATE runs SET lease_owner='worker',lease_expires_at=?").run(Date.now()+60000);
    else f.db.exec("INSERT INTO steps(id,brand_id,run_id,step_key) VALUES ('step','brand','run','render'); INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token) VALUES ('attempt','brand','run','step',1,'worker',1)");
    await assert.rejects(activateQualityContract(options(f)),{code:'WORKSPACE_BUSY'});
    await assert.rejects(stat(f.backupRoot),{code:'ENOENT'});
  }
});

test('bad runtime and snapshot hashes stop activation before backup publication',async t=>{
  const {activateQualityContract}=await activator();
  const f=await synthetic(t);
  await assert.rejects(activateQualityContract({...options(f),qualifiedRuntime:{...f.qualifiedRuntime,node:'v0.0.0'}}),{code:'RUNTIME_INCOMPATIBLE'});
  await assert.rejects(stat(f.backupRoot),{code:'ENOENT'});
  f.db.exec('DROP TRIGGER immutable_run_snapshot');f.db.prepare('UPDATE runs SET snapshot_hash=?').run('a'.repeat(64));
  await assert.rejects(activateQualityContract(options(f)),{code:'SNAPSHOT_HASH_MISMATCH'});
  assert.equal(f.db.pragma('user_version',{simple:true}),1);
});

test('artifact byte mismatch and cross-scope paths abort instead of preserving unsafe files',async t=>{
  const {activateQualityContract}=await activator();
  for(const invalid of ['bytes','scope','traversal','font']){
    const f=await synthetic(t);
    if(invalid==='bytes')await writeFile(path.join(f.root,f.artifactPath),'tampered');
    else {f.db.exec('DROP TRIGGER immutable_artifact');f.db.prepare('UPDATE artifacts SET relative_path=?').run({scope:'runs/other/run/file.bin',traversal:'../outside.bin',font:'fonts/private.ttf'}[invalid]);}
    await assert.rejects(activateQualityContract(options(f)),{code:invalid==='bytes'?'ARTIFACT_HASH_MISMATCH':'PATH_NOT_CONFINED'});
    assert.equal(f.db.pragma('user_version',{simple:true}),1);
  }
});

test('restore rejects tampered database, file bytes and manifest hashes',async t=>{
  const {activateQualityContract,restoreQualityContractBackup}=await activator();
  for(const target of ['database','artifact','manifest']){
    const f=await synthetic(t);await activateQualityContract(options(f));
    const relative={database:'harness.sqlite',artifact:`files/${f.artifactPath}`,manifest:'manifest.json'}[target];
    await writeFile(path.join(f.backupRoot,relative),'corrupted');
    await assert.rejects(restoreQualityContractBackup({backupRoot:f.backupRoot,destinationRoot:path.join(f.parent,'restore')}),{code:target==='artifact'?'ARTIFACT_HASH_MISMATCH':'BACKUP_INVALID'});
    assert.equal(f.db.pragma('user_version',{simple:true}),2);
  }
});

test('backup and restore are confined to new disjoint destinations and never downgrade in place',async t=>{
  const f=await synthetic(t),{activateQualityContract,restoreQualityContractBackup}=await activator();
  await assert.rejects(activateQualityContract({...options(f),backupRoot:path.join(f.root,'backup')}),{code:'PATH_NOT_CONFINED'});
  await mkdir(f.backupRoot);await writeFile(path.join(f.backupRoot,'keep'),'unchanged');
  await assert.rejects(activateQualityContract(options(f)),{code:'DESTINATION_EXISTS'});
  assert.equal(await readFile(path.join(f.backupRoot,'keep'),'utf8'),'unchanged');
  await rm(f.backupRoot,{recursive:true});await activateQualityContract(options(f));
  await assert.rejects(restoreQualityContractBackup({backupRoot:f.backupRoot,destinationRoot:f.root}),{code:'PATH_NOT_CONFINED'});
  const exists=path.join(f.parent,'exists');await mkdir(exists);
  await assert.rejects(restoreQualityContractBackup({backupRoot:f.backupRoot,destinationRoot:exists}),{code:'DESTINATION_EXISTS'});
  assert.equal(f.db.pragma('user_version',{simple:true}),2);
});

test('legacy schema 1 writer guard refuses an activated workspace before its first domain write',async t=>{
  const f=await synthetic(t),{activateQualityContract}=await activator();await activateQualityContract(options(f));
  // The early user_version guard shipped in 001 is deliberately frozen here.
  const legacyWriter=db=>{verifyLegacySchema(db);db.exec("UPDATE runs SET status='running'");};
  assert.throws(()=>legacyWriter(f.db),{code:'SCHEMA_TOO_NEW'});
  assert.equal(f.db.prepare('SELECT status FROM runs').get().status,'completed');
});

test('restore requires the complete database inventory even when a changed manifest has a matching checksum',async t=>{
  const f=await synthetic(t),{activateQualityContract,restoreQualityContractBackup}=await activator();await activateQualityContract(options(f));
  const manifest=JSON.parse(await readFile(path.join(f.backupRoot,'manifest.json'),'utf8'));
  manifest.files.pop();const bytes=JSON.stringify(manifest);
  await writeFile(path.join(f.backupRoot,'manifest.json'),bytes);
  await writeFile(path.join(f.backupRoot,'manifest.sha256'),digest(bytes));
  await assert.rejects(restoreQualityContractBackup({backupRoot:f.backupRoot,destinationRoot:path.join(f.parent,'restore')}),{code:'BACKUP_INVALID'});
});

test('a backup altered after restore proof still blocks activation',async t=>{
  const f=await synthetic(t),{activateQualityContract}=await activator();
  await assert.rejects(activateQualityContract({...options(f),hooks:{async afterRestoreProof(){await writeFile(path.join(f.backupRoot,'files',f.artifactPath),'changed after proof');}}}),{code:'ARTIFACT_HASH_MISMATCH'});
  assert.equal(f.db.pragma('user_version',{simple:true}),1);
});

test('the final transaction detects unauthorized history or active execution changes after backup',async t=>{
  const {activateQualityContract}=await activator();
  for(const change of ['history','lease','attempt']){
    const f=await synthetic(t);
    await assert.rejects(activateQualityContract({...options(f),hooks:{afterRestoreProof(){
      if(change==='history')f.db.exec("UPDATE runs SET version=version+1");
      if(change==='lease')f.db.prepare("UPDATE runs SET lease_owner='worker',lease_expires_at=?").run(Date.now()+60000);
      if(change==='attempt')f.db.exec("INSERT INTO steps(id,brand_id,run_id,step_key) VALUES ('step','brand','run','render'); INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token) VALUES ('attempt','brand','run','step',1,'worker',1)");
    }}}),{code:change==='history'?'BACKUP_INVALID':'WORKSPACE_BUSY'});
    assert.equal(f.db.pragma('user_version',{simple:true}),1);
  }
});

test('symlinked managed files and destination ancestors cannot be copied or activated',async t=>{
  const {symlink}=await import('node:fs/promises'),{activateQualityContract}=await activator();
  const f=await synthetic(t),outside=path.join(f.parent,'outside');await mkdir(outside);
  const alias=path.join(f.parent,'alias');
  await symlink(outside,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(activateQualityContract({...options(f),backupRoot:path.join(alias,'backup')}),{code:'PATH_NOT_CONFINED'});
  const artifactDirectory=path.dirname(path.join(f.root,f.artifactPath));
  await rm(artifactDirectory,{recursive:true});
  await writeFile(path.join(outside,'artifact.bin'),'synthetic render bytes');
  await symlink(outside,artifactDirectory,process.platform==='win32'?'junction':'dir');
  await assert.rejects(activateQualityContract(options(f)),{code:'PATH_NOT_CONFINED'});
  assert.equal(f.db.pragma('user_version',{simple:true}),1);
});

test('managed font bytes are never preserved by the activation backup',async t=>{
  const f=await synthetic(t),{activateQualityContract}=await activator(),font=Buffer.from('OTTOsynthetic font');
  await writeFile(path.join(f.root,f.artifactPath),font);
  f.db.exec('DROP TRIGGER immutable_artifact');
  f.db.prepare('UPDATE artifacts SET hash=?,metadata_json=?').run(digest(font),JSON.stringify({size:font.length}));
  await assert.rejects(activateQualityContract(options(f)),{code:'PATH_NOT_CONFINED'});
  assert.equal(f.db.pragma('user_version',{simple:true}),1);
});

test('foreign-key violations abort activation before acquiring maintenance',async t=>{
  const f=await synthetic(t),{activateQualityContract}=await activator();
  f.db.pragma('foreign_keys=OFF');f.db.exec("DELETE FROM brand_revisions");f.db.pragma('foreign_keys=ON');
  await assert.rejects(activateQualityContract(options(f)),{code:'BACKUP_INVALID'});
  assert.equal(f.db.prepare('SELECT owner FROM maintenance_coordination').get().owner,null);
  await assert.rejects(stat(f.backupRoot),{code:'ENOENT'});
});

test('activation already at schema 2 rejects without another backup or historical mutation',async t=>{
  const f=await synthetic(t),{activateQualityContract}=await activator();await activateQualityContract(options(f));
  const before=history(f.db);
  await assert.rejects(activateQualityContract({...options(f),backupRoot:path.join(f.parent,'backup2')}),{code:'WORKSPACE_ALREADY_ACTIVE'});
  assert.deepEqual(history(f.db),before);await assert.rejects(stat(path.join(f.parent,'backup2')),{code:'ENOENT'});
});

test('multi-page native backup can renew maintenance without losing a consistent history copy',async t=>{
  const f=await synthetic(t),{activateQualityContract}=await activator();
  f.db.prepare("INSERT INTO operations(request_id,operation,payload_hash,canonical_version,result_json) VALUES ('large','synthetic',?,1,?)").run('a'.repeat(64),JSON.stringify({data:'x'.repeat(2*1024*1024)}));
  const before=history(f.db),original=Database.prototype.backup;let progressCalls=0;
  Database.prototype.backup=function(filename,settings){return original.call(this,filename,{...settings,progress(state){progressCalls++;return settings.progress(state);}});};
  try {await activateQualityContract(options(f));} finally {Database.prototype.backup=original;}
  assert.ok(progressCalls>=2);assert.deepEqual(history(f.db),before);
});

test('activation refuses case-insensitive aliases in filenames and directory segments on every host',async t=>{
  const {activateQualityContract}=await activator();
  for(const alias of ['runs/brand/run/generation/Artifact.bin','runs/brand/run/Generation/second.bin']){
    const f=await synthetic(t),bytes=await readFile(path.join(f.root,f.artifactPath));
    await mkdir(path.dirname(path.join(f.root,alias)),{recursive:true});await writeFile(path.join(f.root,alias),bytes);
    f.db.prepare("INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES ('alias','brand','run','render',2,?,?,?)").run(digest(bytes),alias,JSON.stringify({size:bytes.length}));
    await assert.rejects(activateQualityContract(options(f)),{code:'PATH_NOT_CONFINED'});
    assert.equal(f.db.pragma('user_version',{simple:true}),1);
  }
});

test('restore rejects case-insensitive segment aliases before creating a destination',async t=>{
  const f=await synthetic(t),{activateQualityContract,restoreQualityContractBackup}=await activator();await activateQualityContract(options(f));
  const manifest=JSON.parse(await readFile(path.join(f.backupRoot,'manifest.json'),'utf8'));
  const file=manifest.files.find(file=>file.entity==='artifact');
  manifest.files.push({...file,id:'alias',relativePath:file.relativePath.replace('/generation/','/Generation/')});
  const bytes=JSON.stringify(manifest);await writeFile(path.join(f.backupRoot,'manifest.json'),bytes);await writeFile(path.join(f.backupRoot,'manifest.sha256'),digest(bytes));
  const destinationRoot=path.join(f.parent,'restore');
  await assert.rejects(restoreQualityContractBackup({backupRoot:f.backupRoot,destinationRoot}),{code:'PATH_NOT_CONFINED'});
  await assert.rejects(stat(destinationRoot),{code:'ENOENT'});
});

test('maintenance expiring after COMMIT reports committed activation and an explicit cleanup diagnostic',async t=>{
  const f=await synthetic(t),{activateQualityContract}=await activator();let commitReached=false;
  const now=()=>commitReached&&f.db.pragma('user_version',{simple:true})===2?2000:100;
  const result=await activateQualityContract({...options(f),now,ttlMs:1000,hooks:{beforeCommit(){commitReached=true;}}});
  assert.equal(f.db.pragma('user_version',{simple:true}),2);
  assert.equal(result.status,'committed');assert.equal(result.schemaVersion,2);assert.equal(result.restoreVerified,true);
  assert.deepEqual(result.maintenance,{status:'cleanup-pending',diagnosticCode:'MAINTENANCE_LOST'});
  assert.equal(result.backupRoot,f.backupRoot);
  assert.equal(result.manifestSha256,digest(await readFile(path.join(f.backupRoot,'manifest.json'))));
});
