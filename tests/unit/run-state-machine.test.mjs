import test from 'node:test';
import assert from 'node:assert/strict';

const missing = error => { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {}; };
const machine = await import('../../src/domain/run-state-machine.mjs').catch(missing);
const graph = await import('../../src/domain/stage-graph.mjs').catch(missing);
const statuses = ['draft','ready','running','waiting-approval','blocked','interrupted','completed','cancelled'];
const allowed = {
 draft:['ready','cancelled'], ready:['running','waiting-approval','blocked','cancelled','draft'],
 running:['ready','waiting-approval','blocked','interrupted','completed','cancelled'],
 'waiting-approval':['ready','blocked','cancelled','draft'], blocked:['ready','draft','cancelled'],
 interrupted:['ready','blocked','cancelled'], completed:[], cancelled:[],
};
const requireFunction = (module, name) => assert.equal(typeof module[name], 'function', `${name} must exist`);

for (const from of statuses) test(`run transition table covers every allowed and forbidden target from ${from}`, () => {
 requireFunction(machine,'canTransitionRun');
 for (const to of statuses) assert.equal(machine.canTransitionRun(from,to),allowed[from].includes(to),`${from} -> ${to}`);
});

test('run state vocabulary and transition table are immutable', () => {
 assert.deepEqual(machine.RUN_STATUSES,statuses);
 for (const state of statuses) assert.deepEqual([...machine.RUN_TRANSITIONS[state]].sort(),[...allowed[state]].sort());
 assert.throws(()=>machine.RUN_STATUSES.push('other'),TypeError);
 assert.throws(()=>machine.RUN_TRANSITIONS.draft.push('completed'),TypeError);
 assert.throws(()=>{machine.RUN_TRANSITIONS.draft=[];},TypeError);
});

const events = [
 ['draft',{type:'inputs-updated',complete:true},'ready'], ['draft',{type:'inputs-updated',complete:false},'draft'],
 ['ready',{type:'inputs-updated',complete:false},'draft'], ['ready',{type:'inputs-updated',complete:true},'ready'],
 ['ready',{type:'start'},'running'], ['ready',{type:'approval-required'},'waiting-approval'], ['ready',{type:'block'},'blocked'],
 ['running',{type:'stage-succeeded'},'ready'], ['running',{type:'approval-required'},'waiting-approval'], ['running',{type:'block'},'blocked'],
 ['running',{type:'interrupt'},'interrupted'], ['running',{type:'complete'},'completed'],
 ['waiting-approval',{type:'approval-granted'},'ready'], ['waiting-approval',{type:'approval-rejected'},'blocked'], ['waiting-approval',{type:'block'},'blocked'],
 ['waiting-approval',{type:'inputs-updated',complete:true},'ready'], ['waiting-approval',{type:'inputs-updated',complete:false},'draft'],
 ['blocked',{type:'correction-verified',complete:true},'ready'], ['blocked',{type:'correction-verified',complete:false},'draft'],
 ['interrupted',{type:'reconciled',blocked:false},'ready'], ['interrupted',{type:'reconciled',blocked:true},'blocked'],
 ...statuses.filter(s=>!['completed','cancelled'].includes(s)).map(s=>[s,{type:'cancel'},'cancelled']),
];
test('semantic events implement the entire allowed run transition table without mutating arguments', () => {
 requireFunction(machine,'transitionRun');
 const covered=new Set();
 for(const [from,event,to] of events){const original=structuredClone(event);assert.equal(machine.transitionRun(from,event),to);assert.deepEqual(event,original);covered.add(`${from}:${to}`);}
 for(const [from,targets] of Object.entries(allowed))for(const to of targets)assert.ok(covered.has(`${from}:${to}`),`${from}:${to}`);
});

test('all unsupported event/state combinations reject rather than granting a transition', () => {
 requireFunction(machine,'transitionRun');
 const unique=[...new Map(events.map(([,e])=>[JSON.stringify(e),e])).values()];
 for(const from of statuses)for(const event of unique){
  if(events.some(([s,e])=>s===from&&JSON.stringify(e)===JSON.stringify(event)))continue;
  assert.throws(()=>machine.transitionRun(from,event),{code:'RUN_TRANSITION_INVALID'},`${from}:${JSON.stringify(event)}`);
 }
});

test('terminal states reject every event including repeated cancel and completion', () => {
 requireFunction(machine,'transitionRun');requireFunction(machine,'isTerminalRun');
 for(const state of statuses)assert.equal(machine.isTerminalRun(state),['completed','cancelled'].includes(state));
 for(const state of ['completed','cancelled'])for(const [,event] of events)assert.throws(()=>machine.transitionRun(state,event),{code:'RUN_TRANSITION_INVALID'});
});

test('unknown states, events and non-boolean completion evidence fail closed', () => {
 requireFunction(machine,'transitionRun');
 for(const state of [null,'','READY','__proto__','constructor'])assert.throws(()=>machine.canTransitionRun(state,'ready'),{code:'INVALID_ARGUMENT'});
 for(const event of [null,{},'cancel',{type:'unknown'},{type:'start',approved:true},{type:'inputs-updated'},{type:'inputs-updated',complete:1},{type:'reconciled',blocked:'false'}])assert.throws(()=>machine.transitionRun('ready',event),{code:'INVALID_ARGUMENT'});
});

const keys=['inputs','copy-approval','concept-approval','assets-approval','render','validate','package'];
test('seven ordered stages have explicit dependencies and human gates stay distinct', () => {
 assert.deepEqual(graph.STAGE_KEYS,keys);
 assert.deepEqual(graph.STAGES.map(s=>s.dependencies),[[],...keys.slice(0,-1).map(k=>[k])]);
 assert.deepEqual(graph.STAGES.map(s=>s.kind),['input','approval','approval','approval','execution','execution','execution']);
 assert.throws(()=>graph.STAGES[1].dependencies.push('render'),TypeError);
});

test('missing stored steps project as pending without inventing records or skipping concept', () => {
 requireFunction(graph,'projectStages');requireFunction(graph,'firstPendingStage');
 const records=[{key:'inputs',status:'succeeded',fingerprint:'a'.repeat(64)}],original=structuredClone(records),stages=graph.projectStages(records);
 assert.equal(stages.length,7);assert.equal(stages[0].persisted,true);assert.equal(stages[1].persisted,false);
 assert.equal(graph.firstPendingStage(stages),'copy-approval');assert.deepEqual(records,original);
 assert.equal(graph.firstPendingStage(graph.projectStages(records.concat({key:'copy-approval',status:'succeeded'}))),'concept-approval');
 assert.equal(graph.firstPendingStage(graph.projectStages(keys.map(key=>({key,status:'succeeded'})))) ,null);
});

test('every non-success stage state remains pending work, including historical invalidation', () => {
 requireFunction(graph,'projectStages');
 assert.deepEqual(graph.STAGE_STATUSES,['pending','waiting-approval','running','succeeded','failed','invalidated']);
 for(const status of graph.STAGE_STATUSES){const stages=graph.projectStages(keys.map(key=>({key,status:key==='render'?status:'succeeded'})));assert.equal(graph.firstPendingStage(stages),status==='succeeded'?null:'render');}
});

test('unknown, duplicate or malformed persisted stages fail closed', () => {
 requireFunction(graph,'projectStages');
 for(const records of [[{key:'other',status:'pending'}],[{key:'inputs',status:'cancelled'}],[{key:'inputs',status:'pending'},{key:'inputs',status:'succeeded'}],[{key:'inputs',status:'succeeded',fingerprint:'invalid'}],null])assert.throws(()=>graph.projectStages(records),{code:'RUN_STATE_INCONSISTENT'});
});

const attempts=['running','succeeded','failed','interrupted','cancelled'];
for(const from of attempts)test(`attempt transition table makes ${from} ${from==='running'?'active':'terminal'}`,()=>{
 requireFunction(machine,'canTransitionAttempt');requireFunction(machine,'transitionAttempt');
 assert.deepEqual(machine.ATTEMPT_STATUSES,attempts);
 for(const to of attempts){const valid=from==='running'&&to!=='running';assert.equal(machine.canTransitionAttempt(from,to),valid);if(valid)assert.equal(machine.transitionAttempt(from,to),to);else assert.throws(()=>machine.transitionAttempt(from,to),{code:'ATTEMPT_TRANSITION_INVALID'});}
});

const stageTargets={
 inputs:{pending:['succeeded'],succeeded:['pending','invalidated'],invalidated:['pending']},
 approval:{pending:['waiting-approval'],'waiting-approval':['succeeded','failed','invalidated'],succeeded:['invalidated'],failed:['pending','invalidated'],invalidated:['pending']},
 execution:{pending:['running'],running:['succeeded','failed','pending'],succeeded:['invalidated'],failed:['pending','invalidated'],invalidated:['pending']},
};
for(const key of keys)test(`stage ${key} constrains all 36 status transitions to its actual role`,()=>{
 requireFunction(graph,'canTransitionStage');
 const expected=structuredClone(stageTargets[key==='inputs'?'inputs':key.endsWith('approval')?'approval':'execution']);
 if(key==='assets-approval')expected.pending.push('succeeded');
 for(const from of graph.STAGE_STATUSES)for(const to of graph.STAGE_STATUSES)assert.equal(graph.canTransitionStage(key,from,to),expected[from]?.includes(to)??false,`${key}:${from}->${to}`);
});

test('stage events distinguish human rejection, absent assets, verified inputs and execution results',()=>{
 requireFunction(graph,'transitionStage');
 const cases=[['inputs','pending','inputs-verified','succeeded'],['inputs','succeeded','inputs-incomplete','pending'],['copy-approval','pending','approval-required','waiting-approval'],['concept-approval','waiting-approval','approval-rejected','failed'],['copy-approval','waiting-approval','approval-granted','succeeded'],['assets-approval','pending','assets-not-applicable','succeeded'],['render','pending','start','running'],['render','running','succeeded','succeeded'],['validate','running','failed','failed'],['package','running','attempt-interrupted','pending'],['package','failed','reset','pending'],['render','succeeded','invalidate','invalidated'],['render','invalidated','reset','pending']];
 for(const [stage,from,type,to] of cases)assert.equal(graph.transitionStage(stage,from,{type}),to);
 for(const [stage,from,type] of [['concept-approval','pending','assets-not-applicable'],['render','pending','succeeded'],['copy-approval','pending','approval-granted'],['render','running','invalidate'],['inputs','pending','start'],['package','succeeded','start']])assert.throws(()=>graph.transitionStage(stage,from,{type}),{code:'STAGE_TRANSITION_INVALID'});
 assert.throws(()=>graph.transitionStage('render','pending',{type:'start',approved:true}),{code:'INVALID_ARGUMENT'});
 assert.throws(()=>graph.canTransitionStage('unknown','pending','running'),{code:'INVALID_ARGUMENT'});
});

test('event names must be strings and cannot invoke object-to-key coercion',()=>{
 for(const type of [['cancel'],{toString:()=> 'cancel'}])assert.throws(()=>machine.transitionRun('ready',{type}),{code:'INVALID_ARGUMENT'});
 for(const type of [['start'],{toString:()=> 'start'}])assert.throws(()=>graph.transitionStage('render','pending',{type}),{code:'INVALID_ARGUMENT'});
});

const keysV2=['inputs','copy-approval','concept-approval','assets-approval','preview-render','preview-review','preview-approval','render','validate','quality-review','package'];
test('Q04 pipeline 2 projects eleven explicit descriptors without changing historical seven',()=>{
 const stages=graph.projectStages([],{pipelineVersion:2});
 assert.deepEqual(stages.map(s=>s.key),keysV2);
 assert.deepEqual(stages.map(s=>s.kind),['input','approval','approval','approval','execution','review','approval','execution','execution','review','execution']);
 assert.deepEqual(stages.map(s=>s.dependencies),[[],...keysV2.slice(0,-1).map(key=>[key])]);
 assert.deepEqual(graph.projectStages().map(s=>s.key),keys);
 assert.equal(graph.firstPendingStage(keysV2.map(key=>({key,status:key==='preview-review'?'waiting-approval':'succeeded'})),{pipelineVersion:2}),'preview-review');
 assert.throws(()=>graph.projectStages([],{pipelineVersion:3}),{code:'RUN_CONTRACT_UNSUPPORTED'});
 assert.throws(()=>graph.projectStages([{key:'preview-review',status:'pending'}]),{code:'RUN_STATE_INCONSISTENT'});
});
test('Q04 review transitions never accept approval events or create execution attempts',()=>{
 for(const key of ['preview-review','quality-review']){
  assert.equal(graph.transitionStage(key,'pending',{type:'review-required'},{pipelineVersion:2}),'waiting-approval');
  assert.equal(graph.transitionStage(key,'waiting-approval',{type:'review-passed'},{pipelineVersion:2}),'succeeded');
  assert.equal(graph.transitionStage(key,'waiting-approval',{type:'review-failed'},{pipelineVersion:2}),'failed');
  for(const state of ['pending','waiting-approval'])assert.equal(graph.transitionStage(key,state,{type:'review-unavailable'},{pipelineVersion:2}),state);
  for(const type of ['start','approval-required','approval-granted'])assert.throws(()=>graph.transitionStage(key,'pending',{type},{pipelineVersion:2}),{code:'STAGE_TRANSITION_INVALID'});
 }
 assert.throws(()=>graph.transitionStage('copy-approval','waiting-approval',{type:'review-passed'},{pipelineVersion:2}),{code:'STAGE_TRANSITION_INVALID'});
});
test('Q04 review run events and unavailable blocking are explicit and terminal-safe',()=>{
 for(const state of ['ready','running'])assert.equal(machine.transitionRun(state,{type:'review-required'}),'waiting-approval');
 assert.equal(machine.transitionRun('waiting-approval',{type:'review-passed'}),'ready');
 assert.equal(machine.transitionRun('waiting-approval',{type:'review-failed'}),'blocked');
 assert.equal(machine.transitionRun('waiting-approval',{type:'block'}),'blocked');
 for(const type of ['review-required','review-passed','review-failed'])for(const state of ['completed','cancelled'])assert.throws(()=>machine.transitionRun(state,{type}),{code:'RUN_TRANSITION_INVALID'});
});

test('Q04 persisted reviews cannot masquerade as a running render attempt',()=>{
 for(const key of ['preview-review','quality-review'])assert.throws(()=>graph.projectStages([{key,status:'running'}],{pipelineVersion:2}),{code:'RUN_STATE_INCONSISTENT'});
});
