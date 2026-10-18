import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { qualityServiceFixture } from '../helpers/quality-service-fixture.mjs';
import { openWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import { createApprovals } from '../../src/application/approvals.mjs';
import { confirmApprovalProposal } from '../../src/interfaces/cli/human-confirmation.mjs';
import sharp from 'sharp';

const team = ['editor-chief', 'copywriter', 'art-director', 'layout-designer', 'quality-reviewer', 'production-manager'];
const terminal = () => ({ input: { isTTY: true }, output: { isTTY: true, write() {} }, argv: [], ask: async () => 'CONFIRMAR' });

async function api() {
  const module = await import('../../src/application/editorial-workflow.mjs').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return {};
  });
  assert.equal(typeof module.createEditorialWorkflow, 'function', 'editorial workflow must exist');
  return module;
}

test('public host role guide maps all six responsibilities to the existing Peterson skills', async () => {
  const { EDITORIAL_ROLE_GUIDE } = await api();
  assert.deepEqual(Object.keys(EDITORIAL_ROLE_GUIDE), team);
  assert.deepEqual(Object.fromEntries(team.map(role => [role, EDITORIAL_ROLE_GUIDE[role].skill])), {
    'editor-chief': 'peterson-carousel-idea',
    copywriter: 'peterson-carousel-copy',
    'art-director': 'peterson-carousel-design',
    'layout-designer': 'peterson-carousel-design',
    'quality-reviewer': 'peterson-carousel-design',
    'production-manager': 'peterson-carousel',
  });
  for (const role of team) {
    assert.equal(EDITORIAL_ROLE_GUIDE[role].executionMode, 'host-skill');
    assert.ok(EDITORIAL_ROLE_GUIDE[role].responsibility.length > 0);
    assert.ok(EDITORIAL_ROLE_GUIDE[role].boundaries.length > 0);
  }
});

test('host coordinates editorial roles through a real preview and stops at human QA review', async t => {
  const fixture = await qualityServiceFixture(t, { approve: false, render: false, count: 3 });
  const ready = fixture.ready;
  const calls = [];
  const roles = Object.fromEntries(team.map(role => [role, async context => {
    calls.push({ role, context });
    assert.equal(context.assignment.role, role);
    assert.equal(context.assignment.executionMode, 'host-skill');
    if (role === 'editor-chief') {
      assert.deepEqual(context.dependencies, []);
      assert.deepEqual(Object.keys(context).sort(), ['assignment', 'dependencies', 'request', 'role', 'scope', 'task']);
      return {
        schemaVersion: 1,
        kind: 'editorial-brief',
        centralMessage: 'Decisões explícitas evitam carrosséis genéricos.',
        objective: 'save',
        audience: 'desenvolvedores e empreendedores',
        constraints: ['preserve-approved-copy'],
      };
    }
    if (role === 'copywriter') {
      assert.equal(context.dependencies.length, 1);
      assert.equal(context.dependencies[0].owner, 'editor-chief');
      assert.deepEqual(context.currentCopyRef, ready.artifacts.carousel);
      return {
        schemaVersion: 1,
        kind: 'carousel-copy',
        briefRef: context.dependencies[0].artifactRef,
        carouselRef: context.currentCopyRef,
        note: 'Existing approved candidate reused without rewriting.',
      };
    }
    if (role === 'art-director') {
      assert.equal(context.dependencies.length, 1);
      assert.equal(context.dependencies[0].owner, 'copywriter');
      assert.deepEqual(context.currentConceptRef, ready.artifacts.concept);
      assert.equal(context.copyApproval.decision, 'approved');
      return {
        schemaVersion: 1,
        kind: 'art-direction',
        copyDeliveryRef: context.dependencies[0].artifactRef,
        conceptRef: context.currentConceptRef,
        visualObject: 'uma cadeia explícita de decisões editoriais',
        messageRelation: 'cada elo representa um handoff verificável',
        justification: 'torna coordenação e responsabilidade visíveis',
        requiredElements: ['hierarquia editorial', 'continuidade declarada'],
        forbiddenElements: ['decoração sem vínculo com a mensagem'],
      };
    }
    if (role === 'layout-designer') {
      assert.equal(context.dependencies.length, 1);
      assert.equal(context.dependencies[0].owner, 'art-director');
      assert.deepEqual(context.currentPlanRef, ready.artifacts.plan);
      assert.equal(context.conceptApproval.decision, 'approved');
      return {
        schemaVersion: 1,
        kind: 'layout-plan',
        artDirectionRef: context.dependencies[0].artifactRef,
        compositionPlanRef: context.currentPlanRef,
        hierarchyDecision: 'usar a hierarquia tipográfica persistida no plano qualificado',
        fontDecision: 'preservar os bindings de fontes do snapshot',
        placementDecision: 'preservar regiões e continuidades declaradas, sem inferir pelo número da lâmina',
      };
    }
    if (role === 'production-manager') {
      assert.equal(context.dependencies.length, 1);
      assert.equal(context.dependencies[0].owner, 'layout-designer');
      assert.deepEqual(context.currentPlanRef, ready.artifacts.plan);
      return {
        schemaVersion: 1,
        kind: 'production-instruction',
        layoutDeliveryRef: context.dependencies[0].artifactRef,
        compositionPlanRef: context.currentPlanRef,
        phase: 'preview-render',
        automaticAttemptLimit: 2,
        note: 'Render preview once; allow at most one bounded automatic correction.',
      };
    }
    if (role === 'quality-reviewer') {
      assert.equal(context.dependencies.length, 1);
      assert.equal(context.dependencies[0].owner, 'production-manager');
      assert.ok(context.files.length > 0);
      assert.equal(context.contract.id, ready.artifacts.plan.id);
      for (const file of context.files) {
        const metadata = await sharp(file.path).metadata();
        assert.equal(metadata.format, 'png');
        assert.equal(metadata.width, file.width);
        assert.equal(metadata.height, file.height);
      }
      return {
        schemaVersion: 1,
        kind: 'qa-assessment',
        productionRef: context.dependencies[0].artifactRef,
        manifestRef: context.manifestRef,
        semanticContractRef: context.currentPlanRef,
        automaticChecks: { status: 'available', evidenceRef: context.automaticEvidenceRef },
        agentVisual: { status: 'not-performed', method: 'synthetic-test-no-host-vision', notes: 'No visual judgment is claimed by this test double.' },
        humanReview: { status: 'pending' },
      };
    }
    assert.fail(`${role} must not run before text approval`);
  }]));
  const { createEditorialWorkflow } = await api();
  const workflow = await createEditorialWorkflow({ root: fixture.root, db: fixture.db, packageRoot: fixture.packageRoot, roles });
  const input = {
    requestId: randomUUID(),
    ...fixture.scope,
    request: {
      topic: 'coordenação editorial',
      objective: 'save',
      audience: 'desenvolvedores e empreendedores',
      constraints: ['reuse-current-copy'],
    },
  };

  const result = await workflow.runToTextGate(input);
  assert.equal(result.status, 'waiting-human-approval');
  assert.equal(result.gate, 'text-approval');
  assert.equal(result.approval.status, 'pending');
  assert.deepEqual(calls.map(call => call.role), ['editor-chief', 'copywriter']);
  assert.equal(result.deliveries.length, 2);
  assert.deepEqual(result.deliveries.map(item => [item.owner, item.status]), [
    ['editor-chief', 'completed'],
    ['copywriter', 'completed'],
  ]);
  assert.deepEqual(result.deliveries[1].dependencies, [result.deliveries[0].artifactRef]);

  const replay = await workflow.runToTextGate(input);
  assert.deepEqual(replay, result);
  assert.deepEqual(calls.map(call => call.role), ['editor-chief', 'copywriter']);
  assert.equal(fixture.db.prepare("SELECT count(*) total FROM artifacts WHERE run_id=? AND kind LIKE 'editorial-delivery:%'").get(fixture.scope.runId).total, 2);
  assert.equal(fixture.db.prepare("SELECT count(*) total FROM confirmation_requests WHERE run_id=? AND kind='copy'").get(fixture.scope.runId).total, 1);

  const approvals = await createApprovals({ root: fixture.root, db: fixture.db, packageRoot: fixture.packageRoot });
  const copyReceipt = await confirmApprovalProposal(result.approval.proposal, terminal());
  await approvals.decide({ requestId: randomUUID(), proposal: result.approval.proposal, decision: 'approved' }, copyReceipt);
  const conceptGate = await workflow.runToConceptGate({ requestId: randomUUID(), ...fixture.scope });
  assert.equal(conceptGate.status, 'waiting-human-approval');
  assert.equal(conceptGate.gate, 'concept-approval');
  assert.deepEqual(calls.map(call => call.role), ['editor-chief', 'copywriter', 'art-director']);
  assert.equal(conceptGate.deliveries[2].owner, 'art-director');
  assert.deepEqual(conceptGate.deliveries[2].dependencies, [conceptGate.deliveries[1].artifactRef]);

  const conceptReceipt = await confirmApprovalProposal(conceptGate.approval.proposal, terminal());
  await approvals.decide({ requestId: randomUUID(), proposal: conceptGate.approval.proposal, decision: 'approved' }, conceptReceipt);
  const layoutReady = await workflow.runToLayout({ requestId: randomUUID(), ...fixture.scope });
  assert.equal(layoutReady.status, 'ready-for-render');
  assert.equal(layoutReady.gate, null);
  assert.deepEqual(calls.map(call => call.role), ['editor-chief', 'copywriter', 'art-director', 'layout-designer']);
  assert.equal(layoutReady.deliveries[3].owner, 'layout-designer');
  assert.deepEqual(layoutReady.deliveries[3].dependencies, [layoutReady.deliveries[2].artifactRef]);
  const qaGate = await workflow.runToQaGate({ requestId: randomUUID(), ...fixture.scope });
  assert.equal(qaGate.status, 'waiting-human-review');
  assert.equal(qaGate.gate, 'qa-review');
  assert.equal(qaGate.approval.status, 'pending');
  assert.deepEqual(calls.map(call => call.role), ['editor-chief', 'copywriter', 'art-director', 'layout-designer', 'production-manager', 'quality-reviewer']);
  assert.deepEqual(qaGate.deliveries.map(item => item.owner), ['editor-chief', 'copywriter', 'art-director', 'layout-designer', 'production-manager', 'quality-reviewer']);
  assert.equal(qaGate.deliveries.at(-1).output.agentVisual.status, 'not-performed');
  assert.ok(fixture.db.prepare("SELECT count(*) total FROM artifacts WHERE run_id=? AND kind LIKE 'render-slide:preview:%'").get(fixture.scope.runId).total > 0);

  fixture.db.close();
  const reopened = await openWorkspace(fixture.root, { readonly: true });
  try {
    const restored = await (await createEditorialWorkflow({ root: fixture.root, db: reopened, packageRoot: fixture.packageRoot })).getState(fixture.scope);
    assert.deepEqual(restored, qaGate);
  } finally {
    reopened.close();
  }
});
