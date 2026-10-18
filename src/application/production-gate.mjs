import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {measureCompositionPlan} from '../render/composed-carousel.mjs';
import {canonicalHash,canonicalJson} from '../domain/canonical-json.mjs';
import {exactKeys} from '../domain/brand-schema.mjs';
import {validateIdentifier} from '../domain/identifiers.mjs';
import {getRunContract} from '../domain/run-snapshot.mjs';
import {validateCompositionPlan} from '../domain/composition-plan.mjs';
import {buildInputFingerprints,fingerprintStage} from '../domain/artifact-fingerprints.mjs';
import {validateRenderManifest,validateQualityReview,verifyQualityEvidence} from '../domain/quality-evidence.mjs';
import {qualityPhaseRequirements,reviewStage,verifyQualityReviewProvenance} from '../domain/quality-policy.mjs';
import {PublicError,invalidArgument} from '../domain/errors.mjs';
import {createConfinedRoot} from '../infrastructure/fs/confined-path.mjs';
import {verifySchema,assertQualityContractActive} from '../infrastructure/sqlite/migrations.mjs';
import {DEFAULT_PACKAGE_ROOT,resolveResources,sha256} from '../infrastructure/resources.mjs';
import {loadQualifiedQualityResources} from './quality-resources.mjs';
import {createRunInputs} from './run-inputs.mjs';
import {createApprovals} from './approvals.mjs';
import {evaluateRenderedQuality} from '../quality/objective-checks.mjs';
const fail=(code,message)=>{throw new PublicError(code,message);};
const stale=()=>fail('QUALITY_EVIDENCE_STALE','Evidência não corresponde ao estado, bytes e tentativa atuais.');
const equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
const ref=row=>({id:row.id,kind:row.kind,version:row.version,sha256:row.hash});
const clone=v=>JSON.parse(canonicalJson(v));
const sortId=v=>[...v].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
const fullSelection=plan=>({slideIndices:plan.slides.map(s=>s.slideIndex),seamPairs:[...new Map(plan.continuities.map(c=>[c.from,{from:c.from,to:c.to}])).values()].sort((a,b)=>a.from-b.from),policyId:'all-slides@1'});
const coverage=manifest=>({files:sortId(manifest.files.map(f=>({id:f.artifactRef.id,...f}))).map(f=>({artifactId:f.artifactRef.id,sha256:f.artifactRef.sha256,rgbaSha256:f.rgbaSha256,viewedFull:true,viewedMobile:true})),slides:manifest.selection.slideIndices,seams:manifest.selection.seamPairs,panorama:manifest.files.find(f=>f.role==='panorama')?.artifactRef.id??null,fullResolution:true,mobileWidth:360});
export function qualityValidationStageFingerprint(ctx){return fingerprintStage({contractVersion:2,...ctx.scope,snapshotHash:ctx.run.snapshot_hash,executable:ctx.saved.executable,stage:'validate',inputs:{manifestRef:ctx.manifestRef,renderAttemptId:ctx.manifest.renderAttemptId,files:ctx.manifest.files,metricsRef:ctx.manifest.metricsRef,checkerRefs:ctx.snapshot.qualityPolicy.checkerRefs,qualificationRefs:ctx.manifest.qualifications}});}
export function qualityReviewStageFingerprint(ctx,manifest,manifestRef,objectiveReportRef){return fingerprintStage({contractVersion:2,...ctx.scope,snapshotHash:ctx.run.snapshot_hash,executable:ctx.saved.executable,stage:reviewStage(manifest.kind),inputs:manifest.kind==='preview'?{manifestRef,renderAttemptId:manifest.renderAttemptId,files:manifest.files,metricsRef:manifest.metricsRef,objectiveReportRef,rubricRef:ctx.snapshot.qualityPolicy.rubricRef,checkerRefs:ctx.snapshot.qualityPolicy.checkerRefs}:{manifestRef,objectiveReportRef,rubricRef:ctx.snapshot.qualityPolicy.rubricRef,checkerRefs:ctx.snapshot.qualityPolicy.checkerRefs,coverage:coverage(manifest)}});}
/** Read-only phase gate. Caller JSON never supplies trusted reviews, resources,
 * callbacks, approval flags or file paths. All authority is resolved in scope. */
export async function createProductionGate({root,db,packageRoot=DEFAULT_PACKAGE_ROOT}){
 const guard=await createConfinedRoot(root),packageGuard=await createConfinedRoot(packageRoot),inputs=await createRunInputs({root,db,packageRoot}),consents=await createApprovals({root,db,packageRoot});
 function capture(scope){return {run:db.prepare('SELECT * FROM runs WHERE brand_id=? AND id=?').get(scope.brandId,scope.runId)??null,brand:db.prepare('SELECT status FROM brands WHERE id=?').get(scope.brandId)??null,settings:db.prepare('SELECT * FROM workspace_settings WHERE singleton=1').get()??null,...Object.fromEntries(['steps','step_attempts','artifacts','approvals','confirmation_requests','operations'].map(table=>[table,db.prepare(`SELECT * FROM ${table} WHERE brand_id=? AND run_id=? ORDER BY ${table==='operations'?'request_id':'id'}`).all(scope.brandId,scope.runId)])),assets:db.prepare('SELECT * FROM assets WHERE brand_id=? ORDER BY id').all(scope.brandId)};}
 function unchanged(ctx){if(!equal(capture(ctx.scope),ctx.stored))stale();}
 async function readRef(ctx,reference,json=true){
  const row=ctx.stored.artifacts.find(a=>a.id===reference?.id);if(!row||!equal(ref(row),reference))stale();
  const bytes=await guard.withPaths([row.relative_path],async p=>{try{return await readFile(p);}catch(e){if(e.code==='ENOENT')fail('RESOURCE_MISSING','Artefato de qualidade indisponível.');throw e;}});
  if(sha256(bytes)!==row.hash||bytes.length!==JSON.parse(row.metadata_json).size)fail('ARTIFACT_HASH_MISMATCH','Artefato diverge de seus bytes registrados.');
  if(!json)return bytes;try{return JSON.parse(bytes.toString('utf8'));}catch{stale();}
 }
 const latest=(ctx,kind)=>ctx.stored.artifacts.filter(a=>a.kind===kind).sort((a,b)=>b.version-a.version)[0];
 const step=(ctx,key)=>ctx.stored.steps.find(s=>s.step_key===key);
 function succeeded(ctx,key,fingerprint){const row=step(ctx,key);if(row?.status!=='succeeded'||fingerprint!==undefined&&row.fingerprint!==fingerprint)fail(key==='preview-approval'?'PREVIEW_APPROVAL_REQUIRED':key.includes('review')?'EDITORIAL_REVIEW_REQUIRED':'QUALITY_EVIDENCE_INCOMPLETE','Antecedente de produção ausente ou inválido.');return row;}
 function attempt(ctx,key,resultId){const stage=step(ctx,key),a=ctx.stored.step_attempts.filter(a=>a.step_id===stage?.id).sort((a,b)=>b.attempt_number-a.attempt_number)[0];if(a?.status!=='succeeded'||a.result_artifact_id!==resultId)stale();return a;}
 async function base(scope){
  validateIdentifier(scope.brandId);validateIdentifier(scope.runId);verifySchema(db);const stored=capture(scope),run=stored.run;if(!run)fail('RUN_NOT_FOUND','Execução não encontrada.');
  if(run.status==='cancelled')fail('RUN_CANCELLED','Execução cancelada.');
  const snapshot=JSON.parse(run.snapshot_json);if(canonicalHash(snapshot)!==run.snapshot_hash)fail('SNAPSHOT_HASH_MISMATCH','Snapshot divergente.');
  if(getRunContract(snapshot).contractVersion!==2)fail('RUN_DERIVATION_REQUIRED','Execução histórica exige derivação.');assertQualityContractActive(db);
  if(stored.brand?.status!=='active')fail('BRAND_ARCHIVED','Marca arquivada.');
  const saved=await inputs.get(scope.brandId,scope.runId);if(!saved?.inputsComplete)fail('INPUTS_REQUIRED','Entradas completas são necessárias.');
  const ctx={scope,stored,run,snapshot,saved},carousel=await readRef(ctx,saved.artifacts.carousel),plan=await readRef(ctx,saved.artifacts.plan);ctx.carousel=carousel;ctx.plan=plan;
  const resource=await loadQualifiedQualityResources({packageRoot,snapshot});ctx.resource=resource;
  const executable={package:JSON.parse(await packageGuard.withPaths(['package.json'],p=>readFile(p,'utf8'))),node:process.version,files:{}};executable.package={name:executable.package.name,version:executable.package.version};
  for(const file of resource.manifest.requiredFiles.filter(f=>/\.(?:m?js|json|sql)$/.test(f)))executable.files[file]=sha256(await packageGuard.withPaths([file],p=>readFile(p)));
  if(!equal(executable,saved.executable))fail('RUNTIME_MISMATCH','Executável mudou desde as entradas.');
  const qualifications=sortId([...new Map(plan.slides.map(s=>[s.qualificationRef.id,s.qualificationRef])).values()]);
  const fp=buildInputFingerprints({contractVersion:2,...scope,snapshotHash:run.snapshot_hash,executable,carousel,conceptHash:saved.artifacts.concept.sha256,assets:saved.artifacts.assets.map(a=>({id:a.assetKey,sha256:a.sha256})),planRef:saved.artifacts.plan,qualificationRefs:qualifications,selection:plan.previewSelection,riskInventory:plan.riskInventory,fontBindings:snapshot.fontBindings,fonts:snapshot.fonts,renderer:snapshot.renderer});
  if(!equal(fp,saved.fingerprints))stale();ctx.fingerprints=fp;succeeded(ctx,'inputs',fp.inputs);
  const assets=[];for(const item of saved.artifacts.assets){const {assetKey,...artifactRef}=item,row=stored.artifacts.find(a=>a.id===item.id);assets.push({descriptor:{...scope,assetKey,artifactRef,metadata:JSON.parse(row.metadata_json).composition??null},bytes:await readRef(ctx,artifactRef,false)});}
  validateCompositionPlan({plan,carousel,assets:assets.map(a=>a.descriptor),qualifications:resource.qualifications});ctx.assets=assets;
  ctx.copy=await consents.verify({...scope,kind:'copy'});ctx.concept=await consents.verify({...scope,kind:'concept'});
  if(saved.creativeAssets==='not-applicable'){
   succeeded(ctx,'assets-approval',fp['assets-approval']);if(carousel.assets.length||assets.length)stale();
   const operation=stored.operations.find(o=>{if(o.operation!=='run.approval.request')return false;try{const r=JSON.parse(o.result_json);return r.status==='not-applicable'&&r.kind==='creative-assets'&&r.brandId===scope.brandId&&r.runId===scope.runId&&r.objectFingerprint===fp['assets-approval']&&o.payload_hash===canonicalHash({operation:'run.approval.request',...scope,payload:{kind:'creative-assets'}});}catch{return false;}});if(!operation)fail('APPROVAL_REQUIRED','Ausência de assets exige evidência tipada.');ctx.assetsApproval=null;
  }else ctx.assetsApproval=await consents.verify({...scope,kind:'creative-assets'});
  const fontRoot=stored.settings?.authorized_font_directory,ids=[...new Set(plan.slides.flatMap(s=>resource.qualifications.find(q=>q.id===s.qualificationRef.id).definition.fontBindings.map(f=>f.fontId)))];
  const fontState=await resolveResources({fontRoot,manifest:resource.manifest,requiredFontIds:ids});if(fontState.diagnostics.length){const d=fontState.diagnostics[0];fail(d.code,d.message);}
  const fontGuard=await createConfinedRoot(fontRoot);ctx.fonts=[];for(const f of [...resource.manifest.fonts,...resource.manifest.optionalFonts].filter(f=>ids.includes(f.id))){const bytes=await fontGuard.withPaths([f.file],p=>readFile(p));if(sha256(bytes)!==f.sha256)stale();ctx.fonts.push({id:f.id,sha256:f.sha256,bytes});}
  ctx.logos=[];for(const logo of snapshot.logos){const row=stored.assets.find(a=>a.id===logo.id);if(!row||row.hash!==logo.sha256)stale();const bytes=await guard.withPaths([row.relative_path],async p=>{try{return await readFile(p);}catch(error){if(error.code==='ENOENT')fail('RESOURCE_MISSING','Logotipo gerenciado indisponível.');throw error;}});if(sha256(bytes)!==row.hash||bytes.length!==JSON.parse(row.metadata_json).size)stale();ctx.logos.push({id:logo.id,sha256:row.hash,bytes});}
  unchanged(ctx);return ctx;
 }
 async function manifest(ctx,kind,manifestId){
  const row=latest(ctx,`render-manifest:${kind}`);if(!row)fail(kind==='preview'?'PREVIEW_REQUIRED':'QUALITY_EVIDENCE_INCOMPLETE','Manifesto vigente ausente.');if(manifestId!==undefined&&row.id!==manifestId)stale();
  const manifestRef=ref(row),m=validateRenderManifest(await readRef(ctx,manifestRef)),key=kind==='preview'?'preview-render':'render';
  succeeded(ctx,key,m.stageFingerprint);const a=attempt(ctx,key,m.id),inputsRow=ctx.stored.artifacts.find(a=>a.id===ctx.saved.id);
  for(const owned of [manifestRef,m.metricsRef,...m.files.map(f=>f.artifactRef)]){const artifact=ctx.stored.artifacts.find(a=>a.id===owned.id);if(artifact?.relative_path!==`runs/${ctx.scope.brandId}/${ctx.scope.runId}/${m.renderAttemptId}/${owned.id}.bin`)stale();}
  if(m.id!==row.id||m.version!==row.version||m.kind!==kind||m.brandId!==ctx.scope.brandId||m.runId!==ctx.scope.runId||m.snapshotHash!==ctx.run.snapshot_hash||m.renderAttemptId!==a.id||!equal(m.inputsRef,ref(inputsRow))||!equal(m.planRef,ctx.saved.artifacts.plan)||!equal(m.renderer,ctx.snapshot.renderer)||!equal(m.fonts,ctx.snapshot.fonts)||m.runtimeHash!==canonicalHash(ctx.snapshot.runtime)||m.resourceManifestHash!==ctx.snapshot.resourceManifestRef.sha256||m.upstream.copyApprovalId!==ctx.copy.id||m.upstream.conceptApprovalId!==ctx.concept.id)stale();
  const selection=kind==='preview'?Object.fromEntries(['slideIndices','seamPairs','policyId'].map(k=>[k,ctx.plan.previewSelection[k]])):fullSelection(ctx.plan);
  const refs=sortId([...new Map(selection.slideIndices.map(i=>ctx.plan.slides[i-1].qualificationRef).map(q=>[q.id,q])).values()]);if(!equal(selection,m.selection)||!equal(refs,m.qualifications))stale();
  if(kind==='preview'&&m.stageFingerprint!==ctx.fingerprints['preview-render'])stale();
  const assets=await readRef(ctx,m.upstream.assetsEvidenceRef);if(assets.schemaVersion!==1||assets.brandId!==ctx.scope.brandId||assets.runId!==ctx.scope.runId||assets.assetsFingerprint!==ctx.fingerprints['assets-approval']||assets.status!==(ctx.assetsApproval?'approved':'not-applicable')||(ctx.assetsApproval&&assets.approvalId!==ctx.assetsApproval.id))stale();
  const files=[];for(const file of m.files){const bytes=await readRef(ctx,file.artifactRef,false);try{const image=sharp(bytes,{limitInputPixels:100_000_000}),meta=await image.metadata();if(meta.format!=='png'||meta.pages>1||meta.width!==file.width||meta.height!==file.height||bytes.length!==file.size||sha256(await image.ensureAlpha().raw().toBuffer())!==file.rgbaSha256)stale();}catch{stale();}files.push({id:file.artifactRef.id,bytes});}
  const metricsBytes=await readRef(ctx,m.metricsRef,false),metrics=JSON.parse(metricsBytes.toString('utf8'));files.push({id:m.metricsRef.id,bytes:metricsBytes});
  const image=f=>{const bytes=files.find(x=>x.id===f.artifactRef.id).bytes;return {png:bytes,sha256:f.artifactRef.sha256,rgbaSha256:f.rgbaSha256};};
  const composition={rendererId:m.renderer.id,selection:metrics.selection,slides:metrics.slides.map(s=>({...s,...image(m.files.find(f=>f.role==='slide'&&f.slideIndex===s.index))})),seams:m.files.filter(f=>f.role==='seam').map(f=>({pair:f.pair,...image(f)})),panorama:m.files.some(f=>f.role==='panorama')?image(m.files.find(f=>f.role==='panorama')):null,resources:{renderer:m.renderer,fonts:m.fonts,qualifications:refs},planHash:m.planRef.sha256,snapshotHash:m.snapshotHash,inputs:{carousel:ctx.carousel,plan:ctx.plan,snapshot:ctx.snapshot,fonts:ctx.fonts,assets:ctx.assets,logos:ctx.logos}};
  return {manifest:m,manifestRef,composition,files};
 }
 async function objective(ctx,target,{required=true}={}){
  const derived=await evaluateRenderedQuality({manifest:target.manifest,composition:target.composition,files:target.files,qualification:ctx.resource.qualifications});
  const rows=ctx.stored.artifacts.filter(a=>a.kind===`objective-report:${target.manifest.kind}`).sort((a,b)=>b.version-a.version);let found;
  for(const row of rows){const value=await readRef(ctx,ref(row));if(value.manifestRef?.id===target.manifest.id){if(!equal(value,derived))stale();found={objectiveReport:value,objectiveReportRef:ref(row)};break;}}
  if(required&&!found)fail('QUALITY_EVIDENCE_INCOMPLETE','Relatório objetivo vigente ausente.');
  return found??{objectiveReport:derived,objectiveReportRef:null};
 }
 const objectivePassed=value=>{if(value.result==='failed')fail('QUALITY_CHECK_FAILED','Controles objetivos reprovados.');if(value.result!=='passed')fail('QUALITY_EVIDENCE_INCOMPLETE','Controles objetivos não verificados integralmente.');};
 async function review(ctx,target,objectiveValue,previewTarget){
  const kind=target.manifest.kind,row=latest(ctx,`quality-review:${kind}`);if(!row)fail('EDITORIAL_REVIEW_REQUIRED','Parecer editorial vigente ausente.');
  const reviewRef=ref(row),r=validateQualityReview(await readRef(ctx,reviewRef));
  const proof=verifyQualityEvidence({review:r,manifest:target.manifest,objectiveReport:objectiveValue.objectiveReport,snapshot:ctx.snapshot,plan:ctx.plan,...(kind==='final'?{previewManifest:previewTarget.manifest}:{}),expected:{...ctx.scope,kind,renderAttemptId:target.manifest.renderAttemptId,manifestRef:target.manifestRef,objectiveReportRef:objectiveValue.objectiveReportRef}});
  const request=ctx.stored.confirmation_requests.find(q=>q.id===r.confirmationRequestId),operation=ctx.stored.operations.find(o=>o.operation==='run.quality-review.decide'&&JSON.parse(o.result_json)?.review?.id===r.id);
  verifyQualityReviewProvenance({review:r,reviewRef,request,operation});
  objectivePassed(objectiveValue.objectiveReport);if(r.verdict==='failed')fail('QUALITY_REVIEW_FAILED','Parecer editorial reprovado.');if(r.verdict!=='passed'||!proof.coverageComplete)fail('QUALITY_EVIDENCE_INCOMPLETE','Parecer sem cobertura integral.');
  succeeded(ctx,reviewStage(kind),qualityReviewStageFingerprint(ctx,target.manifest,target.manifestRef,objectiveValue.objectiveReportRef));return {review:r,reviewRef};
 }
 async function previewAuthorized(ctx){const target=await manifest(ctx,'preview'),o=await objective(ctx,target),r=await review(ctx,target,o);const approval=await consents.verify({...ctx.scope,kind:'preview'});if(!equal(approval.evidence.proposal.object.manifestRef,target.manifestRef)||!equal(approval.evidence.proposal.object.reviewRef,r.reviewRef))stale();return {...target,...o,...r,approval};}
 async function finalTarget(ctx,preview,manifestId){const target=await manifest(ctx,'final',manifestId),m=target.manifest,p=preview.manifest;
  if(!equal(m.upstream.previewManifestRef,preview.manifestRef)||!equal(m.upstream.previewReviewRef,preview.reviewRef)||m.upstream.previewApprovalId!==preview.approval.id||m.upstream.approvedSelectionHash!==p.selectionHash)stale();
  const fp=fingerprintStage({contractVersion:2,...ctx.scope,snapshotHash:ctx.run.snapshot_hash,executable:ctx.saved.executable,stage:'render',inputs:{assetsFingerprint:ctx.fingerprints['assets-approval'],planHash:ctx.saved.artifacts.plan.sha256,qualificationRefs:sortId([...new Map(ctx.plan.slides.map(s=>[s.qualificationRef.id,s.qualificationRef])).values()]),fontBindings:ctx.snapshot.fontBindings,fonts:ctx.snapshot.fonts,renderer:ctx.snapshot.renderer,previewApprovalRef:{id:preview.approval.id,sha256:canonicalHash(preview.approval)},selection:fullSelection(ctx.plan)}});if(m.stageFingerprint!==fp)stale();
  for(const f of p.files){const final=m.files.find(g=>g.role===f.role&&g.slideIndex===f.slideIndex&&equal(g.pair,f.pair));if(!final||final.artifactRef.id===f.artifactRef.id||final.artifactRef.sha256!==f.artifactRef.sha256||final.rgbaSha256!==f.rgbaSha256||final.size!==f.size)stale();}
  return target;
 }
 function validated(ctx,target,o){const fp=qualityValidationStageFingerprint({...ctx,...target});succeeded(ctx,'validate',fp);attempt(ctx,'validate',o.objectiveReportRef.id);objectivePassed(o.objectiveReport);}
 async function settled(ctx){const {verifySettledCorrectionHistory}=await import('./quality-corrections.mjs');return verifySettledCorrectionHistory({db,inputs,...ctx.scope,plan:ctx.plan,planRef:ctx.saved.artifacts.plan,snapshot:ctx.snapshot,packageRoot});}
 /** Trusted render preparation shares every Q05 antecedent with the phase gate.
  * Returned bytes/identities are internal service data, never client assertions. */
 async function inspectRender(input){
  const r=clone(input);exactKeys(r,['brandId','runId','kind']);reviewStage(r.kind);
  const ctx=await base({brandId:r.brandId,runId:r.runId});await settled(ctx);
  const measured=await measureCompositionPlan({carousel:ctx.carousel,snapshot:ctx.snapshot,plan:ctx.plan,resources:{fonts:ctx.fonts,assets:ctx.assets,logos:ctx.logos,qualifications:ctx.resource.qualifications}});
  if(!equal(measured.riskInventory,ctx.plan.riskInventory))fail('COMPOSITION_PREFLIGHT_STALE','Inventário de risco diverge das medidas reais do plano.');
  const preview=r.kind==='final'?await previewAuthorized(ctx):null;
  const selection=r.kind==='preview'?Object.fromEntries(['slideIndices','seamPairs','policyId'].map(k=>[k,ctx.plan.previewSelection[k]])):fullSelection(ctx.plan);
  const qualifications=sortId([...new Map(selection.slideIndices.map(i=>ctx.plan.slides[i-1].qualificationRef).map(q=>[q.id,q])).values()]);
  const stageFingerprint=r.kind==='preview'?ctx.fingerprints['preview-render']:fingerprintStage({contractVersion:2,...ctx.scope,snapshotHash:ctx.run.snapshot_hash,executable:ctx.saved.executable,stage:'render',inputs:{assetsFingerprint:ctx.fingerprints['assets-approval'],planHash:ctx.saved.artifacts.plan.sha256,qualificationRefs:qualifications,fontBindings:ctx.snapshot.fontBindings,fonts:ctx.snapshot.fonts,renderer:ctx.snapshot.renderer,previewApprovalRef:{id:preview.approval.id,sha256:canonicalHash(preview.approval)},selection}});
  unchanged(ctx);return {...ctx,kind:r.kind,preview,selection,qualifications,stageFingerprint,inputsRef:ref(ctx.stored.artifacts.find(a=>a.id===ctx.saved.id))};
 }
 /** Current byte-verified render for T21. Does not require or manufacture the
  * validation/review output it is being used to create. */
 async function inspectRendered(input){
  const r=clone(input);exactKeys(r,['brandId','runId','kind','manifestId']);reviewStage(r.kind);validateIdentifier(r.manifestId);
  const ctx=await base({brandId:r.brandId,runId:r.runId});await settled(ctx);
  const preview=r.kind==='final'?await previewAuthorized(ctx):null;
  const target=r.kind==='preview'?await manifest(ctx,r.kind,r.manifestId):await finalTarget(ctx,preview,r.manifestId);
  unchanged(ctx);return {...ctx,...target,preview};
 }
 async function inspectReview(input){const r=clone(input);exactKeys(r,['brandId','runId','kind','manifestId']);reviewStage(r.kind);validateIdentifier(r.manifestId);const ctx=await base({brandId:r.brandId,runId:r.runId});await settled(ctx);let preview=null,target;
  if(r.kind==='preview')target=await manifest(ctx,'preview',r.manifestId);else{preview=await previewAuthorized(ctx);target=await finalTarget(ctx,preview,r.manifestId);}
  const o=await objective(ctx,target,{required:r.kind==='final'});if(r.kind==='final')validated(ctx,target,o);objectivePassed(o.objectiveReport);unchanged(ctx);return {...ctx,...target,...o,preview};
 }
 async function inspectCorrectionDefect(input){
  const r=clone(input);exactKeys(r,['brandId','runId','defectRef','planRef']);const ctx=await base({brandId:r.brandId,runId:r.runId});if(!equal(ctx.saved.artifacts.plan,r.planRef))stale();
  const value=await readRef(ctx,r.defectRef),kind=r.defectRef.kind.split(':')[1];if(!['preview','final'].includes(kind)||!['objective-report','quality-review'].includes(r.defectRef.kind.split(':')[0]))stale();
  let preview=null,target;if(kind==='preview')target=await manifest(ctx,kind,value.manifestRef?.id);else{preview=await previewAuthorized(ctx);target=await finalTarget(ctx,preview,value.manifestRef?.id);}
  const o=await objective(ctx,target);
  if(r.defectRef.kind.startsWith('objective-report:')){if(!equal(o.objectiveReportRef,r.defectRef)||o.objectiveReport.result!=='failed')stale();}
  else{const reviewRecord=validateQualityReview(value),row=latest(ctx,`quality-review:${kind}`);if(!row||row.id!==r.defectRef.id||reviewRecord.verdict!=='failed')stale();
   verifyQualityReviewProvenance({review:reviewRecord,reviewRef:r.defectRef,request:ctx.stored.confirmation_requests.find(q=>q.id===reviewRecord.confirmationRequestId),operation:ctx.stored.operations.find(o=>o.operation==='run.quality-review.decide'&&JSON.parse(o.result_json).review?.id===reviewRecord.id)});
   verifyQualityEvidence({review:reviewRecord,manifest:target.manifest,objectiveReport:o.objectiveReport,snapshot:ctx.snapshot,plan:ctx.plan,...(kind==='final'?{previewManifest:preview.manifest}:{}),expected:{...ctx.scope,kind,renderAttemptId:target.manifest.renderAttemptId,manifestRef:target.manifestRef,objectiveReportRef:o.objectiveReportRef}});
   const stage=step(ctx,reviewStage(kind));if(stage?.status!=='failed'||stage.fingerprint!==qualityReviewStageFingerprint(ctx,target.manifest,target.manifestRef,o.objectiveReportRef))stale();
  }
  unchanged(ctx);return {defectRef:r.defectRef,planRef:r.planRef,manifestRef:target.manifestRef};
 }
 async function assertProductionGate(input){const r=clone(input);exactKeys(r,['brandId','runId','phase'],['kind','manifestId']);qualityPhaseRequirements(r);const ctx=await base({brandId:r.brandId,runId:r.runId});await settled(ctx);let preview=null,final=null,o=null,q=null;
  if(r.phase==='preview'){unchanged(ctx);return {phase:r.phase,inputsRef:ref(ctx.stored.artifacts.find(a=>a.id===ctx.saved.id)),planRef:ctx.saved.artifacts.plan};}
  if(r.phase==='review'&&r.kind==='preview'){const view=await inspectReview({brandId:r.brandId,runId:r.runId,kind:'preview',manifestId:r.manifestId??latest(ctx,'render-manifest:preview')?.id});return {phase:r.phase,kind:r.kind,manifestRef:view.manifestRef,objectiveReportRef:view.objectiveReportRef};}
  preview=await previewAuthorized(ctx);
  if(r.phase!=='render'){final=await finalTarget(ctx,preview,r.manifestId);if(r.phase!=='validate'){o=await objective(ctx,final);validated(ctx,final,o);if(r.phase!=='review')q=await review(ctx,final,o,preview);}}
  if(r.phase==='complete')fail('PACKAGE_VERIFICATION_UNAVAILABLE','Conclusão exige verificador de ZIP e commit com fencing da etapa de pacote.');
  unchanged(ctx);return {phase:r.phase,...(r.kind?{kind:r.kind}:{}),previewManifestRef:preview.manifestRef,previewReviewRef:preview.reviewRef,previewApprovalId:preview.approval.id,...(final?{manifestRef:final.manifestRef}:{}),...(o?{objectiveReportRef:o.objectiveReportRef}:{}),...(q?{reviewRef:q.reviewRef}:{})};
 }
 return Object.freeze({assertProductionGate,inspectRender,inspectRendered,inspectReview,inspectCorrectionDefect,capture,unchanged,readRef});
}
export async function assertProductionGate({root,db,packageRoot,...request}){return (await createProductionGate({root,db,packageRoot})).assertProductionGate(request);}
