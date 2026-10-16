import { randomUUID } from 'node:crypto';
import { invalidArgument } from './errors.mjs';

// Portable Windows-safe components; reject rather than silently sanitize aliases.
const reserved = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
export function validatePathSegment(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..'
      || value.trim() !== value || /[. ]$/.test(value)
      || /[\x00-\x1f\x7f<>:"/\\|?*]/.test(value) || reserved.test(value)) {
    throw invalidArgument('Componente de caminho inválido.');
  }
  return value;
}

export function validateSlug(value) {
  if (typeof value !== 'string' || value.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw invalidArgument('Slug inválido.');
  }
  return validatePathSegment(value);
}

export function createIdentifier() { return randomUUID(); }
export function validateIdentifier(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw invalidArgument('Identificador inválido.');
  }
  return value;
}
