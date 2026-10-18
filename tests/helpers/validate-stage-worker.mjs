// Synthetic subprocess fixture. Never a public execution or approval endpoint.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {registerHooks} from 'node:module';
const [root,packageRoot,requestJson,mode]=process.argv.slice(2),request=JSON.parse(requestJson);
const from=file=>import(pathToFileURL(path.join(packageRoot,file)).href);
const checks=[];globalThis.__t21Checks=checks;
if(mode==='spy'){
 const target=pathToFileURL(path.join(packageRoot,'src/quality/objective-checks.mjs')).href;
 registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);if(url!==target)return result;const entry='export async function evaluateRenderedQuality(input) {';
  const source=result.source.toString();if(!source.includes(entry))throw Error('Checker entry changed; update test-only instrumentation.');
  return {...result,source:source.replace(entry,`${entry}\nglobalThis.__t21Checks.push(input.manifest.kind);`)};
 }});
}
let db;
try{
 const {openWorkspace}=await from('src/infrastructure/sqlite/database.mjs');db=await openWorkspace(root,{readonly:false});
 const {createValidateStage}=await from('src/application/stages/validate-stage.mjs');
 const hooks=mode==='hold'?{beforeCommit:info=>new Promise(resolve=>{process.once('message',resolve);process.send({type:'beforeCommit',...info});})}:{};
 const service=await createValidateStage({root,db,packageRoot,hooks}),result=await service.execute(request);process.send({type:'result',ok:true,result,checks});
}catch(error){process.send({type:'result',ok:false,code:error.code??'WORKER_FAILURE'});}
finally{if(db?.open)db.close();process.disconnect();}
