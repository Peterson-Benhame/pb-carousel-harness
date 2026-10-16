import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { buildPanoramaSvg } from '../shared/templates/panorama.svg.js';
import { validateCarousel } from './validate-carousel.mjs';
import { assertLegacyRenderContext } from '../src/adapters/legacy/render-context.mjs';

const pluginRoot = new URL('../', import.meta.url);
const activeOutputs = new Set();

const readJson = async (relativePath) => JSON.parse(
  await readFile(new URL(relativePath, pluginRoot), 'utf8'),
);

const roleFilename = (slide, position) => {
  const role = {
    cover: 'capa',
    context: 'contexto',
    content: 'conteudo',
    summary: 'sintese',
    cta: 'cta',
  }[slide.role];
  return `${String(position + 1).padStart(2, '0')}-${role}.png`;
};

const isInside = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);

const loadAssetData = async (carousel, inputDir) => {
  if (carousel.assets.length === 0) return {};
  const inputRoot = await realpath(inputDir);
  const assets = await Promise.all(carousel.assets.map(async (asset) => {
    const candidate = path.resolve(inputRoot, asset.path);
    if (!isInside(inputRoot, candidate)) {
      throw new Error(`Asset ${asset.id} resolves outside inputDir`);
    }
    const resolvedPath = await realpath(candidate);
    if (!isInside(inputRoot, resolvedPath)) {
      throw new Error(`Asset ${asset.id} resolves outside inputDir`);
    }

    const image = sharp(resolvedPath, { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error(`Asset ${asset.id} has invalid image dimensions`);
    }
    if (!metadata.hasAlpha) {
      throw new Error(`Asset ${asset.id} must contain an alpha channel`);
    }
    const { data: pixels, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const alphaIndex = info.channels - 1;
    let hasTransparentPixel = false;
    for (let offset = alphaIndex; offset < pixels.length; offset += info.channels) {
      if (pixels[offset] < 255) {
        hasTransparentPixel = true;
        break;
      }
    }
    if (!hasTransparentPixel) {
      throw new Error(`Asset ${asset.id} must contain transparent pixels`);
    }
    const normalized = await image.png().toBuffer();
    return [asset.id, {
      dataUri: `data:image/png;base64,${normalized.toString('base64')}`,
      width: metadata.width,
      height: metadata.height,
    }];
  }));
  return Object.fromEntries(assets);
};

const loadFontData = async () => {
  const fontRoot = new URL('assets/fonts/', pluginRoot);
  const [title, body, mono] = await Promise.all([
    readFile(new URL('Anton-Regular.ttf', fontRoot)),
    readFile(new URL('Manrope-VariableFont_wght.ttf', fontRoot)),
    readFile(new URL('JetBrainsMono-VariableFont_wght.ttf', fontRoot)),
  ]);
  return { title, body, mono };
};

export const renderCarousel = async ({ carousel, inputDir, outputDir, context }) => {
  const explicit = context === undefined ? null : assertLegacyRenderContext(context, carousel);
  const errors = explicit
    ? validateCarousel(carousel, { themes: [explicit.themeId] })
    : validateCarousel(carousel);
  if (errors.length > 0) {
    throw new Error(`Invalid carousel: ${errors.join('; ')}`);
  }

  const outputKey = path.resolve(outputDir);
  if (activeOutputs.has(outputKey)) {
    throw new Error('Render already in progress for outputDir');
  }
  activeOutputs.add(outputKey);
  try {
    const brand = explicit ? explicit.brand : await readJson('shared/brand.json');
    const theme = explicit ? explicit.theme : (await readJson('shared/themes.json'))[carousel.theme];
    const [fontData, assetData] = await Promise.all([
      explicit ? explicit.fontData : loadFontData(),
      loadAssetData(carousel, inputDir),
    ]);
    const svg = buildPanoramaSvg({ carousel, brand, theme, fontData, assetData, logoLayout: explicit?.logoLayout });

    await mkdir(outputDir, { recursive: true });
    const panoramaPath = path.join(outputDir, 'panorama-preview.png');
    const slidesDir = path.join(outputDir, 'slides');
    await Promise.all([
      rm(panoramaPath, { force: true }),
      rm(slidesDir, { recursive: true, force: true }),
    ]);
    await sharp(Buffer.from(svg)).png().toFile(panoramaPath);

    await mkdir(slidesDir, { recursive: true });
    const slidePaths = [];
    for (const [index, slide] of carousel.slides.entries()) {
      const slidePath = path.join(slidesDir, roleFilename(slide, index));
      await sharp(panoramaPath)
        .extract({ left: index * brand.slideWidth, top: 0, width: brand.slideWidth, height: brand.slideHeight })
        .png()
        .toFile(slidePath);
      slidePaths.push(slidePath);
    }

    return { panoramaPath, slidePaths };
  } finally {
    activeOutputs.delete(outputKey);
  }
};

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const carouselPath = process.argv[2];
  if (!carouselPath) {
    console.error('Usage: node render-carousel.mjs <carousel.json> [output-directory]');
    process.exitCode = 2;
  } else {
    try {
      const absoluteCarouselPath = path.resolve(carouselPath);
      const carousel = JSON.parse(await readFile(absoluteCarouselPath, 'utf8'));
      const result = await renderCarousel({
        carousel,
        inputDir: path.dirname(absoluteCarouselPath),
        outputDir: path.resolve(process.argv[3] ?? path.join(path.dirname(absoluteCarouselPath), 'rendered')),
      });
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
