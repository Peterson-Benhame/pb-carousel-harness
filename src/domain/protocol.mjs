export const PROTOCOL_VERSION = 1;

export function success(data) {
  return { protocolVersion: PROTOCOL_VERSION, ok: true, data, error: null, nextAction: null };
}

export function failure(error) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    data: null,
    error: { code: error.code, message: error.message },
    nextAction: error.nextAction,
  };
}
