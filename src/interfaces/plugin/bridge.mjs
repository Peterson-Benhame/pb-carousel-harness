import { invalidArgument } from '../../domain/errors.mjs';
import { exactKeys } from '../../domain/brand-schema.mjs';
import { executePluginLocalCommand, resolveLocalContext } from '../local/commands.mjs';

export { resolveLocalContext };

export async function executePluginCommand(options = {}) {
  exactKeys(options, ['command', 'packageRoot'], ['dataDir', 'input']);
  if (typeof options.packageRoot !== 'string') {
    throw invalidArgument('Ponte do plugin exige packageRoot explícito.');
  }
  return executePluginLocalCommand({
    command: options.command,
    dataDir: options.dataDir,
    packageRoot: options.packageRoot,
    input: options.input,
  });
}
