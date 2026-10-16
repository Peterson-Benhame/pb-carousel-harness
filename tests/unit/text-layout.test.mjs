import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as fontkit from 'fontkit';

let implementation = {};
try { implementation = await import('../../src/render/text-layout.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const layout = input => {
  assert.equal(typeof implementation.layoutTextBlock, 'function', 'real text layout must be implemented');
  return implementation.layoutTextBlock(input);
};
const catalog = JSON.parse(await readFile(new URL('../../shared/layouts/editorial-composed-v1.json', import.meta.url), 'utf8'));
const definition = catalog.qualifications[0].definition;
const root = process.env.CAROUSEL_TEST_FONT_ROOT ?? new URL('../../assets/fonts/', import.meta.url).pathname;
const fonts = await Promise.all([['Anton', 'Anton-Regular.ttf'], ['Manrope', 'Manrope-VariableFont_wght.ttf']].map(async ([id, filename]) => {
  const bytes = await readFile(path.join(root, filename));
  return { id, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
const styles = definition.styles.map(style => ({ ...style, color: style.id.endsWith('highlight') ? '#ffcc22' : '#181818' }));
const input = (text, overrides = {}) => ({
  text, spans: [{ start: 0, end: text.length, styleId: 'title' }], styles,
  bindings: definition.fontBindings, fonts,
  region: { x: 72, y: 192, width: 936, height: 600 }, alignment: 'left', maxLines: 4,
  ...overrides,
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} should equal ${b}`);
const inside = (outer, inner) => inner === null || (inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height);
const fixedStyles = (id, size, alignment = ['left']) => styles.map(style => style.id === id
  ? { ...style, sizeMin: size, sizeMax: size, alignment } : style);

test('shapes real font bytes into paths with exact advances, ligatures, and accent ink', () => {
  const text = 'Ágj ffi';
  const result = layout(input(text));
  const font = fontkit.create(fonts[0].bytes);
  const shaped = font.layout(text);
  assert.equal(result.sourceText, text);
  assert.equal(result.fontSize, 176);
  assert.equal(result.lines.length, 1);
  close(result.lines[0].advanceWidth, shaped.advanceWidth * 176 / font.unitsPerEm);
  assert.equal(result.glyphs.length, shaped.glyphs.length);
  assert.ok(result.glyphs.some(glyph => glyph.sourceEnd - glyph.sourceStart === 3));
  assert.match(result.svg, /<path d="M/);
  assert.doesNotMatch(result.svg, /<text|font-family|<foreignObject|Ágj/);
  for (const glyph of result.glyphs) {
    assert.equal(glyph.fontId, 'Anton');
    assert.equal(glyph.sha256, fonts[0].sha256);
    assert.equal(glyph.fontSize, 176);
    assert.ok(inside(input(text).region, glyph.inkBounds));
  }
  assert.ok(inside(input(text).region, result.inkBounds));
});

test('preserves whitespace, explicit CRLF and trailing blank lines in UTF-16 metadata', () => {
  const text = '  Ação  de\r\nÁgua \n\n';
  const result = layout(input(text, { styles: fixedStyles('title', 72), region: { x: 72, y: 192, width: 936, height: 600 }, maxLines: 8 }));
  assert.equal(result.sourceText, text);
  assert.equal(result.lines.map(line => line.text + line.breakAfter.text).join(''), text);
  assert.equal(result.lines.length, 4);
  assert.equal(result.lines[0].breakAfter.text, '\r\n');
  assert.equal(result.lines.at(-1).text, '');
  for (const line of result.lines) {
    assert.equal(text.slice(line.sourceStart, line.sourceEnd), line.text);
    assert.equal(line.fragments.map(fragment => fragment.text).join(''), line.text);
    for (const fragment of line.fragments) assert.equal(text.slice(fragment.sourceStart, fragment.sourceEnd), fragment.text);
  }
});

test('wraps only at existing word boundaries and keeps highlighted span identity', () => {
  const text = 'Água limpa muda tudo';
  const result = layout(input(text, {
    spans: [{ start: 0, end: 5, styleId: 'title-highlight' }, { start: 5, end: text.length, styleId: 'title' }],
    styles: styles.map(style => style.fontRole === 'title' ? { ...style, sizeMin: 72, sizeMax: 72 } : style),
    region: { x: 72, y: 192, width: 430, height: 600 },
  }));
  assert.ok(result.lines.length > 1);
  assert.equal(result.lines.map(line => line.text + line.breakAfter.text).join(''), text);
  assert.ok(result.lines.slice(0, -1).every(line => /\s$/.test(line.text) || /^\s/.test(text.slice(line.sourceEnd))));
  assert.ok(result.glyphs.some(glyph => glyph.styleId === 'title-highlight'));
  assert.ok(result.glyphs.some(glyph => glyph.styleId === 'title'));
  assert.deepEqual(new Set(result.glyphs.map(glyph => glyph.fontSize)), new Set([72]));
  assert.match(result.svg, /fill="#ffcc22"/);
  assert.ok(result.density > 0 && result.density <= 1);
});

test('uses exact authorized variable axes and weight when measuring body text', () => {
  const text = 'AVAV informação';
  const result = layout(input(text, { spans: [{ start: 0, end: text.length, styleId: 'body' }] }));
  const font = fontkit.create(fonts[1].bytes).getVariation({ wght: 450 });
  close(result.lines[0].advanceWidth, font.layout(text).advanceWidth * 44 / font.unitsPerEm);
  assert.deepEqual(result.glyphs[0].axes, { wght: 450 });
  assert.equal(result.glyphs[0].weight, 450);
  assert.equal(result.fontSize, 44);
});

test('chooses the largest fitting integer size and never shrinks below style minimum', () => {
  const text = 'WWWW';
  const narrow = { x: 72, y: 192, width: 240, height: 600 };
  const result = layout(input(text, { region: narrow }));
  assert.ok(Number.isInteger(result.fontSize));
  assert.ok(result.fontSize >= 72 && result.fontSize < 176);
  assert.throws(() => layout(input(text, { region: narrow, styles: fixedStyles('title', result.fontSize + 1) })), { code: 'COMPOSITION_LIMIT_EXCEEDED' });
  assert.throws(() => layout(input('W'.repeat(100), { region: narrow })), { code: 'COMPOSITION_LIMIT_EXCEEDED' });
});

test('enforces declared line counts and nominal line-height occupancy', () => {
  assert.throws(() => layout(input('A\nB', { maxLines: 1 })), { code: 'COMPOSITION_LIMIT_EXCEEDED' });
  assert.throws(() => layout(input('A', { styles: fixedStyles('title', 72), region: { x: 72, y: 192, width: 936, height: 72 } })), { code: 'COMPOSITION_LIMIT_EXCEEDED' });
  const result = layout(input('A\nB', { styles: fixedStyles('title', 72) }));
  close(result.lines[1].baseline - result.lines[0].baseline, 72 * 1.06);
  close(result.occupancy, 2 * 72 * 1.06 / 600);
});

test('handles negative bearings using real ink and declared center/right alignment', () => {
  const font = fontkit.create(fonts[0].bytes);
  const character = 'Î';
  assert.ok(font.layout(character).glyphs[0].bbox.minX < 0);
  for (const alignment of ['left', 'center', 'right']) {
    const args = input(character, { styles: fixedStyles('title', 72, [alignment]), alignment });
    const result = layout(args);
    assert.ok(inside(args.region, result.inkBounds));
    if (alignment === 'left') close(result.inkBounds.x, args.region.x);
    if (alignment === 'right') close(result.lines[0].box.x + result.lines[0].box.width, args.region.x + args.region.width);
  }
  assert.throws(() => layout(input('A', { alignment: 'center' })), { code: 'COMPOSITION_LIMIT_EXCEEDED' });
});

test('rejects missing, mismatched, unbound, or silently substituted font resources', () => {
  assert.throws(() => layout(input('A', { fonts: [] })), { code: 'FONT_RESOURCE_MISSING' });
  assert.throws(() => layout(input('A', { fonts: [{ ...fonts[0], bytes: fonts[1].bytes }] })), { code: 'FONT_HASH_MISMATCH' });
  assert.throws(() => layout(input('A', { bindings: [] })), { code: 'FONT_BINDING_INVALID' });
  const invalidBindings = definition.fontBindings.map(binding => binding.fontId === 'Anton' ? { ...binding, axes: { wght: 400 } } : binding);
  assert.throws(() => layout(input('A', { bindings: invalidBindings })), { code: 'FONT_BINDING_INVALID' });
});

test('fails on unsupported glyphs instead of normalization, deletion, or fallback', () => {
  for (const text of ['texto 🦄', 'A\u0301', '\u200b']) {
    assert.throws(() => layout(input(text, { spans: [{ start: 0, end: text.length, styleId: 'body' }] })), { code: 'FONT_GLYPH_UNSUPPORTED' });
  }
  assert.throws(() => layout(input('   ')), { code: 'COMPOSITION_LIMIT_EXCEEDED' });
});

test('rejects broken span coverage, grapheme splits, incompatible size ranges and injected color', () => {
  assert.throws(() => layout(input('ABC', { spans: [{ start: 0, end: 2, styleId: 'title' }] })), { code: 'COMPOSITION_LIMIT_EXCEEDED' });
  assert.throws(() => layout(input('A\u0301', { spans: [{ start: 0, end: 1, styleId: 'title' }, { start: 1, end: 2, styleId: 'title-highlight' }] })), { code: 'COMPOSITION_LIMIT_EXCEEDED' });
  assert.throws(() => layout(input('AB', { spans: [{ start: 0, end: 1, styleId: 'title' }, { start: 1, end: 2, styleId: 'body' }] })), { code: 'COMPOSITION_LIMIT_EXCEEDED' });
  assert.throws(() => layout(input('A', { styles: styles.map(style => ({ ...style, color: '\"/><script/>' })) })), { code: 'COMPOSITION_LIMIT_EXCEEDED' });
});

test('aggregate ink boxes conservatively contain every glyph at floating-point boundaries', () => {
  const text = 'CADERNO DE IDEIAS';
  const result = layout(input(text, { spans: [{ start: 0, end: text.length, styleId: 'eyebrow' }],
    region: { x: 72, y: 64, width: 648, height: 96 }, maxLines: 1 }));
  for (const glyph of result.glyphs) assert.ok(inside(result.inkBounds, glyph.inkBounds));
  for (const line of result.lines) {
    for (const fragment of line.fragments) assert.ok(inside(line.inkBounds, fragment.inkBounds));
  }
});

test('expands nominal leading for real accented ink instead of colliding or compressing lines', () => {
  const candidate = catalog.qualifications.find(record => record.definition.layoutId === 'diagram-explainer@1').definition;
  for (const text of ['Do problema\nà próxima ação.', 'Áç\nÁç']) {
    const result = layout(input(text, { styles: candidate.styles.map(style => ({ ...style, color: '#181818' })),
      bindings: candidate.fontBindings, region: candidate.regions.find(region => region.id === 'title'), maxLines: 3 }));
    assert.equal(result.lines.length, 2);
    assert.ok(result.lines.every(line => line.lineHeight >= line.nominalLineHeight));
    assert.ok(result.lines.some(line => line.lineHeight > line.nominalLineHeight));
    close(result.lines[1].baseline - result.lines[0].baseline, result.lines[0].lineHeight);
    close(result.occupancy, result.lines.reduce((height, line) => height + line.lineHeight, 0) / 192);
    assert.ok(result.lines[0].inkBounds.y + result.lines[0].inkBounds.height <= result.lines[1].inkBounds.y);
    assert.ok(result.fontSize >= 54 && result.fontSize <= 88);
  }
});
