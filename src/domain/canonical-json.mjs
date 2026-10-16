import { createHash } from 'node:crypto';
import { PublicError } from './errors.mjs';

export const CANONICAL_VERSION = 1;
export function assertCanonicalVersion(version) {
  if (version !== CANONICAL_VERSION) throw new PublicError('CANONICAL_VERSION_UNSUPPORTED','Versão de canonização não suportada.');
}
/** v1: UTF-16 key ordering, JSON number/string encoding, array order unchanged.
 * Only plain JSON data is accepted: no coercion, getters, toJSON or omitted values.
 */
export function canonicalJson(value, version = CANONICAL_VERSION) {
  assertCanonicalVersion(version);
  const ancestors = new Set();
  const invalid = () => { throw new PublicError('INVALID_JSON_VALUE','Valor incompatível com JSON canônico.'); };
  function encode(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') { if (!Number.isFinite(item)) invalid(); return JSON.stringify(item); }
    if (typeof item !== 'object' || ancestors.has(item)) invalid();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || (key !== 'length' || !array) && (!descriptors[key].enumerable || !('value' in descriptors[key])))) invalid();
    ancestors.add(item);
    let result;
    if (array) {
      if (Object.keys(item).length !== item.length) invalid();
      const parts=[];
      for (let i=0;i<item.length;i++) { if (!Object.hasOwn(descriptors,String(i))) invalid(); parts.push(encode(descriptors[i].value)); }
      result=`[${parts.join(',')}]`;
    } else result=`{${Object.keys(descriptors).sort().map(key=>`${JSON.stringify(key)}:${encode(descriptors[key].value)}`).join(',')}}`;
    ancestors.delete(item);
    return result;
  }
  return encode(value);
}
export function canonicalHash(value, version = CANONICAL_VERSION) {
  return createHash('sha256').update(canonicalJson(value,version),'utf8').digest('hex');
}
