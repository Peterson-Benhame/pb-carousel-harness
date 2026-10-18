import {readFile} from 'node:fs/promises';
import {canonicalHash,canonicalJson} from '../domain/canonical-json.mjs';
import {validateLayoutQualification} from '../domain/layout-qualification.mjs';
import {qualificationRendererHash} from '../domain/quality-policy.mjs';
import {createConfinedRoot} from '../infrastructure/fs/confined-path.mjs';
import {loadResourcesManifest,DEFAULT_PACKAGE_ROOT,dependencyNames,probeDependency,sha256} from '../infrastructure/resources.mjs';
import {PublicError} from '../domain/errors.mjs';
const fail=(code,message)=>{throw new PublicError(code,message);};
const equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
async function policyRecords(guard){
 const rubricRef={id:'editorial-quality@1',version:1,sha256:sha256(await guard.withPaths(['src/quality/review-rubric.mjs'],p=>readFile(p)))};
 const checkerRefs=[{id:'editorial-objective-checkers@1',version:1,sha256:sha256(await guard.withPaths(['src/quality/objective-checks.mjs'],p=>readFile(p)))}];
 const samplePolicyRef={id:'representative-risk@1',version:1,sha256:sha256(await guard.withPaths(['src/domain/composition-plan.mjs'],p=>readFile(p)))};
 const policy={id:'quality-policy@1',samplePolicyRef,rubricRef,checkerRefs,mobileWidth:360,maxCorrectionRounds:2,maxPreviewSlides:6};
 return {rubricRef,checkerRefs,qualityPolicy:{...policy,sha256:canonicalHash(policy)}};
}
function qualifiedEnvironment(runtime,qualification){
 return {platform:runtime.platform,arch:runtime.arch,node:runtime.node,abi:runtime.abi,napi:runtime.napi,dependenciesHash:canonicalHash(runtime.dependencies),rendererHash:qualificationRendererHash(runtime.renderer),fontBindingsHash:canonicalHash(qualification.definition.fontBindings)};
}
function verifyCurrentEvidence(catalog,qualification,environment){
 const currentKinds=new Set();
 for(const ref of qualification.evidenceRefs){
  const resource=catalog.evidence?.find(item=>item.ref?.id===ref.id&&item.ref.version===ref.version),data=resource?.data;
  if(!resource||!equal(resource.ref,ref)||canonicalHash(data)!==ref.sha256||data.definitionHash!==qualification.definitionHash||data.kind!==ref.kind||data.rendererHash!==data.environment?.rendererHash||!qualification.release.qualifiedEnvironments.some(allowed=>equal(allowed,data.environment)))fail('LAYOUT_NOT_QUALIFIED','Evidência de qualificação ausente ou divergente no pacote.');
  if(equal(data.environment,environment))currentKinds.add(ref.kind);
 }
 if(['qualification-fixture','qualification-metrics','qualification-review'].some(kind=>!currentKinds.has(kind)))fail('LAYOUT_NOT_QUALIFIED','Ambiente atual sem evidência completa de qualificação.');
}

/** Resolve only released package records for a new v2 snapshot. Request payloads
 * never provide qualifications, policy, bindings, paths or release status. */
export async function loadRunCreationQualityResources({packageRoot=DEFAULT_PACKAGE_ROOT,manifest:providedManifest,runtime,config}={}){
 const guard=await createConfinedRoot(packageRoot),manifest=providedManifest??await loadResourcesManifest({packageRoot});
 const catalog=JSON.parse(await guard.withPaths(['shared/layouts/editorial-composed-v1.json'],file=>readFile(file,'utf8')));
 const selected=manifest.renderers?.find(renderer=>renderer.id==='editorial-composed@1');
 if(manifest.schemaVersion!==2||selected?.status!=='qualified'||catalog.rendererId!==selected.id||!Array.isArray(catalog.qualifications))fail('LAYOUT_NOT_QUALIFIED','Catálogo editorial ainda não foi liberado para produção.');
 if(!runtime||!equal(runtime.renderer,{id:selected.id,files:selected.hashes}))fail('RUNTIME_MISMATCH','Renderizador atual diverge da identidade liberada.');
 const {rubricRef,checkerRefs,qualityPolicy}=await policyRecords(guard),qualifications=[],bindings=new Map();
 for(const record of catalog.qualifications){
  const qualification=validateLayoutQualification(record);
  if(qualification.status!=='qualified'||!qualification.release||!equal(qualification.definition.rubricRef,rubricRef)||!equal(qualification.definition.checkerRef,checkerRefs[0]))fail('LAYOUT_NOT_QUALIFIED','Ficha requerida não tem liberação produtiva.');
  const environment=qualifiedEnvironment(runtime,qualification);
  if(!qualification.release.qualifiedEnvironments.some(allowed=>equal(allowed,environment)))fail('LAYOUT_NOT_QUALIFIED','Ambiente não coberto pela ficha liberada.');
  verifyCurrentEvidence(catalog,qualification,environment);
  qualifications.push(qualification);
  for(const binding of qualification.definition.fontBindings){
   if(config?.fonts?.[binding.role]===binding.fontId)bindings.set(canonicalJson(binding),binding);
  }
 }
 return Object.freeze({
  qualityPolicy,
  qualifications,
  fontBindings:[...bindings.values()].sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:canonicalJson(a)>canonicalJson(b)?1:0),
  resourceManifestRef:{id:'resources-manifest@2',version:2,sha256:canonicalHash(manifest)},
 });
}
/** Package-backed authority, never a caller supplied list, status flag or
 * callback. Catalog remains candidate until a separately reviewed release. */
export async function loadQualifiedQualityResources({packageRoot=DEFAULT_PACKAGE_ROOT,snapshot}){
 const guard=await createConfinedRoot(packageRoot),manifest=await loadResourcesManifest({packageRoot});
 const catalog=JSON.parse(await guard.withPaths(['shared/layouts/editorial-composed-v1.json'],file=>readFile(file,'utf8')));
 const selected=manifest.renderers.find(r=>r.id==='editorial-composed@1');
 if(selected?.status!=='qualified'||!Array.isArray(catalog.qualifications))fail('LAYOUT_NOT_QUALIFIED','Catálogo editorial ainda não foi liberado para produção.');
 if(snapshot.resourceManifestRef.sha256!==canonicalHash(manifest))fail('RUNTIME_MISMATCH','Manifesto de recursos mudou desde o snapshot.');
 for(const [file,digest] of Object.entries(snapshot.renderer.files)){
  if(!selected.files.includes(file)||selected.hashes[file]!==digest||sha256(await guard.withPaths([file],p=>readFile(p)))!==digest)fail('RUNTIME_MISMATCH','Módulo ou recurso não corresponde ao snapshot.');
 }
 const runtime=snapshot.runtime;
 if(runtime.node!==process.version||runtime.platform!==process.platform||runtime.arch!==process.arch||runtime.abi!==process.versions.modules||runtime.napi!==process.versions.napi)fail('RUNTIME_MISMATCH','Ambiente atual diverge da qualificação congelada.');
 const dependencies=Object.fromEntries(await Promise.all(dependencyNames.map(async name=>[name,await probeDependency(name)])));
 if(!equal(dependencies,runtime.dependencies))fail('RUNTIME_MISMATCH','Dependências atuais divergem da qualificação congelada.');
 const {rubricRef,checkerRefs,qualityPolicy}=await policyRecords(guard);
 const policy={...qualityPolicy};delete policy.sha256;
 if(!equal(snapshot.qualityPolicy,{...policy,sha256:canonicalHash(policy)}))fail('RUNTIME_MISMATCH','Política ou seleção diverge da identidade congelada.');
 if(!equal(rubricRef,snapshot.qualityPolicy.rubricRef)||!equal(checkerRefs,snapshot.qualityPolicy.checkerRefs))fail('RUNTIME_MISMATCH','Rubrica ou checker divergente.');
 const qualifications=[];
 for(const ref of snapshot.qualifications){
  const value=catalog.qualifications.find(q=>q.id===ref.id&&q.version===ref.version);
  if(!value||value.status!=='qualified')fail('LAYOUT_NOT_QUALIFIED','Ficha requerida não tem liberação produtiva.');
  const q=validateLayoutQualification(value);
  if(canonicalHash(q)!==ref.sha256||q.definitionHash!==ref.definitionHash)fail('LAYOUT_NOT_QUALIFIED','Ficha não corresponde à allowlist congelada.');
  const environment={platform:runtime.platform,arch:runtime.arch,node:runtime.node,abi:runtime.abi,napi:runtime.napi,dependenciesHash:canonicalHash(runtime.dependencies),rendererHash:qualificationRendererHash(runtime.renderer),fontBindingsHash:canonicalHash(q.definition.fontBindings)};
  if(!q.release.qualifiedEnvironments.some(e=>equal(e,environment)))fail('LAYOUT_NOT_QUALIFIED','Ambiente não coberto pela ficha liberada.');
  const currentKinds=new Set();
  for(const e of q.evidenceRefs){
   const resource=catalog.evidence?.find(item=>item.ref?.id===e.id&&item.ref.version===e.version),data=resource?.data;
   if(!resource||!equal(resource.ref,e)||canonicalHash(data)!==e.sha256||data.definitionHash!==q.definitionHash||data.kind!==e.kind||data.rendererHash!==data.environment?.rendererHash||!q.release.qualifiedEnvironments.some(allowed=>equal(allowed,data.environment)))fail('LAYOUT_NOT_QUALIFIED','Evidência de qualificação ausente ou divergente no pacote.');
   if(equal(data.environment,environment))currentKinds.add(e.kind);
  }
  if(['qualification-fixture','qualification-metrics','qualification-review'].some(kind=>!currentKinds.has(kind)))fail('LAYOUT_NOT_QUALIFIED','Ambiente atual sem evidência completa de qualificação.');
  qualifications.push(q);
 }
 return Object.freeze({manifest,qualifications,rubricRef,checkerRefs});
}
