import sharp from 'sharp';
import { sha256 } from '../../src/infrastructure/resources.mjs';
import { config, snapshot } from './legacy-render-fixture.mjs';
export const DARK_LOGO_ID = '11111111-1111-4111-8111-111111111111';
export const LIGHT_LOGO_ID = '22222222-2222-4222-8222-222222222222';
export const themeFor = surface => surface === 'light'
  ? { background: '#F3F0E8', text: '#191919', muted: '#4A4A4A', accent: '#B74718', topics: [] }
  : { background: '#07111F', text: '#F4F7FB', muted: '#B9C7D8', accent: '#32D5FF', topics: [] };
export async function png({ width = 216, height = 56, ink = { x: 0, y: 0, width, height }, color = '#DDEEFF', alpha = 1 } = {}) {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${ink.x}" y="${ink.y}" width="${ink.width}" height="${ink.height}" fill="${color}" opacity="${alpha}"/></svg>`)).png().toBuffer();
}
export async function syntheticLogo(surface) {
  const color = surface === 'light' ? '#24354B' : '#DDEEFF';
  const bytes = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><path fill="${color}" d="M20 20h60v14H34v12h46v34H20V66h46V58H20Z M100 20h50v60h-14V34h-22v46h-14Z M170 20h60v14h-46v12h38v14h-38v20h-14Z M250 20h50v14h-18v46h-14V34h-18Z"/></svg>`)).png().toBuffer();
  return { id: surface === 'light' ? LIGHT_LOGO_ID : DARK_LOGO_ID, sha256: sha256(bytes), bytes };
}
export function logoConfig(extra = {}) {
  return { enabled: true, variants: { light: LIGHT_LOGO_ID, dark: DARK_LOGO_ID }, protection: 12, minimumHeight: 24, ...extra };
}
export async function logoSnapshot(surface = 'dark') {
  const brand = config();
  if (surface === 'light') { brand.name = 'Marca sintética clara'; brand.profile = '@marca_clara'; }
  brand.logo = logoConfig(); brand.themes = { [`synthetic-${surface}`]: themeFor(surface) };
  const logoData = await Promise.all(['light', 'dark'].map(syntheticLogo));
  const frozen = await snapshot(brand, `synthetic-${surface}`);
  frozen.logos = logoData.map(({ id, sha256 }, i) => ({ surface: ['light', 'dark'][i], id, sha256 }));
  return { frozen, brand, logoData };
}
