// Test-only process instrumentation. No production callback/flag or persisted state.
import { registerHooks } from 'node:module';
const target = new URL('../../src/render/composed-carousel.mjs', import.meta.url).href;
globalThis.__q03Spy = { composedIndices: [], rasterizedIndices: [] };
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (url !== target) return loaded;
  let source = loaded.source.toString();
  const composition = 'async function composeSlide({source,entry,definition,brand,theme,resources,total,links}) {';
  const raster = 'async function raster(svg) {';
  if (!source.includes(composition) || !source.includes(raster)) throw Error('Expected composition/raster call sites changed: update test instrumentation.');
  source = source.replace(composition, `${composition}\nglobalThis.__q03Spy.composedIndices.push(entry.slideIndex);`)
    .replace(raster, `${raster}\nglobalThis.__q03Spy.rasterizedIndices.push(Number(svg.match(/data-slide-index="(\\d+)"/)[1]));`);
  return {...loaded, source};
} });
const { composedFixture } = await import('./composed-render-fixture.mjs');
const { composeCarousel } = await import(target);
const f=await composedFixture(), output=await composeCarousel({...f,selection:[1,4]});
console.log(JSON.stringify({spy:globalThis.__q03Spy,slides:output.slides.map(s=>({index:s.index,sha256:s.sha256,rgbaSha256:s.rgbaSha256}))}));
