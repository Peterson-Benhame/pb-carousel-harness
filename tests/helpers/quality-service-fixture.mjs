import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {canonicalHash,canonicalJson} from '../../src/domain/canonical-json.mjs';
import {qualitySnapshotFixture} from '../fixtures/quality/snapshot-fixture.mjs';
import {qualificationRendererHash} from '../../src/domain/quality-policy.mjs';
import {dependencyNames,probeDependency,sha256,DEFAULT_PACKAGE_ROOT} from '../../src/infrastructure/resources.mjs';
import {syntheticLogo,logoConfig} from './logo-slot-fixture.mjs';
import {buildRunSnapshot} from '../../src/domain/run-snapshot.mjs';
/** Deliberately synthetic installed catalog for service integration tests. It is
 * never written into shared/, packaged or described as human qualification. */
export async function makeQualityPackage(t,{decorate=false,logo=false}={}){
 await mkdir(path.join(DEFAULT_PACKAGE_ROOT,'output'),{recursive:true});
 const packageRoot=await mkdtemp(path.join(DEFAULT_PACKAGE_ROOT,'output/q05-package '));t.after(()=>rm(packageRoot,{recursive:true,force:true}));
 const manifest=JSON.parse(await readFile(path.join(DEFAULT_PACKAGE_ROOT,'shared/resources.manifest.json'),'utf8'));
 for(const file of new Set([...manifest.requiredFiles,...manifest.renderers.flatMap(r=>r.files)])){const destination=path.join(packageRoot,file);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,await readFile(path.join(DEFAULT_PACKAGE_ROOT,file)));}
 for(const file of ['src/infrastructure/sqlite/migrations/003-slide-generation-ledger.sql']){const destination=path.join(packageRoot,file);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,await readFile(path.join(DEFAULT_PACKAGE_ROOT,file)));}
 for(const renderer of manifest.renderers)for(const file of renderer.files)renderer.hashes[file]=sha256(await readFile(path.join(packageRoot,file)));
 const renderer=manifest.renderers.find(r=>r.id==='editorial-composed@1');renderer.status='qualified';
 const packageVersion=JSON.parse(await readFile(path.join(DEFAULT_PACKAGE_ROOT,'package.json'),'utf8')).version;
 const runtime={package:{name:'@pb/carousel-harness',version:packageVersion},node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules,napi:process.versions.napi,renderer:{id:renderer.id,files:{...renderer.hashes}},dependencies:Object.fromEntries(await Promise.all(dependencyNames.map(async id=>[id,await probeDependency(id)]))),fonts:manifest.fonts.map(({id,sha256})=>({id,sha256}))};
 const data=await qualitySnapshotFixture({runtime,manifest});
 const rubricRef={id:'editorial-quality@1',version:1,sha256:sha256(await readFile(path.join(packageRoot,'src/quality/review-rubric.mjs')))},checkerRefs=[{id:'editorial-objective-checkers@1',version:1,sha256:sha256(await readFile(path.join(packageRoot,'src/quality/objective-checks.mjs')))}];
 const samplePolicyRef={id:'representative-risk@1',version:1,sha256:sha256(await readFile(path.join(packageRoot,'src/domain/composition-plan.mjs')))};
 const qualityPolicy={...data.input.qualityPolicy,samplePolicyRef,rubricRef,checkerRefs};delete qualityPolicy.sha256;qualityPolicy.sha256=canonicalHash(qualityPolicy);
 const evidence=[];
 for(const q of data.qualifications){
  q.definition.checkerRef=checkerRefs[0];q.definition.rubricRef=rubricRef;
  if(decorate){q.definition.regions.push({id:'safe-decoration',x:1032,y:500,width:6,height:24,kind:'decoration',readingOrder:Math.max(...q.definition.regions.map(r=>r.readingOrder))+1});q.definition.continuity.anchors.push({id:'safe-anchor',regionId:'safe-decoration',x:0,y:0});q.definition.decorationOptions=[{id:'base',elementId:'safe-decoration',anchorId:'safe-anchor',offsetX:0,offsetY:0,visible:true},{id:'move',elementId:'safe-decoration',anchorId:'safe-anchor',offsetX:12,offsetY:12,visible:true},{id:'remove',elementId:'safe-decoration',anchorId:'safe-anchor',offsetX:12,offsetY:12,visible:false}];}
  q.definitionHash=canonicalHash(q.definition);
  q.evidenceRefs=['qualification-fixture','qualification-metrics','qualification-review'].map(kind=>{const value={schemaVersion:1,id:`${kind}-${q.definition.layoutId}`,version:1,kind,definitionHash:q.definitionHash,rendererHash:qualificationRendererHash(runtime.renderer),environment:{platform:runtime.platform,arch:runtime.arch,node:runtime.node,abi:runtime.abi,napi:runtime.napi,dependenciesHash:canonicalHash(runtime.dependencies),rendererHash:qualificationRendererHash(runtime.renderer),fontBindingsHash:canonicalHash(q.definition.fontBindings)},synthetic:true};const ref={id:value.id,version:1,sha256:canonicalHash(value),kind};evidence.push({ref,data:value});return ref;}).sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:1);
  q.release.reviewEvidenceRef=q.evidenceRefs.find(e=>e.kind==='qualification-review');
  q.release.qualifiedEnvironments=[{platform:runtime.platform,arch:runtime.arch,node:runtime.node,abi:runtime.abi,napi:runtime.napi,dependenciesHash:canonicalHash(runtime.dependencies),rendererHash:qualificationRendererHash(runtime.renderer),fontBindingsHash:canonicalHash(q.definition.fontBindings)}];
 }
 const catalog={schemaVersion:1,id:'editorial-composed-v1',rendererId:renderer.id,qualifications:data.qualifications,evidence};
 const file='shared/layouts/editorial-composed-v1.json';await writeFile(path.join(packageRoot,file),canonicalJson(catalog));renderer.hashes[file]=sha256(await readFile(path.join(packageRoot,file)));runtime.renderer={id:renderer.id,files:{...renderer.hashes}};
 await writeFile(path.join(packageRoot,'shared/resources.manifest.json'),JSON.stringify(manifest,null,2));
 const config={...data.input.brand.config,configVersion:2};
 for(const theme of Object.values(config.themes))theme.surfaceBindings={light:{background:'background',text:'text',muted:'muted',accent:'accent'}};
 const logoData=logo?await Promise.all((logo==='dark-only'?['dark']:['light','dark']).map(syntheticLogo)):[];if(logo)config.logo=logoConfig(logo==='dark-only'?{variants:{dark:logoData[0].id}}:{});
 const input={...data.input,...(logo?{logos:logoData.map(({id,sha256},i)=>({id,sha256,surface:logo==='dark-only'?'dark':['light','dark'][i]}))}:{}),brand:{...data.input.brand,config,hash:canonicalHash(config)},runtime,qualityPolicy,qualifications:data.qualifications,resourceManifestRef:{id:'resources-manifest@2',version:2,sha256:canonicalHash(manifest)},resourceState:{renderPrerequisites:true,blockers:[]}};
 const snapshot=buildRunSnapshot(input);
 return {packageRoot,manifest,qualifications:data.qualifications,runtime,qualityPolicy,input,snapshot,logoData};
}

import assert from 'node:assert/strict';
import {initializeWorkspace} from '../../src/infrastructure/sqlite/database.mjs';
import {createRunInputs} from '../../src/application/run-inputs.mjs';
import {createApprovals} from '../../src/application/approvals.mjs';
import {confirmApprovalProposal,confirmQualityReviewProposal} from '../../src/interfaces/cli/human-confirmation.mjs';
import {compositionFixture,addDiagram} from '../fixtures/quality/composition-fixture.mjs';
import {fontRoot} from './legacy-render-fixture.mjs';
import {composeCarousel} from '../../src/render/composed-carousel.mjs';
import {derivePreviewSelection} from '../../src/domain/composition-plan.mjs';
import {fingerprintStage} from '../../src/domain/artifact-fingerprints.mjs';
import {evaluateRenderedQuality} from '../../src/quality/objective-checks.mjs';
import {createQualityReview} from '../../src/application/quality-review.mjs';
import {createProductionGate} from '../../src/application/production-gate.mjs';
export function syntheticTerminal(answer='CONFIRMAR'){let shown='';return {input:{isTTY:true},output:{isTTY:true,write(value){shown+=value;}},argv:[],ask:async()=>answer,get shown(){return shown;}};}
export async function syntheticReview(pending,{result='ATENDE',beforeConfirm,gateway=confirmQualityReviewProposal}={}){
 const io=syntheticTerminal();io.ask=async prompt=>{
  if(prompt.includes('código')){const url=io.shown.match(/http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\//)[0],page=await fetch(url).then(r=>r.text()),data=JSON.parse(page.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);let code;
   for(const [index,screen]of data.screens.entries()){const image=await fetch(new URL(screen.url,url));assert.equal(image.status,200);assert.equal(sha256(Buffer.from(await image.arrayBuffer())),screen.sha256);const response=await fetch(new URL('attest',url),{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(url).origin},body:JSON.stringify({screen:index})});assert.equal(response.status,200);code=(await response.json()).code??code;}return code;}
  if(prompt.includes('Resultado'))return result;
  if(prompt.includes('Observação'))return 'Synthetic transport test; no real human qualification.';
  if(prompt.includes('CONFIRMAR')){await beforeConfirm?.();return 'CONFIRMAR';}
  throw Error(`Unexpected gateway prompt: ${prompt}`);
 };
 return gateway(pending.proposal,{...io,presentation:pending.presentation});
}
export async function qualityServiceFixture(t,{approve=true,render=true,hooks={},decorate=false,logo=false,editCarousel,creative=false,count=3,measure=true,previewAll=false}={}){
 const pkg=await makeQualityPackage(t,{decorate,logo}),root=await mkdtemp(path.join(os.tmpdir(),'q05-workspace ')),db=await initializeWorkspace(root,{schemaVersion:2});t.after(async()=>{if(db.open)db.close();await rm(root,{recursive:true,force:true});});
 const from=async file=>import(pathToFileURL(path.join(pkg.packageRoot,file)).href);
 const {createRunInputs}=await from('src/application/run-inputs.mjs'),{createApprovals}=await from('src/application/approvals.mjs'),{createQualityReview}=await from('src/application/quality-review.mjs'),{createProductionGate}=await from('src/application/production-gate.mjs'),{composeCarousel,measureCompositionPlan}=await from('src/render/composed-carousel.mjs'),localGateway=await from('src/interfaces/cli/human-confirmation.mjs');
 const snapshot=pkg.snapshot,brandId=snapshot.brand.id,runId=randomUUID(),scope={brandId,runId};
 db.prepare('INSERT INTO brands(id) VALUES(?)').run(brandId);db.prepare("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES(?,1,?,?,'user-confirmed')").run(brandId,canonicalJson(snapshot.brand.config),snapshot.brand.revisionHash);db.prepare('UPDATE brands SET current_revision=1 WHERE id=?').run(brandId);db.prepare('INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES(?,?,1,?,?)').run(runId,brandId,canonicalJson(snapshot),canonicalHash(snapshot));db.prepare('INSERT INTO workspace_settings(singleton,revision,resources_json,authorized_font_directory) VALUES(1,1,?,?)').run('{}',fontRoot);
 for(const value of pkg.logoData){const relative=`blobs/${brandId}/${value.sha256}/${value.id}.bin`;await mkdir(path.dirname(path.join(root,relative)),{recursive:true});await writeFile(path.join(root,relative),value.bytes,{flag:'wx'});db.prepare('INSERT INTO assets(id,brand_id,hash,relative_path,kind,width,height,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(value.id,brandId,value.sha256,relative,'logo',320,100,canonicalJson({size:value.bytes.length}));}
 const inputs=await createRunInputs({root,db,packageRoot:pkg.packageRoot,qualifications:pkg.qualifications}),data=await compositionFixture(count);
 if(editCarousel){editCarousel(data.carousel);for(const slide of data.plan.slides)for(const block of slide.blocks){block.source.end=data.carousel.slides[slide.slideIndex-1][block.source.field].length;block.spans[0].end=block.source.end;}}
 async function source(name,bytes){const sourcePath=path.join(root,name);await writeFile(sourcePath,bytes);return {sourcePath,sha256:sha256(bytes)};}
 const creativeBytes=creative?(await import('./logo-slot-fixture.mjs')).png({width:800,height:400,ink:{x:20,y:20,width:760,height:360}}):null;
 if(creative)addDiagram(data,2);
 const creativeInput=creative?[{id:data.assets[0].assetKey,...await source('source-creative.png',await creativeBytes),metadata:data.assets[0].metadata}]:[];
 const saved=await inputs.save({requestId:randomUUID(),...scope,expectedVersion:1,assets:creativeInput,carousel:await source('source-carousel.json',canonicalJson(data.carousel)),concept:await source('source-concept.md','Synthetic quality review concept')});
 const plan={...data.plan,id:randomUUID(),...scope,snapshotHash:canonicalHash(snapshot),carouselRef:saved.artifacts.carousel,conceptRef:saved.artifacts.concept,copyFingerprint:saved.fingerprints['copy-approval'],assets:saved.artifacts.assets};for(const slide of plan.slides){const q=pkg.qualifications.find(q=>q.definition.layoutId===slide.layoutId);slide.qualificationRef={id:q.id,version:q.version,sha256:canonicalHash(q),definitionHash:q.definitionHash};if(decorate)slide.decorationChoices=[{elementId:'safe-decoration',optionId:'base'}];}
 const fonts=await Promise.all(snapshot.fonts.map(async f=>({...f,bytes:await readFile(path.join(fontRoot,pkg.manifest.fonts.find(x=>x.id===f.id).file))})));
 const assetData=creative?saved.artifacts.assets.map(({assetKey,...artifactRef})=>({descriptor:{...scope,assetKey,artifactRef,metadata:data.assets[0].metadata},bytes:creativeBytes})):[];
 if(creative)for(const asset of assetData)asset.bytes=await asset.bytes;
 const renderResources={fonts,qualifications:pkg.qualifications,assets:assetData,logos:pkg.logoData};
 if(creative)plan.previewSelection=derivePreviewSelection(plan);
 if(measure){const measured=await measureCompositionPlan({carousel:data.carousel,snapshot,plan,resources:renderResources});plan.riskInventory=measured.riskInventory;plan.previewSelection=derivePreviewSelection(plan);}
 if(previewAll){const reasons=new Map(plan.previewSelection.reasons.map(entry=>[entry.slideIndex,entry]));for(let index=1;index<=data.carousel.slides.length;index++)if(!reasons.has(index))reasons.set(index,{slideIndex:index,codes:[]});const slideIndices=[...reasons.keys()].sort((a,b)=>a-b);plan.previewSelection={...plan.previewSelection,slideIndices,reasons:slideIndices.map(index=>reasons.get(index))};}
 const ready=await inputs.savePlan({requestId:randomUUID(),...scope,expectedVersion:saved.runVersion,plan});
 const approvals=await createApprovals({root,db,packageRoot:pkg.packageRoot});
 async function grant(kind){const pending=await approvals.request({requestId:randomUUID(),...scope,kind});if(pending.status==='not-applicable')return pending;return approvals.decide({requestId:randomUUID(),proposal:pending.proposal,decision:'approved'},await localGateway.confirmApprovalProposal(pending.proposal,syntheticTerminal()));}
 let copy,concept;if(approve){copy=await grant('copy');concept=await grant('concept');await grant('creative-assets');}
 async function persist(kind,value,version=1,id=value?.id??randomUUID(),allocation=randomUUID()){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(canonicalJson(value)),relative=`runs/${brandId}/${runId}/${allocation}/${id}.bin`;await mkdir(path.dirname(path.join(root,relative)),{recursive:true});await writeFile(path.join(root,relative),bytes,{flag:'wx'});const reference={id,kind,version,sha256:sha256(bytes)};db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(id,brandId,runId,kind,version,reference.sha256,relative,canonicalJson({size:bytes.length}));return reference;
 }

 let assetsEvidenceRef,preview;
 function step(key,fingerprint){const id=randomUUID();db.prepare("INSERT INTO steps(id,brand_id,run_id,step_key,status,fingerprint) VALUES(?,?,?,?,'succeeded',?) ON CONFLICT(brand_id,run_id,step_key) DO UPDATE SET status='succeeded',fingerprint=excluded.fingerprint").run(id,brandId,runId,key,fingerprint);return db.prepare('SELECT id FROM steps WHERE run_id=? AND step_key=?').get(runId,key).id;}
 async function makeRender(kind='preview'){
  if(!assetsEvidenceRef)assetsEvidenceRef=await persist('no-assets-evidence',{schemaVersion:1,...scope,status:'not-applicable',assetsFingerprint:ready.fingerprints['assets-approval']});
  const previewApproval=kind==='final'?await approvals.verify({...scope,kind:'preview'}):null;
  const result=await composeCarousel({carousel:data.carousel,snapshot,plan,resources:renderResources,selection:kind==='preview'?{slideIndices:plan.previewSelection.slideIndices,seamPairs:plan.previewSelection.seamPairs}:'all'}),attemptId=randomUUID(),files=[];
  async function image(value,role,slideIndex=null,pair=null){const type=role==='slide'?`render-slide:${kind}:${slideIndex}`:role==='seam'?`render-seam:${kind}:${pair.from}-${pair.to}`:'render-panorama:final',artifactRef=await persist(type,value.png,1,randomUUID(),attemptId);files.push({artifactRef,role,slideIndex,pair,mediaType:'image/png',width:role==='slide'?1080:role==='seam'?2160:1080*plan.slides.length,height:1350,size:value.png.length,rgbaSha256:value.rgbaSha256});}
  for(const slide of result.slides)await image(slide,'slide',slide.index);for(const seam of result.seams)await image(seam,'seam',null,seam.pair);if(kind==='final')await image(result.panorama,'panorama');
  const metrics={schemaVersion:1,selection:result.selection,slides:result.slides.map(({index,scene,metrics})=>({index,scene,metrics}))},metricsRef=await persist(`composition-metrics:${kind}`,metrics,1,randomUUID(),attemptId),selection={slideIndices:result.selection.slideIndices,seamPairs:result.selection.seamPairs,policyId:kind==='preview'?'representative-risk@1':'all-slides@1'},qualificationRefs=[...new Map(plan.slides.filter(s=>selection.slideIndices.includes(s.slideIndex)).map(s=>[s.qualificationRef.id,s.qualificationRef])).values()].sort((a,b)=>a.id<b.id?-1:1);
  const stageFingerprint=kind==='preview'?ready.fingerprints['preview-render']:fingerprintStage({contractVersion:2,...scope,snapshotHash:canonicalHash(snapshot),executable:ready.executable,stage:'render',inputs:{assetsFingerprint:ready.fingerprints['assets-approval'],planHash:ready.artifacts.plan.sha256,qualificationRefs,fontBindings:snapshot.fontBindings,fonts:snapshot.fonts,renderer:snapshot.renderer,previewApprovalRef:{id:previewApproval.id,sha256:canonicalHash(previewApproval)},selection}});
  const manifest={schemaVersion:2,id:randomUUID(),...scope,version:1,kind,renderAttemptId:attemptId,stageFingerprint,snapshotHash:canonicalHash(snapshot),inputsRef:{id:ready.id,kind:'inputs',version:ready.version,sha256:canonicalHash(ready)},planRef:ready.artifacts.plan,selection,selectionHash:canonicalHash(selection),renderer:snapshot.renderer,runtimeHash:canonicalHash(snapshot.runtime),resourceManifestHash:snapshot.resourceManifestRef.sha256,qualifications:qualificationRefs,fonts:snapshot.fonts,upstream:{copyApprovalId:copy.id,conceptApprovalId:concept.id,assetsEvidenceRef,...(kind==='final'?{previewManifestRef:preview.manifestRef,previewReviewRef:previewApproval.evidence.proposal.object.reviewRef,previewApprovalId:previewApproval.id,approvedSelectionHash:preview.manifest.selectionHash}:{})},files,metricsRef,createdAt:new Date().toISOString()},manifestRef=await persist(`render-manifest:${kind}`,manifest,1,manifest.id,attemptId),stepId=step(kind==='preview'?'preview-render':'render',stageFingerprint);
  db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,finished_at,status,result_artifact_id) VALUES(?,?,?,?,1,'synthetic-render-fixture',1,?,'succeeded',?)").run(attemptId,brandId,runId,stepId,new Date().toISOString(),manifest.id);db.prepare("UPDATE runs SET status='ready',current_step=?,version=version+1 WHERE id=?").run(kind==='preview'?'preview-review':'validate',runId);
  const target={manifest,manifestRef,result};if(kind==='preview')preview=target;return target;
 }
 async function validateFinal(target){
  const {evaluateRenderedQuality}=await from('src/quality/objective-checks.mjs');const {manifest,result}=target;
  const files=[];for(const image of manifest.files){const file=await inputs.resolveArtifact(brandId,runId,image.artifactRef.id);files.push({id:image.artifactRef.id,bytes:await readFile(file.path)});}const mf=await inputs.resolveArtifact(brandId,runId,manifest.metricsRef.id);files.push({id:manifest.metricsRef.id,bytes:await readFile(mf.path)});
  const objective=await evaluateRenderedQuality({manifest,composition:{...result,inputs:{carousel:data.carousel,plan,snapshot,fonts,assets:[],logos:[]}},files,qualification:pkg.qualifications});
  const objectiveReportRef=await persist('objective-report:final',objective),fp=fingerprintStage({contractVersion:2,...scope,snapshotHash:canonicalHash(snapshot),executable:ready.executable,stage:'validate',inputs:{manifestRef:target.manifestRef,renderAttemptId:manifest.renderAttemptId,files:manifest.files,metricsRef:manifest.metricsRef,checkerRefs:snapshot.qualityPolicy.checkerRefs,qualificationRefs:manifest.qualifications}}),stepId=step('validate',fp);
  db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,finished_at,status,result_artifact_id) VALUES(?,?,?,?,1,'synthetic-validation-fixture',1,?,'succeeded',?)").run(randomUUID(),brandId,runId,stepId,new Date().toISOString(),objectiveReportRef.id);db.prepare("UPDATE runs SET status='ready',current_step='quality-review',version=version+1 WHERE id=?").run(runId);return {objective,objectiveReportRef};
 }
 if(render)await makeRender();const service=await createQualityReview({root,db,packageRoot:pkg.packageRoot,hooks}),gate=await createProductionGate({root,db,packageRoot:pkg.packageRoot});
 return {...pkg,root,db,scope,inputs,plan,ready,carousel:data.carousel,fonts,preview,approvals,grant,persist,makeRender,validateFinal,service,gate,step,reviewGateway:localGateway.confirmQualityReviewProposal,from};
}
