import { requireLogoAssociations } from '../domain/logo-policy.mjs';
import { runOperation } from './operation-runner.mjs';
import { validateBrandConfig, legacyBrandConfig, exactKeys } from '../domain/brand-schema.mjs';
import { canonicalHash,canonicalJson } from '../domain/canonical-json.mjs';
import { validateIdentifier } from '../domain/identifiers.mjs';
import { PublicError,invalidArgument } from '../domain/errors.mjs';
import { verifySchema } from '../infrastructure/sqlite/migrations.mjs';
import { requireBrandConfirmation,consumeBrandConfirmation } from '../domain/brand-confirmation.mjs';
const fail=(code,message)=>{throw new PublicError(code,message);};
const actions=['brand.create','brand.update','brand.importLegacy'];

export function createBrandMemory(db) {
 function get(brandId,revision) {
  validateIdentifier(brandId);if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))throw invalidArgument('Revisão inválida.');verifySchema(db);
  const row=db.prepare(`SELECT r.*,b.status FROM brands b JOIN brand_revisions r ON b.id=r.brand_id WHERE b.id=? AND r.revision=${revision===undefined?'b.current_revision':'?'}`).get(...(revision===undefined?[brandId]:[brandId,revision]));
  if(!row)return null;
  const operation=db.prepare("SELECT operation,request_id FROM operations WHERE brand_id=? AND json_extract(result_json,'$.revision')=? ORDER BY rowid LIMIT 1").get(brandId,row.revision);
  return {brandId,status:row.status,revision:row.revision,config:JSON.parse(row.config_json),hash:row.hash,provenance:row.provenance,createdAt:row.created_at,operation:operation?.operation??null,requestId:operation?.request_id??null};
 }
 function propose(action,request,logoValidation) {
  if(!actions.includes(action))throw invalidArgument('Operação de marca inválida.');
  const r=JSON.parse(canonicalJson(request));
  exactKeys(r,action==='brand.importLegacy'?['requestId','brandId','name','legacyBrand','legacyThemes']:action==='brand.update'?['requestId','brandId','config','expectedRevision']:['requestId','brandId','config']);
  validateIdentifier(r.brandId);if(typeof r.requestId!=='string'||!r.requestId.trim())throw invalidArgument('requestId obrigatório.');
  if(action==='brand.update'&&(!Number.isSafeInteger(r.expectedRevision)||r.expectedRevision<1))throw invalidArgument('Revisão anterior obrigatória.');
  const proposal={action,requestId:r.requestId,brandId:r.brandId,expectedRevision:action==='brand.update'?r.expectedRevision:null,config:action==='brand.importLegacy'?legacyBrandConfig(r):validateBrandConfig(r.config)};
  requireLogoAssociations(db,proposal,get(r.brandId),logoValidation);
  return proposal;
 }
 function commit(proposal,receipt,logoValidation) {
  const p=JSON.parse(canonicalJson(proposal));
  exactKeys(p,['action','requestId','brandId','expectedRevision','config']);
  if(!actions.includes(p.action))throw invalidArgument('Operação de marca inválida.');validateIdentifier(p.brandId);p.config=validateBrandConfig(p.config);
  if(p.action==='brand.update'?(!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<1):p.expectedRevision!==null)throw invalidArgument('Revisão anterior inválida.');
  let usedReceipt=false;
  const result=runOperation(db,{requestId:p.requestId,operation:p.action,brandId:p.brandId,payload:p},()=>{
   const current=get(p.brandId);
   if(p.action==='brand.importLegacy'&&current){
    const original=get(p.brandId,1);
    if(original.provenance!=='legacy-import'||original.hash!==canonicalHash(p.config))fail('LEGACY_IMPORT_CONFLICT','Importação já existente ou marca cadastrada por outra origem.');
    return {status:'committed',result:original};
   }
   if(p.action==='brand.update'){
    if(!current)fail('BRAND_NOT_FOUND','Marca não encontrada.');
    if(current.status!=='active')fail('BRAND_ARCHIVED','Marca arquivada.');
    if(current.revision!==p.expectedRevision)fail('BRAND_REVISION_CONFLICT','A revisão da marca mudou; revise a nova proposta.');
   } else if(current)fail('BRAND_EXISTS','Marca já cadastrada.');
   requireLogoAssociations(db,p,current,logoValidation);
   const evidence=requireBrandConfirmation(receipt,p);usedReceipt=true;
   const revision=(current?.revision??0)+1,hash=canonicalHash(p.config),provenance=p.action==='brand.importLegacy'?'legacy-import':'user-confirmed';
   if(!current)db.prepare('INSERT INTO brands(id) VALUES (?)').run(p.brandId);
   db.prepare('INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES (?,?,?,?,?)').run(p.brandId,revision,canonicalJson(p.config),hash,provenance);
   const updated=db.prepare('UPDATE brands SET current_revision=? WHERE id=? AND current_revision IS ?').run(revision,p.brandId,current?.revision??null);
   if(updated.changes!==1)fail('BRAND_REVISION_CONFLICT','A revisão da marca mudou.');
   db.prepare("INSERT INTO confirmation_requests(id,brand_id,kind,object_fingerprint,status,resolved_at) VALUES (?,?,?,?,'confirmed',?)").run(evidence.id,p.brandId,p.action,evidence.fingerprint,evidence.confirmedAt);
   return {status:'committed',result:{...get(p.brandId,revision),operation:p.action,requestId:p.requestId}};
  });
  if(usedReceipt)consumeBrandConfirmation(receipt);
  return result;
 }
 function list({brandId}={}) {
  verifySchema(db);if(brandId!==undefined)validateIdentifier(brandId);
  return db.prepare(`SELECT b.id AS brandId,b.status,b.current_revision AS revision,json_extract(r.config_json,'$.name') AS name FROM brands b JOIN brand_revisions r ON r.brand_id=b.id AND r.revision=b.current_revision ${brandId===undefined?'':'WHERE b.id=?'} ORDER BY b.id`).all(...(brandId===undefined?[]:[brandId]));
 }
 function forExecution(brandId,adjustments={}){
  const copy=JSON.parse(canonicalJson(adjustments));exactKeys(copy,[],['audience','voice','preferences']);
  const brand=get(brandId);if(!brand)fail('BRAND_NOT_FOUND','Marca não encontrada.');
  const config=validateBrandConfig({...brand.config,...copy});
  return {base:brand,adjustments:copy,config,hash:canonicalHash(config)};
 }
 return Object.freeze({propose,commit,get,list,forExecution});
}
