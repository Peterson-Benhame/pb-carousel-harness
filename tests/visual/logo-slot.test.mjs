import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { buildPanoramaSvg } from '../../shared/templates/panorama.svg.js';
import { renderCarousel } from '../../scripts/render-carousel.mjs';
import { resolveLegacyRenderContext } from '../../src/adapters/legacy/render-context.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { sha256, loadResourcesManifest, inspectPackage } from '../../src/infrastructure/resources.mjs';
import { temporary, fontRoot, readCarousel, fixtureRoot, packageRoot } from '../helpers/legacy-render-fixture.mjs';
import { logoSnapshot, png } from '../helpers/logo-slot-fixture.mjs';
async function fixture(surface) {
  const data = await logoSnapshot(surface), carousel = await readCarousel(); carousel.theme = `synthetic-${surface}`;
  const context = await resolveLegacyRenderContext({ snapshot: data.frozen, fontRoot, logoData: data.logoData });
  return { ...data, context, carousel };
}
for (const surface of ['light', 'dark']) test(`${surface} dense composition preserves content/footer and exact PNG bytes at 1080 and 360`, async t => {
  const root = await temporary(t), f = await fixture(surface);
  f.carousel.slides[2].body = 'Ação, precisão e revisão.\nCada palavra permanece.\nDados para conferir.\nMais uma linha íntegra.\nCódigo abaixo.';
  const inputHash = canonicalHash(f.carousel), pngHashes = f.logoData.map(asset => sha256(asset.bytes));
  const svg = buildPanoramaSvg({ carousel: f.carousel, ...f.context, assetData: {} });
  assert.equal((svg.match(/class="brand-logo"/g) ?? []).length, 5);
  assert.ok(svg.includes('data-logo-slot="756 64 240 80"')); assert.ok(svg.includes(f.brand.profile));
  const selected = f.logoData.find(asset => asset.id === f.brand.logo.variants[surface]);
  assert.ok(svg.includes(`href="data:image/png;base64,${selected.bytes.toString('base64')}"`));
  for (const slide of f.carousel.slides) for (const field of ['eyebrow', 'title', 'body', 'code']) if (slide[field]) assert.ok(svg.includes(slide[field].replaceAll('\n', ' ')));
  const result = await renderCarousel({ carousel: f.carousel, inputDir: fixtureRoot, outputDir: root, context: f.context });
  assert.equal(result.slidePaths.length, 5);
  for (const file of result.slidePaths) {
    const full = await sharp(file).metadata(); assert.deepEqual([full.width, full.height], [1080, 1350]);
    const mobile = await sharp(file).resize({ width: 360 }).toBuffer(); assert.equal((await sharp(mobile).metadata()).height, 450);
    const slot = await sharp(file).extract({ left: 756, top: 64, width: 240, height: 80 }).raw().toBuffer();
    assert.ok(new Set(slot).size > 3, 'logo ink is present in the rendered protected area');
  }
  assert.equal(canonicalHash(f.carousel), inputHash); assert.deepEqual(f.logoData.map(asset => sha256(asset.bytes)), pngHashes);
});
test('continuity overlapping protected slot is refused before output, same asset remains usable with logo off', async t => {
  const root = await temporary(t), f = await fixture('dark');
  const bytes = await png({ width: 100, height: 400, ink: { x: 10, y: 0, width: 80, height: 400 } });
  await writeFile(path.join(root, 'creative.png'), bytes);
  f.carousel.assets = [{ id: 'creative', path: 'creative.png', approved: true, transparent: true }];
  f.carousel.continuity = [{ from: 1, to: 2, assetId: 'creative' }];
  await assert.rejects(renderCarousel({ carousel: f.carousel, inputDir: root, outputDir: path.join(root, 'out'), context: f.context }), { code: 'LOGO_LAYOUT_CONFLICT' });
  assert.deepEqual(await readdir(root), ['creative.png']); assert.deepEqual(await readFile(path.join(root, 'creative.png')), bytes);
  f.frozen.brand.config.logo.enabled = false; f.frozen.brand.effectiveHash = canonicalHash(f.frozen.brand.config);
  const off = await resolveLegacyRenderContext({ snapshot: f.frozen, fontRoot });
  const rendered = await renderCarousel({ carousel: f.carousel, inputDir: root, outputDir: path.join(root, 'off'), context: off });
  assert.equal(rendered.slidePaths.length, 5);
});
test('explicit context binds selected PNG to frozen ID/hash and never falls back', async () => {
  const { frozen, logoData } = await logoSnapshot('dark');
  await assert.rejects(resolveLegacyRenderContext({ snapshot: frozen, fontRoot }), { code: 'RESOURCE_MISSING' });
  const changed = structuredClone(frozen); changed.logos.find(l => l.surface === 'dark').sha256 = '0'.repeat(64);
  await assert.rejects(resolveLegacyRenderContext({ snapshot: changed, fontRoot, logoData }), { code: 'ASSET_HASH_MISMATCH' });
  const missing = structuredClone(frozen); missing.logos = missing.logos.filter(l => l.surface !== 'dark');
  await assert.rejects(resolveLegacyRenderContext({ snapshot: missing, fontRoot, logoData }), { code: 'SNAPSHOT_HASH_MISMATCH' });
});
test('enabled template cannot silently omit or accept a forged prepared logo', async () => {
  const f = await fixture('dark');
  assert.throws(() => buildPanoramaSvg({ carousel: f.carousel, ...f.context, logoLayout: null, assetData: {} }), { code: 'LOGO_LAYOUT_INVALID' });
  assert.throws(() => buildPanoramaSvg({ carousel: f.carousel, ...f.context, logoLayout: { ...f.context.logoLayout }, assetData: {} }), { code: 'LOGO_LAYOUT_INVALID' });
});
test('actual logo module participates in the transitive renderer identity', async () => {
  const manifest = await loadResourcesManifest(), file = 'src/adapters/legacy/logo-layout.mjs';
  assert.ok(manifest.requiredFiles.includes(file)); assert.ok(manifest.renderers[0].files.includes(file));
  assert.equal(manifest.renderers[0].hashes[file], sha256(await readFile(path.join(packageRoot, file))));
  assert.deepEqual((await inspectPackage({ manifest })).diagnostics, []);
});

test('only the right-side decorative circle is displaced clear of the active logo slot', async () => {
  const f = await fixture('dark'), svg = buildPanoramaSvg({ carousel: f.carousel, ...f.context, assetData: {} });
  const circles = [...svg.matchAll(/<circle cx="(\d+)" cy="(\d+)"/g)].map(match => [Number(match[1]), Number(match[2])]);
  assert.deepEqual(circles, [[952, 354], [128, 300], [952, 354], [952, 354], [952, 354]]);
});

test('actual font glyph extents cannot invade the protected slot through the template', async () => {
  const f = await fixture('dark');
  // Exercise the lower-level template with adversarial metrics in an in-memory
  // font copy. This font is never written, authorized or accepted by the context.
  const body = Buffer.from(f.context.fontData.body);
  for (let i = 0; i < body.readUInt16BE(4); i++) {
    const entry = 12 + i * 16;
    if (body.toString('ascii', entry, entry + 4) === 'head') body.writeUInt16BE(200, body.readUInt32BE(entry + 8) + 18);
  }
  f.carousel.slides = [{ ...f.carousel.slides[0], eyebrow: 'IIIIIIIIIIIIII', title: 'I', body: 'I', visualSlot: 'none' }];
  assert.throws(() => buildPanoramaSvg({ carousel: f.carousel, ...f.context, fontData: { ...f.context.fontData, body }, assetData: {} }), { code: 'LOGO_LAYOUT_CONFLICT' });
  assert.doesNotThrow(() => buildPanoramaSvg({ carousel: f.carousel, ...f.context, brand: { ...f.brand, logo: { ...f.brand.logo, enabled: false } }, fontData: { ...f.context.fontData, body }, assetData: {} }));
});

test('context owns original selected PNG before asynchronous runtime/font resolution', async () => {
  const { frozen, logoData } = await logoSnapshot('dark'), expected = logoData.find(asset => asset.id === frozen.brand.config.logo.variants.dark).sha256;
  const pending = resolveLegacyRenderContext({ snapshot: frozen, fontRoot, logoData });
  for (const asset of logoData) asset.bytes.fill(0);
  const context = await pending;
  assert.equal(context.logoLayout.sha256, expected);
  assert.equal(sha256(Buffer.from(context.logoLayout.dataUri.split(',')[1], 'base64')), expected);
});

test('non-overlapping creative continuity remains whole and unchanged with logo enabled', async t => {
  const root = await temporary(t), f = await fixture('dark');
  const bytes = await png({ width: 200, height: 160, ink: { x: 10, y: 10, width: 180, height: 140 }, color: '#F6A030' });
  await writeFile(path.join(root, 'creative.png'), bytes);
  f.carousel.assets = [{ id: 'creative', path: 'creative.png', approved: true, transparent: true }];
  f.carousel.continuity = [{ from: 2, to: 3, assetId: 'creative' }];
  const original = canonicalHash(f.carousel);
  const result = await renderCarousel({ carousel: f.carousel, inputDir: root, outputDir: path.join(root, 'out'), context: f.context });
  const boundary = await sharp(result.panoramaPath).extract({ left: 2160, top: 675, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...boundary], [246, 160, 48]);
  assert.equal(canonicalHash(f.carousel), original); assert.deepEqual(await readFile(path.join(root, 'creative.png')), bytes);
});

test('malformed frozen logo references return a bounded snapshot error', async () => {
  const { frozen, logoData } = await logoSnapshot('dark');
  for (const refs of [[null, frozen.logos[1]], [{ ...frozen.logos[0], surface: 'other' }, frozen.logos[1]], [frozen.logos[0], frozen.logos[0]]]) {
    const changed = structuredClone(frozen); changed.logos = refs;
    await assert.rejects(resolveLegacyRenderContext({ snapshot: changed, fontRoot, logoData }), { code: 'SNAPSHOT_HASH_MISMATCH' });
  }
});
