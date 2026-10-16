import {existsSync} from 'node:fs';
import path from 'node:path';
import {openWorkspace} from '../../src/infrastructure/sqlite/database.mjs';
import {acquireMaintenance,releaseMaintenance} from '../../src/infrastructure/sqlite/maintenance.mjs';
import {acquireRunLease,commitRunLease,revokeRunLease,releaseRunLease} from '../../src/application/run-lease.mjs';

// An IPC-only synthetic worker: no renderers, production inputs, or heartbeat timers.
const root=process.argv[2];
const db=await openWorkspace(root,{readonly:false});
let prepared,lease,maintenance;
const send=message=>process.send(message);
const sleeper=new Int32Array(new SharedArrayBuffer(4));

function clockFor(job,id){
 let blocked=false;
 return {now(){
  // Stop only after the real API owns its SQLite write transaction. The parent
  // opens the gate after the competing process has tried the same database.
  if(job.transactionGate&&!blocked&&db.inTransaction){
   blocked=true;
   const gate=path.join(root,job.transactionGate);
   if(path.dirname(gate)!==path.resolve(root))throw new Error('Invalid test transaction gate');
   send({type:'locked',id});
   const deadline=performance.now()+10000;
   while(!existsSync(gate)){
    if(performance.now()>=deadline)throw new Error('Test transaction gate timed out');
    Atomics.wait(sleeper,0,0,10);
   }
  }
  return job.now;
 }};
}

function execute(job,id){
 const clock=clockFor(job,id);
 switch(job.action){
  case 'acquire':
   lease=acquireRunLease(db,job.request,{clock});
   return lease;
  case 'maintenance':
   maintenance=acquireMaintenance(db,{owner:job.owner,purpose:'synthetic race',now:()=>clock.now()});
   return maintenance;
  case 'release-maintenance':
   return releaseMaintenance(db,maintenance,{now:()=>clock.now()});
  case 'revoke':
   return revokeRunLease(db,job.lease,{clock});
  case 'release':
   return releaseRunLease(db,lease,{clock});
  case 'commit':
   return commitRunLease(db,lease,job.request,({db,emit})=>{
    const {brandId,runId}=job.request;
    db.prepare('UPDATE runs SET version=version+1 WHERE brand_id=? AND id=?').run(brandId,runId);
    db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path) VALUES(?,?,?,?,?,?,?)')
     .run(job.artifactId,brandId,runId,'synthetic-lease-result',1,'a'.repeat(64),`synthetic/${job.artifactId}.json`);
    emit({id:job.eventId,eventType:'synthetic.lease-committed'});
    return {status:'committed',result:{artifactId:job.artifactId,owner:lease.owner}};
   },{clock});
  default:throw new Error(`Unknown synthetic worker action: ${job.action}`);
 }
}

function close(){
 if(db.open)db.close();
 if(process.connected)process.disconnect();
}
process.on('message',message=>{
 if(message.type==='stop'){close();return;}
 if(message.type==='prepare'){
  if(prepared)throw new Error('Synthetic worker already has an armed job');
  prepared=message;
  send({type:'armed',id:message.id});
  return;
 }
 if(message.type!=='go'||!prepared||message.id!==prepared.id)throw new Error('Invalid synthetic worker barrier');
 const {id,job}=prepared;
 prepared=null;
 send({type:'started',id});
 try{send({type:'result',id,ok:true,value:execute(job,id)??null});}
 catch(error){send({type:'result',id,ok:false,error:{code:error.code??'WORKER_FAILURE',message:error.message}});}
});
process.on('disconnect',()=>{if(db.open)db.close();});
send({type:'ready'});
