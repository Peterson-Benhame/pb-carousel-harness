import {PublicError,invalidArgument} from './errors.mjs';
import {exactKeys} from './brand-schema.mjs';

export const RUN_STATUSES=Object.freeze(['draft','ready','running','waiting-approval','blocked','interrupted','completed','cancelled']);
export const RUN_TRANSITIONS=Object.freeze(Object.fromEntries(Object.entries({
 draft:['ready','cancelled'],
 ready:['running','waiting-approval','blocked','cancelled','draft'],
 running:['ready','waiting-approval','blocked','interrupted','completed','cancelled'],
 'waiting-approval':['ready','blocked','cancelled','draft'],
 blocked:['ready','draft','cancelled'],
 interrupted:['ready','blocked','cancelled'],
 completed:[],cancelled:[],
}).map(([state,targets])=>[state,Object.freeze(targets)])));
export const ATTEMPT_STATUSES=Object.freeze(['running','succeeded','failed','interrupted','cancelled']);
const known=(states,state)=>{if(!states.includes(state))throw invalidArgument('Estado desconhecido.');};
export function isTerminalRun(state){known(RUN_STATUSES,state);return state==='completed'||state==='cancelled';}
export function canTransitionRun(from,to){known(RUN_STATUSES,from);known(RUN_STATUSES,to);return RUN_TRANSITIONS[from].includes(to);}

const events=Object.freeze({
 start:{ready:'running'},
 'approval-required':{ready:'waiting-approval',running:'waiting-approval'},
 'approval-granted':{'waiting-approval':'ready'},
 'approval-rejected':{'waiting-approval':'blocked'},
 'review-required':{ready:'waiting-approval',running:'waiting-approval'},
 'review-passed':{'waiting-approval':'ready'},
 'review-failed':{'waiting-approval':'blocked'},
 block:{ready:'blocked',running:'blocked','waiting-approval':'blocked'},
 'stage-succeeded':{running:'ready'},
 interrupt:{running:'interrupted'},complete:{running:'completed'},
 cancel:Object.fromEntries(RUN_STATUSES.filter(s=>!isTerminalRun(s)).map(s=>[s,'cancelled'])),
});
/** Pure transition semantics, never an authorization or execution API. Callers
 * must establish facts through their own trusted service before persisting them.
 * T13 exposes none of these events through the runtime's read-only interface.
 */
export function transitionRun(state,event){
 known(RUN_STATUSES,state);
 if(typeof event?.type!=='string')throw invalidArgument('Evento de execução inválido.');
 const conditional=['inputs-updated','correction-verified','reconciled'].includes(event?.type);
 const field=event?.type==='reconciled'?'blocked':'complete';
 exactKeys(event,['type',...(conditional?[field]:[])]);
 if(conditional&&typeof event[field]!=='boolean'||!conditional&&!Object.hasOwn(events,event.type))throw invalidArgument('Evento de execução inválido.');
 let next;
 if(event.type==='inputs-updated'&&['draft','ready','waiting-approval'].includes(state))next=event.complete?'ready':'draft';
 else if(event.type==='correction-verified'&&state==='blocked')next=event.complete?'ready':'draft';
 else if(event.type==='reconciled'&&state==='interrupted')next=event.blocked?'blocked':'ready';
 else if(!conditional)next=Object.hasOwn(events[event.type],state)?events[event.type][state]:undefined;
 // An input save can preserve draft/ready; terminal states never accept events.
 if(next===undefined||(next!==state&&!canTransitionRun(state,next)))throw new PublicError('RUN_TRANSITION_INVALID','Transição de execução não permitida.');
 return next;
}
export function canTransitionAttempt(from,to){known(ATTEMPT_STATUSES,from);known(ATTEMPT_STATUSES,to);return from==='running'&&to!=='running';}
export function transitionAttempt(from,to){if(!canTransitionAttempt(from,to))throw new PublicError('ATTEMPT_TRANSITION_INVALID','Tentativa encerrada ou transição não permitida.');return to;}
