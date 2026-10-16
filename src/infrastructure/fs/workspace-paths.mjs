import path from 'node:path';
import { invalidArgument } from '../../domain/errors.mjs';
import { validatePathSegment } from '../../domain/identifiers.mjs';

function localPath(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value
      || /^[\\/]{2}/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)
      || process.platform !== 'win32' && /^[a-z]:/i.test(value)) {
    throw invalidArgument('Raiz de dados local inválida.');
  }
  const normalized = value.replaceAll('\\', '/');
  const components = normalized.replace(/^[a-z]:\//i, '/').split('/');
  for (const segment of components) {
    if (segment && segment !== '.' && segment !== '..') validatePathSegment(segment);
  }
  return normalized;
}

function fullyQualified(value) {
  return process.platform === 'win32' ? /^[a-z]:\//i.test(value) : path.isAbsolute(value);
}

/** Pure resolution: never creates directories or probes/initializes a workspace. */
export function resolveWorkspaceRoot({ dataDir, env = process.env, cwd = process.cwd() } = {}) {
  let selected = dataDir ?? env.CAROUSEL_DATA_DIR;
  if (selected === undefined) {
    const local = localPath(env.LOCALAPPDATA);
    if (!fullyQualified(local)) throw invalidArgument('LOCALAPPDATA precisa ser absoluto e qualificado.');
    selected = path.join(local, 'PetersonCarouselHarness');
  }
  const chosen = localPath(selected);
  if (fullyQualified(chosen)) return path.normalize(chosen);
  const base = localPath(cwd);
  if (!fullyQualified(base)) throw invalidArgument('Diretório da chamada precisa ser absoluto e qualificado.');
  return path.resolve(base, chosen);
}
