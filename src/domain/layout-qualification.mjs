import { canonicalHash, canonicalJson } from './canonical-json.mjs';
import { invalidArgument, PublicError } from './errors.mjs';
import { validateIdentifier } from './identifiers.mjs';

export const LAYOUT_QUALIFICATION_VERSION = 1;
export const EDITORIAL_RENDERER_ID = 'editorial-composed@1';
export const LAYOUT_IDS = Object.freeze([
  'cover-editorial@1',
  'content-flow@1',
  'content-dense@1',
  'diagram-explainer@1',
  'cta-editorial@1'
]);
export const QUALIFICATION_IDS = Object.freeze(LAYOUT_IDS.map(id => `qualification-${id}`));
export const QUALIFICATION_CHECKER_ID = 'editorial-objective-checkers@1';
export const QUALIFICATION_RUBRIC_ID = 'editorial-quality@1';
const FONT_IDENTITIES = Object.freeze({
  Anton: {
    role: 'title',
    sha256: 'a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab',
    style: 'normal',
    min: 400,
    max: 400,
    variable: false
  },
  Manrope: {
    role: 'body',
    sha256: 'd0639be45d0af36e798172419d7bd173c4bd4f29e2b76cbb69db1d11bf8b0a40',
    style: 'normal',
    min: 200,
    max: 800,
    variable: true
  },
  'JetBrains Mono': {
    role: 'mono',
    sha256: '48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda',
    style: 'normal',
    min: 100,
    max: 800,
    variable: true
  },
  'nimbus-roman-italic@1': {
    role: 'accent',
    sha256: 'b7c424e6cb79baddfcdcd9a9d87f9fc4fdd06f0e5160066e2b2e47bcd647c7b9',
    style: 'italic',
    min: 400,
    max: 400,
    variable: false
  },
});
const invalid = () => {
  throw invalidArgument('Ficha de layout inválida ou não suportada.');
};
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, required) => {
  if (!isObject(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key))) invalid();
};
const integer = (value, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
};
const number = (value, min = 0, max = Number.MAX_VALUE) => {
  if (!Number.isFinite(value) || value < min || value > max) invalid();
};
const hash = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid();
};
const id = value => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) || value.length > 80) invalid();
};
const list = (value, min = 0) => {
  if (!Array.isArray(value) || value.length < min) invalid();
};
const unique = (value, key = x => x) => {
  if (new Set(value.map(item => {
    if (item === null) invalid();
    return key(item);
  })).size !== value.length) invalid();
};
const ordered = (value, key = item => item) => {
  for (let i = 1; i < value.length; i++) if (key(value[i - 1]) > key(value[i])) invalid();
};
const enumeration = (value, allowed) => {
  if (!allowed.includes(value)) invalid();
};

function setOf(value, allowed, min = 0) {
  list(value, min);
  unique(value);
  for (const item of value) enumeration(item, allowed);
  ordered(value);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function rect(value) {
  keys(value, ['x', 'y', 'width', 'height']);
  number(value.x);
  number(value.y);
  number(value.width, 1);
  number(value.height, 1);
}

function resourceRef(value, expected) {
  keys(value, ['id', 'version', 'sha256']);
  if (value.id !== expected) invalid();
  integer(value.version);
  hash(value.sha256);
}

function evidenceRef(value, layoutId) {
  keys(value, ['id', 'version', 'sha256', 'kind']);
  enumeration(value.kind, ['qualification-fixture', 'qualification-metrics', 'qualification-review']);
  if (value.id !== `${value.kind}-${layoutId}`) invalid();
  integer(value.version);
  hash(value.sha256);
}

function fontBinding(binding) {
  keys(binding, ['role', 'fontId', 'sha256', 'style', 'weight', 'axes']);
  if (!Object.hasOwn(FONT_IDENTITIES, binding.fontId)) invalid();
  const identity = FONT_IDENTITIES[binding.fontId];
  if (binding.role !== identity.role || binding.sha256 !== identity.sha256 || binding.style !== identity.style) invalid();
  number(binding.weight, identity.min, identity.max);
  keys(binding.axes, identity.variable ? ['wght']: []);
  if (identity.variable && binding.axes.wght !== binding.weight) invalid();
}

/** Pure structural validation. No metrics, fonts, releases, licenses or runtime
 * are resolved here. Null checker/rubric refs mean pending Q06, only for candidates.
 * Semantic sets are supplied in UTF-16 canonical order; reading-order collections
 * retain their sequence. Reject noncanonical sets instead of rewriting hashed data.
 * Filling either ref changes definitionHash and requires a successor definition.
 */

export function validateLayoutQualification(value) {
  const record = JSON.parse(canonicalJson(value));
  keys(record, ['schemaVersion', 'id', 'version', 'status', 'definition', 'definitionHash', 'evidenceRefs', 'release']);
  if (record.schemaVersion !== LAYOUT_QUALIFICATION_VERSION) invalid();
  integer(record.version);
  enumeration(record.status, ['candidate', 'qualified', 'rejected']);
  hash(record.definitionHash);
  const definition = record.definition;
  keys(definition, [
    'layoutId',
    'rendererId',
    'roles',
    'dimensions',
    'surfaces',
    'regions',
    'styles',
    'limits',
    'continuity',
    'decorationOptions',
    'fontBindings',
    'checkerRef',
    'rubricRef'
  ]);
  enumeration(definition.layoutId, LAYOUT_IDS);
  if (record.id !== `qualification-${definition.layoutId}` || definition.rendererId !== EDITORIAL_RENDERER_ID) invalid();
  setOf(definition.roles, definition.layoutId === 'cover-editorial@1' ? ['cover'] : definition.layoutId === 'cta-editorial@1' ? ['cta'] : ['context', 'content', 'summary'], 1);
  keys(definition.dimensions, ['width', 'height']);
  if (definition.dimensions.width !== 1080 || definition.dimensions.height !== 1350) invalid();
  setOf(definition.surfaces, ['light', 'dark'], 1);
  list(definition.regions, 1);
  unique(definition.regions, r => r.id);
  unique(definition.regions, r => r.readingOrder);
  let previousOrder = 0;
  for (const region of definition.regions) {
    keys(region, ['id', 'x', 'y', 'width', 'height', 'kind', 'readingOrder']);
    id(region.id);
    number(region.x);
    number(region.y);
    number(region.width, 1);
    number(region.height, 1);
    integer(region.readingOrder);
    if (region.x + region.width > 1080 || region.y + region.height > 1350 || region.readingOrder <= previousOrder) invalid();
    previousOrder = region.readingOrder;
    enumeration(region.kind, ['text', 'asset', 'brand', 'decoration']);
  }
  const regions = new Map(definition.regions.map(r => [r.id, r]));
  list(definition.fontBindings, 1);
  for (const binding of definition.fontBindings) fontBinding(binding);
  unique(definition.fontBindings, canonicalJson);
  ordered(definition.fontBindings, canonicalJson);
  list(definition.styles, 1);
  unique(definition.styles, s => s.id);
  ordered(definition.styles, s => s.id);
  for (const style of definition.styles) {
    keys(style, ['id', 'fontRole', 'sizeMin', 'sizeMax', 'lineHeight', 'weight', 'colorToken', 'alignment']);
    id(style.id);
    enumeration(style.fontRole, ['title', 'body', 'mono', 'accent']);
    number(style.sizeMin, 24);
    number(style.sizeMax, style.sizeMin, 176);
    number(style.lineHeight, 1, 2);
    number(style.weight, 100, 800);
    enumeration(style.colorToken, ['text', 'muted', 'accent', 'secondaryAccent']);
    setOf(style.alignment, ['left', 'center', 'right'], 1);
    if (!definition.fontBindings.some(b => b.role === style.fontRole && b.weight === style.weight)) invalid();
  }
  const styles = new Map(definition.styles.map(s => [s.id, s]));
  const limits = definition.limits;
  keys(limits, [
    'safeTextBounds',
    'minBlockGap',
    'minSurfaceInset',
    'maxColumns',
    'maxSemanticAssets',
    'maxOverlaps',
    'maxBlockOccupancy',
    'maxClippedGlyphs',
    'maxUndeclaredCollisions',
    'minTextContrast',
    'minInformativeContrast',
    'maxRasterScale',
    'minDiagramLabelSize',
    'minInformativeStroke',
    'minAssetWidth',
    'minAssetHeight',
    'logoProtection',
    'minLogoHeight',
    'maxSignatureLines',
    'totalBodyLines',
    'textRegions',
    'allowedOverlaps'
  ]);
  rect(limits.safeTextBounds);
  if (canonicalJson(limits.safeTextBounds) !== canonicalJson({
    x: 60,
    y: 60,
    width: 960,
    height: 1250
  })) invalid();
  for (const [key, min] of Object.entries({
    minBlockGap: 24,
    minSurfaceInset: 12,
    minTextContrast: 4.5,
    minInformativeContrast: 3,
    minDiagramLabelSize: 34,
    minInformativeStroke: 3,
    logoProtection: 12,
    minLogoHeight: 24
  })) number(limits[key], min);
  integer(limits.maxColumns, 1, 2);
  integer(limits.maxSemanticAssets, 0, 1);
  integer(limits.maxOverlaps, 0, 2);
  number(limits.maxBlockOccupancy, 0, 1);
  number(limits.maxRasterScale, 0, 1);
  if (limits.maxClippedGlyphs !== 0 || limits.maxUndeclaredCollisions !== 0 || limits.maxSignatureLines !== 1) invalid();
  number(limits.minAssetWidth);
  number(limits.minAssetHeight);
  integer(limits.totalBodyLines, 1, 30);
  list(limits.textRegions, 3);
  unique(limits.textRegions, r => r.regionId);
  let previousTextOrder = 0;
  for (const rule of limits.textRegions) {
    keys(rule, ['regionId', 'fields', 'styleIds', 'maxLines']);
    const region = regions.get(rule.regionId);
    if (!region || region.kind !== 'text' || region.readingOrder <= previousTextOrder) invalid();
    previousTextOrder = region.readingOrder;
    setOf(rule.fields, ['eyebrow', 'title', 'body'], 1);
    if (rule.fields.length !== 1) invalid();
    list(rule.styleIds, 1);
    unique(rule.styleIds);
    ordered(rule.styleIds);
    integer(rule.maxLines, 1, 30);
    if (region.x < 60 || region.y < 60 || region.x + region.width > 1020 || region.y + region.height > 1310) invalid();
    for (const styleId of rule.styleIds) {
      const style = styles.get(styleId);
      if (!style) invalid();
      const field = rule.fields[0];
      if (field === 'title' && ! ['title', 'accent'].includes(style.fontRole) || field !== 'title' && style.fontRole !== 'body') invalid();
      if (field === 'body' && (style.sizeMin < 34 || style.lineHeight < 1.25) || field === 'eyebrow' && (style.sizeMin < 30 || rule.maxLines !== 1)) invalid();
    }
  }
  if (definition.regions.filter(r => r.kind === 'text').some(r => !limits.textRegions.some(rule => rule.regionId === r.id))) invalid();
  for (const field of ['eyebrow', 'title', 'body']) if (!limits.textRegions.some(rule => rule.fields.includes(field))) invalid();
  const bodyRules = limits.textRegions.filter(rule => rule.fields.includes('body'));
  if (bodyRules.length > limits.maxColumns || limits.totalBodyLines > bodyRules.reduce((sum, rule) => sum + rule.maxLines, 0)) invalid();
  if (definition.regions.filter(r => r.kind === 'asset').length > limits.maxSemanticAssets) invalid();
  if (definition.layoutId === 'diagram-explainer@1' && (limits.maxSemanticAssets !== 1 || limits.minAssetWidth < 720 || limits.minAssetHeight < 360 || !definition.regions.some(r => r.kind === 'asset'))) invalid();
  list(limits.allowedOverlaps);
  unique(limits.allowedOverlaps, canonicalJson);
  ordered(limits.allowedOverlaps, canonicalJson);
  if (limits.allowedOverlaps.length > limits.maxOverlaps) invalid();
  for (const overlap of limits.allowedOverlaps) {
    keys(overlap, ['backElementId', 'frontElementId', 'purpose']);
    enumeration(overlap.purpose, ['highlight-background', 'decorative-underlay']);
    const back = regions.get(overlap.backElementId),
    front = regions.get(overlap.frontElementId);
    if (!back || !front || back.id === front.id || back.kind !== 'decoration' || front.kind === 'brand') invalid();
    if (overlap.purpose === 'highlight-background' && front.kind !== 'text') invalid();
  }
  keys(definition.continuity, ['anchors', 'pairs', 'maxPairs']);
  list(definition.continuity.anchors);
  list(definition.continuity.pairs);
  integer(definition.continuity.maxPairs, 0, 2);
  unique(definition.continuity.anchors, a => a.id);
  unique(definition.continuity.pairs, p => p.id);
  ordered(definition.continuity.anchors, a => a.id);
  ordered(definition.continuity.pairs, p => p.id);
  for (const anchor of definition.continuity.anchors) {
    keys(anchor, ['id', 'regionId', 'x', 'y']);
    id(anchor.id);
    number(anchor.x, 0, 1);
    number(anchor.y, 0, 1);
    if (! ['asset', 'decoration'].includes(regions.get(anchor.regionId)?.kind)) invalid();
  }
  const anchors = new Map(definition.continuity.anchors.map(a => [a.id, a]));
  if (definition.continuity.pairs.length > definition.continuity.maxPairs) invalid();
  for (const pair of definition.continuity.pairs) {
    keys(pair, ['id', 'fromAnchorId', 'toAnchorId', 'semanticRoles']);
    id(pair.id);
    if (!anchors.has(pair.fromAnchorId) || !anchors.has(pair.toAnchorId) || pair.fromAnchorId === pair.toAnchorId) invalid();
    setOf(pair.semanticRoles, ['decorative', 'supporting'], 1);
  }
  list(definition.decorationOptions);
  unique(definition.decorationOptions, o => o.id);
  ordered(definition.decorationOptions, o => o.id);
  for (const option of definition.decorationOptions) {
    keys(option, ['id', 'elementId', 'anchorId', 'offsetX', 'offsetY', 'visible']);
    id(option.id);
    if (regions.get(option.elementId)?.kind !== 'decoration' || !anchors.has(option.anchorId) || anchors.get(option.anchorId).regionId !== option.elementId) invalid();
    number(option.offsetX, - 12, 12);
    number(option.offsetY, - 12, 12);
    if (typeof option.visible !== 'boolean') invalid();
  }
  for (const [key, expected] of [['checkerRef', QUALIFICATION_CHECKER_ID], ['rubricRef', QUALIFICATION_RUBRIC_ID]]) {
    if (definition[key] === null) {
      if (record.status !== 'candidate') invalid();
    } else resourceRef(definition[key], expected);
  }
  list(record.evidenceRefs);
  unique(record.evidenceRefs, e => `${e.id}:${e.version}`);
  ordered(record.evidenceRefs, canonicalJson);
  for (const evidence of record.evidenceRefs) evidenceRef(evidence, definition.layoutId);
  if (record.status === 'candidate') {
    if (record.release !== null || record.evidenceRefs.length !== 0) invalid();
  } else {
    const release = record.release;
    keys(release, ['decisionId', 'decidedAt', 'reviewEvidenceRef', 'qualifiedEnvironments']);
    validateIdentifier(release.decisionId);
    if (typeof release.decidedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(release.decidedAt) || !Number.isFinite(Date.parse(release.decidedAt)) || new Date(release.decidedAt).toISOString() !== release.decidedAt) invalid();
    evidenceRef(release.reviewEvidenceRef, definition.layoutId);
    if (release.reviewEvidenceRef.kind !== 'qualification-review' || !record.evidenceRefs.some(ref => canonicalJson(ref) === canonicalJson(release.reviewEvidenceRef))) invalid();
    list(release.qualifiedEnvironments, record.status === 'qualified' ? 1: 0);
    unique(release.qualifiedEnvironments, canonicalJson);
    ordered(release.qualifiedEnvironments, canonicalJson);
    if (record.status === 'qualified' && ['qualification-fixture', 'qualification-metrics', 'qualification-review'].some(kind => !record.evidenceRefs.some(ref => ref.kind === kind))) invalid();
    for (const environment of release.qualifiedEnvironments) {
      keys(environment, ['platform', 'arch', 'node', 'abi', 'napi', 'dependenciesHash', 'rendererHash', 'fontBindingsHash']);
      enumeration(environment.platform, ['win32', 'linux', 'darwin']);
      enumeration(environment.arch, ['x64', 'arm64']);
      if (typeof environment.node !== 'string' || !/^v\d+\.\d+\.\d+$/.test(environment.node)) invalid();
      for (const key of ['abi', 'napi']) if (typeof environment[key] !== 'string' || !/^\d+$/.test(environment[key])) invalid();
      for (const key of ['dependenciesHash', 'rendererHash', 'fontBindingsHash']) hash(environment[key]);
      if (environment.fontBindingsHash !== canonicalHash(definition.fontBindings)) invalid();
    }
  }
  if (canonicalHash(definition) !== record.definitionHash) throw new PublicError('ARTIFACT_HASH_MISMATCH', 'Definição de layout diverge de seu hash.');
  return freeze(record);
}

/** Q02 has no trusted released resource. A structurally valid status string,
 * release object or fabricated environment is never a qualification authority.
 * A future package-backed resolver must replace this fail-closed boundary.
 */

export function assertQualifiedLayout(record) {
  validateLayoutQualification(record);
  throw new PublicError('LAYOUT_NOT_QUALIFIED', 'Layout sem qualificação liberada para produção.');
}
