import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { existsSync, realpathSync } from 'node:fs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const allowed = ['ATTRIBUTION.md', 'bin/peterson-carousel.mjs', 'docs/cli.md', 'package.json',
  'shared/defaults/brand.json', 'shared/defaults/themes.json', 'src/domain/errors.mjs',
  'src/domain/protocol.mjs', 'src/interfaces/cli/main.mjs', 'src/interfaces/cli/output.mjs',
  'src/interfaces/cli/parse-args.mjs'].sort();
const run = (cwd, command, args) => spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_cache: path.join(cwd, '.npm-cache') } });
const node = (cwd, ...args) => run(cwd, process.execPath, args);
// Invoke npm's JavaScript CLI with Node, never execute npm.cmd as a binary or
// enable a shell (paths in this suite intentionally contain spaces/accents).
function npmCliPath() {
  const directories = [path.dirname(process.execPath), ...(process.env.PATH ?? '').split(path.delimiter)];
  const candidates = [process.env.npm_execpath];
  for (const directory of directories) {
    candidates.push(path.join(directory,'node_modules/npm/bin/npm-cli.js'));
    candidates.push(path.resolve(directory,'../lib/node_modules/npm/bin/npm-cli.js'));
    const executable = path.join(directory,'npm');
    if (existsSync(executable)) candidates.push(realpathSync(executable));
  }
  const found = candidates.find(candidate => candidate && path.basename(candidate)==='npm-cli.js' && existsSync(candidate));
  assert.ok(found,'npm CLI JavaScript entrypoint required for distribution tests');
  return found;
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'carousel package á '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of ['scripts', 'bin', 'src', 'shared', 'package.json', 'ATTRIBUTION.md', 'docs']) {
    await cp(path.join(root, name), path.join(dir, name), { recursive: true });
  }
  return dir;
}
function tar(entries) {
  const chunks = [];
  for (const [name, content, type = '0'] of entries) {
    const bytes = Buffer.from(content), h = Buffer.alloc(512);
    h.write(name); h.write('0000644\0', 100); h.write('0000000\0',108); h.write('0000000\0',116);
    h.write(bytes.length.toString(8).padStart(11, '0')+'\0',124); h.fill(32,148,156); h.write(type,156);
    h.write('ustar\0',257); h.write('00',263);
    const checksum = h.reduce((sum, value) => sum + value, 0);
    h.write(checksum.toString(8).padStart(6,'0')+'\0 ',148);
    chunks.push(h,bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

test('release builder exists and stages an exact neutral allowlist without changing legacy files', async t => {
  const dir = await fixture(t);
  const before = await readFile(path.join(dir,'shared/brand.json'));
  await mkdir(path.join(dir,'.release/package'),{recursive:true});
  await writeFile(path.join(dir,'.release/package','private-photo.png'),'PRIVATE');
  const built = node(dir,'scripts/build-release.mjs');
  assert.equal(built.status,0,built.stderr);
  const stage = path.join(dir,'.release/package');
  const files = (await readdir(stage,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>path.relative(stage,path.join(e.parentPath,e.name)).replaceAll(path.sep,'/')).sort();
  assert.deepEqual(files,allowed);
  const manifest = JSON.parse(await readFile(path.join(stage,'package.json')));
  assert.equal(manifest.private,true); assert.equal(manifest.license,'UNLICENSED');
  assert.deepEqual(JSON.parse(await readFile(path.join(dir,'package.json'))).files,manifest.files);
  assert.equal(manifest.scripts,undefined); assert.equal(manifest.dependencies,undefined);
  assert.deepEqual(manifest.files,[...allowed].filter(p=>p!=='package.json'));
  assert.deepEqual(JSON.parse(await readFile(path.join(stage,'shared/defaults/brand.json'))),{language:'pt-BR',slideWidth:1080,slideHeight:1350});
  assert.deepEqual(JSON.parse(await readFile(path.join(stage,'shared/defaults/themes.json'))),{});
  assert.deepEqual(await readFile(path.join(dir,'shared/brand.json')),before);
});

test('real npm tarball passes audit and runs help/version isolated from source', async t => {
  const dir = await fixture(t);
  assert.equal(node(dir,'scripts/build-release.mjs').status,0);
  const npmArgs = [npmCliPath()];
  const dry = run(dir,process.execPath,[...npmArgs,'pack','./.release/package','--dry-run','--json','--ignore-scripts','--offline']);
  assert.equal(dry.status,0,dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout)[0].files.map(f=>f.path).sort(),allowed);
  const packed = run(dir,process.execPath,[...npmArgs,'pack','./.release/package','--json','--ignore-scripts','--offline','--pack-destination','.release']);
  assert.equal(packed.status,0,packed.stderr);
  const archive = path.join(dir,'.release',JSON.parse(packed.stdout)[0].filename);
  const audited = node(dir,'scripts/audit-tarball.mjs',archive);
  assert.equal(audited.status,0,audited.stderr);
  const report = JSON.parse(audited.stdout);
  assert.deepEqual(report.members,allowed.map(p=>'package/'+p)); assert.match(report.sha256,/^[a-f0-9]{64}$/);
  const { inspectTarball } = await import('../../scripts/audit-tarball.mjs');
  const result = inspectTarball(await readFile(archive));
  const isolated = await mkdtemp(path.join(tmpdir(),'carousel isolated á '));
  t.after(()=>rm(isolated,{recursive:true,force:true}));
  for (const [name,bytes] of result.files) { const destination=path.join(isolated,name); await mkdir(path.dirname(destination),{recursive:true}); await writeFile(destination,bytes); }
  await rm(dir,{recursive:true,force:true});
  for (const flag of ['--help','--version']) {
    const result = node(isolated,'package/bin/peterson-carousel.mjs',flag,'--json');
    assert.equal(result.status,0,result.stderr); assert.equal(JSON.parse(result.stdout).ok,true);
  }
  assert.deepEqual((await readdir(isolated)),['package']);
});

test('audit rejects extra private files, paths, links, duplicates, hooks and non-private manifests', async t => {
  const dir = await fixture(t);
  assert.equal(node(dir,'scripts/build-release.mjs').status,0);
  const entries = await Promise.all(allowed.map(async name=>['package/'+name,await readFile(path.join(dir,'.release/package',name))]));
  const variants = [
    [...entries,['package/shared/brand.json','private']], [...entries,['package/assets/font.ttf','font']],
    [...entries,['package/node_modules/x','x']], [...entries,['package/../escape','x']],
    [...entries,['/absolute','x']], entries.map((entry,i)=>i===0?[entry[0],'','2']:entry), [...entries,entries[0]],
    entries.map(([name,data])=>[name,name==='package/shared/defaults/brand.json'?JSON.stringify({profile:'@private'}):data]),
    entries.filter(([name])=>!name.endsWith('ATTRIBUTION.md')),
    ...[{private:false},{scripts:{postinstall:'echo bad'}},{dependencies:{sharp:'*'}}].map(change=>entries.map(([name,data])=>[name,name==='package/package.json'?JSON.stringify({...JSON.parse(data),...change}):data])),
  ];
  for (const [i,variant] of variants.entries()) {
    const archive=path.join(dir,`bad-${i}.tgz`); await writeFile(archive,tar(variant));
    const result=node(dir,'scripts/audit-tarball.mjs',archive);
    assert.equal(result.status,1,`variant ${i}: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr,/Audit failed/);
  }
});


test('builder refuses symlink staging and source paths without writing outside its root', async t => {
  const dir = await fixture(t);
  const outside = await mkdtemp(path.join(tmpdir(),'carousel protected '));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(path.join(outside,'marker'),'untouched');
  await symlink(outside,path.join(dir,'.release'),process.platform==='win32'?'junction':'dir');
  assert.equal(node(dir,'scripts/build-release.mjs').status,1);
  assert.deepEqual(await readdir(outside),['marker']);
  await rm(path.join(dir,'.release'));
  await rm(path.join(dir,'shared/defaults/brand.json'));
  await symlink(path.join(outside,'marker'),path.join(dir,'shared/defaults/brand.json'));
  assert.equal(node(dir,'scripts/build-release.mjs').status,1);
  assert.equal(await readFile(path.join(outside,'marker'),'utf8'),'untouched');
});

test('audit rejects corrupted checksum, truncation and hidden nonzero padding', async t => {
  const dir = await fixture(t);
  assert.equal(node(dir,'scripts/build-release.mjs').status,0);
  const entries=await Promise.all(allowed.map(async name=>['package/'+name,await readFile(path.join(dir,'.release/package',name))]));
  const raw=gunzipSync(tar(entries));
  const checksum=Buffer.from(raw); checksum[100]=0;
  const padding=Buffer.from(raw); padding[512+entries[0][1].length]=65;
  for (const [i,bytes] of [checksum,raw.subarray(0,-1024),padding].entries()) {
    const archive=path.join(dir,`corrupt-${i}.tgz`); await writeFile(archive,gzipSync(bytes));
    const result=node(dir,'scripts/audit-tarball.mjs',archive);
    assert.equal(result.status,1,`corruption ${i}: ${result.stdout}`);
  }
});
