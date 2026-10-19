import { create as createFont } from 'fontkit';
import { assertLogoLayout, assertLogoClearance } from '../../src/adapters/legacy/logo-layout.mjs';

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const forbiddenXmlControl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;

export class TextOverflowError extends Error {
  constructor(slideIndex, field) {
    super(`Slide ${slideIndex} ${field} cannot fit at the minimum approved font size`);
    this.name = 'TextOverflowError';
    this.slideIndex = slideIndex;
    this.field = field;
  }
}

const loadFont = (data, label) => {
  try {
    if (!Buffer.isBuffer(data) || data.length === 0) throw new Error('empty');
    return createFont(data);
  } catch {
    throw new Error(`Invalid ${label} font data`);
  }
};

const textWidth = (font, value, fontSize) => {
  const run = font.layout(value);
  const advance = run.positions.reduce((total, position) => total + position.xAdvance, 0);
  return advance * (fontSize / font.unitsPerEm);
};

const splitLongWord = (font, word, width, fontSize) => {
  const pieces = [];
  let piece = '';
  for (const character of word) {
    const candidate = piece + character;
    if (piece && textWidth(font, candidate, fontSize) > width) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
};

const wrapText = (font, value, width, fontSize, splitOversizedWords) => {
  const lines = [];
  for (const paragraph of String(value).split(/\r?\n/u)) {
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const oversized = textWidth(font, word, fontSize) > width;
      if (oversized && !splitOversizedWords) return null;
      const pieces = oversized ? splitLongWord(font, word, width, fontSize) : [word];
      for (const piece of pieces) {
        const candidate = line ? `${line} ${piece}` : piece;
        if (line && textWidth(font, candidate, fontSize) > width) {
          lines.push(line);
          line = piece;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
};

const fitText = ({ font, text, width, sizes, maximumLines, slideIndex, field }) => {
  if (forbiddenXmlControl.test(String(text))) {
    throw new Error(`Slide ${slideIndex} ${field} contains a forbidden XML control character`);
  }
  for (const [sizeIndex, fontSize] of sizes.entries()) {
    const lines = wrapText(font, text, width, fontSize, sizeIndex === sizes.length - 1);
    if (lines && lines.length <= maximumLines) return { fontSize, lines };
  }
  throw new TextOverflowError(slideIndex, field);
};

const renderGlyphLine = ({ font, text, x, baseline, fontSize, className, fill, logoLayout }) => {
  const run = font.layout(text);
  const scale = fontSize / font.unitsPerEm;
  let cursor = 0;
  const glyphs = run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    const glyphX = x + ((cursor + position.xOffset) * scale);
    const glyphY = baseline - (position.yOffset * scale);
    cursor += position.xAdvance;
    if (logoLayout && glyph.path.commands.length) {
      // Same quantized transforms used by the SVG, with actual glyph bounds.
      const bounds = glyph.bbox, actualScale = Number(scale.toFixed(6));
      const actualX = Number(glyphX.toFixed(3)), actualY = Number(glyphY.toFixed(3));
      assertLogoClearance(logoLayout, [{ x: actualX + bounds.minX * actualScale,
        y: actualY - bounds.maxY * actualScale, width: (bounds.maxX - bounds.minX) * actualScale,
        height: (bounds.maxY - bounds.minY) * actualScale }]);
    }
    return `<path class="${className} glyph" fill="${fill}" d="${glyph.path.toSVG()}" transform="translate(${glyphX.toFixed(3)} ${glyphY.toFixed(3)}) scale(${scale.toFixed(6)} -${scale.toFixed(6)})"/>`;
  }).join('');
  return `<g class="${className} line" aria-label="${escapeXml(text)}"/>${glyphs}`;
};

const renderTextBlock = ({ font, layout, x, y, lineHeight, className, fill, right, logoLayout }) => {
  const lines = layout.lines.map((line, index) => {
    const lineX = right === undefined
      ? x
      : right - textWidth(font, line, layout.fontSize);
    return renderGlyphLine({
      font,
      text: line,
      x: lineX,
      baseline: y + (index * lineHeight),
      fontSize: layout.fontSize,
      className,
      fill,
      logoLayout,
    });
  }).join('');
  const rightAttribute = right === undefined ? '' : ` data-right="${right}"`;
  return `<g class="${className} text" data-x="${x}"${rightAttribute} data-font-size="${layout.fontSize}" aria-label="${escapeXml(layout.lines.join(' '))}">${lines}</g>`;
};

const renderSlide = ({ slide, position, count, brand, fonts, theme, logoLayout }) => {
  const contentX = slide.visualSlot === 'left' ? 426 : 84;
  const contentWidth = slide.visualSlot === 'none' || slide.visualSlot === 'center' ? 912 : 570;
  const eyebrow = fitText({ font: fonts.body, text: slide.eyebrow, width: contentWidth, sizes: [28, 26, 24], maximumLines: 2, slideIndex: slide.index, field: 'eyebrow' });
  const title = fitText({ font: fonts.title, text: slide.title, width: contentWidth, sizes: [96, 90, 84, 78, 72], maximumLines: 4, slideIndex: slide.index, field: 'title' });
  const body = fitText({ font: fonts.body, text: slide.body, width: contentWidth, sizes: [42, 40, 38, 36, 34], maximumLines: 6, slideIndex: slide.index, field: 'body' });
  const code = slide.code
    ? fitText({ font: fonts.mono, text: slide.code, width: contentWidth, sizes: [28, 26, 24], maximumLines: 3, slideIndex: slide.index, field: 'code' })
    : null;
  const titleLineHeight = Math.round(title.fontSize * 1.04);
  const bodyY = 350 + ((title.lines.length - 1) * titleLineHeight) + 142;
  const bodyLineHeight = Math.round(body.fontSize * 1.35);
  const codeBlock = code ? renderTextBlock({
    font: fonts.mono,
    layout: code,
    x: contentX,
    y: bodyY + (body.lines.length * bodyLineHeight) + 72,
    lineHeight: Math.round(code.fontSize * 1.35),
    className: 'code',
    fill: theme.text,
    logoLayout,
  }) : '';
  const slideNumber = `${String(position + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`;
  const footerProfile = { fontSize: 22, lines: [brand.profile] };
  const footerNumber = { fontSize: 22, lines: [slideNumber] };

  return `<g data-slide-index="${slide.index}" transform="translate(${position * brand.slideWidth} 0)">
    <circle cx="${slide.visualSlot === 'left' ? 128 : 952}" cy="${logoLayout && slide.visualSlot !== 'left' ? 354 : 300}" r="210" fill="var(--accent)" opacity="0.12"/>
    ${renderTextBlock({ font: fonts.body, layout: eyebrow, x: contentX, y: 190, lineHeight: 36, className: 'eyebrow', fill: theme.accent, logoLayout })}
    ${renderTextBlock({ font: fonts.title, layout: title, x: contentX, y: 350, lineHeight: titleLineHeight, className: 'title', fill: theme.text, logoLayout })}
    ${renderTextBlock({ font: fonts.body, layout: body, x: contentX, y: bodyY, lineHeight: bodyLineHeight, className: 'body', fill: theme.muted, logoLayout })}
    ${codeBlock}
    <line x1="84" x2="996" y1="1194" y2="1194" stroke="var(--muted)" opacity="0.32"/>
    ${renderTextBlock({ font: fonts.body, layout: footerProfile, x: 84, y: 1264, lineHeight: 28, className: 'footer', fill: theme.muted, logoLayout })}
    ${renderTextBlock({ font: fonts.body, layout: footerNumber, x: 84, right: 996, y: 1264, lineHeight: 28, className: 'footer number', fill: theme.muted, logoLayout })}
    ${position < count - 1 ? '<path d="M 970 675 l 16 12 l -16 12" fill="none" stroke="var(--accent)" stroke-width="4"/>' : ''}
    ${logoLayout ? `<image class="brand-logo" data-logo-slot="756 64 240 80" data-logo-id="${escapeXml(logoLayout.id)}" data-logo-sha256="${logoLayout.sha256}" href="${logoLayout.dataUri}" x="${logoLayout.image.x}" y="${logoLayout.image.y}" width="${logoLayout.image.width}" height="${logoLayout.image.height}" preserveAspectRatio="xMidYMid meet"/>` : ''}
  </g>`;
};

const renderContinuityAssets = ({ carousel, brand, assetData, logoLayout }) => {
  const positions = new Map(carousel.slides.map((slide, position) => [slide.index, position]));
  return carousel.continuity?.map((link) => {
    const asset = assetData[link.assetId];
    if (!asset) return '';
    const from = positions.get(link.from);
    const to = positions.get(link.to);
    const width = Math.min(520, Math.max(320, asset.width * 1.75));
    const height = width * (asset.height / asset.width);
    const boundary = ((from + to + 1) / 2) * brand.slideWidth;
    if (logoLayout) for (let position = 0; position < carousel.slides.length; position++) {
      assertLogoClearance(logoLayout, [{ x: Math.round(boundary - width / 2) - position * brand.slideWidth,
        y: Math.round((brand.slideHeight - height) / 2), width: Math.round(width), height: Math.round(height) }]);
    }
    return `<image data-asset-id="${escapeXml(link.assetId)}" href="${asset.dataUri}" x="${Math.round(boundary - (width / 2))}" y="${Math.round((brand.slideHeight - height) / 2)}" width="${Math.round(width)}" height="${Math.round(height)}" preserveAspectRatio="xMidYMid meet"/>`;
  }).join('') ?? '';
};

export const buildPanoramaSvg = ({ carousel, brand, theme, fontData, assetData, logoLayout }) => {
  logoLayout = assertLogoLayout(logoLayout, { logo: brand.logo, theme });
  const fonts = {
    title: loadFont(fontData.title, 'title'),
    body: loadFont(fontData.body, 'body'),
    mono: loadFont(fontData.mono, 'mono'),
  };
  const width = brand.slideWidth * carousel.slides.length;
  const groups = carousel.slides.map((slide, position) => renderSlide({ slide, position, count: carousel.slides.length, brand, fonts, theme, logoLayout })).join('');
  const assets = renderContinuityAssets({ carousel, brand, assetData, logoLayout });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${brand.slideHeight}" viewBox="0 0 ${width} ${brand.slideHeight}">
  <style>
    @font-face { font-family: '${escapeXml(brand.fonts.title)}'; src: local('${escapeXml(brand.fonts.title)}'); }
    @font-face { font-family: '${escapeXml(brand.fonts.body)}'; src: local('${escapeXml(brand.fonts.body)}'); }
    @font-face { font-family: '${escapeXml(brand.fonts.mono)}'; src: local('${escapeXml(brand.fonts.mono)}'); }
    :root { --background: ${theme.background}; --text: ${theme.text}; --muted: ${theme.muted}; --accent: ${theme.accent}; --secondary-accent: ${theme.secondaryAccent ?? theme.accent}; }
    .eyebrow.glyph { fill: var(--accent); } .title.glyph { fill: var(--text); } .body.glyph, .footer.glyph { fill: var(--muted); } .code.glyph { fill: var(--text); }
  </style>
  <rect width="${width}" height="${brand.slideHeight}" fill="${theme.background}"/>
  <path d="M 0 1080 C ${Math.round(width * 0.3)} 940, ${Math.round(width * 0.7)} 1210, ${width} 1040" fill="none" stroke="${theme.accent}" stroke-width="3" opacity="0.16"/>
  ${groups}${assets}
  </svg>`;
};
