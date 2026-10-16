import manifest from '../../../package.json' with { type: 'json' };
import { toPublicError } from '../../domain/errors.mjs';
import { failure, success } from '../../domain/protocol.mjs';
import { parseArgs } from './parse-args.mjs';
import { writeOutput } from './output.mjs';

const identity = { name: manifest.name, version: manifest.version };
const help = {
  ...identity,
  usage: 'peterson-carousel [--help | --version] [--json]',
  options: [
    { flags: ['--help', '-h'], description: 'Mostrar esta ajuda.' },
    { flags: ['--version', '-v'], description: 'Mostrar a versão do pacote.' },
    { flags: ['--json'], description: 'Retornar um envelope JSON (protocolo 1).' },
  ],
};

const helpText = [
  `${identity.name} ${identity.version}`,
  '',
  `Uso: ${help.usage}`,
  '',
  ...help.options.map(option => `  ${option.flags.join(', ')}  ${option.description}`),
  '',
  'Sem argumentos, mostra esta ajuda. Nenhum diretório de dados é criado.',
].join('\n');

export function main(args = process.argv.slice(2), streams = {}) {
  // Detect the exact JSON flag before parsing so even invalid invocations keep
  // the requested protocol, regardless of argument order. Malformed flags fail.
  const json = args.includes('--json');
  try {
    const { command } = parseArgs(args);
    const data = command === 'version' ? identity : help;
    const text = command === 'version' ? `${identity.name} ${identity.version}` : helpText;
    writeOutput(success(data), { ...streams, json, text });
    return 0;
  } catch (cause) {
    const error = toPublicError(cause);
    writeOutput(failure(error), { ...streams, json });
    return error.exitCode;
  }
}
