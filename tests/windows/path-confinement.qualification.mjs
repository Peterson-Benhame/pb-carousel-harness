import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, symlink, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolveWorkspaceRoot } from '../../src/infrastructure/fs/workspace-paths.mjs';
import { createConfinedRoot } from '../../src/infrastructure/fs/confined-path.mjs';
import '../unit/paths.test.mjs';

// Explicit qualification only: a non-Windows invocation fails, never counts as a skip/pass.
test('qualification requires actual Windows x64 and records exact runtime', () => {
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, release: os.release() }));
});

test('Windows drive paths, mixed separators, spaces and accents stay confined', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'T04 memória marca '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = resolveWorkspaceRoot({ dataDir: 'dados\\ação útil', cwd: base, env: {} });
  assert.equal(root, path.join(base, 'dados', 'ação útil'));
  const confined = await createConfinedRoot(root);
  assert.equal(await confined.resolve('runs\\ação/slide.png'), path.join(root, 'runs', 'ação', 'slide.png'));
  assert.deepEqual(await readdir(base), []);
  for (const value of ['\\\\server\\share', '\\\\?\\C:\\data', '\\\\.\\C:\\data', 'C:relative']) {
    assert.throws(() => resolveWorkspaceRoot({ dataDir: value }), { code: 'INVALID_ARGUMENT' });
  }
});

test('Windows junction replaced after resolution blocks read and promotion callbacks', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'T04 junction '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  await mkdir(root); await mkdir(outside); await mkdir(path.join(root, 'target'));
  await writeFile(path.join(outside, 'sentinel'), 'untouched');
  await writeFile(path.join(root, 'staged'), 'synthetic');
  const confined = await createConfinedRoot(root);
  await confined.resolve('target/sentinel');
  await rm(path.join(root, 'target'), { recursive: true });
  await symlink(outside, path.join(root, 'target'), 'junction');
  let accesses = 0;
  await assert.rejects(confined.withPaths(['target/sentinel'], () => accesses++), { code: 'PATH_NOT_CONFINED' });
  await assert.rejects(confined.withPaths(['staged', 'target/new'], () => accesses++), { code: 'PATH_NOT_CONFINED' });
  assert.equal(accesses, 0);
  assert.equal(await readFile(path.join(outside, 'sentinel'), 'utf8'), 'untouched');
  assert.deepEqual(await readdir(outside), ['sentinel']);
});

test('Windows default needs its own drive and explicit rooted option uses invocation drive', () => {
  assert.throws(() => resolveWorkspaceRoot({ env: { LOCALAPPDATA: '\\Users\\me\\AppData\\Local' }, cwd: 'D:\\call' }), { code: 'INVALID_ARGUMENT' });
  assert.equal(resolveWorkspaceRoot({ dataDir: '\\chosen', env: {}, cwd: 'D:\\call' }), 'D:\\chosen');
  assert.equal(resolveWorkspaceRoot({ env: { LOCALAPPDATA: 'C:\\Local' }, cwd: '\\\\server\\share' }), 'C:\\Local\\PetersonCarouselHarness');
});
