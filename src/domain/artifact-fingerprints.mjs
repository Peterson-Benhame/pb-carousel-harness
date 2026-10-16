import {canonicalHash,canonicalJson,CANONICAL_VERSION} from './canonical-json.mjs';
import {validateIdentifier} from './identifiers.mjs';
import {invalidArgument,PublicError} from './errors.mjs';
import {exactKeys} from './brand-schema.mjs';

export const ARTIFACT_FINGERPRINT_VERSION=1;
const stages=new Set(['inputs','copy-approval','concept-approval','assets-approval','render','validate','package']);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
/** A stage identity never substitutes for file verification or human consent.
 * validate/package callers must supply their actual output manifests in inputs.
 */
function fingerprintStageV1({stage,brandId,runId,snapshotHash,executable,inputs}) {
 validateIdentifier(brandId);validateIdentifier(runId);
 if(!stages.has(stage)||!hash(snapshotHash)||!executable||typeof executable!=='object'||Array.isArray(executable)||!Object.keys(executable).length)throw invalidArgument('Contexto de fingerprint inválido.');
 return canonicalHash({fingerprintVersion:ARTIFACT_FINGERPRINT_VERSION,canonicalVersion:CANONICAL_VERSION,scope:{brandId,runId},stage,snapshotHash,executable,inputs});
}
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
/** Copy is the editorial material, not creative bytes/layout. Array order is meaningful. */
function buildInputFingerprintsV1({carousel=null,conceptHash=null,assets=[],...context}) {
 if(conceptHash!==null&&!hash(conceptHash)||!Array.isArray(assets)||assets.some(a=>typeof a.id!=='string'||!a.id||!hash(a.sha256))||new Set(assets.map(a=>a.id)).size!==assets.length)throw invalidArgument('Entradas de fingerprint inválidas.');
 const object=carousel!==null&&typeof carousel==='object'&&!Array.isArray(carousel)?carousel:null;
 const copy=object?pick(object,['voiceMode','objective','slideCountException','slideCountExceptionReason','caption','cta','hashtags','altText','sources']):null;
 if(copy&&Array.isArray(object.slides))copy.slides=object.slides.map(slide=>slide&&typeof slide==='object'&&!Array.isArray(slide)?pick(slide,['index','role','eyebrow','title','body','code','number','imageAlt']):slide);
 const creative=assets.map(({id,sha256})=>({id,sha256})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const fingerprint=(stage,inputs)=>fingerprintStageV1({...context,stage,inputs});
 const copyFingerprint=fingerprint('copy-approval',{copy});
 const visual=object?pick(object,['theme','continuity']):null;
 if(visual&&Array.isArray(object.slides))visual.slides=object.slides.map(slide=>slide&&typeof slide==='object'&&!Array.isArray(slide)?pick(slide,['index','visualSlot']):slide);
 const conceptFingerprint=fingerprint('concept-approval',{copy:copyFingerprint,concept:conceptHash,visual});
 const assetsFingerprint=fingerprint('assets-approval',{concept:conceptFingerprint,assets:creative});
 const all={carousel,concept:conceptHash,assets:creative};
 return {'inputs':fingerprint('inputs',all),'copy-approval':copyFingerprint,'concept-approval':conceptFingerprint,'assets-approval':assetsFingerprint,render:fingerprint('render',all)};
}

// The historical functions above retain their v1 serialization exactly. Contract
// dispatch never substitutes current code or resources during historical reads.
const fieldsV2=Object.freeze({
 inputs:['carousel','concept','assets','planRef'],
 'copy-approval':['copy'],
 'concept-approval':['copy','concept','visual'],
 'assets-approval':['concept','assets'],
 'preview-render':['assetsFingerprint','planHash','qualificationRefs','selection','riskInventory','fontBindings','fonts','renderer'],
 'preview-review':['manifestRef','renderAttemptId','files','metricsRef','objectiveReportRef','rubricRef','checkerRefs'],
 'preview-approval':['reviewRef','manifestRef','planHash','selectionHash'],
 render:['assetsFingerprint','planHash','qualificationRefs','fontBindings','fonts','renderer','previewApprovalRef','selection'],
 validate:['manifestRef','renderAttemptId','files','metricsRef','checkerRefs','qualificationRefs'],
 'quality-review':['manifestRef','objectiveReportRef','rubricRef','checkerRefs','coverage'],
 package:['manifestRef','objectiveReportRef','reviewRef','texts','qualityPolicy','allowlist'],
});
function contract({contractVersion=1,fingerprintVersion=contractVersion}) {
 if(![1,2].includes(contractVersion)||fingerprintVersion!==contractVersion)throw new PublicError('RUN_CONTRACT_UNSUPPORTED','Contrato de fingerprint não suportado.');
 return contractVersion;
}
export function fingerprintStage(context) {
 const version=contract(context);
 if(version===1)return fingerprintStageV1(context);
 const {stage,brandId,runId,snapshotHash,executable,inputs}=context;
 validateIdentifier(brandId);validateIdentifier(runId);
 if(!Object.hasOwn(fieldsV2,stage)||!hash(snapshotHash)||!executable||typeof executable!=='object'||Array.isArray(executable)||!Object.keys(executable).length)throw invalidArgument('Contexto de fingerprint inválido.');
 exactKeys(inputs,fieldsV2[stage]);
 const normalized=JSON.parse(canonicalJson(inputs));
 for(const key of ['qualificationRefs','checkerRefs','fontBindings','fonts','assets','allowlist'])if(Array.isArray(normalized[key]))normalized[key].sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:canonicalJson(a)>canonicalJson(b)?1:0);
 return canonicalHash({fingerprintVersion:2,canonicalVersion:CANONICAL_VERSION,scope:{brandId,runId},stage,snapshotHash,executable,inputs:normalized});
}
export function buildInputFingerprints(context) {
 const version=contract(context);
 if(version===1)return buildInputFingerprintsV1(context);
 const {carousel=null,conceptHash=null,assets=[],planRef=null,qualificationRefs=[],selection=null,riskInventory=null,fontBindings=[],fonts=[],renderer=null}=context;
 if(conceptHash!==null&&!hash(conceptHash)||!Array.isArray(assets)||assets.some(a=>typeof a.id!=='string'||!a.id||!hash(a.sha256))||new Set(assets.map(a=>a.id)).size!==assets.length)throw invalidArgument('Entradas de fingerprint inválidas.');
 const object=carousel!==null&&typeof carousel==='object'&&!Array.isArray(carousel)?carousel:null;
 const copy=object?pick(object,['voiceMode','objective','slideCountException','slideCountExceptionReason','caption','cta','hashtags','altText','sources']):null;
 if(copy&&Array.isArray(object.slides))copy.slides=object.slides.map(slide=>slide&&typeof slide==='object'&&!Array.isArray(slide)?pick(slide,['index','role','eyebrow','title','body','code','number','imageAlt']):slide);
 const visual=object?pick(object,['theme','continuity']):null;
 if(visual&&Array.isArray(object.slides))visual.slides=object.slides.map(slide=>slide&&typeof slide==='object'&&!Array.isArray(slide)?pick(slide,['index','visualSlot']):slide);
 const fingerprint=(stage,inputs)=>fingerprintStage({...context,stage,inputs});
 const copyFingerprint=fingerprint('copy-approval',{copy}),conceptFingerprint=fingerprint('concept-approval',{copy:copyFingerprint,concept:conceptHash,visual});
 const creative=assets.map(({id,sha256})=>({id,sha256})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const assetsFingerprint=fingerprint('assets-approval',{concept:conceptFingerprint,assets:creative});
 const result={inputs:fingerprintStage({...context,stage:'inputs',inputs:{carousel,concept:conceptHash,assets:creative,planRef}}),
  'copy-approval':copyFingerprint,'concept-approval':conceptFingerprint,'assets-approval':assetsFingerprint};
 if(planRef!==null){
  exactKeys(planRef,['id','kind','version','sha256']);validateIdentifier(planRef.id);
  if(planRef.kind!=='composition-plan'||!hash(planRef.sha256)||!Number.isSafeInteger(planRef.version)||planRef.version<1)throw invalidArgument('Referência de plano inválida.');
  result['preview-render']=fingerprintStage({...context,stage:'preview-render',inputs:{assetsFingerprint:result['assets-approval'],planHash:planRef.sha256,qualificationRefs,selection,riskInventory,fontBindings,fonts,renderer}});
 }
 return result;
}
