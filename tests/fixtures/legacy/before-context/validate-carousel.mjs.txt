import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Legacy callers still resolve their configured themes. Harness callers provide
// the frozen context explicitly; importing this module never reads personal data.
const legacyThemes = () => Object.keys(JSON.parse(readFileSync(
  new URL('../shared/themes.json', import.meta.url),
  'utf8',
)));
const requiredFields = [
  'slug',
  'theme',
  'voiceMode',
  'objective',
  'slides',
  'caption',
  'cta',
  'hashtags',
  'altText',
  'sources',
  'continuity',
  'assets',
];
const slideFields = ['index', 'role', 'eyebrow', 'title', 'body', 'visualSlot'];
const topLevelFields = new Set([
  ...requiredFields,
  'slideCountException',
  'slideCountExceptionReason',
]);
const slideAllowedFields = new Set([...slideFields, 'code', 'number', 'imageAlt']);
const sourceFields = new Set(['title', 'url']);
const continuityFields = new Set(['from', 'to', 'assetId']);
const assetFields = new Set(['id', 'path', 'transparent', 'approved']);
const roles = new Set(['cover', 'context', 'content', 'summary', 'cta']);
const visualSlots = new Set(['left', 'right', 'center', 'none']);
const voiceModes = new Set(['default', 'provocative', 'personal-story']);
const objectives = new Set(['save', 'share', 'comment', 'story-share', 'conversion']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasValue = (value) => typeof value === 'string' && value.trim().length > 0;
const hasOwn = (object, key) => Object.hasOwn(object, key) && object[key] !== undefined;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const unexpectedProperties = (object, allowedFields, label) => Object.keys(object)
  .filter((field) => !allowedFields.has(field))
  .sort()
  .map((field) => `${label} has unexpected property: ${field}`);
const isSafeRelativePath = (value) => {
  if (!hasValue(value) || value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
};
const isUrl = (value) => {
  if (!hasValue(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Return contract failures in a stable order so the copy, design, renderer,
 * and packaging steps can present actionable, repeatable feedback.
 *
 * @param {unknown} carousel
 * @returns {string[]}
 */
export const validateCarousel = (carousel, { themes = legacyThemes() } = {}) => {
  if (!isObject(carousel)) return ['carousel must be an object'];

  const errors = [];
  errors.push(...unexpectedProperties(carousel, topLevelFields, 'carousel'));
  for (const field of requiredFields) {
    if (!hasOwn(carousel, field)) errors.push(`missing required field: ${field}`);
  }

  if (hasOwn(carousel, 'slug') && !hasValue(carousel.slug)) {
    errors.push('slug must be a non-empty string');
  }
  if (hasOwn(carousel, 'theme') && !themes.includes(carousel.theme)) {
    errors.push(`theme must be one of: ${themes.join(', ')}`);
  }
  if (hasOwn(carousel, 'voiceMode') && !voiceModes.has(carousel.voiceMode)) {
    errors.push('voiceMode must be one of: default, provocative, personal-story');
  }
  if (hasOwn(carousel, 'objective') && !objectives.has(carousel.objective)) {
    errors.push('objective must be one of: save, share, comment, story-share, conversion');
  }
  if (hasOwn(carousel, 'slideCountException') && typeof carousel.slideCountException !== 'boolean') {
    errors.push('slideCountException must be a boolean');
  }
  if (hasOwn(carousel, 'slideCountExceptionReason')
    && carousel.slideCountException !== true
    && !hasValue(carousel.slideCountExceptionReason)) {
    errors.push('slideCountExceptionReason must be a non-empty string');
  }

  const slides = carousel.slides;
  if (hasOwn(carousel, 'slides') && !Array.isArray(slides)) {
    errors.push('slides must be an array');
  }
  if (Array.isArray(slides)) {
    const hasException = carousel.slideCountException === true
      && hasValue(carousel.slideCountExceptionReason);
    if (carousel.slideCountException === true && !hasValue(carousel.slideCountExceptionReason)) {
      errors.push('slideCountExceptionReason is required when slideCountException is true');
    }
    if (!hasException && (slides.length < 12 || slides.length > 16)) {
      errors.push('slides must contain between 12 and 16 items');
    }

    const indexes = [];
    slides.forEach((slide, slideIndex) => {
      if (!isObject(slide)) {
        errors.push(`slides[${slideIndex}] must be an object`);
        return;
      }
      errors.push(...unexpectedProperties(slide, slideAllowedFields, `slides[${slideIndex}]`));
      for (const field of slideFields) {
        if (!hasOwn(slide, field)) errors.push(`slides[${slideIndex}] missing required field: ${field}`);
      }
      if (Number.isInteger(slide.index) && slide.index > 0) indexes.push(slide.index);
      else if (hasOwn(slide, 'index')) errors.push(`slides[${slideIndex}].index must be a positive integer`);
      if (hasOwn(slide, 'role') && !roles.has(slide.role)) {
        errors.push(`slides[${slideIndex}].role must be one of: cover, context, content, summary, cta`);
      }
      for (const field of ['eyebrow', 'title', 'body']) {
        if (hasOwn(slide, field) && !hasValue(slide[field])) {
          errors.push(`slides[${slideIndex}].${field} must be a non-empty string`);
        }
      }
      if (hasOwn(slide, 'visualSlot') && !visualSlots.has(slide.visualSlot)) {
        errors.push(`slides[${slideIndex}].visualSlot must be one of: left, right, center, none`);
      }
      if (hasOwn(slide, 'code') && typeof slide.code !== 'string') {
        errors.push(`slides[${slideIndex}].code must be a string`);
      }
      if (hasOwn(slide, 'number') && typeof slide.number !== 'string' && typeof slide.number !== 'number') {
        errors.push(`slides[${slideIndex}].number must be a string or number`);
      }
      if (hasOwn(slide, 'imageAlt') && typeof slide.imageAlt !== 'string') {
        errors.push(`slides[${slideIndex}].imageAlt must be a string`);
      }
    });
    if (new Set(indexes).size !== indexes.length) errors.push('slides must use unique indexes');
    if (!slides.some((slide) => isObject(slide) && slide.role === 'cover')) {
      errors.push('slides must include one cover');
    }
    if (!slides.some((slide) => isObject(slide) && slide.role === 'cta')) {
      errors.push('slides must include one cta');
    }
  }

  for (const field of ['caption', 'cta', 'hashtags', 'altText', 'sources']) {
    const value = carousel[field];
    const isValid = field === 'hashtags' || field === 'sources'
      ? Array.isArray(value) && value.length > 0
      : hasValue(value);
    if (hasOwn(carousel, field) && !isValid) {
      errors.push(`delivery text is required: ${field}`);
    }
  }
  if (Array.isArray(carousel.hashtags)) {
    carousel.hashtags.forEach((hashtag, hashtagIndex) => {
      if (!hasValue(hashtag)) errors.push(`hashtags[${hashtagIndex}] must be a non-empty string`);
    });
  }
  if (Array.isArray(carousel.sources)) {
    carousel.sources.forEach((source, sourceIndex) => {
      if (!isObject(source)) {
        errors.push(`sources[${sourceIndex}] must be an object`);
        return;
      }
      errors.push(...unexpectedProperties(source, sourceFields, `sources[${sourceIndex}]`));
      for (const field of ['title', 'url']) {
        if (!hasOwn(source, field)) errors.push(`sources[${sourceIndex}] missing required field: ${field}`);
      }
      if (hasOwn(source, 'title') && !hasValue(source.title)) {
        errors.push(`sources[${sourceIndex}].title must be a non-empty string`);
      }
      if (hasOwn(source, 'url') && !isUrl(source.url)) {
        errors.push(`sources[${sourceIndex}].url must be an absolute URL`);
      }
    });
  }

  const assets = carousel.assets;
  if (hasOwn(carousel, 'assets') && !Array.isArray(assets)) errors.push('assets must be an array');
  if (Array.isArray(assets)) {
    assets.forEach((asset, assetIndex) => {
      if (!isObject(asset)) {
        errors.push(`assets[${assetIndex}] must be an object`);
        return;
      }
      errors.push(...unexpectedProperties(asset, assetFields, `assets[${assetIndex}]`));
      for (const field of ['id', 'path', 'transparent', 'approved']) {
        if (!hasOwn(asset, field)) errors.push(`assets[${assetIndex}] missing required field: ${field}`);
      }
      for (const field of ['id', 'path']) {
        if (hasOwn(asset, field) && !hasValue(asset[field])) {
          errors.push(`assets[${assetIndex}].${field} must be a non-empty string`);
        }
      }
      if (hasOwn(asset, 'path') && hasValue(asset.path) && !isSafeRelativePath(asset.path)) {
        errors.push(`assets[${assetIndex}].path must be a normalized relative internal path`);
      }
      if (hasOwn(asset, 'transparent') && asset.transparent !== true) {
        errors.push(`assets[${assetIndex}] must be transparent`);
      }
      if (hasOwn(asset, 'approved') && asset.approved !== true) {
        errors.push(`assets[${assetIndex}] must be approved`);
      }
    });
  }

  const continuity = carousel.continuity;
  if (hasOwn(carousel, 'continuity') && !Array.isArray(continuity)) errors.push('continuity must be an array');
  if (Array.isArray(continuity)) {
    const slideIndexes = new Set(Array.isArray(slides)
      ? slides.filter(isObject).map((slide) => slide.index)
      : []);
    const assetIds = new Set(Array.isArray(assets)
      ? assets.filter(isObject).map((asset) => asset.id)
      : []);
    continuity.forEach((link, linkIndex) => {
      if (!isObject(link)) {
        errors.push(`continuity[${linkIndex}] must be an object`);
        return;
      }
      errors.push(...unexpectedProperties(link, continuityFields, `continuity[${linkIndex}]`));
      for (const field of ['from', 'to', 'assetId']) {
        if (!hasOwn(link, field)) errors.push(`continuity[${linkIndex}] missing required field: ${field}`);
      }
      for (const field of ['from', 'to']) {
        if (hasOwn(link, field) && !isPositiveInteger(link[field])) {
          errors.push(`continuity[${linkIndex}].${field} must be a positive integer`);
        }
      }
      if (hasOwn(link, 'assetId') && !hasValue(link.assetId)) {
        errors.push(`continuity[${linkIndex}].assetId must be a non-empty string`);
      }
      for (const field of ['from', 'to']) {
        if (hasOwn(link, field) && !slideIndexes.has(link[field])) {
          errors.push(`continuity[${linkIndex}] references unknown slide index: ${link[field]}`);
        }
      }
      if (hasOwn(link, 'assetId') && !assetIds.has(link.assetId)) {
        errors.push(`continuity[${linkIndex}] references unknown asset: ${link.assetId}`);
      }
    });
  }

  return errors;
};

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node validate-carousel.mjs <carousel.json>');
    process.exitCode = 2;
  } else {
    try {
      const carousel = JSON.parse(readFileSync(inputPath, 'utf8'));
      const errors = validateCarousel(carousel);
      if (errors.length > 0) {
        console.error(`Invalid carousel: ${errors.join('; ')}`);
        process.exitCode = 1;
      } else {
        console.log('Carousel is valid.');
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
