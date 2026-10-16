import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir } from 'node:fs/promises';
import { resolveWorkspaceRoot } from '../../src/infrastructure/fs/workspace-paths.mjs';
import { normalizeReference, createConfinedRoot } from '../../src/infrastructure/fs/confined-path.mjs';
import { validateSlug, createIdentifier, validateIdentifier } from '../../src/domain/identifiers.mjs';

const invalid = (fn) => assert.throws(fn, { code: 'INVALID_ARGUMENT' });

test('root precedence and explicit relatives resolved once, without filesystem mutation', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'carousel paths ação '));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const env = { CAROUSEL_DATA_DIR: 'from env', LOCALAPPDATA: path.join(cwd, 'local') };
  assert.equal(resolveWorkspaceRoot({ dataDir: 'from cli', env, cwd }), path.join(cwd, 'from cli'));
  assert.equal(resolveWorkspaceRoot({ env, cwd }), path.join(cwd, 'from env'));
  delete env.CAROUSEL_DATA_DIR;
  assert.equal(resolveWorkspaceRoot({ env, cwd }), path.join(cwd, 'local', 'PetersonCarouselHarness'));
  assert.deepEqual(await readdir(cwd), []);
});

test('root rejects empty, network, URL, reserved, ADS and ambiguous drive inputs', () => {
  for (const dataDir of ['', ' ', '//server/share', '\\\\server\\share', 'file:///tmp/a', 'https://x', 'C:relative', 'dir/CON', 'dir/name:stream', 'dir/end.']) {
    invalid(() => resolveWorkspaceRoot({ dataDir, env: {}, cwd: process.cwd() }));
  }
  invalid(() => resolveWorkspaceRoot({ env: {} }));
  invalid(() => resolveWorkspaceRoot({ env: { LOCALAPPDATA: 'relative' } }));
});

test('references normalize separators and preserve safe spaces and accents', () => {
  assert.equal(normalizeReference('assets\\ação útil/logo.png'), 'assets/ação útil/logo.png');
});

test('references reject traversal, aliases, absolute paths, URLs, UNC, reserved names and ADS', () => {
  for (const value of ['', '.', '..', 'a/../b', 'a\\..\\b', 'a/./b', '/tmp/a', '\\tmp\\a', 'C:/a', 'C:a', '//server/a', '\\\\server\\a', 'file:a', 'https://x', 'a//b', 'a/', 'a\0b', 'a\nb', 'a?b', 'a*b', 'a|b', 'a<b', 'a>b', 'a"b', 'CON', 'con.txt', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9.txt', 'COM¹.txt', 'LPT²', 'CONIN$', 'CONOUT$', 'CLOCK$', 'a:stream', 'a.', 'a ', ' a', 'a/ NUL']) {
    invalid(() => normalizeReference(value));
  }
});

test('slug and generated identifiers cannot supply paths', () => {
  assert.equal(validateSlug('marca-2026'), 'marca-2026');
  for (const value of ['../a', 'a/b', 'a\\b', 'C:a', 'CON', 'con', 'nul', 'a b', '-a', 'a-', 'a--b', '', 'a'.repeat(81)]) invalid(() => validateSlug(value));
  const id = createIdentifier();
  assert.equal(validateIdentifier(id), id);
  for (const value of ['../a', 'abc', 'CON', id.toUpperCase()]) invalid(() => validateIdentifier(value));
});

test('missing workspace and missing descendants are resolved without creating paths', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'carousel-confine-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'memória nova');
  const confined = await createConfinedRoot(root);
  assert.equal(await confined.resolve('runs\\new/file.txt'), path.join(root, 'runs', 'new', 'file.txt'));
  assert.deepEqual(await readdir(base), []);
});

test('fresh checks reject symlink escapes, dangling links, root links and replacement before access/promotion', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'carousel-confine-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  await mkdir(root); await mkdir(outside); await mkdir(path.join(root, 'safe'));
  await writeFile(path.join(root, 'source'), 'synthetic');
  const confined = await createConfinedRoot(root);
  await symlink(outside, path.join(root, 'escape'), 'junction');
  await assert.rejects(confined.resolve('escape/file'), { code: 'PATH_NOT_CONFINED' });
  await symlink(path.join(base, 'missing'), path.join(root, 'dangling'), 'junction');
  await assert.rejects(confined.resolve('dangling/file'), { code: 'PATH_NOT_CONFINED' });
  await symlink(root, path.join(base, 'root-link'), 'junction');
  await assert.rejects(createConfinedRoot(path.join(base, 'root-link')), { code: 'PATH_NOT_CONFINED' });
  await confined.resolve('safe/file');
  await rm(path.join(root, 'safe'), { recursive: true });
  await symlink(outside, path.join(root, 'safe'), 'junction');
  let accessed = false;
  await assert.rejects(confined.withPaths(['source', 'safe/file'], () => { accessed = true; }), { code: 'PATH_NOT_CONFINED' });
  assert.equal(accessed, false);
  await assert.rejects(confined.resolve('source/child'), { code: 'PATH_NOT_CONFINED' });
});

test('withPaths validates every reference before invoking synchronous access callback', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'carousel-confine-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const confined = await createConfinedRoot(base);
  assert.deepEqual(await confined.withPaths(['a', 'b/c'], (...paths) => paths), [path.join(base, 'a'), path.join(base, 'b', 'c')]);
  await assert.rejects(confined.resolve('../escape'), { code: 'INVALID_ARGUMENT' });
});

test('revalidates the workspace itself and its parents after guard creation', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'carousel-parent-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const parent = path.join(base, 'parent');
  const root = path.join(parent, 'workspace');
  const outside = path.join(base, 'outside');
  await mkdir(root, { recursive: true }); await mkdir(outside);
  const confined = await createConfinedRoot(root);
  await rm(parent, { recursive: true });
  await symlink(outside, parent, 'junction');
  await assert.rejects(confined.resolve('missing/file'), { code: 'PATH_NOT_CONFINED' });
  const absent = path.join(base, 'absent');
  const late = await createConfinedRoot(absent);
  await symlink(outside, absent, 'junction');
  await assert.rejects(late.resolve('file'), { code: 'PATH_NOT_CONFINED' });
});

test('links within the workspace are also denied and regular files cannot be roots', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'carousel-links-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(path.join(base, 'inside'));
  await writeFile(path.join(base, 'file'), 'synthetic');
  await symlink(path.join(base, 'inside'), path.join(base, 'alias'), 'junction');
  const confined = await createConfinedRoot(base);
  await assert.rejects(confined.resolve('alias/file'), { code: 'PATH_NOT_CONFINED' });
  await assert.rejects(createConfinedRoot(path.join(base, 'file')), { code: 'PATH_NOT_CONFINED' });
});

test('absolute selected root and absolute default do not inspect invocation cwd', () => {
  const absolute = path.join(os.tmpdir(), 'local data');
  assert.equal(resolveWorkspaceRoot({ dataDir: absolute, cwd: '\\\\server\\share', env: {} }), absolute);
  assert.equal(resolveWorkspaceRoot({ env: { CAROUSEL_DATA_DIR: absolute }, cwd: '\\\\server\\share' }), absolute);
  assert.equal(resolveWorkspaceRoot({ env: { LOCALAPPDATA: absolute }, cwd: '\\\\server\\share' }), path.join(absolute, 'PetersonCarouselHarness'));
});
