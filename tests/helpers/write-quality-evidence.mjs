// Explicit local evidence generation, never an npm hook or product operation.
// All inputs are synthetic. Source fonts and SVG outlines are not written.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { renderedQualityFixture } from './quality-render-fixture.mjs';
import { evaluateRenderedQuality } from '../../src/quality/objective-checks.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { sha256 } from '../../src/infrastructure/resources.mjs';

const root = path.resolve(process.argv[2] ?? 'output/quality-qualification');
await mkdir(root,{recursive:true});
const summary = { schemaVersion:1, purpose:'synthetic-candidate-review', humanReview:'not-verified',
  productionRelease:false, generatedAt:new Date().toISOString(), cases:[], files:[] };
async function save(name,bytes) {
  await writeFile(path.join(root,name),bytes);
  summary.files.push({name,size:bytes.length,sha256:sha256(bytes)});
}
const panels=[];
for(const identity of ['amber','blue']) for(const surface of ['light','dark']) for(const boundary of [false,true]) {
  const name=`${identity}-${surface}-${boundary?'boundary':'representative'}`;
  const {f,input,result}=await renderedQualityFixture({identity,surface,boundary,selection:'all'});
  const report=await evaluateRenderedQuality(input);
  if(report.checks.some(c=>c.result==='failed')) throw Error(`Technical failure in ${name}: ${JSON.stringify(report.checks.filter(c=>c.result==='failed'))}`);
  const thumbnails=[];
  for(const slide of result.slides) {
    const file=`${name}-${String(slide.index).padStart(2,'0')}.png`;
    const mobile=await sharp(slide.png).resize(360,450).png().toBuffer();
    await save(file,slide.png);await save(file.replace('.png','-360.png'),mobile);thumbnails.push(mobile);
  }
  const panel=await sharp({create:{width:1800,height:450,channels:4,background:'#ffffff'}}).composite(thumbnails.map((bytes,i)=>({input:bytes,left:i*360,top:0}))).png().toBuffer();
  await save(`${name}-mobile-panel.png`,panel);panels.push({name,bytes:panel,boundary});
  await save(`${name}-panorama.png`,result.panorama.png);
  await save(`${name}-objective.json`,Buffer.from(JSON.stringify(report,null,2)+'\n'));
  summary.cases.push({name,identity,surface,boundary,result:report.result,
    unverified:[...new Set(report.checks.filter(c=>c.result==='not-verified').map(c=>`${c.code}:${c.target.elementId??c.target.role}`))],
    rendererHash:canonicalHash(f.snapshot.renderer),runtime:f.snapshot.runtime,
    fonts:f.snapshot.fonts,fontBindingsHash:canonicalHash(f.snapshot.fontBindings),
    definitions:f.qualifications.map(q=>({id:q.id,version:q.version,definitionHash:q.definitionHash,status:q.status})),
    slides:result.slides.map(s=>({index:s.index,layoutId:s.scene.layoutId,pngSha256:s.sha256,rgbaSha256:s.rgbaSha256,
      blocks:s.scene.elements.filter(e=>e.kind==='text').map(e=>({id:e.id,fontSize:e.fontSize,lines:e.lines.length,occupancy:e.occupancy,density:e.density}))}))});
}
for(const boundary of [false,true]) {
 const chosen=panels.filter(p=>p.boundary===boundary);
 const contact=await sharp({create:{width:1800,height:1800,channels:4,background:'#ffffff'}}).composite(chosen.map((p,i)=>({input:p.bytes,left:0,top:i*450}))).png().toBuffer();
 await save(`contact-${boundary?'boundary':'representative'}.png`,contact);
}
const links=summary.cases.map(c=>`<section><h2>${c.name}</h2><p>Objetivo: ${c.result}. Revisão humana: não verificada. Ordem: capa, fluxo, densa, diagrama, CTA.</p><img src="${c.name}-mobile-panel.png" width="1800" height="450" alt="Cinco lâminas sintéticas a360px cada"><p>${c.slides.map(s=>`<a href="${c.name}-${String(s.index).padStart(2,'0')}.png">Lâmina ${s.index} a1080×1350</a>`).join(' · ')} · <a href="${c.name}-panorama.png">Panorama integral</a> · <a href="${c.name}-objective.json">Relatório objetivo</a></p></section>`).join('\n');
const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Q06: fichas candidatas</title><style>body{font:16px system-ui,sans-serif;margin:24px;color:#202020;background:#fafafa}section{margin:32px 0}img{display:block;max-width:none}a{color:#175b8a}p{max-width:1100px}</style><h1>Q06: matriz sintética para revisão</h1><p>40 lâminas: cinco fichas, duas marcas, duas superfícies, exemplos representativos e limites de linhas. Todas as fichas permanecem candidatas. Esta página não registra aprovação.</p><p>Inspecione cada PNG integral em1:1 e cada lâmina móvel a360×450. Painéis largos exigem rolagem horizontal; reduzir todo o painel à largura da janela não verifica legibilidade móvel.</p><p>Critérios humanos pendentes: legibilidade, hierarquia, composição, ritmo, semântica visual e acabamento de marca. Metadata de diagrama não prova seus rótulos ou contraste. Os limites são simultâneos:3 linhas de “AÇÃO” não cabem na caixa de título do diagrama por causa da tinta real, embora3 linhas curtas sem acento caibam.</p>${links}</html>`;
await save('index.html',Buffer.from(html));
await writeFile(path.join(root,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({root,cases:summary.cases.length,slides:summary.cases.reduce((n,c)=>n+c.slides.length,0),results:[...new Set(summary.cases.map(c=>c.result))],humanReview:summary.humanReview,files:summary.files.length}));
