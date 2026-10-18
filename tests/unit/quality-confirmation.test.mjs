import test from 'node:test';
import assert from 'node:assert/strict';
import * as gateway from '../../src/interfaces/cli/human-confirmation.mjs';

test('quality gateway has verifier/consumer without an exported human receipt issuer', () => {
 assert.equal(typeof gateway.confirmQualityReviewProposal, 'function');
 assert.equal(typeof gateway.requireQualityReviewConfirmation, 'function');
 assert.equal(typeof gateway.consumeQualityReviewConfirmation, 'function');
 assert.equal(gateway.issueQualityReviewConfirmation, undefined);
});

import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { fingerprintQualityReviewObject, fingerprintQualityReviewProposal } from '../../src/domain/quality-evidence.mjs';
import { evidenceFixture, id } from '../fixtures/quality/evidence-fixture.mjs';
const presentationApi = await import('../../src/interfaces/cli/quality-presentation.mjs').catch(() => ({}));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);

async function fixture(kind = 'preview') {
 const f = evidenceFixture(kind), files = [];
 for (const file of f.manifest.files) {
  const bytes = await sharp({create:{width:file.width,height:file.height,channels:4,background:'#264262'}}).png().toBuffer();
  file.size = bytes.length; file.artifactRef.sha256 = digest(bytes);
  file.rgbaSha256 = digest(await sharp(bytes).ensureAlpha().raw().toBuffer());
  files.push({artifactId:file.artifactRef.id,bytes});
 }
 const manifestRef = {...f.expected.manifestRef,sha256:canonicalHash(f.manifest)};
 const proposal = {schemaVersion:1,brandId:f.review.brandId,runId:f.review.runId,kind,confirmationRequestId:f.review.confirmationRequestId,runVersion:7,
  objectFingerprint:f.review.objectFingerprint,manifestRef,objectiveReportRef:f.review.objectiveReportRef,manifest:f.manifest,rubricRef:f.review.rubricRef,checkerRefs:f.review.checkerRefs};
 proposal.objectFingerprint = fingerprintQualityReviewObject({brandId:proposal.brandId,runId:proposal.runId,kind,renderAttemptId:proposal.manifest.renderAttemptId,manifestRef,planHash:proposal.manifest.planRef.sha256,selectionHash:proposal.manifest.selectionHash,qualificationRefs:proposal.manifest.qualifications,objectiveReportRef:proposal.objectiveReportRef,rubricRef:proposal.rubricRef,checkerRefs:proposal.checkerRefs});
 return {proposal,files};
}
function terminal(ask = async () => 'CANCELAR') {
 let shown = '';
 return {input:{isTTY:true},output:{isTTY:true,write:text=>{shown += text;}},argv:[],ask,get shown(){return shown;}};
}
async function prepare(f) {
 assert.equal(typeof presentationApi.createQualityPresentation,'function');
 return presentationApi.createQualityPresentation(f.proposal,f.files);
}
/** Synthetic transport simulation only: exercises the production loopback protocol;
 * no fixture is a real human review or evidence qualifying a layout. */
async function simulatePixelProtocol(url, inspect) {
 const page = await fetch(url).then(r=>r.text());
 const data = JSON.parse(page.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
 await inspect?.(data,page);
 let code;
 for (const [index,screen] of data.screens.entries()) {
  const image = await fetch(new URL(screen.url,url));assert.equal(image.status,200);
  assert.equal(digest(Buffer.from(await image.arrayBuffer())),screen.sha256);
  const response = await fetch(new URL('attest',url),{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(url).origin},body:JSON.stringify({screen:index})});
  assert.equal(response.status,200);const result = await response.json();code = result.code ?? code;
 }
 return code;
}
function simulatedReview(io,{inspect,result='ATENDE',final='CONFIRMAR',mutate}={}) {
 io.ask = async prompt => {
  if(prompt.includes('código'))return simulatePixelProtocol(io.shown.match(/http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\//)[0],inspect);
  if(prompt.includes('Resultado'))return result;
  if(prompt.includes('Observação'))return 'Synthetic protocol test only; not actual human inspection.';
  if(prompt.includes('CONFIRMAR')){mutate?.();return final;}
  assert.fail(`Unexpected prompt: ${prompt}`);
 };
 return io;
}

test('noninteractive streams and automation flags cannot enter a quality review', async () => {
 const {proposal} = await fixture();
 for(const change of [{input:{isTTY:false}},{output:{isTTY:false}},{argv:['--yes']},{argv:['-y']},{argv:['--json']},{argv:['--actor=human']},{argv:['--approved=true']}]) {
  await assert.rejects(gateway.confirmQualityReviewProposal(proposal,{...terminal(()=>assert.fail('must not ask')),...change}),{code:'QUALITY_REVIEW_UNAVAILABLE'});
 }
});
test('missing, serialized or arbitrary presentation capability never attests pixels', async () => {
 const f = await fixture();
 for(const presentation of [undefined,{}, {displayed:true,fullResolution:true}])await assert.rejects(gateway.confirmQualityReviewProposal(f.proposal,{...terminal(),presentation}),{code:'QUALITY_REVIEW_UNAVAILABLE'});
 const presentation = await prepare(f);
 await assert.rejects(gateway.confirmQualityReviewProposal(f.proposal,{...terminal(),presentation:JSON.parse(JSON.stringify(presentation))}),{code:'QUALITY_REVIEW_UNAVAILABLE'});
});
test('presentation validates exact PNG bytes, dimensions, decoded pixels and proposal scope', async () => {
 const f = await fixture();assert.equal(typeof presentationApi.createQualityPresentation,'function');
 for(const mutate of [x=>x.files[0].bytes.fill(0),x=>x.files.pop(),x=>x.files.push(x.files[0]),x=>x.proposal.manifest.files[0].rgbaSha256='a'.repeat(64),x=>x.proposal.runId=id(99),x=>x.proposal.actor='human']) {
  const candidate = {proposal:clone(f.proposal),files:f.files.map(x=>({...x,bytes:Buffer.from(x.bytes)}))};mutate(candidate);
  await assert.rejects(presentationApi.createQualityPresentation(candidate.proposal,candidate.files),{code:'QUALITY_REVIEW_UNAVAILABLE'});
 }
 const presentation = await prepare(f), changed = {...f.proposal,runVersion:8};
 await assert.rejects(gateway.confirmQualityReviewProposal(changed,{...terminal(),presentation}),{code:'QUALITY_REVIEW_UNAVAILABLE'});
});
test('real pixel protocol covers full and mobile views; checklist receipt binds exact answers and complete proposal', async () => {
 const f = await fixture(),presentation = await prepare(f),io = terminal();
 f.files[0].bytes.fill(0); // the presentation owns immutable byte copies
 const result = await gateway.confirmQualityReviewProposal(f.proposal,{...simulatedReview(io,{inspect:data=>{
  for(const file of f.proposal.manifest.files) {
   const full = data.screens.filter(s=>s.artifactId===file.artifactRef.id&&s.mode==='full');
   assert.ok(full.length>1);assert.ok(full.every(s=>s.scale===1));
   const mobile = data.screens.filter(s=>s.artifactId===file.artifactRef.id&&s.mode==='mobile');
   assert.ok(mobile.length);assert.ok(mobile.every(s=>s.scale===1/3));
  }
 }}),presentation});
 assert.equal(result.answers.criteria.length,18);
 assert.equal(result.answers.coverage.fullResolution,true);
 assert.ok(result.answers.coverage.files.every(f=>f.viewedFull&&f.viewedMobile));
 assert.match(io.shown,/legibility/);assert.match(io.shown,/visual-semantics/);assert.match(io.shown,/Synthetic protocol test/);
 const evidence = gateway.requireQualityReviewConfirmation(result.receipt,f.proposal,result.answers);
 assert.equal(evidence.channel,'local-terminal');assert.equal(evidence.proposalHash,canonicalHash(f.proposal));
 assert.equal(evidence.reviewProposalHash,fingerprintQualityReviewProposal({objectFingerprint:f.proposal.objectFingerprint,confirmationRequestId:f.proposal.confirmationRequestId,...result.answers}));
 assert.match(evidence.id,/^[a-f0-9-]{36}$/);assert.match(evidence.sessionId,/^[a-f0-9-]{36}$/);
 for(const fake of [null,{},JSON.parse(JSON.stringify(result.receipt)),{actor:'human',approved:true}])assert.throws(()=>gateway.requireQualityReviewConfirmation(fake,f.proposal,result.answers),{code:'EDITORIAL_REVIEW_REQUIRED'});
 for(const change of [p=>p.runVersion++,p=>p.brandId=id(80),p=>p.confirmationRequestId=id(81),p=>p.manifest.files[0].size++]) {
  const p=clone(f.proposal);change(p);assert.throws(()=>gateway.requireQualityReviewConfirmation(result.receipt,p,result.answers),{code:'QUALITY_EVIDENCE_STALE'});
 }
 for(const change of [a=>a.coverage.files[0].viewedFull=false,a=>a.criteria[0].result='failed',a=>a.criteria[0].observation+='!',a=>a.findings.push({id:id(92)})]) {
  const a=clone(result.answers);change(a);assert.throws(()=>gateway.requireQualityReviewConfirmation(result.receipt,f.proposal,a),{code:'QUALITY_EVIDENCE_STALE'});
 }
 gateway.consumeQualityReviewConfirmation(result.receipt);
 assert.throws(()=>gateway.requireQualityReviewConfirmation(result.receipt,f.proposal,result.answers),{code:'EDITORIAL_REVIEW_REQUIRED'});
});
test('final panorama uses full windows, one-third mobile windows and a separate overview', async () => {
 const f = await fixture('final'),io=terminal();
 const result = await gateway.confirmQualityReviewProposal(f.proposal,{...simulatedReview(io,{inspect:data=>{
  const screens=data.screens.filter(s=>s.artifactId===f.proposal.manifest.files.at(-1).artifactRef.id);
  assert.ok(screens.some(s=>s.mode==='overview'));
  assert.ok(screens.filter(s=>s.mode==='mobile').length>1);
  assert.ok(screens.filter(s=>s.mode==='mobile').every(s=>s.scale===1/3));
 }}),presentation:await prepare(f)});
 assert.equal(result.answers.criteria.length,30);assert.equal(result.answers.coverage.panorama,f.proposal.manifest.files.at(-1).artifactRef.id);
});
test('failed criteria create blocking findings; not-verified is retained without a pass claim', async () => {
 for(const status of ['FALHA','NAO-VERIFICADO']) {
  const f=await fixture(),io=terminal();
  const result=await gateway.confirmQualityReviewProposal(f.proposal,{...simulatedReview(io,{result:status}),presentation:await prepare(f)});
  assert.ok(result.answers.criteria.every(c=>c.result===(status==='FALHA'?'failed':'not-verified')));
  assert.equal(result.answers.findings.length,status==='FALHA'?18:0);
  assert.ok(result.answers.findings.every(f=>f.severity==='blocking'));
 }
});
test('wrong browser challenge, cancellation and EOF cannot issue a receipt', async () => {
 const f=await fixture();
 await assert.rejects(gateway.confirmQualityReviewProposal(f.proposal,{...terminal(async()=> 'guessed'),presentation:await prepare(f)}),{code:'QUALITY_REVIEW_UNAVAILABLE'});
 assert.equal(await gateway.confirmQualityReviewProposal(f.proposal,{...terminal(async()=> 'CANCELAR'),presentation:await prepare(f)}),null);
 const abort=terminal(async()=>{throw Object.assign(new Error('EOF'),{name:'AbortError'});});
 assert.equal(await gateway.confirmQualityReviewProposal(f.proposal,{...abort,presentation:await prepare(f)}),null);
 const io=terminal();assert.equal(await gateway.confirmQualityReviewProposal(f.proposal,{...simulatedReview(io,{final:'no'}),presentation:await prepare(f)}),null);
});
test('browser protocol rejects cross-origin acknowledgement and skipped windows', async () => {
 const f=await fixture(),io=terminal();
 const result=await gateway.confirmQualityReviewProposal(f.proposal,{...simulatedReview(io,{inspect:async(data)=>{
  const url=io.shown.match(/http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\//)[0];
  for(const [origin,screen] of [['https://elsewhere.invalid',0],[new URL(url).origin,1],[new URL(url).origin,0]]) {
   const response=await fetch(new URL('attest',url),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({screen})});
   assert.ok(response.status>=400);
  }
 }}),presentation:await prepare(f)});
 assert.ok(result.receipt);
 const url=io.shown.match(/http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\//)[0];
 await assert.rejects(fetch(url));
});

import vm from 'node:vm';
import { PassThrough } from 'node:stream';
test('browser only enables window attestation once exact pixels fit wholly in its visible viewport', async () => {
 const f=await fixture(),io=terminal();
 const result=await gateway.confirmQualityReviewProposal(f.proposal,{...simulatedReview(io,{inspect:async(data,page)=>{
  const events={},nodes={};
  for(const id of ['review-data','pixels','frame','next','status','fingerprint','label'])nodes[id]={style:{},disabled:true,textContent:'',addEventListener:(event,fn)=>{events[id+':'+event]=fn;}};
  nodes['review-data'].textContent=JSON.stringify(data);
  Object.assign(nodes.pixels,{naturalWidth:1080,naturalHeight:1350,decode:async()=>{},getBoundingClientRect:()=>({width:parseFloat(nodes.pixels.style.width)})});
  nodes.frame.getBoundingClientRect=()=>({left:20,top:100,right:20+parseFloat(nodes.frame.style.width),bottom:100+parseFloat(nodes.frame.style.height)});
  const window={innerWidth:500,innerHeight:400,visualViewport:{scale:1},addEventListener:(event,fn)=>{events[event]=fn;}};
  const context={document:{getElementById:id=>nodes[id]},window,requestAnimationFrame:fn=>queueMicrotask(fn),fetch:()=>new Promise(()=>{})};
  const script=page.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.next.disabled,true,'a clipped viewport cannot attest an unseen full window');
  window.innerWidth=1280;window.innerHeight=1000;events.resize();
  assert.equal(nodes.next.disabled,false);
  events['next:click']();events.scroll();
  assert.equal(nodes.next.disabled,true,'a pending acknowledgement cannot be duplicated by a scroll event');
 }}),presentation:await prepare(f)});
 assert.ok(result.receipt);
});
test('default readline quality adapter cancels cleanly on EOF and Ctrl-C after opening presentation', async () => {
 const f=await fixture();
 for(const cancel of [input=>input.end(),input=>input.write('\u0003')]) {
  const input=new PassThrough(),output=new PassThrough();input.isTTY=true;output.isTTY=true;
  output.on('data',chunk=>{if(chunk.toString().includes('Digite o código'))setImmediate(()=>cancel(input));});
  try{assert.equal(await gateway.confirmQualityReviewProposal(f.proposal,{presentation:await prepare(f),input,output,argv:[]}),null);}finally{input.destroy();output.destroy();}
 }
});
test('proposal changed during final confirmation cannot reuse the receipt for the changed proposal', async () => {
 const f=await fixture(),io=terminal();
 const result=await gateway.confirmQualityReviewProposal(f.proposal,{...simulatedReview(io,{mutate:()=>f.proposal.runVersion++}),presentation:await prepare(f)});
 assert.throws(()=>gateway.requireQualityReviewConfirmation(result.receipt,f.proposal,result.answers),{code:'QUALITY_EVIDENCE_STALE'});
});

import { spawnSync } from 'node:child_process';
test('brand and approval gateways remain importable when the pixel decoder is unavailable', () => {
 const hook=`import { registerHooks } from 'node:module'; registerHooks({resolve(specifier,context,next){if(specifier==='sharp')throw Error('Synthetic unavailable image decoder');return next(specifier,context);}});`;
 const moduleUrl=new URL('../../src/interfaces/cli/human-confirmation.mjs',import.meta.url).href;
 const program=`const gateway=await import(${JSON.stringify(moduleUrl)});const proposal={action:'brand.create',brandId:'b',requestId:'r'};const receipt=await gateway.confirmBrandProposal(proposal,{input:{isTTY:true},output:{isTTY:true,write(){}},argv:[],ask:async()=> 'CONFIRMAR'});if(gateway.requireBrandConfirmation(receipt,proposal).channel!=='local-terminal')process.exit(2);`;
 const child=spawnSync(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(hook)}`,'--input-type=module','-e',program],{encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);
});
