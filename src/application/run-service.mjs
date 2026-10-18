import {randomUUID} from 'node:crypto';
import {createBrandMemory} from './brand-memory.mjs';
import {createAssetStore} from './asset-store.mjs';
import {runOperation} from './operation-runner.mjs';
import {runDoctor} from './doctor.mjs';
import {loadResourcesManifest} from '../infrastructure/resources.mjs';
import {verifySchema,assertQualityContractActive} from '../infrastructure/sqlite/migrations.mjs';
import {canonicalHash,canonicalJson} from '../domain/canonical-json.mjs';
import {validateIdentifier} from '../domain/identifiers.mjs';
import {exactKeys} from '../domain/brand-schema.mjs';
import {LOGO_KIND} from '../domain/logo-policy.mjs';
import {buildRunSnapshot,validateRunSnapshot} from '../domain/run-snapshot.mjs';
import {PublicError,invalidArgument} from '../domain/errors.mjs';
const fail=(code,message)=>{throw new PublicError(code,message);};

/** Internal T11/Q04 API. Options are trusted runtime/resource configuration, not request fields.
 * qualityResources contains resolved released records; it is never a public bypass flag.
 * The shipped catalog has no releases, so production v2 remains blocked by default.
 * Files/probes run outside short DB transactions. T12 owns actual artifact reuse.
 */
export function createRunService(db,options={}) {
 const memory=createBrandMemory(db);
 function read(row){
  if (!row) return null;
  const snapshot=validateRunSnapshot(JSON.parse(row.snapshot_json));
  if (canonicalHash(snapshot)!==row.snapshot_hash) fail('SNAPSHOT_HASH_MISMATCH','Snapshot diverge de seu hash persistido.');
  return {id:row.id,brandId:row.brand_id,brandRevision:row.brand_revision,parentRunId:row.source_run_id,status:row.status,currentStep:row.current_step,version:row.version,snapshot,snapshotHash:row.snapshot_hash,approvals:db.prepare('SELECT id,kind,decision,object_fingerprint AS objectFingerprint FROM approvals WHERE brand_id=? AND run_id=? ORDER BY id').all(row.brand_id,row.id)};
 }
 function get(brandId,runId){validateIdentifier(brandId);validateIdentifier(runId);verifySchema(db);return read(db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(brandId,runId));}
 function list({brandId}={}){validateIdentifier(brandId);verifySchema(db);return db.prepare('SELECT * FROM runs WHERE brand_id=? ORDER BY rowid').all(brandId).map(read);}
 function context(r,derived){
  const brand=memory.get(r.brandId,r.brandRevision);if(!brand)fail('BRAND_NOT_FOUND','Marca ou revisão não encontrada.');if(brand.status!=='active')fail('BRAND_ARCHIVED','Marca arquivada.');
  const materialReferences=[];
  if(derived){if(!get(r.brandId,r.parentRunId))fail('RUN_NOT_FOUND','Execução de origem não encontrada.');for(const id of r.materialArtifactIds??[]){const a=db.prepare('SELECT id,kind,version,hash FROM artifacts WHERE brand_id=? AND run_id=? AND id=?').get(r.brandId,r.parentRunId,id);if(!a)fail('ARTIFACT_NOT_FOUND','Material não pertence à execução de origem.');materialReferences.push({runId:r.parentRunId,artifactId:a.id,kind:a.kind,version:a.version,sha256:a.hash});}}
  const logos=Object.entries(brand.config.logo.variants).map(([surface,id])=>{const a=db.prepare('SELECT id,hash,kind FROM assets WHERE brand_id=? AND id=?').get(r.brandId,id);if(!a||a.kind!==LOGO_KIND)fail('ASSET_INVALID','Logotipo não pertence à marca.');return {surface,id:a.id,sha256:a.hash};});
  return {brand,logos,materialReferences};
 }
 async function save(input,derived){
  const r=JSON.parse(canonicalJson(input));exactKeys(r,['requestId','brandId','brandRevision','theme',...(derived?['parentRunId']:[])],['adjustments','contractVersion',...(derived?['materialArtifactIds']:[])]);
  validateIdentifier(r.brandId);if(typeof r.requestId!=='string'||!r.requestId.trim()||!Number.isSafeInteger(r.brandRevision)||r.brandRevision<1||typeof r.theme!=='string'||!r.theme.trim())throw invalidArgument('Execução exige marca, revisão e tema explícitos.');
  if(r.adjustments!==undefined)exactKeys(r.adjustments,[],['audience','voice','preferences']);
  if(derived){validateIdentifier(r.parentRunId);if(r.materialArtifactIds!==undefined&&(!Array.isArray(r.materialArtifactIds)||new Set(r.materialArtifactIds).size!==r.materialArtifactIds.length))throw invalidArgument('Referências de material inválidas.');for(const id of r.materialArtifactIds??[])validateIdentifier(id);}
  const schemaVersion=verifySchema(db),contractVersion=Object.hasOwn(r,'contractVersion')?r.contractVersion:(schemaVersion===2?2:1);
  if (![1,2].includes(contractVersion)) fail('RUN_CONTRACT_UNSUPPORTED','Versão do contrato de execução não suportada.');
  function assertWritableContract() {
   const current=verifySchema(db);
   if (contractVersion===2) assertQualityContractActive(db);
   else if (current===2) fail('RUN_DERIVATION_REQUIRED','O workspace ativado exige uma nova execução no contrato de qualidade 2.');
   // A historical request cannot use replay to cross the activation boundary.
   if (current===2) {
    const previous=db.prepare('SELECT operation,brand_id,result_json FROM operations WHERE request_id=?').get(r.requestId);
    if (previous?.brand_id===r.brandId && ['run.create','run.derive'].includes(previous.operation)
      && JSON.parse(previous.result_json).snapshot?.contractVersion===1) fail('RUN_DERIVATION_REQUIRED','A execução histórica exige derivação para o contrato de qualidade 2.');
   }
  }
  assertWritableContract();
  const operation={requestId:r.requestId,operation:derived?'run.derive':'run.create',brandId:r.brandId,payload:r};
  // T06 preflight checks replay/conflict/maintenance before environmental work.
  const prepare=Symbol('prepare');let replay;
  try{replay=runOperation(db,operation,()=>{context(r,derived);throw prepare;});}catch(e){if(e!==prepare)throw e;}
  if(replay)return replay;
  const prepared=context(r,derived);
  const manifest=options.manifest??await loadResourcesManifest(options);
  let qualityResources;
  let doctor;
  if (contractVersion===2) {
   doctor=await runDoctor({...options,manifest,rendererId:'editorial-composed@1'});
   const supplied=typeof options.qualityResources==='function'
    ? await options.qualityResources({brand:prepared.brand,manifest,runtime:doctor.runtime})
    : options.qualityResources;
   if (!supplied) fail('LAYOUT_NOT_QUALIFIED','Layout sem qualificação liberada para produção.');
   qualityResources=JSON.parse(canonicalJson(supplied));
   exactKeys(qualityResources,['qualityPolicy','qualifications','fontBindings','resourceManifestRef']);
   if (manifest.schemaVersion!==2 || qualityResources.resourceManifestRef?.sha256!==canonicalHash(manifest)) fail('RUNTIME_MISMATCH','Manifesto de recursos diverge da identidade congelada.');
  }
  doctor=await runDoctor({...options,manifest,...(contractVersion===2?{rendererId:'editorial-composed@1',requiredFontIds:[...new Set(qualityResources.fontBindings.map(binding=>binding.fontId))]}:{})});
  const blocker=doctor.diagnostics.find(d=>['SCHEMA_TOO_NEW','SCHEMA_INVALID','SCHEMA_MIGRATION_REQUIRED','RUNTIME_INCOMPATIBLE','PACKAGE_INCOMPLETE'].includes(d.code));
  if(blocker)fail(blocker.code,blocker.message);
  if(!doctor.readiness.register)fail('WORKSPACE_UNAVAILABLE','Workspace indisponível para criar execução.');
  if(prepared.logos.length){const store=await createAssetStore({root:doctor.workspace.root,db});for(const logo of prepared.logos)await store.resolve(r.brandId,logo.id);}
  const snapshot=buildRunSnapshot({...prepared,...qualityResources,contractVersion,theme:r.theme,adjustments:r.adjustments,fonts:[...manifest.fonts,...(contractVersion===2?(manifest.optionalFonts??[]).filter(font=>Object.values(prepared.brand.config.fonts).includes(font.id)):[])],runtime:doctor.runtime,resourceState:{renderPrerequisites:doctor.readiness.renderPrerequisites,blockers:doctor.renderBlockers.map(({code,resource})=>({code,resource}))}});
  return runOperation(db,operation,()=>{
   // Recheck scope/archive/lineage after asynchronous reads; revisions/assets are immutable.
   assertWritableContract();
   context(r,derived);
   const id=randomUUID();db.prepare('INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash,source_run_id) VALUES(?,?,?,?,?,?)').run(id,r.brandId,r.brandRevision,canonicalJson(snapshot),canonicalHash(snapshot),derived?r.parentRunId:null);
   return {status:'committed',result:get(r.brandId,id)};
  });
 }
 return Object.freeze({create:input=>save(input,false),derive:input=>save(input,true),get,list});
}
