// Synthetic process-only executor. This is not a public CLI/plugin command.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {registerHooks} from 'node:module';
const [root,packageRoot,requestJson,mode]=process.argv.slice(2),request=JSON.parse(requestJson);
const from=file=>import(pathToFileURL(path.join(packageRoot,file)).href);
const spy={composedIndices:[],rasterizedIndices:[]};globalThis.__t20Spy=spy;
if(mode==='spy'){
 const target=pathToFileURL(path.join(packageRoot,'src/render/composed-carousel.mjs')).href;
 registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);if(url!==target)return result;let source=result.source.toString();
  const composition='async function composeSlide({source,entry,definition,brand,theme,resources,total,links}) {',raster='async function raster(svg) {';
  if(!source.includes(composition)||!source.includes(raster))throw Error('Composition entry changed; update test-only instrumentation.');
  source=source.replace(composition,`${composition}\nglobalThis.__t20Spy.composedIndices.push(entry.slideIndex);`).replace(raster,`${raster}\nglobalThis.__t20Spy.rasterizedIndices.push(Number(svg.match(/data-slide-index="(\\d+)"/)[1]));`);return {...result,source};
 }});
}
let db;
try{
 const {openWorkspace}=await from('src/infrastructure/sqlite/database.mjs');db=await openWorkspace(root,{readonly:false});
 const {createRenderStage}=await from('src/application/stages/render-stage.mjs');
 const hooks=mode==='hold'?{beforeCommit:info=>new Promise(resolve=>{process.once('message',()=>resolve());process.send({type:'beforeCommit',...info});})}:{};
 const service=await createRenderStage({root,db,packageRoot,hooks}),result=await service.execute(request);process.send({type:'result',ok:true,result,spy});
}catch(error){process.send({type:'result',ok:false,code:error.code??'WORKER_FAILURE'});}
finally{if(db?.open)db.close();process.disconnect();}
