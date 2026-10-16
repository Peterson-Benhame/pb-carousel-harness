import {openWorkspace} from '../../src/infrastructure/sqlite/database.mjs';
import {commitRunLease} from '../../src/application/run-lease.mjs';
import {createRunControl} from '../../src/application/run-control.mjs';
import {randomUUID} from 'node:crypto';

// Synthetic IPC executor deliberately ignores the cooperative stop signal. It
// retains only the original lease identity, never a token re-read from SQLite.
const db=await openWorkspace(process.argv[2],{readonly:false});let lease=null;
process.on('message',async message=>{
 if(message.type==='stop'){db.close();process.disconnect();return;}
 if(message.type==='signal'){process.send({type:'ignored'});return;}
 if(message.type==='arm'){lease=message.lease;process.send({type:'armed'});return;}
 try{
  if(message.type==='publish'){
   const result=commitRunLease(db,lease,{requestId:message.requestId,brandId:lease.brandId,runId:lease.runId,operation:'synthetic.control.publish',payload:{}},({emit})=>{
    const id=randomUUID();db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path) VALUES(?,?,?,?,1,?,?)').run(id,lease.brandId,lease.runId,'synthetic-partial','a'.repeat(64),`synthetic/${id}.bin`);
    db.prepare('UPDATE step_attempts SET status=\'succeeded\',result_artifact_id=? WHERE id=?').run(id,message.attemptId);emit({id:randomUUID(),eventType:'synthetic.published'});return {status:'committed',result:{id}};
   },{clock:{now:()=>1000}});process.send({type:'result',ok:true,result});return;
  }
  if(message.type==='replay'){const service=createRunControl({db,clock:{now:()=>1000},signalAttempt(){throw Error('Replay must never signal');}});process.send({type:'result',ok:true,result:await service[message.kind](message.request)});return;}
  throw Error('Unknown test control message');
 }catch(error){process.send({type:'result',ok:false,code:error.code??'WORKER_FAILURE'});}
});
process.on('disconnect',()=>{if(db.open)db.close();});process.send({type:'ready'});
