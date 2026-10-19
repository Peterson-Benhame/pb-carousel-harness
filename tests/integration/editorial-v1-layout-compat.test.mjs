import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { executePluginCommand } from '../../src/interfaces/plugin/bridge.mjs';
import { openWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import { createBrandMemory } from '../../src/application/brand-memory.mjs';
import { createApprovals } from '../../src/application/approvals.mjs';
import { confirmApprovalProposal, confirmBrandProposal } from '../../src/interfaces/cli/human-confirmation.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';
import { compositionFixture } from '../fixtures/quality/composition-fixture.mjs';
import { makeQualityPackage, syntheticTerminal } from '../helpers/quality-service-fixture.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const brandId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const brandConfig = {
  name: 'Synthetic', profile: '@synthetic', language: 'pt-BR', audience: null, voice: null, preferences: [],
  fonts: { title: 'Anton', body: 'Manrope', mono: 'JetBrains Mono' },
  themes: { light: { background: '#ffffff', text: '#000000', muted: '#555555', accent: '#ff0000', topics: [] } },
  logo: { enabled: false, variants: {}, protection: 12, minimumHeight: 24 },
  slideWidth: 1080, slideHeight: 1350, minimumSlideCount: 12, maximumSlideCount: 16, profileImage: '',
};
const request = {
  topic: 'compatibilidade editorial v1', objective: 'salvar', audience: 'fundadores',
  constraints: ['preservar conteúdo e aprovações'],
};
const brief = {
  schemaVersion: 1, kind: 'editorial-brief', centralMessage: 'O fluxo preserva contratos históricos.',
  objective: request.objective, audience: request.audience, constraints: request.constraints,
};

async function normalV1Run(t) {
  const pkg = await runtimeCompatiblePackage(t, { copyFonts: true });
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'editorial-v1-layout '));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await executePluginCommand({ command: 'init', dataDir, packageRoot: pkg.packageRoot });
  const db = await openWorkspace(dataDir, { readonly: false });
  try {
    const memory = createBrandMemory(db);
    const proposal = memory.propose('brand.create', {
      requestId: randomUUID(), brandId, config: brandConfig,
    });
    await memory.commit(proposal, await confirmBrandProposal(proposal, syntheticTerminal()));
  } finally {
    db.close();
  }
  const run = await executePluginCommand({
    command: 'run.create', dataDir, packageRoot: pkg.packageRoot,
    input: { requestId: randomUUID(), brandId, brandRevision: 1, theme: 'light' },
  });
  assert.equal(run.snapshot.contractVersion, 1);
  assert.equal(Object.hasOwn(run.snapshot, 'qualifications'), false);
  return { dataDir, packageRoot: pkg.packageRoot, brandId, runId: run.id };
}

async function approveGate(fixture, pending) {
  const db = await openWorkspace(fixture.dataDir, { readonly: false });
  try {
    const approvals = await createApprovals({ root: fixture.dataDir, db, packageRoot: fixture.packageRoot });
    const receipt = await confirmApprovalProposal(pending.approval.proposal, syntheticTerminal());
    await approvals.decide({
      requestId: randomUUID(), proposal: pending.approval.proposal, decision: 'approved',
    }, receipt);
  } finally {
    db.close();
  }
}

async function runtimeCompatiblePackage(t, { copyFonts = false } = {}) {
  const pkg = await makeQualityPackage(t);
  Object.assign(pkg.manifest.qualifiedRuntime, {
    node: process.version, platform: process.platform, arch: process.arch, abi: process.versions.modules,
  });
  await writeFile(path.join(pkg.packageRoot, 'shared', 'resources.manifest.json'), JSON.stringify(pkg.manifest, null, 2));
  pkg.input.resourceManifestRef.sha256 = canonicalHash(pkg.manifest);
  if (copyFonts) {
    const fontRoot = path.join(pkg.packageRoot, 'assets', 'fonts');
    await mkdir(fontRoot, { recursive: true });
    for (const font of pkg.manifest.fonts) {
      await writeFile(path.join(fontRoot, font.file), await readFile(path.join(packageRoot, 'assets', 'fonts', font.file)));
    }
  }
  return pkg;
}

async function normalQualifiedV2Run(t) {
  const pkg = await runtimeCompatiblePackage(t, { copyFonts: true });
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'editorial-v2-layout '));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await executePluginCommand({ command: 'init', dataDir, packageRoot: pkg.packageRoot, input: { schemaVersion: 2 } });
  const qualifiedBrandId = pkg.input.brand.brandId;
  const db = await openWorkspace(dataDir, { readonly: false });
  try {
    const memory = createBrandMemory(db);
    const proposal = memory.propose('brand.create', {
      requestId: randomUUID(), brandId: qualifiedBrandId, config: pkg.input.brand.config,
    });
    await memory.commit(proposal, await confirmBrandProposal(proposal, syntheticTerminal()));
  } finally {
    db.close();
  }
  const run = await executePluginCommand({
    command: 'run.create', dataDir, packageRoot: pkg.packageRoot,
    input: { requestId: randomUUID(), brandId: qualifiedBrandId, brandRevision: 1, theme: pkg.input.theme },
  });
  assert.equal(run.snapshot.contractVersion, 2);
  assert.ok(run.snapshot.qualifications.length > 0);
  return {
    dataDir, packageRoot: pkg.packageRoot, brandId: qualifiedBrandId, runId: run.id,
    snapshot: run.snapshot, execute: executePluginCommand,
  };
}

test('normal v1 run reports derivation requirement at Layout without serializing absent qualifications', async t => {
  const fixture = await normalV1Run(t);
  const scope = { brandId: fixture.brandId, runId: fixture.runId };
  const material = await compositionFixture(3);
  material.carousel.theme = 'light';

  const editor = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope, request },
  });
  const editorSaved = await executePluginCommand({
    command: 'editorial.submit', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope, assignmentId: editor.assignment.id, output: brief },
  });
  const copy = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  const copySaved = await executePluginCommand({
    command: 'editorial.submit', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: {
      requestId: randomUUID(), ...scope, assignmentId: copy.assignment.id,
      output: {
        schemaVersion: 1, kind: 'carousel-copy', briefRef: editorSaved.delivery.artifactRef,
        carousel: material.carousel, note: 'Copy sintética do teste de compatibilidade.',
      },
    },
  });
  const textGate = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  await approveGate(fixture, textGate);
  const art = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  await executePluginCommand({
    command: 'editorial.submit', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: {
      requestId: randomUUID(), ...scope, assignmentId: art.assignment.id,
      output: {
        schemaVersion: 1, kind: 'art-direction', copyDeliveryRef: copySaved.delivery.artifactRef,
        concept: 'Mapa das hipoteses', visualObject: 'diagrama', messageRelation: 'conecta decisoes',
        justification: 'clareza', requiredElements: ['mapa'], forbiddenElements: ['decoracao'],
      },
    },
  });
  const conceptGate = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  await approveGate(fixture, conceptGate);

  await assert.rejects(
    executePluginCommand({
      command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
      input: { requestId: randomUUID(), ...scope },
    }),
    { code: 'RUN_DERIVATION_REQUIRED' },
  );

  const db = await openWorkspace(fixture.dataDir, { readonly: true });
  try {
    assert.equal(db.prepare("SELECT count(*) n FROM artifacts WHERE run_id=? AND kind='composition-plan'").get(scope.runId).n, 0);
  } finally {
    db.close();
  }
});

test('normal qualified v2 run reaches Layout assignment without entering Production', async t => {
  const fixture = await normalQualifiedV2Run(t);
  const scope = { brandId: fixture.brandId, runId: fixture.runId };
  const material = await compositionFixture(3);
  const execute = input => fixture.execute({ ...input, dataDir: fixture.dataDir, packageRoot: fixture.packageRoot });

  const editor = await execute({
    command: 'editorial.next', input: { requestId: randomUUID(), ...scope, request },
  });
  const editorSaved = await execute({
    command: 'editorial.submit',
    input: { requestId: randomUUID(), ...scope, assignmentId: editor.assignment.id, output: brief },
  });
  const copy = await execute({
    command: 'editorial.next', input: { requestId: randomUUID(), ...scope },
  });
  const copySaved = await execute({
    command: 'editorial.submit',
    input: {
      requestId: randomUUID(), ...scope, assignmentId: copy.assignment.id,
      output: {
        schemaVersion: 1, kind: 'carousel-copy', briefRef: editorSaved.delivery.artifactRef,
        carousel: material.carousel, note: 'Copy sintética do teste positivo de Layout.',
      },
    },
  });
  const textGate = await execute({
    command: 'editorial.next', input: { requestId: randomUUID(), ...scope },
  });
  await approveGate(fixture, textGate);
  const art = await execute({
    command: 'editorial.next', input: { requestId: randomUUID(), ...scope },
  });
  await execute({
    command: 'editorial.submit',
    input: {
      requestId: randomUUID(), ...scope, assignmentId: art.assignment.id,
      output: {
        schemaVersion: 1, kind: 'art-direction', copyDeliveryRef: copySaved.delivery.artifactRef,
        concept: 'Mapa das hipoteses', visualObject: 'diagrama', messageRelation: 'conecta decisoes',
        justification: 'clareza', requiredElements: ['mapa'], forbiddenElements: ['decoracao'],
      },
    },
  });
  const conceptGate = await execute({
    command: 'editorial.next', input: { requestId: randomUUID(), ...scope },
  });
  await approveGate(fixture, conceptGate);

  const layout = await execute({
    command: 'editorial.next', input: { requestId: randomUUID(), ...scope },
  });
  assert.equal(layout.status, 'assignment');
  assert.equal(layout.assignment.role, 'layout-designer');
  assert.deepEqual(layout.assignment.context.qualificationRefs, fixture.snapshot.qualifications);

  const db = await openWorkspace(fixture.dataDir, { readonly: true });
  try {
    assert.equal(db.prepare("SELECT count(*) n FROM artifacts WHERE run_id=? AND kind='composition-plan'").get(scope.runId).n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM artifacts WHERE run_id=? AND kind LIKE 'render-%'").get(scope.runId).n, 0);
  } finally {
    db.close();
  }
});
