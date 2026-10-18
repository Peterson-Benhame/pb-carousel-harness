import path from 'node:path';
import { invalidArgument, PublicError } from '../../domain/errors.mjs';
import { runDoctor } from '../../application/doctor.mjs';
import { createBrandMemory } from '../../application/brand-memory.mjs';
import { exactKeys } from '../../domain/brand-schema.mjs';
import { canonicalHash, canonicalJson } from '../../domain/canonical-json.mjs';
import { resolveWorkspaceRoot } from '../../infrastructure/fs/workspace-paths.mjs';
import { initializeWorkspace, openWorkspace } from '../../infrastructure/sqlite/database.mjs';
import { confirmApprovalProposal, confirmBrandProposal, confirmQualityReviewProposal } from '../cli/human-confirmation.mjs';

const COMMANDS = new Set([
  'doctor', 'init',
  'brand.apply', 'brand.get', 'brand.list',
  'run.create', 'run.get', 'run.list', 'run.runtime',
  'input.save', 'plan.save',
  'approval.request', 'approval.get', 'approval.decide', 'approval.verify',
  'editorial.next', 'editorial.submit',
  'preview', 'render.final', 'validate', 'review.apply', 'package',
]);
const READONLY = new Set(['brand.get', 'brand.list', 'run.get', 'run.list', 'run.runtime', 'approval.get', 'approval.verify']);
const pluginBridgeCapability = Symbol('plugin-bridge');

async function packageWorkspaceSettings(packageRoot) {
  const { loadResourcesManifest, resolveResources } = await import('../../infrastructure/resources.mjs');
  const manifest = await loadResourcesManifest({ packageRoot });
  const fontRoot = path.join(packageRoot, 'assets', 'fonts');
  const resources = await resolveResources({ manifest, fontRoot });
  if (resources.diagnostics.length) {
    const diagnostic = resources.diagnostics[0];
    throw new PublicError(diagnostic.code, diagnostic.message);
  }
  return {
    fontRoot,
    resourcesJson: canonicalJson({
      schemaVersion: 1,
      resourceManifestRef: {
        id: `resources-manifest@${manifest.schemaVersion}`,
        version: manifest.schemaVersion,
        sha256: canonicalHash(manifest),
      },
    }),
  };
}

function configureWorkspace(db, settings) {
  const existing = db.prepare('SELECT resources_json, authorized_font_directory FROM workspace_settings WHERE singleton=1').get();
  if (!existing) {
    db.prepare('INSERT INTO workspace_settings(singleton, revision, resources_json, authorized_font_directory) VALUES(1, 1, ?, ?)')
      .run(settings.resourcesJson, settings.fontRoot);
    return;
  }
  if (existing.resources_json !== settings.resourcesJson
      || typeof existing.authorized_font_directory !== 'string'
      || path.resolve(existing.authorized_font_directory) !== settings.fontRoot) {
    throw new PublicError('RUNTIME_MISMATCH', 'Configuração local de recursos diverge do pacote explícito.');
  }
}

function configuredPackageResources(db, packageRoot) {
  const row = db.prepare('SELECT resources_json, authorized_font_directory FROM workspace_settings WHERE singleton=1').get();
  const expectedFontRoot = path.join(packageRoot, 'assets', 'fonts');
  let resources;
  try {
    resources = JSON.parse(row?.resources_json);
    exactKeys(resources, ['schemaVersion', 'resourceManifestRef']);
    exactKeys(resources.resourceManifestRef, ['id', 'version', 'sha256']);
  } catch {
    throw new PublicError('RUNTIME_MISMATCH', 'Configuração local de recursos ausente ou inválida.');
  }
  if (resources.schemaVersion !== 1
      || typeof row.authorized_font_directory !== 'string'
      || path.resolve(row.authorized_font_directory) !== expectedFontRoot) {
    throw new PublicError('RUNTIME_MISMATCH', 'Configuração local de recursos diverge do pacote explícito.');
  }
  return { fontRoot: expectedFontRoot, resourceManifestRef: resources.resourceManifestRef };
}

export function resolveLocalContext({ dataDir, packageRoot, env = process.env, cwd = process.cwd() } = {}) {
  if (typeof packageRoot !== 'string' || !path.isAbsolute(packageRoot)) {
    throw invalidArgument('Runtime local exige packageRoot absoluto e explícito.');
  }
  return Object.freeze({
    root: resolveWorkspaceRoot({ dataDir, env, cwd }),
    packageRoot: path.resolve(packageRoot),
  });
}

export function executePluginLocalCommand(options) {
  return executeLocalCommand({ ...options, pluginBridgeCapability });
}

export async function executeLocalCommand({ command, dataDir, packageRoot, input = {}, terminal, env, cwd, pluginBridgeCapability: capability } = {}) {
  const context = resolveLocalContext({ dataDir, packageRoot, env, cwd });
  if (!COMMANDS.has(command)) throw invalidArgument('Comando local não reconhecido.');
  if (command === 'doctor') {
    exactKeys(input, []);
    return runDoctor({ dataDir: context.root, packageRoot: context.packageRoot, plugin: capability === pluginBridgeCapability });
  }
  if (command === 'init') {
    exactKeys(input, [], ['schemaVersion']);
    const settings = await packageWorkspaceSettings(context.packageRoot);
    const db = await initializeWorkspace(context.root, { schemaVersion: input.schemaVersion ?? 1 });
    try {
      configureWorkspace(db, settings);
      return { root: context.root, schemaVersion: db.pragma('user_version', { simple: true }) };
    } finally {
      db.close();
    }
  }
  const db = await openWorkspace(context.root, { readonly: READONLY.has(command) });
  try {
    const memory = createBrandMemory(db);
    if (command === 'brand.apply') {
      exactKeys(input, ['action', 'request']);
      const proposal = memory.propose(input.action, input.request);
      const receipt = await confirmBrandProposal(proposal, terminal);
      return receipt ? memory.commit(proposal, receipt) : { status: 'cancelled', proposal };
    }
    if (command === 'brand.get') {
      exactKeys(input, ['brandId'], ['revision']);
      return memory.get(input.brandId, input.revision);
    }
    if (command === 'brand.list') {
      exactKeys(input, [], ['brandId']);
      return memory.list(input);
    }
    if (command.startsWith('run.') && command !== 'run.runtime') {
      const { createRunService } = await import('../../application/run-service.mjs');
      const options = { dataDir: context.root, packageRoot: context.packageRoot };
      if (command === 'run.create') {
        const settings = configuredPackageResources(db, context.packageRoot);
        options.fontRoot = settings.fontRoot;
        if (db.pragma('user_version', { simple: true }) >= 2) {
          options.qualityResources = async ({ brand, manifest, runtime }) => {
            if (settings.resourceManifestRef.id !== 'resources-manifest@2'
                || settings.resourceManifestRef.version !== 2
                || settings.resourceManifestRef.sha256 !== canonicalHash(manifest)) {
              throw new PublicError('RUNTIME_MISMATCH', 'Manifesto atual diverge da configuração local autorizada.');
            }
            const { loadRunCreationQualityResources } = await import('../../application/quality-resources.mjs');
            return loadRunCreationQualityResources({
              packageRoot: context.packageRoot,
              manifest,
              runtime,
              config: brand.config,
            });
          };
        }
      }
      const service = createRunService(db, options);
      if (command === 'run.create') return await service.create(input);
      if (command === 'run.get') {
        exactKeys(input, ['brandId', 'runId']);
        return service.get(input.brandId, input.runId);
      }
      if (command === 'run.list') {
        exactKeys(input, ['brandId']);
        return service.list(input);
      }
    }
    if (command === 'run.runtime') {
      const { createRunRuntime } = await import('../../application/run-runtime.mjs');
      return await (await createRunRuntime({ root: context.root, db, packageRoot: context.packageRoot })).get(input);
    }
    if (command === 'input.save' || command === 'plan.save') {
      const { createRunInputs } = await import('../../application/run-inputs.mjs');
      const service = await createRunInputs({ root: context.root, db, packageRoot: context.packageRoot });
      return await (command === 'input.save' ? service.save(input) : service.savePlan(input));
    }
    if (command.startsWith('approval.')) {
      const { createApprovals } = await import('../../application/approvals.mjs');
      const service = await createApprovals({ root: context.root, db, packageRoot: context.packageRoot });
      if (command === 'approval.request') return await service.request(input);
      if (command === 'approval.get') return await service.get(input);
      if (command === 'approval.verify') return await service.verify(input);
      exactKeys(input, ['requestId', 'brandId', 'runId', 'confirmationRequestId', 'decision']);
      const pending = await service.get({ brandId: input.brandId, runId: input.runId, confirmationRequestId: input.confirmationRequestId });
      if (!pending.proposal) throw invalidArgument('Pedido de aprovação já resolvido.');
      const receipt = await confirmApprovalProposal(pending.proposal, terminal);
      return receipt
        ? await service.decide({ requestId: input.requestId, proposal: pending.proposal, decision: input.decision }, receipt)
        : { status: 'cancelled', proposal: pending.proposal };
    }
    if (command === 'editorial.next' || command === 'editorial.submit') {
      const { createEditorialWorkflow } = await import('../../application/editorial-workflow.mjs');
      const service = await createEditorialWorkflow({ root: context.root, db, packageRoot: context.packageRoot });
      return await (command === 'editorial.next' ? service.next(input) : service.submit(input));
    }
    if (command === 'preview' || command === 'render.final') {
      exactKeys(input, ['requestId', 'brandId', 'runId']);
      const { createRenderStage } = await import('../../application/stages/render-stage.mjs');
      const service = await createRenderStage({ root: context.root, db, packageRoot: context.packageRoot });
      return await service.execute({ ...input, kind: command === 'preview' ? 'preview' : 'final' });
    }
    if (command === 'validate') {
      const { createValidateStage } = await import('../../application/stages/validate-stage.mjs');
      return await (await createValidateStage({ root: context.root, db, packageRoot: context.packageRoot })).execute(input);
    }
    if (command === 'review.apply') {
      exactKeys(input, ['requestId', 'decisionRequestId', 'brandId', 'runId', 'kind', 'manifestId']);
      const { createQualityReview } = await import('../../application/quality-review.mjs');
      const service = await createQualityReview({ root: context.root, db, packageRoot: context.packageRoot });
      const pending = await service.requestQualityReview({ requestId: input.requestId, brandId: input.brandId, runId: input.runId, kind: input.kind, manifestId: input.manifestId });
      const confirmed = await confirmQualityReviewProposal(pending.proposal, { ...terminal, presentation: pending.presentation });
      return confirmed
        ? await service.decide({ requestId: input.decisionRequestId, proposal: pending.proposal, answers: confirmed.answers }, confirmed.receipt)
        : { status: 'cancelled', proposal: pending.proposal };
    }
    if (command === 'package') {
      const { createPackageStage } = await import('../../application/stages/package-stage.mjs');
      return await (await createPackageStage({ root: context.root, db, packageRoot: context.packageRoot })).execute(input);
    }
  } finally {
    db.close();
  }
  throw invalidArgument('Comando local não reconhecido.');
}
