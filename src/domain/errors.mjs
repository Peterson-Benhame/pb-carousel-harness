/** Only fixed, public messages belong in this error type. Never include raw input. */
export class PublicError extends Error {
  constructor(code, message, { exitCode = 1, nextAction = null } = {}) {
    super(message);
    this.name = 'PublicError';
    this.code = code;
    this.exitCode = exitCode;
    this.nextAction = nextAction;
  }
}

export function invalidArgument(message) {
  return new PublicError('INVALID_ARGUMENT', message, {
    exitCode: 2,
    nextAction: 'peterson-carousel --help',
  });
}

export function toPublicError(error) {
  if (error instanceof PublicError) return error;
  return new PublicError('INTERNAL_ERROR', 'Não foi possível concluir o comando.');
}
