import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { canonicalHash, canonicalJson } from '../src/domain/canonical-json.mjs';
import { qualificationRendererHash } from '../src/domain/quality-policy.mjs';
import { sha256 } from '../src/infrastructure/resources.mjs';
import { evaluateRenderedQuality } from '../src/quality/objective-checks.mjs';
import { getReviewRubric } from '../src/quality/review-rubric.mjs';
import { composeCarousel } from '../src/render/composed-carousel.mjs';
import { composedFixture, sealComposedFixture } from '../tests/helpers/composed-render-fixture.mjs';
import { qualityInput } from '../tests/helpers/quality-render-fixture.mjs';

const layouts = Object.freeze([
  'cover-editorial@1',
  'content-flow@1',
  'content-dense@1',
  'diagram-explainer@1',
  'cta-editorial@1',
]);
const referenceKeys = Object.freeze(['cover', 'interior']);
const sansSerifDecision = Object.freeze({
  choice: 'sans-serif-current',
  allowedFontIds: Object.freeze(['Anton', 'JetBrains Mono', 'Manrope']),
  renderedFontIds: Object.freeze(['Anton', 'Manrope']),
  excludedFontIds: Object.freeze(['nimbus-roman-italic@1']),
});
const palette = Object.freeze({
  background: '#F3F0E8', text: '#191919', muted: '#4A4A4A', accent: '#B74718', secondaryAccent: '#FF8753',
  topics: ['startups', 'empreendedorismo'],
  surfaceBindings: {
    light: { background: 'background', text: 'text', muted: 'muted', accent: 'accent' },
    dark: { background: 'text', text: 'background', muted: 'background', accent: 'secondaryAccent' },
  },
});

function inputError(message) {
  const error = new TypeError(message);
  error.code = 'INVALID_ARGUMENT';
  return error;
}

function inspectVisualDirectionDecision(value) {
  if (value === undefined) return null;
  const keys = ['schemaVersion', 'kind', 'status', 'choice', 'scope', 'allowedFontIds', 'renderedFontIds', 'excludedFontIds', 'qualificationGranted', 'source'];
  const sourceKeys = ['type', 'id'];
  const exactKeys = (candidate, expected) => candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    && Object.keys(candidate).sort().join('|') === [...expected].sort().join('|');
  if (!exactKeys(value, keys)
    || value.schemaVersion !== 1
    || value.kind !== 'visual-direction-selection'
    || value.status !== 'selected-for-evaluation'
    || value.choice !== sansSerifDecision.choice
    || value.scope !== 'qualification-samples-only'
    || canonicalJson(value.allowedFontIds) !== canonicalJson(sansSerifDecision.allowedFontIds)
    || canonicalJson(value.renderedFontIds) !== canonicalJson(sansSerifDecision.renderedFontIds)
    || canonicalJson(value.excludedFontIds) !== canonicalJson(sansSerifDecision.excludedFontIds)
    || value.qualificationGranted !== false
    || !exactKeys(value.source, sourceKeys)
    || value.source.type !== 'user-confirmation'
    || typeof value.source.id !== 'string'
    || value.source.id.length === 0) {
    throw inputError('Decisão visual sans-serif inválida ou fora do escopo de avaliação.');
  }
  return JSON.parse(canonicalJson(value));
}

async function imageRecord(bytes, relativePath) {
  const metadata = await sharp(bytes).metadata();
  const rgbaSha256 = sha256(await sharp(bytes).ensureAlpha().raw().toBuffer());
  return { relativePath, width: metadata.width, height: metadata.height, bytes: bytes.length, sha256: sha256(bytes), rgbaSha256 };
}

async function inspectReferences(references) {
  if (!references || typeof references !== 'object' || Object.keys(references).sort().join('|') !== [...referenceKeys].sort().join('|')) throw inputError('Duas referências V2 são obrigatórias.');
  const result = [];
  for (const key of referenceKeys) {
    const reference = references[key];
    if (!reference || !path.isAbsolute(reference.filePath) || typeof reference.libraryFileId !== 'string' || typeof reference.fileName !== 'string' || typeof reference.purpose !== 'string') throw inputError(`Referência ${key} inválida.`);
    const bytes = await readFile(reference.filePath), metadata = await sharp(bytes).metadata();
    if (metadata.format !== 'png' || metadata.width !== 1080 || metadata.height !== 1350) throw inputError(`Referência ${key} deve ser PNG 1080x1350.`);
    result.push({ key, libraryFileId: reference.libraryFileId, fileName: reference.fileName, purpose: reference.purpose, bytes: bytes.length, sha256: sha256(bytes), pixels: bytes });
  }
  return result;
}

async function writeJson(outputRoot, name, value) {
  await writeFile(path.join(outputRoot, name), `${canonicalJson(value)}\n`, { flag: 'wx' });
}

async function comparison(reference, generated) {
  const left = await sharp(reference).resize(360, 450, { fit: 'fill' }).png().toBuffer();
  const right = await sharp(generated).resize(360, 450, { fit: 'fill' }).png().toBuffer();
  return sharp({ create: { width: 720, height: 450, channels: 4, background: '#00000000' } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 360, top: 0 }]).png().toBuffer();
}

async function qualificationGrid(mobileImages) {
  if (!Array.isArray(mobileImages) || mobileImages.length !== layouts.length) throw inputError('A grade exige cinco amostras móveis.');
  const composites = [];
  for (let index = 0; index < mobileImages.length; index++) {
    const left = (index % 3) * 360;
    const top = Math.floor(index / 3) * 490;
    const label = layouts[index];
    const labelSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="40">
      <rect width="360" height="40" fill="#F3F0E8"/>
      <text x="18" y="27" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#191919">${label}</text>
    </svg>`);
    composites.push({ input: labelSvg, left, top }, { input: mobileImages[index], left, top: top + 40 });
  }
  return sharp({ create: { width: 1080, height: 980, channels: 4, background: '#F3F0E8' } })
    .composite(composites).png().toBuffer();
}

async function modularDiagram() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
    <g fill="none" stroke-linejoin="round" stroke-width="6">
      <path d="M40 222 150 164l110 58-110 58Z" fill="#F3F0E8" stroke="#F3F0E8"/>
      <path d="M40 258 150 200l110 58-110 58Z" fill="#B74718" stroke="#FF8753"/>
      <path d="M40 294 150 236l110 58-110 58Z" fill="#191919" stroke="#F3F0E8"/>
      <path d="M295 132 400 76l105 56-105 56Z" fill="#F3F0E8" stroke="#F3F0E8"/>
      <path d="M295 196 400 140l105 56-105 56Z" fill="#B74718" stroke="#FF8753"/>
      <path d="M295 260 400 204l105 56-105 56Z" fill="#191919" stroke="#F3F0E8"/>
      <path d="M540 222 650 164l110 58-110 58Z" fill="#F3F0E8" stroke="#F3F0E8"/>
      <path d="M540 258 650 200l110 58-110 58Z" fill="#B74718" stroke="#FF8753"/>
      <path d="M540 294 650 236l110 58-110 58Z" fill="#191919" stroke="#F3F0E8"/>
      <path d="M260 258h29M276 244l14 14-14 14M505 258h29M520 244l14 14-14 14" stroke="#FF8753" stroke-linecap="round"/>
      <circle cx="150" cy="222" r="21" fill="#191919" stroke="#B74718"/>
      <circle cx="400" cy="132" r="24" fill="#191919" stroke="#B74718"/>
      <path d="m628 222 18 18 34-39" stroke="#191919" stroke-linecap="round"/>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function verticalDiagram() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <g fill="none" stroke-linejoin="round" stroke-width="6">
      <path d="M84 116 300 18l216 98-216 98Z" fill="#F3F0E8" stroke="#F3F0E8"/>
      <ellipse cx="300" cy="116" rx="70" ry="42" stroke="#191919"/><circle cx="300" cy="116" r="18" fill="#191919"/>
      <path d="M84 302 300 204l216 98-216 98Z" fill="#191919" stroke="#F3F0E8"/>
      <path d="m192 302 54-24 54 24-54 24Zm108-49 54-24 54 24-54 24Zm0 98 54-24 54 24-54 24Z" fill="#4A4A4A" stroke="#4A4A4A"/>
      <path d="M84 488 300 390l216 98-216 98Z" fill="#B74718" stroke="#FF8753"/>
      <path d="m230 488 70-54 70 54-70 54Z" fill="#191919" stroke="#191919"/>
      <path d="M84 674 300 576l216 98-216 98Z" fill="#F3F0E8" stroke="#F3F0E8"/>
      <path d="M178 674c82-80 162 78 244-8" stroke="#191919" stroke-linecap="round"/>
      <circle cx="178" cy="674" r="12" fill="#191919"/><circle cx="422" cy="666" r="12" fill="#191919"/>
      <path d="M300 218v-28M300 404v-28M300 590v-28" stroke="#FF8753" stroke-linecap="round"/>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function environment(snapshot, qualification) {
  return {
    platform: snapshot.runtime.platform,
    arch: snapshot.runtime.arch,
    node: snapshot.runtime.node,
    abi: snapshot.runtime.abi,
    napi: snapshot.runtime.napi,
    dependenciesHash: canonicalHash(snapshot.runtime.dependencies),
    rendererHash: qualificationRendererHash(snapshot.runtime.renderer),
    fontBindingsHash: canonicalHash(qualification.definition.fontBindings),
  };
}

export async function runLayoutQualification({ outputRoot, references, visualDirectionDecision } = {}) {
  if (!path.isAbsolute(outputRoot ?? '')) throw inputError('Diretório de saída absoluto obrigatório.');
  const directionDecision = inspectVisualDirectionDecision(visualDirectionDecision);
  const approvedReferences = await inspectReferences(references);
  await mkdir(outputRoot);
  await Promise.all(['full', 'mobile', 'review'].map(directory => mkdir(path.join(outputRoot, directory))));

  const fixture = await composedFixture({ identity: 'amber', logo: false });
  fixture.carousel.slug = 'peterson-layout-qualification-v2';
  fixture.carousel.theme = 'builder-editorial';
  fixture.snapshot.brand.config.name = 'Peterson Benhame';
  fixture.snapshot.brand.config.profile = '@petersonbenhame';
  fixture.snapshot.brand.config.themes = { 'builder-editorial': palette };
  fixture.snapshot.theme = { id: 'builder-editorial', values: palette };
  const flowCopy = '01  A hierarquia orienta o olhar.\n\n02  Títulos apresentam a ideia; o corpo explica o porquê.\n\n03  Espaço e contraste ajudam a leitura.';
  fixture.carousel.slides[1].body = flowCopy;
  const flowBody = fixture.plan.slides[1].blocks.find(block => block.source.field === 'body');
  flowBody.source.end = flowCopy.length;
  flowBody.spans[0].end = flowCopy.length;

  const vertical = await verticalDiagram();
  const verticalHash = sha256(vertical);
  const verticalAssetKey = 'diagram-structural-stack';
  const verticalRef = {
    id: '88888888-8888-4888-8888-888888888888',
    kind: `creative-asset:${verticalAssetKey}`,
    version: 1,
    sha256: verticalHash,
  };
  const verticalDescriptor = {
    brandId: fixture.plan.brandId,
    runId: fixture.plan.runId,
    assetKey: verticalAssetKey,
    artifactRef: verticalRef,
    metadata: { width: 600, height: 800, semantic: true, anchors: [], minLabelSize: 56, minInformativeStroke: 6 },
  };
  fixture.assets.push(verticalDescriptor);
  fixture.plan.assets.push({ ...verticalRef, assetKey: verticalAssetKey });
  fixture.carousel.assets.push({ id: verticalAssetKey, path: `assets/${verticalAssetKey}.png`, transparent: true, approved: true });
  fixture.resources.assets.push({ descriptor: verticalDescriptor, bytes: vertical });
  for (const offset of [0, 1]) {
    fixture.plan.slides[offset].assets = [{ assetKey: verticalAssetKey, regionId: 'diagram', fit: 'contain', anchorIds: [] }];
    fixture.plan.slides[offset].decorationChoices = [
      { elementId: 'accent-rule', optionId: 'accent-rule-base' },
      { elementId: 'callout-bar', optionId: 'callout-bar-base' },
    ];
    const qualification = fixture.qualifications.find(record => record.definition.layoutId === fixture.plan.slides[offset].layoutId);
    const region = qualification.definition.regions.find(item => item.id === 'diagram');
    const scale = Math.min(1, region.width / verticalDescriptor.metadata.width, region.height / verticalDescriptor.metadata.height);
    Object.assign(fixture.plan.riskInventory.slides[offset], {
      minDiagramLabelSize: verticalDescriptor.metadata.minLabelSize * scale,
      minInformativeStroke: verticalDescriptor.metadata.minInformativeStroke * scale,
    });
  }
  const diagram = await modularDiagram();
  fixture.resources.assets[0].bytes = diagram;
  fixture.resources.assets[0].descriptor.artifactRef.sha256 = sha256(diagram);
  fixture.plan.assets[0].sha256 = sha256(diagram);
  sealComposedFixture(fixture);
  const composition = await composeCarousel({ ...fixture, selection: 'all' });
  const objectiveReport = await evaluateRenderedQuality(qualityInput(fixture, composition));

  const fullFiles = [], mobileFiles = [], mobileImages = [];
  for (const slide of composition.slides) {
    const name = `${String(slide.index).padStart(2, '0')}.png`;
    const fullPath = path.join('full', name), mobilePath = path.join('mobile', name);
    const mobile = await sharp(slide.png).resize(360, 450, { fit: 'fill' }).png().toBuffer();
    await writeFile(path.join(outputRoot, fullPath), slide.png, { flag: 'wx' });
    await writeFile(path.join(outputRoot, mobilePath), mobile, { flag: 'wx' });
    fullFiles.push(await imageRecord(slide.png, fullPath.replaceAll('\\', '/')));
    mobileFiles.push(await imageRecord(mobile, mobilePath.replaceAll('\\', '/')));
    mobileImages.push(mobile);
  }
  const grid = await qualificationGrid(mobileImages);
  const gridPath = path.join('review', 'qualification-grid.png');
  await writeFile(path.join(outputRoot, gridPath), grid, { flag: 'wx' });
  const gridRecord = await imageRecord(grid, gridPath.replaceAll('\\', '/'));
  const panorama = composition.panorama.png;
  const panoramaMobile = await sharp(panorama).resize(1800, 450, { fit: 'fill' }).png().toBuffer();
  await writeFile(path.join(outputRoot, 'panorama.png'), panorama, { flag: 'wx' });
  await writeFile(path.join(outputRoot, 'panorama-360.png'), panoramaMobile, { flag: 'wx' });
  const panoramaRecord = await imageRecord(panorama, 'panorama.png');
  const panoramaMobileRecord = await imageRecord(panoramaMobile, 'panorama-360.png');

  const coverComparison = await comparison(approvedReferences[0].pixels, composition.slides[0].png);
  const interiorComparison = await comparison(approvedReferences[1].pixels, composition.slides[1].png);
  const diagramComparison = await comparison(approvedReferences[1].pixels, composition.slides[3].png);
  await writeFile(path.join(outputRoot, 'review', 'compare-cover.png'), coverComparison, { flag: 'wx' });
  await writeFile(path.join(outputRoot, 'review', 'compare-interior.png'), interiorComparison, { flag: 'wx' });
  await writeFile(path.join(outputRoot, 'review', 'compare-diagram.png'), diagramComparison, { flag: 'wx' });
  const comparisonFiles = [
    await imageRecord(coverComparison, 'review/compare-cover.png'),
    await imageRecord(interiorComparison, 'review/compare-interior.png'),
    await imageRecord(diagramComparison, 'review/compare-diagram.png'),
  ];

  const referenceRecords = approvedReferences.map(({ pixels, ...reference }) => reference);
  const layoutRecords = composition.slides.map((slide, offset) => {
    const qualification = fixture.qualifications.find(record => record.definition.layoutId === fixture.plan.slides[slide.index - 1].layoutId);
    if (!qualification || qualification.definition.layoutId !== layouts[offset]) throw new Error('Ordem de layouts da fixture divergiu.');
    return {
      kind: 'qualification-fixture',
      qualificationId: qualification.id,
      layoutId: qualification.definition.layoutId,
      version: qualification.version,
      definitionHash: qualification.definitionHash,
      status: qualification.status,
      release: qualification.release,
      environment: environment(fixture.snapshot, qualification),
      full: fullFiles[offset],
      mobile: mobileFiles[offset],
    };
  });
  const fixtureBundle = {
    schemaVersion: 1,
    kind: 'qualification-fixture-bundle',
    rendererId: composition.rendererId,
    references: referenceRecords,
    layouts: layoutRecords,
    panorama: panoramaRecord,
    panoramaMobile: panoramaMobileRecord,
    comparisons: comparisonFiles,
    reviewGrid: gridRecord,
  };
  const metricsBundle = {
    schemaVersion: 1,
    kind: 'qualification-metrics-bundle',
    rendererId: composition.rendererId,
    objectiveResult: objectiveReport.result,
    layouts: composition.slides.map(slide => ({
      kind: 'qualification-metrics',
      slideIndex: slide.index,
      layoutId: slide.scene.layoutId,
      definitionHash: slide.scene.definitionHash,
      scene: slide.scene,
      metrics: slide.metrics,
    })),
  };
  const rubric = getReviewRubric(1);
  const reviewRequest = {
    schemaVersion: 1,
    status: 'pending-human-review',
    method: 'human-local-assisted@1',
    rendererId: composition.rendererId,
    objectiveResult: objectiveReport.result,
    instructions: rubric.criteria,
    coverage: {
      fullResolution: true,
      mobileWidth: rubric.coverage.mobileWidth,
      mobileHeight: rubric.coverage.mobileHeight,
      slides: composition.selection.slideIndices,
      seams: composition.selection.seamPairs,
      panorama: ['panorama.png', 'panorama-360.png'],
      comparisons: comparisonFiles.map(file => file.relativePath),
      grid: gridRecord.relativePath,
    },
    blockingFindings: rubric.blockingFindings,
    releaseRule: rubric.releaseRule,
    visualAssessment: {
      referenceLibraryFileIds: referenceRecords.map(reference => reference.libraryFileId),
      directionDecision,
      improvements: [{
        id: 'cover-editorial-structure',
        slideIndex: 1,
        evidence: 'review/compare-cover.png',
        basis: 'Version 2 uses a shorter title zone, left copy, right semantic stack, and fixed accent rules.',
      }, {
        id: 'content-flow-structure',
        slideIndex: 2,
        evidence: 'review/compare-interior.png',
        basis: 'Version 2 uses three numbered synthetic copy blocks beside a vertical semantic stack.',
      }, {
        id: 'modular-diagram-density',
        slideIndex: 4,
        evidence: 'full/04.png',
        basis: 'Original layered diagram derived from the approved V2 visual language; no reference pixels copied.',
      }],
      limitations: [{
        id: 'sans-serif-evaluation-only',
        description: 'As cinco amostras avaliam apenas a direção sans-serif selecionada; não aprovam template nem layouts para Production.',
      }, {
        id: 'jetbrains-mono-not-exercised',
        description: 'JetBrains Mono é permitida pela direção escolhida, mas não é vinculada pelos cinco layouts candidatos atuais e não aparece nos pixels deste lote.',
      }, {
        id: 'reference-typography-not-replicated',
        description: 'A hierarquia serif italic das referências não foi replicada; Nimbus permanece excluída por falta de autorização e licença verificadas.',
      }, {
        id: 'human-review-required',
        description: 'Métricas objetivas não substituem a revisão humana obrigatória dos pixels e das limitações declaradas.',
      }],
      blockers: directionDecision ? [] : [{
        id: 'serif-italic-font-unavailable',
        reason: 'The available Nimbus serif is not authorized; the runner does not install it or substitute an uncertain-license font.',
        action: 'Provide an authorized serif italic font and immutable hash before matching the V2 italic hierarchy.',
      }],
    },
  };
  await writeJson(outputRoot, 'qualification-fixture.json', fixtureBundle);
  await writeJson(outputRoot, 'qualification-metrics.json', metricsBundle);
  await writeJson(outputRoot, 'objective-report.json', objectiveReport);
  await writeJson(outputRoot, 'review-request.json', reviewRequest);
  return Object.freeze({ status: reviewRequest.status, outputRoot, layoutCount: layoutRecords.length, objectiveResult: objectiveReport.result });
}

function argumentsOf(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--output', '--references', '--direction'].includes(argv[index]) || typeof argv[index + 1] !== 'string') throw inputError('Use --output <diretório> --references <sources.json> [--direction <decision.json>].');
    values[argv[index].slice(2)] = argv[index + 1];
  }
  if (!values.output || !values.references || ![2, 3].includes(Object.keys(values).length)) throw inputError('Use --output <diretório> --references <sources.json> [--direction <decision.json>].');
  return values;
}

async function referencesFromManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const root = path.dirname(manifestPath), references = {};
  for (const file of manifest.files ?? []) {
    const key = file.purpose?.includes('cover') ? 'cover' : file.purpose?.includes('interior') ? 'interior' : null;
    if (key) references[key] = { libraryFileId: file.libraryFileId, fileName: file.fileName, purpose: file.purpose, filePath: path.join(root, file.fileName) };
  }
  return references;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const values = argumentsOf(process.argv.slice(2));
  const visualDirectionDecision = values.direction ? JSON.parse(await readFile(path.resolve(values.direction), 'utf8')) : undefined;
  const result = await runLayoutQualification({ outputRoot: path.resolve(values.output), references: await referencesFromManifest(path.resolve(values.references)), visualDirectionDecision });
  process.stdout.write(`${canonicalJson(result)}\n`);
}
