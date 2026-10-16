import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmBrandProposal, requireBrandConfirmation } from '../../src/interfaces/cli/human-confirmation.mjs';
const proposal={action:'brand.create',brandId:'b',expectedRevision:null,requestId:'r',config:{name:'Synthetic'}};
function terminal(answer='CONFIRMAR') { let shown='';return {input:{isTTY:true},output:{isTTY:true,write(text){shown+=text;}},argv:[],ask:async()=>answer,get shown(){return shown;}}; }
test('receipt binds exact action, request, scope, revision and complete proposal',async()=>{
 const io=terminal(); const receipt=await confirmBrandProposal(proposal,io);
 assert.match(io.shown,/Synthetic/);assert.match(io.shown,/brand.create/);
 assert.equal(requireBrandConfirmation(receipt,proposal).channel,'local-terminal');
 for(const p of [{...proposal,action:'brand.update'},{...proposal,brandId:'other'},{...proposal,expectedRevision:1},{...proposal,requestId:'other'},{...proposal,config:{name:'Changed'}}])assert.throws(()=>requireBrandConfirmation(receipt,p),{code:'APPROVAL_REQUIRED'});
 for(const fake of [{approved:true},{actor:'user'},JSON.parse(JSON.stringify(receipt)),null])assert.throws(()=>requireBrandConfirmation(fake,proposal),{code:'APPROVAL_REQUIRED'});
});
test('cancel, EOF and interrupt do not issue receipts',async()=>{
 for(const answer of ['','sim','no',null])assert.equal(await confirmBrandProposal(proposal,terminal(answer)),null);
 const io=terminal();io.ask=async()=>{throw Object.assign(new Error('abort'),{name:'AbortError'});};assert.equal(await confirmBrandProposal(proposal,io),null);
});
test('redirected streams and automation flags cannot confirm',async()=>{
 for(const overrides of [{input:{isTTY:false}},{output:{isTTY:false}},{argv:['--yes']},{argv:['--approved=true']},{argv:['--actor=user']},{argv:['--json']}]) {
  const io={...terminal(),...overrides,ask:async()=>assert.fail('must not prompt')};await assert.rejects(confirmBrandProposal(proposal,io),{code:'APPROVAL_REQUIRED'});
 }
});
test('proposal snapshot cannot change while the prompt is open',async()=>{
 const p=structuredClone(proposal),io=terminal();io.ask=async()=>{p.config.name='Changed';return 'CONFIRMAR';};
 const receipt=await confirmBrandProposal(p,io);assert.throws(()=>requireBrandConfirmation(receipt,p),{code:'APPROVAL_REQUIRED'});
});
test('real readline adapter resolves cancellation on terminal EOF and Ctrl-C (simulated streams)',async()=>{
 const {PassThrough}=await import('node:stream');
 for(const cancel of [input=>input.end(),input=>input.write('\u0003')]) {
  const input=new PassThrough(),output=new PassThrough();input.isTTY=true;output.isTTY=true;output.resume();
  const promise=confirmBrandProposal(proposal,{input,output,argv:[]});setImmediate(()=>cancel(input));
  try {assert.equal(await promise,null);} finally {input.destroy();output.destroy();}
 }
});
