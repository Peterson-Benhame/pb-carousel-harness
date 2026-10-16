import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { canonicalHash } from './canonical-json.mjs';
import { PublicError,invalidArgument } from './errors.mjs';
export const MAX_LOGO_BYTES=10*1024*1024;
export const MAX_LOGO_DIMENSION=4096;
export const LOGO_KIND='logo/png-static-v1';
const invalid=message=>{throw new PublicError('ASSET_INVALID',message);};
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
// Native PNG readers intentionally ignore some malformed ancillary metadata.
// Validate known chunk framing ourselves and cap aggregate expanded metadata.
function chunkInspector(){
 const seen=new Set();let color,depth,palette=0,idat=false,idatEnded=false,expanded=0;
 const bad=()=>invalid('Metadados ou ordem de chunks PNG inválidos.');
 const inflate=data=>{try{const result=inflateSync(data,{maxOutputLength:MAX_LOGO_BYTES-expanded,info:true});if(result.engine.bytesWritten!==data.length)bad();expanded+=result.buffer.length;return result.buffer;}catch{bad();}};
 const keyword=data=>{const end=data.indexOf(0);if(end<1||end>79)bad();const key=data.subarray(0,end);if(key[0]===32||key.at(-1)===32||key.some((b,i)=>!(b>=32&&b<=126||b>=161)||b===32&&key[i-1]===32))bad();return end+1;};
 const utf8=data=>{try{new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{bad();}};
 return (type,data)=>{
  if(type==='IHDR'){depth=data[8];color=data[9];}
  if(type==='IDAT'){if(idatEnded||color===3&&!palette)bad();idat=true;}else if(idat)idatEnded=true;
  const single=['IHDR','PLTE','IEND','cHRM','gAMA','iCCP','sBIT','sRGB','bKGD','hIST','tRNS','pHYs','tIME','eXIf','cICP','mDCV','cLLI'];
  if(single.includes(type)&&seen.has(type))bad();seen.add(type);
  if(['PLTE','cHRM','gAMA','iCCP','sBIT','sRGB','bKGD','hIST','tRNS','pHYs','sPLT'].includes(type)&&idat)bad();
  if(['cHRM','gAMA','iCCP','sBIT','sRGB'].includes(type)&&palette)bad();
  const sizes={cHRM:32,gAMA:4,sRGB:1,pHYs:9,tIME:7,cICP:4,mDCV:24,cLLI:8};
  if(type in sizes&&data.length!==sizes[type])bad();
  if(type==='PLTE'){if([0,4].includes(color)||!data.length||data.length%3||data.length>768||color===3&&data.length/3>2**depth)bad();palette=data.length/3;}
  if(type==='gAMA'&&data.readUInt32BE()===0)bad();
  if(type==='sRGB'&&(data[0]>3||seen.has('iCCP'))||type==='iCCP'&&seen.has('sRGB'))bad();
  if(type==='pHYs'&&data[8]>1)bad();
  if(type==='tIME'&&(data[2]<1||data[2]>12||data[3]<1||data[3]>31||data[4]>23||data[5]>59||data[6]>60))bad();
  if(type==='tRNS'&&!(color===0&&data.length===2||color===2&&data.length===6||color===3&&palette&&data.length>0&&data.length<=palette))bad();
  if(type==='hIST'&&(!palette||data.length!==palette*2))bad();
  if(type==='bKGD'&&(data.length!==({0:2,2:6,3:1,4:2,6:6})[color]||color===3&&(!palette||data[0]>=palette)))bad();
  if(type==='sBIT'&&(data.length!==({0:1,2:3,3:3,4:2,6:4})[color]||data.some(b=>b<1||b>(color===3?8:depth))))bad();
  if(type==='tEXt'){const start=keyword(data);if(data.subarray(start).includes(0))bad();}
  if(type==='zTXt'||type==='iCCP'){
   const start=keyword(data);if(data[start]!==0)bad();const value=inflate(data.subarray(start+1));
   if(type==='zTXt'&&value.includes(0))bad();
   if(type==='iCCP'){
    if(value.length<132||value.readUInt32BE()!==value.length||value.toString('ascii',36,40)!=='acsp')bad();
    const count=value.readUInt32BE(128);if(132+12*count>value.length)bad();
    for(let i=0;i<count;i++){const offset=value.readUInt32BE(136+12*i),length=value.readUInt32BE(140+12*i);if(offset<128||offset+length>value.length)bad();}
   }
  }
  if(type==='iTXt'){
   let start=keyword(data);const compressed=data[start];if(![0,1].includes(compressed)||data[start+1]!==0)bad();start+=2;
   const langEnd=data.indexOf(0,start);if(langEnd<0||data.subarray(start,langEnd).some(b=>b>127))bad();
   start=langEnd+1;const nameEnd=data.indexOf(0,start);if(nameEnd<0)bad();utf8(data.subarray(start,nameEnd));
   const value=compressed?inflate(data.subarray(nameEnd+1)):data.subarray(nameEnd+1);if(value.includes(0))bad();utf8(value);
  }
  if(type==='sPLT'){const start=keyword(data),bits=data[start],length=data.length-start-1;if(![8,16].includes(bits)||length<=0||length%(bits===8?6:10))bad();}
  if(type==='eXIf'){
   const little=data.toString('ascii',0,2)==='II';if(data.length<8||!['II','MM'].includes(data.toString('ascii',0,2)))bad();
   const read16=o=>little?data.readUInt16LE(o):data.readUInt16BE(o),read32=o=>little?data.readUInt32LE(o):data.readUInt32BE(o);
   if(read16(2)!==42)bad();const offset=read32(4);if(offset<8||offset+2>data.length||offset+2+12*read16(offset)+4>data.length)bad();
  }
 };
}
/** Inspect framing/CRCs before a strict real decode. Never encode or mutate input. */
export async function validateLogoPng(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>MAX_LOGO_BYTES)invalid('PNG excede o limite de 10 MiB.');
 if(!bytes.subarray(0,8).equals(signature))invalid('O logotipo precisa ser um PNG real.');
 let offset=8,header=false,end=false,data=false,width,height;const inspect=chunkInspector();
 while(offset<bytes.length){
  if(offset+12>bytes.length)invalid('PNG truncado ou corrompido.');
  const size=bytes.readUInt32BE(offset),next=offset+12+size;
  if(next>bytes.length)invalid('PNG truncado ou corrompido.');
  const typeBytes=bytes.subarray(offset+4,offset+8);
  if(typeBytes.some(b=>!((b>=65&&b<=90)||(b>=97&&b<=122)))||typeBytes[2]>90)invalid('Tipo de chunk PNG inválido.');
  const type=typeBytes.toString('ascii');
  if(crc32(bytes.subarray(offset+4,next-4))!==bytes.readUInt32BE(next-4))invalid('PNG corrompido: estrutura ou checksum inválido.');
  if(['acTL','fcTL','fdAT'].includes(type))invalid('PNG animado (APNG) não é permitido.');
  if(!header&&type!=='IHDR')invalid('PNG sem cabeçalho inicial.');
  if(type==='IHDR'){
   if(header||size!==13)invalid('Cabeçalho PNG inválido.');header=true;width=bytes.readUInt32BE(offset+8);height=bytes.readUInt32BE(offset+12);
   if(!width||!height||width>MAX_LOGO_DIMENSION||height>MAX_LOGO_DIMENSION)invalid('PNG deve ter entre 1 e 4096 px por dimensão.');
  }
  inspect(type,bytes.subarray(offset+8,next-4));
  if(type==='IDAT')data=true;
  if(type==='IEND'){if(size!==0||!data||next!==bytes.length)invalid('Fim do PNG inválido.');end=true;}
  offset=next;
 }
 if(!end)invalid('PNG incompleto: falta IEND.');
 let sharp;
 try {sharp=(await import('sharp')).default;}catch{throw new PublicError('RESOURCE_MISSING','Decodificador PNG indisponível.');}
 let metadata,stats;
 try {
  const image=sharp(bytes,{failOn:'warning',limitInputPixels:MAX_LOGO_DIMENSION**2});
  metadata=await image.metadata();stats=await image.stats(); // full native-depth decode, including 16-bit alpha
 }catch {invalid('PNG corrompido ou não decodificável.');}
 if(metadata.format!=='png'||metadata.width!==width||metadata.height!==height)invalid('Dimensões PNG inconsistentes.');
 if(metadata.hasAlpha&&stats.channels.at(-1).max===0)invalid('PNG totalmente transparente não é permitido.');
 const transparent=!stats.isOpaque;
 return {format:'png',width,height,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),transparent};
}
export function validateLogoConfig(logo){
 if(typeof logo.enabled!=='boolean'||logo.protection!==12||logo.minimumHeight!==24||!logo.variants||typeof logo.variants!=='object'||Array.isArray(logo.variants))throw invalidArgument('Configuração de logotipo inválida.');
 if(Object.entries(logo.variants).some(([surface,id])=>!['light','dark'].includes(surface)||typeof id!=='string'||!id.trim())||(logo.enabled&&Object.keys(logo.variants).length===0))throw invalidArgument('Logotipo habilitado exige variante válida.');
}
// Internal capability, analogous to the confirmation receipt. Only the service
// issues it after resolving and decoding every asset. Not a JSON/public API.
const validations=new WeakMap();
export function issueLogoValidation(db,proposal){const capability=Object.freeze({});validations.set(capability,{db,hash:canonicalHash(proposal)});return capability;}
export function requireLogoAssociations(db,proposal,current,capability){
 const proof=capability&&validations.get(capability),validated=proof?.db===db&&proof.hash===canonicalHash(proposal);
 for(const [surface,id] of Object.entries(proposal.config.logo.variants)){
  const asset=db.prepare('SELECT kind,width,height FROM assets WHERE brand_id=? AND id=?').get(proposal.brandId,id);
  if(!asset||asset.kind!==LOGO_KIND||asset.width>MAX_LOGO_DIMENSION||asset.height>MAX_LOGO_DIMENSION)invalid('Variante não é um PNG validado da própria marca.');
  if(current?.config.logo.variants[surface]!==id&&!validated)invalid('Nova associação exige validação do PNG e confirmação da superfície.');
 }
}
export function selectLogoVariant(logo,surface){
 if(!['light','dark'].includes(surface))throw invalidArgument('Superfície deve ser light ou dark.');
 if(!logo.enabled)return null;
 const id=logo.variants[surface];if(!id)throw new PublicError('LOGO_VARIANT_MISSING','Não há logotipo autorizado para esta superfície.');return id;
}
