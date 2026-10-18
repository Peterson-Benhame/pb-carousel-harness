import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { executePluginCommand } from '../../src/interfaces/plugin/bridge.mjs';
import { initializeWorkspace, openWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import { canonicalHash, canonicalJson } from '../../src/domain/canonical-json.mjs';
import { makeQualityPackage, syntheticTerminal } from '../helpers/quality-service-fixture.mjs';
import { compositionFixture } from '../fixtures/quality/composition-fixture.mjs';
import { createApprovals } from '../../src/application/approvals.mjs';
import { confirmApprovalProposal } from '../../src/interfaces/cli/human-confirmation.mjs';

async function blankRunFixture(t) {
  const pkg = await makeQualityPackage(t);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'editorial-plugin-flow '));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brandId = pkg.snapshot.brand.id;
  const runId = randomUUID();
  const db = await initializeWorkspace(dataDir, { schemaVersion: 2 });
  try {
    db.prepare('INSERT INTO brands(id) VALUES(?)').run(brandId);
    db.prepare("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES(?,1,?,?,'user-confirmed')")
      .run(brandId, canonicalJson(pkg.snapshot.brand.config), pkg.snapshot.brand.revisionHash);
    db.prepare('UPDATE brands SET current_revision=1 WHERE id=?').run(brandId);
    db.prepare('INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES(?,?,1,?,?)')
      .run(runId, brandId, canonicalJson(pkg.snapshot), canonicalHash(pkg.snapshot));
  } finally {
    db.close();
  }
  return { ...pkg, dataDir, brandId, runId };
}

const request = {
  topic: 'coordenação editorial verificável',
  objective: 'salvar',
  audience: 'desenvolvedores e empreendedores',
  constraints: ['não inventar aprovação', 'preservar a copy depois do gate'],
};

const brief = {
  schemaVersion: 1,
  kind: 'editorial-brief',
  centralMessage: 'Uma cadeia editorial só é confiável quando cada entrega nasce da anterior.',
  objective: request.objective,
  audience: request.audience,
  constraints: request.constraints,
};

async function approveGate(fixture, pending) {
  const db = await openWorkspace(fixture.dataDir, { readonly: false });
  try {
    const service = await createApprovals({ root: fixture.dataDir, db, packageRoot: fixture.packageRoot });
    const receipt = await confirmApprovalProposal(pending.approval.proposal, syntheticTerminal());
    return await service.decide({ requestId: randomUUID(), proposal: pending.approval.proposal, decision: 'approved' }, receipt);
  } finally {
    db.close();
  }
}

test('plugin starts an empty run with server-derived next/submit assignments', async t => {
  const fixture = await blankRunFixture(t);
  const scope = { brandId: fixture.brandId, runId: fixture.runId };
  const first = await executePluginCommand({
    command: 'editorial.next',
    dataDir: fixture.dataDir,
    packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope, request },
  });

  assert.equal(first.status, 'assignment');
  assert.equal(first.assignment.role, 'editor-chief');
  assert.equal(first.assignment.task, 'define-brief');
  assert.deepEqual(first.assignment.context.request, request);
  assert.equal(Object.hasOwn(first.assignment, 'output'), false);

  const before = await openWorkspace(fixture.dataDir, { readonly: true });
  try {
    assert.equal(before.prepare("SELECT count(*) total FROM artifacts WHERE run_id=? AND kind IN ('carousel','concept','composition-plan')").get(scope.runId).total, 0);
  } finally {
    before.close();
  }

  const submission = {
    requestId: randomUUID(),
    ...scope,
    assignmentId: first.assignment.id,
    output: brief,
  };
  const committed = await executePluginCommand({
    command: 'editorial.submit',
    dataDir: fixture.dataDir,
    packageRoot: fixture.packageRoot,
    input: submission,
  });
  assert.equal(committed.status, 'completed');
  assert.equal(committed.delivery.owner, 'editor-chief');
  assert.equal(committed.delivery.version, 1);

  const replay = await executePluginCommand({
    command: 'editorial.submit',
    dataDir: fixture.dataDir,
    packageRoot: fixture.packageRoot,
    input: submission,
  });
  assert.deepEqual(replay, committed);
  await assert.rejects(
    executePluginCommand({
      command: 'editorial.submit', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
      input: { ...submission, output: { ...brief, centralMessage: 'Replay divergente não pode substituir a entrega.' } },
    }),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );

  const second = await executePluginCommand({
    command: 'editorial.next',
    dataDir: fixture.dataDir,
    packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  assert.equal(second.status, 'assignment');
  assert.equal(second.assignment.role, 'copywriter');
  assert.deepEqual(second.assignment.context.dependencies, [committed.delivery]);

  await assert.rejects(
    executePluginCommand({
      command: 'editorial.submit',
      dataDir: fixture.dataDir,
      packageRoot: fixture.packageRoot,
      input: { ...submission, requestId: randomUUID(), role: 'copywriter' },
    }),
    { code: 'INVALID_ARGUMENT' },
  );
  await assert.rejects(
    executePluginCommand({
      command: 'editorial.submit',
      dataDir: fixture.dataDir,
      packageRoot: fixture.packageRoot,
      input: { ...submission, requestId: randomUUID() },
    }),
    { code: 'EDITORIAL_ASSIGNMENT_STALE' },
  );

  const revisedRequest = { ...request, topic: 'coordenação editorial revisada' };
  const revised = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope, request: revisedRequest },
  });
  assert.equal(revised.assignment.role, 'editor-chief');
  assert.notEqual(revised.assignment.id, first.assignment.id);
  const revisedBrief = { ...brief, centralMessage: 'Uma nova pauta precisa de uma nova cadeia editorial.' };
  const revisedSaved = await executePluginCommand({
    command: 'editorial.submit', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope, assignmentId: revised.assignment.id, output: revisedBrief },
  });
  assert.equal(revisedSaved.delivery.version, 2);
  const revisedCopy = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  assert.equal(revisedCopy.assignment.role, 'copywriter');
  assert.notEqual(revisedCopy.assignment.id, second.assignment.id);
});

test('copy and concept gates block later roles before layout persists the completed inputs', async t => {
  const fixture = await blankRunFixture(t);
  const scope = { brandId: fixture.brandId, runId: fixture.runId };
  const material = await compositionFixture(3);

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
        carousel: material.carousel, note: 'Conteúdo sintético produzido pelo papel Copy no teste.',
      },
    },
  });
  assert.equal(copySaved.delivery.output.carouselRef.kind, 'carousel');

  const textGate = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  assert.equal(textGate.status, 'waiting-human-approval');
  assert.equal(textGate.gate, 'text-approval');
  assert.equal(textGate.approval.status, 'pending');
  await approveGate(fixture, textGate);

  const art = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  assert.equal(art.assignment.role, 'art-director');
  const artSaved = await executePluginCommand({
    command: 'editorial.submit', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: {
      requestId: randomUUID(), ...scope, assignmentId: art.assignment.id,
      output: {
        schemaVersion: 1, kind: 'art-direction', copyDeliveryRef: copySaved.delivery.artifactRef,
        concept: 'Fluxo editorial representado por uma cadeia de handoffs verificáveis.',
        visualObject: 'cadeia de decisões', messageRelation: 'cada elo corresponde a uma entrega persistida',
        justification: 'torna responsabilidade e ordem visíveis',
        requiredElements: ['hierarquia editorial'], forbiddenElements: ['decoração sem função'],
      },
    },
  });
  assert.equal(artSaved.delivery.output.conceptRef.kind, 'concept');

  const conceptGate = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  assert.equal(conceptGate.status, 'waiting-human-approval');
  assert.equal(conceptGate.gate, 'concept-approval');
  assert.equal(conceptGate.approval.status, 'pending');
  await approveGate(fixture, conceptGate);

  const layout = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  assert.equal(layout.assignment.role, 'layout-designer');
  const layoutSaved = await executePluginCommand({
    command: 'editorial.submit', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: {
      requestId: randomUUID(), ...scope, assignmentId: layout.assignment.id,
      output: {
        schemaVersion: 1, kind: 'layout-plan', artDirectionRef: artSaved.delivery.artifactRef,
        plan: material.plan, hierarchyDecision: 'usar as regiões tipográficas qualificadas',
        fontDecision: 'preservar os bindings do snapshot', placementDecision: 'respeitar regiões e continuidade declaradas',
      },
    },
  });
  assert.equal(layoutSaved.delivery.output.compositionPlanRef.kind, 'composition-plan');

  const production = await executePluginCommand({
    command: 'editorial.next', dataDir: fixture.dataDir, packageRoot: fixture.packageRoot,
    input: { requestId: randomUUID(), ...scope },
  });
  assert.equal(production.status, 'assignment');
  assert.equal(production.assignment.role, 'production-manager');

  const db = await openWorkspace(fixture.dataDir, { readonly: true });
  try {
    assert.deepEqual(
      db.prepare("SELECT kind,count(*) total FROM artifacts WHERE run_id=? AND kind IN ('carousel','concept','composition-plan') GROUP BY kind ORDER BY kind").all(scope.runId),
      [
        { kind: 'carousel', total: 1 },
        { kind: 'composition-plan', total: 1 },
        { kind: 'concept', total: 1 },
      ],
    );
  } finally {
    db.close();
  }
});
