import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PublicError, invalidArgument } from '../../domain/errors.mjs';
import { canonicalHash, canonicalJson } from '../../domain/canonical-json.mjs';
import { createConfinedRoot, normalizeReference } from '../fs/confined-path.mjs';
import { hashFile } from '../fs/hash-file.mjs';
import { openWorkspace } from './database.mjs';
import { verifySchema, qualityActivationMigration } from './migrations.mjs';
import { acquireMaintenance, renewMaintenance, releaseMaintenance, immediateTransaction, assertMaintenanceOwned, assertNoActiveExecutions } from './maintenance.mjs';

const failure=(code,message)=>new PublicError(code,message);
const badBackup=()=>failure('BACKUP_INVALID','A cópia de ativação não passou pela verificação.');
const denied=()=>failure('PATH_NOT_CONFINED','Caminho não confinado à raiz local autorizada.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const tables=['brands','brand_revisions','assets','runs','artifacts','steps','step_attempts','approvals','run_events','operations','workspace_settings','confirmation_requests','cleanup_jobs'];
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);

function disjoint(left,right) {
  const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);};
  if (inside(left,right)||inside(right,left)) throw denied();
}
async function newRoot(root) {
  const guard=await createConfinedRoot(root);
  try { await lstat(guard.root); throw failure('DESTINATION_EXISTS','O destino precisa ser um diretório novo.'); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  await mkdir(path.dirname(guard.root),{recursive:true});
  // Recheck ancestors after mkdir, then claim the final directory exclusively.
  await createConfinedRoot(root);
  try { await mkdir(guard.root); }
  catch(error) { if(error.code==='EEXIST') throw failure('DESTINATION_EXISTS','O destino precisa ser um diretório novo.'); throw error; }
  return guard;
}
async function writeExclusive(guard,relative,bytes) {
  const file=await guard.withPaths([relative],filename=>open(filename,'wx'));
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
function integrity(db) {
  if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length) throw badBackup();
}
function history(db) {
  const records=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  for(const row of records.runs) {
    let valid=false;
    try { valid=canonicalHash(JSON.parse(row.snapshot_json))===row.snapshot_hash; } catch {}
    if(!valid) throw failure('SNAPSHOT_HASH_MISMATCH','Snapshot não corresponde à identidade registrada.');
  }
  return canonicalHash(records);
}
function references(db) {
  const files=[...db.prepare('SELECT id,brand_id,run_id,kind,hash,relative_path,metadata_json FROM artifacts ORDER BY id').all().map(row=>({...row,entity:'artifact'})),
    ...db.prepare('SELECT id,brand_id,kind,hash,relative_path,metadata_json FROM assets ORDER BY id').all().map(row=>({...row,entity:'asset',run_id:null}))]
    .map(row=>{
      let metadata;
      try {metadata=JSON.parse(row.metadata_json);} catch {throw badBackup();}
      const descriptor={entity:row.entity,id:row.id,brandId:row.brand_id,runId:row.run_id,kind:row.kind,relativePath:row.relative_path,sha256:row.hash,size:metadata.size??null};
      validateReference(descriptor);return descriptor;
    }).sort((a,b)=>a.relativePath.localeCompare(b.relativePath,'en'));
  validateInventory(files);return files;
}
function validateReference(file) {
  try {
    if(!file||!['asset','artifact'].includes(file.entity)||typeof file.id!=='string'||typeof file.brandId!=='string'||typeof file.kind!=='string'||!sha(file.sha256)||file.size!==null&&(!Number.isSafeInteger(file.size)||file.size<0)) throw denied();
    const normalized=normalizeReference(file.relativePath),parts=normalized.split('/');
    if(normalized!==file.relativePath || /(?:font|typeface)/i.test(file.kind) || /\.(?:otf|ttf|ttc|woff2?|pf[abm])$/i.test(normalized)) throw denied();
    if(file.entity==='artifact' ? parts.length<4||parts[0]!=='runs'||parts[1]!==file.brandId||parts[2]!==file.runId : parts.length<3||parts[0]!=='blobs'||parts[1]!==file.brandId||file.runId!==null) throw denied();
  } catch {throw denied();}
}
/** Check every prefix: differently cased directories also alias on Windows,
 * even when their leaf filenames differ. Reject file/directory collisions and
 * normalized Unicode aliases conservatively before any managed file copy.
 */
function validateInventory(files) {
  const prefixes=new Map();
  for(const file of files) {
    validateReference(file);
    const parts=file.relativePath.split('/');
    for(let index=0;index<parts.length;index++) {
      const spelling=parts.slice(0,index+1).join('/'),key=spelling.normalize('NFC').toUpperCase();
      const terminal=index===parts.length-1,previous=prefixes.get(key);
      if(previous&&(previous.spelling!==spelling||previous.terminal||terminal))throw denied();
      prefixes.set(key,{spelling,terminal});
    }
  }
}
async function verifiedFile(guard,relative,expected,{fontCheck=false}={}) {
  let actual;
  try {
    actual=await guard.withPaths([relative],hashFile);
    if(fontCheck){
      const file=await guard.withPaths([relative],filename=>open(filename,'r'));
      try {
        const bytes=Buffer.alloc(4);const {bytesRead}=await file.read(bytes,0,4,0);
        if(bytesRead===4&&(['OTTO','ttcf','wOFF','wOF2','true','typ1'].includes(bytes.toString('latin1'))||bytes.readUInt32BE(0)===0x00010000)) throw denied();
      } finally {await file.close();}
    }
  } catch(error) {if(error.code==='ENOENT')throw failure('RESOURCE_MISSING','Arquivo gerenciado indisponível.');throw error;}
  if(actual.sha256!==expected.sha256||expected.size!==null&&expected.size!==undefined&&actual.size!==expected.size) throw failure(expected.entity==='asset'?'ASSET_HASH_MISMATCH':'ARTIFACT_HASH_MISMATCH','Bytes gerenciados divergem da identidade esperada.');
  return actual;
}
async function copyVerified(source,sourceReference,target,targetReference,expected,heartbeat=()=>{}) {
  heartbeat();
  const actual=await verifiedFile(source,sourceReference,expected,{fontCheck:expected.entity!=='database'});
  await target.withPaths([targetReference],filename=>mkdir(path.dirname(filename),{recursive:true}));
  let input,output;
  try {
    input=await source.withPaths([sourceReference],filename=>open(filename,'r'));
    output=await target.withPaths([targetReference],filename=>open(filename,'wx'));
    for await(const chunk of input.createReadStream({autoClose:false})) {
      await output.writeFile(chunk);heartbeat();
    }
    await output.sync();
  } finally {if(output)await output.close();if(input)await input.close();}
  await verifiedFile(target,targetReference,{...expected,...actual},{fontCheck:expected.entity!=='database'});
  heartbeat();return actual;
}
async function runtimeCompatible(db,qualifiedRuntime) {
  const qualified=qualifiedRuntime??JSON.parse(await readFile(new URL('../../../shared/resources.manifest.json',import.meta.url),'utf8')).qualifiedRuntime;
  const require=createRequire(import.meta.url);
  const actual={node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules};
  if(!qualified||Object.entries(actual).some(([key,value])=>qualified[key]!==value)||qualified.dependencies?.['better-sqlite3']!==require('better-sqlite3/package.json').version||qualified.native?.sqlite!==db.prepare('SELECT sqlite_version() version').get().version) throw failure('RUNTIME_INCOMPATIBLE','Runtime incompatível com a ativação do contrato.');
  return {...actual,sqlite:qualified.native.sqlite,betterSqlite3:qualified.dependencies['better-sqlite3']};
}
function metadata(db) {return db.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();}

async function readBackup(backup) {
  let manifest;
  try {
    const bytes=await backup.withPaths(['manifest.json'],filename=>readFile(filename));
    const checksum=await backup.withPaths(['manifest.sha256'],filename=>readFile(filename,'utf8'));
    if(checksum.trim()!==hash(bytes)) throw badBackup();
    manifest=JSON.parse(bytes);
    if(manifest.format!=='quality-contract-activation-backup'||manifest.formatVersion!==1||manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!sha(manifest.historyHash)||manifest.database?.relativePath!=='harness.sqlite'||!sha(manifest.database.sha256)||!Number.isSafeInteger(manifest.database.size)||manifest.database.size<0||typeof manifest.sourceRoot!=='string'||!path.isAbsolute(manifest.sourceRoot)) throw badBackup();
  } catch(error) {if(error.code==='PATH_NOT_CONFINED')throw error;throw badBackup();}
  validateInventory(manifest.files);
  try {await verifiedFile(backup,'harness.sqlite',{...manifest.database,entity:'database'});} catch {throw badBackup();}
  const db=await openWorkspace(backup.root);
  try {
    if(verifySchema(db)!==1||canonicalHash(metadata(db))!==canonicalHash(manifest.migrations)||history(db)!==manifest.historyHash) throw badBackup();
    integrity(db);
    const refs=references(db);
    if(refs.length!==manifest.files.length||refs.some((ref,index)=>canonicalHash({...ref,size:manifest.files[index].size})!==canonicalHash(manifest.files[index])||ref.size!==null&&ref.size!==manifest.files[index].size)) throw badBackup();
  } finally {db.close();}
  for(const file of manifest.files)await verifiedFile(backup,`files/${file.relativePath}`,file,{fontCheck:true});
  return manifest;
}

async function restoreIntoNewRoot(backup,manifest,destinationRoot,heartbeat=()=>{}) {
  const target=await newRoot(destinationRoot);
  await copyVerified(backup,'harness.sqlite',target,'harness.sqlite',{...manifest.database,entity:'database'},heartbeat);
  for(const file of manifest.files)await copyVerified(backup,`files/${file.relativePath}`,target,file.relativePath,file,heartbeat);
  const db=await openWorkspace(target.root,{readonly:false});
  try {
    integrity(db);
    if(history(db)!==manifest.historyHash)throw badBackup();
    // The backup's maintenance belongs to the original workspace. A separately
    // restored workspace has no running owner; never alter the preserved backup.
    immediateTransaction(db,()=>db.exec('UPDATE maintenance_coordination SET owner=NULL,purpose=NULL,expires_at=NULL WHERE singleton=1'));
  } finally {db.close();}
  const closed=await openWorkspace(target.root);
  try {integrity(closed);if(history(closed)!==manifest.historyHash)throw badBackup();} finally {closed.close();}
  return {schemaVersion:1,destinationRoot:target.root,historyHash:manifest.historyHash};
}

/** Narrow recovery for Q04's pre-activation copy, not the general T24/T26 restore. */
export async function restoreQualityContractBackup({backupRoot,destinationRoot}={}) {
  const backup=await createConfinedRoot(backupRoot),target=await createConfinedRoot(destinationRoot);
  disjoint(backup.root,target.root);
  const manifest=await readBackup(backup);
  disjoint(manifest.sourceRoot,target.root);
  return restoreIntoNewRoot(backup,manifest,target.root);
}

/** Internal explicit operation. Runtime qualification and fault hooks are trusted
 * host configuration, never fields accepted from a client/plugin request.
 * Originals stay intact on failure. Partial copies are not valid without a
 * verified manifest, and recovery always creates a separate workspace.
 */
export async function activateQualityContract({root,backupRoot,owner=randomUUID(),ttlMs=60000,now=Date.now,qualifiedRuntime,hooks={}}={}) {
  const source=await createConfinedRoot(root),candidate=await createConfinedRoot(backupRoot);
  disjoint(source.root,candidate.root);
  const db=await openWorkspace(source.root,{readonly:false});
  let lock,timer,renewalError,committedResult;
  const heartbeat=()=>{if(renewalError)throw renewalError;lock=renewMaintenance(db,lock,{ttlMs,now});};
  try {
    if(verifySchema(db)!==1)throw failure('WORKSPACE_ALREADY_ACTIVE','O contrato de qualidade já está ativo.');
    const runtime=await runtimeCompatible(db,qualifiedRuntime);
    integrity(db);const before=history(db);
    lock=acquireMaintenance(db,{owner,purpose:'quality-contract-activation',ttlMs,now});
    timer=setInterval(()=>{try{heartbeat();}catch(error){renewalError=error;}},Math.max(1,Math.floor(ttlMs/3)));
    timer.unref?.();
    const backup=await newRoot(candidate.root);
    await backup.withPaths(['harness.sqlite'],filename=>db.backup(filename,{progress(){heartbeat();}}));
    heartbeat();
    // The native backup handle is closed before hashing or opening a reader.
    const copy=await openWorkspace(backup.root);
    let files,migrations;
    try {
      integrity(copy);
      if(verifySchema(copy)!==1||history(copy)!==before)throw badBackup();
      files=references(copy);migrations=metadata(copy);
    } finally {copy.close();}
    const database={relativePath:'harness.sqlite',...await backup.withPaths(['harness.sqlite'],hashFile)};
    for(const file of files)Object.assign(file,await copyVerified(source,file.relativePath,backup,`files/${file.relativePath}`,file,heartbeat));
    const manifest={format:'quality-contract-activation-backup',formatVersion:1,schemaVersion:1,sourceRoot:source.root,runtime,migrations,historyHash:before,database,files};
    const bytes=Buffer.from(canonicalJson(manifest));
    await writeExclusive(backup,'manifest.json',bytes);
    await writeExclusive(backup,'manifest.sha256',`${hash(bytes)}\n`);
    await hooks.afterBackup?.();heartbeat();
    const verified=await readBackup(backup);heartbeat();
    const proof=`restore-proof-${randomUUID()}`;
    await restoreIntoNewRoot(backup,verified,path.join(backup.root,proof),heartbeat);
    // Only this fresh, verified, internal proof directory may be removed.
    await backup.withPaths([proof],filename=>rm(filename,{recursive:true}));
    await hooks.afterRestoreProof?.();heartbeat();
    // Re-verify after asynchronous hooks/work; the commit depends on this exact
    // preserved copy, not on a stale success flag.
    await readBackup(backup);heartbeat();
    immediateTransaction(db,()=>{
      assertMaintenanceOwned(db,lock,{now});assertNoActiveExecutions(db,now);
      if(verifySchema(db)!==1||history(db)!==before)throw badBackup();
      db.exec(qualityActivationMigration.sql);
      db.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES (?,?,?)').run(2,qualityActivationMigration.name,qualityActivationMigration.checksum);
      db.pragma('user_version=2');
      const injected=hooks.beforeCommit?.();
      if(injected?.then)throw invalidArgument('Hook de commit precisa ser síncrono.');
      verifySchema(db);integrity(db);
      if(history(db)!==before)throw badBackup();
      assertMaintenanceOwned(db,lock,{now});assertNoActiveExecutions(db,now);
    });
    // COMMIT is the outcome boundary. A later expiry/busy error cannot turn a
    // durable activation into a reported rollback or invite an unsafe retry.
    committedResult={status:'committed',schemaVersion:2,backupRoot:backup.root,manifestSha256:hash(bytes),restoreVerified:true,maintenance:{status:'released'}};
    clearInterval(timer);timer=null;
    try {heartbeat();releaseMaintenance(db,lock,{now});lock=null;}
    catch(error) {committedResult.maintenance={status:'cleanup-pending',diagnosticCode:error instanceof PublicError?error.code:'MAINTENANCE_CLEANUP_FAILED'};}
    return committedResult;
  } finally {
    if(timer)clearInterval(timer);
    if(lock&&!committedResult){try{releaseMaintenance(db,lock,{now});}catch{/* Never release another owner's token or mask the original failure. */}}
    try {db.close();}
    catch(error) {
      if(!committedResult)throw error;
      committedResult.maintenance={status:'cleanup-pending',diagnosticCode:'MAINTENANCE_CLEANUP_FAILED'};
    }
  }
}
