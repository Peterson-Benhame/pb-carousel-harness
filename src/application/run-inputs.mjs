import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {validateCarousel} from '../../scripts/validate-carousel.mjs';
import {runOperation} from './operation-runner.mjs';
import {createConfinedRoot,normalizeReference} from '../infrastructure/fs/confined-path.mjs';
import {stageFile,stageBytes,promoteFile} from '../infrastructure/fs/atomic-files.mjs';
import {hashFile} from '../infrastructure/fs/hash-file.mjs';
import {loadResourcesManifest,DEFAULT_PACKAGE_ROOT} from '../infrastructure/resources.mjs';
import {verifySchema,assertQualityContractActive} from '../infrastructure/sqlite/migrations.mjs';
import {getRunContract} from '../domain/run-snapshot.mjs';
import {validateCompositionPlan} from '../domain/composition-plan.mjs';
import {canonicalHash,canonicalJson} from '../domain/canonical-json.mjs';
import {buildInputFingerprints} from '../domain/artifact-fingerprints.mjs';
import {transitionRun} from '../domain/run-state-machine.mjs';
import {validateIdentifier,validateSlug,validatePathSegment} from '../domain/identifiers.mjs';
import {exactKeys} from '../domain/brand-schema.mjs';
import {PublicError,invalidArgument} from '../domain/errors.mjs';

const fail=(code,message)=>{throw new PublicError(code,message);};
const isHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const scope=(brandId,runId)=>{validateIdentifier(brandId);validateIdentifier(runId);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function descriptor(value,asset=false){
 exactKeys(value,['sha256',...(asset?['id']:[])],['sourcePath',...(asset?['metadata']:[])]);
 if(!isHash(value.sha256))throw invalidArgument('Identidade de arquivo inválida.');
 if(asset)validatePathSegment(value.id);
 return {sha256:value.sha256,...(asset?{id:value.id}:{}),...(asset&&value.metadata!==undefined?{metadata:value.metadata}:{})};
}
function text(bytes,code){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail(code,'Documento precisa conter UTF-8 válido.');}}

/** Internal T12 API. A save is a complete material set, not a patch; omitted files
 * become absent in the new version. Source paths are one-time transport only.
 * No approval, invalidation graph, renderer or resumable execution is implemented here.
 */
export async function createRunInputs({root,db,hooks={},sleep,packageRoot=DEFAULT_PACKAGE_ROOT,qualifications=[]}) {
 const guard=await createConfinedRoot(root);
 function findRun(brandId,runId){return db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(brandId,runId);}
 function writeContract(brandId,runId){
  verifySchema(db);const row=findRun(brandId,runId);if(!row)fail('RUN_NOT_FOUND','Execução não encontrada.');
  const contract=getRunContract(JSON.parse(row.snapshot_json));
  if(contract.contractVersion===1&&db.pragma('user_version',{simple:true})===2)fail('RUN_DERIVATION_REQUIRED','Execução histórica exige derivação para o contrato de qualidade.');
  if(contract.contractVersion===2)assertQualityContractActive(db);
  return contract;
 }
 function editable(r){
  writeContract(r.brandId,r.runId);
  const row=findRun(r.brandId,r.runId);
  if(!row)fail('RUN_NOT_FOUND','Execução não encontrada.');
  if(db.prepare('SELECT status FROM brands WHERE id=?').get(r.brandId)?.status!=='active')fail('BRAND_ARCHIVED','Marca arquivada.');
  if(!['draft','ready'].includes(row.status)||row.lease_owner!==null||db.prepare("SELECT 1 FROM step_attempts WHERE brand_id=? AND run_id=? AND status='running'").get(r.brandId,r.runId)||db.prepare('SELECT 1 FROM approvals WHERE brand_id=? AND run_id=?').get(r.brandId,r.runId)||db.prepare("SELECT 1 FROM steps WHERE brand_id=? AND run_id=? AND step_key!='inputs' AND status!='pending'").get(r.brandId,r.runId))fail('RUN_NOT_EDITABLE','Execução exige reconciliação ou controle de alterações antes de editar entradas.');
  if(row.version!==r.expectedVersion)fail('RUN_VERSION_CONFLICT','Execução alterada desde a leitura.');
  if(canonicalHash(JSON.parse(row.snapshot_json))!==row.snapshot_hash)fail('SNAPSHOT_HASH_MISMATCH','Snapshot não corresponde à identidade registrada.');
  return row;
 }
 async function verify(relative,sha256,size){
  let actual;try{actual=await guard.withPaths([relative],hashFile);}catch(error){if(error.code==='ENOENT')fail('RESOURCE_MISSING','Artefato gerenciado indisponível.');throw error;}
  if(actual.sha256!==sha256||(size!==undefined&&actual.size!==size))fail('ARTIFACT_HASH_MISMATCH','Bytes do artefato divergem da identidade registrada.');
  return actual;
 }
 async function resolveArtifact(brandId,runId,id){
  scope(brandId,runId);validateIdentifier(id);verifySchema(db);
  const row=db.prepare('SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND id=?').get(brandId,runId,id);
  if(!row)fail('ARTIFACT_NOT_FOUND','Artefato não encontrado nesta execução.');
  const {size}=JSON.parse(row.metadata_json);await verify(row.relative_path,row.hash,size);
  return {id:row.id,brandId,runId,kind:row.kind,version:row.version,sha256:row.hash,size,path:await guard.resolve(row.relative_path)};
 }
 async function readVersion(row){
  const file=await resolveArtifact(row.brand_id,row.run_id,row.id);
  const saved=JSON.parse(await guard.withPaths([row.relative_path],filename=>readFile(filename,'utf8')));
  if(saved.id!==file.id||saved.brandId!==row.brand_id||saved.runId!==row.run_id||saved.version!==row.version)fail('ARTIFACT_HASH_MISMATCH','Manifesto não corresponde ao escopo registrado.');
  for(const ref of [saved.artifacts.carousel,saved.artifacts.concept,saved.artifacts.plan,...saved.artifacts.assets].filter(Boolean)){
   const actual=await resolveArtifact(row.brand_id,row.run_id,ref.id);
   if(actual.sha256!==ref.sha256||actual.version!==ref.version||actual.kind!==ref.kind)fail('ARTIFACT_HASH_MISMATCH','Referência do manifesto não corresponde ao artefato.');
  }
  const run=findRun(row.brand_id,row.run_id),contract=getRunContract(JSON.parse(run.snapshot_json));
  if(saved.schemaVersion!==contract.contractVersion||saved.snapshotHash!==run.snapshot_hash)fail('RUN_CONTRACT_UNSUPPORTED','Versão de entradas incompatível com o snapshot.');
  if(contract.contractVersion===2){
   if(saved.contractVersion!==2||saved.fingerprintVersion!==2)fail('RUN_CONTRACT_UNSUPPORTED','Versão de entradas incompatível com o snapshot.');
   if(saved.artifacts.plan){
    const planFile=await resolveArtifact(row.brand_id,row.run_id,saved.artifacts.plan.id),plan=JSON.parse(await readFile(planFile.path,'utf8'));
    if(plan.id!==saved.artifacts.plan.id||plan.version!==saved.artifacts.plan.version||plan.brandId!==row.brand_id||plan.runId!==row.run_id||plan.snapshotHash!==saved.snapshotHash||plan.copyFingerprint!==saved.fingerprints['copy-approval']||canonicalHash(plan.carouselRef)!==canonicalHash(saved.artifacts.carousel)||canonicalHash(plan.conceptRef)!==canonicalHash(saved.artifacts.concept))fail('COMPOSITION_PLAN_STALE','Plano não corresponde às entradas persistidas.');
   }else if(saved.inputsComplete)fail('COMPOSITION_PLAN_STALE','Entradas completas exigem plano persistido.');
  }
  return saved;
 }
 async function get(brandId,runId,version){
  scope(brandId,runId);verifySchema(db);if(version!==undefined&&(!Number.isSafeInteger(version)||version<1))throw invalidArgument('Versão de entradas inválida.');
  const row=version===undefined?db.prepare("SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND kind='inputs' ORDER BY version DESC LIMIT 1").get(brandId,runId):db.prepare("SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND kind='inputs' AND version=?").get(brandId,runId,version);
  return row?readVersion(row):null;
 }
 async function list(brandId,runId){scope(brandId,runId);verifySchema(db);const rows=db.prepare("SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND kind='inputs' ORDER BY version").all(brandId,runId);const results=[];for(const row of rows)results.push(await readVersion(row));return results;}
 async function executable(){
  // Hash installed code/contracts, not its cache path or a user-supplied version label.
  const manifest=await loadResourcesManifest({packageRoot}),packageGuard=await createConfinedRoot(packageRoot),files={};
  try{
   const metadata=JSON.parse(await packageGuard.withPaths(['package.json'],filename=>readFile(filename,'utf8')));
   for(const file of manifest.requiredFiles.filter(file=>/\.(?:m?js|json|sql)$/.test(file)))files[file]=(await packageGuard.withPaths([file],hashFile)).sha256;
   return {package:{name:metadata.name,version:metadata.version},node:process.version,files};
  }catch{fail('PACKAGE_INCOMPLETE','Executável ou contrato de entradas indisponível.');}
 }
 async function save(input){
  const r=JSON.parse(canonicalJson(input));exactKeys(r,['requestId','brandId','runId','expectedVersion'],['carousel','concept','assets']);scope(r.brandId,r.runId);
  if(!Number.isSafeInteger(r.expectedVersion)||r.expectedVersion<1||(Object.hasOwn(r,'assets')&&!Array.isArray(r.assets)))throw invalidArgument('Versão ou lista de assets inválida.');
  const contract=writeContract(r.brandId,r.runId);
  if(contract.contractVersion===1&&(r.assets??[]).some(a=>a?.metadata!==undefined))throw invalidArgument('Metadata de composição exige contrato 2.');
  const descriptors={carousel:Object.hasOwn(r,'carousel')?descriptor(r.carousel):null,concept:Object.hasOwn(r,'concept')?descriptor(r.concept):null,assets:(r.assets??[]).map(a=>descriptor(a,true))};
  if(new Set(descriptors.assets.map(a=>a.id)).size!==descriptors.assets.length)throw invalidArgument('Identificadores de assets duplicados.');
  const request={requestId:r.requestId,brandId:r.brandId,runId:r.runId,operation:'run.inputs.save',payload:{expectedVersion:r.expectedVersion,...descriptors}};
  const prepare=Symbol('prepare');let replay;
  try{replay=runOperation(db,request,()=>{editable(r);throw prepare;});}catch(error){if(error!==prepare)throw error;}
  if(replay){const saved=await get(r.brandId,r.runId,replay.version);if(!saved||canonicalHash(saved)!==canonicalHash(replay))fail('ARTIFACT_HASH_MISMATCH','Resultado da operação não corresponde ao manifesto.');return saved;}
  if(contract.contractVersion===2&&db.prepare("SELECT 1 FROM artifacts WHERE brand_id=? AND run_id=? AND kind='composition-plan' LIMIT 1").get(r.brandId,r.runId))fail('RUN_NOT_EDITABLE','Alteração de material após o plano exige controle de invalidação.');
  const run=editable(r),snapshot=JSON.parse(run.snapshot_json),version=db.prepare("SELECT COALESCE(MAX(version),0)+1 n FROM artifacts WHERE brand_id=? AND run_id=? AND kind='inputs'").get(r.brandId,r.runId).n;
  const staged=[];
  async function copy(source,kind,assetKey){
   if(typeof source.sourcePath!=='string'||!source.sourcePath)throw invalidArgument('Origem explícita de arquivo obrigatória.');
   const relative=await stageFile(guard,source.sourcePath,{hooks,sleep});await hooks.hash?.();const {size}=await verify(relative,source.sha256);
   const item={id:randomUUID(),kind,version,sha256:source.sha256,relative,size,...(assetKey?{assetKey}:{}),...(source.metadata!==undefined?{composition:source.metadata}:{})};staged.push(item);return item;
  }
  const carouselFile=r.carousel?await copy(r.carousel,'carousel'):null,conceptFile=r.concept?await copy(r.concept,'concept'):null;
  let carousel=null,conceptPresent=false;const issues=[],missing=[];
  if(carouselFile){try{carousel=JSON.parse(text(await guard.withPaths([carouselFile.relative],filename=>readFile(filename)),'CAROUSEL_INVALID'));}catch{fail('CAROUSEL_INVALID','JSON do carrossel inválido.');}}
  if(conceptFile)conceptPresent=Boolean(text(await guard.withPaths([conceptFile.relative],filename=>readFile(filename)),'CONCEPT_INVALID').trim());
  if(!carouselFile)missing.push('carousel');if(!conceptPresent)missing.push('concept');if(contract.contractVersion===2)missing.push('composition-plan');
  const declared=object(carousel)&&Array.isArray(carousel.assets)?carousel.assets:[];
  if(object(carousel)&&Object.hasOwn(carousel,'slug'))validateSlug(carousel.slug);
  const ids=new Set(),paths=new Set();
  for(const asset of declared){
   if(!object(asset))continue;
   if(Object.hasOwn(asset,'id')){validatePathSegment(asset.id);if(ids.has(asset.id))throw invalidArgument('Identificadores de assets duplicados.');ids.add(asset.id);}
   if(Object.hasOwn(asset,'path')){const normalized=normalizeReference(asset.path);if(normalized!==asset.path||paths.has(normalized.toLowerCase()))throw invalidArgument('Referência de asset inválida ou duplicada.');paths.add(normalized.toLowerCase());}
  }
  if(carouselFile&&validateCarousel(carousel,{themes:[snapshot.theme.id]}).length)issues.push('CAROUSEL_INVALID');
  const supplied=new Set(descriptors.assets.map(a=>a.id));
  for(const id of ids)if(!supplied.has(id))missing.push(`asset:${id}`);
  if(carouselFile&&descriptors.assets.some(a=>!ids.has(a.id)))fail('ASSET_NOT_REFERENCED','Asset fornecido não consta do carrossel.');
  const assets=[];for(const asset of r.assets??[])assets.push(await copy(asset,`creative-asset:${asset.id}`,asset.id));
  const identity=await executable(),fingerprints=buildInputFingerprints({brandId:r.brandId,runId:r.runId,snapshotHash:run.snapshot_hash,executable:identity,contractVersion:contract.contractVersion,carousel,conceptHash:conceptFile?.sha256??null,assets:assets.map(a=>({id:a.assetKey,sha256:a.sha256}))});
  const reference=item=>item?{id:item.id,kind:item.kind,version:item.version,sha256:item.sha256,...(item.assetKey?{assetKey:item.assetKey}:{})}:null;
  const complete=missing.length===0&&issues.length===0,id=randomUUID();
  const result={schemaVersion:contract.contractVersion,...(contract.contractVersion===2?{contractVersion:2,fingerprintVersion:2}:{}),id,brandId:r.brandId,runId:r.runId,version,runVersion:r.expectedVersion+1,status:transitionRun(run.status,{type:'inputs-updated',complete}),inputsComplete:complete,missing,issues,creativeAssets:carouselFile&&!issues.length&&declared.length===0?'not-applicable':'required',snapshotHash:run.snapshot_hash,executable:identity,fingerprints,artifacts:{carousel:reference(carouselFile),concept:reference(conceptFile),assets:assets.map(reference),...(contract.contractVersion===2?{plan:null}:{})}};
  const bytes=Buffer.from(canonicalJson(result)),relative=await stageBytes(guard,bytes,{hooks,sleep});await hooks.hash?.();const manifestHash=await guard.withPaths([relative],hashFile);
  if(manifestHash.sha256!==canonicalHash(result))fail('ARTIFACT_HASH_MISMATCH','Manifesto gerado diverge do resultado.');
  staged.push({id,kind:'inputs',version,sha256:manifestHash.sha256,relative,size:manifestHash.size});
  for(const item of staged){item.relativePath=`runs/${r.brandId}/${r.runId}/${randomUUID()}/${item.id}.bin`;await promoteFile(guard,item.relative,item.relativePath,{hooks,sleep});}
  for(const item of staged)await verify(item.relativePath,item.sha256,item.size);
  const committed=runOperation(db,request,()=>{
   editable(r);
   for(const item of staged)db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(item.id,r.brandId,r.runId,item.kind,item.version,item.sha256,item.relativePath,canonicalJson({size:item.size,...(item.assetKey?{assetKey:item.assetKey}:{}),...(item.composition!==undefined?{composition:item.composition}:{})}));
   db.prepare('UPDATE runs SET version=version+1,status=?,current_step=? WHERE brand_id=? AND id=?').run(result.status,complete?'copy-approval':'inputs',r.brandId,r.runId);
   db.prepare("INSERT INTO steps(id,brand_id,run_id,step_key,fingerprint,status) VALUES(?,?,?,'inputs',?,?) ON CONFLICT(brand_id,run_id,step_key) DO UPDATE SET fingerprint=excluded.fingerprint,status=excluded.status").run(randomUUID(),r.brandId,r.runId,fingerprints.inputs,complete?'succeeded':'pending');
   const injected=hooks.commit?.();if(injected?.then)throw invalidArgument('Hook de commit precisa ser síncrono.');
   return {status:'committed',result};
  });
  // A duplicate concurrent request can have committed the other writer's set.
  const saved=await get(r.brandId,r.runId,committed.version);if(!saved||canonicalHash(saved)!==canonicalHash(committed))fail('ARTIFACT_HASH_MISMATCH','Resultado não corresponde ao manifesto confirmado.');return saved;
 }
 /** The plan points at already persisted material. Saving it separately avoids
  * inventing future carousel IDs or a circular plan/inputs identity. */
 async function savePlan(input){
  const r=JSON.parse(canonicalJson(input));exactKeys(r,['requestId','brandId','runId','expectedVersion','plan']);scope(r.brandId,r.runId);
  if(!Number.isSafeInteger(r.expectedVersion)||r.expectedVersion<1)throw invalidArgument('Versão de execução inválida.');
  const contract=writeContract(r.brandId,r.runId);
  if(contract.contractVersion!==2)fail('RUN_DERIVATION_REQUIRED','Execução histórica exige derivação para o contrato de qualidade.');
  const operation={requestId:r.requestId,brandId:r.brandId,runId:r.runId,operation:'run.plan.save',payload:{expectedVersion:r.expectedVersion,plan:r.plan}};
  const prepare=Symbol('prepare');let replay;
  try{replay=runOperation(db,operation,()=>{editable(r);throw prepare;});}catch(error){if(error!==prepare)throw error;}
  if(replay){const saved=await get(r.brandId,r.runId,replay.version);if(!saved||canonicalHash(saved)!==canonicalHash(replay))fail('ARTIFACT_HASH_MISMATCH','Resultado da operação diverge das entradas.');return saved;}
  const row=editable(r),snapshot=JSON.parse(row.snapshot_json),previous=await get(r.brandId,r.runId);
  if(!previous?.artifacts.carousel||!previous.artifacts.concept||previous.issues.length||previous.missing.some(key=>key!=='composition-plan'))fail('COMPOSITION_INVALID','Plano exige material completo.');
  const currentExecutable=await executable();if(canonicalHash(currentExecutable)!==canonicalHash(previous.executable))fail('RUNTIME_MISMATCH','Executável mudou desde a gravação das entradas.');
  const version=db.prepare("SELECT COALESCE(MAX(version),0)+1 n FROM artifacts WHERE brand_id=? AND run_id=? AND kind='composition-plan'").get(r.brandId,r.runId).n;
  const equal=(a,b)=>canonicalHash(a)===canonicalHash(b),raw=r.plan;
  if(!object(raw)||raw.brandId!==r.brandId||raw.runId!==r.runId||raw.version!==version||raw.snapshotHash!==row.snapshot_hash||raw.copyFingerprint!==previous.fingerprints['copy-approval']||!equal(raw.carouselRef,previous.artifacts.carousel)||!equal(raw.conceptRef,previous.artifacts.concept))fail('COMPOSITION_PLAN_STALE','Plano não corresponde às entradas atuais.');
  if(raw.change?.kind!=='initial'||raw.change.previousPlanRef!==null||raw.change.correctionEpisodeRef!==null||previous.artifacts.plan)fail('RUN_NOT_EDITABLE','Alteração de plano existente exige controle de invalidação.');
  const carouselFile=await resolveArtifact(r.brandId,r.runId,previous.artifacts.carousel.id),carousel=JSON.parse(await readFile(carouselFile.path,'utf8'));
  const resolvedAssets=previous.artifacts.assets.map(ref=>{const stored=db.prepare('SELECT metadata_json FROM artifacts WHERE brand_id=? AND run_id=? AND id=?').get(r.brandId,r.runId,ref.id);const {assetKey,...artifactRef}=ref;return {brandId:r.brandId,runId:r.runId,assetKey,artifactRef,metadata:JSON.parse(stored.metadata_json).composition??null};});
  const plan=validateCompositionPlan({plan:raw,carousel,assets:resolvedAssets,qualifications});
  for(const slide of plan.slides)if(!snapshot.qualifications.some(ref=>equal(ref,slide.qualificationRef)))fail('LAYOUT_NOT_QUALIFIED','Ficha não pertence à allowlist congelada.');
  const planRef={id:plan.id,kind:'composition-plan',version,sha256:canonicalHash(plan)};
  const refs=[...new Map(plan.slides.map(s=>[s.qualificationRef.id,s.qualificationRef])).values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const fingerprints=buildInputFingerprints({contractVersion:2,brandId:r.brandId,runId:r.runId,snapshotHash:row.snapshot_hash,executable:previous.executable,carousel,conceptHash:previous.artifacts.concept.sha256,assets:previous.artifacts.assets.map(a=>({id:a.assetKey,sha256:a.sha256})),planRef,qualificationRefs:refs,selection:plan.previewSelection,riskInventory:plan.riskInventory,fontBindings:snapshot.fontBindings,fonts:snapshot.fonts,renderer:snapshot.renderer});
  const result={...previous,id:randomUUID(),version:previous.version+1,runVersion:r.expectedVersion+1,status:transitionRun(row.status,{type:'inputs-updated',complete:true}),inputsComplete:true,missing:[],fingerprints,artifacts:{...previous.artifacts,plan:planRef}};
  const staged=[];
  for(const [record,kind,recordVersion] of [[plan,'composition-plan',version],[result,'inputs',result.version]]){
   const bytes=Buffer.from(canonicalJson(record)),relative=await stageBytes(guard,bytes,{hooks,sleep});await hooks.hash?.();const actual=await verify(relative,canonicalHash(record),bytes.length);
   const relativePath=`runs/${r.brandId}/${r.runId}/${randomUUID()}/${record.id}.bin`;
   await promoteFile(guard,relative,relativePath,{hooks,sleep});await verify(relativePath,actual.sha256,actual.size);
   staged.push({id:record.id,kind,version:recordVersion,sha256:actual.sha256,size:actual.size,relativePath});
  }
  // Recheck all predecessor bytes after staging; a reference is not file proof.
  const current=await get(r.brandId,r.runId);if(!equal(current,previous))fail('RUN_VERSION_CONFLICT','Entradas alteradas durante a composição.');
  const committed=runOperation(db,operation,()=>{
   editable(r);
   for(const item of staged)db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(item.id,r.brandId,r.runId,item.kind,item.version,item.sha256,item.relativePath,canonicalJson({size:item.size}));
   db.prepare("UPDATE runs SET version=version+1,status='ready',current_step='copy-approval' WHERE brand_id=? AND id=?").run(r.brandId,r.runId);
   db.prepare("UPDATE steps SET fingerprint=?,status='succeeded' WHERE brand_id=? AND run_id=? AND step_key='inputs'").run(fingerprints.inputs,r.brandId,r.runId);
   const injected=hooks.commit?.();if(injected?.then)throw invalidArgument('Hook de commit precisa ser síncrono.');
   return {status:'committed',result};
  });
  const saved=await get(r.brandId,r.runId,committed.version);if(!saved||!equal(saved,committed))fail('ARTIFACT_HASH_MISMATCH','Resultado diverge do plano persistido.');return saved;
 }
 return Object.freeze({save,savePlan,get,list,resolveArtifact});
}
