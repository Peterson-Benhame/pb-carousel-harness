import { invalidArgument } from '../../domain/errors.mjs';

const FLAGS = new Map([
  ['--help', 'help'], ['-h', 'help'],
  ['--version', 'version'], ['-v', 'version'],
  ['--json', 'json'],
]);

export function parseArgs(args) {
  const seen = new Set();
  for (const arg of args) {
    const flag = FLAGS.get(arg);
    if (!flag) throw invalidArgument('Argumento ou comando não reconhecido.');
    if (seen.has(flag)) throw invalidArgument('Uma opção foi informada mais de uma vez.');
    seen.add(flag);
  }
  if (seen.has('help') && seen.has('version')) {
    throw invalidArgument('Escolha apenas uma opção: --help ou --version.');
  }
  return { command: seen.has('version') ? 'version' : 'help', json: seen.has('json') };
}
