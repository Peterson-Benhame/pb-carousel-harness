import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { sha256 } from '../../src/infrastructure/resources.mjs';
import { validateLogoPng } from '../../src/domain/logo-policy.mjs';
import { png, syntheticLogo, logoConfig, themeFor, DARK_LOGO_ID } from '../helpers/logo-slot-fixture.mjs';
async function adapter() {
  const module = await import('../../src/adapters/legacy/logo-layout.mjs').catch(error => { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {}; });
  assert.equal(typeof module.prepareLogoLayout, 'function', 'T19 must expose validated protected logo geometry');
  return module;
}
async function layout(bytes, extra = {}) {
  const { prepareLogoLayout } = await adapter();
  return prepareLogoLayout({ logo: logoConfig(), theme: themeFor('dark'), logos: [{ id: DARK_LOGO_ID, sha256: sha256(bytes), bytes }], ...extra });
}
test('logo uses the exact protected slot and proportional full original PNG', async () => {
  const bytes = await png(), before = Buffer.from(bytes), result = await layout(bytes);
  assert.deepEqual(result.slot, { x: 756, y: 64, width: 240, height: 80 });
  assert.deepEqual(result.inner, { x: 768, y: 76, width: 216, height: 56 });
  assert.deepEqual(result.image, { x: 768, y: 76, width: 216, height: 56 });
  assert.equal(result.visible.height, 56); assert.equal(result.surface, 'dark');
  assert.equal(result.sha256, sha256(bytes)); assert.deepEqual(Buffer.from(result.dataUri.split(',')[1], 'base64'), before);
  assert.deepEqual(bytes, before); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.image));
});
test('transparent padding is retained and visible bounding box measures actual ink', async () => {
  const result = await layout(await png({ width: 400, height: 100, ink: { x: 100, y: 20, width: 200, height: 60 } }));
  assert.deepEqual(result.image, { x: 768, y: 77, width: 216, height: 54 });
  assert.ok(Math.abs(result.visible.height - 32.4) < 1e-9);
  assert.ok(Math.abs(result.visible.width - 108) < 1e-9);
  assert.ok(result.visible.x > result.image.x);
});
test('24px visible height passes and the first smaller horizontal fit fails', async () => {
  assert.equal((await layout(await png({ width: 216, height: 24 }))).visible.height, 24);
  await assert.rejects(layout(await png({ width: 217, height: 24 })), { code: 'LOGO_LAYOUT_INVALID' });
  await assert.rejects(layout(await png({ width: 1000, height: 10 })), { code: 'LOGO_LAYOUT_INVALID' });
});
test('a large transparent canvas cannot hide undersized visible ink', async () => {
  await assert.rejects(layout(await png({ width: 216, height: 56, ink: { x: 20, y: 20, width: 100, height: 23 } })), { code: 'LOGO_LAYOUT_INVALID' });
});
test('theme picks its authorized light/dark variant without recoloring or fallback', async () => {
  const { prepareLogoLayout, legacySurface } = await adapter(), logos = await Promise.all(['light', 'dark'].map(syntheticLogo));
  assert.equal(legacySurface('#BBBBBB'), 'dark'); assert.equal(legacySurface('#BCBCBC'), 'light');
  for (const surface of ['light', 'dark']) {
    const result = await prepareLogoLayout({ logo: logoConfig(), theme: themeFor(surface), logos });
    const original = logos.find(item => item.id === logoConfig().variants[surface]);
    assert.equal(result.id, original.id); assert.equal(result.sha256, original.sha256);
    assert.deepEqual(Buffer.from(result.dataUri.split(',')[1], 'base64'), original.bytes);
  }
  await assert.rejects(prepareLogoLayout({ logo: logoConfig({ variants: { light: logos[0].id } }), theme: themeFor('dark'), logos }), { code: 'LOGO_VARIANT_MISSING' });
});
test('off needs no resource or reserved area, including incompatible unused variants', async () => {
  const { prepareLogoLayout, assertLogoClearance } = await adapter();
  const result = await prepareLogoLayout({ logo: logoConfig({ enabled: false }), theme: themeFor('dark'), logos: null });
  assert.equal(result, null); assert.doesNotThrow(() => assertLogoClearance(result, [{ x: 756, y: 64, width: 240, height: 80 }]));
});
test('content and continuity cannot intersect even the protection edge', async () => {
  const { assertLogoClearance } = await adapter(), result = await layout(await png());
  for (const kind of ['content', 'continuity']) {
    assert.throws(() => assertLogoClearance(result, [{ x: 755, y: 80, width: 2, height: 1, kind }]), { code: 'LOGO_LAYOUT_CONFLICT' });
    assert.doesNotThrow(() => assertLogoClearance(result, [{ x: 700, y: 80, width: 56, height: 1, kind }]));
    assert.throws(() => assertLogoClearance(result, [{ x: NaN, y: 64, width: 1, height: 1, kind }]), { code: 'LOGO_LAYOUT_INVALID' });
  }
});
test('mismatched bytes, invalid PNG, missing and ambiguous asset IDs fail closed', async () => {
  const bytes = await png(), asset = { id: DARK_LOGO_ID, sha256: sha256(bytes), bytes };
  await assert.rejects(layout(bytes, { logos: [{ ...asset, sha256: '0'.repeat(64) }] }), { code: 'ASSET_HASH_MISMATCH' });
  await assert.rejects(layout(Buffer.from('<svg/>')), { code: 'ASSET_INVALID' });
  await assert.rejects(layout(bytes, { logos: [] }), { code: 'RESOURCE_MISSING' });
  await assert.rejects(layout(bytes, { logos: [asset, asset] }), { code: 'ASSET_INVALID' });
});
test('copied original bytes are stable across asynchronous PNG validation', async () => {
  const bytes = await png(), expected = sha256(bytes), { prepareLogoLayout } = await adapter();
  const rendering = prepareLogoLayout({ logo: logoConfig(), theme: themeFor('dark'), logos: [{ id: DARK_LOGO_ID, sha256: expected, bytes }] });
  bytes.fill(0); assert.equal((await rendering).sha256, expected);
});
function chunk(type, data) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8);
  let crc = 0xffffffff; for (const byte of b.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, b.length - 4); return b;
}
test('technically invisible 16-bit alpha is valid at import but cannot claim a visible logo', async () => {
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 16; header[9] = 6;
  const pixel = Buffer.from([0, 255, 255, 255, 255, 255, 255, 0, 1]);
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixel)), chunk('IEND', Buffer.alloc(0))]);
  assert.equal((await validateLogoPng(bytes)).transparent, true);
  await assert.rejects(layout(bytes), { code: 'LOGO_LAYOUT_INVALID' });
  await assert.rejects(layout(await png({ color: themeFor('dark').background })), { code: 'LOGO_LAYOUT_INVALID' });
});

test('sparse pixels lost at final render scale cannot fake a 24px visible bounding box', async () => {
  const sharp = (await import('sharp')).default;
  const bytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="0" y="0" width="1" height="1" fill="white"/><rect x="1023" y="1023" width="1" height="1" fill="white"/></svg>')).png().toBuffer();
  await assert.rejects(layout(bytes), { code: 'LOGO_LAYOUT_INVALID' });
});

test('missing logo configuration is a bounded argument error', async () => {
  const { prepareLogoLayout } = await adapter();
  for (const logo of [null, undefined]) await assert.rejects(prepareLogoLayout({ logo, theme: themeFor('dark') }), { code: 'INVALID_ARGUMENT' });
});

test('stricter logo limits cannot be weakened through config mutation during validation', async () => {
  const { prepareLogoLayout } = await adapter(), asset = await syntheticLogo('dark');
  for (const limits of [{ protection: 0, minimumHeight: 24 }, { protection: 12, minimumHeight: 0 }]) {
    const logo = logoConfig();
    const rendering = prepareLogoLayout({ logo, theme: themeFor('dark'), logos: [asset], ...limits });
    logo.protection = 0; logo.minimumHeight = 0; logo.variants.dark = 'changed';
    await assert.rejects(rendering, { code: 'LOGO_LAYOUT_INVALID' });
  }
  const logo = logoConfig(), theme = themeFor('dark'), logos = [asset];
  const rendering = prepareLogoLayout({ logo, theme, logos, protection: 16, minimumHeight: 24 });
  logo.protection = 0; logo.minimumHeight = 0; logo.enabled = false; logo.variants.dark = 'changed';
  theme.background = '#FFFFFF'; logos.length = 0; asset.bytes.fill(0);
  const result = await rendering;
  assert.deepEqual(result.inner, { x: 772, y: 80, width: 208, height: 48 });
  assert.equal(result.surface, 'dark'); assert.equal(result.id, DARK_LOGO_ID);
  assert.ok(result.visible.height >= 24); assert.ok(result.rasterVisible.height >= 24);
});
