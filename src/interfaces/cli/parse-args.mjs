import { invalidArgument } from '../../domain/errors.mjs';

const FLAGS = new Map([
  ['--help', 'help'], ['-h', 'help'],
  ['--version', 'version'], ['-v', 'version'],
  ['--json', 'json'],
]);

const COMMANDS = new Set([
  'doctor', 'init', 'brand.apply', 'brand.get', 'brand.list',
  'run.create', 'run.get', 'run.list', 'run.runtime',
  'input.save', 'plan.save',
  'approval.request', 'approval.get', 'approval.decide', 'approval.verify',
  'preview', 'render.final', 'validate', 'review.apply', 'package',
]);

function optionValue(args, index, message) {
  const value = args[index + 1];
  if (typeof value !== 'string' || value.startsWith('-')) throw invalidArgument(message);
  return value;
}

export function parseArgs(args) {
  const seen = new Set();
  let command = null, dataDir, requestFile;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--data-dir') {
      if (dataDir !== undefined) throw invalidArgument('Informe --data-dir uma única vez com um caminho.');
      dataDir = optionValue(args, index, 'Informe --data-dir uma única vez com um caminho.');
      index += 1;
      continue;
    }
    if (arg === '--request') {
      if (requestFile !== undefined) throw invalidArgument('Informe --request uma única vez com um arquivo JSON.');
      requestFile = optionValue(args, index, 'Informe --request uma única vez com um arquivo JSON.');
      index += 1;
      continue;
    }
    const flag = FLAGS.get(arg);
    if (!flag) {
      if (!COMMANDS.has(arg) || command) throw invalidArgument('Argumento ou comando não reconhecido.');
      command = arg;
      continue;
    }
    if (seen.has(flag)) throw invalidArgument('Uma opção foi informada mais de uma vez.');
    seen.add(flag);
  }
  if (seen.has('help') && seen.has('version')) {
    throw invalidArgument('Escolha apenas uma opção: --help ou --version.');
  }
  if ((seen.has('help') || seen.has('version')) && command) throw invalidArgument('Não combine comando com --help ou --version.');
  return {
    command: seen.has('version') ? 'version' : seen.has('help') || !command ? 'help' : command,
    json: seen.has('json'),
    dataDir,
    requestFile,
  };
}
