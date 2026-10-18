import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { canonicalHash, canonicalJson } from '../../domain/canonical-json.mjs';
import { validateIdentifier } from '../../domain/identifiers.mjs';
import { PublicError } from '../../domain/errors.mjs';
import { fingerprintQualityReviewObject, validateRenderManifest } from '../../domain/quality-evidence.mjs';

const presentations = new WeakMap();
const fields = ['schemaVersion','brandId','runId','kind','confirmationRequestId','runVersion','objectFingerprint','manifestRef','objectiveReportRef','manifest','rubricRef','checkerRefs'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const unavailable = () => new PublicError('QUALITY_REVIEW_UNAVAILABLE','A apresentação local dos pixels exatos está indisponível.');
function freeze(value) { if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; }
function normalizeProposal(value) {
 const p = JSON.parse(canonicalJson(value));
 if(!p || Object.keys(p).length!==fields.length || !fields.every(k=>Object.hasOwn(p,k)) || p.schemaVersion!==1 || !Number.isSafeInteger(p.runVersion) || p.runVersion<1)throw unavailable();
 validateIdentifier(p.confirmationRequestId);
 const m = validateRenderManifest(p.manifest);
 if(p.brandId!==m.brandId || p.runId!==m.runId || p.kind!==m.kind || canonicalJson(p.manifestRef)!==canonicalJson({id:m.id,kind:`render-manifest:${m.kind}`,version:m.version,sha256:canonicalHash(m)}))throw unavailable();
 const fingerprint = fingerprintQualityReviewObject({brandId:p.brandId,runId:p.runId,kind:p.kind,renderAttemptId:m.renderAttemptId,manifestRef:p.manifestRef,planHash:m.planRef.sha256,selectionHash:m.selectionHash,qualificationRefs:m.qualifications,objectiveReportRef:p.objectiveReportRef,rubricRef:p.rubricRef,checkerRefs:p.checkerRefs});
 if(fingerprint!==p.objectFingerprint)throw unavailable();
 return freeze(p);
}

/** Internal service-to-terminal capability, never JSON or a public grant operation.
 * The service resolves scoped artifacts before calling this function. Copies and
 * decoded hashes bind those exact bytes; this capability does not attest viewing.
 * As with local TTY consent, unrestricted hostile module/OS access is out of scope.
 */
export async function createQualityPresentation(proposal, files) {
 try {
  const p = normalizeProposal(proposal);
  const { default: sharp } = await import('sharp');
  if(!Array.isArray(files) || files.length!==p.manifest.files.length)throw unavailable();
  const copies = files.map(f=>{
   if(!f || typeof f.artifactId!=='string' || !Buffer.isBuffer(f.bytes))throw unavailable();
   return {artifactId:f.artifactId,bytes:Buffer.from(f.bytes)};
  });
  if(new Set(copies.map(f=>f.artifactId)).size!==copies.length)throw unavailable();
  for(const f of p.manifest.files) {
   const bytes = copies.find(c=>c.artifactId===f.artifactRef.id)?.bytes;
   if(!bytes || bytes.length!==f.size || sha256(bytes)!==f.artifactRef.sha256)throw unavailable();
   const decoded = sharp(bytes,{limitInputPixels:40_000_000}), metadata = await decoded.metadata();
   if(metadata.format!=='png' || (metadata.pages && metadata.pages!==1) || metadata.width!==f.width || metadata.height!==f.height || sha256(await decoded.ensureAlpha().raw().toBuffer())!==f.rgbaSha256)throw unavailable();
  }
  const capability = Object.freeze({});
  presentations.set(capability,{proposal:p,proposalHash:canonicalHash(p),files:copies,active:false});
  return capability;
 } catch { throw unavailable(); }
}
function offsets(size,window) {
 const result=[0];
 while(result.at(-1)+window<size)result.push(Math.min(size-window,result.at(-1)+window));
 return result;
}
function makeScreens(manifest, base) {
 const screens=[];
 for(const f of manifest.files) {
  const modes=[['full',1],['mobile',1/3],...(f.role==='panorama'?[['overview',Math.min(1/3,720/f.width)]]:[])];
  for(const [mode,scale] of modes) {
   const scaledWidth=f.width*scale,scaledHeight=f.height*scale,width=Math.min(720,scaledWidth),height=Math.min(600,scaledHeight);
   for(const y of offsets(scaledHeight,height))for(const x of offsets(scaledWidth,width))screens.push({artifactId:f.artifactRef.id,sha256:f.artifactRef.sha256,role:f.role,slideIndex:f.slideIndex,pair:f.pair,mode,scale,x,y,width,height,sourceWidth:f.width,sourceHeight:f.height,url:`${base}image/${f.artifactRef.id}`});
  }
 }
 return screens;
}
function html(data,nonce) {
 // All variable content is inert JSON; DOM labels use textContent, not innerHTML.
 const json=JSON.stringify(data).replaceAll('<','\\u003c');
 return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Revisão local dos pixels</title>
<style nonce="${nonce}">body{font:16px system-ui;margin:20px;background:#eee;color:#111}h1{font-size:20px}#frame{position:relative;overflow:hidden;background:#ccc;border:1px solid #555}#pixels{position:absolute;max-width:none;max-height:none}button{font:inherit;margin:12px 0;padding:12px}#status{white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}</style>
<h1>Inspeção humana local</h1><p>Use zoom de 100%. Leia cada janela antes de avançar. As janelas percorrem todos os pixels; a escala móvel conserva 360 px por lâmina. Esta apresentação não aprova a qualidade.</p><p id="label"></p><div id="frame"><img id="pixels" alt="Pixels exatos do artefato em revisão"></div><button id="next" disabled>Inspecionei esta janela; avançar</button><p id="status"></p><p>Objeto: <code id="fingerprint"></code></p>
<script id="review-data" type="application/json">${json}</script><script nonce="${nonce}">
const data=JSON.parse(document.getElementById('review-data').textContent),img=document.getElementById('pixels'),frame=document.getElementById('frame'),next=document.getElementById('next'),status=document.getElementById('status');let index=0,ready=false,decoded=false;
document.getElementById('fingerprint').textContent=data.objectFingerprint;
function checkVisible(){if(!decoded||ready)return;const r=frame.getBoundingClientRect();if(r.left>=0&&r.top>=0&&r.right<=window.innerWidth&&r.bottom<=window.innerHeight){ready=true;next.disabled=false;status.textContent='Leia a janela inteira. Avançar atesta a inspeção desta janela.';}else{status.textContent='Amplie a janela do navegador ou role a página até toda a janela de pixels ficar visível. Mantenha zoom de 100%.';}}
window.addEventListener('scroll',checkVisible);window.addEventListener('resize',checkVisible);
async function show(){const s=data.screens[index];ready=false;decoded=false;next.disabled=true;document.getElementById('label').textContent=(index+1)+'/'+data.screens.length+' | '+s.role+(s.slideIndex?' '+s.slideIndex:'')+' | '+s.mode+' | escala '+s.scale+' | janela '+s.x+','+s.y+' | SHA-256 '+s.sha256;frame.style.width=s.width+'px';frame.style.height=s.height+'px';img.style.width=s.sourceWidth*s.scale+'px';img.style.height=s.sourceHeight*s.scale+'px';img.style.left=-s.x+'px';img.style.top=-s.y+'px';img.src=s.url;try{await img.decode();await new Promise(requestAnimationFrame);if(img.naturalWidth!==s.sourceWidth||img.naturalHeight!==s.sourceHeight||Math.abs(img.getBoundingClientRect().width-s.sourceWidth*s.scale)>0.1||(window.visualViewport&&window.visualViewport.scale!==1))throw Error();decoded=true;checkVisible();}catch{status.textContent='Não foi possível exibir os pixels na escala exigida. Cancele no terminal.';}}
next.addEventListener('click',async()=>{if(!ready)return;ready=false;decoded=false;next.disabled=true;try{const response=await fetch('attest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({screen:index})});if(!response.ok)throw Error();const result=await response.json();if(result.code){status.textContent='Cobertura apresentada. Digite este código no terminal para atestar que inspecionou todas as janelas: '+result.code;next.hidden=true;}else{index++;await show();}}catch{status.textContent='A sessão de apresentação falhou. Cancele no terminal.';}});show();
</script></html>`;
}

/** Internal renderer transport. It presents bytes, never issues a human receipt.
 * Only the terminal adapter can combine completion with checklist confirmation.
 */
export async function openQualityPresentation(capability, proposal) {
 let stored;
 try { stored=presentations.get(capability);if(!stored || stored.active || stored.proposalHash!==canonicalHash(proposal))throw unavailable(); }
 catch { throw unavailable(); }
 stored.active=true;
 const secret=randomBytes(24).toString('hex'),base=`/${secret}/`,nonce=randomBytes(18).toString('base64'),challenge=randomBytes(6).toString('hex').toUpperCase();
 const screens=makeScreens(stored.proposal.manifest,base),fetched=new Set();let nextScreen=0,closed=false,failed=false,origin;
 function reply(res,status,body,type='text/plain; charset=utf-8') {
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':`default-src 'none'; img-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`});res.end(body);
 }
 const server=createServer((req,res)=>{
  if(closed || req.headers.host!==new URL(origin).host || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers['sec-fetch-site']==='cross-site')return reply(res,403,'Sessão indisponível.');
  if(req.method==='GET' && req.url===base)return reply(res,200,html({objectFingerprint:stored.proposal.objectFingerprint,screens},nonce),'text/html; charset=utf-8');
  if(req.method==='GET' && req.url.startsWith(`${base}image/`)) {
   const id=req.url.slice(`${base}image/`.length),file=stored.files.find(f=>f.artifactId===id);
   if(!file)return reply(res,404,'Arquivo indisponível.');
   res.writeHead(200,{'Content-Type':'image/png','Content-Length':file.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
   res.end(file.bytes,()=>fetched.add(id));return;
  }
  if(req.method!=='POST' || req.url!==`${base}attest`)return reply(res,404,'Indisponível.');
  if(req.headers.origin!==origin || req.headers['content-type']!=='application/json')return reply(res,403,'Origem inválida.');
  let body='',overflow=false;req.on('data',chunk=>{body+=chunk;if(body.length>1024){overflow=true;req.destroy();}});
  req.on('end',()=>{
   try {
    const value=JSON.parse(body),screen=screens[nextScreen];
    if(overflow || Object.keys(value).length!==1 || value.screen!==nextScreen || !screen || !fetched.has(screen.artifactId))return reply(res,409,'Inspecione cada janela na ordem apresentada.');
    nextScreen++;
    reply(res,200,JSON.stringify(nextScreen===screens.length?{code:challenge}:{next:nextScreen}),'application/json');
   }catch{reply(res,400,'Resposta inválida.');}
  });
 });
 server.on('error',()=>{failed=true;});
 const close=async()=>{
  if(closed)return;closed=true;stored.active=false;
  if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 };
 try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  origin=`http://127.0.0.1:${server.address().port}`;
 }catch{await close();throw unavailable();}
 return Object.freeze({url:`${origin}${base}`,proposal:stored.proposal,
  attest(code) {
   if(closed || failed || nextScreen!==screens.length || code!==challenge)throw unavailable();
   const m=stored.proposal.manifest;
   return {files:m.files.map(f=>({artifactId:f.artifactRef.id,sha256:f.artifactRef.sha256,rgbaSha256:f.rgbaSha256,viewedFull:true,viewedMobile:true})).sort((a,b)=>a.artifactId<b.artifactId?-1:1),slides:[...m.selection.slideIndices],seams:m.selection.seamPairs.map(p=>({...p})),panorama:m.files.find(f=>f.role==='panorama')?.artifactRef.id??null,fullResolution:true,mobileWidth:360};
  },close});
}
