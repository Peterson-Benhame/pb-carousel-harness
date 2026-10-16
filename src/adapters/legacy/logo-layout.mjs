import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { validateLogoConfig, validateLogoPng, selectLogoVariant, MAX_LOGO_BYTES } from '../../domain/logo-policy.mjs';
import { PublicError, invalidArgument } from '../../domain/errors.mjs';

export const LEGACY_LOGO_SLOT = Object.freeze({ x: 756, y: 64, width: 240, height: 80 });
const prepared = new WeakSet();
const invalid = () => new PublicError('LOGO_LAYOUT_INVALID', 'Logotipo não cabe com proteção e altura visível mínimas nesta superfície.');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const rgb = background => {
  if (typeof background !== 'string' || !/^#[\da-f]{6}$/iu.test(background)) throw invalidArgument('Superfície de logotipo inválida.');
  return [1, 3, 5].map(offset => parseInt(background.slice(offset, offset + 2), 16));
};
/** Historical theme classification from the approved quality contract. It does
 * not alter colors, infer authorization for another surface, or assess contrast.
 */
export function legacySurface(background) {
  const [r, g, b] = rgb(background).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 0.5 ? 'light' : 'dark';
}
function visibleBox(data, info, background) {
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * info.channels;
    if (background.some((channel, index) => data[offset + index] !== channel)) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
/** Internal, in-memory primitive. Inputs must already belong to the selected
 * frozen brand; the context binds IDs/hashes to that snapshot. Never reads paths,
 * rewrites originals or promises aesthetic/contrast qualification (Q06).
 */
export async function prepareLogoLayout({ logo, theme, logos, protection = 12, minimumHeight = 24 } = {}) {
  if (!logo || typeof logo !== 'object' || Array.isArray(logo)) throw invalidArgument('Configuração de logotipo inválida.');
  validateLogoConfig(logo);
  if (!logo.enabled) return null;
  // Capture and validate every layout input before the first await. The stricter
  // per-layout limits may never weaken the T19 invariants, even if the caller
  // mutates its configuration while PNG validation is pending.
  const slot = LEGACY_LOGO_SLOT;
  if (!Number.isFinite(protection) || protection < 12 || !Number.isFinite(minimumHeight) || minimumHeight < 24 || 2 * protection >= Math.min(slot.width, slot.height)) throw invalid();
  const background = theme?.background, surface = legacySurface(background), id = selectLogoVariant(logo, surface);
  const matches = Array.isArray(logos) ? logos.filter(asset => asset?.id === id) : [];
  if (!matches.length) throw new PublicError('RESOURCE_MISSING', 'PNG de logotipo autorizado ausente.');
  if (matches.length !== 1 || !Buffer.isBuffer(matches[0].bytes) || matches[0].bytes.length > MAX_LOGO_BYTES) {
    throw new PublicError('ASSET_INVALID', 'Recurso de logotipo inválido ou ambíguo.');
  }
  // Copy before the first await. No later caller mutation can replace the bytes.
  const bytes = Buffer.from(matches[0].bytes), expectedHash = matches[0].sha256;
  if (digest(bytes) !== expectedHash) throw new PublicError('ASSET_HASH_MISMATCH', 'PNG de logotipo não corresponde à identidade congelada.');
  const descriptor = await validateLogoPng(bytes);
  const inner = { x: slot.x + protection, y: slot.y + protection, width: slot.width - 2 * protection, height: slot.height - 2 * protection };
  const scale = Math.min(inner.width / descriptor.width, inner.height / descriptor.height);
  const image = { x: inner.x + (inner.width - descriptor.width * scale) / 2,
    y: inner.y + (inner.height - descriptor.height * scale) / 2, width: descriptor.width * scale, height: descriptor.height * scale };
  // Measure visible ink on this exact flat surface, including alpha. A zero
  // 8-bit channel delta is technically absent, not an opacity/contrast rating.
  const source = await sharp(bytes).flatten({ background }).toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const ink = visibleBox(source.data, source.info, rgb(background));
  if (!ink || ink.height * scale < minimumHeight) throw invalid();
  const visible = { x: image.x + ink.x * scale, y: image.y + ink.y * scale, width: ink.width * scale, height: ink.height * scale };
  const dataUri = `data:image/png;base64,${bytes.toString('base64')}`;
  const proof = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="${background}"/><image href="${dataUri}" x="${image.x - slot.x}" y="${image.y - slot.y}" width="${image.width}" height="${image.height}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const rendered = await sharp(Buffer.from(proof)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rasterInk = visibleBox(rendered.data, rendered.info, rgb(background));
  if (!rasterInk || rasterInk.height < minimumHeight) throw invalid();
  const rasterVisible = { ...rasterInk, x: slot.x + rasterInk.x, y: slot.y + rasterInk.y };
  const result = Object.freeze({ id, sha256: descriptor.sha256, surface, background, dataUri, slot,
    inner: Object.freeze(inner), image: Object.freeze(image), visible: Object.freeze(visible), rasterVisible: Object.freeze(rasterVisible) });
  prepared.add(result);
  return result;
}
/** No JSON object or arbitrary data URI can impersonate validated logo bytes. */
export function assertLogoLayout(layout, { logo, theme }) {
  if (!logo?.enabled) return null;
  if (!prepared.has(layout) || layout.background !== theme.background
      || layout.surface !== legacySurface(theme.background) || logo.variants[layout.surface] !== layout.id) throw invalid();
  return layout;
}
/** Rectangles are actual glyph ink or placed asset canvases, in slide-local
 * coordinates. Touching is permitted; any positive intersection is refused.
 */
export function assertLogoClearance(layout, occupied) {
  if (!layout) return;
  if (!prepared.has(layout) || !Array.isArray(occupied)) throw invalid();
  const slot = layout.slot;
  for (const box of occupied) {
    if (!box || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key])) || box.width < 0 || box.height < 0) throw invalid();
    if (box.width && box.height && box.x < slot.x + slot.width && box.x + box.width > slot.x
        && box.y < slot.y + slot.height && box.y + box.height > slot.y) {
      throw new PublicError('LOGO_LAYOUT_CONFLICT', 'Conteúdo ou asset invade o espaço protegido do logotipo.');
    }
  }
}
