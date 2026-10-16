import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConfinedRoot, normalizeReference } from './fs/confined-path.mjs';
import { PublicError, invalidArgument } from '../domain/errors.mjs';
import { canonicalJson } from '../domain/canonical-json.mjs';

export const DEFAULT_PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const dependencyNames = Object.freeze(['better-sqlite3', 'sharp', 'fontkit', 'archiver']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const diagnostic = (code, resource, message) => ({ code, resource, message });

const fontIds = ['Anton', 'Manrope', 'JetBrains Mono'];
const fontFiles = [
  'Anton-Regular.ttf',
  'Manrope-VariableFont_wght.ttf',
  'JetBrainsMono-VariableFont_wght.ttf',
];
const legacyRendererId = 'legacy-panorama@1';
const composedRendererId = 'editorial-composed@1';
const nimbusId = 'nimbus-roman-italic@1';
const legacyRendererFiles = Object.freeze([
  "scripts/render-carousel.mjs",
  "shared/templates/panorama.svg.js",
  "scripts/validate-carousel.mjs"
]);
// The historical v1 entry remains readable; current v2 records the actual
// context adapter and every local dependency affecting interpretation or bytes.
const currentLegacyRendererFiles = Object.freeze([
  ...legacyRendererFiles,
  "src/adapters/legacy/render-context.mjs",
  "src/adapters/legacy/logo-layout.mjs",
  "src/domain/brand-schema.mjs",
  "src/domain/canonical-json.mjs",
  "src/domain/errors.mjs",
  "src/domain/logo-policy.mjs",
  "src/domain/identifiers.mjs",
  "src/infrastructure/resources.mjs",
  "src/infrastructure/fs/confined-path.mjs",
  "src/infrastructure/fs/workspace-paths.mjs",
]);
const composedContractFiles = Object.freeze([
  "src/domain/composition-plan.mjs",
  "src/domain/layout-qualification.mjs",
  "src/domain/brand-schema.mjs",
  "src/infrastructure/resources.mjs",
  "src/domain/canonical-json.mjs",
  "src/domain/identifiers.mjs",
  "src/domain/errors.mjs",
  "src/domain/logo-policy.mjs",
  "src/infrastructure/fs/confined-path.mjs",
  "src/infrastructure/fs/workspace-paths.mjs",
  "scripts/validate-carousel.mjs",
  "shared/composition-plan.schema.json",
  "shared/layout-qualification.schema.json",
  "shared/layouts/editorial-composed-v1.json"
]);
const currentComposedFiles = Object.freeze([
  "src/render/composed-carousel.mjs",
  "src/render/text-layout.mjs",
  "src/render/composition-geometry.mjs",
  "src/adapters/legacy/logo-layout.mjs",
  "src/adapters/legacy/render-context.mjs",
  "src/quality/objective-checks.mjs",
  "src/quality/review-rubric.mjs"
]);
const allowedPackageFiles = new Set([
  "src/application/approvals.mjs",
  "src/domain/approval-policy.mjs",
  "src/domain/invalidation.mjs",
  "src/domain/quality-evidence.mjs",
  "shared/quality-review.schema.json",
  "shared/render-manifest.schema.json",
  "src/infrastructure/sqlite/migrations/002-quality-contract-activation.sql",
  "src/infrastructure/sqlite/quality-activation.mjs",
  "ATTRIBUTION.md",
  "bin/peterson-carousel.mjs",
  "package.json",
  "scripts/render-carousel.mjs",
  "scripts/validate-carousel.mjs",
  "shared/carousel.schema.json",
  "shared/defaults/brand.json",
  "shared/defaults/themes.json",
  "shared/resources.manifest.json",
  "shared/run-snapshot.schema.json",
  "shared/templates/panorama.svg.js",
  "src/application/asset-store.mjs",
  "src/application/brand-memory.mjs",
  "src/application/doctor.mjs",
  "src/application/logo-import.mjs",
  "src/application/operation-runner.mjs",
  "src/application/run-inputs.mjs",
  "src/application/run-control.mjs",
  "src/application/run-lease.mjs",
  "src/infrastructure/clock.mjs",
  "src/application/run-service.mjs",
  "src/application/workspace-inspect.mjs",
  "src/domain/artifact-fingerprints.mjs",
  "src/domain/brand-confirmation.mjs",
  "src/domain/brand-schema.mjs",
  "src/domain/canonical-json.mjs",
  "src/domain/errors.mjs",
  "src/domain/identifiers.mjs",
  "src/domain/logo-policy.mjs",
  "src/domain/protocol.mjs",
  "src/domain/run-snapshot.mjs",
  "src/infrastructure/fs/atomic-files.mjs",
  "src/infrastructure/fs/confined-path.mjs",
  "src/infrastructure/fs/hash-file.mjs",
  "src/infrastructure/fs/workspace-paths.mjs",
  "src/infrastructure/resources.mjs",
  "src/infrastructure/sqlite/database.mjs",
  "src/infrastructure/sqlite/maintenance.mjs",
  "src/infrastructure/sqlite/migrations.mjs",
  "src/infrastructure/sqlite/migrations/001-initial.sql",
  "src/infrastructure/sqlite/repositories.mjs",
  "src/interfaces/cli/human-confirmation.mjs",
  "src/interfaces/cli/main.mjs",
  "src/interfaces/cli/output.mjs",
  "src/interfaces/cli/parse-args.mjs",
  "src/domain/run-state-machine.mjs",
  "src/domain/stage-graph.mjs",
  "src/application/run-runtime.mjs",
  ...currentLegacyRendererFiles,
  ...composedContractFiles,
  ...currentComposedFiles,
]);

const incomplete = () => new PublicError(
  'PACKAGE_INCOMPLETE',
  'Pacote incompleto ou manifesto de recursos inválido.',
);
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function exact(value, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || required.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw incomplete();
  }
}

function sameSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual).size === actual.length
    && actual.every(value => expected.includes(value));
}

function paths(value, allowed) {
  if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length
      || value.some(file => normalizeReference(file) !== file || !allowed.has(file))) {
    throw incomplete();
  }
}

function validateManifest(input) {
  try {
    // Reject getters, coercion hooks, functions and prototype data before reads.
    const value = JSON.parse(canonicalJson(input));
    const v2 = value.schemaVersion === 2;
    if (value.schemaVersion !== 1 && !v2) throw incomplete();
    exact(value, ['schemaVersion', 'fonts', 'requiredFiles', 'renderer', 'qualifiedRuntime'],
      v2 ? ['renderers', 'optionalFonts'] : []);
    if (!Array.isArray(value.fonts) || value.fonts.length !== 3) throw incomplete();
    for (const [index, font] of value.fonts.entries()) {
      exact(font, ['id', 'file', 'sha256']);
      if (font.id !== fontIds[index] || font.file !== fontFiles[index] || !isHash(font.sha256)) {
        throw incomplete();
      }
    }

    exact(value.renderer, ['id', 'files']);
    if (value.renderer.id !== legacyRendererId
        || !sameSet(value.renderer.files, legacyRendererFiles)) throw incomplete();
    paths(value.requiredFiles, allowedPackageFiles);
    exact(value.qualifiedRuntime, ['node', 'platform', 'arch', 'abi', 'dependencies', 'native']);
    exact(value.qualifiedRuntime.dependencies, dependencyNames);
    exact(value.qualifiedRuntime.native, ['sqlite', 'vips']);
    if (['node', 'platform', 'arch', 'abi'].some(key => typeof value.qualifiedRuntime[key] !== 'string')
        || dependencyNames.some(key => typeof value.qualifiedRuntime.dependencies[key] !== 'string')
        || ['sqlite', 'vips'].some(key => typeof value.qualifiedRuntime.native[key] !== 'string')) {
      throw incomplete();
    }

    if (v2) {
      if (!Array.isArray(value.renderers) || value.renderers.length !== 2) throw incomplete();
      for (const [index, renderer] of value.renderers.entries()) {
        exact(renderer, ['id', 'status', 'files', 'hashes']);
        const legacy = index === 0;
        const expected = legacy ? currentLegacyRendererFiles : [...composedContractFiles, ...currentComposedFiles];
        if (renderer.id !== (legacy ? legacyRendererId : composedRendererId)
            || renderer.status !== (legacy ? 'active' : 'candidate')
            || !sameSet(renderer.files, expected)) throw incomplete();
        exact(renderer.hashes, expected);
        if (Object.values(renderer.hashes).some(hash => !isHash(hash))) throw incomplete();
      }

      if (!Array.isArray(value.optionalFonts) || value.optionalFonts.length !== 1) throw incomplete();
      const font = value.optionalFonts[0];
      exact(font, [
        'id', 'file', 'sha256', 'familyName', 'postScriptName', 'fontVersion',
        'role', 'style', 'weight', 'axes', 'authorization', 'license',
      ]);
      if (font.id !== nimbusId || font.file !== 'NimbusRoman-Italic.otf' || !isHash(font.sha256)
          || font.familyName !== 'Nimbus Roman' || font.postScriptName !== 'NimbusRoman-Italic'
          || font.fontVersion !== '1.00' || font.role !== 'accent' || font.style !== 'italic'
          || font.weight !== 400 || font.authorization !== 'not-granted') throw incomplete();
      exact(font.axes, []);
      exact(font.license, ['status', 'noticeSha256', 'source', 'checkedAt', 'scope']);
      if (font.license.status !== 'not-verified' || !isHash(font.license.noticeSha256)
          || font.license.source !== 'https://github.com/ArtifexSoftware/urw-base35-fonts'
          || font.license.checkedAt !== '2026-10-16'
          || font.license.scope !== 'product-composition') throw incomplete();
    }
    return value;
  } catch {
    throw incomplete();
  }
}

export async function loadResourcesManifest({ packageRoot = DEFAULT_PACKAGE_ROOT } = {}) {
  try {
    const guard = await createConfinedRoot(packageRoot);
    return await guard.withPaths(['shared/resources.manifest.json'], async file =>
      validateManifest(JSON.parse(await readFile(file, 'utf8'))));
  } catch {
    throw incomplete();
  }
}

/** The caller supplies an explicitly authorized read-only root. Never search OS/repository defaults. */
export async function resolveResources({ fontRoot, manifest, requiredFontIds } = {}) {
  const approved = manifest ? validateManifest(manifest) : await loadResourcesManifest();
  const catalog = [...approved.fonts, ...(approved.optionalFonts ?? [])];
  let required;
  try {
    required = JSON.parse(canonicalJson(requiredFontIds === undefined ? fontIds : requiredFontIds));
  } catch {
    throw invalidArgument('Seleção de fontes não suportada.');
  }
  if (!Array.isArray(required) || new Set(required).size !== required.length
      || required.some(id => !catalog.some(font => font.id === id))) {
    throw invalidArgument('Seleção de fontes não suportada.');
  }

  const fonts = [], diagnostics = [];
  let guard;
  if (fontRoot) {
    try { guard = await createConfinedRoot(fontRoot); }
    catch { /* Report resource failure without leaking filesystem errors. */ }
  }
  for (const font of catalog.filter(font => required.includes(font.id))) {
    const resource = { id: font.id, expectedSha256: font.sha256, status: 'missing' };
    if (font.id === nimbusId) {
      // Package evidence is not permission. Even matching bytes in an authorized
      // read-only root do not grant product use or verify an output modality.
      Object.assign(resource, {
        availability: 'missing', useStatus: 'unauthorized', licenseStatus: 'not-verified',
      });
      diagnostics.push(diagnostic('FONT_USE_UNAUTHORIZED', font.id,
        'Uso da fonte de acento ainda não autorizado para composição do produto.'));
      diagnostics.push(diagnostic('FONT_LICENSE_UNVERIFIED', font.id,
        'Modalidade de uso da fonte de acento ainda não verificada.'));
    }
    try {
      if (!guard) throw Error('unconfigured');
      const result = await guard.withPaths([font.file], async file => ({
        path: file, sha256: sha256(await readFile(file)),
      }));
      resource.sha256 = result.sha256;
      if (result.sha256 !== font.sha256) {
        resource.status = 'mismatch';
        diagnostics.push(diagnostic('RUNTIME_MISMATCH', font.id,
          'Fonte não corresponde ao hash aprovado.'));
      } else if (font.id === nimbusId) {
        resource.status = 'blocked';
      } else {
        Object.assign(resource, { status: 'available', path: result.path });
      }
      if (font.id === nimbusId) {
        resource.availability = result.sha256 === font.sha256 ? 'available' : 'mismatch';
      }
    } catch {
      diagnostics.push(diagnostic('RESOURCE_MISSING', font.id,
        'Fonte aprovada ausente ou inacessível na raiz autorizada.'));
    }
    fonts.push(resource);
  }
  return { fonts, diagnostics };
}
/** Lazy real probes. SQLite uses only :memory:; renderer probes encode synthetic pixels, not fonts. */
export async function probeDependency(name,{packageRoot=DEFAULT_PACKAGE_ROOT}={}){
 if(!dependencyNames.includes(name))throw incomplete();
 const require=createRequire(path.join(packageRoot,'package.json'));
 const entry=require.resolve(name);
 let directory=path.dirname(entry),metadata;
 while(true){
  try{const candidate=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));if(candidate.name===name){metadata=candidate;break;}}catch{}
  const parent=path.dirname(directory);if(parent===directory)throw Error('Dependency metadata unavailable');directory=parent;
 }
 const loaded=await import(pathToFileURL(entry).href),api=loaded.default??loaded;
 const identity={version:metadata.version};
 if(name==='better-sqlite3'){
  const db=new api(':memory:');try{identity.sqlite=db.prepare('SELECT sqlite_version() version').get().version;}finally{db.close();}
 }else if(name==='sharp'){
  await api(Buffer.from([0,0,0,255]),{raw:{width:1,height:1,channels:4}}).png().toBuffer();
  identity.vips=api.versions.vips;
  identity.engines={...api.versions};
 }else if(name==='fontkit'){
  if(typeof api.openSync!=='function')throw Error('Fontkit API unavailable');
 }else if(typeof api!=='function')throw Error('Archiver API unavailable');
 return identity;
}

export async function inspectPackage({
  packageRoot = DEFAULT_PACKAGE_ROOT, manifest, rendererId = legacyRendererId,
} = {}) {
  const approved = manifest ? validateManifest(manifest) : await loadResourcesManifest({ packageRoot });
  const selected = approved.schemaVersion === 2
    ? approved.renderers.find(renderer => renderer.id === rendererId)
    : rendererId === legacyRendererId ? approved.renderer : null;
  if (!selected) throw incomplete();

  const diagnostics = [], rendererFiles = {};
  let metadata = null;
  if (selected.status === 'candidate') {
    diagnostics.push(diagnostic('LAYOUT_NOT_QUALIFIED', rendererId,
      'Compositor candidato sem qualificação produtiva liberada.'));
  }
  try {
    const guard = await createConfinedRoot(packageRoot);
    metadata = await guard.withPaths(['package.json'], async file => JSON.parse(await readFile(file, 'utf8')));
    if (typeof metadata.name !== 'string' || typeof metadata.version !== 'string') throw incomplete();
    for (const file of approved.requiredFiles) {
      try { await guard.withPaths([file], async filename => { await readFile(filename); }); }
      catch {
        diagnostics.push(diagnostic('PACKAGE_INCOMPLETE', file,
          'Arquivo obrigatório do pacote ausente ou inacessível.'));
      }
    }
    for (const file of selected.files) {
      try {
        rendererFiles[file] = await guard.withPaths([file], async filename => sha256(await readFile(filename)));
        if (approved.schemaVersion === 2) {
          if (!Object.hasOwn(selected.hashes, file)) {
            diagnostics.push(diagnostic('PACKAGE_INCOMPLETE', file,
              'Identidade aprovada do módulo ainda ausente no manifesto.'));
          } else if (rendererFiles[file] !== selected.hashes[file]) {
            diagnostics.push(diagnostic('RUNTIME_MISMATCH', file,
              'Arquivo do renderizador não corresponde ao hash declarado.'));
          }
        }
      } catch {
        if (!diagnostics.some(item => item.resource === file)) {
          diagnostics.push(diagnostic('PACKAGE_INCOMPLETE', file,
            'Arquivo do renderizador ausente ou inacessível.'));
        }
      }
    }
  } catch {
    diagnostics.push(diagnostic('PACKAGE_INCOMPLETE', 'package', 'Pacote incompleto ou manifesto inválido.'));
  }
  return {
    package: metadata ? { name: metadata.name, version: metadata.version } : null,
    renderer: { id: selected.id, files: rendererFiles },
    rendererStatus: selected.status ?? 'active',
    diagnostics,
  };
}
