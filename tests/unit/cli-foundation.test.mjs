import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const entrypoint = path.join(root, 'bin/peterson-carousel.mjs');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

function invoke(args, options = {}) {
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: root, encoding: 'utf8', ...options,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function envelope(result, ok) {
  const body = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(body).sort(), ['protocolVersion', 'ok', 'data', 'error', 'nextAction'].sort());
  assert.equal(body.protocolVersion, 1);
  assert.equal(body.ok, ok);
  assert.equal(result.stdout, `${JSON.stringify(body)}\n`, 'stdout contains exactly one JSON envelope');
  if (ok) {
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(body.error, null);
    assert.equal(body.nextAction, null);
  } else {
    assert.equal(result.status, 2);
    assert.equal(body.data, null);
    assert.equal(typeof body.error.code, 'string');
    assert.equal(typeof body.error.message, 'string');
    assert.equal(body.nextAction, 'peterson-carousel --help');
    assert.match(result.stderr, new RegExp(body.error.code));
  }
  return body;
}

test('package exposes a private ESM executable with recursive portable test discovery', async () => {
  assert.equal(manifest.name, '@pb/carousel-harness');
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, 'module');
  assert.deepEqual(manifest.bin, { 'peterson-carousel': 'bin/peterson-carousel.mjs' });
  assert.equal(manifest.engines.node, '24.21.0');
  assert.equal(manifest.scripts.test, 'node --test');
  assert.equal(manifest.scripts['test:qualification'], 'node --test tests/qualification/native-runtime.qualification.mjs');
  assert.match(await readFile(entrypoint, 'utf8'), /^#!\/usr\/bin\/env node\n/);
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.packages[''].name, manifest.name);
  assert.deepEqual(lock.packages[''].bin, manifest.bin);
  assert.deepEqual(lock.packages[''].engines, manifest.engines);
});

for (const args of [[], ['--help'], ['-h']]) {
  test(`readable help: ${JSON.stringify(args)}`, () => {
    const result = invoke(args);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /peterson-carousel/);
    assert.match(result.stdout, /--help/);
    assert.match(result.stdout, /--version/);
    assert.match(result.stdout, /--json/);
    assert.doesNotMatch(result.stdout, /\b(brand|run|doctor|init|workspace|approval)\b/);
  });
}

for (const args of [['--version'], ['-v']]) {
  test(`readable version: ${JSON.stringify(args)}`, () => {
    const result = invoke(args);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, `@pb/carousel-harness ${manifest.version}\n`);
  });
}

for (const args of [['--help', '--json'], ['--json', '--help'], ['--json']]) {
  test(`JSON help: ${JSON.stringify(args)}`, () => {
    const body = envelope(invoke(args), true);
    assert.equal(body.data.name, '@pb/carousel-harness');
    assert.equal(body.data.version, manifest.version);
    assert.equal(typeof body.data.usage, 'string');
    assert.ok(Array.isArray(body.data.options));
  });
}

for (const args of [['--version', '--json'], ['--json', '-v']]) {
  test(`JSON version: ${JSON.stringify(args)}`, () => {
    assert.deepEqual(envelope(invoke(args), true).data, { name: '@pb/carousel-harness', version: manifest.version });
  });
}

const invalidArguments = [
  ['--unknown'], ['brand', 'list'], ['run'], ['doctor'], ['init'],
  ['--help', '--version'], ['-h', '-v'], ['--help', '--help'], ['-h', '--help'],
  ['--version', '-v'], ['--json', '--json'], ['--json=true'], ['--version=1'],
  ['--help', 'extra'], ['--'], ['-hv'], ['--data-dir', '/unused'], ['--yes'],
];
for (const args of invalidArguments) {
  test(`reject invalid arguments without falling through help: ${JSON.stringify(args)}`, () => {
    const jsonArgs = args.includes('--json') ? args : [...args, '--json'];
    const body = envelope(invoke(jsonArgs), false);
    assert.equal(body.error.code, 'INVALID_ARGUMENT');
  });
}

test('readable errors use stderr, nonzero status, and never echo unsafe input', () => {
  const result = invoke(['--private-token=secret\n\u001b[31m']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /INVALID_ARGUMENT/);
  assert.doesNotMatch(result.stderr, /secret|\u001b|private-token/);
  const json = invoke(['--private-token=secret\n\u001b[31m', '--json']);
  envelope(json, false);
  assert.doesNotMatch(json.stdout + json.stderr, /secret|\u001b|private-token/);
});

test('unknown failures are sanitized and reported with exit code 1', async () => {
  const { toPublicError } = await import('../../src/domain/errors.mjs');
  const { failure } = await import('../../src/domain/protocol.mjs');
  const { writeOutput } = await import('../../src/interfaces/cli/output.mjs');
  const error = toPublicError(new Error('private file /home/user/secret.sqlite'));
  assert.equal(error.code, 'INTERNAL_ERROR');
  assert.equal(error.exitCode, 1);
  const result = failure(error);
  let stdout = '';
  let stderr = '';
  writeOutput(result, { json: true, stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } });
  assert.equal(JSON.parse(stdout).error.code, 'INTERNAL_ERROR');
  assert.match(stderr, /INTERNAL_ERROR/);
  assert.doesNotMatch(stdout + stderr, /private file|secret.sqlite|\/home/);
});

test('absolute entrypoint works from another cwd and never creates workspace or cache', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'carousel-cli-ação '));
  try {
    const env = { ...process.env, HOME: path.join(sandbox, 'home'), USERPROFILE: path.join(sandbox, 'profile'),
      LOCALAPPDATA: path.join(sandbox, 'local'), CAROUSEL_DATA_DIR: path.join(sandbox, 'workspace'),
      XDG_CACHE_HOME: path.join(sandbox, 'cache'), npm_config_cache: path.join(sandbox, 'npm-cache') };
    for (const args of [[], ['--help'], ['--version'], ['--json'], ['--version', '--json'], ['unknown', '--json']]) {
      const result = invoke(args, { cwd: sandbox, env });
      assert.equal(result.status, args.includes('unknown') ? 2 : 0);
    }
    assert.deepEqual(await readdir(sandbox), []);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('CLI runs from a minimal copy without native dependencies or legacy resources', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'carousel-isolated-'));
  try {
    for (const item of ['bin', 'src', 'package.json']) {
      await cp(path.join(root, item), path.join(sandbox, item), { recursive: true });
    }
    for (const args of [['--help', '--json'], ['--version', '--json']]) {
      const result = spawnSync(process.execPath, [path.join(sandbox, 'bin/peterson-carousel.mjs'), ...args], {
        cwd: tmpdir(), env: { ...process.env, NODE_PATH: '' }, encoding: 'utf8',
      });
      assert.ifError(result.error);
      envelope(result, true);
    }
    assert.deepEqual((await readdir(sandbox)).sort(), ['bin', 'package.json', 'src']);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
