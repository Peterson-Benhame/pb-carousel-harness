import { invalidArgument, PublicError } from '../domain/errors.mjs';
import { validatePathSegment } from '../domain/identifiers.mjs';

const invalid = () => { throw invalidArgument('Geometria de composição inválida ou não suportada.'); };
const exceeded = () => { throw new PublicError('COMPOSITION_LIMIT_EXCEEDED', 'A composição excede os limites geométricos autorizados.'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const positive = value => Number.isFinite(value) && value > 0;
const hasInk = box => box.width > 0 && box.height > 0;
const id = value => typeof value === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value);
function box(value) {
  if (!object(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)
    || !nonnegative(value.width) || !nonnegative(value.height)
    || !Number.isFinite(value.x + value.width) || !Number.isFinite(value.y + value.height)) invalid();
  return value;
}
function dimensions(value) {
  if (!object(value) || !positive(value.width) || !positive(value.height)) invalid();
}
function pairValid(pair, count) {
  return object(pair) && positiveInteger(pair.from) && pair.to === pair.from + 1 && pair.to <= count;
}

/** Selection never reindexes slides or implicitly adds the other side of a seam.
 * Bare arrays derive seams only from real continuities with both sides selected.
 * An object may explicitly select a subset of those seams, including none.
 */
export function normalizeSelection(selection, count, continuities = []) {
  if (!positiveInteger(count) || !Array.isArray(continuities)) invalid();
  const actualPairs = new Map();
  for (const pair of continuities) {
    if (!pairValid(pair, count)) invalid();
    actualPairs.set(pair.from, { from: pair.from, to: pair.to });
  }
  let slideIndices, requestedPairs;
  if (selection === 'all') slideIndices = Array.from({ length: count }, (_, index) => index + 1);
  else if (Array.isArray(selection)) slideIndices = [...selection];
  else if (object(selection) && Object.keys(selection).every(key => ['slideIndices', 'seamPairs'].includes(key))) {
    if (!Array.isArray(selection.slideIndices)) invalid();
    slideIndices = [...selection.slideIndices];
    if (Object.hasOwn(selection, 'seamPairs')) {
      if (!Array.isArray(selection.seamPairs)) invalid();
      requestedPairs = selection.seamPairs;
    }
  } else invalid();
  if (!slideIndices.length) invalid();
  let previous = 0;
  for (const index of slideIndices) {
    if (!positiveInteger(index) || index <= previous || index > count) invalid();
    previous = index;
  }
  const selected = new Set(slideIndices);
  const seamPairs = [];
  if (requestedPairs !== undefined) {
    previous = 0;
    for (const pair of requestedPairs) {
      if (!pairValid(pair, count) || Object.keys(pair).some(key => !['from', 'to'].includes(key))
        || pair.from <= previous || !actualPairs.has(pair.from)
        || !selected.has(pair.from) || !selected.has(pair.to)) invalid();
      seamPairs.push({ from: pair.from, to: pair.to });
      previous = pair.from;
    }
  } else {
    for (const pair of [...actualPairs.values()].sort((a, b) => a.from - b.from)) {
      if (selected.has(pair.from) && selected.has(pair.to)) seamPairs.push(pair);
    }
  }
  return { slideIndices, seamPairs, allSlides: slideIndices.length === count };
}

export function slideFrame(index, size) {
  dimensions(size);
  if (!positiveInteger(index)) invalid();
  const worldX = (index - 1) * size.width;
  if (!Number.isFinite(worldX)) invalid();
  return { index, worldX, width: size.width, height: size.height };
}

/** Containment is centered and aspect-preserving. Metrics and anchors are in
 * slide-local output pixels; source metadata is never rewritten or inferred.
 */
export function containAsset(metadata, region, limits) {
  if (!object(metadata) || !positiveInteger(metadata.width) || !positiveInteger(metadata.height)
    || typeof metadata.semantic !== 'boolean' || !Array.isArray(metadata.anchors)) invalid();
  box(region); dimensions(region);
  if (!object(limits) || !positive(limits.maxRasterScale) || limits.maxRasterScale > 1
    || !nonnegative(limits.minAssetWidth) || !nonnegative(limits.minAssetHeight)
    || !positive(limits.minDiagramLabelSize) || !positive(limits.minInformativeStroke)) invalid();
  if (metadata.semantic) {
    if (!positive(metadata.minLabelSize) || !positive(metadata.minInformativeStroke)) invalid();
  } else if (metadata.minLabelSize !== null || metadata.minInformativeStroke !== null) invalid();
  const anchorIds = new Set();
  for (const anchor of metadata.anchors) {
    if (!object(anchor) || !id(anchor.id) || anchorIds.has(anchor.id)
      || !nonnegative(anchor.x) || anchor.x > 1 || !nonnegative(anchor.y) || anchor.y > 1) invalid();
    anchorIds.add(anchor.id);
  }
  const scale = Math.min(limits.maxRasterScale, region.width / metadata.width, region.height / metadata.height);
  if (!positive(scale)) exceeded();
  const width = metadata.width * scale, height = metadata.height * scale;
  const bounds = box({ x: region.x + (region.width - width) / 2, y: region.y + (region.height - height) / 2, width, height });
  const minLabelSize = metadata.semantic ? metadata.minLabelSize * scale : null;
  const minInformativeStroke = metadata.semantic ? metadata.minInformativeStroke * scale : null;
  if (metadata.semantic && (width < limits.minAssetWidth || height < limits.minAssetHeight
    || minLabelSize < limits.minDiagramLabelSize || minInformativeStroke < limits.minInformativeStroke)) exceeded();
  return { bounds, scale, minLabelSize, minInformativeStroke,
    anchors: metadata.anchors.map(anchor => ({ id: anchor.id, x: bounds.x + anchor.x * width, y: bounds.y + anchor.y * height })) };
}

function luminance(color) {
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/iu.test(color)) invalid();
  const [r, g, b] = [1, 3, 5].map(offset => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The composed renderer requires explicit v2 bindings. This does not alter
 * the separate historical renderer's primary-surface compatibility behavior.
 */
export function resolveSurface(theme, surface) {
  if (!object(theme) || !['light', 'dark'].includes(surface) || !object(theme.surfaceBindings)
    || Object.keys(theme.surfaceBindings).some(key => !['light', 'dark'].includes(key))) invalid();
  const binding = theme.surfaceBindings[surface];
  const roles = ['background', 'text', 'muted', 'accent', 'secondaryAccent'];
  if (!object(binding) || roles.slice(0, 4).some(role => !Object.hasOwn(binding, role))
    || Object.keys(binding).some(role => !roles.includes(role))) invalid();
  const resolved = {};
  for (const [role, token] of Object.entries(binding)) {
    if (!roles.includes(token) || !Object.hasOwn(theme, token)) invalid();
    luminance(theme[token]);
    resolved[role] = theme[token];
  }
  if ((luminance(resolved.background) >= 0.5 ? 'light' : 'dark') !== surface) exceeded();
  return resolved;
}

/** Opaque, already-resolved sRGB colors only. Unknown image/alpha composition
 * is not silently approximated by this primitive or certified as Q06 evidence.
 */
export function contrastRatio(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function containsBox(outer, inner) {
  box(outer); box(inner);
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
export function intersects(first, second) {
  box(first); box(second);
  return hasInk(first) && hasInk(second) && first.x < second.x + second.width && first.x + first.width > second.x
    && first.y < second.y + second.height && first.y + first.height > second.y;
}
export function boxGap(first, second) {
  box(first); box(second);
  return Math.hypot(Math.max(0, first.x - second.x - second.width, second.x - first.x - first.width),
    Math.max(0, first.y - second.y - second.height, second.y - first.y - first.height));
}

/** Basic hard geometry guard, not a quality review or qualification engine.
 * Elements are in back-to-front paint order. Bounds are actual ink for text
 * and the placed canvas for images. Glyph bounds are slide-local, not font units.
 */
export function assertCompositionGeometry({ elements, definition, overlaps = [] }) {
  if (!Array.isArray(elements) || !object(definition) || !object(definition.limits) || !Array.isArray(overlaps)) invalid();
  dimensions(definition.dimensions);
  const limits = definition.limits, safe = box(limits.safeTextBounds);
  if (!nonnegative(limits.minBlockGap) || !nonnegative(limits.minSurfaceInset) || !Number.isSafeInteger(limits.maxOverlaps) || limits.maxOverlaps < 0
    || !Array.isArray(limits.allowedOverlaps)) invalid();
  const canvas = { x: 0, y: 0, ...definition.dimensions };
  if (!containsBox(canvas, safe)) invalid();
  const byId = new Map();
  for (const [index, element] of elements.entries()) {
    if (!object(element) || !id(element.id) || byId.has(element.id) || !['text', 'asset', 'brand', 'decoration'].includes(element.kind)) invalid();
    box(element.bounds);
    if (!containsBox(canvas, element.bounds) || element.kind === 'text' && !containsBox(safe, element.bounds)) exceeded();
    if (element.glyphs !== undefined) {
      if (!Array.isArray(element.glyphs)) invalid();
      for (const glyph of element.glyphs) {
        // Native text layout records null ink for a measured space glyph.
        const nativeInk = object(glyph) && Object.hasOwn(glyph, 'inkBounds');
        if (nativeInk && glyph.inkBounds === null) continue;
        const ink = box(nativeInk ? glyph.inkBounds : glyph?.bounds ?? glyph);
        if (hasInk(ink) && (!containsBox(safe, ink) || !containsBox(element.bounds, ink))) exceeded();
      }
    }
    byId.set(element.id, { element, index });
  }
  if (overlaps.length > limits.maxOverlaps) exceeded();
  const allowed = new Set();
  for (const overlap of overlaps) {
    if (!object(overlap) || Object.keys(overlap).length !== 3 || !id(overlap.backElementId) || !id(overlap.frontElementId)
      || !['highlight-background', 'decorative-underlay'].includes(overlap.purpose)) invalid();
    const back = byId.get(overlap.backElementId), front = byId.get(overlap.frontElementId);
    if (!back || !front || back.index >= front.index || back.element.kind !== 'decoration'
      || !limits.allowedOverlaps.some(rule => rule.backElementId === overlap.backElementId
        && rule.frontElementId === overlap.frontElementId && rule.purpose === overlap.purpose)) exceeded();
    if (overlap.purpose === 'highlight-background') {
      const surface = back.element.bounds, inset = limits.minSurfaceInset;
      if (front.element.kind !== 'text' || surface.width < inset * 2 || surface.height < inset * 2
        || !containsBox({ x: surface.x + inset, y: surface.y + inset,
          width: surface.width - inset * 2, height: surface.height - inset * 2 }, front.element.bounds)) exceeded();
    }
    const key = `${overlap.backElementId}|${overlap.frontElementId}`;
    if (allowed.has(key)) invalid();
    allowed.add(key);
  }
  for (let index = 0; index < elements.length; index++) {
    const first = elements[index];
    if (!hasInk(first.bounds)) continue;
    for (let other = index + 1; other < elements.length; other++) {
      const second = elements[other];
      if (!hasInk(second.bounds) || allowed.has(`${first.id}|${second.id}`)) continue;
      if (intersects(first.bounds, second.bounds) || boxGap(first.bounds, second.bounds) < limits.minBlockGap) exceeded();
    }
  }
  return true;
}

/** Move a contained raster as one complete image until its declared metadata
 * anchors coincide with the corresponding normalized anchors in its region.
 * Scaling stays the contain scale; inconsistent constraints never crop or warp.
 */
export function placeAnchoredAsset(metadata, region, limits, anchorIds = [], definitionAnchors = []) {
  const placed = containAsset(metadata, region, limits);
  if (!Array.isArray(anchorIds) || !Array.isArray(definitionAnchors) || new Set(anchorIds).size !== anchorIds.length) invalid();
  if (!anchorIds.length) return placed;
  let x, y;
  for (const anchorId of anchorIds) {
    if (!id(anchorId)) invalid();
    const source = metadata.anchors.find(anchor => anchor.id === anchorId);
    const matches = definitionAnchors.filter(anchor => anchor?.id === anchorId);
    if (!source || matches.length !== 1) invalid();
    const target = matches[0];
    if (target.regionId !== region.id || !nonnegative(target.x) || target.x > 1 || !nonnegative(target.y) || target.y > 1) invalid();
    const proposedX = region.x + region.width * target.x - placed.bounds.width * source.x;
    const proposedY = region.y + region.height * target.y - placed.bounds.height * source.y;
    if (x !== undefined && (proposedX !== x || proposedY !== y)) exceeded();
    x = proposedX; y = proposedY;
  }
  const bounds = box({ ...placed.bounds, x, y });
  if (!containsBox(region, bounds)) exceeded();
  return { ...placed, bounds, anchors: metadata.anchors.map(anchor => ({ id: anchor.id,
    x: bounds.x + anchor.x * bounds.width, y: bounds.y + anchor.y * bounds.height })) };
}

function resolvedEndpoint({ slide, qualifications, assets, link, side, size }) {
  const records = qualifications.filter(record => record?.id === slide.qualificationRef?.id && record?.version === slide.qualificationRef?.version);
  if (records.length !== 1) invalid();
  const definition = records[0].definition;
  if (!object(definition) || definition.dimensions?.width !== size.width || definition.dimensions?.height !== size.height
    || !Array.isArray(definition.regions) || !Array.isArray(definition.continuity?.pairs)
    || !Array.isArray(definition.continuity?.anchors) || !nonnegative(definition.continuity.maxPairs)) invalid();
  const pairs = definition.continuity.pairs.filter(pair => pair?.id === link.anchorPairId);
  if (pairs.length !== 1 || !Array.isArray(pairs[0].semanticRoles) || !pairs[0].semanticRoles.includes(link.semanticRole)) invalid();
  const anchorId = side === 'from' ? pairs[0].fromAnchorId : pairs[0].toAnchorId;
  if (!id(anchorId) || !Array.isArray(slide.assets)) invalid();
  const placements = slide.assets.filter(placement => placement?.assetKey === link.assetKey);
  if (placements.length !== 1 || placements[0].fit !== 'contain' || !Array.isArray(placements[0].anchorIds)
    || !placements[0].anchorIds.includes(anchorId)) invalid();
  const placement = placements[0];
  const regions = definition.regions.filter(region => region.id === placement.regionId && region.kind === 'asset');
  const matches = assets.filter(asset => asset?.descriptor?.assetKey === link.assetKey);
  if (regions.length !== 1 || matches.length !== 1) invalid();
  const geometry = placeAnchoredAsset(matches[0].descriptor.metadata, regions[0], definition.limits,
    placement.anchorIds, definition.continuity.anchors);
  const anchor = geometry.anchors.find(anchor => anchor.id === anchorId);
  if (!anchor) invalid();
  const worldX = slideFrame(slide.slideIndex, size).worldX;
  return { point: { x: worldX + anchor.x, y: anchor.y }, definition };
}

function clipWorldSegment(fromPoint, toPoint, slideIndex, size, strokeWidth) {
  const frame = slideFrame(slideIndex, size), dx = toPoint.x - fromPoint.x, dy = toPoint.y - fromPoint.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length)) invalid();
  if (length === 0) return null;
  let start = 0, end = 1;
  if (dx === 0) {
    if (fromPoint.x < frame.worldX || fromPoint.x > frame.worldX + size.width) return null;
  } else {
    const a = (frame.worldX - fromPoint.x) / dx, b = (frame.worldX + size.width - fromPoint.x) / dx;
    start = Math.max(0, Math.min(a, b)); end = Math.min(1, Math.max(a, b));
    if (end <= start) return null;
  }
  const x1 = fromPoint.x + dx * start - frame.worldX, y1 = fromPoint.y + dy * start;
  const x2 = fromPoint.x + dx * end - frame.worldX, y2 = fromPoint.y + dy * end;
  const nx = Math.abs(dy / length) * strokeWidth / 2, ny = Math.abs(dx / length) * strokeWidth / 2;
  // Butt-cap stroke ink, cropped only at canvas edges. Semantic rasters were
  // independently contained above; these connector strokes carry no raster copy.
  const left = Math.max(0, Math.min(x1, x2) - nx), top = Math.max(0, Math.min(y1, y2) - ny);
  const right = Math.min(size.width, Math.max(x1, x2) + nx), bottom = Math.min(size.height, Math.max(y1, y2) + ny);
  return { slideIndex, x1, y1, x2, y2, bounds: box({ x: left, y: top, width: right - left, height: bottom - top }) };
}

/** Resolve only metadata geometry for both endpoints. No neighboring scene,
 * font shaping, SVG, rasterization or filesystem access occurs in this function.
 * Points are world-space; segment endpoints and stroke bounds are slide-local.
 * The drawing caller uses butt caps and width max(3, both minInformativeStroke).
 */
export function resolveContinuityGeometry({ plan, qualifications, assets, dimensions: size }) {
  dimensions(size);
  if (!object(plan) || !Array.isArray(plan.slides) || !Array.isArray(plan.continuities)
    || !Array.isArray(qualifications) || !Array.isArray(assets)) invalid();
  for (const [index, slide] of plan.slides.entries()) if (slide?.slideIndex !== index + 1) invalid();
  const result = [], seen = new Set();
  for (const link of plan.continuities) {
    if (!pairValid(link, plan.slides.length) || !id(link.anchorPairId)
      || !['decorative', 'supporting'].includes(link.semanticRole)) invalid();
    validatePathSegment(link.assetKey);
    const key = `${link.from}|${link.to}|${link.assetKey}`;
    if (seen.has(key)) invalid();
    seen.add(key);
    const from = resolvedEndpoint({ slide: plan.slides[link.from - 1], qualifications, assets, link, side: 'from', size });
    const to = resolvedEndpoint({ slide: plan.slides[link.to - 1], qualifications, assets, link, side: 'to', size });
    for (const [slideIndex, endpoint] of [[link.from, from], [link.to, to]]) {
      if (plan.continuities.filter(item => item.from === slideIndex || item.to === slideIndex).length > endpoint.definition.continuity.maxPairs) exceeded();
    }
    if (from.point.x > to.point.x) exceeded();
    const strokeWidth = Math.max(3, from.definition.limits.minInformativeStroke, to.definition.limits.minInformativeStroke);
    const segments = [link.from, link.to].map(index => clipWorldSegment(from.point, to.point, index, size, strokeWidth)).filter(Boolean);
    result.push({ from: link.from, to: link.to, assetKey: link.assetKey, anchorPairId: link.anchorPairId, semanticRole: link.semanticRole,
      fromPoint: from.point, toPoint: to.point, segments });
  }
  return result;
}
