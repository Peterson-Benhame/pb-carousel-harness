import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { canonicalHash, canonicalJson } from '../domain/canonical-json.mjs';
import { validateCompositionPlan } from '../domain/composition-plan.mjs';
import { validateBrandConfig } from '../domain/brand-schema.mjs';
import { PublicError, invalidArgument } from '../domain/errors.mjs';
import { selectLogoVariant } from '../domain/logo-policy.mjs';
import { loadResourcesManifest, inspectPackage, resolveResources, probeDependency, dependencyNames, sha256 } from '../infrastructure/resources.mjs';
import { createConfinedRoot } from '../infrastructure/fs/confined-path.mjs';
import { prepareLogoLayout, assertLogoClearance } from '../adapters/legacy/logo-layout.mjs';
import { layoutTextBlock } from './text-layout.mjs';
import { normalizeSelection, slideFrame, resolveSurface, assertCompositionGeometry, contrastRatio, containsBox, boxGap, intersects, placeAnchoredAsset, resolveContinuityGeometry } from './composition-geometry.mjs';

const ID = 'editorial-composed@1';
const fail = (code, message) => { throw new PublicError(code, message); };
const mismatch = () => fail('RUNTIME_MISMATCH', 'Recursos efetivos não correspondem à identidade congelada.');
const inconsistent = () => fail('SNAPSHOT_HASH_MISMATCH', 'Entradas não correspondem ao snapshot e plano congelados.');
const equal = (a,b) => canonicalJson(a) === canonicalJson(b);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&!Buffer.isBuffer(value);
// Own all bytes and plain data synchronously, before any I/O or raster await.
// Getters and exotic prototypes are rejected rather than executed.
function own(value, ancestors = new Set()) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value === null || ['string','boolean'].includes(typeof value) || typeof value==='number'&&Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw invalidArgument('Recursos de composição inválidos.');
  const descriptors=Object.getOwnPropertyDescriptors(value),array=Array.isArray(value),result=array?[]:{};
  if(array&&Object.keys(value).length!==value.length) throw invalidArgument('Recursos de composição inválidos.');
  ancestors.add(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === 'length' && array) continue;
    const descriptor=descriptors[key];
    if(typeof key!=='string'||key==='__proto__'||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable) throw invalidArgument('Recursos de composição inválidos.');
    Object.defineProperty(result,key,{value:own(descriptor.value,ancestors),enumerable:true,writable:true,configurable:true});
  }
  ancestors.delete(value);return result;
}
const rect = box => ({x:box.x,y:box.y,width:box.width,height:box.height});
const imageSvg = (bytes,box) => `<image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${bytes.toString('base64')}"/>`;
function inspectInputs(carousel, snapshot, plan, resources) {
  if(![carousel,snapshot,plan,resources].every(object)) throw invalidArgument('Entradas de composição inválidas.');
  if(!['fonts','fontBindings','qualifications'].every(key=>Array.isArray(snapshot[key])&&snapshot[key].every(object))) throw invalidArgument('Identidades congeladas inválidas.');
  if (snapshot.schemaVersion !== 2 || snapshot.contractVersion !== 2 || snapshot.canonicalVersion !== 1 || snapshot.pipelineVersion !== 2 || snapshot.renderer?.id !== ID) fail('RUN_CONTRACT_UNSUPPORTED','Composição editorial exige contexto explícito de contrato 2.');
  const brand = validateBrandConfig(snapshot.brand?.config);
  if (snapshot.brand.id !== plan.brandId || brand.configVersion !== 2 || snapshot.brand.effectiveHash !== canonicalHash(brand)
      || snapshot.theme?.id !== carousel.theme || !equal(brand.themes[carousel.theme], snapshot.theme.values)
      || snapshot.dimensions?.width !== 1080 || snapshot.dimensions?.height !== 1350
      || plan.snapshotHash !== canonicalHash(snapshot) || plan.carouselRef?.sha256 !== canonicalHash(carousel)
      || !equal(snapshot.runtime?.renderer,snapshot.renderer)) inconsistent();
  if (!Array.isArray(resources.fonts) || !Array.isArray(resources.assets) || !Array.isArray(resources.logos) || !Array.isArray(resources.qualifications)) throw invalidArgument('Recursos de composição incompletos.');
  for (const key of ['fonts','assets','logos']) {
    const items = resources[key];if(!items.every(object)) throw invalidArgument('Recurso de composição inválido.');
    const ids = items.map(item => key === 'assets' ? item.descriptor?.assetKey : item.id);
    if (new Set(ids).size !== ids.length) throw invalidArgument('Recursos de composição ambíguos.');
    for (const item of items) {
      if (!Buffer.isBuffer(item.bytes)) fail('RESOURCE_MISSING','Bytes do recurso de composição ausentes.');
      if (sha256(item.bytes) !== (key === 'assets' ? item.descriptor?.artifactRef?.sha256 : item.sha256)) {
        if (key === 'fonts') mismatch();
        fail('ASSET_HASH_MISMATCH','Bytes do asset não correspondem à identidade congelada.');
      }
    }
  }
  const normalized = validateCompositionPlan({carousel,plan,assets:resources.assets.map(item=>item.descriptor),qualifications:resources.qualifications});
  for (const slide of normalized.slides) {
    if (!snapshot.qualifications?.some(ref=>equal(ref,slide.qualificationRef))) inconsistent();
    const q=resources.qualifications.find(q=>q.id===slide.qualificationRef.id&&q.version===slide.qualificationRef.version);
    if (q.status === 'rejected') fail('LAYOUT_NOT_QUALIFIED','Ficha rejeitada não pode ser composta.');
    for (const binding of q.definition.fontBindings) {
      if (!snapshot.fontBindings?.some(expected=>equal(binding,expected)) || brand.fonts[binding.role] !== binding.fontId) mismatch();
    }
  }
  return {brand,plan:normalized};
}
async function inspectResources(snapshot, resources, plan) {
  const manifest=await loadResourcesManifest(), actual=await inspectPackage({manifest,rendererId:ID});
  const blocking=actual.diagnostics.find(d=>d.code!=='LAYOUT_NOT_QUALIFIED');
  if(blocking) fail(blocking.code,blocking.message);
  if(!equal(actual.renderer,snapshot.renderer)) mismatch();
  if(snapshot.runtime.node!==process.version||snapshot.runtime.platform!==process.platform||snapshot.runtime.arch!==process.arch||snapshot.runtime.abi!==process.versions.modules||snapshot.runtime.napi!==process.versions.napi) mismatch();
  const dependencies=Object.fromEntries(await Promise.all(dependencyNames.map(async name=>[name,await probeDependency(name)])));
  if(!equal(dependencies,snapshot.runtime.dependencies)) mismatch();
  const used = new Set(plan.slides.flatMap(slide=> {
    const q=resources.qualifications.find(q=>q.id===slide.qualificationRef.id&&q.version===slide.qualificationRef.version);
    return q.definition.fontBindings.map(binding=>binding.fontId);
  }));
  for(const id of used) {
    const font=resources.fonts.find(font=>font.id===id), expected=manifest.fonts.find(font=>font.id===id)??manifest.optionalFonts.find(font=>font.id===id);
    if(!font) fail('RESOURCE_MISSING','Fonte exigida pela composição ausente.');
    if(!expected||font.sha256!==expected.sha256||!snapshot.fonts.some(item=>item.id===id&&item.sha256===font.sha256)) mismatch();
    if(id==='nimbus-roman-italic@1') fail('FONT_USE_UNAUTHORIZED','A fonte de acento exige gate de uso específico; não há substituição automática.');
  }
  for(const asset of resources.assets) {
    const metadata=await sharp(asset.bytes,{limitInputPixels:40_000_000}).metadata().catch(()=>null);
    if(!metadata||metadata.format!=='png'||metadata.pages>1||metadata.width!==asset.descriptor.metadata.width||metadata.height!==asset.descriptor.metadata.height) fail('ASSET_INVALID','PNG não corresponde às dimensões e ao formato declarados.');
  }
}
function textElement({id,source,text,spans,styles,definition,resources,region,alignment,maxLines,kind='text'}) {
  const layout=layoutTextBlock({text,spans,styles,bindings:definition.fontBindings,fonts:resources.fonts,region,alignment,maxLines,maxOccupancy:definition.limits.maxBlockOccupancy});
  if(layout.occupancy>definition.limits.maxBlockOccupancy) fail('COMPOSITION_LIMIT_EXCEEDED','Ocupação textual excede o limite da ficha.');
  return {id,kind,source:source??null,...layout,bounds:layout.inkBounds};
}
async function composeSlide({source,entry,definition,brand,theme,resources,total,links}) {
  const surface=resolveSurface(theme,entry.surface), elements=[], svg=[];
  const styles=definition.styles.map(style=>({...style,color:surface[style.colorToken]}));
  for(const style of styles) if(contrastRatio(style.color,surface.background)<definition.limits.minTextContrast) fail('COMPOSITION_LIMIT_EXCEEDED','Contraste textual abaixo do limite da ficha.');
  for(const block of entry.blocks) {
    const region=definition.regions.find(r=>r.id===block.regionId), rule=definition.limits.textRegions.find(r=>r.regionId===block.regionId);
    const field=typeof source[block.source.field]==='number'?canonicalJson(source[block.source.field]):source[block.source.field];
    const element=textElement({id:block.id,source:block.source,text:field.slice(block.source.start,block.source.end),spans:block.spans,styles,definition,resources,region,alignment:block.alignment,maxLines:rule.maxLines});
    elements.push(element);svg.push(element.svg);
  }
  const bodyLines=elements.filter(e=>e.source?.field==='body').reduce((sum,e)=>sum+e.lines.length,0);
  if(bodyLines>definition.limits.totalBodyLines) fail('COMPOSITION_LIMIT_EXCEEDED','Texto excede o limite total de linhas da ficha.');
  for(const placement of entry.assets) {
    const asset=resources.assets.find(a=>a.descriptor.assetKey===placement.assetKey), region=definition.regions.find(r=>r.id===placement.regionId);
    const geometry=placeAnchoredAsset(asset.descriptor.metadata,region,definition.limits,placement.anchorIds,definition.continuity.anchors);
    const element={id:placement.regionId,kind:'asset',assetKey:placement.assetKey,sha256:asset.descriptor.artifactRef.sha256,...geometry,sourceDimensions:{width:asset.descriptor.metadata.width,height:asset.descriptor.metadata.height}};
    elements.push(element);svg.push(imageSvg(asset.bytes,geometry.bounds));
  }
  // Decorations are only fixed definition regions/options, never user coordinates.
  for(const choice of entry.decorationChoices) {
    const option=definition.decorationOptions.find(o=>o.id===choice.optionId&&o.elementId===choice.elementId);
    if(!option.visible) continue;
    const region=definition.regions.find(r=>r.id===choice.elementId), bounds={...rect(region),x:region.x+option.offsetX,y:region.y+option.offsetY};
    for(const element of elements.filter(element=>element.glyphs&&intersects(element.bounds,bounds))) {
      for(const glyph of element.glyphs.filter(glyph=>glyph.inkBounds&&intersects(glyph.inkBounds,bounds))) {
        const color=styles.find(style=>style.id===glyph.styleId).color;
        if(contrastRatio(color,surface.accent)<definition.limits.minTextContrast) fail('COMPOSITION_LIMIT_EXCEEDED','Destaque decorativo reduz o contraste do texto aprovado.');
      }
    }
    elements.unshift({id:choice.elementId,kind:'decoration',bounds});
    svg.unshift(`<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${surface.accent}"/>`);
  }
  const connectors=[];
  for(const link of links) for(const segment of link.segments.filter(segment=>segment.slideIndex===entry.slideIndex)) {
    const related=elements.find(e=>e.kind==='asset'&&e.assetKey===link.assetKey),stroke=link.stroke;
    if(contrastRatio(surface.accent,surface.background)<definition.limits.minInformativeContrast) fail('COMPOSITION_LIMIT_EXCEEDED','Contraste de continuidade insuficiente.');
    // A diagonal butt-cap can extend half a stroke into its attached image.
    // Clip only the connector at that image's outer edge, never the PNG itself.
    const from=entry.slideIndex===link.from,edge=from?related.bounds.x+related.bounds.width:related.bounds.x;
    if((from?segment.x1:segment.x2)!==edge) fail('COMPOSITION_LIMIT_EXCEEDED','Âncora da continuidade não está na borda externa do asset.');
    const clip={x:from?edge:0,y:0,width:from?definition.dimensions.width-edge:edge,height:definition.dimensions.height};
    const left=Math.max(segment.bounds.x,clip.x),right=Math.min(segment.bounds.x+segment.bounds.width,clip.x+clip.width);
    const bounds={...segment.bounds,x:left,width:right-left};
    const connector={id:`continuity-${link.from}-${link.to}`,kind:'decoration',bounds,assetKey:link.assetKey,segment,stroke,clip};
    for(const element of elements) if(intersects(bounds,element.bounds)||element!==related&&boxGap(bounds,element.bounds)<definition.limits.minBlockGap) fail('COMPOSITION_LIMIT_EXCEEDED','Continuidade invade conteúdo independente.');
    connectors.push(connector);
    svg.push(`<defs><clipPath id="clip-${connector.id}"><rect x="${clip.x}" y="${clip.y}" width="${clip.width}" height="${clip.height}"/></clipPath></defs><path clip-path="url(#clip-${connector.id})" d="M${segment.x1} ${segment.y1}L${segment.x2} ${segment.y2}" stroke="${surface.accent}" stroke-width="${stroke}" stroke-linecap="butt" fill="none"/>`);
  }
  let logo=null;
  if(brand.logo.enabled) {
    const id=selectLogoVariant(brand.logo,entry.surface), ref=resources.logos.find(l=>l.id===id);
    logo=await prepareLogoLayout({logo:brand.logo,theme:surface,logos:ref?[ref]:[],protection:definition.limits.logoProtection,minimumHeight:definition.limits.minLogoHeight});
    const region=definition.regions.find(r=>r.id==='logo');
    if(!region||!equal(rect(region),rect(logo.slot))) fail('LOGO_LAYOUT_INVALID','Ficha não corresponde ao slot protegido do logotipo.');
    const protection=definition.limits.logoProtection;
    const inner={x:logo.slot.x+protection,y:logo.slot.y+protection,width:logo.slot.width-2*protection,height:logo.slot.height-2*protection};
    if(inner.width<=0||inner.height<=0||!containsBox(inner,logo.image)||logo.visible.height<definition.limits.minLogoHeight||logo.rasterVisible.height<definition.limits.minLogoHeight) fail('LOGO_LAYOUT_INVALID','Logotipo excede os limites específicos da ficha.');
    assertLogoClearance(logo,[...elements,...connectors].map(e=>e.bounds).filter(Boolean));
    elements.push({id:'logo',kind:'brand',bounds:logo.visible,slot:logo.slot,sha256:logo.sha256});svg.push(imageSvg(ref.bytes,logo.image));
  }
  const footer=definition.regions.find(r=>r.id==='signature'), style=styles.find(s=>s.id==='signature');
  const counter=String(entry.slideIndex).padStart(2,'0')+' / '+String(total).padStart(2,'0');
  const countWidth=style.sizeMax*5;
  const number=textElement({id:'slide-number',text:counter,spans:[{start:0,end:counter.length,styleId:style.id}],styles,definition,resources,region:{...footer,x:footer.x+footer.width-countWidth,width:countWidth},alignment:'left',maxLines:1,kind:'brand'});
  elements.push(number);svg.push(number.svg);
  if(brand.profile) {
    const signature=textElement({id:'signature',text:brand.profile,spans:[{start:0,end:brand.profile.length,styleId:style.id}],styles,definition,resources,region:{...footer,width:footer.width-countWidth-definition.limits.minBlockGap},alignment:'left',maxLines:definition.limits.maxSignatureLines,kind:'brand'});
    elements.push(signature);svg.push(signature.svg);
  }
  assertCompositionGeometry({elements:elements.map(e=>({...e,glyphs:e.glyphs?.map(g=>({...g,bounds:g.inkBounds}))})),definition,overlaps:entry.overlaps});
  for(const connector of connectors) for(const element of elements.filter(e=>e.kind==='brand')) if(intersects(connector.bounds,element.bounds)||boxGap(connector.bounds,element.bounds)<definition.limits.minBlockGap) fail('COMPOSITION_LIMIT_EXCEEDED','Continuidade invade a identidade da marca.');
  elements.push(...connectors);
  const fonts=[...new Map(elements.flatMap(e=>e.glyphs??[]).map(g=>[`${g.fontId}|${g.sha256}|${canonicalJson(g.axes)}`,{id:g.fontId,sha256:g.sha256,axes:g.axes}])).values()];
  const frame=slideFrame(entry.slideIndex,definition.dimensions);
  const metrics={density:Math.max(bodyLines/definition.limits.totalBodyLines,...elements.filter(e=>e.kind==='text').map(e=>e.density)),bodyLines,fonts,elements:elements.map(({svg,...e})=>e)};
  const scene={...frame,surface:entry.surface,palette:surface,layoutId:entry.layoutId,definitionHash:canonicalHash(definition),elements:elements.map(({svg,...e})=>e),continuities:links};
  return {index:entry.slideIndex,worldX:frame.worldX,scene,metrics,svg:`<svg xmlns="http://www.w3.org/2000/svg" data-slide-index="${entry.slideIndex}" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${surface.background}"/>${svg.join('')}</svg>`};
}
async function raster(svg) {
  const png=await sharp(Buffer.from(svg)).png().toBuffer(), raw=await sharp(png).ensureAlpha().raw().toBuffer();
  return {png,sha256:sha256(png),rgbaSha256:sha256(raw)};
}
async function join(slides) {
  const png=await sharp({create:{width:1080*slides.length,height:1350,channels:4,background:'#00000000'}}).composite(slides.map((slide,index)=>({input:slide.png,left:index*1080,top:0}))).png().toBuffer();
  return {png,width:1080*slides.length,height:1350,sha256:sha256(png),rgbaSha256:sha256(await sharp(png).ensureAlpha().raw().toBuffer())};
}
/** Internal, in-memory composition primitive. Candidate records can be exercised
 * by the qualification harness; this function never releases a layout, issues an
 * approval, writes files or provides a public execution route. T20/Q05 own gates.
 * Selection is evaluated before any per-slide SVG composition/rasterization.
 */
export async function composeCarousel(input) {
  const detached=own(input);if(!object(detached)) throw invalidArgument('Entradas de composição inválidas.');
  const {carousel,snapshot,plan,resources,selection}=detached;
  const inspected=inspectInputs(carousel,snapshot,plan,resources), normalized=inspected.plan;
  const selected=normalizeSelection(selection,carousel.slides.length,normalized.continuities);
  if(inspected.brand.logo.enabled) {
    const refs=snapshot.logos,variants=inspected.brand.logo.variants;
    if(!Array.isArray(refs)||refs.length!==Object.keys(variants).length||refs.some(ref=>!ref||!['light','dark'].includes(ref.surface))||new Set(refs.map(ref=>ref.surface)).size!==refs.length) inconsistent();
    for(const ref of refs) {
      if(variants[ref.surface]!==ref.id||! /^[a-f0-9]{64}$/.test(ref.sha256)) inconsistent();
      const asset=resources.logos.find(l=>l.id===ref.id);
      if(!asset) fail('RESOURCE_MISSING','PNG do logotipo congelado ausente.');
      if(asset.sha256!==ref.sha256) fail('ASSET_HASH_MISMATCH','Logotipo não corresponde ao snapshot.');
    }
  }
  await inspectResources(snapshot,resources,normalized);
  const continuityGeometry=resolveContinuityGeometry({plan:normalized,qualifications:resources.qualifications,assets:resources.assets,dimensions:snapshot.dimensions});
  for(const link of continuityGeometry) link.stroke=Math.max(3,...[link.from,link.to].map(index=>resources.qualifications.find(q=>q.id===normalized.slides[index-1].qualificationRef.id&&q.version===normalized.slides[index-1].qualificationRef.version).definition.limits.minInformativeStroke));
  const slides=[],activity={composedIndices:[],rasterizedIndices:[]};
  for(const index of selected.slideIndices) {
    const entry=normalized.slides[index-1],q=resources.qualifications.find(q=>q.id===entry.qualificationRef.id&&q.version===entry.qualificationRef.version);
    const slide=await composeSlide({source:carousel.slides[index-1],entry,definition:q.definition,brand:inspected.brand,theme:snapshot.theme.values,resources,total:carousel.slides.length,links:continuityGeometry.filter(link=>link.from===index||link.to===index)});
    activity.composedIndices.push(index);
    Object.assign(slide,await raster(slide.svg));activity.rasterizedIndices.push(index);slides.push(slide);
  }
  const seams=[];
  for(const pair of selected.seamPairs) seams.push({pair,...await join([slides.find(s=>s.index===pair.from),slides.find(s=>s.index===pair.to)])});
  const panorama=selected.allSlides?await join(slides):null;
  return {rendererId:ID,selection:selected,slides,seams,panorama,activity,resources:{renderer:snapshot.renderer,fonts:snapshot.fonts,qualifications:normalized.slides.filter(s=>selected.slideIndices.includes(s.slideIndex)).map(s=>s.qualificationRef)},planHash:canonicalHash(normalized),snapshotHash:canonicalHash(snapshot)};
}
/** Resolve baseline bytes from an explicit authorized root. Optional accent
 * remains subject to the existing resource gate, never a filename fallback.
 */
export async function resolveComposedRenderResources(input) {
  const detached=own(input);if(!object(detached)) throw invalidArgument('Contexto editorial inválido.');
  const {snapshot,fontRoot,qualifications,assetData=[],logoData=[]}=detached;
  if(snapshot?.renderer?.id!==ID||snapshot.schemaVersion!==2) fail('RUN_CONTRACT_UNSUPPORTED','Contexto editorial exige contrato 2.');
  if(!Array.isArray(snapshot.fontBindings)||!snapshot.fontBindings.every(object)) throw invalidArgument('Bindings tipográficos inválidos.');
  const ids=[...new Set(snapshot.fontBindings.map(b=>b.fontId))],manifest=await loadResourcesManifest();
  const resolved=await resolveResources({fontRoot,manifest,requiredFontIds:ids});
  if(resolved.diagnostics.length) {const d=resolved.diagnostics[0];fail(d.code,d.message);}
  const guard=await createConfinedRoot(fontRoot),fonts=[];
  for(const id of ids) {const ref=manifest.fonts.find(f=>f.id===id);const bytes=await guard.withPaths([ref.file],file=>readFile(file));if(sha256(bytes)!==ref.sha256)mismatch();fonts.push({id,sha256:ref.sha256,bytes});}
  return {fonts,qualifications:own(qualifications),assets:own(assetData),logos:own(logoData)};
}
