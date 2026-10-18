import {createWriteStream,fstatSync,lstatSync,readSync} from 'node:fs';
import {mkdir,open} from 'node:fs/promises';
import {finished} from 'node:stream/promises';
import path from 'node:path';
import archiver from 'archiver';
import {PublicError,invalidArgument} from '../../domain/errors.mjs';
import {sha256} from '../../infrastructure/resources.mjs';

const invalid=()=>{throw new PublicError('PACKAGE_INTEGRITY_FAILED','ZIP da entrega diverge dos membros aprovados.');};
const ZIP_DATE=new Date('1980-01-01T00:00:00.000Z');
const ZIP_MODE=0o100644;
const ZIP_MADE_BY=0x032d,ZIP_NEEDED=10,ZIP_DOS_DATE=33,ZIP_EXTERNAL_ATTRIBUTES=0x81a40020;
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const text=value=>typeof value==='string'?value:null;
function validateEntries(entries){
 if(!Array.isArray(entries)||entries.length<4||entries.length>102||entries.some(e=>!Buffer.isBuffer(e?.bytes)||e.bytes.length>0xffffffff||sha256(e.bytes)!==e.sha256))throw invalidArgument('Membros do pacote inválidos.');
 const slides=entries.length-3,names=[...Array.from({length:slides},(_,i)=>`slides/${String(i+1).padStart(2,'0')}.png`),'panorama.png','legenda.txt','referencias.txt'];
 if(entries.some((e,i)=>e.name!==names[i]))throw invalidArgument('Membros do pacote inválidos.');
}

/** Only approved final output bytes and copy fields enter the delivery allowlist.
 * Source paths, seam diagnostics and original assets never become ZIP members. */
export function packageEntries({manifest,carousel,files}){
 if(manifest?.kind!=='final'||!Array.isArray(manifest.files)||!Array.isArray(files)||!Array.isArray(carousel?.sources)||!Array.isArray(carousel?.hashtags)
   ||[carousel.caption,carousel.cta,carousel.altText].some(v=>text(v)===null))throw invalidArgument('Entradas do pacote inválidas.');
 const byId=new Map(files.map(f=>[f.id,f.bytes]));
 if(byId.size!==files.length)throw invalidArgument('Arquivos da entrega duplicados.');
 const slides=manifest.files.filter(f=>f.role==='slide').sort((a,b)=>a.slideIndex-b.slideIndex),panoramas=manifest.files.filter(f=>f.role==='panorama');
 if(!slides.length||panoramas.length!==1||slides.some((f,i)=>f.slideIndex!==i+1)||slides.length!==carousel.slides?.length)throw invalidArgument('Manifesto final incompleto.');
 const entries=[];
 const add=(name,bytes,hash)=>{
  if(!Buffer.isBuffer(bytes))throw invalidArgument('Bytes da entrega ausentes.');
  const actual=sha256(bytes);if(hash!==undefined&&hash!==actual)invalid();
  entries.push(Object.freeze({name,bytes:Buffer.from(bytes),sha256:actual}));
 };
 for(const f of slides)add(`slides/${String(f.slideIndex).padStart(2,'0')}.png`,byId.get(f.artifactRef?.id),f.artifactRef?.sha256);
 const panorama=panoramas[0];add('panorama.png',byId.get(panorama.artifactRef?.id),panorama.artifactRef?.sha256);
 if(carousel.hashtags.some(v=>text(v)===null)||carousel.sources.some(s=>text(s?.title)===null||text(s?.url)===null))throw invalidArgument('Texto da entrega inválido.');
 const caption=[carousel.caption,carousel.cta,carousel.hashtags.join(' '),`Texto alternativo:\n${carousel.altText}`].join('\n\n')+'\n';
 const references=carousel.sources.map(s=>`- ${s.title}: ${s.url}`).join('\n')+'\n';
 add('legenda.txt',Buffer.from(caption,'utf8'));
 add('referencias.txt',Buffer.from(references,'utf8'));
 return Object.freeze(entries);
}

function inspectZip(zip,entries){
 if(!Buffer.isBuffer(zip)||zip.length<22||zip.length>0xffffffff||!Array.isArray(entries))invalid();
 const u16=(at)=>{if(at<0||at+2>zip.length)invalid();return zip.readUInt16LE(at);};
 const u32=(at)=>{if(at<0||at+4>zip.length)invalid();return zip.readUInt32LE(at);};
 const end=zip.length-22;
 if(u32(end)!==0x06054b50||u16(end+20)!==0||u16(end+4)!==0||u16(end+6)!==0||u16(end+8)!==entries.length||u16(end+10)!==entries.length)invalid();
 const centralSize=u32(end+12),centralOffset=u32(end+16);if(centralOffset+centralSize!==end)invalid();
 let cursor=centralOffset,localCursor=0;const members=[];
 for(const expected of entries){
  if(u32(cursor)!==0x02014b50)invalid();
  const flags=u16(cursor+8),method=u16(cursor+10),crc=u32(cursor+16),compressed=u32(cursor+20),size=u32(cursor+24),nameLength=u16(cursor+28),extraLength=u16(cursor+30),commentLength=u16(cursor+32),disk=u16(cursor+34),local=u32(cursor+42);
  if(u16(cursor+4)!==ZIP_MADE_BY||u16(cursor+6)!==ZIP_NEEDED||flags!==0||method!==0||u16(cursor+12)!==0||u16(cursor+14)!==ZIP_DOS_DATE||compressed!==size||disk!==0||extraLength!==0||commentLength!==0||u16(cursor+36)!==0||u32(cursor+38)!==ZIP_EXTERNAL_ATTRIBUTES||size!==expected.bytes.length)invalid();
  const centralName=zip.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
  if(centralName!==expected.name||cursor+46+nameLength+extraLength+commentLength>centralOffset+centralSize)invalid();
  if(local!==localCursor||u32(local)!==0x04034b50||u16(local+4)!==ZIP_NEEDED||u16(local+6)!==flags||u16(local+8)!==method||u16(local+10)!==0||u16(local+12)!==ZIP_DOS_DATE||u32(local+14)!==crc||u32(local+18)!==compressed||u32(local+22)!==size)invalid();
  const localNameLength=u16(local+26),localExtraLength=u16(local+28),localName=zip.subarray(local+30,local+30+localNameLength).toString('utf8');
  const start=local+30+localNameLength+localExtraLength,bytes=zip.subarray(start,start+size);
  if(localExtraLength!==0||localName!==centralName||start+size>centralOffset||bytes.length!==size||crc32(bytes)!==crc||sha256(bytes)!==expected.sha256)invalid();
  members.push(Object.freeze({name:centralName,size,sha256:sha256(bytes),crc32:crc}));
  localCursor=start+size;
  cursor+=46+nameLength+extraLength+commentLength;
 }
 if(cursor!==centralOffset+centralSize||localCursor!==centralOffset)invalid();
 return Object.freeze({sha256:sha256(zip),size:zip.length,members:Object.freeze(members)});
}

/** Reopen the ZIP after close/promotion; compare the central directory, local
 * headers, exact allowlist, byte hashes and CRC32 independently of archiver. */
export async function verifyPackageZip({guard,relativePath,entries}){
 validateEntries(entries);
 try{
  const zip=await guard.withPaths([relativePath],async file=>{
   const handle=await open(file,'r');
   try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1)invalid();return await handle.readFile();}
   finally{await handle.close();}
  });
  return inspectZip(zip,entries);
 }catch(error){if(error instanceof PublicError)throw error;invalid();}
}

/** Recheck the already opened promoted file inside the synchronous commit
 * boundary. The path check detects a deterministic replacement while the
 * handle keeps the bytes and stat from the same file. */
export function verifyPackageZipHandleSync({handle,file,entries}){
 validateEntries(entries);
 try{
  const held=fstatSync(handle.fd),linked=lstatSync(file);
  if(!held.isFile()||!linked.isFile()||held.nlink!==1||linked.nlink!==1||held.dev!==linked.dev||held.ino!==linked.ino||held.size!==linked.size||held.size>0xffffffff)invalid();
  const zip=Buffer.allocUnsafe(held.size);let offset=0;
  while(offset<zip.length){const count=readSync(handle.fd,zip,offset,zip.length-offset,offset);if(!count)invalid();offset+=count;}
  const after=fstatSync(handle.fd);if(after.size!==held.size||after.mtimeMs!==held.mtimeMs||after.ctimeMs!==held.ctimeMs)invalid();
  return inspectZip(zip,entries);
 }catch(error){if(error instanceof PublicError)throw error;invalid();}
}

export async function writeVerifiedPackage({guard,relativePath,entries}){
 validateEntries(entries);
 await guard.withPaths([relativePath],file=>mkdir(path.dirname(file),{recursive:true}));
 await guard.withPaths([relativePath],async file=>{
  const output=createWriteStream(file,{flags:'wx'}),archive=archiver('zip',{store:true});
  archive.on('error',error=>output.destroy(error));archive.pipe(output);
  try{
   const done=finished(output);
   for(const entry of entries)archive.append(entry.bytes,{name:entry.name,store:true,date:ZIP_DATE,mode:ZIP_MODE});
   await archive.finalize();await done;
  }catch(error){output.destroy();throw error;}
 });
 return verifyPackageZip({guard,relativePath,entries});
}
