import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { PublicError, invalidArgument } from '../../domain/errors.mjs';
import { validatePathSegment } from '../../domain/identifiers.mjs';
import { resolveWorkspaceRoot } from './workspace-paths.mjs';

const denied = () => new PublicError('PATH_NOT_CONFINED', 'Caminho não confinado à raiz local autorizada.');

export function normalizeReference(value) {
  if (typeof value !== 'string') throw invalidArgument('Referência relativa inválida.');
  const parts = value.replaceAll('\\', '/').split('/');
  parts.forEach(validatePathSegment);
  return parts.join('/');
}

// Walk from the volume root, including every existing ancestor of the workspace.
// Deliberately disallow ALL links/junctions, even links pointing inside the root.
async function checkAncestors(target, requireDirectory) {
  const volume = path.parse(target).root;
  const segments = target.slice(volume.length).split(path.sep).filter(Boolean);
  let current = volume;
  const candidates = [volume, ...segments.map(segment => (current = path.join(current, segment)))];
  for (let index = 0; index < candidates.length; index++) {
    current = candidates[index];
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (error.code === 'ENOENT') return; // Missing descendants are never created here.
      throw denied();
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && (requireDirectory || index < candidates.length - 1))
        || (!stat.isDirectory() && !stat.isFile())) throw denied();
    let real;
    try { real = await realpath(current); } catch { throw denied(); }
    if (path.relative(current, real) !== '') throw denied();
  }
}

/** A local guard, not a sandbox against hostile concurrent processes. */
export async function createConfinedRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw invalidArgument('Raiz precisa ser absoluta.');
  const absoluteRoot = resolveWorkspaceRoot({ dataDir: root });
  await checkAncestors(absoluteRoot, true);
  async function resolve(reference) {
    const relative = normalizeReference(reference);
    const target = path.join(absoluteRoot, ...relative.split('/'));
    const delta = path.relative(absoluteRoot, target);
    if (!delta || delta === '..' || delta.startsWith(`..${path.sep}`) || path.isAbsolute(delta)) throw denied();
    await checkAncestors(absoluteRoot, true);
    await checkAncestors(target, false);
    return target;
  }
  return Object.freeze({
    root: absoluteRoot,
    resolve,
    // Call for each access/promotion, never cache a validated path as authorization.
    // The callback should immediately perform its filesystem operation. No lock or
    // handle-relative OS API is provided; changes during/after checks can race it.
    async withPaths(references, access) {
      if (!Array.isArray(references) || !references.length || typeof access !== 'function') {
        throw invalidArgument('Acesso confinado inválido.');
      }
      const resolved = [];
      for (const reference of references) resolved.push(await resolve(reference));
      return access(...resolved);
    },
  });
}
