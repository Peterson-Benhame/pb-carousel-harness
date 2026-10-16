import { canonicalHash, canonicalJson } from '../../src/domain/canonical-json.mjs';
import { sha256 } from '../../src/infrastructure/resources.mjs';
import { composedFixture, sealComposedFixture } from './composed-render-fixture.mjs';
import { composeCarousel } from '../../src/render/composed-carousel.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ref = (n, kind, hash) => ({ id: id(n), kind, version: 1, sha256: hash });
export const metricsDocument = composition => ({ schemaVersion: 1, selection: composition.selection,
  slides: composition.slides.map(({ index, scene, metrics }) => ({ index, scene, metrics })) });
export function qualityInput(f, result) {
  const composition = { ...result, inputs: { carousel: f.carousel, plan: f.plan, snapshot: f.snapshot,
    fonts: f.resources.fonts, assets: f.resources.assets, logos: f.resources.logos } };
  const files = [], records = [],kind=result.selection.allSlides?'final':'preview';
  function add(image, role, slideIndex = null, pair = null) {
    const artifactRef = ref(records.length + 10, role==='slide'?`render-slide:${kind}:${slideIndex}`:role==='seam'?`render-seam:${kind}:${pair.from}-${pair.to}`:'render-panorama:final', image.sha256);
    const width = role === 'slide' ? 1080 : role === 'seam' ? 2160 : 1080 * result.slides.length;
    records.push({ artifactRef, role, slideIndex, pair, mediaType: 'image/png', width, height: 1350,
      size: image.png.length, rgbaSha256: image.rgbaSha256 });
    files.push({ id: artifactRef.id, bytes: image.png });
  }
  result.slides.forEach(slide => add(slide, 'slide', slide.index));
  result.seams.forEach(seam => add(seam, 'seam', null, seam.pair));
  if (result.panorama) add(result.panorama, 'panorama');
  const bytes = Buffer.from(canonicalJson(metricsDocument(composition)));
  const metricsRef = ref(4, `composition-metrics:${kind}`, sha256(bytes));
  files.push({ id: metricsRef.id, bytes });
  const selection = { slideIndices: result.selection.slideIndices, seamPairs: result.selection.seamPairs,
    policyId: result.selection.allSlides ? 'all-slides@1' : 'representative-risk@1' };
  const manifest = { schemaVersion: 2, id: id(1), brandId: f.plan.brandId, runId: f.plan.runId,
    version: 1, kind: result.selection.allSlides ? 'final' : 'preview', renderAttemptId: id(2),
    stageFingerprint: canonicalHash({ plan: f.plan }), snapshotHash: result.snapshotHash,
    inputsRef: ref(3, 'inputs', canonicalHash(f.carousel)), planRef: ref(5, 'composition-plan', result.planHash),
    selection, selectionHash: canonicalHash(selection), renderer: result.resources.renderer,
    runtimeHash: canonicalHash(f.snapshot.runtime), resourceManifestHash: 'a'.repeat(64),
    qualifications: [...new Map(result.resources.qualifications.map(q => [q.id, q])).values()],
    fonts: f.snapshot.fonts, upstream: {}, files: records, metricsRef, createdAt: '2026-10-16T21:00:00.000Z' };
  return { manifest, composition, files, qualification: f.qualifications };
}
export async function qualityFixture({ identity = 'amber', surface, logo = true, boundary = false } = {}) {
  const f = await composedFixture({ identity, logo });
  if (surface) f.plan.slides.forEach(slide => { slide.surface = surface; });
  if (boundary) for (const entry of f.plan.slides) {
    const d = f.qualifications.find(q => q.definition.layoutId === entry.layoutId).definition;
    for (const field of ['title', 'body']) {
      const rules = d.limits.textRegions.filter(r => r.fields.includes(field));
      const counts = rules.map((r, i) => field === 'body' ? Math.min(r.maxLines, d.limits.totalBodyLines - rules.slice(0, i).reduce((n, p) => n + p.maxLines, 0)) : r.maxLines);
      const parts = counts.map(n => Array.from({ length: n }, () => field === 'title' ? 'IDEIA' : 'Ação íntegra.').join('\n'));
      f.carousel.slides[entry.slideIndex - 1][field] = parts.join(' ');
      const blocks = entry.blocks.filter(b => b.source.field === field);
      let offset = 0;
      blocks.forEach((block, i) => { const text = parts[i] + (i < parts.length - 1 ? ' ' : '');
        block.source = { field, start: offset, end: offset + text.length };
        block.spans = [{ start: 0, end: text.length, styleId: field }]; offset += text.length;
      });
    }
  }
  sealComposedFixture(f);
  return f;
}
export async function renderedQualityFixture(options = {}) {
  const f = await qualityFixture(options);
  const result = await composeCarousel({ ...f, selection: options.selection ?? [1] });
  return { f, result, input: qualityInput(f, result) };
}
