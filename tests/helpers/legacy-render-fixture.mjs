import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { buildRunSnapshot } from '../../src/domain/run-snapshot.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { loadResourcesManifest, inspectPackage, probeDependency, dependencyNames, sha256 } from '../../src/infrastructure/resources.mjs';

export const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const fixtureRoot = fileURLToPath(new URL('../fixtures/legacy/', import.meta.url));
// An explicitly selected existing directory; never search the user's OS or copy fonts.
export const fontRoot = process.env.CAROUSEL_TEST_FONT_ROOT ?? path.join(packageRoot, 'assets/fonts');
export const config = () => ({
  name: 'Marca sintética', profile: '@marca_sintetica', language: 'pt-BR',
  audience: null, voice: null, preferences: [],
  fonts: { title: 'Anton', body: 'Manrope', mono: 'JetBrains Mono' },
  themes: { 'synthetic-dark': { background: '#07111F', text: '#F4F7FB', muted: '#B9C7D8', accent: '#32D5FF', topics: [] } },
  logo: { enabled: false, variants: {}, protection: 12, minimumHeight: 24 },
  slideWidth: 1080, slideHeight: 1350, minimumSlideCount: 12, maximumSlideCount: 16, profileImage: '',
});
export const legacyBrand = brand => Object.fromEntries([
  'profile', 'language', 'fonts', 'slideWidth', 'slideHeight', 'minimumSlideCount', 'maximumSlideCount', 'profileImage',
].map(key => [key, brand[key]]));
export const readCarousel = async () => JSON.parse(await readFile(path.join(fixtureRoot, 'carousel.json'), 'utf8'));
export async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'carousel T18 ação '));
  t?.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
export async function runtimeIdentity() {
  const manifest = await loadResourcesManifest();
  const packageInfo = await inspectPackage({ manifest });
  const dependencies = Object.fromEntries(await Promise.all(dependencyNames.map(async name => [name, await probeDependency(name)])));
  const fonts = await Promise.all(manifest.fonts.map(async font => ({ id: font.id, sha256: sha256(await readFile(path.join(fontRoot, font.file))) })));
  return { package: packageInfo.package, node: process.version, platform: process.platform, arch: process.arch,
    abi: process.versions.modules, napi: process.versions.napi, renderer: packageInfo.renderer, dependencies, fonts };
}
export async function snapshot(brand = config(), theme = 'synthetic-dark') {
  const runtime = await runtimeIdentity();
  return buildRunSnapshot({ brand: { brandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1,
    hash: canonicalHash(brand), config: brand }, theme, fonts: runtime.fonts, logos: [], runtime,
    resourceState: { renderPrerequisites: true, blockers: [] } });
}

/** Execute the unchanged archived algorithm in a synthetic package. Only module
 * resolution and the authorized font-root literal are rebound, never rendering logic.
 * Current-code sandboxes can omit globals and legacy fonts entirely.
 */
export async function sandbox(root, { baseline = false, globals = true, brand = config(), legacyFonts = true } = {}) {
  const scriptRoot = path.join(root, 'scripts'), sharedRoot = path.join(root, 'shared');
  await mkdir(scriptRoot, { recursive: true });
  await mkdir(path.join(sharedRoot, 'templates'), { recursive: true });
  const source = async (file, archived) => readFile(baseline ? path.join(fixtureRoot, 'before-context', archived) : path.join(packageRoot, file), 'utf8');
  let renderer = await source('scripts/render-carousel.mjs', 'render-carousel.mjs.txt');
  renderer = renderer.replace("from 'sharp'", `from ${JSON.stringify(import.meta.resolve('sharp'))}`);
  renderer = renderer.replace("from '../src/adapters/legacy/render-context.mjs'", `from ${JSON.stringify(new URL('../../src/adapters/legacy/render-context.mjs', import.meta.url).href)}`);
  if (legacyFonts) renderer = renderer.replace("new URL('assets/fonts/', pluginRoot)", `new URL(${JSON.stringify(pathToFileURL(`${fontRoot}${path.sep}`).href)})`);
  const template = (await source('shared/templates/panorama.svg.js', 'panorama.svg.js.txt'))
    .replace("from 'fontkit'", `from ${JSON.stringify(import.meta.resolve('fontkit'))}`)
    .replace("from '../../src/adapters/legacy/logo-layout.mjs'", `from ${JSON.stringify(new URL('../../src/adapters/legacy/logo-layout.mjs', import.meta.url).href)}`);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(path.join(scriptRoot, 'render-carousel.mjs'), renderer);
  await writeFile(path.join(scriptRoot, 'validate-carousel.mjs'), await source('scripts/validate-carousel.mjs', 'validate-carousel.mjs.txt'));
  await writeFile(path.join(sharedRoot, 'templates/panorama.svg.js'), template);
  if (globals) {
    await writeFile(path.join(sharedRoot, 'brand.json'), JSON.stringify(legacyBrand(brand)));
    await writeFile(path.join(sharedRoot, 'themes.json'), JSON.stringify(brand.themes));
  }
  const script = path.join(scriptRoot, 'render-carousel.mjs');
  return { script, renderCarousel: (await import(pathToFileURL(script).href)).renderCarousel };
}
export async function pixelEvidence(result) {
  return Promise.all([result.panoramaPath, ...result.slidePaths].map(async file => {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { file: path.basename(file), width: info.width, height: info.height, channels: info.channels, sha256: sha256(data) };
  }));
}
