import { mkdir, open, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { PublicError } from '../../domain/errors.mjs';

const transient=new Set(['EBUSY','EAGAIN','EINTR','ETXTBSY']);
export async function retryFile(work,{sleep=setTimeout}={}) {
 for(let attempt=0;;attempt++) {
  try {return await work();}
  catch(error) {if(!transient.has(error.code)||attempt>=2)throw error;await sleep([500,1500][attempt]);}
 }
}
/** Each retry owns a fresh exclusive staging file. Failures never expose partial output.
 * Hooks are internal fault-injection seams, not a public plugin API.
 */
async function stageContent(guard,openSource,{hooks={},sleep}={}) {
 return retryFile(async()=>{
  const relative=`staging/${randomUUID()}/original.bin`;
  let source,target;
  try {
   source=await openSource();
   await guard.withPaths([relative],filename=>mkdir(path.dirname(filename),{recursive:true}));
   target=await guard.withPaths([relative],filename=>open(filename,'wx'));
   // Chunked writes avoid loading large originals into memory.
   for await(const chunk of source.chunks) {
    let offset=0;
    while(offset<chunk.length) {
     const {bytesWritten}=await target.write(chunk,offset,chunk.length-offset);
     if(bytesWritten<=0)throw new PublicError('ASSET_WRITE_FAILED','Escrita não avançou.');
     offset+=bytesWritten;
    }
    await hooks.write?.(); // after real bytes, so injected failure leaves a genuine partial
   }
   await target.sync();
   await target.close(); target=null;
   await source.close(); source=null;
   await hooks.close?.();
   return relative;
  } finally {
   // Do not delete uncertain or partially written files; they remain unreferenced in staging.
   if(target)await target.close().catch(()=>{});
   if(source)await source.close().catch(()=>{});
  }
 },{sleep});
}
/** External reads are limited to this explicitly supplied source. */
export async function stageFile(guard,sourcePath,options={}) {
 return stageContent(guard,async()=>{
  const file=await open(sourcePath,'r');
  try {
   if(!(await file.stat()).isFile())throw new PublicError('ASSET_INVALID','Origem precisa ser arquivo regular.');
   return {chunks:file.createReadStream({autoClose:false}),close:()=>file.close()};
  } catch(error) {await file.close();throw error;}
 },options);
}
/** Generated manifests follow the same close/hash/exclusive-publication protocol. */
export async function stageBytes(guard,bytes,options={}) {
 if(!(bytes instanceof Uint8Array))throw new PublicError('ASSET_INVALID','Conteúdo binário inválido.');
 const copy=Buffer.from(bytes);
 return stageContent(guard,async()=>({chunks:[copy],close:async()=>{}}),options);
}
/** Hard-link publication is atomic and exclusive, unlike rename's overwrite behavior.
 * Staging and blobs must share the workspace volume. No copy fallback publishes partials.
 */
export async function promoteFile(guard,staging,final,{hooks={},sleep}={}) {
 await retryFile(async()=>{
  await guard.withPaths([final],filename=>mkdir(path.dirname(filename),{recursive:true}));
  await hooks.promotion?.();
  await guard.withPaths([staging,final],(source,target)=>link(source,target));
 },{sleep});
 // A leftover staging link is harmless. Failure here must still prevent DB publication.
 await retryFile(()=>guard.withPaths([staging],filename=>unlink(filename)),{sleep});
}
