// Card renderer driven by a brand config (see brands/*/config.json).
// Draws one slide of a deck into a 2D context sized to the format (1 unit = 1 px
// of the exported image; the caller handles devicePixelRatio).

import { typo, layoutBlock, drawBlock } from './text.js';
import { drawPhotoSlice, clampPhoto } from './photo.js';
import { photoSlices } from './deck.js';

export function colorValue(brand, colorId) {
  const c = brand.palette.find(p => p.id === colorId);
  return c ? c.value : brand.palette[0].value;
}

export function textStyle(brand, format) {
  const f = brand.formats[format];
  return { family: brand.type.family, weight: brand.type.weight, size: f.fontSize, lineHeight: brand.type.lineHeight };
}

function drawGradient(ctx, brand, area) {
  const g = brand.gradient;
  const grad = ctx.createLinearGradient(0, area.y, 0, area.y + area.h);
  for (const s of g.stops) grad.addColorStop(s.at, s.color);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(area.x, area.y, area.w, area.h);
  ctx.restore();
}

function drawPlaceholder(ctx, area) {
  ctx.save();
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(area.x, area.y, area.w, area.h);
  ctx.restore();
}

/**
 * Render slide `index` of `deck`. Returns { warnings }.
 * opts.slices — precomputed photoSlices(deck) (optional, for batch renders)
 */
export function renderSlide(ctx, brand, deck, index, opts = {}) {
  const fmt = brand.formats[deck.format];
  const slide = deck.slides[index];
  const card = brand.cards[slide.type];
  const color = colorValue(brand, deck.colorId);
  const style = textStyle(brand, deck.format);
  const warnings = [];

  // Body: the post color fills the whole card. Photo cards cover the top
  // `photoArea`, leaving the bottom line visible; paragraph cards stay colored.
  ctx.clearRect(0, 0, fmt.width, fmt.height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, fmt.width, fmt.height);

  if (card.photo) {
    const slices = opts.slices || photoSlices(deck);
    const s = slices[index];
    const photo = s && deck.photos[s.photoId];
    if (photo && photo.image) {
      photo.span = s.span;
      clampPhoto(photo, fmt.photoArea);
      drawPhotoSlice(ctx, photo, fmt.photoArea, s.index);
    } else {
      drawPlaceholder(ctx, fmt.photoArea);
      warnings.push({ code: 'no-photo' });
    }
    if (card.gradient) drawGradient(ctx, brand, fmt.photoArea);
  }

  if (card.text) {
    const raw = slide.text || '';
    if (!raw.trim()) {
      warnings.push({ code: 'no-text' });
    } else {
      const text = typo(raw, brand.typography);
      const box = fmt.safeZone;
      const layout = layoutBlock(ctx, text, style, box, { maxLines: card.text.maxLines });
      const fill = card.text.color === 'onImage' ? brand.text.onImage : brand.text.onColor;
      drawBlock(ctx, layout, style, box.x, fill);
      warnings.push(...layout.warnings);
    }
  }

  return { warnings };
}
