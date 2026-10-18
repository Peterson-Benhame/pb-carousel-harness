import { readFile } from 'node:fs/promises';
import { canonicalHash } from '../../../src/domain/canonical-json.mjs';

export const BRAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const RUN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const HASH = 'a'.repeat(64);
export const artifactRef = (kind, digit = '1') => ({
  id: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
  kind, version: 1, sha256: HASH,
});
export const semanticContractsFor = slides => slides.map(slide => ({
  slideIndex: slide.index,
  centralMessage: `Explicar ${slide.title}.`,
  communicativeObjective: 'Apresentar uma ideia sem convertê-la em promessa de resultado.',
  representation: slide.role === 'cover' ? 'typography-only' : slide.role === 'cta' ? 'contextual-image' : 'infographic',
  rationale: 'O contrato liga intenção e elementos à copy aprovada; a revisão dos pixels permanece separada.',
  elements: [
    { id: `message-${slide.index}`, kind: 'concept', binding: { field: 'title', start: 0, end: slide.title.length, sourceText: slide.title } },
    { id: `subject-${slide.index}`, kind: 'subject', binding: { field: 'eyebrow', start: 0, end: slide.eyebrow.length, sourceText: slide.eyebrow } },
  ],
  prohibitions: [{ id: 'extra-robot', description: 'Não incluir robô ou personagem não declarado.' }],
  authorizedSubjectElementIds: [`subject-${slide.index}`],
  emphasisElementIds: [`message-${slide.index}`],
  constraints: [{ id: 'preserve-copy', description: 'Preservar integralmente a copy aprovada.' }],
  approvalCriteria: [{ id: 'intent-preserved', description: 'A intenção deve permanecer ligada à copy exata.' }],
}));
export async function compositionFixture(count = 3) {
  const catalog = JSON.parse(await readFile(new URL('../../../shared/layouts/editorial-composed-v1.json', import.meta.url), 'utf8'));
  const qualifications = Array.isArray(catalog) ? catalog : catalog.qualifications;
  const carousel = {
    slug: 'synthetic-quality', theme: 'synthetic', voiceMode: 'default', objective: 'save',
    slideCountException: true, slideCountExceptionReason: 'Small synthetic contract fixture',
    slides: Array.from({ length: count }, (_, index) => ({
      index: index + 1, role: index === 0 ? 'cover' : index === count - 1 ? 'cta' : 'content',
      eyebrow: 'Série sintética', title: `Título ${index + 1}`, body: 'Ação, espaço e precisão.', visualSlot: 'none',
    })),
    caption: 'Legenda sintética exata.', cta: 'Ação geral preservada.', hashtags: ['#synthetic'],
    altText: 'Descrição sintética.', sources: [{ title: 'Synthetic source', url: 'https://example.com/' }],
    continuity: [], assets: [],
  };
  const slides = carousel.slides.map(slide => {
    const layoutId = slide.role === 'cover' ? 'cover-editorial@1' : slide.role === 'cta' ? 'cta-editorial@1' : 'content-flow@1';
    const q = qualifications.find(record => record.definition.layoutId === layoutId);
    return {
      slideIndex: slide.index, contentRole: slide.role, layoutId,
      qualificationRef: { id: q.id, version: q.version, sha256: canonicalHash(q), definitionHash: q.definitionHash },
      surface: 'light',
      blocks: ['eyebrow', 'title', 'body'].map(field => ({
        id: field, regionId: field, source: { field, start: 0, end: slide[field].length },
        spans: [{ start: 0, end: slide[field].length, styleId: field }], alignment: 'left',
      })),
      assets: [], overlaps: [], decorationChoices: [],
    };
  });
  const riskInventory = { slides: slides.map(slide => ({
    slideIndex: slide.slideIndex, density: 0.5,
    fontBindingsHash: canonicalHash(qualifications.find(q => q.definition.layoutId === slide.layoutId).definition.fontBindings),
    layoutId: slide.layoutId, surface: slide.surface, minDiagramLabelSize: null, minInformativeStroke: null,
  })), seams: [] };
  const plan = {
    schemaVersion: 1, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', brandId: BRAND_ID, runId: RUN_ID, version: 1,
    snapshotHash: HASH, carouselRef: artifactRef('carousel'), copyFingerprint: HASH, conceptRef: artifactRef('concept', '2'),
    assets: [], rendererId: 'editorial-composed@1', semanticContractVersion: 1,
    semanticContracts: semanticContractsFor(carousel.slides), slides, continuities: [], riskInventory,
    previewSelection: {
      policyId: 'representative-risk@1', slideIndices: [1, 2],
      reasons: [{ slideIndex: 1, codes: ['cover'] }, { slideIndex: 2, codes: ['representative', 'densest'] }],
      riskInventoryHash: canonicalHash(riskInventory), seamPairs: [],
    },
    change: { kind: 'initial', previousPlanRef: null, correctionEpisodeRef: null },
  };
  return { plan, carousel, qualifications, assets: [] };
}
export function resetRiskHash(fixture) {
  fixture.plan.previewSelection.riskInventoryHash = canonicalHash(fixture.plan.riskInventory);
}

export function addDiagram(f, slideIndex = 2) {
  const q = f.qualifications.find(record => record.definition.layoutId === 'diagram-explainer@1');
  const slide = f.plan.slides[slideIndex - 1];
  slide.layoutId = q.definition.layoutId;
  slide.qualificationRef = { id: q.id, version: q.version, sha256: canonicalHash(q), definitionHash: q.definitionHash };
  const assetKey = `diagram-${slideIndex}`;
  const ref = artifactRef(`creative-asset:${assetKey}`, (slideIndex + 3).toString(16));
  slide.assets = [{ assetKey, regionId: 'diagram', fit: 'contain', anchorIds: [] }];
  f.plan.assets.push({ ...ref, assetKey });
  f.carousel.assets.push({ id: assetKey, path: `assets/${assetKey}.png`, transparent: true, approved: true });
  f.assets.push({ brandId: BRAND_ID, runId: RUN_ID, assetKey, artifactRef: ref, metadata: {
    width: 800, height: 400, semantic: true, anchors: [], minLabelSize: 34, minInformativeStroke: 3,
  } });
  Object.assign(f.plan.riskInventory.slides[slideIndex - 1], {
    layoutId: slide.layoutId, fontBindingsHash: canonicalHash(q.definition.fontBindings),
    minDiagramLabelSize: 34, minInformativeStroke: 3,
  });
  resetRiskHash(f);
  return f;
}
