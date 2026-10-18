import manifest from '../../../package.json' with { type: 'json' };
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { invalidArgument, toPublicError } from '../../domain/errors.mjs';
import { failure, success } from '../../domain/protocol.mjs';
import { parseArgs } from './parse-args.mjs';
import { writeOutput } from './output.mjs';

const identity = { name: manifest.name, version: manifest.version };
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const help = {
  ...identity,
  usage: 'peterson-carousel <comando> --data-dir <caminho> [--request <arquivo.json>] [--json]',
  options: [
    { flags: ['doctor'], description: 'Diagnosticar runtime e memória local sem alterar dados.' },
    { flags: ['init'], description: 'Inicializar a memória SQLite na raiz selecionada.' },
    { flags: ['brand.apply'], description: 'Propor e confirmar uma alteração permanente de marca.' },
    { flags: ['brand.get'], description: 'Consultar uma marca persistida.' },
    { flags: ['brand.list'], description: 'Listar marcas persistidas.' },
    { flags: ['run.create'], description: 'Criar uma execução pelos serviços existentes.' },
    { flags: ['run.get', 'run.list', 'run.runtime'], description: 'Consultar execução e próxima ação verificável.' },
    { flags: ['input.save', 'plan.save'], description: 'Salvar entradas e plano pelos contratos existentes.' },
    { flags: ['approval.request', 'approval.get', 'approval.decide', 'approval.verify'], description: 'Solicitar, confirmar localmente e verificar consentimento.' },
    { flags: ['preview', 'render.final'], description: 'Executar render de prévia ou final pelos gates existentes.' },
    { flags: ['validate'], description: 'Validar a renderização final registrada.' },
    { flags: ['review.apply'], description: 'Apresentar pixels e registrar revisão editorial local.' },
    { flags: ['package'], description: 'Empacotar uma execução com revisão final válida.' },
    { flags: ['--data-dir'], description: 'Selecionar explicitamente a raiz da memória local.' },
    { flags: ['--request'], description: 'Ler a requisição do comando em um arquivo JSON.' },
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

export async function main(args = process.argv.slice(2), streams = {}) {
  // Detect the exact JSON flag before parsing so even invalid invocations keep
  // the requested protocol, regardless of argument order. Malformed flags fail.
  const json = args.includes('--json');
  try {
    const { command, dataDir, requestFile } = parseArgs(args);
    let input = {};
    if (requestFile !== undefined) {
      try { input = JSON.parse(await readFile(requestFile, 'utf8')); }
      catch { throw invalidArgument('Não foi possível ler uma requisição JSON válida.'); }
    }
    const data = command === 'version'
      ? identity
      : command === 'help'
        ? help
        : await (await import('../local/commands.mjs')).executeLocalCommand({
          command, dataDir, packageRoot, input,
          terminal: { input: streams.input ?? process.stdin, output: streams.stderr ?? process.stderr, argv: args },
        });
    const text = command === 'version' ? `${identity.name} ${identity.version}` : command === 'help' ? helpText : JSON.stringify(data, null, 2);
    writeOutput(success(data), { ...streams, json, text });
    return 0;
  } catch (cause) {
    const error = toPublicError(cause);
    writeOutput(failure(error), { ...streams, json });
    return error.exitCode;
  }
}
