import { readFile } from 'node:fs/promises';
import { canonicalHash, canonicalJson } from '../../../src/domain/canonical-json.mjs';
import { compositionFixture } from './composition-fixture.mjs';
import { buildRunSnapshot } from '../../../src/domain/run-snapshot.mjs';

const ref = (id, value) => ({ id, version: 1, sha256: canonicalHash(value) });
/** Synthetic releases for contract tests only. This is never a production catalog. */
export async function qualitySnapshotFixture({ runtime, manifest: suppliedManifest, config: suppliedConfig, brandId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', theme = 'synthetic' } = {}) {
  const manifest = suppliedManifest ?? JSON.parse(await readFile(new URL('../../../shared/resources.manifest.json', import.meta.url), 'utf8'));
  const renderer = manifest.renderers.find(item => item.id === 'editorial-composed@1');
  runtime ??= { package: { name: '@pb/carousel-harness', version: '0.1.0' },
    node: process.version, platform: process.platform, arch: process.arch,
    abi: process.versions.modules, napi: process.versions.napi,
    renderer: { id: renderer.id, files: renderer.hashes },
    dependencies: Object.fromEntries(['better-sqlite3','sharp','fontkit','archiver'].map(id => [id,{version:'synthetic'}])),
    fonts: manifest.fonts.map(({id,sha256}) => ({id,sha256})),
  };
  runtime = structuredClone(runtime);
  const policy = { id: 'quality-policy@1',
    samplePolicyRef: ref('representative-risk@1', { synthetic: 'sample-policy' }),
    rubricRef: ref('editorial-quality@1', { synthetic: 'rubric' }),
    checkerRefs: [ref('editorial-objective-checkers@1', { synthetic: 'checkers' })],
    mobileWidth: 360, maxCorrectionRounds: 2, maxPreviewSlides: 6,
  };
  const qualityPolicy = {...policy, sha256: canonicalHash(policy)};
  const {qualifications} = await compositionFixture();
  for (const q of qualifications) {
    q.version = 2;
    q.status = 'qualified';
    q.definition.checkerRef = policy.checkerRefs[0];
    q.definition.rubricRef = policy.rubricRef;
    // This fixture deliberately exercises a brand without the optional accent.
    q.definition.styles = q.definition.styles.filter(style => style.fontRole !== 'accent');
    const styleIds = new Set(q.definition.styles.map(style => style.id));
    for (const rule of q.definition.limits.textRegions) rule.styleIds = rule.styleIds.filter(id => styleIds.has(id));
    q.definition.fontBindings = q.definition.fontBindings.filter(binding => binding.role !== 'accent');
    q.definitionHash = canonicalHash(q.definition);
    q.evidenceRefs = ['qualification-fixture','qualification-metrics','qualification-review'].map(kind => ({
      ...ref(`${kind}-${q.definition.layoutId}`, {synthetic: kind, definitionHash:q.definitionHash}),kind,
    })).sort((a,b) => canonicalJson(a) < canonicalJson(b) ? -1 : 1);
    q.release = { decisionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',decidedAt:'2026-10-16T00:00:00.000Z',
      reviewEvidenceRef:q.evidenceRefs.find(item => item.kind === 'qualification-review'),
      qualifiedEnvironments:[{ platform:runtime.platform,arch:runtime.arch,node:runtime.node,abi:runtime.abi,napi:runtime.napi,
        dependenciesHash:canonicalHash(runtime.dependencies),rendererHash:canonicalHash(runtime.renderer),fontBindingsHash:canonicalHash(q.definition.fontBindings),
      }],
    };
  }
  const fontBindings = [...new Map(qualifications.flatMap(q => q.definition.fontBindings).map(b => [canonicalJson(b),b])).values()]
    .sort((a,b) => canonicalJson(a) < canonicalJson(b) ? -1 : 1);
  const qualityResources = { qualityPolicy,qualifications,fontBindings,
    resourceManifestRef:{id:'resources-manifest@2',version:2,sha256:canonicalHash(manifest)},
  };
  const config = suppliedConfig ?? {name:'Synthetic quality',profile:'@synthetic',language:'pt-BR',audience:null,voice:null,preferences:[],
    fonts:{title:'Anton',body:'Manrope',mono:'JetBrains Mono'},
    themes:{[theme]:{background:'#ffffff',text:'#000000',muted:'#555555',accent:'#cc0000',topics:[]}},
    logo:{enabled:false,variants:{},protection:12,minimumHeight:24},slideWidth:1080,slideHeight:1350,
    minimumSlideCount:12,maximumSlideCount:16,profileImage:'',
  };
  const input = {contractVersion:2,brand:{brandId,revision:1,hash:canonicalHash(config),config},
    theme,fonts:[...manifest.fonts,...(manifest.optionalFonts??[]).filter(font=>Object.values(config.fonts).includes(font.id))],logos:[],runtime,resourceState:{renderPrerequisites:false,blockers:[]},...qualityResources};
  return {input,qualityResources,runtime,manifest,qualifications,snapshot:buildRunSnapshot(input)};
}
