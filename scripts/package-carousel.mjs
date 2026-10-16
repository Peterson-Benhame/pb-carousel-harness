import { createWriteStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import archiver from 'archiver';
import { validateCarousel } from './validate-carousel.mjs';

const fixedDate = new Date('1980-01-01T00:00:00.000Z');

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

const captionMarkdown = (carousel) => `${carousel.caption.trim()}

## CTA

${carousel.cta.trim()}

## Hashtags

${carousel.hashtags.join(' ')}

## Texto alternativo

${carousel.altText.trim()}
`;

const referencesMarkdown = (carousel) => `# Referências

${carousel.sources.map((source) => `- [${source.title}](${source.url})`).join('\n')}
`;

const createZip = async ({ zipPath, files }) => {
  await new Promise((resolve, reject) => {
    const destination = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    destination.on('close', resolve);
    destination.on('error', reject);
    archive.on('error', reject);
    archive.pipe(destination);
    for (const file of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
      archive.append(file.data, { name: file.name, date: fixedDate, mode: 0o644 });
    }
    archive.finalize().catch(reject);
  });
};

export const packageCarousel = async ({ carousel, renderResult, outputDir }) => {
  const errors = validateCarousel(carousel);
  if (errors.length > 0) throw new Error(`Invalid carousel: ${errors.join('; ')}`);

  const expectedNames = carousel.slides.map(roleFilename);
  const renderedNames = renderResult.slidePaths.map((slidePath) => path.basename(slidePath));
  if (renderedNames.length !== expectedNames.length
    || renderedNames.some((name, index) => name !== expectedNames[index])) {
    throw new Error('Rendered slide filenames do not match the validated carousel');
  }
  const renderedDirectoryNames = (await readdir(path.dirname(renderResult.slidePaths[0]))).sort();
  const sortedExpectedNames = [...expectedNames].sort();
  if (renderedDirectoryNames.length !== expectedNames.length
    || renderedDirectoryNames.some((name, index) => name !== sortedExpectedNames[index])) {
    throw new Error('Rendered slide directory contains missing or unexpected files');
  }

  await rm(outputDir, { recursive: true, force: true });
  const slidesDir = path.join(outputDir, 'slides');
  await mkdir(slidesDir, { recursive: true });

  const slidePaths = [];
  for (const [index, sourcePath] of renderResult.slidePaths.entries()) {
    const destinationPath = path.join(slidesDir, expectedNames[index]);
    await copyFile(sourcePath, destinationPath);
    slidePaths.push(destinationPath);
  }

  const panoramaPath = path.join(outputDir, 'panorama-preview.png');
  const captionPath = path.join(outputDir, 'legenda.md');
  const referencesPath = path.join(outputDir, 'referencias.md');
  await Promise.all([
    copyFile(renderResult.panoramaPath, panoramaPath),
    writeFile(captionPath, captionMarkdown(carousel), 'utf8'),
    writeFile(referencesPath, referencesMarkdown(carousel), 'utf8'),
  ]);

  const packageFiles = [
    { name: 'legenda.md', data: await readFile(captionPath) },
    { name: 'panorama-preview.png', data: await readFile(panoramaPath) },
    { name: 'referencias.md', data: await readFile(referencesPath) },
  ];
  for (const [index, slidePath] of slidePaths.entries()) {
    packageFiles.push({ name: `slides/${expectedNames[index]}`, data: await readFile(slidePath) });
  }

  const zipPath = path.join(outputDir, `${carousel.slug}.zip`);
  await createZip({ zipPath, files: packageFiles });
  return { zipPath, captionPath, referencesPath, panoramaPath, slidePaths };
};

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const [carouselArgument, renderedArgument, outputArgument] = process.argv.slice(2);
  if (!carouselArgument || !renderedArgument) {
    console.error('Usage: node package-carousel.mjs <carousel.json> <rendered-directory> [output-directory]');
    process.exitCode = 2;
  } else {
    try {
      const carouselPath = path.resolve(carouselArgument);
      const renderedDir = path.resolve(renderedArgument);
      const slideNames = (await readdir(path.join(renderedDir, 'slides'))).sort();
      const carousel = JSON.parse(await readFile(carouselPath, 'utf8'));
      const result = await packageCarousel({
        carousel,
        renderResult: {
          panoramaPath: path.join(renderedDir, 'panorama-preview.png'),
          slidePaths: slideNames.map((name) => path.join(renderedDir, 'slides', name)),
        },
        outputDir: path.resolve(outputArgument ?? path.join(path.dirname(carouselPath), 'delivery')),
      });
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
