import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { executePluginCommand } from '../../src/interfaces/plugin/bridge.mjs';
import { executeLocalCommand } from '../../src/interfaces/local/commands.mjs';
import { parseArgs } from '../../src/interfaces/cli/parse-args.mjs';
import { makeQualityPackage } from '../helpers/quality-service-fixture.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

test('CLI and plugin doctor share the exact local root and explicit package runtime without initializing it', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'carousel-local-interface '));
  const dataDir = path.join(temporary, 'shared-memory');
  t.after(() => rm(temporary, { recursive: true, force: true }));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['bin/peterson-carousel.mjs', 'doctor', '--data-dir', dataDir, '--json'],
    { cwd: packageRoot },
  );
  const cli = JSON.parse(stdout);
  const plugin = await executePluginCommand({ command: 'doctor', dataDir, packageRoot });

  assert.equal(stderr, '');
  assert.equal(cli.ok, true);
  assert.equal(cli.data.workspace.root, dataDir);
  assert.equal(plugin.workspace.root, dataDir);
  assert.deepEqual(plugin.runtime, cli.data.runtime);
  assert.equal(cli.data.readiness.plugin, false);
  assert.equal(plugin.readiness.plugin, true);
  assert.deepEqual(plugin.runtime.package, { name: '@pb/carousel-harness', version: '0.1.0' });
  await assert.rejects(stat(dataDir), { code: 'ENOENT' });
});

test('CLI init creates the single workspace that the plugin bridge inspects', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'carousel-local-init '));
  const dataDir = path.join(temporary, 'shared-memory');
  t.after(() => rm(temporary, { recursive: true, force: true }));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['bin/peterson-carousel.mjs', 'init', '--data-dir', dataDir, '--json'],
    { cwd: packageRoot },
  );
  const initialized = JSON.parse(stdout);
  const inspected = await executePluginCommand({ command: 'doctor', dataDir, packageRoot });

  assert.equal(stderr, '');
  assert.deepEqual(initialized, {
    ok: true,
    protocolVersion: 1,
    data: { root: dataDir, schemaVersion: 1 },
    error: null,
    nextAction: null,
  });
  assert.equal(inspected.workspace.root, dataDir);
  assert.equal(inspected.workspace.available, true);
  assert.equal(inspected.workspace.schemaVersion, 1);
  assert.equal(inspected.workspace.settings.authorizedFontDirectory, path.join(packageRoot, 'assets', 'fonts'));
  assert.equal(inspected.resources.fonts.every(font => font.status === 'available'), true);
  assert.equal((await stat(path.join(dataDir, 'harness.sqlite'))).isFile(), true);
});

test('plugin confirmation commits a brand that the CLI reads from the same memory', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'carousel-local-brand '));
  const dataDir = path.join(temporary, 'shared-memory');
  const requestFile = path.join(temporary, 'brand-get.json');
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await executePluginCommand({ command: 'init', dataDir, packageRoot });

  const brandId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const config = {
    name: 'Peterson', profile: '@petersonbenhame', language: 'pt-BR', audience: null,
    voice: null, preferences: [],
    fonts: { title: 'Anton', body: 'Manrope', mono: 'JetBrains Mono' },
    themes: { light: { background: '#ffffff', text: '#000000', muted: '#555555', accent: '#32d5ff', topics: [] } },
    logo: { enabled: false, variants: {}, protection: 12, minimumHeight: 24 },
    slideWidth: 1080, slideHeight: 1350, minimumSlideCount: 12, maximumSlideCount: 16,
    profileImage: '',
  };
  const committed = await executeLocalCommand({
    command: 'brand.apply', dataDir, packageRoot,
    input: { action: 'brand.create', request: { requestId: 'local-brand-create', brandId, config } },
    terminal: { input: { isTTY: true }, output: { isTTY: true, write() {} }, argv: [], ask: async () => 'CONFIRMAR' },
  });
  await writeFile(requestFile, JSON.stringify({ brandId }));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['bin/peterson-carousel.mjs', 'brand.get', '--data-dir', dataDir, '--request', requestFile, '--json'],
    { cwd: packageRoot },
  );
  const read = JSON.parse(stdout);

  assert.equal(stderr, '');
  assert.equal(committed.brandId, brandId);
  assert.equal(committed.revision, 1);
  assert.equal(read.ok, true);
  assert.deepEqual(read.data, committed);
});

test('run.runtime keeps the workspace open until the public command finishes', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'carousel-local-runtime '));
  const dataDir = path.join(temporary, 'shared-memory');
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await executeLocalCommand({ command: 'init', dataDir, packageRoot });

  const brandId = '12121212-1212-4212-8212-121212121212';
  const config = {
    name: 'Peterson', profile: '@petersonbenhame', language: 'pt-BR', audience: null,
    voice: null, preferences: [],
    fonts: { title: 'Anton', body: 'Manrope', mono: 'JetBrains Mono' },
    themes: { light: { background: '#ffffff', text: '#000000', muted: '#555555', accent: '#32d5ff', topics: [] } },
    logo: { enabled: false, variants: {}, protection: 12, minimumHeight: 24 },
    slideWidth: 1080, slideHeight: 1350, minimumSlideCount: 12, maximumSlideCount: 16,
    profileImage: '',
  };
  await executeLocalCommand({
    command: 'brand.apply', dataDir, packageRoot,
    input: { action: 'brand.create', request: { requestId: 'runtime-brand-create', brandId, config } },
    terminal: { input: { isTTY: true }, output: { isTTY: true, write() {} }, argv: [], ask: async () => 'CONFIRMAR' },
  });
  const run = await executeLocalCommand({
    command: 'run.create', dataDir, packageRoot,
    input: { requestId: 'runtime-run-create', brandId, brandRevision: 1, theme: 'light' },
  });

  const view = await executeLocalCommand({
    command: 'run.runtime', dataDir, packageRoot,
    input: { brandId, runId: run.id },
  });

  assert.equal(view.brandId, brandId);
  assert.equal(view.runId, run.id);
  assert.equal(view.status, 'draft');
});

test('flow commands reach existing services and expose no approval bypass', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'carousel-local-flow '));
  const dataDir = path.join(temporary, 'shared-memory');
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await executePluginCommand({ command: 'init', dataDir, packageRoot });

  const brandId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const manifestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const cases = [
    ['run.create', { requestId: 'run-create', brandId, brandRevision: 1, theme: 'light' }],
    ['input.save', { requestId: 'input-save', brandId, runId, expectedVersion: 1 }],
    ['plan.save', { requestId: 'plan-save', brandId, runId, expectedVersion: 1, plan: {} }],
    ['approval.request', { requestId: 'approval-request', brandId, runId, kind: 'copy' }],
    ['preview', { requestId: 'preview-render', brandId, runId }],
    ['render.final', { requestId: 'final-render', brandId, runId }],
    ['validate', { requestId: 'validate', brandId, runId, manifestId }],
    ['review.apply', { requestId: 'review-request', decisionRequestId: 'review-decision', brandId, runId, kind: 'preview', manifestId }],
    ['package', { requestId: 'package', brandId, runId, manifestId, slug: 'entrega' }],
  ];

  for (const [command, input] of cases) {
    await assert.rejects(
      executePluginCommand({ command, dataDir, packageRoot, input }),
      error => {
        assert.notEqual(error.message, 'Comando local não reconhecido.', command);
        return true;
      },
    );
  }

  const listed = await executePluginCommand({ command: 'run.list', dataDir, packageRoot, input: { brandId } });
  assert.deepEqual(listed, []);
  await assert.rejects(
    executePluginCommand({ command: 'run.list', dataDir, packageRoot, input: { brandId, approved: true } }),
    { code: 'INVALID_ARGUMENT' },
  );
  const { stdout, stderr } = await execFileAsync(process.execPath, ['bin/peterson-carousel.mjs', '--help'], { cwd: packageRoot });
  assert.equal(stderr, '');
  for (const name of cases.map(([command]) => command)) assert.match(stdout, new RegExp(name.replace('.', '\\.')));
  assert.equal(/approve|grant/i.test(stdout), false);
});

test('local integration is allowlisted without granting receipts or candidate qualification', async t => {
  const { loadResourcesManifest } = await import('../../src/infrastructure/resources.mjs');
  const manifest = await loadResourcesManifest();
  for (const file of ['src/interfaces/local/commands.mjs', 'src/interfaces/plugin/bridge.mjs']) {
    assert.ok(manifest.requiredFiles.includes(file), file);
  }
  assert.equal(manifest.renderers.find(renderer => renderer.id === 'editorial-composed@1').status, 'candidate');
  const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(metadata.name, '@pb/carousel-harness');
  assert.ok(metadata.files.includes('assets/'));

  const temporary = await mkdtemp(path.join(os.tmpdir(), 'carousel-local-blocks '));
  const dataDir = path.join(temporary, 'shared-memory');
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await executePluginCommand({ command: 'init', dataDir, packageRoot, input: { schemaVersion: 2 } });

  const brandId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const request = {
    requestId: 'blocked-brand-create', brandId,
    config: {
      name: 'Peterson', profile: '@petersonbenhame', language: 'pt-BR', audience: null,
      voice: null, preferences: [],
      fonts: { title: 'Anton', body: 'Manrope', mono: 'JetBrains Mono' },
      themes: { light: { background: '#ffffff', text: '#000000', muted: '#555555', accent: '#32d5ff', topics: [] } },
      logo: { enabled: false, variants: {}, protection: 12, minimumHeight: 24 },
      slideWidth: 1080, slideHeight: 1350, minimumSlideCount: 12, maximumSlideCount: 16,
      profileImage: '',
    },
  };
  await assert.rejects(
    executePluginCommand({ command: 'brand.apply', dataDir, packageRoot, input: { action: 'brand.create', request } }),
    { code: 'APPROVAL_REQUIRED' },
  );
  assert.deepEqual(await executePluginCommand({ command: 'brand.list', dataDir, packageRoot }), []);

  await executeLocalCommand({
    command: 'brand.apply', dataDir, packageRoot, input: { action: 'brand.create', request },
    terminal: { input: { isTTY: true }, output: { isTTY: true, write() {} }, argv: [], ask: async () => 'CONFIRMAR' },
  });
  await assert.rejects(
    executePluginCommand({ command: 'run.create', dataDir, packageRoot, input: { requestId: 'blocked-run', brandId, brandRevision: 1, theme: 'light' } }),
    { code: 'LAYOUT_NOT_QUALIFIED' },
  );
});

test('schema2 run creation resolves only package-backed qualified resources and configured package fonts', async t => {
  const pkg = await makeQualityPackage(t);
  Object.assign(pkg.manifest.qualifiedRuntime, {
    node: process.version, platform: process.platform, arch: process.arch, abi: process.versions.modules,
  });
  await writeFile(path.join(pkg.packageRoot, 'shared', 'resources.manifest.json'), JSON.stringify(pkg.manifest, null, 2));
  pkg.input.resourceManifestRef.sha256 = canonicalHash(pkg.manifest);
  const fontRoot = path.join(pkg.packageRoot, 'assets', 'fonts');
  await mkdir(fontRoot, { recursive: true });
  for (const font of pkg.manifest.fonts) {
    await writeFile(path.join(fontRoot, font.file), await readFile(path.join(packageRoot, 'assets', 'fonts', font.file)));
  }

  const temporary = await mkdtemp(path.join(os.tmpdir(), 'carousel-local-v2 '));
  const dataDir = path.join(temporary, 'shared-memory');
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const bridge = await import(pathToFileURL(path.join(pkg.packageRoot, 'src', 'interfaces', 'plugin', 'bridge.mjs')).href);
  const local = await import(pathToFileURL(path.join(pkg.packageRoot, 'src', 'interfaces', 'local', 'commands.mjs')).href);

  await bridge.executePluginCommand({ command: 'init', dataDir, packageRoot: pkg.packageRoot, input: { schemaVersion: 2 } });
  const brandId = pkg.input.brand.brandId;
  await local.executeLocalCommand({
    command: 'brand.apply', dataDir, packageRoot: pkg.packageRoot,
    input: { action: 'brand.create', request: { requestId: 'qualified-brand', brandId, config: pkg.input.brand.config } },
    terminal: { input: { isTTY: true }, output: { isTTY: true, write() {} }, argv: [], ask: async () => 'CONFIRMAR' },
  });
  const run = await bridge.executePluginCommand({
    command: 'run.create', dataDir, packageRoot: pkg.packageRoot,
    input: { requestId: 'qualified-run', brandId, brandRevision: 1, theme: pkg.input.theme },
  });

  assert.equal(run.snapshot.contractVersion, 2);
  assert.equal(run.snapshot.renderer.id, 'editorial-composed@1');
  assert.equal(run.snapshot.resourceManifestRef.sha256, pkg.input.resourceManifestRef.sha256);
  assert.deepEqual(run.approvals, []);
  const doctor = await bridge.executePluginCommand({ command: 'doctor', dataDir, packageRoot: pkg.packageRoot });
  assert.equal(doctor.workspace.settings.authorizedFontDirectory, fontRoot);
});

test('the preserved package name exposes the plugin bridge as a stable subpath', async () => {
  const bridge = await import('@pb/carousel-harness/plugin');
  assert.equal(typeof bridge.executePluginCommand, 'function');
  assert.equal(typeof bridge.resolveLocalContext, 'function');
});

test('plugin callers cannot inject terminal capabilities, ask functions or streams', async () => {
  const injected = [
    ['terminal', { input: { isTTY: true }, output: { isTTY: true, write() {} }, ask: async () => 'CONFIRMAR' }],
    ['ask', async () => 'CONFIRMAR'],
    ['streams', { input: { isTTY: true }, stderr: { isTTY: true, write() {} } }],
  ];
  for (const [key, value] of injected) {
    await assert.rejects(
      executePluginCommand({ command: 'doctor', packageRoot, [key]: value }),
      { code: 'INVALID_ARGUMENT' },
      key,
    );
  }
});

test('CLI value options reject missing values and flags instead of changing the selected root', () => {
  for (const args of [
    ['init', '--data-dir'],
    ['init', '--data-dir', '--json'],
    ['init', '--request'],
    ['init', '--request', '--json'],
  ]) assert.throws(() => parseArgs(args), { code: 'INVALID_ARGUMENT' });

  assert.deepEqual(parseArgs(['init', '--data-dir', 'memory', '--json']), {
    command: 'init', json: true, dataDir: 'memory', requestFile: undefined,
  });
});

test('request payload cannot override the resolved memory root or explicit package runtime', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'carousel-local-context '));
  const dataDir = path.join(temporary, 'shared-memory');
  t.after(() => rm(temporary, { recursive: true, force: true }));

  for (const [command, input] of [
    ['doctor', { dataDir: path.join(temporary, 'other-memory') }],
    ['doctor', { packageRoot: temporary }],
    ['init', { schemaVersion: 1, runtime: 'ambient' }],
  ]) {
    await assert.rejects(
      executePluginCommand({ command, dataDir, packageRoot, input }),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  await assert.rejects(stat(dataDir), { code: 'ENOENT' });
});
