import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executePluginCommand } from '@pb/carousel-harness/plugin';

const harnessPackageRoot = await realpath(fileURLToPath(new URL('../node_modules/@pb/carousel-harness/', import.meta.url)));
const allowed = new Set(['command', 'dataDir', 'input']);

export async function executeHarnessCommand(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
      || typeof options.command !== 'string'
      || typeof options.dataDir !== 'string' || !path.isAbsolute(options.dataDir)
      || Object.keys(options).some(key => !allowed.has(key))) {
    throw new TypeError('Harness request requires command and an absolute dataDir.');
  }
  return executePluginCommand({
    command: options.command,
    dataDir: options.dataDir,
    packageRoot: harnessPackageRoot,
    input: options.input ?? {},
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) {
      throw new TypeError('Usage: node scripts/harness-bridge.mjs <absolute-request.json>');
    }
    const request = JSON.parse(await readFile(process.argv[2], 'utf8'));
    process.stdout.write(`${JSON.stringify(await executeHarnessCommand(request), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error?.code ?? 'INVALID_ARGUMENT',
      message: error?.message ?? 'Harness request failed.',
    })}\n`);
    process.exitCode = error?.exitCode ?? 1;
  }
}
