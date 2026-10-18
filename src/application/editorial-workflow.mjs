import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRunInputs } from './run-inputs.mjs';
import { createApprovals } from './approvals.mjs';
import { runOperation } from './operation-runner.mjs';
import { canonicalHash, canonicalJson } from '../domain/canonical-json.mjs';
import { exactKeys } from '../domain/brand-schema.mjs';
import { PublicError, invalidArgument } from '../domain/errors.mjs';
import { validateIdentifier } from '../domain/identifiers.mjs';
import { createConfinedRoot } from '../infrastructure/fs/confined-path.mjs';
import { stageBytes, promoteFile } from '../infrastructure/fs/atomic-files.mjs';
import { hashFile } from '../infrastructure/fs/hash-file.mjs';
import { verifySchema } from '../infrastructure/sqlite/migrations.mjs';
import { DEFAULT_PACKAGE_ROOT } from '../infrastructure/resources.mjs';
import { loadQualifiedQualityResources } from './quality-resources.mjs';

export const EDITORIAL_ROLES = Object.freeze([
  'editor-chief',
  'copywriter',
  'art-director',
  'layout-designer',
  'quality-reviewer',
  'production-manager',
]);

const guide = (skill, responsibility, boundaries) => Object.freeze({
  skill,
  executionMode: 'host-skill',
  responsibility,
  boundaries: Object.freeze(boundaries),
});

export const EDITORIAL_ROLE_GUIDE = Object.freeze({
  'editor-chief': guide('peterson-carousel-idea', 'Definir mensagem central, objetivo, público e recorte editorial.', ['Não redigir a copy final.', 'Não decidir composição visual.']),
  copywriter: guide('peterson-carousel-copy', 'Redigir ou vincular a copy ao brief editorial aprovado.', ['Não escolher conceito visual.', 'Não alterar uma copy já aprovada.']),
  'art-director': guide('peterson-carousel-design', 'Definir objeto visual, relação com a mensagem, justificativa, obrigatórios e proibidos.', ['Não posicionar elementos.', 'Não reescrever a copy.']),
  'layout-designer': guide('peterson-carousel-design', 'Aplicar hierarquia, fontes, regiões e continuidade no plano qualificado.', ['Não escolher a mensagem.', 'Não inventar elementos fora da direção de arte.']),
  'quality-reviewer': guide('peterson-carousel-design', 'Comparar pixels reais com copy, contrato semântico e critérios visuais.', ['Não conceder aprovação humana.', 'Não declarar inspeção visual que não ocorreu.']),
  'production-manager': guide('peterson-carousel', 'Coordenar estado, gates, render, revisão e entrega sem tomar decisões editoriais.', ['Não ultrapassar gates humanos.', 'Não modificar copy, direção ou layout.']),
});

const assignment = (role, task) => Object.freeze({ role, task, ...EDITORIAL_ROLE_GUIDE[role] });

const deliveryOrder = Object.freeze(['editor-chief', 'copywriter', 'art-director', 'layout-designer', 'production-manager', 'quality-reviewer']);
const fail = (code, message) => { throw new PublicError(code, message); };
const clone = value => JSON.parse(canonicalJson(value));
const reference = row => ({ id: row.id, kind: row.kind, version: row.version, sha256: row.hash });
const deliveryKind = role => `editorial-delivery:${role}`;

function scope(value) {
  validateIdentifier(value.brandId);
  validateIdentifier(value.runId);
}

function string(value, message) {
  if (typeof value !== 'string' || !value.trim()) throw invalidArgument(message);
  return value;
}

function strings(value, message) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw invalidArgument(message);
  return value;
}

function validateRequest(value) {
  exactKeys(value, ['topic', 'objective', 'audience', 'constraints']);
  string(value.topic, 'Tema editorial inválido.');
  string(value.objective, 'Objetivo editorial inválido.');
  string(value.audience, 'Público editorial inválido.');
  strings(value.constraints, 'Restrições editoriais inválidas.');
  return clone(value);
}

function sameReference(actual, expected) {
  return canonicalHash(actual) === canonicalHash(expected);
}

function validateOutput(role, value, { briefRef, copyRef, manifestRef, automaticEvidenceRef } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('EDITORIAL_DELIVERY_INVALID', 'Entrega editorial inválida.');
  if (role === 'editor-chief') {
    exactKeys(value, ['schemaVersion', 'kind', 'centralMessage', 'objective', 'audience', 'constraints']);
    if (value.schemaVersion !== 1 || value.kind !== 'editorial-brief') fail('EDITORIAL_DELIVERY_INVALID', 'Brief editorial incompatível.');
    string(value.centralMessage, 'Mensagem central inválida.');
    string(value.objective, 'Objetivo editorial inválido.');
    string(value.audience, 'Público editorial inválido.');
    strings(value.constraints, 'Restrições editoriais inválidas.');
  } else if (role === 'copywriter') {
    exactKeys(value, ['schemaVersion', 'kind', 'briefRef', 'carouselRef', 'note']);
    if (value.schemaVersion !== 1 || value.kind !== 'carousel-copy'
      || !sameReference(value.briefRef, briefRef) || !sameReference(value.carouselRef, copyRef)) {
      fail('EDITORIAL_DELIVERY_INVALID', 'Entrega de copy não corresponde ao brief e à copy vigentes.');
    }
    string(value.note, 'Nota de handoff da copy inválida.');
  } else if (role === 'art-director') {
    exactKeys(value, ['schemaVersion', 'kind', 'copyDeliveryRef', 'conceptRef', 'visualObject', 'messageRelation', 'justification', 'requiredElements', 'forbiddenElements']);
    if (value.schemaVersion !== 1 || value.kind !== 'art-direction'
      || !sameReference(value.copyDeliveryRef, briefRef) || !sameReference(value.conceptRef, copyRef)) {
      fail('EDITORIAL_DELIVERY_INVALID', 'Direção de arte não corresponde à copy e ao conceito vigentes.');
    }
    string(value.visualObject, 'Objeto visual inválido.');
    string(value.messageRelation, 'Relação visual com a mensagem inválida.');
    string(value.justification, 'Justificativa visual inválida.');
    strings(value.requiredElements, 'Elementos visuais obrigatórios inválidos.');
    strings(value.forbiddenElements, 'Elementos visuais proibidos inválidos.');
  } else if (role === 'layout-designer') {
    exactKeys(value, ['schemaVersion', 'kind', 'artDirectionRef', 'compositionPlanRef', 'hierarchyDecision', 'fontDecision', 'placementDecision']);
    if (value.schemaVersion !== 1 || value.kind !== 'layout-plan'
      || !sameReference(value.artDirectionRef, briefRef) || !sameReference(value.compositionPlanRef, copyRef)) {
      fail('EDITORIAL_DELIVERY_INVALID', 'Layout não corresponde à direção de arte e ao plano vigentes.');
    }
    string(value.hierarchyDecision, 'Decisão de hierarquia inválida.');
    string(value.fontDecision, 'Decisão de fontes inválida.');
    string(value.placementDecision, 'Decisão de posicionamento inválida.');
  } else if (role === 'production-manager') {
    exactKeys(value, ['schemaVersion', 'kind', 'layoutDeliveryRef', 'compositionPlanRef', 'phase', 'automaticAttemptLimit', 'note']);
    if (value.schemaVersion !== 1 || value.kind !== 'production-instruction' || value.phase !== 'preview-render'
      || value.automaticAttemptLimit !== 2 || !sameReference(value.layoutDeliveryRef, briefRef)
      || !sameReference(value.compositionPlanRef, copyRef)) {
      fail('EDITORIAL_DELIVERY_INVALID', 'Instrução de produção não corresponde ao layout e ao orçamento vigentes.');
    }
    string(value.note, 'Nota de produção inválida.');
  } else if (role === 'quality-reviewer') {
    exactKeys(value, ['schemaVersion', 'kind', 'productionRef', 'manifestRef', 'semanticContractRef', 'automaticChecks', 'agentVisual', 'humanReview']);
    if (value.schemaVersion !== 1 || value.kind !== 'qa-assessment'
      || !sameReference(value.productionRef, briefRef) || !sameReference(value.semanticContractRef, copyRef)
      || !sameReference(value.manifestRef, manifestRef)) {
      fail('EDITORIAL_DELIVERY_INVALID', 'Parecer de QA não corresponde à produção, aos pixels e ao contrato vigentes.');
    }
    exactKeys(value.automaticChecks, ['status', 'evidenceRef']);
    if (!['available', 'failed'].includes(value.automaticChecks.status)
      || !sameReference(value.automaticChecks.evidenceRef, automaticEvidenceRef)) fail('EDITORIAL_DELIVERY_INVALID', 'Evidência automática de QA inválida.');
    exactKeys(value.agentVisual, ['status', 'method', 'notes']);
    if (!['passed', 'failed', 'not-performed'].includes(value.agentVisual.status)) fail('EDITORIAL_DELIVERY_INVALID', 'Estado da inspeção visual do agente inválido.');
    string(value.agentVisual.method, 'Método de inspeção visual inválido.');
    string(value.agentVisual.notes, 'Nota de inspeção visual inválida.');
    exactKeys(value.humanReview, ['status']);
    if (value.humanReview.status !== 'pending') fail('EDITORIAL_DELIVERY_INVALID', 'QA do agente não pode conceder a revisão humana.');
  } else {
    fail('EDITORIAL_DELIVERY_INVALID', 'Papel ainda não produz entrega neste estágio.');
  }
  return clone(value);
}

/**
 * Host-coordinated editorial team. Role handlers are supplied by the Codex host
 * following the installed Peterson skills; this module orders, scopes and records
 * their work. It is not a model adapter and does not claim autonomous agents.
 */
export async function createEditorialWorkflow({ root, db, roles = {}, packageRoot, hooks = {}, sleep } = {}) {
  const guard = await createConfinedRoot(root);
  const effectivePackageRoot = packageRoot ?? DEFAULT_PACKAGE_ROOT;
  const packageGuard = await createConfinedRoot(effectivePackageRoot);
  const inputs = await createRunInputs({ root, db, packageRoot: effectivePackageRoot });
  const approvals = await createApprovals({ root, db, packageRoot: effectivePackageRoot });
  const loadPackageModule = relative => packageGuard.withPaths([relative], filename => import(pathToFileURL(filename).href));

  function assertTeam() {
    for (const role of EDITORIAL_ROLES) {
      if (typeof roles[role] !== 'function') fail('EDITORIAL_ROLE_UNAVAILABLE', `Papel editorial indisponível: ${role}.`);
    }
  }

  function artifactRow(brandId, runId, role, contextFingerprint = null) {
    const rows = db.prepare('SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND kind=? ORDER BY version DESC')
      .all(brandId, runId, deliveryKind(role));
    if (contextFingerprint === null) return rows[0] ?? null;
    return rows.find(row => {
      try { return JSON.parse(row.metadata_json).contextFingerprint === contextFingerprint; }
      catch { return false; }
    }) ?? null;
  }

  async function readDelivery(row) {
    let bytes;
    try { bytes = await guard.withPaths([row.relative_path], filename => readFile(filename)); }
    catch (error) { if (error.code === 'ENOENT') fail('RESOURCE_MISSING', 'Entrega editorial gerenciada indisponível.'); throw error; }
    const metadata = JSON.parse(row.metadata_json);
    if (createHash('sha256').update(bytes).digest('hex') !== row.hash || bytes.length !== metadata.size) {
      fail('ARTIFACT_HASH_MISMATCH', 'Bytes da entrega editorial divergem da identidade registrada.');
    }
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); }
    catch { fail('ARTIFACT_HASH_MISMATCH', 'Entrega editorial gerenciada inválida.'); }
    if (value.schemaVersion === 1) {
      exactKeys(value, ['schemaVersion', 'id', 'brandId', 'runId', 'owner', 'status', 'task', 'dependencies', 'output', 'createdAt']);
    } else if (value.schemaVersion === 2) {
      exactKeys(value, ['schemaVersion', 'id', 'brandId', 'runId', 'owner', 'status', 'task', 'version', 'contextFingerprint', 'dependencies', 'output', 'createdAt']);
    } else {
      fail('ARTIFACT_HASH_MISMATCH', 'Versão da entrega editorial inválida.');
    }
    if (value.id !== row.id || value.brandId !== row.brand_id || value.runId !== row.run_id
      || value.status !== 'completed' || deliveryKind(value.owner) !== row.kind || !deliveryOrder.includes(value.owner)
      || canonicalHash(value.output) !== metadata.outputHash || canonicalHash(value.dependencies) !== metadata.dependenciesHash) {
      fail('ARTIFACT_HASH_MISMATCH', 'Envelope editorial não corresponde ao registro persistido.');
    }
    if (value.schemaVersion === 2
      && (value.version !== row.version || value.contextFingerprint !== metadata.contextFingerprint)) {
      fail('ARTIFACT_HASH_MISMATCH', 'Versão ou contexto editorial diverge do registro persistido.');
    }
    return Object.freeze({ ...value, artifactRef: reference(row) });
  }

  function latestArtifact(brandId, runId, kind) {
    return db.prepare('SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND kind=? ORDER BY version DESC LIMIT 1')
      .get(brandId, runId, kind);
  }

  async function readJsonArtifact(row, expectedKind) {
    let bytes;
    try { bytes = await guard.withPaths([row.relative_path], filename => readFile(filename)); }
    catch (error) { if (error.code === 'ENOENT') fail('RESOURCE_MISSING', 'Artefato editorial gerenciado indisponível.'); throw error; }
    const metadata = JSON.parse(row.metadata_json);
    if (createHash('sha256').update(bytes).digest('hex') !== row.hash || bytes.length !== metadata.size) {
      fail('ARTIFACT_HASH_MISMATCH', 'Bytes do artefato editorial divergem da identidade registrada.');
    }
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); }
    catch { fail('ARTIFACT_HASH_MISMATCH', 'Artefato editorial gerenciado inválido.'); }
    if (row.kind !== expectedKind || value.id !== row.id || value.version !== row.version
      || value.brandId !== row.brand_id || value.runId !== row.run_id) {
      fail('ARTIFACT_HASH_MISMATCH', 'Envelope editorial não corresponde ao registro persistido.');
    }
    return Object.freeze({ value, artifactRef: reference(row) });
  }

  async function persistEditorialRequest(input) {
    const current = latestArtifact(input.brandId, input.runId, 'editorial-request');
    if (!Object.hasOwn(input, 'request')) {
      if (!current) fail('EDITORIAL_REQUEST_REQUIRED', 'Pedido editorial inicial é obrigatório.');
      return readJsonArtifact(current, 'editorial-request');
    }
    const request = validateRequest(input.request);
    if (current) {
      const saved = await readJsonArtifact(current, 'editorial-request');
      if (canonicalHash(saved.value.request) === canonicalHash(request)) return saved;
    }
    const version = (current?.version ?? 0) + 1;
    const id = randomUUID();
    const value = { schemaVersion: 1, id, brandId: input.brandId, runId: input.runId, version, request, createdAt: new Date().toISOString() };
    const bytes = Buffer.from(canonicalJson(value));
    const staged = await stageBytes(guard, bytes, { hooks, sleep });
    const actual = await guard.withPaths([staged], hashFile);
    const relativePath = `runs/${input.brandId}/${input.runId}/${randomUUID()}/${id}.bin`;
    await promoteFile(guard, staged, relativePath, { hooks, sleep });
    const artifactRef = { id, kind: 'editorial-request', version, sha256: actual.sha256 };
    const operation = {
      requestId: `${input.requestId}:editorial-request`, brandId: input.brandId, runId: input.runId,
      operation: 'editorial.request.save', payload: { request },
    };
    const result = Object.freeze({ value, artifactRef });
    return runOperation(db, operation, () => {
      const run = db.prepare('SELECT id FROM runs WHERE brand_id=? AND id=?').get(input.brandId, input.runId);
      if (!run) fail('RUN_NOT_FOUND', 'Execução não encontrada.');
      const latest = latestArtifact(input.brandId, input.runId, 'editorial-request');
      if ((latest?.version ?? 0) + 1 !== version) fail('EDITORIAL_STAGE_CONFLICT', 'Pedido editorial mudou durante a gravação.');
      db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, input.brandId, input.runId, 'editorial-request', version, actual.sha256, relativePath, canonicalJson({ size: actual.size, requestHash: canonicalHash(request) }));
      return { status: 'committed', result };
    });
  }

  const protocolTask = Object.freeze({
    'editor-chief': 'define-brief',
    copywriter: 'write-carousel-copy',
    'art-director': 'define-art-direction',
    'layout-designer': 'compose-qualified-layout',
    'production-manager': 'authorize-preview-render',
  });

  function protocolContextFingerprint(role, dependencies) {
    return canonicalHash({ schemaVersion: 1, role, task: protocolTask[role], dependencies: dependencies.map(item => item.artifactRef) });
  }

  function protocolAssignment(role, brandId, runId, dependencies, context) {
    const contextFingerprint = protocolContextFingerprint(role, dependencies);
    return Object.freeze({
      id: `editorial:${canonicalHash({ brandId, runId, role, contextFingerprint })}`,
      role,
      task: protocolTask[role],
      contextFingerprint,
      ...EDITORIAL_ROLE_GUIDE[role],
      context: Object.freeze({ scope: { brandId, runId }, dependencies: clone(dependencies), ...clone(context) }),
    });
  }

  async function currentProtocolAssignment(brandId, runId, requestId) {
    const requestRow = latestArtifact(brandId, runId, 'editorial-request');
    if (!requestRow) fail('EDITORIAL_REQUEST_REQUIRED', 'Pedido editorial inicial é obrigatório.');
    const requestArtifact = await readJsonArtifact(requestRow, 'editorial-request');
    const editorFingerprint = protocolContextFingerprint('editor-chief', [requestArtifact]);
    const editorRow = artifactRow(brandId, runId, 'editor-chief', editorFingerprint);
    if (!editorRow) {
      return protocolAssignment('editor-chief', brandId, runId, [requestArtifact], { request: requestArtifact.value.request });
    }
    const editor = await readDelivery(editorRow);
    const copyFingerprint = protocolContextFingerprint('copywriter', [editor]);
    const copyRow = artifactRow(brandId, runId, 'copywriter', copyFingerprint);
    if (!copyRow) return protocolAssignment('copywriter', brandId, runId, [editor], { brief: editor.output });
    const copy = await readDelivery(copyRow);
    const copyApproval = await approvals.request({ requestId: `${requestId}:copy-approval`, brandId, runId, kind: 'copy' });
    if (copyApproval.status === 'pending') return Object.freeze({ status: 'waiting-human-approval', gate: 'text-approval', approval: copyApproval });
    const directionFingerprint = protocolContextFingerprint('art-director', [copy]);
    const directionRow = artifactRow(brandId, runId, 'art-director', directionFingerprint);
    if (!directionRow) return protocolAssignment('art-director', brandId, runId, [copy], { carouselRef: copy.output.carouselRef });
    const direction = await readDelivery(directionRow);
    const conceptApproval = await approvals.request({ requestId: `${requestId}:concept-approval`, brandId, runId, kind: 'concept' });
    if (conceptApproval.status === 'pending') return Object.freeze({ status: 'waiting-human-approval', gate: 'concept-approval', approval: conceptApproval });
    const layoutFingerprint = protocolContextFingerprint('layout-designer', [direction]);
    const layoutRow = artifactRow(brandId, runId, 'layout-designer', layoutFingerprint);
    if (!layoutRow) {
      const saved = await inputs.get(brandId, runId);
      return protocolAssignment('layout-designer', brandId, runId, [direction], {
        carouselRef: saved?.artifacts.carousel, conceptRef: saved?.artifacts.concept,
        qualificationRefs: JSON.parse(db.prepare('SELECT snapshot_json FROM runs WHERE brand_id=? AND id=?').get(brandId, runId).snapshot_json).qualifications,
      });
    }
    const layout = await readDelivery(layoutRow);
    const assetsApproval = await approvals.request({ requestId: `${requestId}:assets-approval`, brandId, runId, kind: 'creative-assets' });
    if (assetsApproval.status === 'pending') return Object.freeze({ status: 'waiting-human-approval', gate: 'image-approval', approval: assetsApproval });
    return protocolAssignment('production-manager', brandId, runId, [layout], { compositionPlanRef: layout.output.compositionPlanRef, automaticAttemptLimit: 2 });
  }

  async function withGeneratedSource(bytes, work) {
    const staged = await stageBytes(guard, bytes, { hooks, sleep });
    const actual = await guard.withPaths([staged], hashFile);
    try {
      return await guard.withPaths([staged], sourcePath => work({ sourcePath, sha256: actual.sha256 }));
    } finally {
      await guard.withPaths([staged], filename => unlink(filename)).catch(() => {});
    }
  }

  function runVersion(brandId, runId) {
    const row = db.prepare('SELECT version FROM runs WHERE brand_id=? AND id=?').get(brandId, runId);
    if (!row) fail('RUN_NOT_FOUND', 'Execução não encontrada.');
    return row.version;
  }

  function validateProtocolSubmission(current, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('EDITORIAL_DELIVERY_INVALID', 'Entrega editorial inválida.');
    const dependencyRef = current.context.dependencies[0]?.artifactRef;
    if (current.role === 'editor-chief') return validateOutput('editor-chief', raw);
    if (current.role === 'copywriter') {
      exactKeys(raw, ['schemaVersion', 'kind', 'briefRef', 'carousel', 'note']);
      if (raw.schemaVersion !== 1 || raw.kind !== 'carousel-copy' || !sameReference(raw.briefRef, dependencyRef)
        || !raw.carousel || typeof raw.carousel !== 'object' || Array.isArray(raw.carousel)) fail('EDITORIAL_DELIVERY_INVALID', 'Copy não corresponde ao brief vigente.');
      string(raw.note, 'Nota de handoff da copy inválida.');
    } else if (current.role === 'art-director') {
      exactKeys(raw, ['schemaVersion', 'kind', 'copyDeliveryRef', 'concept', 'visualObject', 'messageRelation', 'justification', 'requiredElements', 'forbiddenElements']);
      if (raw.schemaVersion !== 1 || raw.kind !== 'art-direction' || !sameReference(raw.copyDeliveryRef, dependencyRef)) fail('EDITORIAL_DELIVERY_INVALID', 'Direção de arte não corresponde à copy vigente.');
      string(raw.concept, 'Conceito visual inválido.');
      for (const key of ['visualObject', 'messageRelation', 'justification']) string(raw[key], 'Decisão de direção de arte inválida.');
      strings(raw.requiredElements, 'Elementos visuais obrigatórios inválidos.');
      strings(raw.forbiddenElements, 'Elementos visuais proibidos inválidos.');
    } else if (current.role === 'layout-designer') {
      exactKeys(raw, ['schemaVersion', 'kind', 'artDirectionRef', 'plan', 'hierarchyDecision', 'fontDecision', 'placementDecision']);
      if (raw.schemaVersion !== 1 || raw.kind !== 'layout-plan' || !sameReference(raw.artDirectionRef, dependencyRef)
        || !raw.plan || typeof raw.plan !== 'object' || Array.isArray(raw.plan)) fail('EDITORIAL_DELIVERY_INVALID', 'Layout não corresponde à direção de arte vigente.');
      for (const key of ['hierarchyDecision', 'fontDecision', 'placementDecision']) string(raw[key], 'Decisão de layout inválida.');
    } else {
      fail('EDITORIAL_STAGE_UNAVAILABLE', 'Submissão desta etapa editorial ainda não foi habilitada.');
    }
    return clone(raw);
  }

  async function materializeProtocolOutput(request, current, raw) {
    if (current.role === 'editor-chief') return raw;
    if (current.role === 'copywriter') {
      const saved = await withGeneratedSource(Buffer.from(canonicalJson(raw.carousel)), carousel => inputs.save({
        requestId: `${request.requestId}:carousel`, brandId: request.brandId, runId: request.runId,
        expectedVersion: runVersion(request.brandId, request.runId), carousel,
      }));
      return { schemaVersion: 1, kind: raw.kind, briefRef: raw.briefRef, carouselRef: saved.artifacts.carousel, note: raw.note };
    }
    if (current.role === 'art-director') {
      const saved = await inputs.get(request.brandId, request.runId);
      if (!saved?.artifacts.carousel) fail('INPUTS_REQUIRED', 'Copy persistida é necessária para a Direção de Arte.');
      const carousel = await inputs.resolveArtifact(request.brandId, request.runId, saved.artifacts.carousel.id);
      const updated = await withGeneratedSource(Buffer.from(raw.concept, 'utf8'), concept => inputs.save({
        requestId: `${request.requestId}:concept`, brandId: request.brandId, runId: request.runId,
        expectedVersion: runVersion(request.brandId, request.runId),
        carousel: { sourcePath: carousel.path, sha256: carousel.sha256 }, concept, assets: [],
      }));
      return {
        schemaVersion: 1, kind: raw.kind, copyDeliveryRef: raw.copyDeliveryRef, conceptRef: updated.artifacts.concept,
        visualObject: raw.visualObject, messageRelation: raw.messageRelation, justification: raw.justification,
        requiredElements: raw.requiredElements, forbiddenElements: raw.forbiddenElements,
      };
    }
    const saved = await inputs.get(request.brandId, request.runId);
    if (!saved?.artifacts.carousel || !saved.artifacts.concept) fail('INPUTS_REQUIRED', 'Copy e conceito persistidos são necessários para o Layout.');
    const run = db.prepare('SELECT snapshot_json,snapshot_hash FROM runs WHERE brand_id=? AND id=?').get(request.brandId, request.runId);
    if (!run) fail('RUN_NOT_FOUND', 'Execução não encontrada.');
    const snapshot = JSON.parse(run.snapshot_json);
    const resources = await loadQualifiedQualityResources({ packageRoot: effectivePackageRoot, snapshot });
    const writer = await createRunInputs({ root, db, packageRoot: effectivePackageRoot, qualifications: resources.qualifications });
    const previousPlan = latestArtifact(request.brandId, request.runId, 'composition-plan');
    const version = (previousPlan?.version ?? 0) + 1;
    const plan = {
      ...clone(raw.plan), id: randomUUID(), brandId: request.brandId, runId: request.runId, version,
      snapshotHash: run.snapshot_hash, carouselRef: saved.artifacts.carousel, conceptRef: saved.artifacts.concept,
      copyFingerprint: saved.fingerprints['copy-approval'], assets: saved.artifacts.assets,
      change: { kind: previousPlan ? 'material' : 'initial', previousPlanRef: previousPlan ? reference(previousPlan) : null, correctionEpisodeRef: null },
    };
    plan.slides = plan.slides.map(slide => {
      const qualification = resources.qualifications.find(item => item.definition.layoutId === slide.layoutId);
      if (!qualification) fail('LAYOUT_NOT_QUALIFIED', 'Layout escolhido não pertence ao catálogo congelado.');
      return {
        ...slide,
        qualificationRef: {
          id: qualification.id, version: qualification.version,
          sha256: canonicalHash(qualification), definitionHash: qualification.definitionHash,
        },
      };
    });
    const ready = await writer.savePlan({
      requestId: `${request.requestId}:plan`, brandId: request.brandId, runId: request.runId,
      expectedVersion: runVersion(request.brandId, request.runId), plan,
    });
    return {
      schemaVersion: 1, kind: raw.kind, artDirectionRef: raw.artDirectionRef,
      compositionPlanRef: ready.artifacts.plan, hierarchyDecision: raw.hierarchyDecision,
      fontDecision: raw.fontDecision, placementDecision: raw.placementDecision,
    };
  }

  async function persistProtocolDelivery({ requestId, brandId, runId, assignment: current, output, submittedOutput = output }) {
    const role = current.role;
    const contextFingerprint = current.contextFingerprint;
    const existing = artifactRow(brandId, runId, role, contextFingerprint);
    if (existing) {
      const saved = await readDelivery(existing);
      if (canonicalHash(saved.output) !== canonicalHash(output)) fail('EDITORIAL_STAGE_CONFLICT', 'Atribuição editorial já recebeu outra entrega.');
      return saved;
    }
    const latest = artifactRow(brandId, runId, role);
    const version = (latest?.version ?? 0) + 1;
    const id = randomUUID();
    const dependencies = current.context.dependencies;
    const value = {
      schemaVersion: 2, id, brandId, runId, owner: role, status: 'completed', task: current.task,
      version, contextFingerprint, dependencies: dependencies.map(item => item.artifactRef), output,
      createdAt: new Date().toISOString(),
    };
    const bytes = Buffer.from(canonicalJson(value));
    const staged = await stageBytes(guard, bytes, { hooks, sleep });
    const actual = await guard.withPaths([staged], hashFile);
    const relativePath = `runs/${brandId}/${runId}/${randomUUID()}/${id}.bin`;
    await promoteFile(guard, staged, relativePath, { hooks, sleep });
    const artifactRef = { id, kind: deliveryKind(role), version, sha256: actual.sha256 };
    const delivery = Object.freeze({ ...value, artifactRef });
    const result = Object.freeze({ status: 'completed', delivery });
    const operation = {
      requestId, brandId, runId, operation: 'editorial.submit',
      payload: { assignmentId: current.id, output: submittedOutput },
    };
    return runOperation(db, operation, () => {
      if (artifactRow(brandId, runId, role, contextFingerprint)) fail('EDITORIAL_STAGE_CONFLICT', 'Outro responsável concluiu esta atribuição editorial.');
      db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, brandId, runId, artifactRef.kind, version, actual.sha256, relativePath, canonicalJson({
          size: actual.size, owner: role, status: 'completed', contextFingerprint,
          outputHash: canonicalHash(output), dependenciesHash: canonicalHash(value.dependencies),
        }));
      return { status: 'committed', result };
    });
  }

  async function next(input) {
    const request = clone(input);
    exactKeys(request, ['requestId', 'brandId', 'runId'], ['request']);
    string(request.requestId, 'requestId editorial inválido.');
    scope(request);
    verifySchema(db);
    await persistEditorialRequest(request);
    const current = await currentProtocolAssignment(request.brandId, request.runId, request.requestId);
    return current?.id ? Object.freeze({ status: 'assignment', assignment: current }) : current;
  }

  async function submit(input) {
    const request = clone(input);
    exactKeys(request, ['requestId', 'brandId', 'runId', 'assignmentId', 'output']);
    string(request.requestId, 'requestId editorial inválido.');
    string(request.assignmentId, 'assignmentId editorial inválido.');
    scope(request);
    verifySchema(db);
    const operation = { requestId: request.requestId, brandId: request.brandId, runId: request.runId, operation: 'editorial.submit', payload: { assignmentId: request.assignmentId, output: request.output } };
    const prepare = Symbol('prepare');
    try { return runOperation(db, operation, () => { throw prepare; }); }
    catch (error) { if (error !== prepare) throw error; }
    const current = await currentProtocolAssignment(request.brandId, request.runId, request.requestId);
    if (!current?.id) fail('EDITORIAL_ASSIGNMENT_STALE', 'A execução está aguardando um gate humano.');
    if (current.id !== request.assignmentId) fail('EDITORIAL_ASSIGNMENT_STALE', 'Atribuição editorial não é mais a etapa vigente.');
    const submittedOutput = validateProtocolSubmission(current, request.output);
    const output = await materializeProtocolOutput(request, current, submittedOutput);
    return persistProtocolDelivery({ ...request, assignment: current, output, submittedOutput });
  }

  async function deliveries(brandId, runId) {
    const result = [];
    for (const role of deliveryOrder) {
      const row = artifactRow(brandId, runId, role);
      if (row) result.push(await readDelivery(row));
    }
    return result;
  }

  async function executeRole({ requestId, brandId, runId, role, task, context, dependencies, outputContext }) {
    const operation = {
      requestId: `${requestId}:${role}`,
      brandId,
      runId,
      operation: 'editorial.role.complete',
      payload: { role, task, context: clone(context), dependencies: dependencies.map(item => item.artifactRef) },
    };
    const prepare = Symbol('prepare');
    try {
      const replay = runOperation(db, operation, () => { throw prepare; });
      const row = db.prepare('SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND id=?').get(brandId, runId, replay.artifactRef.id);
      if (!row) fail('ARTIFACT_NOT_FOUND', 'Entrega editorial idempotente não foi encontrada.');
      const saved = await readDelivery(row);
      if (canonicalHash(saved) !== canonicalHash(replay)) fail('ARTIFACT_HASH_MISMATCH', 'Replay editorial diverge da entrega persistida.');
      return saved;
    } catch (error) {
      if (error !== prepare) throw error;
    }

    const existing = artifactRow(brandId, runId, role);
    if (existing) return readDelivery(existing);
    const handler = roles[role];
    const output = validateOutput(role, await handler(Object.freeze(clone(context))), outputContext);
    const id = randomUUID();
    const value = {
      schemaVersion: 1,
      id,
      brandId,
      runId,
      owner: role,
      status: 'completed',
      task,
      dependencies: dependencies.map(item => item.artifactRef),
      output,
      createdAt: new Date().toISOString(),
    };
    const bytes = Buffer.from(canonicalJson(value));
    const staged = await stageBytes(guard, bytes, { hooks, sleep });
    const actual = await guard.withPaths([staged], hashFile);
    if (actual.sha256 !== canonicalHash(value)) fail('ARTIFACT_HASH_MISMATCH', 'Entrega editorial gerada diverge do envelope.');
    const relativePath = `runs/${brandId}/${runId}/${randomUUID()}/${id}.bin`;
    await promoteFile(guard, staged, relativePath, { hooks, sleep });
    const published = await guard.withPaths([relativePath], hashFile);
    if (published.sha256 !== actual.sha256 || published.size !== actual.size) fail('ARTIFACT_HASH_MISMATCH', 'Publicação editorial diverge da entrega gerada.');
    const artifactRef = { id, kind: deliveryKind(role), version: 1, sha256: actual.sha256 };
    const result = Object.freeze({ ...value, artifactRef });
    return runOperation(db, operation, () => {
      verifySchema(db);
      const run = db.prepare('SELECT id FROM runs WHERE brand_id=? AND id=?').get(brandId, runId);
      if (!run) fail('RUN_NOT_FOUND', 'Execução não encontrada.');
      if (db.prepare('SELECT status FROM brands WHERE id=?').get(brandId)?.status !== 'active') fail('BRAND_ARCHIVED', 'Marca arquivada.');
      if (artifactRow(brandId, runId, role)) fail('EDITORIAL_STAGE_CONFLICT', 'Outro responsável concluiu esta entrega editorial.');
      for (const dependency of dependencies) {
        const row = db.prepare('SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND id=?').get(brandId, runId, dependency.artifactRef.id);
        if (!row || !sameReference(reference(row), dependency.artifactRef)) fail('EDITORIAL_STAGE_CONFLICT', 'Dependência editorial mudou durante a entrega.');
      }
      db.prepare('INSERT INTO artifacts(id,brand_id,run_id,kind,version,hash,relative_path,metadata_json) VALUES(?,?,?,?,1,?,?,?)')
        .run(id, brandId, runId, artifactRef.kind, actual.sha256, relativePath, canonicalJson({
          size: actual.size,
          owner: role,
          status: 'completed',
          outputHash: canonicalHash(output),
          dependenciesHash: canonicalHash(value.dependencies),
        }));
      return { status: 'committed', result };
    });
  }

  async function getState(input) {
    const request = clone(input);
    exactKeys(request, ['brandId', 'runId']);
    scope(request);
    verifySchema(db);
    if (!db.prepare('SELECT 1 FROM runs WHERE brand_id=? AND id=?').get(request.brandId, request.runId)) fail('RUN_NOT_FOUND', 'Execução não encontrada.');
    const savedDeliveries = await deliveries(request.brandId, request.runId);
    const pending = db.prepare("SELECT id,kind FROM confirmation_requests WHERE brand_id=? AND run_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1")
      .get(request.brandId, request.runId);
    let approval = null;
    if (pending?.kind.startsWith('review-')) {
      const operation = db.prepare("SELECT result_json FROM operations WHERE brand_id=? AND run_id=? AND operation='run.quality-review.request' ORDER BY committed_at DESC")
        .all(request.brandId, request.runId).map(row => JSON.parse(row.result_json)).find(result => result.proposal?.confirmationRequestId === pending.id);
      if (!operation) fail('QUALITY_EVIDENCE_STALE', 'Pedido de revisão humana não possui operação persistida.');
      approval = operation;
    } else if (pending) approval = await approvals.get({ ...request, confirmationRequestId: pending.id });
    const gate = pending ? ({ copy: 'text-approval', concept: 'concept-approval', 'creative-assets': 'image-approval', preview: 'preview-approval', 'review-preview': 'qa-review', 'review-final': 'qa-review' }[pending.kind] ?? 'human-approval') : null;
    return Object.freeze({
      status: approval?.status === 'pending' ? pending.kind.startsWith('review-') ? 'waiting-human-review' : 'waiting-human-approval' : savedDeliveries.some(item => item.owner === 'layout-designer') ? 'ready-for-render' : 'in-progress',
      gate,
      deliveries: savedDeliveries,
      approval,
    });
  }

  async function runToTextGate(input) {
    const request = clone(input);
    exactKeys(request, ['requestId', 'brandId', 'runId', 'request']);
    string(request.requestId, 'requestId editorial inválido.');
    scope(request);
    request.request = validateRequest(request.request);
    assertTeam();
    const current = await inputs.get(request.brandId, request.runId);
    if (!current?.inputsComplete || !current.artifacts.carousel) fail('INPUTS_REQUIRED', 'Copy persistida é necessária para a coordenação editorial.');
    const editor = await executeRole({
      ...request,
      role: 'editor-chief',
      task: 'define-brief',
      dependencies: [],
      context: { role: 'editor-chief', task: 'define-brief', assignment: assignment('editor-chief', 'define-brief'), scope: { brandId: request.brandId, runId: request.runId }, request: request.request, dependencies: [] },
    });
    await executeRole({
      ...request,
      role: 'copywriter',
      task: 'bind-copy-to-brief',
      dependencies: [editor],
      context: { role: 'copywriter', task: 'bind-copy-to-brief', assignment: assignment('copywriter', 'bind-copy-to-brief'), scope: { brandId: request.brandId, runId: request.runId }, dependencies: [editor], currentCopyRef: current.artifacts.carousel },
      outputContext: { briefRef: editor.artifactRef, copyRef: current.artifacts.carousel },
    });
    await approvals.request({ requestId: `${request.requestId}:text-approval`, brandId: request.brandId, runId: request.runId, kind: 'copy' });
    return getState({ brandId: request.brandId, runId: request.runId });
  }

  const approvalSummary = approval => ({
    id: approval.id,
    kind: approval.kind,
    decision: approval.decision,
    objectFingerprint: approval.objectFingerprint,
    objectArtifactRef: approval.objectArtifactRef,
    confirmationRequestId: approval.confirmationRequestId,
    decidedAt: approval.decidedAt,
  });

  async function runToConceptGate(input) {
    const request = clone(input);
    exactKeys(request, ['requestId', 'brandId', 'runId']);
    string(request.requestId, 'requestId editorial inválido.');
    scope(request);
    assertTeam();
    const copyApproval = approvalSummary(await approvals.verify({ brandId: request.brandId, runId: request.runId, kind: 'copy' }));
    const saved = await inputs.get(request.brandId, request.runId);
    if (!saved?.inputsComplete || !saved.artifacts.concept) fail('INPUTS_REQUIRED', 'Conceito persistido é necessário para a direção de arte.');
    const currentDeliveries = await deliveries(request.brandId, request.runId);
    const copy = currentDeliveries.find(item => item.owner === 'copywriter');
    if (!copy) fail('EDITORIAL_STAGE_REQUIRED', 'Entrega de Copy é necessária antes da Direção de Arte.');
    await executeRole({
      ...request,
      role: 'art-director',
      task: 'define-art-direction',
      dependencies: [copy],
      context: { role: 'art-director', task: 'define-art-direction', assignment: assignment('art-director', 'define-art-direction'), scope: { brandId: request.brandId, runId: request.runId }, dependencies: [copy], copyApproval, currentConceptRef: saved.artifacts.concept },
      outputContext: { briefRef: copy.artifactRef, copyRef: saved.artifacts.concept },
    });
    await approvals.request({ requestId: `${request.requestId}:concept-approval`, brandId: request.brandId, runId: request.runId, kind: 'concept' });
    return getState({ brandId: request.brandId, runId: request.runId });
  }

  async function runToLayout(input) {
    const request = clone(input);
    exactKeys(request, ['requestId', 'brandId', 'runId']);
    string(request.requestId, 'requestId editorial inválido.');
    scope(request);
    assertTeam();
    await approvals.verify({ brandId: request.brandId, runId: request.runId, kind: 'copy' });
    const conceptApproval = approvalSummary(await approvals.verify({ brandId: request.brandId, runId: request.runId, kind: 'concept' }));
    const assets = await approvals.request({ requestId: `${request.requestId}:assets-approval`, brandId: request.brandId, runId: request.runId, kind: 'creative-assets' });
    if (assets.status === 'pending') return getState({ brandId: request.brandId, runId: request.runId });
    const saved = await inputs.get(request.brandId, request.runId);
    if (!saved?.inputsComplete || !saved.artifacts.plan) fail('INPUTS_REQUIRED', 'Plano de composição persistido é necessário para o Layout.');
    const currentDeliveries = await deliveries(request.brandId, request.runId);
    const direction = currentDeliveries.find(item => item.owner === 'art-director');
    if (!direction) fail('EDITORIAL_STAGE_REQUIRED', 'Direção de Arte é necessária antes do Layout.');
    await executeRole({
      ...request,
      role: 'layout-designer',
      task: 'bind-qualified-layout',
      dependencies: [direction],
      context: { role: 'layout-designer', task: 'bind-qualified-layout', assignment: assignment('layout-designer', 'bind-qualified-layout'), scope: { brandId: request.brandId, runId: request.runId }, dependencies: [direction], conceptApproval, currentPlanRef: saved.artifacts.plan },
      outputContext: { briefRef: direction.artifactRef, copyRef: saved.artifacts.plan },
    });
    return getState({ brandId: request.brandId, runId: request.runId });
  }

  async function runToQaGate(input) {
    const request = clone(input);
    exactKeys(request, ['requestId', 'brandId', 'runId']);
    string(request.requestId, 'requestId editorial inválido.');
    scope(request);
    assertTeam();
    const saved = await inputs.get(request.brandId, request.runId);
    if (!saved?.inputsComplete || !saved.artifacts.plan) fail('INPUTS_REQUIRED', 'Plano vigente é necessário para Produção e QA.');
    const currentDeliveries = await deliveries(request.brandId, request.runId);
    const layout = currentDeliveries.find(item => item.owner === 'layout-designer');
    if (!layout) fail('EDITORIAL_STAGE_REQUIRED', 'Layout é necessário antes da Produção.');
    const production = await executeRole({
      ...request,
      role: 'production-manager',
      task: 'authorize-preview-render',
      dependencies: [layout],
      context: { role: 'production-manager', task: 'authorize-preview-render', assignment: assignment('production-manager', 'authorize-preview-render'), scope: { brandId: request.brandId, runId: request.runId }, dependencies: [layout], currentPlanRef: saved.artifacts.plan, automaticAttemptLimit: 2 },
      outputContext: { briefRef: layout.artifactRef, copyRef: saved.artifacts.plan },
    });
    const { createRenderStage } = await loadPackageModule('src/application/stages/render-stage.mjs');
    const render = await createRenderStage({ root, db, packageRoot: effectivePackageRoot });
    const rendered = await render.execute({ requestId: `${request.requestId}:preview-render`, brandId: request.brandId, runId: request.runId, kind: 'preview' });
    const manifestFile = await inputs.resolveArtifact(request.brandId, request.runId, rendered.manifestRef.id);
    const manifest = JSON.parse(await readFile(manifestFile.path, 'utf8'));
    const { createQualityReview } = await loadPackageModule('src/application/quality-review.mjs');
    const review = await createQualityReview({ root, db, packageRoot: effectivePackageRoot });
    const pending = await review.request({ requestId: `${request.requestId}:qa-review`, brandId: request.brandId, runId: request.runId, kind: 'preview', manifestId: rendered.manifestRef.id });
    const planFile = await inputs.resolveArtifact(request.brandId, request.runId, saved.artifacts.plan.id);
    const contract = JSON.parse(await readFile(planFile.path, 'utf8'));
    const files = [];
    for (const file of manifest.files) {
      const resolved = await inputs.resolveArtifact(request.brandId, request.runId, file.artifactRef.id);
      files.push({ ...file, path: resolved.path });
    }
    await executeRole({
      ...request,
      role: 'quality-reviewer',
      task: 'inspect-preview',
      dependencies: [production],
      context: {
        role: 'quality-reviewer',
        task: 'inspect-preview',
        assignment: assignment('quality-reviewer', 'inspect-preview'),
        scope: { brandId: request.brandId, runId: request.runId },
        dependencies: [production],
        manifestRef: rendered.manifestRef,
        currentPlanRef: saved.artifacts.plan,
        contract,
        files,
        automaticEvidenceRef: pending.proposal.objectiveReportRef,
        evidencePolicy: { automatic: 'persisted', agentVisual: 'must-be-explicit', humanReview: 'required-separate' },
      },
      outputContext: { briefRef: production.artifactRef, copyRef: saved.artifacts.plan, manifestRef: rendered.manifestRef, automaticEvidenceRef: pending.proposal.objectiveReportRef },
    });
    return getState({ brandId: request.brandId, runId: request.runId });
  }

  return Object.freeze({ next, submit, runToTextGate, runToConceptGate, runToLayout, runToQaGate, getState });
}
