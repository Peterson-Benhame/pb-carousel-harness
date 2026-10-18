import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createConfinedRoot} from '../../src/infrastructure/fs/confined-path.mjs';
import {sha256} from '../../src/infrastructure/resources.mjs';

const adapter=await import('../../src/adapters/legacy/package-adapter.mjs').catch(error=>{
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
 return {};
});

test('package adapter writes only delivery members and independently checks CRC and hashes',async t=>{
 assert.equal(typeof adapter.packageEntries,'function');
 assert.equal(typeof adapter.writeVerifiedPackage,'function');
 assert.equal(typeof adapter.verifyPackageZip,'function');
 const root=await mkdtemp(path.join(os.tmpdir(),'t22-zip '));t.after(()=>rm(root,{recursive:true,force:true}));
 const guard=await createConfinedRoot(root),slide1=randomUUID(),slide2=randomUUID(),seam=randomUUID(),panorama=randomUUID();
 const data=new Map([[slide1,Buffer.from('synthetic-slide-one')],[slide2,Buffer.from('synthetic-slide-two')],[seam,Buffer.from('synthetic-seam')],[panorama,Buffer.from('synthetic-panorama')]]);
 const file=(id,role,slideIndex=null)=>({role,slideIndex,artifactRef:{id,sha256:sha256(data.get(id))}});
 const manifest={kind:'final',files:[file(slide1,'slide',1),file(slide2,'slide',2),file(seam,'seam'),file(panorama,'panorama')]};
 const carousel={slides:[{index:1},{index:2}],caption:'Legenda sintética.',cta:'Ação geral.',hashtags:['#synthetic'],altText:'Descrição sintética.',sources:[{title:'Fonte sintética',url:'https://example.com/'}]};
 const files=[...data].map(([id,bytes])=>({id,bytes}));
 const entries=adapter.packageEntries({manifest,carousel,files});
 assert.deepEqual(entries.map(e=>e.name),['slides/01.png','slides/02.png','panorama.png','legenda.txt','referencias.txt']);
 assert.equal(entries.find(e=>e.name==='slides/01.png').sha256,sha256(data.get(slide1)));
 const relativePath='staging/test/bundle.zip';
 const written=await adapter.writeVerifiedPackage({guard,relativePath,entries});
 assert.equal(written.sha256,sha256(await guard.withPaths([relativePath],p=>readFile(p))));
 assert.deepEqual(written.members.map(m=>m.name),entries.map(e=>e.name));
 assert.ok(written.members.every(m=>Number.isSafeInteger(m.crc32)));
 const actual=await guard.withPaths([relativePath],p=>readFile(p));
 const eocd=actual.length-22;
 const commented=Buffer.concat([actual,Buffer.from('x')]);commented.writeUInt16LE(1,eocd+20);
 await guard.withPaths([relativePath],p=>writeFile(p,commented));
 await assert.rejects(adapter.verifyPackageZip({guard,relativePath,entries}),{code:'PACKAGE_INTEGRITY_FAILED'});
 const localCrc=Buffer.from(actual);localCrc.writeUInt32LE(localCrc.readUInt32LE(14)^1,14);
 await guard.withPaths([relativePath],p=>writeFile(p,localCrc));
 await assert.rejects(adapter.verifyPackageZip({guard,relativePath,entries}),{code:'PACKAGE_INTEGRITY_FAILED'});
 const gap=Buffer.concat([actual.subarray(0,actual.readUInt32LE(eocd+16)),Buffer.from('x'),actual.subarray(actual.readUInt32LE(eocd+16))]);
 gap.writeUInt32LE(actual.readUInt32LE(eocd+16)+1,eocd+17);
 await guard.withPaths([relativePath],p=>writeFile(p,gap));
 await assert.rejects(adapter.verifyPackageZip({guard,relativePath,entries}),{code:'PACKAGE_INTEGRITY_FAILED'});
 const centralExtra=Buffer.from(actual),central=actual.readUInt32LE(eocd+16);centralExtra.writeUInt16LE(1,central+30);
 assert.deepEqual([actual.readUInt16LE(central+4),actual.readUInt16LE(central+6),actual.readUInt16LE(central+12),actual.readUInt16LE(central+14),actual.readUInt16LE(central+36),actual.readUInt32LE(central+38)],[0x032d,10,0,33,0,0x81a40020]);
 await guard.withPaths([relativePath],p=>writeFile(p,centralExtra));
 await assert.rejects(adapter.verifyPackageZip({guard,relativePath,entries}),{code:'PACKAGE_INTEGRITY_FAILED'});
 const centralComment=Buffer.from(actual);centralComment.writeUInt16LE(1,central+32);
 await guard.withPaths([relativePath],p=>writeFile(p,centralComment));
 await assert.rejects(adapter.verifyPackageZip({guard,relativePath,entries}),{code:'PACKAGE_INTEGRITY_FAILED'});
 const localExtra=Buffer.from(actual);localExtra.writeUInt16LE(1,28);
 await guard.withPaths([relativePath],p=>writeFile(p,localExtra));
 await assert.rejects(adapter.verifyPackageZip({guard,relativePath,entries}),{code:'PACKAGE_INTEGRITY_FAILED'});
 for(const [offset,width] of [[central+4,2],[central+6,2],[central+12,2],[central+14,2],[central+36,2],[central+38,4],[4,2],[10,2],[12,2]]){
  const alteredHeader=Buffer.from(actual);
  if(width===2)alteredHeader.writeUInt16LE(alteredHeader.readUInt16LE(offset)^1,offset);
  else alteredHeader.writeUInt32LE((alteredHeader.readUInt32LE(offset)^1)>>>0,offset);
  await guard.withPaths([relativePath],p=>writeFile(p,alteredHeader));
  await assert.rejects(adapter.verifyPackageZip({guard,relativePath,entries}),{code:'PACKAGE_INTEGRITY_FAILED'});
 }
 const altered=Buffer.from(actual),offset=altered.indexOf(data.get(slide1));
 assert.ok(offset>=0,'stored slide bytes must be present in ZIP');altered[offset]^=1;
 await guard.withPaths([relativePath],p=>writeFile(p,altered));
 await assert.rejects(adapter.verifyPackageZip({guard,relativePath,entries}),{code:'PACKAGE_INTEGRITY_FAILED'});
});

test('package adapter rejects hostile member names before writing a ZIP',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'t22-member '));t.after(()=>rm(root,{recursive:true,force:true}));
 const guard=await createConfinedRoot(root),bytes=Buffer.from('synthetic');
 const valid=['slides/01.png','panorama.png','legenda.txt','referencias.txt'];
 for(const name of ['../x','/absolute','C:/x','a\\b','file.txt:stream','CON']){
  const entries=valid.map((n,i)=>({name:i===0?name:n,bytes,sha256:sha256(bytes)}));
  await assert.rejects(adapter.writeVerifiedPackage({guard,relativePath:'staging/bad.zip',entries}),{code:'INVALID_ARGUMENT'});
 }
});
