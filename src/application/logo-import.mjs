import path from 'node:path';
import { open } from 'node:fs/promises';
import { createAssetStore } from './asset-store.mjs';
import { createBrandMemory } from './brand-memory.mjs';
import { exactKeys,validateBrandConfig } from '../domain/brand-schema.mjs';
import { canonicalJson } from '../domain/canonical-json.mjs';
import { validateIdentifier } from '../domain/identifiers.mjs';
import { PublicError,invalidArgument } from '../domain/errors.mjs';
import { validateLogoPng,MAX_LOGO_BYTES,LOGO_KIND,issueLogoValidation,selectLogoVariant } from '../domain/logo-policy.mjs';
async function readBounded(filename){
 const file=await open(filename,'r');
 try {
  const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_LOGO_BYTES)throw new PublicError('ASSET_INVALID','PNG deve ser arquivo regular de até 10 MiB.');
  const buffer=Buffer.alloc(Math.min(stat.size+1,MAX_LOGO_BYTES+1));let length=0;
  while(length<buffer.length){const {bytesRead}=await file.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  if(length!==stat.size)throw new PublicError('ASSET_INVALID','Arquivo alterado durante leitura.');
  return buffer.subarray(0,length);
 }finally{await file.close();}
}
/** T09 internal service. Association is a confirmed T08 revision, not a creative
 * asset approval. Managed bytes are reverified for each use; no renderer here. */
export async function createLogoImport({root,db}){
 const store=await createAssetStore({root,db}),memory=createBrandMemory(db);
 async function checkedAsset(brandId,id){
  const resolved=await store.resolve(brandId,id),descriptor=await validateLogoPng(await readBounded(resolved.path));
  if(descriptor.sha256!==resolved.sha256)throw new PublicError('ASSET_HASH_MISMATCH','PNG gerenciado alterado durante leitura.');
  const row=db.prepare('SELECT kind,width,height FROM assets WHERE brand_id=? AND id=?').get(brandId,id);
  if(row.kind!==LOGO_KIND||row.width!==descriptor.width||row.height!==descriptor.height)throw new PublicError('ASSET_INVALID','Descritor do PNG incompatível.');
  return {...resolved,...descriptor};
 }
 async function importFile(request){
  exactKeys(request,['requestId','brandId','sourcePath']);validateIdentifier(request.brandId);
  const brand=memory.get(request.brandId);if(!brand)throw new PublicError('BRAND_NOT_FOUND','Marca não encontrada.');if(brand.status!=='active')throw new PublicError('BRAND_ARCHIVED','Marca arquivada.');
  if(typeof request.sourcePath!=='string'||!request.sourcePath)throw invalidArgument('Origem PNG obrigatória.');
  const descriptor=await validateLogoPng(await readBounded(request.sourcePath));
  return store.importFile({...request,...descriptor,kind:LOGO_KIND,originalName:path.basename(request.sourcePath)});
 }
 async function validateProposal(p){validateIdentifier(p.brandId);validateBrandConfig(p.config);for(const id of new Set(Object.values(p.config.logo.variants)))await checkedAsset(p.brandId,id);return issueLogoValidation(db,p);}
 async function proposeAssociation(request){
  exactKeys(request,['requestId','brandId','expectedRevision','assetId','surfaces','enabled']);
  if(!Array.isArray(request.surfaces)||!request.surfaces.length||new Set(request.surfaces).size!==request.surfaces.length||request.surfaces.some(s=>!['light','dark'].includes(s)))throw invalidArgument('Selecione superfície clara, escura ou ambas.');
  const brand=memory.get(request.brandId);if(!brand)throw new PublicError('BRAND_NOT_FOUND','Marca não encontrada.');
  const config=structuredClone(brand.config);config.logo.enabled=request.enabled;
  // The selected surfaces replace this file's previous authorization. Other files
  // keep their own associations unless explicitly replaced on a selected surface.
  for(const [surface,id] of Object.entries(config.logo.variants))if(id===request.assetId)delete config.logo.variants[surface];
  for(const surface of request.surfaces)config.logo.variants[surface]=request.assetId;
  const p={action:'brand.update',requestId:request.requestId,brandId:request.brandId,expectedRevision:request.expectedRevision,config};
  const capability=await validateProposal(p);
  return memory.propose('brand.update',{requestId:p.requestId,brandId:p.brandId,expectedRevision:p.expectedRevision,config:p.config},capability);
 }
 async function commit(proposal,receipt){const p=JSON.parse(canonicalJson(proposal)),capability=await validateProposal(p);return memory.commit(p,receipt,capability);}
 async function resolve(brandId,surface){const brand=memory.get(brandId);if(!brand)throw new PublicError('BRAND_NOT_FOUND','Marca não encontrada.');const id=selectLogoVariant(brand.config.logo,surface);return id===null?null:checkedAsset(brandId,id);}
 return Object.freeze({importFile,proposeAssociation,commit,resolve});
}
