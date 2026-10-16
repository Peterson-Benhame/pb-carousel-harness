import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASE_FILES, NEUTRAL_BRAND } from './build-release.mjs';

const EXPECTED = ['package.json', ...RELEASE_FILES].map(name => `package/${name}`).sort();
const fail = message => { throw new Error(message); };
const field = bytes => bytes.toString('utf8').replace(/\0.*$/s, '');
function octal(bytes) {
  const value = field(bytes).trim();
  if (!/^[0-7]+$/.test(value)) fail('Invalid TAR numeric field');
  const result = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(result)) fail('Oversized TAR numeric field');
  return result;
}

// Deliberately strict subset: npm's short regular-file ustar members only.
// PAX/GNU extensions, links and directories are unnecessary for this minimal package.
export function inspectTarball(compressed) {
  const bytes = gunzipSync(compressed, { maxOutputLength: 8 * 1024 * 1024 });
  const files = new Map();
  let offset = 0, terminated = false;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) {
      if (bytes.length - offset < 1024 || !bytes.subarray(offset).every(value => value === 0)) fail('Invalid TAR terminator');
      terminated = true; break;
    }
    const checksum = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    if (octal(header.subarray(148,156)) !== checksum) fail('Invalid TAR checksum');
    if (field(header.subarray(257,263)) !== 'ustar') fail('Unsupported TAR format');
    const name = field(header.subarray(0,100));
    if (field(header.subarray(345,500)) || !EXPECTED.includes(name)) fail(`Unexpected TAR member: ${name}`);
    if (files.has(name)) fail(`Duplicate TAR member: ${name}`);
    if (![0,48].includes(header[156])) fail(`Non-regular TAR member: ${name}`);
    const size = octal(header.subarray(124,136));
    const start = offset + 512, end = start + size;
    const next = start + Math.ceil(size / 512) * 512;
    if (next > bytes.length) fail('Truncated TAR member');
    if (!bytes.subarray(end, next).every(value => value === 0)) fail('Nonzero TAR padding');
    files.set(name, bytes.subarray(start, end));
    offset = next;
  }
  if (!terminated || files.size !== EXPECTED.length) fail('Incomplete TAR archive');
  const json = name => JSON.parse(files.get(`package/${name}`).toString('utf8'));
  const manifest = json('package.json');
  const keys = ['name','version','private','license','type','bin','engines','files'];
  if (Object.keys(manifest).some(key=>!keys.includes(key)) || keys.some(key=>!Object.hasOwn(manifest,key))) fail('Unexpected manifest fields (scripts/dependencies are forbidden)');
  if (manifest.private !== true || manifest.license !== 'UNLICENSED') fail('Licensing/publication gate missing');
  if (manifest.name !== '@pb/carousel-harness' || manifest.type !== 'module' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) fail('Invalid package identity');
  if (!isDeepStrictEqual(manifest.bin, {'peterson-carousel':'bin/peterson-carousel.mjs'}) || !isDeepStrictEqual(manifest.engines,{node:'24.21.0'})) fail('Invalid CLI/runtime metadata');
  if (!isDeepStrictEqual(manifest.files,RELEASE_FILES)) fail('Invalid files allowlist');
  if (!isDeepStrictEqual(json('shared/defaults/brand.json'),NEUTRAL_BRAND) || !isDeepStrictEqual(json('shared/defaults/themes.json'),{})) fail('Defaults must be neutral');
  if (!files.get('package/ATTRIBUTION.md').toString('utf8').includes('Do not publish, redistribute, or otherwise distribute')) fail('Distribution restriction missing');
  return { files, members: [...files.keys()].sort(), sha256: createHash('sha256').update(compressed).digest('hex') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) fail('Usage: node scripts/audit-tarball.mjs <internal.tgz>');
    const { members, sha256 } = inspectTarball(await readFile(process.argv[2]));
    console.log(JSON.stringify({ ok: true, members, sha256, distribution: 'blocked-pending-licensing' }, null, 2));
  } catch (error) { console.error(`Audit failed: ${error.message}`); process.exitCode = 1; }
}
