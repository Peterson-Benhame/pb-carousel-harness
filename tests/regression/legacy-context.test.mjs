import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import { buildPanoramaSvg } from '../../shared/templates/panorama.svg.js';
import { loadResourcesManifest, inspectPackage, sha256 } from '../../src/infrastructure/resources.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { config, temporary, snapshot, sandbox, pixelEvidence, readCarousel, fontRoot, fixtureRoot, packageRoot } from '../helpers/legacy-render-fixture.mjs';

async function adapter() {
  const module = await import('../../src/adapters/legacy/render-context.mjs').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return {};
  });
  assert.equal(typeof module.resolveLegacyRenderContext, 'function', 'T18 must expose the explicit legacy context resolver');
  return module.resolveLegacyRenderContext;
}
const inputs = async root => ({ carousel: await readCarousel(), inputDir: fixtureRoot, outputDir: path.join(root, 'output') });

// This first assertion identifies missing behavior, rather than failing import setup.
test('explicit context has snapshot brand/theme and only hash-verified external font bytes', async () => {
  const resolve = await adapter(), frozen = await snapshot(), before = canonicalHash(frozen);
  const context = await resolve({ snapshot: frozen, fontRoot });
  assert.deepEqual(context.brand, frozen.brand.config);
  assert.deepEqual(context.theme, frozen.theme.values);
  assert.equal(context.themeId, frozen.theme.id);
  const manifest = await loadResourcesManifest();
  for (const [role, id] of Object.entries(context.brand.fonts)) {
    assert.equal(sha256(context.fontData[role]), manifest.fonts.find(font => font.id === id).sha256);
  }
  assert.ok(!JSON.stringify(context.brand).includes('peterson'));
  assert.equal(canonicalHash(frozen), before);
  assert.ok(Object.isFrozen(context.brand)); assert.ok(Object.isFrozen(context.theme));
});

test('archived source and captured real-font baseline remain pinned before adaptation', async () => {
  const expected = {
    'render-carousel.mjs.txt': 'c3bd8b58b6f36e79041bd304353198a805a379a60eed00fc1b7519e523eb4166',
    'panorama.svg.js.txt': '891c7542ac42937ab1e815afe7b91330bff76cf85b044bb31bb6fc07f1ed117a',
    'validate-carousel.mjs.txt': '5ca70717d7f0298da1f65c0948341d04aee1dcf8af8d23f3ebb4b8e0c8dc61bb',
  };
  for (const [file, hash] of Object.entries(expected)) assert.equal(sha256(await readFile(path.join(fixtureRoot, 'before-context', file))), hash);
  const capture = JSON.parse(await readFile(path.join(fixtureRoot, 'baseline-capture.json'), 'utf8'));
  assert.equal(capture.pixels.length, 6);
  assert.deepEqual(capture.runtime.fonts, (await loadResourcesManifest()).fonts.map(({ id, sha256 }) => ({ id, sha256 })));
  assert.deepEqual(capture.pixels.slice(1).map(p => [p.width, p.height]), Array(5).fill([1080, 1350]));
});

test('same-runtime decoded pixels and all content equal archived legacy with logo off', async t => {
  const root = await temporary(t), carousel = await readCarousel(), original = canonicalHash(carousel);
  const baseline = await sandbox(path.join(root, 'before'), { baseline: true });
  const current = await sandbox(path.join(root, 'after'), { globals: false, legacyFonts: false });
  const resolve = await adapter(), context = await resolve({ snapshot: await snapshot(), fontRoot });
  const first = await baseline.renderCarousel({ carousel, inputDir: fixtureRoot, outputDir: path.join(root, 'original') });
  const second = await current.renderCarousel({ carousel, inputDir: fixtureRoot, outputDir: path.join(root, 'explicit'), context });
  assert.deepEqual(await pixelEvidence(second), await pixelEvidence(first));
  const svg = buildPanoramaSvg({ carousel, ...context, assetData: {} });
  for (const slide of carousel.slides) for (const key of ['eyebrow', 'title', 'body', 'code']) {
    if (slide[key]) assert.ok(svg.includes(slide[key].replaceAll('\n', ' ')), `${key} content represented in SVG labels`);
  }
  assert.ok(svg.includes('@marca_sintetica'));
  assert.equal(canonicalHash(carousel), original);
});

test('legacy no-context API and CLI keep synthetic baseline pixels and output names', async t => {
  const root = await temporary(t), carousel = await readCarousel();
  const baseline = await sandbox(path.join(root, 'before'), { baseline: true });
  const current = await sandbox(path.join(root, 'after'));
  const expected = await baseline.renderCarousel({ carousel, inputDir: fixtureRoot, outputDir: path.join(root, 'before-out') });
  const actual = await current.renderCarousel({ carousel, inputDir: fixtureRoot, outputDir: path.join(root, 'after-out') });
  assert.deepEqual(await pixelEvidence(actual), await pixelEvidence(expected));
  const cli = await promisify(execFile)(process.execPath, [current.script, path.join(fixtureRoot, 'carousel.json'), path.join(root, 'cli-out')]);
  assert.equal(cli.stderr, ''); assert.deepEqual(await pixelEvidence(JSON.parse(cli.stdout)), await pixelEvidence(expected));
});

test('a second brand and theme render without any personal global JSON or bundled font directory', async t => {
  const root = await temporary(t), brand = config(); brand.name = 'Outra marca'; brand.profile = '@segunda_marca';
  brand.themes = { 'outro-tema': { background: '#F3F0E8', text: '#191919', muted: '#4A4A4A', accent: '#E95D2A', topics: [] } };
  const resolve = await adapter(), context = await resolve({ snapshot: await snapshot(brand, 'outro-tema'), fontRoot });
  const current = await sandbox(path.join(root, 'isolated'), { globals: false, legacyFonts: false });
  const args = await inputs(root); args.carousel.theme = 'outro-tema';
  const result = await current.renderCarousel({ ...args, context });
  const pixel = await sharp(result.slidePaths[0]).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...pixel], [243, 240, 232]);
  const svg = buildPanoramaSvg({ carousel: args.carousel, ...context, assetData: {} });
  assert.ok(svg.includes('@segunda_marca')); assert.ok(!svg.includes('@marca_sintetica')); assert.ok(!svg.includes('peterson'));
  assert.deepEqual(await readdir(path.join(root, 'isolated/shared')), ['templates']);
});

test('missing authorized font root fails closed despite bundled legacy fonts', async () => {
  const resolve = await adapter(); await assert.rejects(resolve({ snapshot: await snapshot() }), { code: 'RESOURCE_MISSING' });
});

test('tampered font file fails before output and never falls back to bundled fonts', async t => {
  const root = await temporary(t), fonts = path.join(root, 'fonts'); await mkdir(fonts);
  const manifest = await loadResourcesManifest();
  for (const font of manifest.fonts) await writeFile(path.join(fonts, font.file), `TAMPERED SYNTHETIC ${font.id}`);
  const resolve = await adapter(); await assert.rejects(resolve({ snapshot: await snapshot(), fontRoot: fonts }), { code: 'RUNTIME_MISMATCH' });
  assert.deepEqual(await readdir(root), ['fonts']);
});

test('snapshot font, runtime and renderer mismatches are rejected', async () => {
  const resolve = await adapter(), original = await snapshot();
  for (const mutate of [s => { s.fonts[0].sha256 = '0'.repeat(64); }, s => { s.runtime.node = 'v0.0.0'; }, s => { s.runtime.renderer.files['scripts/render-carousel.mjs'] = '0'.repeat(64); }]) {
    const changed = structuredClone(original); mutate(changed);
    await assert.rejects(resolve({ snapshot: changed, fontRoot }), { code: 'RUNTIME_MISMATCH' });
  }
});

test('v2 snapshots and alternate renderers cannot silently use legacy adapter', async () => {
  const resolve = await adapter(), original = await snapshot();
  for (const mutate of [s => { s.schemaVersion = 2; }, s => { s.contractVersion = 2; }, s => { s.renderer.id = 'editorial-composed@1'; }, s => { s.brand.config.configVersion = 2; }]) {
    const changed = structuredClone(original); mutate(changed);
    await assert.rejects(resolve({ snapshot: changed, fontRoot }), { code: 'RUN_CONTRACT_UNSUPPORTED' });
  }
});

test('enabled logo without a variant remains invalid after T19 extends the adapter', async () => {
  const resolve = await adapter(), frozen = await snapshot(); frozen.brand.config.logo.enabled = true;
  await assert.rejects(resolve({ snapshot: frozen, fontRoot }), { code: 'INVALID_ARGUMENT' });
});

test('inconsistent frozen brand, theme and dimensions cannot be interpreted partially', async () => {
  const resolve = await adapter(), original = await snapshot();
  for (const mutate of [s => { s.theme.values.background = '#FFFFFF'; }, s => { s.theme.id = 'absent'; }, s => { s.dimensions.width = 10; }, s => { s.brand.effectiveHash = '0'.repeat(64); }]) {
    const changed = structuredClone(original); mutate(changed);
    await assert.rejects(resolve({ snapshot: changed, fontRoot }), { code: 'SNAPSHOT_HASH_MISMATCH' });
  }
});

test('context is detached and byte tampering, null, forgery and conflicting theme never fall back', async t => {
  const root = await temporary(t), resolve = await adapter(), frozen = await snapshot();
  const context = await resolve({ snapshot: frozen, fontRoot });
  frozen.brand.config.profile = '@changed'; assert.equal(context.brand.profile, '@marca_sintetica');
  const current = await sandbox(path.join(root, 'isolated'), { globals: false, legacyFonts: false });
  const args = await inputs(root);
  for (const invalid of [null, {}, { ...context }]) await assert.rejects(current.renderCarousel({ ...args, context: invalid }), { code: 'INVALID_ARGUMENT' });
  args.carousel.theme = 'other'; await assert.rejects(current.renderCarousel({ ...args, context }), { code: 'INVALID_ARGUMENT' });
  args.carousel.theme = context.themeId; context.fontData.title[0] ^= 1;
  await assert.rejects(current.renderCarousel({ ...args, context }), { code: 'RUNTIME_MISMATCH' });
  assert.deepEqual(await readdir(root), ['isolated']);
});

test('explicit path preserves confined asset checks and rejects traversal and symlink escape', async t => {
  const root = await temporary(t), resolve = await adapter(), context = await resolve({ snapshot: await snapshot(), fontRoot });
  const current = await sandbox(path.join(root, 'isolated'), { globals: false, legacyFonts: false });
  const args = await inputs(root), inside = path.join(root, 'input'); await mkdir(inside); args.inputDir = inside;
  args.carousel.assets = [{ id: 'synthetic', path: '../outside.png', approved: true, transparent: true }];
  await assert.rejects(current.renderCarousel({ ...args, context }), /normalized relative internal path/);
  await mkdir(path.join(root, 'outside'));
  await writeFile(path.join(root, 'outside/pixel.png'), await sharp({ create: { width: 2, height: 2, channels: 4, background: '#00000000' } }).png().toBuffer());
  await symlink(path.join(root, 'outside'), path.join(inside, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  args.carousel.assets[0].path = 'escape/pixel.png';
  await assert.rejects(current.renderCarousel({ ...args, context }), /outside inputDir/);
});

test('current legacy identity includes adapter dependencies and historical v1 manifest stays readable', async () => {
  const manifest = await loadResourcesManifest();
  assert.deepEqual(manifest.renderer.files, ['scripts/render-carousel.mjs', 'shared/templates/panorama.svg.js', 'scripts/validate-carousel.mjs']);
  for (const file of ['src/adapters/legacy/render-context.mjs', 'src/infrastructure/resources.mjs', 'src/domain/brand-schema.mjs', 'src/domain/canonical-json.mjs', 'src/infrastructure/fs/confined-path.mjs']) {
    assert.ok(manifest.renderers[0].files.includes(file), `${file} must be in the effective render identity`);
    assert.equal(manifest.renderers[0].hashes[file], sha256(await readFile(path.join(packageRoot, file))));
  }
  const current = await inspectPackage({ manifest }); assert.deepEqual(current.diagnostics, []);
  const { renderers, optionalFonts, ...historical } = manifest; historical.schemaVersion = 1;
  const old = await inspectPackage({ manifest: historical }); assert.deepEqual(old.diagnostics, []);
  assert.equal(old.renderer.id, 'legacy-panorama@1'); assert.equal(Object.keys(old.renderer.files).length, 3);
  const candidate = await inspectPackage({ manifest, rendererId: 'editorial-composed@1' });
  assert.deepEqual(candidate.diagnostics.map(d => d.code), ['LAYOUT_NOT_QUALIFIED']);
  assert.ok(candidate.diagnostics.some(d => d.code === 'LAYOUT_NOT_QUALIFIED'));
});

// Async asset loading must not reopen a mutation window after verification.
test('render consumes a stable copy of verified font bytes across its asynchronous boundary', async t => {
  const root = await temporary(t), resolve = await adapter(), context = await resolve({ snapshot: await snapshot(), fontRoot });
  const current = await sandbox(path.join(root, 'isolated'), { globals: false, legacyFonts: false });
  const args = await inputs(root);
  const expected = await current.renderCarousel({ ...args, outputDir: path.join(root, 'expected'), context });
  const rendering = current.renderCarousel({ ...args, context });
  context.fontData.title.fill(0);
  const actual = await rendering;
  assert.deepEqual(await pixelEvidence(actual), await pixelEvidence(expected));
});
