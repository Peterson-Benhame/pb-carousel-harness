import { canonicalHash, canonicalJson } from './canonical-json.mjs';
import { validateIdentifier, validatePathSegment } from './identifiers.mjs';
import { PublicError } from './errors.mjs';
import { validateLayoutQualification } from './layout-qualification.mjs';
import { validateSlideSemanticContracts } from './semantic-bindings.mjs';
import { validateCarousel } from '../../scripts/validate-carousel.mjs';

const ROLES = ['cover', 'context', 'content', 'summary', 'cta'];
const FIELDS = ['eyebrow', 'title', 'body', 'code', 'number'];
const REASONS = ['cover', 'representative', 'densest', 'seam-risk', 'diagram-risk'];
const fail = (code = 'COMPOSITION_INVALID') => {
  const messages = {
    COMPOSITION_INVALID: 'Plano de composição inválido ou incompatível com as entradas.',
    COMPOSITION_FIELD_UNSUPPORTED: 'Campo visual não suportado pelas fichas de composição disponíveis.',
    COMPOSITION_LIMIT_EXCEEDED: 'Material excede os limites declarados da ficha de composição.',
    PREVIEW_SELECTION_UNSUPPORTED: 'Seleção de amostra não cobre os riscos dentro do limite permitido.',
  };
  throw new PublicError(code, messages[code], { exitCode: code === 'COMPOSITION_INVALID' ? 2 : 1 });
};
const check = (condition, code) => { if (!condition) fail(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => integer(value) && value > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const compareRecords = (left, right) => compareText(canonicalJson(left), canonicalJson(right));
function keys(value, required, optional = []) {
  check(object(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}
function list(value) { check(Array.isArray(value)); return value; }
function unique(values) { check(new Set(values).size === values.length); }
function identifier(value) { try { validateIdentifier(value); } catch { fail(); } }
function elementId(value) { check(typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value)); }
function assetKey(value) { try { validatePathSegment(value); } catch { fail(); } }
function freeze(value) {
  if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function artifact(ref, kind, extras = []) {
  keys(ref, ['id', 'kind', 'version', 'sha256', ...extras]);
  identifier(ref.id);
  check(ref.kind === kind && positive(ref.version) && hash(ref.sha256));
}
function boundaries(textValue) {
  const points = new Set([0, textValue.length]);
  for (const segment of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(textValue)) points.add(segment.index);
  return points;
}
function validateSlidesShape(slides) {
  check(list(slides).length >= 2);
  slides.forEach((slide, index) => {
    check(object(slide) && slide.slideIndex === index + 1 && ROLES.includes(slide.contentRole));
    check(text(slide.layoutId) && ['light', 'dark'].includes(slide.surface));
  });
  check(slides[0].contentRole === 'cover' && slides.at(-1).contentRole === 'cta');
  check(slides.slice(1).every(slide => slide.contentRole !== 'cover'));
  check(slides.slice(0, -1).every(slide => slide.contentRole !== 'cta'));
}
function validateRiskInventory(risk, slides) {
  keys(risk, ['slides', 'seams']);
  check(list(risk.slides).length === slides.length);
  risk.slides.forEach((entry, index) => {
    keys(entry, ['slideIndex', 'density', 'fontBindingsHash', 'layoutId', 'surface', 'minDiagramLabelSize', 'minInformativeStroke']);
    check(entry.slideIndex === index + 1 && entry.layoutId === slides[index].layoutId
      && entry.surface === slides[index].surface && hash(entry.fontBindingsHash));
    check(finite(entry.density));
    check(entry.density <= 1, 'COMPOSITION_LIMIT_EXCEEDED');
    const diagram = entry.minDiagramLabelSize !== null || entry.minInformativeStroke !== null;
    if (diagram) check(finite(entry.minDiagramLabelSize) && finite(entry.minInformativeStroke));
  });
  let previous = 0;
  for (const seam of list(risk.seams)) {
    keys(seam, ['from', 'to', 'semanticRole', 'minTextDistance', 'hasDeclaredOverlap', 'hasSemanticCrossing']);
    check(positive(seam.from) && seam.to === seam.from + 1 && seam.to <= slides.length && seam.from > previous);
    check(['decorative', 'supporting'].includes(seam.semanticRole) && finite(seam.minTextDistance));
    check(typeof seam.hasDeclaredOverlap === 'boolean' && typeof seam.hasSemanticCrossing === 'boolean');
    previous = seam.from;
  }
}
const byDensity = (left, right) => right.density - left.density || left.slideIndex - right.slideIndex;
const bySeamRisk = (left, right) => Number(right.semanticRole === 'supporting') - Number(left.semanticRole === 'supporting')
  || left.minTextDistance - right.minTextDistance || left.from - right.from;

/** Select declared preflight risks deterministically. This does not measure or
 * render content and does not establish that caller-supplied metrics are true. */
export function derivePreviewSelection(input) {
  const { slides, riskInventory } = JSON.parse(canonicalJson(input));
  validateSlidesShape(slides);
  validateRiskInventory(riskInventory, slides);
  const reasons = new Map();
  const add = (index, reason) => {
    if (!reasons.has(index)) reasons.set(index, new Set());
    reasons.get(index).add(reason);
  };
  add(1, 'cover');
  const internal = riskInventory.slides.filter(entry => !['cover', 'cta'].includes(slides[entry.slideIndex - 1].contentRole));
  check(internal.length > 0, 'PREVIEW_SELECTION_UNSUPPORTED');
  const groups = new Map();
  for (const entry of internal) {
    const key = `${entry.layoutId}|${entry.surface}|${entry.fontBindingsHash}|${entry.minDiagramLabelSize !== null}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const group = [...groups].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][1];
  const ordered = [...group].sort((a, b) => a.density - b.density || a.slideIndex - b.slideIndex);
  const median = (ordered[Math.floor((ordered.length - 1) / 2)].density + ordered[Math.floor(ordered.length / 2)].density) / 2;
  const representative = [...group].sort((a, b) => Math.abs(a.density - median) - Math.abs(b.density - median) || a.slideIndex - b.slideIndex)[0];
  add(representative.slideIndex, 'representative');
  add([...internal].sort(byDensity)[0].slideIndex, 'densest');
  const diagrams = riskInventory.slides.filter(entry => entry.minDiagramLabelSize !== null);
  if (diagrams.length) {
    diagrams.sort((a, b) => a.minDiagramLabelSize - b.minDiagramLabelSize
      || a.minInformativeStroke - b.minInformativeStroke || byDensity(a, b));
    add(diagrams[0].slideIndex, 'diagram-risk');
  }
  const requiredSeams = new Map();
  const addSeam = seam => {
    requiredSeams.set(seam.from, { from: seam.from, to: seam.to });
    add(seam.from, 'seam-risk'); add(seam.to, 'seam-risk');
  };
  if (riskInventory.seams.length) addSeam([...riskInventory.seams].sort(bySeamRisk)[0]);
  for (const seam of riskInventory.seams) {
    if (seam.minTextDistance < 48 || seam.hasDeclaredOverlap || seam.hasSemanticCrossing) addSeam(seam);
  }
  check(reasons.size <= 6, 'PREVIEW_SELECTION_UNSUPPORTED');
  const slideIndices = [...reasons.keys()].sort((a, b) => a - b);
  return freeze({
    policyId: 'representative-risk@1', slideIndices,
    reasons: slideIndices.map(slideIndex => ({ slideIndex, codes: REASONS.filter(code => reasons.get(slideIndex).has(code)) })),
    riskInventoryHash: canonicalHash(riskInventory), seamPairs: [...requiredSeams.values()].sort((a, b) => a.from - b.from),
  });
}
function validateSelection(selection, required, risk) {
  keys(selection, ['policyId', 'slideIndices', 'reasons', 'riskInventoryHash', 'seamPairs']);
  check(selection.policyId === 'representative-risk@1' && selection.riskInventoryHash === required.riskInventoryHash);
  check(list(selection.slideIndices).length <= 6, 'PREVIEW_SELECTION_UNSUPPORTED');
  let previous = 0;
  for (const index of selection.slideIndices) {
    check(positive(index) && index > previous && index <= risk.slides.length);
    previous = index;
  }
  check(required.slideIndices.every(index => selection.slideIndices.includes(index)), 'PREVIEW_SELECTION_UNSUPPORTED');
  check(list(selection.reasons).length === selection.slideIndices.length);
  selection.reasons.forEach((reason, index) => {
    keys(reason, ['slideIndex', 'codes']);
    check(reason.slideIndex === selection.slideIndices[index]);
    list(reason.codes); unique(reason.codes);
    check(reason.codes.every(code => REASONS.includes(code)));
    const needed = required.reasons.find(entry => entry.slideIndex === reason.slideIndex);
    check(!needed || needed.codes.every(code => reason.codes.includes(code)), 'PREVIEW_SELECTION_UNSUPPORTED');
  });
  previous = 0;
  for (const pair of list(selection.seamPairs)) {
    keys(pair, ['from', 'to']);
    check(positive(pair.from) && pair.to === pair.from + 1 && pair.from > previous);
    check(selection.slideIndices.includes(pair.from) && selection.slideIndices.includes(pair.to));
    check(risk.seams.some(seam => seam.from === pair.from && seam.to === pair.to));
    previous = pair.from;
  }
  check(required.seamPairs.every(pair => selection.seamPairs.some(item => equal(item, pair))), 'PREVIEW_SELECTION_UNSUPPORTED');
}
function validateResolvedAssets(assets, plan, carousel) {
  const resolved = new Map();
  for (const item of list(assets)) {
    keys(item, ['brandId', 'runId', 'assetKey', 'artifactRef', 'metadata']);
    check(item.brandId === plan.brandId && item.runId === plan.runId);
    assetKey(item.assetKey);
    artifact(item.artifactRef, `creative-asset:${item.assetKey}`);
    check(!resolved.has(item.assetKey));
    keys(item.metadata, ['width', 'height', 'semantic', 'anchors', 'minLabelSize', 'minInformativeStroke']);
    check(positive(item.metadata.width) && positive(item.metadata.height) && typeof item.metadata.semantic === 'boolean');
    if (item.metadata.semantic) check(finite(item.metadata.minLabelSize) && finite(item.metadata.minInformativeStroke));
    else check(item.metadata.minLabelSize === null && item.metadata.minInformativeStroke === null);
    const anchors = list(item.metadata.anchors);
    for (const anchor of anchors) {
      keys(anchor, ['id', 'x', 'y']); elementId(anchor.id);
      check(finite(anchor.x) && anchor.x <= 1 && finite(anchor.y) && anchor.y <= 1);
    }
    unique(anchors.map(anchor => anchor.id));
    resolved.set(item.assetKey, item);
  }
  const declared = carousel.assets.map(asset => asset.id);
  unique(declared);
  check(list(plan.assets).length === declared.length && resolved.size === declared.length);
  for (const ref of plan.assets) {
    check(object(ref));
    assetKey(ref.assetKey); artifact(ref, `creative-asset:${ref.assetKey}`, ['assetKey']);
    check(declared.includes(ref.assetKey));
    const item = resolved.get(ref.assetKey);
    check(Boolean(item));
    const { assetKey: ignored, ...reference } = ref;
    check(equal(reference, item.artifactRef));
  }
  unique(plan.assets.map(asset => asset.assetKey));
  unique(plan.assets.map(asset => asset.id));
  return resolved;
}
function validateBlocks(slide, sourceSlide, definition) {
  const usedRegions = new Set(), ids = new Set(), offsets = new Map();
  let previousOrder = -1;
  for (const block of list(slide.blocks)) {
    keys(block, ['id', 'regionId', 'source', 'spans', 'alignment']);
    elementId(block.id); elementId(block.regionId);
    check(!ids.has(block.id) && !usedRegions.has(block.regionId));
    check(!definition.regions.some(region => region.id === block.id && region.id !== block.regionId));
    check(!definition.decorationOptions.some(option => option.elementId === block.id));
    ids.add(block.id); usedRegions.add(block.regionId);
    const region = definition.regions.find(item => item.id === block.regionId);
    check(region?.kind === 'text' && region.readingOrder > previousOrder);
    previousOrder = region.readingOrder;
    const mapping = definition.limits.textRegions.find(item => item.regionId === block.regionId);
    check(Boolean(mapping));
    keys(block.source, ['field', 'start', 'end']);
    const { field, start, end } = block.source;
    check(FIELDS.includes(field) && mapping.fields.includes(field));
    check(Object.hasOwn(sourceSlide, field));
    const value = field === 'number' && typeof sourceSlide[field] === 'number' ? canonicalJson(sourceSlide[field]) : sourceSlide[field];
    check(typeof value === 'string' && integer(start) && integer(end) && start < end && end <= value.length);
    check(start === (offsets.get(field) ?? 0));
    const points = boundaries(value);
    check(points.has(start) && points.has(end));
    let cursor = 0;
    for (const span of list(block.spans)) {
      keys(span, ['start', 'end', 'styleId']);
      check(integer(span.start) && integer(span.end) && span.start === cursor && span.end > span.start && span.end <= end - start);
      check(points.has(start + span.start) && points.has(start + span.end));
      const style = definition.styles.find(item => item.id === span.styleId);
      check(Boolean(style) && mapping.styleIds.includes(span.styleId) && style.alignment.includes(block.alignment));
      cursor = span.end;
    }
    check(cursor === end - start);
    offsets.set(field, end);
  }
  for (const field of FIELDS) {
    if (!Object.hasOwn(sourceSlide, field)) continue;
    const value = field === 'number' && typeof sourceSlide[field] === 'number' ? canonicalJson(sourceSlide[field]) : sourceSlide[field];
    check(typeof value === 'string' && (offsets.get(field) ?? 0) === value.length);
  }
  return ids;
}
function validatePlacements(slide, definition, resolved, risk) {
  const occupied = new Set(), semantic = [], used = [];
  for (const placement of list(slide.assets)) {
    keys(placement, ['assetKey', 'regionId', 'fit', 'anchorIds']);
    assetKey(placement.assetKey);
    check(placement.fit === 'contain' && !occupied.has(placement.regionId));
    occupied.add(placement.regionId);
    const region = definition.regions.find(item => item.id === placement.regionId);
    const item = resolved.get(placement.assetKey);
    check(region?.kind === 'asset' && Boolean(item));
    used.push(placement.assetKey);
    list(placement.anchorIds); unique(placement.anchorIds);
    for (const anchorId of placement.anchorIds) {
      check(definition.continuity.anchors.some(anchor => anchor.id === anchorId && anchor.regionId === placement.regionId));
      check(item.metadata.anchors.some(anchor => anchor.id === anchorId));
    }
    if (item.metadata.semantic) {
      const scale = Math.min(1, region.width / item.metadata.width, region.height / item.metadata.height);
      semantic.push({ item, scale });
      // These are declared metadata constraints, not pixel/font measurements.
      check(item.metadata.width * scale >= definition.limits.minAssetWidth
        && item.metadata.height * scale >= definition.limits.minAssetHeight
        && item.metadata.minLabelSize * scale >= definition.limits.minDiagramLabelSize
        && item.metadata.minInformativeStroke * scale >= definition.limits.minInformativeStroke,
      'COMPOSITION_LIMIT_EXCEEDED');
    }
  }
  unique(used);
  check(semantic.length <= definition.limits.maxSemanticAssets, 'COMPOSITION_LIMIT_EXCEEDED');
  if (definition.layoutId === 'diagram-explainer@1') check(semantic.length === 1);
  if (semantic.length) {
    check(risk.minDiagramLabelSize === Math.min(...semantic.map(({ item, scale }) => item.metadata.minLabelSize * scale))
      && risk.minInformativeStroke === Math.min(...semantic.map(({ item, scale }) => item.metadata.minInformativeStroke * scale)));
  } else check(risk.minDiagramLabelSize === null && risk.minInformativeStroke === null);
  return used;
}
function validateDecorations(slide, definition, blockIds) {
  for (const choice of list(slide.decorationChoices)) {
    keys(choice, ['elementId', 'optionId']);
    check(definition.decorationOptions.some(option => option.elementId === choice.elementId && option.id === choice.optionId));
  }
  unique(slide.decorationChoices.map(choice => choice.elementId));
  check(list(slide.overlaps).length <= definition.limits.maxOverlaps, 'COMPOSITION_LIMIT_EXCEEDED');
  for (const overlap of slide.overlaps) {
    keys(overlap, ['backElementId', 'frontElementId', 'purpose']);
    check(['highlight-background', 'decorative-underlay'].includes(overlap.purpose));
    check(definition.limits.allowedOverlaps.some(allowed => equal(allowed, overlap)));
    const exists = id => blockIds.has(id) || definition.regions.some(region => region.id === id)
      || definition.decorationOptions.some(option => option.elementId === id);
    check(exists(overlap.backElementId) && exists(overlap.frontElementId));
  }
  unique(slide.overlaps.map(overlap => `${overlap.backElementId}|${overlap.frontElementId}`));
}
function validateContinuities(plan, carousel, definitions) {
  check(list(plan.continuities).length === carousel.continuity.length);
  for (const link of plan.continuities) {
    keys(link, ['from', 'to', 'assetKey', 'anchorPairId', 'semanticRole']);
    check(positive(link.from) && link.to === link.from + 1 && link.to <= plan.slides.length);
    check(['decorative', 'supporting'].includes(link.semanticRole));
    check(carousel.continuity.some(item => item.from === link.from && item.to === link.to && item.assetId === link.assetKey));
    const from = definitions[link.from - 1], to = definitions[link.to - 1];
    const pairs = [from, to].map(definition => definition.continuity.pairs.find(pair => pair.id === link.anchorPairId));
    check(pairs.every(pair => pair && pair.semanticRoles.includes(link.semanticRole)));
    const fromPlacement = plan.slides[link.from - 1].assets.find(asset => asset.assetKey === link.assetKey);
    const toPlacement = plan.slides[link.to - 1].assets.find(asset => asset.assetKey === link.assetKey);
    check(fromPlacement?.anchorIds.includes(pairs[0].fromAnchorId) && toPlacement?.anchorIds.includes(pairs[1].toAnchorId));
  }
  unique(plan.continuities.map(link => `${link.from}|${link.to}|${link.assetKey}`));
  for (const [index, definition] of definitions.entries()) {
    const count = plan.continuities.filter(link => link.from === index + 1 || link.to === index + 1).length;
    check(count <= definition.continuity.maxPairs, 'COMPOSITION_LIMIT_EXCEEDED');
  }
  const seamKeys = [...new Set(plan.continuities.map(link => link.from))].sort((a, b) => a - b);
  check(equal(seamKeys, plan.riskInventory.seams.map(seam => seam.from)));
  for (const seam of plan.riskInventory.seams) {
    const links = plan.continuities.filter(link => link.from === seam.from);
    check(seam.semanticRole === (links.some(link => link.semanticRole === 'supporting') ? 'supporting' : 'decorative'));
    const hasOverlap = [plan.slides[seam.from - 1], plan.slides[seam.to - 1]].some(slide => slide.overlaps.length > 0);
    check(seam.hasDeclaredOverlap === hasOverlap);
    check(!seam.hasSemanticCrossing || seam.semanticRole === 'supporting');
  }
}

/** Pure structural validation only. The caller must provide resolved scoped
 * asset descriptors. This function cannot verify artifact bytes, snapshot
 * identity, copyFingerprint, measured metrics, release authority or consent.
 * A structurally valid candidate is NEVER evidence of production eligibility. */
export function validateCompositionPlan(input) {
  const value = JSON.parse(canonicalJson(input));
  keys(value, ['plan', 'carousel', 'assets', 'qualifications']);
  const { plan, carousel, assets, qualifications } = value;
  keys(plan, ['schemaVersion', 'id', 'brandId', 'runId', 'version', 'snapshotHash', 'carouselRef', 'copyFingerprint',
    'conceptRef', 'assets', 'rendererId', 'slides', 'continuities', 'riskInventory', 'previewSelection', 'change'],
  ['semanticContractVersion', 'semanticContracts']);
  check(plan.schemaVersion === 1 && positive(plan.version) && plan.rendererId === 'editorial-composed@1');
  [plan.id, plan.brandId, plan.runId].forEach(identifier);
  check(hash(plan.snapshotHash) && hash(plan.copyFingerprint));
  artifact(plan.carouselRef, 'carousel'); artifact(plan.conceptRef, 'concept');
  check(object(carousel) && typeof carousel.theme === 'string');
  check(validateCarousel(carousel, { themes: [carousel.theme] }).length === 0);
  validateSlidesShape(plan.slides);
  check(plan.slides.length === carousel.slides.length);
  const semanticDeclared = Object.hasOwn(plan, 'semanticContractVersion') || Object.hasOwn(plan, 'semanticContracts');
  if (semanticDeclared) {
    check(Object.hasOwn(plan, 'semanticContractVersion') && Object.hasOwn(plan, 'semanticContracts'));
    try { plan.semanticContracts = validateSlideSemanticContracts({ version: plan.semanticContractVersion, slides: carousel.slides, contracts: plan.semanticContracts }); }
    catch { fail(); }
  }
  validateRiskInventory(plan.riskInventory, plan.slides);
  const records = list(qualifications).map(record => validateLayoutQualification(record));
  unique(records.map(record => `${record.id}|${record.version}`));
  const resolved = validateResolvedAssets(assets, plan, carousel);
  const artifactIds = [plan.id, plan.carouselRef.id, plan.conceptRef.id, ...plan.assets.map(asset => asset.id)];
  const definitions = [], usedAssets = new Set();
  plan.slides.forEach((slide, index) => {
    keys(slide, ['slideIndex', 'contentRole', 'layoutId', 'qualificationRef', 'surface', 'blocks', 'assets', 'overlaps', 'decorationChoices']);
    const source = carousel.slides[index];
    check(source.index === slide.slideIndex && source.role === slide.contentRole);
    if ((Object.hasOwn(source, 'code') && source.code !== '') || (Object.hasOwn(source, 'number') && source.number !== '')) {
      fail('COMPOSITION_FIELD_UNSUPPORTED');
    }
    keys(slide.qualificationRef, ['id', 'version', 'sha256', 'definitionHash']);
    const ref = slide.qualificationRef;
    check(positive(ref.version) && hash(ref.sha256) && hash(ref.definitionHash));
    const record = records.find(item => item.id === ref.id && item.version === ref.version);
    check(record && canonicalHash(record) === ref.sha256 && record.definitionHash === ref.definitionHash);
    const definition = record.definition;
    check(definition.layoutId === slide.layoutId && definition.rendererId === plan.rendererId
      && definition.roles.includes(slide.contentRole) && definition.surfaces.includes(slide.surface));
    definitions.push(definition);
    const risk = plan.riskInventory.slides[index];
    check(risk.fontBindingsHash === canonicalHash(definition.fontBindings));
    const blockIds = validateBlocks(slide, source, definition);
    for (const key of validatePlacements(slide, definition, resolved, risk)) usedAssets.add(key);
    validateDecorations(slide, definition, blockIds);
  });
  check([...resolved.keys()].every(key => usedAssets.has(key)));
  validateContinuities(plan, carousel, definitions);
  validateSelection(plan.previewSelection, derivePreviewSelection(plan), plan.riskInventory);
  keys(plan.change, ['kind', 'previousPlanRef', 'correctionEpisodeRef']);
  check(['initial', 'material', 'bounded-correction'].includes(plan.change.kind));
  if (plan.change.kind === 'initial') check(plan.change.previousPlanRef === null && plan.change.correctionEpisodeRef === null);
  else {
    artifact(plan.change.previousPlanRef, 'composition-plan');
    artifactIds.push(plan.change.previousPlanRef.id);
    if (plan.change.kind === 'bounded-correction') {
      artifact(plan.change.correctionEpisodeRef, 'quality-correction-episode');
      artifactIds.push(plan.change.correctionEpisodeRef.id);
    }
    else check(plan.change.correctionEpisodeRef === null);
  }
  unique(artifactIds);
  // Only semantic sets are normalized. Copy blocks, source spans and slide
  // reading order are intentionally preserved. Reason codes use the v1 enum order.
  plan.assets.sort((a, b) => compareText(a.assetKey, b.assetKey));
  plan.continuities.sort((a, b) => a.from - b.from || a.to - b.to || compareRecords(a, b));
  for (const slide of plan.slides) {
    for (const placement of slide.assets) placement.anchorIds.sort(compareText);
    slide.assets.sort((a, b) => compareText(a.regionId, b.regionId));
    slide.decorationChoices.sort((a, b) => compareText(a.elementId, b.elementId));
    slide.overlaps.sort(compareRecords);
  }
  for (const reason of plan.previewSelection.reasons) {
    reason.codes.sort((a, b) => REASONS.indexOf(a) - REASONS.indexOf(b));
  }
  return freeze(plan);
}
