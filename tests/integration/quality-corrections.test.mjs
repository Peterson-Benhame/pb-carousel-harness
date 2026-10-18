import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonicalHash} from '../../src/domain/canonical-json.mjs';
import {qualitySnapshotFixture} from '../fixtures/quality/snapshot-fixture.mjs';
import {compositionFixture} from '../fixtures/quality/composition-fixture.mjs';
import {classifyBoundedCorrection} from '../../src/domain/invalidation.mjs';

// Synthetic qualification records exercise the pure policy, not production release.
async function decoratedPolicy(){
 const {qualifications}=await qualitySnapshotFixture(),{plan}=await compositionFixture();
 for(const q of qualifications){
  q.definition.regions.push({id:'safe-decoration',x:1032,y:500,width:6,height:24,kind:'decoration',readingOrder:6});
  q.definition.continuity.anchors.push({id:'safe-anchor',regionId:'safe-decoration',x:0,y:0});
  q.definition.decorationOptions=[
   {id:'base',elementId:'safe-decoration',anchorId:'safe-anchor',offsetX:0,offsetY:0,visible:true},
   {id:'move',elementId:'safe-decoration',anchorId:'safe-anchor',offsetX:12,offsetY:12,visible:true},
   {id:'remove',elementId:'safe-decoration',anchorId:'safe-anchor',offsetX:12,offsetY:12,visible:false},
  ];q.definitionHash=canonicalHash(q.definition);
 }
 for(const slide of plan.slides){const q=qualifications.find(q=>q.definition.layoutId===slide.layoutId);slide.qualificationRef={id:q.id,version:q.version,sha256:canonicalHash(q),definitionHash:q.definitionHash};slide.decorationChoices=[{elementId:'safe-decoration',optionId:'base'}];}
 const next=structuredClone(plan);next.id=randomUUID();next.version=2;next.slides[0].decorationChoices[0].optionId='move';
 return {previous:plan,next,qualifications};
}
test('Q05 bounds permit exactly 12 px per axis and 24 px conservative clearance',async()=>{
 const f=await decoratedPolicy(),adjustments=classifyBoundedCorrection(f);
 assert.deepEqual(adjustments,[{kind:'move-decoration-anchor',slideIndex:1,elementId:'safe-decoration',previousOptionId:'base',optionId:'move',deltaX:12,deltaY:12}]);
 assert.ok(Object.isFrozen(adjustments));
});
test('Q05 enumerated removal is bounded; restoring hidden decoration is not',async()=>{
 const f=await decoratedPolicy();f.next.slides[0].decorationChoices[0].optionId='remove';
 assert.equal(classifyBoundedCorrection(f)[0].kind,'remove-decoration');
 const prior=f.previous;f.previous=f.next;f.next=prior;
 assert.throws(()=>classifyBoundedCorrection(f),{code:'QUALITY_CORRECTION_UNAVAILABLE'});
});
for(const mutation of ['copy','surface','layout','selection','text','asset','continuity','unknown-option','candidate','below-clearance','over-delta','unknown-anchor','no-change'])test(`Q05 ${mutation} cannot be disguised as bounded decoration`,async()=>{
 const f=await decoratedPolicy(),q=f.qualifications.find(q=>q.id===f.previous.slides[0].qualificationRef.id);
 if(mutation==='copy')f.next.copyFingerprint='f'.repeat(64);
 if(mutation==='surface')f.next.slides[0].surface='dark';
 if(mutation==='layout')f.next.slides[0].layoutId='content-flow@1';
 if(mutation==='selection')f.next.previewSelection.slideIndices.push(3);
 if(mutation==='text')f.next.slides[0].blocks[0].spans[0].styleId='title';
 if(mutation==='asset')f.next.assets.push({id:randomUUID()});
 if(mutation==='continuity')f.next.continuities.push({from:1,to:2});
 if(mutation==='unknown-option')f.next.slides[0].decorationChoices[0].optionId='arbitrary';
 if(mutation==='candidate'){q.status='candidate';q.release=null;q.evidenceRefs=[];}
 if(mutation==='below-clearance')q.definition.regions.at(-1).x=1031.999;
 if(mutation==='over-delta')q.definition.decorationOptions[0].offsetX=-1;
 if(mutation==='unknown-anchor')q.definition.decorationOptions[1].anchorId='another-anchor';
 if(mutation==='no-change')f.next.slides[0].decorationChoices[0].optionId='base';
 if(['candidate','below-clearance','over-delta','unknown-anchor'].includes(mutation)){q.definitionHash=canonicalHash(q.definition);const ref={id:q.id,version:q.version,sha256:canonicalHash(q),definitionHash:q.definitionHash};f.previous.slides[0].qualificationRef=ref;f.next.slides[0].qualificationRef=ref;}
 assert.throws(()=>classifyBoundedCorrection(f));
});

import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {canonicalJson} from '../../src/domain/canonical-json.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createQualityCorrections} from '../../src/application/quality-corrections.mjs';
import {qualityServiceFixture,syntheticReview} from '../helpers/quality-service-fixture.mjs';
import {sha256} from '../../src/infrastructure/resources.mjs';
const runVersion=f=>f.db.prepare('SELECT version FROM runs WHERE id=?').get(f.request.runId).version;
const databaseState=db=>Object.fromEntries(['runs','steps','artifacts','operations','confirmation_requests','approvals','step_attempts','run_events'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
async function persistenceFixture(t){
 const base=await qualityServiceFixture(t,{decorate:true}),{db,root,inputs}=base,request=base.scope,dataDir=root;
 const {createQualityCorrections:factory}=await base.from('src/application/quality-corrections.mjs'),options={root,db,packageRoot:base.packageRoot},corrections=await factory(options);
 async function file(name,value){const sourcePath=path.join(root,name);await writeFile(sourcePath,value);return {sourcePath,sha256:sha256(value)};}
 const material={};for(const kind of ['carousel','concept']){const ref=base.ready.artifacts[kind],stored=await inputs.resolveArtifact(request.brandId,request.runId,ref.id);material[kind]={sourcePath:stored.path,sha256:stored.sha256};}
 const version=kind=>db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM artifacts WHERE brand_id=? AND run_id=? AND kind=?').get(request.brandId,request.runId,kind).n;
 const persist=(kind,record,allocation)=>base.persist(kind,record,version(kind),record.id??randomUUID(),allocation);
 async function renderCurrent(saved,plan){
  const {composeCarousel}=await base.from('src/render/composed-carousel.mjs');
  const output=await composeCarousel({carousel:base.carousel,snapshot:base.snapshot,plan,resources:{fonts:base.fonts,qualifications:base.qualifications,assets:[],logos:[]},selection:{slideIndices:plan.previewSelection.slideIndices,seamPairs:plan.previewSelection.seamPairs}}),attempt=randomUUID(),files=[];
  for(const slide of output.slides){const kind=`render-slide:preview:${slide.index}`,artifactRef=await base.persist(kind,slide.png,version(kind),randomUUID(),attempt);files.push({artifactRef,role:'slide',slideIndex:slide.index,pair:null,mediaType:'image/png',width:1080,height:1350,size:slide.png.length,rgbaSha256:slide.rgbaSha256});}
  const metricsRef=await persist('composition-metrics:preview',{schemaVersion:1,selection:output.selection,slides:output.slides.map(({index,scene,metrics})=>({index,scene,metrics}))},attempt);
  const selection={slideIndices:output.selection.slideIndices,seamPairs:output.selection.seamPairs,policyId:'representative-risk@1'},copy=await base.approvals.verify({...request,kind:'copy'}),concept=await base.approvals.verify({...request,kind:'concept'});
  const manifest={...base.preview.manifest,id:randomUUID(),version:version('render-manifest:preview'),renderAttemptId:attempt,stageFingerprint:saved.fingerprints['preview-render'],inputsRef:{id:saved.id,kind:'inputs',version:saved.version,sha256:canonicalHash(saved)},planRef:saved.artifacts.plan,selection,selectionHash:canonicalHash(selection),files,metricsRef,upstream:{copyApprovalId:copy.id,conceptApprovalId:concept.id,assetsEvidenceRef:base.preview.manifest.upstream.assetsEvidenceRef},createdAt:new Date().toISOString()};
  await persist('render-manifest:preview',manifest,attempt);const stepId=base.step('preview-render',manifest.stageFingerprint),n=db.prepare('SELECT COALESCE(MAX(attempt_number),0)+1 n FROM step_attempts WHERE step_id=?').get(stepId).n;
  db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,status,finished_at,result_artifact_id) VALUES(?,?,?,?,?,'synthetic-render-fixture',1,'succeeded',?,?)").run(attempt,request.brandId,request.runId,stepId,n,new Date().toISOString(),manifest.id);
  db.prepare("UPDATE runs SET status='ready',current_step='preview-review',version=version+1 WHERE id=?").run(request.runId);return manifest;
 }
 let negative=null;
 async function defect(){
  const current=await inputs.get(request.brandId,request.runId);if(negative?.planRef.id===current.artifacts.plan.id)return negative.ref;
  const plan=JSON.parse(await readFile((await inputs.resolveArtifact(request.brandId,request.runId,current.artifacts.plan.id)).path,'utf8'));
  const manifest=current.artifacts.plan.id===base.ready.artifacts.plan.id?base.preview.manifest:await renderCurrent(current,plan);
  const pending=await base.service.request({requestId:randomUUID(),...request,kind:'preview',manifestId:manifest.id}),answer=await syntheticReview(pending,{gateway:base.reviewGateway,result:'FALHA'});
  const result=await base.service.decide({requestId:randomUUID(),proposal:pending.proposal,answers:answer.answers},answer.receipt);assert.equal(result.review.verdict,'failed');negative={planRef:current.artifacts.plan,ref:result.reviewRef};return result.reviewRef;
 }
 const f={...base,dataDir,request,material,file,options,corrections,persist,defect,createCorrections:factory};
 f.reserve=async(optionId='move',service=corrections)=>{const defectRef=await defect();return service.reserve({requestId:randomUUID(),...request,expectedVersion:runVersion(f),choices:[{slideIndex:1,elementId:'safe-decoration',optionId}],defectRefs:[defectRef]});};
 f.complete=async(reservation,service=corrections)=>service.complete({requestId:randomUUID(),...request,expectedVersion:runVersion(f),reservationRef:reservation.episodeRef});
 return f;
}
test('Q05 reservation is durable before adjustment; completion has no cyclic references',async t=>{
 const f=await persistenceFixture(t),before=databaseState(f.db),reservation=await f.reserve();
 assert.equal((await f.corrections.get(f.request)).state.roundsConsumed,1);
 await assert.rejects(f.gate.assertProductionGate({...f.request,phase:'preview'}),{code:'QUALITY_CORRECTION_UNAVAILABLE'});
 assert.equal((await f.inputs.get(f.request.brandId,f.request.runId)).artifacts.plan.id,f.ready.artifacts.plan.id);
 const completed=await f.complete(reservation),view=await f.corrections.get(f.request),plan=JSON.parse(await readFile((await f.inputs.resolveArtifact(f.request.brandId,f.request.runId,completed.planRef.id)).path,'utf8'));
 assert.deepEqual(plan.change.correctionEpisodeRef,reservation.episodeRef);
 assert.deepEqual(view.episode.rounds[0].newPlanRef,completed.planRef);
 assert.equal(view.episode.reservation,null);assert.equal(view.state.roundsConsumed,1);
 for(const artifact of before.artifacts)assert.deepEqual(f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(artifact.id),artifact);
 assert.notEqual(view.episodeRef.id,plan.change.correctionEpisodeRef.id);
 assert.deepEqual((await f.gate.assertProductionGate({...f.request,phase:'preview'})).planRef,completed.planRef);
});
test('Q05 second reservation finishes in a fresh process; third reserve blocks without a new episode',async t=>{
 const f=await persistenceFixture(t),one=await f.reserve();await f.complete(one);const two=await f.reserve('remove');
 assert.equal((await f.corrections.get(f.request)).state.remaining,0);
 const module=file=>pathToFileURL(path.join(f.packageRoot,file)).href;
 const script=`import {openWorkspace} from ${JSON.stringify(module('src/infrastructure/sqlite/database.mjs'))};import {createQualityCorrections} from ${JSON.stringify(module('src/application/quality-corrections.mjs'))};const db=await openWorkspace(process.argv[1],{readonly:false});try{const service=await createQualityCorrections({root:process.argv[1],db,packageRoot:process.argv[2]});console.log(JSON.stringify(await service.complete(JSON.parse(process.argv[3]))));}finally{db.close();}`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,f.dataDir,f.packageRoot,JSON.stringify({requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),reservationRef:two.episodeRef})]);assert.equal(JSON.parse(stdout).roundNumber,2);
 const resumed=await f.createCorrections(f.options),before=databaseState(f.db).artifacts;
 await assert.rejects(f.reserve('base',resumed),{code:'QUALITY_CORRECTION_LIMIT'});
 const after=await resumed.get(f.request);assert.equal(after.state.roundsConsumed,2);assert.equal(after.episode.episodeId,one.episodeId);
 for(const artifact of before)assert.deepEqual(f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(artifact.id),artifact);
 assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(f.request.runId).status,'blocked');
});
test('Q05 crash after plan commit reconciles the same reserved round',async t=>{
 const f=await persistenceFixture(t),reservation=await f.reserve(),crash=await f.createCorrections({...f.options,hooks:{afterPlan(){throw Error('synthetic process stop');}}});
 await assert.rejects(f.complete(reservation,crash),/synthetic process stop/);const saved=await f.inputs.get(f.request.brandId,f.request.runId),before=f.db.prepare("SELECT COUNT(*) n FROM artifacts WHERE kind='composition-plan'").get().n;
 const fresh=await f.createCorrections(f.options),done=await f.complete(reservation,fresh);
 assert.deepEqual(done.planRef,saved.artifacts.plan);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM artifacts WHERE kind='composition-plan'").get().n,before);
 assert.equal((await fresh.get(f.request)).state.roundsConsumed,1);
});

test('Q05 rejected correction cannot reclaim a slot or open an arbitrary episode',async t=>{
 const f=await persistenceFixture(t),reservation=await f.reserve();
 f.db.prepare("UPDATE runs SET status='blocked' WHERE id=?").run(f.request.runId);
 const before=(await f.corrections.get(f.request)).episode;
 await assert.rejects(f.corrections.reserve({requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),choices:[{slideIndex:1,elementId:'safe-decoration',optionId:'remove'}],defectRefs:[await f.defect()]}),{code:'QUALITY_CORRECTION_UNAVAILABLE'});
 await assert.rejects(f.corrections.reserve({requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),episodeId:randomUUID(),choices:[],defectRefs:[]}),{code:'INVALID_ARGUMENT'});
 assert.deepEqual((await f.corrections.get(f.request)).episode,before);
 await f.complete(reservation);assert.equal((await f.corrections.get(f.request)).state.roundsConsumed,1);
});
test('Q05 material replacement retains count and cannot open another episode without approval',async t=>{
 const f=await persistenceFixture(t),one=await f.reserve();await f.complete(one);
 const next=await f.inputs.save({requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),...f.material,concept:await f.file('material.md','Explicit changed direction')});
 const plan=structuredClone(f.plan),previous=await f.inputs.resolveArtifact(f.request.brandId,f.request.runId,(await f.corrections.get(f.request)).episode.rounds[0].newPlanRef.id);
 Object.assign(plan,{id:randomUUID(),version:3,conceptRef:next.artifacts.concept,change:{kind:'material',previousPlanRef:{id:previous.id,kind:previous.kind,version:previous.version,sha256:previous.sha256},correctionEpisodeRef:null}});
 await f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),plan});
 await assert.rejects(f.corrections.reserve({requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),choices:[{slideIndex:1,elementId:'safe-decoration',optionId:'move'}],defectRefs:[one.request.defectRefs[0]]}),{code:'QUALITY_CORRECTION_UNAVAILABLE'});assert.equal((await f.corrections.get(f.request)).state.roundsConsumed,1);
});
test('Q05 reserve and complete exact requests replay without consuming extra rounds',async t=>{
 const f=await persistenceFixture(t),defect=await f.defect(),request={requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),choices:[{slideIndex:1,elementId:'safe-decoration',optionId:'move'}],defectRefs:[defect]};
 const reservation=await f.corrections.reserve(request),afterReserve=databaseState(f.db);assert.deepEqual(await f.corrections.reserve(request),reservation);assert.deepEqual(databaseState(f.db),afterReserve);
 const close={requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),reservationRef:reservation.episodeRef},done=await f.corrections.complete(close),afterComplete=databaseState(f.db);
 assert.deepEqual(await f.corrections.complete(close),done);assert.deepEqual(await f.corrections.reserve(request),reservation);assert.deepEqual(databaseState(f.db),afterComplete);
});
test('Q05 reserve persistence race rolls back its artifact row and consumed slot',async t=>{
 const f=await persistenceFixture(t),service=await f.createCorrections({...f.options,hooks:{commit(){f.db.prepare('UPDATE runs SET version=version+1 WHERE id=?').run(f.request.runId);}}});
 await assert.rejects(f.reserve('move',service),{code:'RUN_VERSION_CONFLICT'});assert.equal(await f.corrections.get(f.request),null);
});
test('Q05 forged reservation artifact has no authority for generic savePlan',async t=>{
 const f=await persistenceFixture(t),episode={id:randomUUID(),episodeId:randomUUID(),...f.request,version:1,seedPlanRef:f.ready.artifacts.plan,scopeFingerprint:'a'.repeat(64),rounds:[],reservation:{number:1,previousPlanRef:f.ready.artifacts.plan,defectRefs:[],adjustments:[]},closedReason:null},ref=await f.persist('quality-correction-episode',episode);
 const plan={...structuredClone(f.plan),id:randomUUID(),version:2,change:{kind:'bounded-correction',previousPlanRef:f.ready.artifacts.plan,correctionEpisodeRef:ref}};
 await assert.rejects(f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),plan}),{code:'QUALITY_CORRECTION_UNAVAILABLE'});
});

test('Q05 candidate installed catalog cannot issue a correction reservation',async t=>{
 const f=await persistenceFixture(t),candidate=await createQualityCorrections({root:f.dataDir,db:f.db});
 await assert.rejects(f.reserve('move',candidate),{code:'LAYOUT_NOT_QUALIFIED'});
 assert.equal(await f.corrections.get(f.request),null);
});
test('Q05 direct plan save cannot change semantic content under a real reserved slot',async t=>{
 const f=await persistenceFixture(t),reservation=await f.reserve(),plan=structuredClone(f.plan);
 Object.assign(plan,{id:randomUUID(),version:2,change:{kind:'bounded-correction',previousPlanRef:f.ready.artifacts.plan,correctionEpisodeRef:reservation.episodeRef}});
 plan.slides[0].decorationChoices[0].optionId='move';plan.slides[0].surface='dark';
 await assert.rejects(f.inputs.savePlan({requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),plan}),{code:'QUALITY_CORRECTION_UNAVAILABLE'});
 assert.equal((await f.corrections.get(f.request)).state.roundsConsumed,1);
});
test('Q05 corrupted reservation bytes block completion without forgetting its artifact',async t=>{
 const f=await persistenceFixture(t),reservation=await f.reserve(),stored=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(reservation.episodeRef.id),before=databaseState(f.db);
 await writeFile(path.join(f.dataDir,stored.relative_path),'corrupt reservation');
 await assert.rejects(f.complete(reservation),{code:'ARTIFACT_HASH_MISMATCH'});
 assert.deepEqual(databaseState(f.db),before);
});
test('Q05 reservation from another run is never accepted despite a plausible shape',async t=>{
 const first=await persistenceFixture(t),second=await persistenceFixture(t),reservation=await first.reserve();
 await assert.rejects(second.complete(reservation),{code:'QUALITY_CORRECTION_UNAVAILABLE'});
 assert.equal(await second.corrections.get(second.request),null);
});

test('Q05 imported failed objective JSON cannot authorize a bounded correction',async t=>{
 const f=await persistenceFixture(t);await f.service.request({requestId:randomUUID(),...f.request,kind:'preview',manifestId:f.preview.manifest.id});
 const row=f.db.prepare("SELECT * FROM artifacts WHERE kind='objective-report:preview' ORDER BY version DESC LIMIT 1").get(),record=JSON.parse(await readFile(path.join(f.root,row.relative_path),'utf8'));
 record.result='failed';record.checks[0].result='failed';record.checks[0].observed='Forged failure without matching Q06 bytes';
 const defectRef=await f.persist('objective-report:preview',record);
 await assert.rejects(f.corrections.reserve({requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),choices:[{slideIndex:1,elementId:'safe-decoration',optionId:'move'}],defectRefs:[defectRef]}),{code:'QUALITY_EVIDENCE_STALE'});
 assert.equal(await f.corrections.get(f.request),null);
});
test('Q05 copied failed review has no issuing receipt for its new identity',async t=>{
 const f=await persistenceFixture(t),real=await f.defect(),file=await f.inputs.resolveArtifact(f.request.brandId,f.request.runId,real.id),review=JSON.parse(await readFile(file.path,'utf8'));
 review.id=randomUUID();review.version++;const defectRef=await f.persist('quality-review:preview',review);
 await assert.rejects(f.corrections.reserve({requestId:randomUUID(),...f.request,expectedVersion:runVersion(f),choices:[{slideIndex:1,elementId:'safe-decoration',optionId:'move'}],defectRefs:[defectRef]}),{code:'QUALITY_EVIDENCE_STALE'});
 assert.equal(await f.corrections.get(f.request),null);
});

test('Q05 extra unissued episode version cannot be used by the production gate',async t=>{
 const f=await persistenceFixture(t),reservation=await f.reserve();await f.complete(reservation);const {episode}=await f.corrections.get(f.request);
 await f.persist('quality-correction-episode',{...episode,id:randomUUID(),version:episode.version+1});
 await assert.rejects(f.gate.assertProductionGate({...f.request,phase:'preview'}),{code:'QUALITY_EVIDENCE_STALE'});
});
