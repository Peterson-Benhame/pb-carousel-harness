import { canonicalHash,canonicalJson,CANONICAL_VERSION } from './canonical-json.mjs';
import { validateBrandConfig,exactKeys } from './brand-schema.mjs';
import { PublicError, invalidArgument } from './errors.mjs';
import { validateIdentifier } from './identifiers.mjs';
import { validateLayoutQualification, QUALIFICATION_IDS } from './layout-qualification.mjs';

// Preserve the historical default; new services explicitly select contract 2.
export const RUN_SNAPSHOT_VERSION=1;
/** Pure snapshot construction from resolved internal records. No paths, bytes or consent. */
export function buildRunSnapshot({brand,theme,adjustments={},fonts,logos,runtime,resourceState,materialReferences=[],contractVersion=1,qualityPolicy,qualifications,fontBindings,resourceManifestRef}) {
 if (![1,2].includes(contractVersion)) unsupported();
 if (contractVersion === 2) return buildQualitySnapshot({brand,theme,adjustments,fonts,logos,runtime,resourceState,materialReferences,qualityPolicy,qualifications,fontBindings,resourceManifestRef});
 exactKeys(adjustments,[],['audience','voice','preferences']);
 const config=validateBrandConfig({...brand.config,...adjustments});
 // Historical v1 serialization stays byte-for-byte unchanged.
 if (Object.hasOwn(config, 'configVersion')) {
  throw new PublicError('RUN_CONTRACT_UNSUPPORTED', 'Configuração de marca 2 exige o contrato de execução 2, ainda indisponível.');
 }
 if (runtime?.renderer?.id !== 'legacy-panorama@1') {
  throw new PublicError('RUN_CONTRACT_UNSUPPORTED', 'Renderizador exige um contrato de execução ainda indisponível.');
 }
 if(!Object.hasOwn(config.themes,theme))throw new PublicError('THEME_NOT_FOUND','Tema não encontrado nesta revisão.');
 return JSON.parse(canonicalJson({
  schemaVersion:RUN_SNAPSHOT_VERSION,contractVersion:1,canonicalVersion:CANONICAL_VERSION,
  brand:{id:brand.brandId,revision:brand.revision,revisionHash:brand.hash,config,effectiveHash:canonicalHash(config)},
  adjustments,theme:{id:theme,values:config.themes[theme]},dimensions:{width:config.slideWidth,height:config.slideHeight},
  approvalPolicy:{mode:'guided',required:['copy','concept','creative-assets']},
  fonts:fonts.map(({id,sha256})=>({id,sha256})),logos,
  renderer:runtime.renderer,runtime,resourceState,materialReferences,
 }));
}


const unsupported = () => { throw new PublicError('RUN_CONTRACT_UNSUPPORTED', 'Combinação de contratos de execução não suportada.'); };
const invalid = () => { throw invalidArgument('Snapshot de execução inválido ou não suportado.'); };
const unqualified = () => { throw new PublicError('LAYOUT_NOT_QUALIFIED', 'Layout sem qualificação liberada para produção.'); };
const hash = value => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(); };
const text = value => { if (typeof value !== 'string' || !value.trim()) invalid(); };
const integer = value => { if (!Number.isSafeInteger(value) || value < 1) invalid(); };
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
const sortCanonical = (a,b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0;
const list = (value,minimum=0) => { if (!Array.isArray(value) || value.length < minimum) invalid(); };
function freeze(value) {
 if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
 return value;
}
function distinct(values,key = canonicalJson) { if (new Set(values.map(value=>key(value))).size !== values.length) invalid(); }
function resourceRef(value,id,version) {
 exactKeys(value,['id','version','sha256']);
 if (value.id !== id || version !== undefined && value.version !== version) invalid();
 integer(value.version);hash(value.sha256);
}
export const EDITORIAL_SNAPSHOT_FILES = Object.freeze([
  "src/domain/composition-plan.mjs",
  "src/domain/layout-qualification.mjs",
  "src/domain/brand-schema.mjs",
  "src/infrastructure/resources.mjs",
  "src/domain/canonical-json.mjs",
  "src/domain/identifiers.mjs",
  "src/domain/errors.mjs",
  "src/domain/logo-policy.mjs",
  "src/infrastructure/fs/confined-path.mjs",
  "src/infrastructure/fs/workspace-paths.mjs",
  "scripts/validate-carousel.mjs",
  "shared/composition-plan.schema.json",
  "shared/layout-qualification.schema.json",
  "shared/layouts/editorial-composed-v1.json",
  "src/render/composed-carousel.mjs",
  "src/render/text-layout.mjs",
  "src/render/composition-geometry.mjs",
  "src/adapters/legacy/logo-layout.mjs",
  "src/adapters/legacy/render-context.mjs",
  "src/quality/objective-checks.mjs",
  "src/quality/review-rubric.mjs"
]);
function implementation(value,id) {
 exactKeys(value,['id','files']);
 if (value.id !== id) unsupported();
 if (id==='editorial-composed@1' && (!value.files || !same(Object.keys(value.files).sort(),[...EDITORIAL_SNAPSHOT_FILES].sort()))) invalid();
 if (!value.files || typeof value.files !== 'object' || Array.isArray(value.files) || !Object.keys(value.files).length) invalid();
 for (const [name,digest] of Object.entries(value.files)) {
  if (!/^(src|scripts|shared)\/[a-zA-Z0-9_./-]+$/.test(name) || name.split('/').some(part=>!part || part==='.' || part==='..')) invalid();
  hash(digest);
 }
}
const fontIdentities = Object.freeze({
 'Anton': {role:'title',sha256:'a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab',style:'normal',min:400,max:400,variable:false},
 'Manrope': {role:'body',sha256:'d0639be45d0af36e798172419d7bd173c4bd4f29e2b76cbb69db1d11bf8b0a40',style:'normal',min:200,max:800,variable:true},
 'JetBrains Mono': {role:'mono',sha256:'48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda',style:'normal',min:100,max:800,variable:true},
 'nimbus-roman-italic@1': {role:'accent',sha256:'b7c424e6cb79baddfcdcd9a9d87f9fc4fdd06f0e5160066e2b2e47bcd647c7b9',style:'italic',min:400,max:400,variable:false},
});
function bindings(value,config,fonts) {
 list(value,1);distinct(value);
 if (!same(value,[...value].sort(sortCanonical))) invalid();
 for (const b of value) {
  exactKeys(b,['role','fontId','sha256','style','weight','axes']);
  const identity = fontIdentities[b.fontId];
  if (!identity || b.role !== identity.role || config.fonts[b.role] !== b.fontId || b.sha256 !== identity.sha256
   || b.style !== identity.style || !Number.isFinite(b.weight) || b.weight < identity.min || b.weight > identity.max
   || !fonts.some(font=>font.id===b.fontId && font.sha256===b.sha256)) invalid();
  exactKeys(b.axes,identity.variable?['wght']:[]);
  if (identity.variable && b.axes.wght !== b.weight) invalid();
 }
}
function policy(value) {
 exactKeys(value,['id','sha256','samplePolicyRef','rubricRef','checkerRefs','mobileWidth','maxCorrectionRounds','maxPreviewSlides']);
 if (value.id !== 'quality-policy@1' || value.mobileWidth !== 360 || value.maxCorrectionRounds !== 2 || value.maxPreviewSlides !== 6) invalid();
 hash(value.sha256);
 resourceRef(value.samplePolicyRef,'representative-risk@1',1);
 resourceRef(value.rubricRef,'editorial-quality@1',1);
 list(value.checkerRefs,1);distinct(value.checkerRefs,item=>item.id);
 for (const ref of value.checkerRefs) resourceRef(ref,'editorial-objective-checkers@1',1);
}

/** Dispatch never repairs a partial or incoherent identity. V1 gets no persisted defaults. */
export function getRunContract(value) {
 const snapshot = JSON.parse(canonicalJson(value));
 if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) unsupported();
 const v = snapshot.schemaVersion;
 if (![1,2].includes(v) || snapshot.contractVersion !== v || snapshot.canonicalVersion !== 1) unsupported();
 if (v === 1) {
  if (['pipelineVersion','qualityPolicyVersion','qualityPolicy','qualifications','fontBindings','resourceManifestRef'].some(key=>Object.hasOwn(snapshot,key))) unsupported();
 } else if (snapshot.pipelineVersion !== 2 || snapshot.qualityPolicyVersion !== 1) unsupported();
 const renderer = v===1?'legacy-panorama@1':'editorial-composed@1';
 if (snapshot.renderer?.id !== renderer || snapshot.runtime?.renderer?.id !== renderer || !same(snapshot.renderer,snapshot.runtime.renderer)) unsupported();
 return Object.freeze({schemaVersion:v,contractVersion:v,canonicalVersion:1,pipelineVersion:v,qualityPolicyVersion:v===2?1:null});
}

/** Pure validation of stored bytes, not a resource resolver or production gate. */
export function validateRunSnapshot(value) {
 const snapshot = JSON.parse(canonicalJson(value));
 const contract = getRunContract(snapshot), v2=contract.contractVersion===2;
 exactKeys(snapshot,['schemaVersion','contractVersion','canonicalVersion','brand','adjustments','theme','dimensions','approvalPolicy','fonts','logos','renderer','runtime','resourceState','materialReferences',
  ...(v2?['pipelineVersion','qualityPolicyVersion','qualityPolicy','qualifications','fontBindings','resourceManifestRef']:[])]);
 const brand=snapshot.brand;
 exactKeys(brand,['id','revision','revisionHash','config','effectiveHash']);
 validateIdentifier(brand.id);integer(brand.revision);hash(brand.revisionHash);hash(brand.effectiveHash);
 const config=validateBrandConfig(brand.config);
 if (!v2 && Object.hasOwn(config,'configVersion')) unsupported();
 if (canonicalHash(config)!==brand.effectiveHash) throw new PublicError('SNAPSHOT_HASH_MISMATCH','Configuração efetiva diverge de seu hash.');
 exactKeys(snapshot.adjustments,[],['audience','voice','preferences']);
 if (!same(validateBrandConfig({...config,...snapshot.adjustments}),config)) invalid();
 exactKeys(snapshot.theme,['id','values']);
 if (!Object.hasOwn(config.themes,snapshot.theme.id) || !same(snapshot.theme.values,config.themes[snapshot.theme.id])) invalid();
 exactKeys(snapshot.dimensions,['width','height']);
 if (snapshot.dimensions.width!==config.slideWidth || snapshot.dimensions.height!==config.slideHeight) invalid();
 if (!same(snapshot.approvalPolicy,{mode:'guided',required:['copy','concept','creative-assets',...(v2?['preview']:[])]})) invalid();
 list(snapshot.fonts,3);distinct(snapshot.fonts,item=>item.id);
 if (snapshot.fonts.length !== Object.keys(config.fonts).length) invalid();
 for (const font of snapshot.fonts) { exactKeys(font,['id','sha256']);hash(font.sha256);if (!Object.values(config.fonts).includes(font.id)) invalid(); }
 list(snapshot.logos);distinct(snapshot.logos,item=>item.surface);
 if (snapshot.logos.length !== Object.keys(config.logo.variants).length) invalid();
 for (const logo of snapshot.logos) {
  exactKeys(logo,['surface','id','sha256']);hash(logo.sha256);validateIdentifier(logo.id);
  if (!['light','dark'].includes(logo.surface) || config.logo.variants[logo.surface]!==logo.id) invalid();
 }
 implementation(snapshot.renderer,v2?'editorial-composed@1':'legacy-panorama@1');
 const runtime=snapshot.runtime;
 exactKeys(runtime,['package','node','platform','arch','abi','napi','renderer','dependencies','fonts']);
 exactKeys(runtime.package,['name','version']);text(runtime.package.name);text(runtime.package.version);
 for (const key of ['node','platform','arch','abi','napi']) text(runtime[key]);
 exactKeys(runtime.dependencies,['better-sqlite3','sharp','fontkit','archiver']);
 for (const dependency of Object.values(runtime.dependencies)) {
  if (dependency===null) continue;
  exactKeys(dependency,['version'],['sqlite','vips','engines']);
  for (const key of ['version','sqlite','vips']) if (Object.hasOwn(dependency,key)) text(dependency[key]);
  if (Object.hasOwn(dependency,'engines')) {
   if (!dependency.engines || typeof dependency.engines!=='object' || Array.isArray(dependency.engines)) invalid();
   for (const version of Object.values(dependency.engines)) text(version);
  }
 }
 list(runtime.fonts);distinct(runtime.fonts,item=>item.id);
 for (const font of runtime.fonts) {exactKeys(font,['id','sha256']);text(font.id);if(font.sha256!==null) hash(font.sha256);if(!snapshot.fonts.some(expected=>expected.id===font.id)) invalid();}
 exactKeys(snapshot.resourceState,['renderPrerequisites','blockers']);
 if (typeof snapshot.resourceState.renderPrerequisites!=='boolean') invalid();
 list(snapshot.resourceState.blockers);
 for (const blocker of snapshot.resourceState.blockers) {exactKeys(blocker,['code','resource']);text(blocker.code);text(blocker.resource);}
 list(snapshot.materialReferences);distinct(snapshot.materialReferences,item=>`${item.runId}:${item.artifactId}`);
 for (const ref of snapshot.materialReferences) {
  exactKeys(ref,['runId','artifactId','kind','version','sha256']);validateIdentifier(ref.runId);validateIdentifier(ref.artifactId);text(ref.kind);integer(ref.version);hash(ref.sha256);
 }
 if (v2) {
  if (!same(snapshot.fonts,[...snapshot.fonts].sort((a,b)=>a.id<b.id?-1:1)) || snapshot.fonts.some(font=>fontIdentities[font.id]?.sha256!==font.sha256)) invalid();
  policy(snapshot.qualityPolicy);
  resourceRef(snapshot.resourceManifestRef,'resources-manifest@2',2);
  bindings(snapshot.fontBindings,config,snapshot.fonts);
  list(snapshot.qualifications,1);distinct(snapshot.qualifications,item=>item.id);
  if (!same(snapshot.qualifications,[...snapshot.qualifications].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))) invalid();
  for (const ref of snapshot.qualifications) {
   exactKeys(ref,['id','version','sha256','definitionHash']);
   if (!QUALIFICATION_IDS.includes(ref.id)) invalid();
   integer(ref.version);hash(ref.sha256);hash(ref.definitionHash);
  }
 }
 return freeze(snapshot);
}

function buildQualitySnapshot({brand,theme,adjustments,fonts,logos,runtime,resourceState,materialReferences,qualityPolicy,qualifications,fontBindings,resourceManifestRef}) {
 if (runtime?.renderer?.id !== 'editorial-composed@1') unsupported();
 if (!Array.isArray(qualifications) || !qualifications.length) unqualified();
 const records=qualifications.map(record=>{
  const q=validateLayoutQualification(record);
  if (q.status!=='qualified' || !q.release) unqualified();
  return q;
 });
 const config=validateBrandConfig({...brand.config,...adjustments});
 exactKeys(adjustments,[],['audience','voice','preferences']);
 if (!Object.hasOwn(config.themes,theme)) throw new PublicError('THEME_NOT_FOUND','Tema não encontrado nesta revisão.');
 policy(qualityPolicy);bindings(fontBindings,config,fonts);
 if (['cover','context','content','summary','cta'].some(role=>!records.some(q=>q.definition.roles.includes(role)))) unqualified();
 for (const q of records) {
  if (!same(q.definition.rubricRef,qualityPolicy.rubricRef) || !qualityPolicy.checkerRefs.some(ref=>same(ref,q.definition.checkerRef))
   || q.definition.fontBindings.some(binding=>!fontBindings.some(allowed=>same(binding,allowed)))) unqualified();
 }
 if (fontBindings.some(binding=>!records.some(q=>q.definition.fontBindings.some(allowed=>same(binding,allowed))))) unqualified();
 return validateRunSnapshot({
  schemaVersion:2,contractVersion:2,canonicalVersion:1,pipelineVersion:2,qualityPolicyVersion:1,
  brand:{id:brand.brandId,revision:brand.revision,revisionHash:brand.hash,config,effectiveHash:canonicalHash(config)},
  adjustments,theme:{id:theme,values:config.themes[theme]},dimensions:{width:config.slideWidth,height:config.slideHeight},
  approvalPolicy:{mode:'guided',required:['copy','concept','creative-assets','preview']},
  fonts:fonts.map(({id,sha256})=>({id,sha256})).sort((a,b)=>a.id<b.id?-1:1),logos,renderer:runtime.renderer,runtime,resourceState,materialReferences,
  qualityPolicy,qualifications:records.map(q=>({id:q.id,version:q.version,sha256:canonicalHash(q),definitionHash:q.definitionHash})).sort((a,b)=>a.id<b.id?-1:1),fontBindings,resourceManifestRef,
 });
}
