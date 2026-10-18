import { createHash } from 'node:crypto';
import * as fontkit from 'fontkit';
import { PublicError } from '../domain/errors.mjs';

const messages = Object.freeze({
  COMPOSITION_LIMIT_EXCEEDED: 'Material excede os limites declarados da ficha de composição.',
  FONT_RESOURCE_MISSING: 'Recurso tipográfico exato não está disponível.',
  FONT_HASH_MISMATCH: 'Os bytes da fonte não correspondem à identidade declarada.',
  FONT_BINDING_INVALID: 'Combinação de fonte, estilo, peso ou eixos não autorizada.',
  FONT_INVALID: 'Não foi possível ler o recurso tipográfico.',
  FONT_GLYPH_UNSUPPORTED: 'A fonte autorizada não representa integralmente o texto.',
  FONT_SHAPING_UNSUPPORTED: 'O texto não pode ser composto com rastreabilidade tipográfica integral.',
});
const fail = (code = 'COMPOSITION_LIMIT_EXCEEDED') => { throw new PublicError(code, messages[code]); };
const check = (condition, code) => { if (!condition) fail(code); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const explicitBreak = /\r\n|[\n\r\u2028\u2029]/gu;
const whitespace = /^\p{White_Space}+$/u;
const breakableSpace = /^[ \u1680\u2000-\u2006\u2008-\u200a\u205f\u3000]+$/u;
const pathCommands = Object.freeze({ moveTo: ['M', 2], lineTo: ['L', 2], quadraticCurveTo: ['Q', 4], bezierCurveTo: ['C', 6], closePath: ['Z', 0] });

// A subtraction can round down enough that origin + extent misses the far
// edge. Expand only that aggregate extent by one representable double; glyph
// coordinates and the region containment test are never rounded or relaxed.
function outwardExtent(origin, edge) {
  let extent = edge - origin;
  if (origin + extent < edge) {
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, extent);
    bits.setBigUint64(0, bits.getBigUint64(0) + 1n);
    extent = bits.getFloat64(0);
  }
  return extent;
}
function union(boxes) {
  const present = boxes.filter(Boolean);
  if (!present.length) return null;
  const x = Math.min(...present.map(box => box.x));
  const y = Math.min(...present.map(box => box.y));
  return { x, y, width: outwardExtent(x, Math.max(...present.map(box => box.x + box.width))),
    height: outwardExtent(y, Math.max(...present.map(box => box.y + box.height))) };
}
function contains(region, box) {
  return !box || (box.x >= region.x && box.y >= region.y
    && box.x + box.width <= region.x + region.width && box.y + box.height <= region.y + region.height);
}
function intersects(a, b) {
  return a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
function translated(box, x, y) { return box && { ...box, x: box.x + x, y: box.y + y }; }

/** Serialize only font-owned path commands and finite numbers, without fontkit's
 * two-decimal rounding. User copy never enters SVG markup or attributes. */
function pathData(path) {
  return path.commands.map(({ command, args }) => {
    const spec = pathCommands[command];
    check(spec && args.length === spec[1] && args.every(finite), 'FONT_INVALID');
    return `${spec[0]}${args.join(' ')}`;
  }).join('');
}

function resolveStyle(style, bindings, resources, parsed) {
  const matches = bindings.filter(binding => binding.role === style.fontRole && binding.weight === style.weight);
  check(matches.length === 1, 'FONT_BINDING_INVALID');
  const binding = matches[0];
  check(hash(binding.sha256) && object(binding.axes) && ['normal', 'italic'].includes(binding.style), 'FONT_BINDING_INVALID');
  const matchesResource = resources.filter(resource => resource.id === binding.fontId);
  check(matchesResource.length === 1, 'FONT_RESOURCE_MISSING');
  const resource = matchesResource[0];
  check(Buffer.isBuffer(resource.bytes) && resource.bytes.length > 0, 'FONT_INVALID');
  check(resource.sha256 === binding.sha256
    && createHash('sha256').update(resource.bytes).digest('hex') === binding.sha256, 'FONT_HASH_MISMATCH');
  let base = parsed.get(resource.id);
  if (!base) {
    try { base = fontkit.create(resource.bytes); } catch { fail('FONT_INVALID'); }
    check(base && typeof base.layout === 'function' && finite(base.unitsPerEm) && base.unitsPerEm > 0, 'FONT_INVALID');
    parsed.set(resource.id, base);
  }
  const axes = base.variationAxes ?? {};
  check(Object.keys(axes).length === Object.keys(binding.axes).length, 'FONT_BINDING_INVALID');
  for (const [axis, value] of Object.entries(binding.axes)) {
    check(Object.hasOwn(axes, axis) && finite(value) && value >= axes[axis].min && value <= axes[axis].max, 'FONT_BINDING_INVALID');
  }
  if (Object.hasOwn(axes, 'wght')) check(binding.axes.wght === binding.weight, 'FONT_BINDING_INVALID');
  else check(base['OS/2']?.usWeightClass === binding.weight, 'FONT_BINDING_INVALID');
  check(binding.style === (base.italicAngle ? 'italic' : 'normal'), 'FONT_BINDING_INVALID');
  let font = base;
  if (Object.keys(axes).length) {
    try { font = base.getVariation(binding.axes); } catch { fail('FONT_BINDING_INVALID'); }
  }
  return { style, binding, font, bytes: resource.bytes };
}

function prepare({ text, spans, styles, bindings, fonts, region, alignment, maxLines, maxOccupancy = 1 }) {
  check(typeof text === 'string' && text.length > 0 && Array.isArray(spans) && spans.length > 0);
  check(Array.isArray(styles) && Array.isArray(bindings) && Array.isArray(fonts));
  check(object(region) && ['x', 'y', 'width', 'height'].every(key => finite(region[key]))
    && region.width > 0 && region.height > 0);
  check(finite(maxOccupancy) && maxOccupancy >= 0 && maxOccupancy <= 1);
  check(['left', 'center', 'right'].includes(alignment) && Number.isSafeInteger(maxLines) && maxLines > 0);
  if (region.alignment !== undefined) check(Array.isArray(region.alignment) && region.alignment.includes(alignment));
  const boundaries = new Set([0, text.length]);
  for (const segment of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)) boundaries.add(segment.index);
  const resolved = new Map(), parsed = new Map();
  let end = 0;
  for (const span of spans) {
    check(object(span) && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
      && span.start === end && span.end > span.start && boundaries.has(span.start) && boundaries.has(span.end));
    const matching = styles.filter(style => style.id === span.styleId);
    check(matching.length === 1);
    const style = matching[0];
    check(finite(style.sizeMin) && finite(style.sizeMax) && style.sizeMin > 0 && style.sizeMax >= style.sizeMin
      && finite(style.lineHeight) && style.lineHeight > 0 && Array.isArray(style.alignment) && style.alignment.includes(alignment)
      && typeof style.color === 'string' && /^#[a-f0-9]{6}$/i.test(style.color));
    if (!resolved.has(style.id)) resolved.set(style.id, resolveStyle(style, bindings, fonts, parsed));
    end = span.end;
  }
  check(end === text.length);
  const used = [...resolved.values()];
  const minimum = Math.ceil(Math.max(...used.map(({ style }) => style.sizeMin)));
  const maximum = Math.floor(Math.min(...used.map(({ style }) => style.sizeMax)));
  check(minimum <= maximum);
  const paragraphs = [];
  let start = 0;
  for (const match of text.matchAll(explicitBreak)) {
    paragraphs.push({ start, end: match.index, breakAfter: { kind: 'explicit', start: match.index, end: match.index + match[0].length, text: match[0] } });
    start = match.index + match[0].length;
  }
  paragraphs.push({ start, end: text.length, breakAfter: { kind: 'end', start: text.length, end: text.length, text: '' } });
  return { text, spans, region, alignment, maxLines, maxOccupancy, resolved, minimum, maximum, paragraphs,
    lineHeightRatio: Math.max(...used.map(({ style }) => style.lineHeight)) };
}

function shapeFragment(text, start, end, resolved) {
  const { binding, style } = resolved;
  // fontkit caches glyph objects by glyph ID, including codePoints. Composite
  // outline reads can populate that cache with empty component codePoints, and
  // cmap aliases can retain another character's source. Isolate each shaping
  // run so source accounting cannot inherit those mutable cache entries.
  let font;
  try {
    font = fontkit.create(resolved.bytes);
    if (Object.keys(binding.axes).length) font = font.getVariation(binding.axes);
  } catch { fail('FONT_INVALID'); }
  const source = text.slice(start, end);
  for (const character of source) {
    const code = character.codePointAt(0);
    check(!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(character) && font.hasGlyphForCodePoint(code), 'FONT_GLYPH_UNSUPPORTED');
  }
  let run;
  try { run = font.layout(source); } catch { fail('FONT_SHAPING_UNSUPPORTED'); }
  check(run.direction === 'ltr' && run.glyphs.length > 0 && run.glyphs.length === run.positions.length, 'FONT_SHAPING_UNSUPPORTED');
  let cursor = start, x = 0;
  const glyphs = run.glyphs.map((glyph, index) => {
    check(glyph.id !== 0, 'FONT_GLYPH_UNSUPPORTED');
    const represented = String.fromCodePoint(...glyph.codePoints);
    check(represented.length > 0 && text.slice(cursor, cursor + represented.length) === represented, 'FONT_SHAPING_UNSUPPORTED');
    const sourceStart = cursor;
    cursor += represented.length;
    const position = run.positions[index];
    check(['xAdvance', 'yAdvance', 'xOffset', 'yOffset'].every(key => finite(position[key]))
      && position.xAdvance >= 0 && position.yAdvance === 0, 'FONT_SHAPING_UNSUPPORTED');
    const d = pathData(glyph.path), bbox = glyph.bbox;
    let inkBounds = null;
    if (d.length) {
      check([bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].every(finite), 'FONT_INVALID');
      inkBounds = { x: (x + position.xOffset + bbox.minX) / font.unitsPerEm,
        y: -(position.yOffset + bbox.maxY) / font.unitsPerEm,
        width: (bbox.maxX - bbox.minX) / font.unitsPerEm, height: (bbox.maxY - bbox.minY) / font.unitsPerEm };
    } else check(whitespace.test(represented), 'FONT_GLYPH_UNSUPPORTED');
    const result = { glyphId: glyph.id, sourceStart, sourceEnd: cursor, text: represented,
      styleId: style.id, fontId: binding.fontId, sha256: binding.sha256, axes: { ...binding.axes }, weight: binding.weight,
      unitsPerEm: font.unitsPerEm, x: (x + position.xOffset) / font.unitsPerEm,
      y: -position.yOffset / font.unitsPerEm, advance: position.xAdvance / font.unitsPerEm, inkBounds, d, color: style.color };
    x += position.xAdvance;
    return result;
  });
  check(cursor === end, 'FONT_SHAPING_UNSUPPORTED');
  return { sourceStart: start, sourceEnd: end, text: source, styleId: style.id, fontId: binding.fontId,
    sha256: binding.sha256, axes: { ...binding.axes }, weight: binding.weight, glyphs, advance: x / font.unitsPerEm };
}

function lineShaper(context) {
  const cache = new Map();
  return (start, end) => {
    const key = `${start}:${end}`;
    if (cache.has(key)) return cache.get(key);
    const fragments = [];
    let advance = 0;
    for (const span of context.spans) {
      const from = Math.max(start, span.start), to = Math.min(end, span.end);
      if (to <= from) continue;
      const fragment = shapeFragment(context.text, from, to, context.resolved.get(span.styleId));
      fragment.x = advance;
      fragments.push(fragment);
      advance += fragment.advance;
    }
    const inkBounds = union(fragments.flatMap(fragment => fragment.glyphs.map(glyph => translated(glyph.inkBounds, fragment.x, 0))));
    const left = Math.min(0, inkBounds?.x ?? 0);
    const right = Math.max(advance, inkBounds ? inkBounds.x + inkBounds.width : 0);
    const line = { sourceStart: start, sourceEnd: end, text: context.text.slice(start, end), fragments, advance, inkBounds, left, width: right - left };
    cache.set(key, line);
    return line;
  };
}

function wrap(context, size, shape) {
  const lines = [];
  for (const paragraph of context.paragraphs) {
    const opportunities = new Set([paragraph.end]);
    for (const segment of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(context.text.slice(paragraph.start, paragraph.end))) {
      if (breakableSpace.test(segment.segment)) {
        opportunities.add(paragraph.start + segment.index);
        opportunities.add(paragraph.start + segment.index + segment.segment.length);
      }
    }
    const endpoints = [...opportunities].sort((a, b) => a - b);
    let start = paragraph.start;
    do {
      let chosen = null;
      for (const end of endpoints) {
        if (end <= start && paragraph.start !== paragraph.end) continue;
        const line = shape(start, end);
        if (line.width * size <= context.region.width) chosen = line;
        else break;
      }
      if (!chosen) return null;
      const end = chosen.sourceEnd;
      lines.push({ ...chosen, breakAfter: end === paragraph.end ? paragraph.breakAfter : { kind: 'wrap', start: end, end, text: '' } });
      if (lines.length > context.maxLines) return null;
      start = end;
    } while (start < paragraph.end);
  }
  return lines;
}

function place(context, shaped, size) {
  const nominalLineHeight = size * context.lineHeightRatio;
  const inkTop = Math.max(0, ...shaped.map(line => line.inkBounds ? -line.inkBounds.y * size : 0));
  const inkBottom = Math.max(0, ...shaped.map(line => line.inkBounds ? (line.inkBounds.y + line.inkBounds.height) * size : 0));
  // Declared leading is nominal: unusually tall accents and descenders may
  // increase it, never compress it. Fit and density charge the full real height.
  const lineHeight = Math.max(nominalLineHeight, outwardExtent(-inkTop, inkBottom));
  const actualHeight = shaped.length * lineHeight;
  if (actualHeight > context.region.height * context.maxOccupancy) return null;
  const baselineOffset = inkTop + Math.max(0, (lineHeight - inkTop - inkBottom) / 2);
  const paths = [], glyphs = [];
  const lines = shaped.map((line, lineIndex) => {
    const width = line.width * size;
    const inset = context.alignment === 'left' ? 0 : context.alignment === 'center' ? (context.region.width - width) / 2 : context.region.width - width;
    const origin = context.region.x + inset - line.left * size;
    const baseline = context.region.y + baselineOffset + lineIndex * lineHeight;
    const fragments = line.fragments.map(fragment => {
      const fragmentGlyphs = fragment.glyphs.map(glyph => {
        const x = origin + (fragment.x + glyph.x) * size;
        const y = baseline + glyph.y * size;
        const inkBounds = glyph.inkBounds && { x: origin + (fragment.x + glyph.inkBounds.x) * size,
          y: baseline + glyph.inkBounds.y * size, width: glyph.inkBounds.width * size, height: glyph.inkBounds.height * size };
        const { d, color, ...metadata } = glyph;
        if (d && context.emitSvg) paths.push(`<path d="${d}" fill="${color}" transform="matrix(${size / glyph.unitsPerEm} 0 0 ${-size / glyph.unitsPerEm} ${x} ${y})"/>`);
        const placed = { ...metadata, x, y, advance: glyph.advance * size, fontSize: size, lineIndex,
          inkBounds, box: inkBounds };
        glyphs.push(placed);
        return placed;
      });
      const { glyphs: ignored, advance, x, ...metadata } = fragment;
      return { ...metadata, fontSize: size, x: origin + x * size, baseline, advanceWidth: advance * size,
        inkBounds: union(fragmentGlyphs.map(glyph => glyph.inkBounds)) };
    });
    return { sourceStart: line.sourceStart, sourceEnd: line.sourceEnd, text: line.text, fragments, breakAfter: { ...line.breakAfter },
      fontSize: size, baseline, nominalLineHeight, lineHeight, advanceWidth: line.advance * size,
      box: { x: context.region.x + inset, y: context.region.y + lineIndex * lineHeight, width, height: lineHeight },
      inkBounds: union(fragments.map(fragment => fragment.inkBounds)) };
  });
  const inkBounds = union(glyphs.map(glyph => glyph.inkBounds));
  if (!inkBounds || !contains(context.region, inkBounds) || glyphs.some(glyph => !contains(context.region, glyph.inkBounds))) return null;
  for (let i = 0; i < glyphs.length; i++) {
    for (let j = i + 1; j < glyphs.length; j++) {
      if (glyphs[i].lineIndex !== glyphs[j].lineIndex && intersects(glyphs[i].inkBounds, glyphs[j].inkBounds)) return null;
    }
  }
  const occupancy = actualHeight / context.region.height;
  const density = Math.max(occupancy, lines.length / context.maxLines,
    ...lines.map(line => line.box.width / context.region.width), (inkBounds.y + inkBounds.height - context.region.y) / context.region.height);
  return { sourceText: context.text, svg: paths.join(''), fontSize: size,
    selectedSizes: Object.fromEntries([...context.resolved.keys()].map(id => [id, size])),
    lines, glyphs, inkBounds, box: { ...context.region }, occupancy, density };
}

/** Internal candidate compositor primitive: exact font bytes in, path outlines
 * and UTF-16 source metadata out. This does not qualify a layout or authorize a
 * render. Unsupported shaping fails closed; no normalization or fallback occurs. */
function layout(input, emitSvg) {
  try {
    const context = prepare(input);context.emitSvg=emitSvg;
    const shape = lineShaper(context);
    // Check the complete source before fit attempts, so overflow never conceals
    // a missing glyph later in the approved text.
    for (const paragraph of context.paragraphs) shape(paragraph.start, paragraph.end);
    for (let size = context.maximum; size >= context.minimum; size--) {
      const shaped = wrap(context, size, shape);
      if (!shaped) continue;
      const result = place(context, shaped, size);
      if (result) return result;
    }
    fail();
  } catch (error) {
    if (error instanceof PublicError) throw error;
    fail('FONT_SHAPING_UNSUPPORTED');
  }
}

/** Geometry-only preflight shares the exact shaping/fit algorithm, without SVG markup. */
export function measureTextBlock(input) { return layout(input,false); }
export function layoutTextBlock(input) { return layout(input,true); }
