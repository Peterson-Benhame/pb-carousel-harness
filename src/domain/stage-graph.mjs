import {PublicError,invalidArgument} from './errors.mjs';
import {exactKeys} from './brand-schema.mjs';

const descriptors = rows => Object.freeze(rows.map(([key,kind],index) => Object.freeze({key,kind,dependencies:Object.freeze(index ? [rows[index-1][0]] : [])})));
export const STAGES=descriptors([['inputs','input'],['copy-approval','approval'],['concept-approval','approval'],['assets-approval','approval'],['render','execution'],['validate','execution'],['package','execution']]);
export const STAGES_V2=descriptors([['inputs','input'],['copy-approval','approval'],['concept-approval','approval'],['assets-approval','approval'],['preview-render','execution'],['preview-review','review'],['preview-approval','approval'],['render','execution'],['validate','execution'],['quality-review','review'],['package','execution']]);
export const STAGE_KEYS=Object.freeze(STAGES.map(stage=>stage.key));
export const STAGE_KEYS_V2=Object.freeze(STAGES_V2.map(stage=>stage.key));
export const STAGE_STATUSES=Object.freeze(['pending','waiting-approval','running','succeeded','failed','invalidated']);
export function getStages({pipelineVersion=1}={}) {
 if(pipelineVersion!==1&&pipelineVersion!==2)throw new PublicError('RUN_CONTRACT_UNSUPPORTED','Versão de pipeline não suportada.');
 return pipelineVersion===1?STAGES:STAGES_V2;
}
const inconsistent=()=>{throw new PublicError('RUN_STATE_INCONSISTENT','Registros de etapas inconsistentes.');};
/** Absent rows are a pending projection, not a backfill or a completed stage. */
export function projectStages(records=[],options){
 const stages=getStages(options),keys=stages.map(stage=>stage.key);
 if(!Array.isArray(records))inconsistent();
 const byKey=new Map();
 for(const record of records){
  if(!record||!keys.includes(record.key)||!STAGE_STATUSES.includes(record.status)||byKey.has(record.key)||(record.fingerprint!=null&&!/^[a-f0-9]{64}$/.test(record.fingerprint)))inconsistent();
  if(stages.find(stage=>stage.key===record.key)?.kind==='review'&&record.status==='running')inconsistent();
  byKey.set(record.key,record);
 }
 return stages.map(stage=>{const row=byKey.get(stage.key);return {...stage,dependencies:[...stage.dependencies],status:row?.status??'pending',fingerprint:row?.fingerprint??null,persisted:Boolean(row)};});
}
export function firstPendingStage(stages,options){return projectStages(stages,options).find(stage=>stage.status!=='succeeded')?.key??null;}

const roleTransitions={
 input:{pending:['succeeded'],succeeded:['pending','invalidated'],invalidated:['pending']},
 approval:{pending:['waiting-approval'],'waiting-approval':['succeeded','failed','invalidated'],succeeded:['invalidated'],failed:['pending','invalidated'],invalidated:['pending']},
 review:{pending:['waiting-approval'],'waiting-approval':['succeeded','failed','invalidated'],succeeded:['invalidated'],failed:['pending','invalidated'],invalidated:['pending']},
 execution:{pending:['running'],running:['succeeded','failed','pending'],succeeded:['invalidated'],failed:['pending','invalidated'],invalidated:['pending']},
};
function transitions(stages){return Object.freeze(Object.fromEntries(stages.map(stage=>[stage.key,Object.freeze(Object.fromEntries(STAGE_STATUSES.map(status=>[status,Object.freeze([
 ...(roleTransitions[stage.kind][status]??[]),...(stage.key==='assets-approval'&&status==='pending'?['succeeded']:[]),
])])))])));}
export const STAGE_TRANSITIONS=transitions(STAGES);
export const STAGE_TRANSITIONS_V2=transitions(STAGES_V2);
function knownStage(key,status,options){if(!getStages(options).some(stage=>stage.key===key)||!STAGE_STATUSES.includes(status))throw invalidArgument('Etapa ou estado desconhecido.');}
export function canTransitionStage(key,from,to,options){knownStage(key,from,options);knownStage(key,to,options);return (options?.pipelineVersion===2?STAGE_TRANSITIONS_V2:STAGE_TRANSITIONS)[key][from].includes(to);}
const stageEvents=Object.freeze({
 'inputs-verified':{kind:'input',from:['pending'],to:'succeeded'},
 'inputs-incomplete':{kind:'input',from:['succeeded'],to:'pending'},
 'approval-required':{kind:'approval',from:['pending'],to:'waiting-approval'},
 'approval-granted':{kind:'approval',from:['waiting-approval'],to:'succeeded'},
 'approval-rejected':{kind:'approval',from:['waiting-approval'],to:'failed'},
 'review-required':{kind:'review',from:['pending'],to:'waiting-approval'},
 'review-passed':{kind:'review',from:['waiting-approval'],to:'succeeded'},
 'review-failed':{kind:'review',from:['waiting-approval'],to:'failed'},
 'review-unavailable':{kind:'review',from:['pending','waiting-approval'],to:null},
 'assets-not-applicable':{key:'assets-approval',from:['pending'],to:'succeeded'},
 start:{kind:'execution',from:['pending'],to:'running'},
 succeeded:{kind:'execution',from:['running'],to:'succeeded'},
 failed:{kind:'execution',from:['running'],to:'failed'},
 'attempt-interrupted':{kind:'execution',from:['running'],to:'pending'},
 invalidate:{from:['succeeded','failed','waiting-approval'],to:'invalidated'},
 reset:{from:['failed','invalidated'],to:'pending'},
});
/** These facts describe the domain only. Their verification/persistence belongs
 * to later trusted services; assets-not-applicable is never a concept approval.
 * Interruption ends the attempt; its stage remains pending for reconciliation.
 */
export function transitionStage(key,from,event,options){
 knownStage(key,from,options);exactKeys(event,['type']);
 if(typeof event.type!=='string'||!Object.hasOwn(stageEvents,event.type))throw invalidArgument('Evento de etapa inválido.');
 const rule=stageEvents[event.type],stage=getStages(options).find(s=>s.key===key);
 if(!rule.from.includes(from)||(rule.kind&&rule.kind!==stage.kind)||(rule.key&&rule.key!==key)||(rule.to!==null&&!canTransitionStage(key,from,rule.to,options)))throw new PublicError('STAGE_TRANSITION_INVALID','Transição de etapa não permitida.');
 return rule.to??from;
}
