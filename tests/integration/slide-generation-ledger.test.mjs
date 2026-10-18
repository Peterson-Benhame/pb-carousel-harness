import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initializeWorkspace, openWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import { canonicalHash, canonicalJson } from '../../src/domain/canonical-json.mjs';
import { qualitySnapshotFixture } from '../fixtures/quality/snapshot-fixture.mjs';
import { compositionFixture } from '../fixtures/quality/composition-fixture.mjs';

const workerPath=fileURLToPath(new URL('../helpers/slide-generation-worker.mjs',import.meta.url));

test('package subpath exposes only the generation ledger service and explicit activation',async()=>{
  const api=await import('@pb/carousel-harness/generation-ledger');
  assert.deepEqual(Object.keys(api).sort(),['activateSlideGenerationLedger','createSlideGenerationLedger']);
});

async function v2Fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'carousel-generation-ledger '));
  const db = await initializeWorkspace(root, { schemaVersion: 2 });
  const connections=[db],children=[];
  t.after(async () => { for(const child of children)if(child.exitCode===null)child.kill();for(const connection of connections)if(connection.open)connection.close();await rm(root, { recursive: true, force: true }); });
  const { snapshot } = await qualitySnapshotFixture();
  const brandId = snapshot.brand.id, runId = randomUUID();
  db.prepare('INSERT INTO brands(id) VALUES(?)').run(brandId);
  db.prepare("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES(?,1,?,?,'user-confirmed')")
    .run(brandId, canonicalJson(snapshot.brand.config), snapshot.brand.revisionHash);
  db.prepare('UPDATE brands SET current_revision=1 WHERE id=?').run(brandId);
  const snapshotBytes = canonicalJson(snapshot);
  db.prepare('INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES(?,?,1,?,?)')
    .run(runId, brandId, snapshotBytes, canonicalHash(snapshot));
  return { root, db, connections, children, brandId, runId, snapshotBytes };
}

async function generationWorker(f,request){
  const child=fork(workerPath,[f.root,process.cwd()],{stdio:['ignore','pipe','pipe','ipc']});f.children.push(child);
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.stdout.resume();
  const ready=new Promise((resolve,reject)=>{child.once('message',message=>message==='ready'?resolve():reject(new Error(JSON.stringify(message))));child.once('error',reject);});
  const result=new Promise((resolve,reject)=>{child.on('message',message=>{if(message!=='ready')resolve(message);});child.once('exit',code=>{if(code!==0)reject(new Error(stderr||`worker exited ${code}`));});});
  await ready;return {go(){child.send(request);},result};
}

async function persist(f,{id=randomUUID(),kind,version=1,value}) {
  const bytes=Buffer.from(typeof value==='string'?value:canonicalJson(value));
  const relativePath=`runs/${f.brandId}/${f.runId}/ledger-fixture/${id}.bin`;
  const filename=path.join(f.root,...relativePath.split('/'));
  await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,bytes);
  const sha256=typeof value==='string'?createHash('sha256').update(bytes).digest('hex'):canonicalHash(value);
  f.db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,f.brandId,f.runId,kind,version,sha256,relativePath,canonicalJson({size:bytes.length}));
  return {id,kind,version,sha256};
}

async function readyFixture(t) {
  const f=await v2Fixture(t),api=await import('../../src/application/slide-generation-ledger.mjs');
  api.activateSlideGenerationLedger(f.db,{requestId:randomUUID()});
  const source=await compositionFixture(),copyFingerprint=canonicalHash({copy:'approved'});
  const carouselRef=await persist(f,{kind:'carousel',value:source.carousel});
  const conceptRef=await persist(f,{kind:'concept',value:'Conceito sintético aprovado.'});
  const planId=randomUUID(),plan={...source.plan,id:planId,brandId:f.brandId,runId:f.runId,version:1,
    snapshotHash:canonicalHash(JSON.parse(f.snapshotBytes)),copyFingerprint,carouselRef,conceptRef};
  const planRef=await persist(f,{id:planId,kind:'composition-plan',value:plan});
  const inputsId=randomUUID(),inputs={schemaVersion:2,contractVersion:2,fingerprintVersion:2,id:inputsId,
    brandId:f.brandId,runId:f.runId,version:1,snapshotHash:plan.snapshotHash,
    fingerprints:{'copy-approval':copyFingerprint,'preview-render':canonicalHash({preview:'before-plan'})},
    artifacts:{carousel:carouselRef,concept:conceptRef,assets:[],plan:planRef}};
  await persist(f,{id:inputsId,kind:'inputs',value:inputs});
  return {...f,api,plan,planRef,copyFingerprint};
}

test('generation ledger migration is explicit, idempotent and preserves historical memory bytes', async t => {
  const f = await v2Fixture(t);
  const { activateSlideGenerationLedger } = await import('../../src/application/slide-generation-ledger.mjs');
  const requestId = randomUUID();
  const activated = activateSlideGenerationLedger(f.db, { requestId });
  assert.deepEqual(activated, { status: 'activated', schemaVersion: 3 });
  assert.deepEqual(activateSlideGenerationLedger(f.db, { requestId }), activated);
  assert.deepEqual(activateSlideGenerationLedger(f.db, { requestId: randomUUID() }), { status: 'already-active', schemaVersion: 3 });
  assert.equal(f.db.pragma('user_version', { simple: true }), 3);
  assert.equal(f.db.prepare('SELECT count(*) n FROM slide_generation_attempts').get().n, 0);
  assert.equal(f.db.prepare('SELECT snapshot_json FROM runs WHERE id=?').get(f.runId).snapshot_json, f.snapshotBytes);
  f.db.close();
  const reopened = await openWorkspace(f.root, { readonly: false });
  try {
    assert.equal(reopened.pragma('user_version', { simple: true }), 3);
    assert.equal(reopened.prepare('SELECT snapshot_json FROM runs WHERE id=?').get(f.runId).snapshot_json, f.snapshotBytes);
  } finally { reopened.close(); }
});

test('first automatic reservation derives the current slide identity and consumes one durable slot', async t => {
  const f=await readyFixture(t),ledger=await f.api.createSlideGenerationLedger({root:f.root,db:f.db,packageRoot:process.cwd()});
  const result=await ledger.reserveAutomatic({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:1});
  assert.equal(result.attempt.mode,'automatic-initial');assert.equal(result.attempt.automaticOrdinal,1);
  assert.equal(result.attempt.status,'reserved');assert.equal(result.identity.planRevision,1);
  assert.equal(result.identity.contractFingerprint,canonicalHash(f.plan.semanticContracts[0]));
  assert.equal(result.identity.copyFingerprint,f.copyFingerprint);
  assert.deepEqual(result.automaticBudget,{limit:2,used:1,remaining:1});
  const stored=await ledger.getCurrent({brandId:f.brandId,runId:f.runId,slideIndex:1});
  assert.deepEqual(stored,result);
});

test('failure stays consumed across restart, permits one correction and blocks a third automatic attempt', async t => {
  const f=await readyFixture(t),ledger=await f.api.createSlideGenerationLedger({root:f.root,db:f.db,packageRoot:process.cwd()});
  const first=await ledger.reserveAutomatic({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:1});
  const failureRequest={requestId:randomUUID(),brandId:f.brandId,runId:f.runId,attemptId:first.attempt.id,errorCode:'SYNTHETIC_GENERATION_FAILED'};
  const failed=ledger.recordFailure(failureRequest);
  assert.equal(failed.attempt.status,'failed');assert.equal(failed.attempt.errorCode,failureRequest.errorCode);
  assert.deepEqual(ledger.recordFailure(failureRequest),failed);
  f.db.close();f.db=await openWorkspace(f.root,{readonly:false});f.connections.push(f.db);
  const restarted=await f.api.createSlideGenerationLedger({root:f.root,db:f.db,packageRoot:process.cwd()});
  assert.deepEqual(await restarted.getCurrent({brandId:f.brandId,runId:f.runId,slideIndex:1}),failed);
  const second=await restarted.reserveAutomatic({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:1});
  assert.equal(second.attempt.mode,'automatic-correction');assert.equal(second.attempt.automaticOrdinal,2);
  restarted.recordFailure({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,attemptId:second.attempt.id,errorCode:'SYNTHETIC_CORRECTION_FAILED'});
  await assert.rejects(restarted.reserveAutomatic({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:1}),{code:'AUTOMATIC_GENERATION_LIMIT_REACHED'});
  const history=await restarted.getCurrent({brandId:f.brandId,runId:f.runId,slideIndex:1});
  assert.deepEqual(history.attempts.map(item=>[item.mode,item.status,item.errorCode]),[
    ['automatic-initial','failed','SYNTHETIC_GENERATION_FAILED'],
    ['automatic-correction','failed','SYNTHETIC_CORRECTION_FAILED'],
  ]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM slide_generation_attempts').get().n,2);
});

test('success binds an existing artifact while a divergent ref rolls back without pixel claims',async t=>{
  const f=await readyFixture(t),ledger=await f.api.createSlideGenerationLedger({root:f.root,db:f.db,packageRoot:process.cwd()});
  const reserved=await ledger.reserveAutomatic({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:2});
  const resultArtifactRef=await persist(f,{kind:'generated-slide',value:{synthetic:'generation-result'}});
  const request={requestId:randomUUID(),brandId:f.brandId,runId:f.runId,attemptId:reserved.attempt.id,resultArtifactRef};
  await assert.rejects(Promise.resolve().then(()=>ledger.recordSuccess({...request,resultArtifactRef:{...resultArtifactRef,sha256:'f'.repeat(64)}})),{code:'GENERATION_RESULT_INVALID'});
  assert.equal(f.db.prepare('SELECT status FROM slide_generation_attempts WHERE id=?').get(reserved.attempt.id).status,'reserved');
  const succeeded=ledger.recordSuccess(request);
  assert.equal(succeeded.attempt.status,'succeeded');assert.equal(succeeded.attempt.resultArtifactId,resultArtifactRef.id);
  assert.equal(Object.hasOwn(succeeded,'semanticVerified'),false);assert.equal(Object.hasOwn(succeeded,'pixelsVerified'),false);
  assert.deepEqual(ledger.recordSuccess(request),succeeded);
  assert.equal(f.db.prepare("SELECT count(*) n FROM operations WHERE request_id=?").get(request.requestId).n,1);
});

test('reservation request replay is exact and rejected attempts leave no operation or budget effect',async t=>{
  const f=await readyFixture(t),ledger=await f.api.createSlideGenerationLedger({root:f.root,db:f.db,packageRoot:process.cwd()});
  const request={requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:1},reserved=await ledger.reserveAutomatic(request);
  assert.deepEqual(await ledger.reserveAutomatic(request),reserved);
  await assert.rejects(ledger.reserveAutomatic({...request,slideIndex:2}),{code:'IDEMPOTENCY_CONFLICT'});
  const blockedId=randomUUID();
  await assert.rejects(ledger.reserveAutomatic({...request,requestId:blockedId}),{code:'GENERATION_ATTEMPT_ACTIVE'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM slide_generation_attempts').get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM operations WHERE operation='run.slide-generation.reserve-automatic'").get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM operations WHERE request_id=?').get(blockedId).n,0);
});

test('manual correction is a separate one-use seam backed by confirmed persisted intent',async t=>{
  const f=await readyFixture(t),ledger=await f.api.createSlideGenerationLedger({root:f.root,db:f.db,packageRoot:process.cwd()});
  await assert.rejects(ledger.reserveAutomatic({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:3,mode:'manual-correction'}),{code:'INVALID_ARGUMENT'});
  const current=await ledger.getCurrent({brandId:f.brandId,runId:f.runId,slideIndex:3}),manualIntentId=randomUUID();
  await assert.rejects(ledger.reserveManualCorrection({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:3,manualIntentId}),{code:'MANUAL_CORRECTION_INTENT_REQUIRED'});
  const fingerprint=canonicalHash({brandId:f.brandId,runId:f.runId,slideIndex:3,identity:current.identity}),decidedAt='2026-10-18T12:00:00.000Z';
  f.db.prepare("INSERT INTO confirmation_requests(id,brand_id,run_id,kind,object_fingerprint,status,resolved_at) VALUES(?,?,?,'slide-generation-manual-correction',?,'confirmed',?)")
    .run(manualIntentId,f.brandId,f.runId,fingerprint,decidedAt);
  f.db.prepare("INSERT INTO approvals(id,brand_id,run_id,kind,object_fingerprint,object_artifact_id,decision,confirmation_request_id,evidence_json,decided_at) VALUES(?,?,?,'slide-generation-manual-correction',?,NULL,'approved',?,'{}',?)")
    .run(randomUUID(),f.brandId,f.runId,fingerprint,manualIntentId,decidedAt);
  const reserved=await ledger.reserveManualCorrection({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:3,manualIntentId});
  assert.equal(reserved.attempt.mode,'manual-correction');assert.equal(reserved.attempt.automaticOrdinal,null);
  assert.deepEqual(reserved.automaticBudget,{limit:2,used:0,remaining:2});
  ledger.recordFailure({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,attemptId:reserved.attempt.id,errorCode:'MANUAL_CORRECTION_FAILED'});
  await assert.rejects(ledger.reserveManualCorrection({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:3,manualIntentId}),{code:'MANUAL_CORRECTION_INTENT_USED'});
});

test('two real processes racing the same identity reserve exactly one active attempt',async t=>{
  const f=await readyFixture(t),request=()=>({requestId:randomUUID(),brandId:f.brandId,runId:f.runId,slideIndex:1});
  const [a,b]=await Promise.all([generationWorker(f,request()),generationWorker(f,request())]);a.go();b.go();
  const outcomes=await Promise.all([a.result,b.result]),winners=outcomes.filter(item=>item.ok),losers=outcomes.filter(item=>!item.ok);
  assert.equal(winners.length,1,JSON.stringify(outcomes));assert.equal(losers.length,1,JSON.stringify(outcomes));
  assert.equal(losers[0].code,'GENERATION_ATTEMPT_ACTIVE');
  assert.equal(f.db.prepare('SELECT count(*) n FROM slide_generation_attempts').get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM operations WHERE operation='run.slide-generation.reserve-automatic'").get().n,1);
});
