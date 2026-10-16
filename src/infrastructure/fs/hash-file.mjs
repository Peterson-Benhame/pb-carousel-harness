import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

/** Stream the exact stored bytes; callers decide confinement and expected identity. */
export async function hashFile(filename) {
 const file=await open(filename,'r');
 try {
  const hash=createHash('sha256'); let size=0;
  for await (const chunk of file.createReadStream({autoClose:false})) {hash.update(chunk);size+=chunk.length;}
  return {sha256:hash.digest('hex'),size};
 } finally {await file.close();}
}
