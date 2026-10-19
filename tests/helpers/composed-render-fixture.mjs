import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compositionFixture, addDiagram, semanticContractsFor } from '../fixtures/quality/composition-fixture.mjs';
import { derivePreviewSelection } from '../../src/domain/composition-plan.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { inspectPackage, loadResourcesManifest, probeDependency, dependencyNames, sha256 } from '../../src/infrastructure/resources.mjs';
import { fontRoot, config } from './legacy-render-fixture.mjs';
import { syntheticLogo, logoConfig } from './logo-slot-fixture.mjs';

// Contract-v2 synthetic input only. Does not use or implement snapshot persistence,
// qualify a candidate, manufacture release evidence or provide a production bypass.
export async function composedFixture({ identity = 'amber', logo = true } = {}) {
  const f = await compositionFixture(5);
  const words = [
    ['Clareza que\nmove decisões', 'Defina o problema. Mostre o caminho. Dê ao leitor uma ação que ele consiga colocar em prática.'],
    ['Uma ideia.\nUm caminho claro.', 'A hierarquia orienta o olhar. Títulos apresentam a ideia; o corpo explica o porquê. Espaço e contraste ajudam a leitura.'],
    ['Cada detalhe\nprecisa ter função.', 'O texto preserva espaços, acentos e pontuação. A leitura começa na coluna esquerda e segue pela direita. Uma composição densa precisa de ritmo, margens e medidas reais.\nNenhuma palavra deve desaparecer para que o desenho pareça mais leve. A mensagem aprovada continua inteira, com o mesmo sentido e a mesma ordem.'],
    ['Do problema\nà próxima ação.', 'Os três momentos formam um percurso: observar, decidir e agir. A imagem apoia a explicação, sem depender da lâmina vizinha.'],
    ['Transforme clareza\nem próximo passo.', 'Escolha uma ideia. Revise o que ela promete. Salve este roteiro para usar quando precisar explicar uma decisão.'],
  ];
  for (let index = 0; index < f.carousel.slides.length; index++) {
    Object.assign(f.carousel.slides[index], { eyebrow: identity === 'amber' ? 'CADERNO DE IDEIAS' : 'ESTÚDIO DE SISTEMAS', title: words[index][0], body: words[index][1] });
    const slide = f.plan.slides[index];
    slide.surface = index % 2 ? 'dark' : 'light';
    slide.blocks.forEach(block => { const length = f.carousel.slides[index][block.source.field].length; block.source.end = length; block.spans[0].end = length; });
    const title = slide.blocks.find(block => block.source.field === 'title');
    const split = f.carousel.slides[index].title.indexOf('\n') + 1;
    title.spans = [{ start: 0, end: split, styleId: 'title' }, { start: split, end: title.source.end, styleId: 'title-highlight' }];
  }
  const dense = f.qualifications.find(q => q.definition.layoutId === 'content-dense@1');
  const ds = f.plan.slides[2], body = f.carousel.slides[2].body, split = body.indexOf('\n') + 1;
  ds.layoutId = dense.definition.layoutId;
  ds.blocks.splice(2, 1, ...[['body-left', 0, split], ['body-right', split, body.length]].map(([regionId, start, end]) => ({ id: regionId, regionId, source: { field: 'body', start, end }, spans: [{ start: 0, end: end - start, styleId: 'body' }], alignment: 'left' })));
  addDiagram(f, 4);
  const diagram = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><g fill="none" stroke="#777777" stroke-width="6"><rect x="22" y="80" width="190" height="240" rx="16"/><rect x="305" y="80" width="190" height="240" rx="16"/><rect x="588" y="80" width="190" height="240" rx="16"/><path d="M230 200h55m-20-20 20 20-20 20M513 200h55m-20-20 20 20-20 20"/></g><g fill="#777777"><circle cx="117" cy="200" r="40"/><path d="m355 220 45-80 45 80z"/><path d="m637 205 30 30 65-75 15 14-80 90-45-45z"/></g></svg>')).png().toBuffer();
  f.assets[0].artifactRef.sha256 = sha256(diagram); f.plan.assets[0].sha256 = sha256(diagram);
  const brand = config(); brand.configVersion = 2;
  brand.name = identity === 'amber' ? 'Caderno Âmbar' : 'Estúdio Azul'; brand.profile = identity === 'amber' ? '@caderno_ambar' : '@estudio_azul';
  brand.logo = logo ? logoConfig() : { enabled: false, variants: {}, protection: 12, minimumHeight: 24 };
  const palette = identity === 'amber'
    ? { background: '#F3F0E8', text: '#191919', muted: '#595550', accent: '#B74718', secondaryAccent: '#FF8753' }
    : { background: '#F2F6FA', text: '#102C46', muted: '#475B6B', accent: '#136A82', secondaryAccent: '#6CDCF2' };
  const theme = { ...palette, topics: [], surfaceBindings: {
    light: { background: 'background', text: 'text', muted: 'muted', accent: 'accent' },
    dark: { background: 'text', text: 'background', muted: 'background', accent: 'secondaryAccent' },
  } };
  brand.themes = { synthetic: theme };
  const manifest = await loadResourcesManifest();
  const fonts = await Promise.all(manifest.fonts.filter(font => ['Anton', 'Manrope'].includes(font.id)).map(async font => ({ id: font.id, sha256: font.sha256, bytes: await readFile(path.join(fontRoot, font.file)) })));
  const logos = logo ? await Promise.all(['light', 'dark'].map(syntheticLogo)) : [];
  const renderer = (await inspectPackage({ rendererId: 'editorial-composed@1' })).renderer;
  const dependencies=Object.fromEntries(await Promise.all(dependencyNames.map(async name=>[name,await probeDependency(name)])));
  const snapshot = { schemaVersion: 2, contractVersion: 2, canonicalVersion: 1, pipelineVersion: 2, qualityPolicyVersion: 1,
    brand: { id: f.plan.brandId, revision: 1, effectiveHash: canonicalHash(brand), config: brand },
    theme: { id: 'synthetic', values: theme }, dimensions: { width: 1080, height: 1350 },
    renderer, runtime: { renderer, node: process.version, platform: process.platform, arch: process.arch, abi: process.versions.modules, napi: process.versions.napi, dependencies },
    fonts: fonts.map(({ id, sha256 }) => ({ id, sha256 })), fontBindings: [], qualifications: [],
    logos: logos.map(({ id, sha256 }, i) => ({ surface: ['light', 'dark'][i], id, sha256 })),
  };
  f.snapshot = snapshot;
  f.resources = { fonts, qualifications: f.qualifications, assets: [{ descriptor: f.assets[0], bytes: diagram }], logos };
  f.selection = 'all';
  sealComposedFixture(f);
  return f;
}
export function sealComposedFixture(f) {
  f.plan.semanticContracts = semanticContractsFor(f.carousel.slides);
  for (const slide of f.plan.slides) {
    const q = f.qualifications.find(q => q.definition.layoutId === slide.layoutId);
    q.definitionHash = canonicalHash(q.definition);
    slide.qualificationRef = { id: q.id, version: q.version, sha256: canonicalHash(q), definitionHash: q.definitionHash };
    Object.assign(f.plan.riskInventory.slides[slide.slideIndex - 1], { layoutId: slide.layoutId, surface: slide.surface, fontBindingsHash: canonicalHash(q.definition.fontBindings) });
  }
  f.plan.previewSelection = derivePreviewSelection(f.plan);
  f.snapshot.qualifications = [...new Map(f.plan.slides.map(s => [s.qualificationRef.id, s.qualificationRef])).values()];
  f.snapshot.fontBindings = [...new Map(f.qualifications.flatMap(q => q.definition.fontBindings).map(b => [canonicalHash(b), b])).values()];
  f.snapshot.brand.effectiveHash = canonicalHash(f.snapshot.brand.config);
  f.plan.snapshotHash = canonicalHash(f.snapshot);
  f.plan.carouselRef.sha256 = canonicalHash(f.carousel);
}
export function addComposedContinuity(f) {
 const q=f.qualifications.find(q=>q.definition.layoutId==='diagram-explainer@1');q.version=2;
 q.definition.continuity={anchors:[{id:'left',regionId:'diagram',x:0,y:0.5},{id:'right',regionId:'diagram',x:1,y:0.5}],pairs:[{id:'shared-support',fromAnchorId:'right',toAnchorId:'left',semanticRoles:['supporting']}],maxPairs:1};
 f.assets[0].metadata.anchors=[{id:'left',x:0,y:0.5},{id:'right',x:1,y:0.5}];
 const assetKey=f.assets[0].assetKey;
 for(const index of [2,3]) {const s=f.plan.slides[index-1];s.layoutId=q.definition.layoutId;f.carousel.slides[index-1].body='Observe o problema, compare os caminhos e escolha uma próxima ação. Cada lâmina preserva a explicação completa.';
 s.blocks=['eyebrow','title','body'].map(field=>({id:field,regionId:field,source:{field,start:0,end:f.carousel.slides[index-1][field].length},spans:[{start:0,end:f.carousel.slides[index-1][field].length,styleId:field}],alignment:'left'}));
 s.assets=[{assetKey,regionId:'diagram',fit:'contain',anchorIds:[index===2?'right':'left']}];Object.assign(f.plan.riskInventory.slides[index-1],{minDiagramLabelSize:34,minInformativeStroke:3});}
 f.carousel.continuity=[{from:2,to:3,assetId:assetKey}];f.plan.continuities=[{from:2,to:3,assetKey,anchorPairId:'shared-support',semanticRole:'supporting'}];
 f.plan.riskInventory.seams=[{from:2,to:3,semanticRole:'supporting',minTextDistance:48,hasDeclaredOverlap:false,hasSemanticCrossing:true}];sealComposedFixture(f);return f;
}
