import { copyFile, lstat, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Exact files, never recursive source directories. Expand only in a reviewed task.
export const RELEASE_FILES = Object.freeze([
  'ATTRIBUTION.md', 'bin/peterson-carousel.mjs', 'docs/cli.md',
  'shared/defaults/brand.json', 'shared/defaults/themes.json',
  'src/domain/errors.mjs', 'src/domain/protocol.mjs',
  'src/interfaces/cli/main.mjs', 'src/interfaces/cli/output.mjs',
  'src/interfaces/cli/parse-args.mjs',
].sort());
export const NEUTRAL_BRAND = Object.freeze({ language: 'pt-BR', slideWidth: 1080, slideHeight: 1350 });

async function regularPath(root, relative, optional = false) {
  const parts = relative.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const target = path.join(root, ...parts.slice(0,i));
    let stat;
    try { stat = await lstat(target); } catch (error) {
      if (optional && error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink() || (i < parts.length && !stat.isDirectory())) {
      throw new Error(`Unsafe staging/source path: ${relative}`);
    }
    if (!optional && i === parts.length && !stat.isFile()) throw new Error(`Not a regular file: ${relative}`);
  }
}

export async function buildRelease(root = fileURLToPath(new URL('../', import.meta.url))) {
  for (const relative of ['package.json', ...RELEASE_FILES]) await regularPath(root, relative);
  const source = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (source.private !== true) throw new Error('Release must remain private while licensing is pending.');
  // T03 is CLI-only: legacy/native dependencies stay untouched in the source manifest.
  const manifest = {
    name: source.name, version: source.version, private: true, license: 'UNLICENSED',
    type: 'module', bin: source.bin, engines: source.engines, files: [...RELEASE_FILES],
  };
  await regularPath(root, '.release/package', true);
  const stage = path.join(root, '.release/package');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  for (const relative of RELEASE_FILES) {
    const destination = path.join(stage, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, relative), destination);
  }
  await chmod(path.join(stage, 'bin/peterson-carousel.mjs'), 0o755);
  await writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2)+'\n');
  return stage;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/build-release.mjs');
    console.log(await buildRelease());
  } catch (error) { console.error(`Build failed: ${error.message}`); process.exitCode = 1; }
}
