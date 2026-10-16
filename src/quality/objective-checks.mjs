import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { canonicalHash, canonicalJson } from '../domain/canonical-json.mjs';
import { invalidArgument, PublicError } from '../domain/errors.mjs';
import { validateLayoutQualification } from '../domain/layout-qualification.mjs';
import { validateCompositionPlan } from '../domain/composition-plan.mjs';
import { composeCarousel } from '../render/composed-carousel.mjs';
import { prepareLogoLayout } from '../adapters/legacy/logo-layout.mjs';
import { sha256 } from '../infrastructure/resources.mjs';
import { containsBox, intersects, boxGap, contrastRatio, placeAnchoredAsset, resolveSurface } from '../render/composition-geometry.mjs';

const CHECKER_ID = 'editorial-objective-checkers@1';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const rect = v => object(v) && ['x','y','width','height'].every(k => finite(v[k])) && v.width >= 0 && v.height >= 0;
const equal = (a, b) => a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b);
const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
const safeContains = (a, b) => rect(a) && rect(b) && containsBox(a, b);
// Detach data and bytes before the first await. Never invoke user getters,
// toJSON, prototypes or symbols, and do not resolve arbitrary paths/URLs.
function own(value, ancestors = new Set()) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value === null || ['string','boolean'].includes(typeof value) || finite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw invalidArgument('Evidência objetiva inválida.');
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  if (!array && proto !== Object.prototype && proto !== null) throw invalidArgument('Evidência objetiva inválida.');
  const descriptors = Object.getOwnPropertyDescriptors(value), result = array ? [] : {};
  if (array && Object.keys(value).length !== value.length) throw invalidArgument('Evidência objetiva inválida.');
  ancestors.add(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (array && key === 'length') continue;
    const d = descriptors[key];
    if (typeof key !== 'string' || key === '__proto__' || !d.enumerable || !Object.hasOwn(d,'value')) throw invalidArgument('Evidência objetiva inválida.');
    result[key] = own(d.value, ancestors);
  }
  ancestors.delete(value); return result;
}
const metricsDocument = c => ({ schemaVersion: 1, selection: c.selection,
  slides: c.slides.map(({index,scene,metrics}) => ({index,scene,metrics})) });
const target = (slideIndex = null, elementId = null, role = slideIndex === null ? 'manifest' : 'slide', pair = null) => ({ role, slideIndex, pair, elementId });
const show = v => v === undefined ? 'absent' : typeof v === 'string' ? v : canonicalJson(v);

/** Evaluate already-rendered bytes and metrics. The optional composition.inputs
 * envelope contains the original carousel, plan, snapshot and asset/logo bytes;
 * hashes and relations are checked here, never an `approved` boolean. Without
 * that evidence dependent checks are not-verified. This internal primitive
 * writes no state and creates no human review, qualification or consent. */
async function evaluate(input) {
  const detached = own(input);
  if (!object(detached) || !object(detached.manifest) || !object(detached.composition) || !Array.isArray(detached.files)
    || !Array.isArray(detached.qualification) || !Array.isArray(detached.composition.slides) || !Array.isArray(detached.manifest.files)
    || !object(detached.manifest.selection) || !Array.isArray(detached.manifest.selection.slideIndices)
    || !Array.isArray(detached.manifest.selection.seamPairs) || !object(detached.composition.selection)) throw invalidArgument('Entradas de controle objetivo incompletas.');
  const {manifest:m, composition:c, files, qualification:records} = detached, checks = [];
  if (!c.slides.every(slide=>object(slide)&&object(slide.scene)&&object(slide.metrics))
    || c.inputs !== undefined && (!object(c.inputs)||!object(c.inputs.plan)||!Array.isArray(c.inputs.plan.slides)
      || !c.inputs.plan.slides.every(slide=>object(slide)&&Array.isArray(slide.blocks)&&Array.isArray(slide.assets)&&Array.isArray(slide.overlaps))
      || !Array.isArray(c.inputs.plan.continuities)||!Array.isArray(c.inputs.plan.assets)
      || !object(c.inputs.carousel)||!Array.isArray(c.inputs.carousel.slides)
      || !object(c.inputs.snapshot)||!object(c.inputs.snapshot.brand)||!object(c.inputs.snapshot.brand.config)
      || !object(c.inputs.snapshot.theme)||!object(c.inputs.snapshot.theme.values)
      || !Array.isArray(c.inputs.assets)||!Array.isArray(c.inputs.logos))) throw invalidArgument('Estrutura da evidência objetiva inválida.');
  const add = (code, where, expected, observed, result, fileHash = null) => checks.push({code,target:where,fileHash,expected:show(expected),observed:show(observed),result});
  const test = (code, where, expected, observed, ok, fileHash = null) => add(code,where,expected,observed,ok?'passed':'failed',fileHash);
  const unknown = (code,where,expected,observed,fileHash=null) => add(code,where,expected,observed,'not-verified',fileHash);
  const global = (expected,observed,ok) => test('file-integrity',target(),expected,observed,ok);
  const inputs = c.inputs, plan = inputs?.plan, snapshot = inputs?.snapshot, carousel = inputs?.carousel;
  const definitions = new Map();
  for (const record of records) {
    try { const q=validateLayoutQualification(record); if(definitions.has(q.definition.layoutId)) throw invalidArgument('Ficha duplicada.'); definitions.set(q.definition.layoutId,q); }
    catch { global('valid unique qualification definition','invalid qualification',false); }
  }
  global('manifest schema 2 and explicit renderer',`${m.schemaVersion}:${c.rendererId}`,m.schemaVersion===2&&c.rendererId==='editorial-composed@1'&&m.renderer?.id===c.rendererId);
  const indices = c.slides.map(s=>s?.index), wanted=m.selection.slideIndices;
  global('exact ordered selected indices',indices, equal(indices,wanted)&&wanted.length>0&&wanted.every((n,i)=>Number.isSafeInteger(n)&&n>0&&(i===0||n>wanted[i-1]))&&equal(wanted,c.selection.slideIndices));
  global('exact selection hash and seam pairs',m.selectionHash,canonicalHash(m.selection)===m.selectionHash&&equal(m.selection.seamPairs,c.selection.seamPairs));
  global('frozen plan and snapshot identities',{plan:c.planHash,snapshot:c.snapshotHash},hash(c.planHash)&&hash(c.snapshotHash)&&m.planRef?.sha256===c.planHash&&m.snapshotHash===c.snapshotHash);
  global('effective renderer identity',m.renderer,equal(m.renderer,c.resources?.renderer));
  const metricsBytes = files.filter(f=>f?.id===m.metricsRef?.id);
  global('one hash-bound canonical metrics document',m.metricsRef?.sha256,metricsBytes.length===1&&Buffer.isBuffer(metricsBytes[0].bytes)&&sha256(metricsBytes[0].bytes)===m.metricsRef?.sha256&&metricsBytes[0].bytes.equals(Buffer.from(canonicalJson(metricsDocument(c)))));
  if (inputs) {
    global('original copy, plan, brand, run and snapshot hashes','input bindings',object(plan)&&object(snapshot)&&object(carousel)&&canonicalHash(plan)===c.planHash&&canonicalHash(snapshot)===c.snapshotHash&&canonicalHash(carousel)===plan.carouselRef?.sha256&&plan.brandId===m.brandId&&plan.runId===m.runId&&plan.snapshotHash===c.snapshotHash&&snapshot.brand?.effectiveHash===canonicalHash(snapshot.brand?.config)&&m.runtimeHash===canonicalHash(snapshot.runtime));
    try { validateCompositionPlan({plan,carousel,assets:inputs.assets?.map(a=>a.descriptor),qualifications:records}); }
    catch { global('valid composition plan against original copy and descriptors','invalid input relations',false); }
    global('exact snapshot renderer and fonts','snapshot resources',equal(snapshot.renderer,m.renderer)&&equal(snapshot.fonts,m.fonts));
  } else unknown('file-integrity',target(),'original verified inputs','input envelope absent');

  // Recompose exactly this selection from byte-verified original inputs. This
  // closes the otherwise circular proof in caller-supplied PNG/SVG/metrics hashes.
  // No files are written and no unselected slide is composed or rasterized.
  if (inputs && Array.isArray(inputs.fonts) && inputs.fonts.length && object(plan) && object(snapshot) && object(carousel)) {
    try {
      const verified = await composeCarousel({ carousel, snapshot, plan,
        resources: { fonts: inputs.fonts, assets: inputs.assets, logos: inputs.logos, qualifications: records },
        selection: { slideIndices: c.selection.slideIndices, seamPairs: c.selection.seamPairs } });
      global('normalized selection including full-set coverage', c.selection, equal(verified.selection,c.selection));
      global('metrics and scenes derived from exact input/font bytes', 'independent recomposition', equal(metricsDocument(verified),metricsDocument(c)));
      const matches = (actual, expected) => !!actual && !!expected && Buffer.isBuffer(actual.png) && actual.png.equals(expected.png)
        && actual.sha256===expected.sha256 && actual.rgbaSha256===expected.rgbaSha256;
      global('rendered PNG and RGBA derived from original glyphs and assets', 'independent recomposition',
        c.slides.length===verified.slides.length && c.slides.every((slide,i)=>matches(slide,verified.slides[i]))
        && Array.isArray(c.seams) && c.seams.length===verified.seams.length && c.seams.every((seam,i)=>equal(seam.pair,verified.seams[i].pair)&&matches(seam,verified.seams[i]))
        && (verified.panorama ? matches(c.panorama,verified.panorama) : c.panorama===null));
    } catch (error) {
      global('recomposable exact runtime, resources and inputs', typeof error?.code==='string'?error.code:'verification unavailable', false);
    }
  } else unknown('file-integrity',target(),'original source/font bytes for pixel-to-metrics verification','recomposition evidence absent');

  const expectedRoles = [
    ...wanted.map(slideIndex=>({role:'slide',slideIndex,pair:null})),
    ...m.selection.seamPairs.map(pair=>({role:'seam',slideIndex:null,pair})),
    ...(m.kind==='final'?[{role:'panorama',slideIndex:null,pair:null}]:[]),
  ];
  global('exact slide/seam/panorama coverage',m.files.map(f=>({role:f?.role,slideIndex:f?.slideIndex,pair:f?.pair})),equal(m.files.map(f=>({role:f?.role,slideIndex:f?.slideIndex,pair:f?.pair})),expectedRoles));
  global('preview/final scope matches composition',m.kind,['preview','final'].includes(m.kind)&&(m.kind!=='final'||c.selection.allSlides&&!!c.panorama&&Array.isArray(carousel?.slides)&&wanted.length===carousel.slides.length&&wanted.every((index,i)=>index===i+1)));
  const fileIds=m.files.map(f=>f?.artifactRef?.id).concat(m.metricsRef?.id), actualIds=files.map(f=>f?.id);
  global('unique exact file inventory',actualIds,new Set(fileIds).size===fileIds.length&&new Set(actualIds).size===actualIds.length&&equal([...fileIds].sort(),[...actualIds].sort()));
  const decoded=new Map(), fileHashBySlide=new Map();
  for(const f of m.files) {
    if(!object(f)||!object(f.artifactRef)) {global('valid image record','invalid image record',false);continue;}
    const where=target(f.slideIndex,null,f.role,f.pair), matches=files.filter(item=>item?.id===f.artifactRef.id), bytes=matches[0]?.bytes;
    const resultImage=f.role==='slide'?c.slides.find(s=>s.index===f.slideIndex):f.role==='panorama'?c.panorama:c.seams?.find(s=>equal(s.pair,f.pair));
    if(f.role==='slide') fileHashBySlide.set(f.slideIndex,f.artifactRef.sha256);
    const width=f.role==='slide'?1080:f.role==='seam'?2160:1080*wanted.length;
    let ok=matches.length===1&&Buffer.isBuffer(bytes)&&hash(f.artifactRef.sha256)&&sha256(bytes)===f.artifactRef.sha256&&bytes.length===f.size&&f.mediaType==='image/png'&&f.width===width&&f.height===1350;
    let decodedImage;
    if(ok) try {
      const metadata=await sharp(bytes,{limitInputPixels:40_000_000}).metadata();
      const data=await sharp(bytes,{limitInputPixels:40_000_000}).ensureAlpha().raw().toBuffer();
      ok=metadata.format==='png'&&(!metadata.pages||metadata.pages===1)&&metadata.width===width&&metadata.height===1350&&sha256(data)===f.rgbaSha256;
      decodedImage={data,width,height:1350};
    } catch {ok=false;}
    ok=ok&&Buffer.isBuffer(resultImage?.png)&&bytes.equals(resultImage.png)&&f.artifactRef.sha256===resultImage.sha256&&f.rgbaSha256===resultImage.rgbaSha256;
    test('file-integrity',where,'exact PNG bytes, dimensions and decoded RGBA',f.artifactRef.sha256,ok,f.artifactRef.sha256);
    if(ok) decoded.set(f.artifactRef.id,decodedImage);
  }
  // A panorama/seam must join the selected slide pixels; merely hashing an
  // unrelated second image is insufficient coverage.
  for(const f of m.files.filter(f=>f&&['panorama','seam'].includes(f.role))) {
    const image=decoded.get(f.artifactRef.id), parts=f.role==='panorama'?wanted:[f.pair?.from,f.pair?.to];let ok=!!image;
    for(const [position,index] of parts.entries()) {
      const record=m.files.find(v=>v.role==='slide'&&v.slideIndex===index), slide=record&&decoded.get(record.artifactRef.id);
      if(!image||!slide){ok=false;continue;}
      for(let y=0;y<1350&&ok;y++) ok=image.data.subarray((y*image.width+position*1080)*4,(y*image.width+(position+1)*1080)*4).equals(slide.data.subarray(y*1080*4,(y+1)*1080*4));
    }
    test('file-integrity',target(null,null,f.role,f.pair),'joined original slide RGBA','pixel join',ok,f.artifactRef.sha256);
  }

  for(const slide of c.slides) {
    const index=slide.index, scene=slide.scene, metrics=slide.metrics, q=definitions.get(scene?.layoutId), fileHash=fileHashBySlide.get(index)??null;
    const at=id=>target(index,id), check=(code,id,exp,obs,ok)=>test(code,at(id),exp,obs,ok,fileHash);
    const missing=(code,id,exp,obs)=>unknown(code,at(id),exp,obs,fileHash);
    if(!q||!object(scene)||!Array.isArray(scene.elements)||!object(metrics)) {check('file-integrity',null,'complete scene and definition','missing evidence',false);continue;}
    const d=q.definition, limits=d.limits, es=scene.elements, entry=plan?.slides?.[index-1], source=carousel?.slides?.[index-1];
    check('file-integrity',null,'exact examined definition and metrics',scene.definitionHash,scene.definitionHash===q.definitionHash&&equal(metrics.elements,es)&&d.surfaces.includes(scene.surface));
    const qref={id:q.id,version:q.version,sha256:canonicalHash(q),definitionHash:q.definitionHash};
    check('file-integrity',null,'qualification bound to manifest and composition',qref,m.qualifications?.some(r=>equal(r,qref))&&c.resources?.qualifications?.some(r=>equal(r,qref))&&(!entry||equal(entry.qualificationRef,qref)));
    if(snapshot) {
      let expected;try{expected=resolveSurface(snapshot.theme.values,scene.surface);}catch{}
      check('file-integrity',null,'snapshot surface palette',scene.palette,equal(expected,scene.palette));
    }
    check('file-integrity',null,'unique scene element IDs',es.map(e=>e?.id),es.every(object)&&new Set(es.map(e=>e?.id)).size===es.length);
    if(source&&entry) {
      for(const field of ['eyebrow','title','body']) {
        const blocks=entry.blocks.filter(b=>b.source.field===field), expected=source[field]??'';
        const elements=es.filter(e=>e.kind==='text'&&e.source?.field===field);
        const observed=elements.map(e=>e.sourceText??'').join('');
        const exact=observed===expected&&elements.length===blocks.length&&elements.every((e,i)=>e.id===blocks[i].id&&equal(e.source,blocks[i].source)&&e.sourceText===expected.slice(e.source.start,e.source.end)&&Array.isArray(e.lines)&&e.lines.map(l=>l.text+(l.breakAfter?.text??'')).join('')===e.sourceText);
        check('copy-exact',field,expected,observed,exact);
      }
      check('copy-exact',null,'only declared visual text blocks',es.filter(e=>e.kind==='text').length,es.filter(e=>e.kind==='text').length===entry.blocks.length);
    } else missing('copy-exact',null,'exact original copy and plan','original inputs absent');
    for(const element of es) {
      if(!object(element)) continue;
      const text=Array.isArray(element.lines)||element.kind==='text'||['signature','slide-number'].includes(element.id);
      const regionId=entry?.blocks.find(b=>b.id===element.id)?.regionId??(['signature','slide-number'].includes(element.id)?'signature':element.id);
      const region=d.regions.find(r=>r.id===regionId), rule=limits.textRegions.find(r=>r.regionId===regionId);
      check('text-bounds',element.id,'element ink contained by canvas',element.bounds,safeContains({x:0,y:0,...d.dimensions},element.bounds));
      if(element.segment) {
        check('asset-geometry',element.id,`informative stroke >= ${limits.minInformativeStroke}`,element.stroke,finite(element.stroke)&&element.stroke>=limits.minInformativeStroke);
        try {const ratio=contrastRatio(scene.palette?.accent,scene.palette?.background);check('contrast',element.id,`informative contrast >= ${limits.minInformativeContrast}`,ratio,ratio>=limits.minInformativeContrast);}
        catch {missing('contrast',element.id,'resolved informative stroke/background','unknown color or alpha');}
      }
      if(!text) continue;
      if(!Array.isArray(element.glyphs)||!element.glyphs.length) {missing('text-bounds',element.id,'exact measured glyph bounds','glyph evidence absent');missing('typography',element.id,'glyph font identity and size','glyph evidence absent');continue;}
      const inks=element.glyphs.filter(g=>g.inkBounds!==null).map(g=>g.inkBounds);
      check('text-bounds',element.id,'zero clipped glyphs, exact safe/region/element bounds',inks.every(rect)?'measured glyphs':'invalid glyphs',!!region&&inks.length>0&&inks.every(b=>safeContains(limits.safeTextBounds,b)&&safeContains(region,b)&&safeContains(element.bounds,b)&&safeContains(element.box,b))&&element.glyphs.every(g=>g.inkBounds!==null||/^\p{White_Space}+$/u.test(g.text)));
      const lines=element.lines, maxLines=rule?.maxLines??limits.maxSignatureLines;
      check('copy-exact',element.id,'every line represented by ordered original glyphs','glyph source coverage',Array.isArray(lines)&&lines.every((line,lineIndex)=> {
        const glyphs=element.glyphs.filter(g=>g.lineIndex===lineIndex);
        let cursor=line.sourceStart;
        return glyphs.map(g=>g.text).join('')===line.text&&glyphs.every(g=> {
          const valid=g.sourceStart===cursor&&Number.isSafeInteger(g.sourceEnd)&&g.sourceEnd>cursor&&element.sourceText.slice(cursor,g.sourceEnd)===g.text;
          cursor=g.sourceEnd;return valid;
        })&&cursor===line.sourceEnd;
      })&&element.glyphs.every(g=>Number.isSafeInteger(g.lineIndex)&&g.lineIndex>=0&&g.lineIndex<lines.length));
      const measuredOccupancy=Array.isArray(lines)&&lines.length?lines.length*Math.max(...lines.map(l=>l.lineHeight))/element.box?.height:Infinity;
      check('typography',element.id,`lines <= ${maxLines}; occupancy <= ${limits.maxBlockOccupancy}`,{lines:lines?.length??null,occupancy:finite(element.occupancy)?element.occupancy:null},Array.isArray(lines)&&lines.length>0&&lines.length<=maxLines&&finite(element.occupancy)&&element.occupancy<=limits.maxBlockOccupancy&&measuredOccupancy<=limits.maxBlockOccupancy&&lines.every(l=>finite(l.advanceWidth)&&l.advanceWidth<=element.box.width&&safeContains(element.box,l.box)));
      check('typography',element.id,'exact authorized font, axes, size and leading','glyph bindings',element.glyphs.every(g=>{
        const style=d.styles.find(s=>s.id===g.styleId), binding=style&&d.fontBindings.find(b=>b.role===style.fontRole&&b.weight===style.weight), line=lines?.[g.lineIndex];
        return style&&binding&&g.fontId===binding.fontId&&g.sha256===binding.sha256&&g.weight===binding.weight&&equal(g.axes,binding.axes)&&finite(g.fontSize)&&g.fontSize>=style.sizeMin&&g.fontSize<=style.sizeMax&&line&&finite(line.lineHeight)&&line.lineHeight>=style.lineHeight*g.fontSize&&m.fonts?.some(f=>f.id===g.fontId&&f.sha256===g.sha256)&&(rule?rule.styleIds.includes(g.styleId):g.styleId==='signature');
      }));
      for(const styleId of new Set(element.glyphs.map(g=>g.styleId))) {
        const style=d.styles.find(s=>s.id===styleId), color=scene.palette?.[style?.colorToken];
        const backgrounds=[scene.palette?.background];
        for(const other of es.slice(0,es.indexOf(element))) if(other.kind==='decoration'&&rect(other.bounds)&&inks.some(b=>rect(b)&&intersects(b,other.bounds))) backgrounds.push(other.segment?scene.palette?.background:scene.palette?.accent);
        try {const ratios=backgrounds.map(background=>contrastRatio(color,background));check('contrast',element.id,`sRGB contrast >= ${limits.minTextContrast}`,Math.min(...ratios),ratios.every(r=>r>=limits.minTextContrast));}
        catch {missing('contrast',element.id,'resolved opaque foreground/background','unknown color, alpha or background');}
      }
    }
    const bodyLines=es.filter(e=>e?.source?.field==='body').reduce((n,e)=>n+(e.lines?.length??0),0);
    check('typography',null,`total body lines <= ${limits.totalBodyLines}`,bodyLines,bodyLines<=limits.totalBodyLines);
    // Only an explicitly declared, allowlisted back-to-front decoration may
    // overlap; a boolean or a generic intentional flag is never sufficient.
    const overlaps=entry?.overlaps??[], allowed=new Set();
    check('collision',null,`declared overlaps <= ${limits.maxOverlaps}`,overlaps.length,overlaps.length<=limits.maxOverlaps);
    for(const overlap of overlaps) {
      const back=es.find(e=>e.id===overlap.backElementId),front=es.find(e=>e.id===overlap.frontElementId);
      let ok=back?.kind==='decoration'&&front&&front.kind!=='brand'&&es.indexOf(back)<es.indexOf(front)&&limits.allowedOverlaps.some(o=>equal(o,overlap));
      if(ok&&overlap.purpose==='highlight-background') ok=front.kind==='text'&&safeContains({x:back.bounds.x+limits.minSurfaceInset,y:back.bounds.y+limits.minSurfaceInset,width:back.bounds.width-2*limits.minSurfaceInset,height:back.bounds.height-2*limits.minSurfaceInset},front.bounds);
      check('collision',overlap.frontElementId,'allowlisted protected overlap',overlap,!!ok);if(ok)allowed.add(`${back.id}|${front.id}`);
    }
    for(let i=0;i<es.length;i++) for(let j=i+1;j<es.length;j++) {
      const a=es[i],b=es[j];if(!rect(a?.bounds)||!rect(b?.bounds))continue;
      // Connector touches its attached image at the clipped edge by design.
      const attached=(a.segment&&a.assetKey===b.assetKey&&b.kind==='asset')||(b.segment&&b.assetKey===a.assetKey&&a.kind==='asset');
      const permitted=allowed.has(`${a.id}|${b.id}`), gap=boxGap(a.bounds,b.bounds);
      check('collision',`${a.id}:${b.id}`,permitted?'declared protected overlap':attached?'no positive intersection':`independent ink gap >= ${limits.minBlockGap}`,gap,permitted||!intersects(a.bounds,b.bounds)&&(attached||gap>=limits.minBlockGap));
    }
    const placedAssets=es.filter(e=>e?.kind==='asset');
    check('asset-geometry',null,`semantic assets <= ${limits.maxSemanticAssets}`,placedAssets.length,placedAssets.length<=limits.maxSemanticAssets);
    if(entry&&inputs) {
      check('asset-geometry',null,'every planned asset present exactly once',placedAssets.map(e=>e.assetKey),equal(placedAssets.map(e=>e.assetKey),entry.assets.map(a=>a.assetKey)));
      for(const placement of entry.assets) {
        const element=placedAssets.find(e=>e.assetKey===placement.assetKey),asset=inputs.assets?.find(a=>a.descriptor?.assetKey===placement.assetKey),descriptor=asset?.descriptor;
        let ok=!!element&&Buffer.isBuffer(asset?.bytes)&&sha256(asset.bytes)===descriptor.artifactRef?.sha256&&element.sha256===descriptor.artifactRef.sha256&&descriptor.brandId===m.brandId&&descriptor.runId===m.runId&&plan.assets.some(a=>a.assetKey===placement.assetKey&&a.sha256===descriptor.artifactRef.sha256);
        if(ok) try {
          const info=await sharp(asset.bytes,{limitInputPixels:40_000_000}).metadata(),region=d.regions.find(r=>r.id===placement.regionId);
          const geometry=placeAnchoredAsset(descriptor.metadata,region,limits,placement.anchorIds,d.continuity.anchors);
          ok=info.format==='png'&&(!info.pages||info.pages===1)&&info.width===descriptor.metadata.width&&info.height===descriptor.metadata.height&&equal(element.bounds,geometry.bounds)&&element.scale===geometry.scale&&element.minLabelSize===geometry.minLabelSize&&element.minInformativeStroke===geometry.minInformativeStroke&&equal(element.anchors,geometry.anchors);
        } catch {ok=false;}
        check('asset-geometry',placement.regionId,'hash-bound contain geometry, scale, labels and strokes',element?.bounds??null,ok);
        if(element) {missing('contrast',element.id,'verified worst informative raster contrast','raster pixel semantics unavailable');missing('typography',element.id,'actual semantic raster labels and stroke coverage','descriptor alone does not prove raster labels');}
      }
    } else if(placedAssets.length) missing('asset-geometry',null,'original asset bytes and descriptors','original asset evidence absent');
    if(snapshot) {
      const logo=es.filter(e=>e?.id==='logo');
      if(snapshot.brand.config.logo.enabled) {
        let expected;try{expected=await prepareLogoLayout({logo:snapshot.brand.config.logo,theme:scene.palette,logos:inputs.logos,protection:limits.logoProtection,minimumHeight:limits.minLogoHeight});}catch{}
        const frozen=snapshot.logos?.find(ref=>ref.surface===scene.surface);
        check('asset-geometry','logo','exact source logo, protected aspect, visible minimum and raster size',logo[0]?.bounds??null,logo.length===1&&!!expected&&frozen?.id===expected.id&&frozen.sha256===expected.sha256&&logo[0].sha256===expected.sha256&&equal(logo[0].slot,expected.slot)&&equal(logo[0].bounds,expected.visible)&&expected.rasterVisible.height>=limits.minLogoHeight&&es.filter(e=>e!==logo[0]).every(e=>rect(e.bounds)&&!intersects(expected.slot,e.bounds)));
      } else check('asset-geometry','logo','no disabled logo placeholder',logo.length,logo.length===0);
      const profile=snapshot.brand.config.profile,signature=es.filter(e=>e?.id==='signature');
      check('copy-exact','signature',profile,signature[0]?.sourceText??'',profile?signature.length===1&&signature[0].sourceText===profile:signature.length===0);
      const number=es.filter(e=>e?.id==='slide-number'),counter=String(index).padStart(2,'0')+' / '+String(carousel.slides.length).padStart(2,'0');
      check('copy-exact','slide-number',counter,number[0]?.sourceText??'',number.length===1&&number[0].sourceText===counter);
    } else missing('asset-geometry','logo','frozen brand and original logo bytes','brand evidence absent');
    const links=scene.continuities;
    if(!Array.isArray(links)) missing('continuity-independent',null,'explicit continuity inventory','continuities absent');
    else if(!links.length) check('continuity-independent',null,'no cross-slide dependency',0,!entry||!plan.continuities.some(l=>l.from===index||l.to===index));
    else for(const link of links) {
      const legal=['decorative','supporting'].includes(link?.semanticRole),asset=placedAssets.find(e=>e.assetKey===link?.assetKey);
      check('continuity-independent',null,'nonessential complete local content',link?.semanticRole??null,legal&&!!asset&&safeContains({x:0,y:0,...d.dimensions},asset.bounds));
      if(legal) missing('continuity-independent',null,'human verification of standalone meaning','semantic independence cannot be inferred from coordinates');
    }
  }
  const result=checks.some(c=>c.result==='failed')?'failed':checks.some(c=>c.result==='not-verified')?'not-verified':'passed';
  const checkerRef={id:CHECKER_ID,version:1,sha256:sha256(await readFile(new URL(import.meta.url)))};
  return deepFreeze({schemaVersion:1,brandId:m.brandId,runId:m.runId,kind:m.kind,renderAttemptId:m.renderAttemptId,
    manifestRef:{id:m.id,kind:`render-manifest:${m.kind}`,version:m.version,sha256:canonicalHash(m)},checkerRefs:[checkerRef],checks,result});
}

/** Keep malformed nested evidence at the public diagnostic boundary. */
export async function evaluateRenderedQuality(input) {
  try { return await evaluate(input); }
  catch (error) {
    if (error instanceof PublicError) throw error;
    throw invalidArgument('Estrutura da evidência objetiva inválida.');
  }
}
