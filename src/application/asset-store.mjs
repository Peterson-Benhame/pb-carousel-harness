import { randomUUID } from 'node:crypto';
import { createConfinedRoot } from '../infrastructure/fs/confined-path.mjs';
import { stageFile, promoteFile } from '../infrastructure/fs/atomic-files.mjs';
import { hashFile } from '../infrastructure/fs/hash-file.mjs';
import { createRepositories } from '../infrastructure/sqlite/repositories.mjs';
import { runOperation } from './operation-runner.mjs';
import { validatePathSegment } from '../domain/identifiers.mjs';
import { PublicError, invalidArgument } from '../domain/errors.mjs';

const missing=()=>new PublicError('RESOURCE_MISSING','Arquivo gerenciado indisponível.');
const mismatch=()=>new PublicError('ASSET_HASH_MISMATCH','Bytes gerenciados divergem da identidade esperada.');
/** Internal byte store. Caller supplies a content identity and previously validated
 * descriptor. PNG decoding/validation belongs to T09, not this storage primitive.
 * sourcePath is transport only: never persisted or used as idempotency identity.
 */
export async function createAssetStore({root,db,hooks={},sleep,now=Date.now}) {
 const guard=await createConfinedRoot(root),repositories=createRepositories(db);
 async function verify(relative,sha256,size) {
  let actual;
  try {actual=await guard.withPaths([relative],hashFile);}
  catch(error) {if(error.code==='ENOENT')throw missing();throw error;}
  if(actual.sha256!==sha256 || (size!==undefined && actual.size!==size))throw mismatch();
  return actual;
 }
 async function resolve(brandId,id) {
  const row=repositories.getAsset(brandId,id);if(!row)throw missing();
  const {size}=JSON.parse(row.metadata_json);
  await verify(row.relative_path,row.hash,size);
  return {id:row.id,sha256:row.hash,size,path:await guard.resolve(row.relative_path)};
 }
 async function importFile(input) {
  const {requestId,brandId,sourcePath,sha256,kind,width,height,originalName}=input ?? {};
  validatePathSegment(brandId);validatePathSegment(originalName);
  if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||typeof kind!=='string'||!kind.trim()||!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0)throw invalidArgument('Descritor de arquivo inválido.');
  const request={requestId,operation:'asset.import',brandId,payload:{sha256,kind,width,height,originalName}};
  const prepare=Symbol('prepare');let replay;
  try {
   replay=runOperation(db,request,()=>{
    if(!repositories.getBrand(brandId))throw new PublicError('BRAND_NOT_FOUND','Marca não encontrada.');
    throw prepare;
   },{now});
  } catch(error) {if(error!==prepare)throw error;}
  if(replay) {await resolve(brandId,replay.id);return replay;}
  if(typeof sourcePath!=='string'||!sourcePath)throw invalidArgument('Origem de arquivo obrigatória.');
  const staging=await stageFile(guard,sourcePath,{hooks,sleep});
  await hooks.hash?.(); // deliberately outside the filesystem retry boundary
  const {size}=await verify(staging,sha256);
  const id=randomUUID(),relativePath=`blobs/${brandId}/${sha256}/${id}.bin`;
  await promoteFile(guard,staging,relativePath,{hooks,sleep});
  // Confirm the promoted path too; neither a partial write nor a stale source is success.
  await verify(relativePath,sha256,size);
  const result=runOperation(db,request,()=>{
   db.prepare('INSERT INTO assets(id,brand_id,hash,relative_path,kind,width,height,metadata_json) VALUES (?,?,?,?,?,?,?,?)').run(id,brandId,sha256,relativePath,kind,width,height,JSON.stringify({originalName,size}));
   const injected=hooks.commit?.();
   if(injected?.then)throw invalidArgument('Hook de commit precisa ser síncrono.');
   return {status:'committed',result:{id,brandId,sha256,size,relativePath}};
  },{now});
  // A competing writer can have won; validate its result, leaving our file an orphan.
  await resolve(brandId,result.id);
  return result;
 }
 return Object.freeze({importFile,resolve});
}
