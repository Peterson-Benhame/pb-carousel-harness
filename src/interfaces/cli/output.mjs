/** stdout is the protocol channel; diagnostics always go to stderr. */
export function writeOutput(result, { json, stdout = process.stdout, stderr = process.stderr, text = '' } = {}) {
  if (json) stdout.write(`${JSON.stringify(result)}\n`);
  else if (result.ok) stdout.write(`${text}\n`);

  if (!result.ok) {
    stderr.write(`${result.error.code}: ${result.error.message}\n`);
    if (result.nextAction) stderr.write(`Próxima ação: ${result.nextAction}\n`);
  }
}
