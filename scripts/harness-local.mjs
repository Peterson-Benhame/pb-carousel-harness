import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedHash = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32';
const actualHash = createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
if (process.version !== 'v24.21.0' || actualHash !== expectedHash) {
  throw new Error('Node portátil autorizado não confere com versão e hash registrados.');
}

const [mode, ...forwardArgs] = process.argv.slice(2);
if (!['bridge', 'cli'].includes(mode)) throw new TypeError('Modo deve ser bridge ou cli.');
const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const target = mode === 'bridge'
  ? path.join(scriptsRoot, 'harness-bridge.mjs')
  : path.join(scriptsRoot, '..', 'node_modules', '@pb', 'carousel-harness', 'bin', 'peterson-carousel.mjs');
const result = spawnSync(process.execPath, [target, ...forwardArgs], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
