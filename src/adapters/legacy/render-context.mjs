import { readFile } from 'node:fs/promises';
import { prepareLogoLayout, legacySurface } from './logo-layout.mjs';
import { selectLogoVariant, MAX_LOGO_BYTES } from '../../domain/logo-policy.mjs';
import { validateBrandConfig } from '../../domain/brand-schema.mjs';
import { canonicalHash, canonicalJson } from '../../domain/canonical-json.mjs';
import { PublicError, invalidArgument } from '../../domain/errors.mjs';
import { createConfinedRoot } from '../../infrastructure/fs/confined-path.mjs';
import {
  loadResourcesManifest, resolveResources, inspectPackage, probeDependency, dependencyNames, sha256,
} from '../../infrastructure/resources.mjs';

const contexts = new WeakMap();
const mismatch = () => new PublicError('RUNTIME_MISMATCH', 'Recursos ou runtime não correspondem ao snapshot.');
const unsupported = () => new PublicError('RUN_CONTRACT_UNSUPPORTED', 'Contexto legado exige snapshot 1 e renderizador legado.');
const inconsistent = () => new PublicError('SNAPSHOT_HASH_MISMATCH', 'Configuração congelada do snapshot inconsistente.');
const freeze = value => {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Internal v1 renderer primitive. Resolving a context is not a production gate,
 * approval, migration or permission to resume a historical run. T20 owns execution.
 * Fonts are read only from the explicit authorized root, never from installation defaults.
 */
export async function resolveLegacyRenderContext({ snapshot, fontRoot, logoData } = {}) {
  const frozen = JSON.parse(canonicalJson(snapshot));
  if (frozen.schemaVersion !== 1 || frozen.contractVersion !== 1 || frozen.canonicalVersion !== 1
      || frozen.renderer?.id !== 'legacy-panorama@1'
      || Object.hasOwn(frozen.brand?.config ?? {}, 'configVersion')) throw unsupported();
  const brand = validateBrandConfig(frozen.brand.config);
  const themeId = frozen.theme?.id;
  if (!Object.hasOwn(brand.themes, themeId)
      || canonicalHash(brand.themes[themeId]) !== canonicalHash(frozen.theme.values)
      || canonicalHash(brand) !== frozen.brand.effectiveHash
      || frozen.dimensions?.width !== brand.slideWidth || frozen.dimensions?.height !== brand.slideHeight) {
    throw inconsistent();
  }
  let selectedLogo = null;
  if (brand.logo.enabled) {
    const surface = legacySurface(brand.themes[themeId].background), id = selectLogoVariant(brand.logo, surface);
    const refs = frozen.logos;
    if (!Array.isArray(refs) || refs.length !== Object.keys(brand.logo.variants).length
        || refs.some(ref => !ref || typeof ref !== 'object' || !['light', 'dark'].includes(ref.surface))
        || new Set(refs.map(ref => ref.surface)).size !== refs.length
        || refs.some(ref => ref.id !== brand.logo.variants[ref.surface] || !/^[a-f0-9]{64}$/.test(ref.sha256))) throw inconsistent();
    const ref = refs.find(item => item.surface === surface);
    if (!ref || ref.id !== id) throw inconsistent();
    const matches = Array.isArray(logoData) ? logoData.filter(item => item?.id === id) : [];
    if (!matches.length) throw new PublicError('RESOURCE_MISSING', 'PNG de logotipo autorizado ausente.');
    if (matches.length !== 1 || !Buffer.isBuffer(matches[0].bytes) || matches[0].bytes.length > MAX_LOGO_BYTES) {
      throw new PublicError('ASSET_INVALID', 'Recurso de logotipo inválido ou ambíguo.');
    }
    // Own the selected resource before any font/runtime asynchronous work.
    selectedLogo = { id, sha256: ref.sha256, bytes: Buffer.from(matches[0].bytes) };
    if (matches[0].sha256 !== ref.sha256 || sha256(selectedLogo.bytes) !== ref.sha256) {
      throw new PublicError('ASSET_HASH_MISMATCH', 'PNG de logotipo não corresponde ao snapshot.');
    }
  }
  const manifest = await loadResourcesManifest();
  const expectedFonts = manifest.fonts.map(({ id, sha256 }) => ({ id, sha256 }));
  if (canonicalHash(frozen.fonts) !== canonicalHash(expectedFonts)) throw mismatch();
  const resources = await resolveResources({ fontRoot, manifest });
  if (resources.diagnostics.length) {
    const { code, message } = resources.diagnostics[0];
    throw new PublicError(code, message);
  }
  const packageInfo = await inspectPackage({ manifest });
  if (packageInfo.diagnostics.length) {
    const { code, message } = packageInfo.diagnostics[0];
    throw new PublicError(code, message);
  }
  const dependencies = Object.fromEntries(await Promise.all(dependencyNames.map(async name => {
    try { return [name, await probeDependency(name)]; }
    catch { throw new PublicError('DEPENDENCY_UNAVAILABLE', 'Dependência ausente ou incompatível com o runtime atual.'); }
  })));
  const runtime = {
    package: packageInfo.package, node: process.version, platform: process.platform, arch: process.arch,
    abi: process.versions.modules, napi: process.versions.napi, renderer: packageInfo.renderer,
    dependencies, fonts: resources.fonts.map(({ id, sha256 }) => ({ id, sha256 })),
  };
  if (canonicalHash(runtime) !== canonicalHash(frozen.runtime)
      || canonicalHash(runtime.renderer) !== canonicalHash(frozen.renderer)) throw mismatch();

  const guard = await createConfinedRoot(fontRoot), fontData = {}, hashes = {};
  for (const [role, id] of Object.entries(brand.fonts)) {
    const font = manifest.fonts.find(item => item.id === id);
    // Check confinement and bytes again at consumption; resolver paths are not reusable trust.
    try { fontData[role] = await guard.withPaths([font.file], file => readFile(file)); }
    catch { throw new PublicError('RESOURCE_MISSING', 'Fonte aprovada ausente ou inacessível na raiz autorizada.'); }
    if (sha256(fontData[role]) !== font.sha256) throw mismatch();
    hashes[role] = font.sha256;
  }
  const logoLayout = await prepareLogoLayout({ logo: brand.logo, theme: brand.themes[themeId], logos: selectedLogo ? [selectedLogo] : [] });
  const context = freeze({ brand, themeId, theme: brand.themes[themeId], fontData, logoLayout });
  contexts.set(context, hashes);
  return context;
}

/** Reject malformed/forged contexts and mutation of the exposed byte buffers.
 * Metadata is detached and deeply frozen; a failed explicit context never falls back.
 */
export function assertLegacyRenderContext(context, carousel) {
  const hashes = contexts.get(context);
  if (!hashes || context.themeId !== carousel?.theme) throw invalidArgument('Contexto explícito inválido ou incompatível com o tema.');
  const fontData = {};
  for (const [role, expected] of Object.entries(hashes)) {
    if (!Buffer.isBuffer(context.fontData[role])) throw mismatch();
    fontData[role] = Buffer.from(context.fontData[role]);
    if (sha256(fontData[role]) !== expected) throw mismatch();
  }
  // Own the exact verified bytes before renderer awaits asset I/O.
  return { ...context, fontData };
}

/** Explicit internal dispatch. Absence/unknown identity never selects a renderer.
 * Editorial resources remain a primitive, not production eligibility. */
export async function resolveRenderContext(options = {}) {
  options = detachDispatchInput(options);
  switch (options?.snapshot?.renderer?.id) {
    case 'legacy-panorama@1': return resolveLegacyRenderContext(options);
    case 'editorial-composed@1': {
      const { resolveComposedRenderResources } = await import('../../render/composed-carousel.mjs');
      return resolveComposedRenderResources(options);
    }
    default: throw new PublicError('RUN_CONTRACT_UNSUPPORTED', 'Renderizador explícito ausente ou não suportado.');
  }
}

function detachDispatchInput(value, ancestors = new Set()) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value === null || ['string','boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return value;
  const array=Array.isArray(value);
  if (!value || typeof value !== 'object' || ancestors.has(value) || !array && ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw invalidArgument('Contexto explícito inválido.');
  const descriptors=Object.getOwnPropertyDescriptors(value),copy=array?[]:{};
  if(array&&Object.keys(value).length!==value.length) throw invalidArgument('Contexto explícito inválido.');
  ancestors.add(value);
  for(const key of Reflect.ownKeys(descriptors)) {
    if(array&&key==='length') continue;
    const descriptor=descriptors[key];
    if(typeof key!=='string'||key==='__proto__'||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')) throw invalidArgument('Contexto explícito inválido.');
    Object.defineProperty(copy,key,{value:detachDispatchInput(descriptor.value,ancestors),enumerable:true,writable:true,configurable:true});
  }
  ancestors.delete(value);return copy;
}
