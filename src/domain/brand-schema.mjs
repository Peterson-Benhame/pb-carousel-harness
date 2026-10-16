import { validateLogoConfig } from './logo-policy.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { invalidArgument } from './errors.mjs';

const invalid = () => { throw invalidArgument('Configuração de marca inválida ou não suportada.'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

export function exactKeys(value, required, optional = []) {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid();
}

function texts(value) {
  if (!Array.isArray(value) || value.some(item => !text(item))) invalid();
}

/** Historical v1 stays unchanged. V2 adds only declared palette bindings and
 * an optional candidate accent; accepting config never grants font-use permission.
 * BrandMemory still requires confirmation of persistent changes.
 */
export function validateBrandConfig(value) {
  const config = JSON.parse(canonicalJson(value));
  exactKeys(config, [
    'name', 'profile', 'language', 'audience', 'voice', 'preferences', 'fonts', 'themes', 'logo',
    'slideWidth', 'slideHeight', 'minimumSlideCount', 'maximumSlideCount', 'profileImage',
  ], ['configVersion']);
  const v2 = Object.hasOwn(config, 'configVersion');
  if (v2 && config.configVersion !== 2) invalid();
  if (!text(config.name) || typeof config.profile !== 'string' || !text(config.language)
      || (config.audience !== null && !text(config.audience))
      || (config.voice !== null && !text(config.voice))) invalid();
  texts(config.preferences);
  exactKeys(config.fonts, ['title', 'body', 'mono'], v2 ? ['accent'] : []);
  if (Object.hasOwn(config.fonts, 'accent') && config.fonts.accent !== 'nimbus-roman-italic@1') invalid();
  if (config.fonts.title !== 'Anton' || config.fonts.body !== 'Manrope'
      || config.fonts.mono !== 'JetBrains Mono') invalid();

  if (!object(config.themes) || Object.keys(config.themes).length === 0) invalid();
  for (const [name, theme] of Object.entries(config.themes)) {
    if (!text(name)) invalid();
    exactKeys(theme, ['background', 'text', 'muted', 'accent', 'topics'],
      v2 ? ['secondaryAccent', 'surfaceBindings'] : ['secondaryAccent']);
    texts(theme.topics);
    for (const key of ['background', 'text', 'muted', 'accent', 'secondaryAccent']) {
      if (key in theme && !/^#[0-9a-fA-F]{6}$/.test(theme[key])) invalid();
    }
    if (Object.hasOwn(theme, 'surfaceBindings')) {
      exactKeys(theme.surfaceBindings, [], ['light', 'dark']);
      if (!Object.keys(theme.surfaceBindings).length) invalid();
      for (const binding of Object.values(theme.surfaceBindings)) {
        exactKeys(binding, ['background', 'text', 'muted', 'accent'], ['secondaryAccent']);
        for (const token of Object.values(binding)) {
          if (!['background', 'text', 'muted', 'accent', 'secondaryAccent'].includes(token)
              || !Object.hasOwn(theme, token)) invalid();
        }
      }
    }
  }
  exactKeys(config.logo, ['enabled', 'variants', 'protection', 'minimumHeight']);
  validateLogoConfig(config.logo);
  if (config.slideWidth !== 1080 || config.slideHeight !== 1350
      || !Number.isSafeInteger(config.minimumSlideCount) || !Number.isSafeInteger(config.maximumSlideCount)
      || config.minimumSlideCount < 1 || config.maximumSlideCount < config.minimumSlideCount
      || config.profileImage !== '') invalid();
  return config;
}

export function legacyBrandConfig({ name, legacyBrand, legacyThemes }) {
  // Copy supplied values without reading installation files or inventing identity.
  const brand = JSON.parse(canonicalJson(legacyBrand));
  exactKeys(brand, [
    'profile', 'language', 'fonts', 'slideWidth', 'slideHeight', 'minimumSlideCount',
    'maximumSlideCount', 'profileImage',
  ]);
  return validateBrandConfig({
    ...brand, name, themes: legacyThemes, audience: null, voice: null, preferences: [],
    logo: { enabled: false, variants: {}, protection: 12, minimumHeight: 24 },
  });
}
