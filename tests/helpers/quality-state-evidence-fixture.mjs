import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { qualityStateFixture } from './quality-state-fixture.mjs';
import { qualitySnapshotFixture } from '../fixtures/quality/snapshot-fixture.mjs';
import { fontRoot } from './legacy-render-fixture.mjs';
import { canonicalHash, canonicalJson } from '../../src/domain/canonical-json.mjs';
import { buildRunSnapshot } from '../../src/domain/run-snapshot.mjs';
import { createRunInputs } from '../../src/application/run-inputs.mjs';
import { createRunRuntime } from '../../src/application/run-runtime.mjs';
import { composeCarousel } from '../../src/render/composed-carousel.mjs';
import { evaluateRenderedQuality } from '../../src/quality/objective-checks.mjs';
import { getReviewRubric } from '../../src/quality/review-rubric.mjs';
import { fingerprintQualityReviewObject, fingerprintQualityReviewProposal } from '../../src/domain/quality-evidence.mjs';
import { inspectPackage, dependencyNames, probeDependency, sha256 } from '../../src/infrastructure/resources.mjs';

const reference = (id,kind,version,sha256) => ({id,kind,version,sha256});
const refRecord = (record,kind) => reference(record.id,kind,record.version,canonicalHash(record));
const sorted = values => [...values].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
const metricsDocument = c => ({schemaVersion:1,selection:c.selection,slides:c.slides.map(({index,scene,metrics})=>({index,scene,metrics}))});

/** Tests only: real compositor/Q06 bytes, synthetic qualification releases,
 * imported historical stage rows and declared review answers. This helper
 * issues no receipt, approval capability, render lease or product operation. */
export async function qualityStateEvidenceFixture(t,{mutateManifest,omitFinalReview=false}={}) {
 const base=await qualityStateFixture(t),{db,dataDir}=base;
 const inspected=await inspectPackage({rendererId:'editorial-composed@1'});
 const blocking=inspected.diagnostics.filter(d=>d.code!=='LAYOUT_NOT_QUALIFIED');
 if(blocking.length)throw Error(`Real compositor prerequisites: ${JSON.stringify(blocking)}`);
 const runtime={...structuredClone(base.runtime),renderer:inspected.renderer,dependencies:Object.fromEntries(await Promise.all(dependencyNames.map(async name=>[name,await probeDependency(name)])))};
 const config={...structuredClone(base.snapshot.brand.config),configVersion:2};
 for(const theme of Object.values(config.themes))theme.surfaceBindings={light:{background:'background',text:'text',muted:'muted',accent:'accent'}};
 const data=await qualitySnapshotFixture({runtime,config});
 data.input.brand.revision=2;
 const checkerRef={id:'editorial-objective-checkers@1',version:1,sha256:sha256(await readFile(new URL('../../src/quality/objective-checks.mjs',import.meta.url)))};
 const rubricRef={id:'editorial-quality@1',version:1,sha256:sha256(await readFile(new URL('../../src/quality/review-rubric.mjs',import.meta.url)))};
 data.input.qualityPolicy={...data.input.qualityPolicy,rubricRef,checkerRefs:[checkerRef]};
 const {sha256:ignored,...policyBytes}=data.input.qualityPolicy;data.input.qualityPolicy.sha256=canonicalHash(policyBytes);
 for(const q of data.qualifications){q.definition.checkerRef=checkerRef;q.definition.rubricRef=rubricRef;q.definitionHash=canonicalHash(q.definition);}
 const snapshot=buildRunSnapshot(data.input),runId=randomUUID(),brandId=snapshot.brand.id,request={brandId,runId};
 db.prepare("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES(?,2,?,?,'user-confirmed')").run(brandId,canonicalJson(snapshot.brand.config),snapshot.brand.revisionHash);
 db.prepare('UPDATE brands SET current_revision=2 WHERE id=?').run(brandId);
 db.prepare('INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES(?,?,2,?,?)').run(runId,brandId,canonicalJson(snapshot),canonicalHash(snapshot));
 const inputs=await createRunInputs({root:dataDir,db,qualifications:data.qualifications});
 const carousel=base.composition.carousel;
 const saved=await inputs.save({requestId:randomUUID(),...request,expectedVersion:1,carousel:await base.file(`real-${runId}.json`,canonicalJson(carousel)),concept:await base.file(`concept-${runId}.md`,'Synthetic byte-chain concept')});
 const plan=base.plan(saved);plan.id=randomUUID();plan.runId=runId;plan.snapshotHash=canonicalHash(snapshot);
 for(const slide of plan.slides){const q=data.qualifications.find(q=>q.definition.layoutId===slide.layoutId);slide.qualificationRef={id:q.id,version:q.version,sha256:canonicalHash(q),definitionHash:q.definitionHash};}
 const ready=await inputs.savePlan({requestId:randomUUID(),...request,expectedVersion:saved.runVersion,plan});
 const fonts=await Promise.all(snapshot.fonts.map(async font=>({
  ...font,bytes:await readFile(path.join(fontRoot,data.manifest.fonts.find(f=>f.id===font.id).file)),
 })));
 const resources={fonts,qualifications:data.qualifications,assets:[],logos:[]};
 const allocation=randomUUID(),written=[];
 async function persist(id,kind,version,bytes,allocationId=allocation){
  const relative=`runs/${brandId}/${runId}/${allocationId}/${id}.bin`,filename=path.join(dataDir,relative);
  await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,bytes,{flag:'wx'});
  const digest=sha256(bytes);db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(id,brandId,runId,kind,version,digest,relative,canonicalJson({size:bytes.length}));
  const ref=reference(id,kind,version,digest);written.push({ref,filename,bytes:Buffer.from(bytes)});return ref;
 }
 async function persistRecord(record,kind,allocationId){return persist(record.id,kind,record.version,Buffer.from(canonicalJson(record)),allocationId);}
 const approvals={copy:randomUUID(),concept:randomUUID(),preview:randomUUID()};
 const assetsEvidenceRef=await persist(randomUUID(),'no-assets-evidence',1,Buffer.from(canonicalJson({schemaVersion:1,brandId,runId,status:'not-applicable',assetsFingerprint:ready.fingerprints['assets-approval']})));
 async function make(kind,preview){
  const renderAttemptId=randomUUID();
  const result=await composeCarousel({carousel,snapshot,plan,resources,selection:kind==='final'?'all':{slideIndices:plan.previewSelection.slideIndices,seamPairs:plan.previewSelection.seamPairs}});
  const composition={...result,inputs:{carousel,plan,snapshot,fonts,assets:[],logos:[]}},files=[],records=[];
  async function image(image,role,slideIndex=null,pair=null){
   const type=role==='slide'?`render-slide:${kind}:${slideIndex}`:role==='seam'?`render-seam:${kind}:${pair.from}-${pair.to}`:'render-panorama:final';
   const artifactRef=await persist(randomUUID(),type,1,image.png,renderAttemptId);files.push({id:artifactRef.id,bytes:image.png});records.push({artifactRef,role,slideIndex,pair,mediaType:'image/png',width:role==='slide'?1080:role==='seam'?2160:1080*result.slides.length,height:1350,size:image.png.length,rgbaSha256:image.rgbaSha256});
  }
  for(const slide of result.slides)await image(slide,'slide',slide.index);for(const seam of result.seams)await image(seam,'seam',null,seam.pair);if(result.panorama)await image(result.panorama,'panorama');
  const metricsBytes=Buffer.from(canonicalJson(metricsDocument(result))),metricsRef=await persist(randomUUID(),`composition-metrics:${kind}`,1,metricsBytes,renderAttemptId);files.push({id:metricsRef.id,bytes:metricsBytes});
  const selection={slideIndices:result.selection.slideIndices,seamPairs:result.selection.seamPairs,policyId:kind==='final'?'all-slides@1':'representative-risk@1'};
  const manifest={schemaVersion:2,id:randomUUID(),brandId,runId,version:1,kind,renderAttemptId,stageFingerprint:ready.fingerprints[kind==='preview'?'preview-render':'render']??canonicalHash({syntheticStage:kind==='preview'?'preview-render':'render'}),snapshotHash:canonicalHash(snapshot),inputsRef:refRecord(ready,'inputs'),planRef:ready.artifacts.plan,selection,selectionHash:canonicalHash(selection),renderer:snapshot.renderer,runtimeHash:canonicalHash(snapshot.runtime),resourceManifestHash:snapshot.resourceManifestRef.sha256,qualifications:sorted([...new Map(result.resources.qualifications.map(q=>[q.id,q])).values()]),fonts:snapshot.fonts,upstream:{copyApprovalId:approvals.copy,conceptApprovalId:approvals.concept,assetsEvidenceRef,...(preview?{previewManifestRef:preview.manifestRef,previewReviewRef:preview.reviewRef,previewApprovalId:approvals.preview,approvedSelectionHash:preview.manifest.selectionHash}:{})},files:records,metricsRef,createdAt:'2026-10-16T21:00:00.000Z'};
  mutateManifest?.(manifest,kind);
  const objective=await evaluateRenderedQuality({manifest,composition,files,qualification:data.qualifications});
  const manifestRef=await persistRecord(manifest,`render-manifest:${kind}`,renderAttemptId),objectiveReportRef=await persist(randomUUID(),`objective-report:${kind}`,1,Buffer.from(canonicalJson(objective)),renderAttemptId);
  const targets=manifest.files.map(f=>({role:f.role,slideIndex:f.slideIndex,pair:f.pair,elementId:null}));
  const review={schemaVersion:1,id:randomUUID(),brandId,runId,version:1,kind,renderAttemptId:manifest.renderAttemptId,objectFingerprint:'',reviewProposalHash:'',manifestRef,manifestHash:manifestRef.sha256,planHash:manifest.planRef.sha256,selectionHash:manifest.selectionHash,qualificationRefs:manifest.qualifications,objectiveReportRef,rubricRef,checkerRefs:[checkerRef],method:'human-local-assisted@1',reviewer:{kind:'human-local',gateway:'local-terminal',sessionId:randomUUID(),receiptId:randomUUID()},confirmationRequestId:randomUUID(),reviewedAt:'2026-10-16T21:01:00.000Z',coverage:{files:manifest.files.map(f=>({artifactId:f.artifactRef.id,sha256:f.artifactRef.sha256,rgbaSha256:f.rgbaSha256,viewedFull:false,viewedMobile:false})).sort((a,b)=>a.artifactId<b.artifactId?-1:1),slides:selection.slideIndices,seams:selection.seamPairs,panorama:manifest.files.find(f=>f.role==='panorama')?.artifactRef.id??null,fullResolution:false,mobileWidth:360},criteria:targets.flatMap(target=>getReviewRubric(1).criteria.map(c=>({criterionId:c.id,target,result:'not-verified',observation:'Synthetic integration record: pixels were not inspected by a human.'}))),findings:[],verdict:'not-verified'};
  review.objectFingerprint=fingerprintQualityReviewObject(Object.fromEntries(['brandId','runId','kind','renderAttemptId','manifestRef','planHash','selectionHash','qualificationRefs','objectiveReportRef','rubricRef','checkerRefs'].map(k=>[k,review[k]])));
  review.reviewProposalHash=fingerprintQualityReviewProposal(Object.fromEntries(['objectFingerprint','confirmationRequestId','coverage','criteria','findings'].map(k=>[k,review[k]])));
  const reviewRef=kind==='final'&&omitFinalReview?null:await persistRecord(review,`quality-review:${kind}`,renderAttemptId);
  return {manifest,manifestRef,objective,objectiveReportRef,review,reviewRef,composition:result};
 }
 const preview=await make('preview'),final=await make('final',preview);
 const stages=['inputs','copy-approval','concept-approval','assets-approval','preview-render','preview-review','preview-approval','render','validate','quality-review','package'];
 const steps=new Map();
 for(const key of stages){const status=key==='quality-review'?'waiting-approval':key==='package'?'pending':'succeeded',fingerprint=ready.fingerprints[key]??canonicalHash({syntheticStage:key});db.prepare('INSERT INTO steps(id,brand_id,run_id,step_key,status,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT(brand_id,run_id,step_key) DO UPDATE SET status=excluded.status,fingerprint=excluded.fingerprint').run(randomUUID(),brandId,runId,key,status,fingerprint);steps.set(key,db.prepare('SELECT * FROM steps WHERE run_id=? AND step_key=?').get(runId,key));}
 for(const [key,artifact,attemptId] of [['preview-render',preview.manifestRef,preview.manifest.renderAttemptId],['render',final.manifestRef,final.manifest.renderAttemptId],['validate',final.objectiveReportRef,randomUUID()]])db.prepare("INSERT INTO step_attempts(id,brand_id,run_id,step_id,attempt_number,executor,fencing_token,started_at,finished_at,status,result_artifact_id) VALUES(?,?,?,?,1,'synthetic-fixture',1,'2026-10-16T21:00:00.000Z','2026-10-16T21:01:00.000Z','succeeded',?)").run(attemptId,brandId,runId,steps.get(key).id,artifact.id);
 for(const [key,approvalId,approvalKind] of [['copy-approval',approvals.copy,'copy'],['concept-approval',approvals.concept,'concept'],['preview-approval',approvals.preview,'preview']]){const requestId=randomUUID(),fingerprint=steps.get(key).fingerprint;db.prepare("INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,status) VALUES(?,?,?,?,?,'confirmed')").run(requestId,brandId,runId,approvalKind,fingerprint);db.prepare("INSERT INTO approvals(id,brand_id,run_id,kind,object_fingerprint,decision,confirmation_request_id,evidence_json) VALUES(?,?,?,?,?,'approved',?,?)").run(approvalId,brandId,runId,approvalKind,fingerprint,requestId,canonicalJson({synthetic:true,trustedReceipt:false}));}
 db.prepare("UPDATE runs SET status='waiting-approval',current_step='quality-review' WHERE id=?").run(runId);
 return {...base,...data,snapshot,db,dataDir,request,inputs,ready,plan,preview,final,written,steps,persist,runtime:await createRunRuntime({root:dataDir,db})};
}
