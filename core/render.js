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
 * Where slide `index` shows its photo: the strip the photo is fitted to, the
 * slice of it this slide shows, and where that slice lands on the card.
 * Returns null for slides without a photo slot.
 */
export function photoLayout(brand, deck, index, slices = photoSlices(deck)) {
  const fmt = brand.formats[deck.format];
  const slide = deck.slides[index];
  const card = brand.cards[slide.type];
  if (!card || !card.photo || !slide.photoId) return null;

  if (card.photo === 'split') {
    const boxes = fmt.splitCover;
    const part = slide.part || 0;
    return {
      photoId: slide.photoId,
      strip: { w: boxes[0].w + boxes[1].w, h: boxes[0].h },
      sliceX: part === 0 ? 0 : boxes[0].w,
      dest: boxes[part],
      part, span: 2,
    };
  }
  const s = slices[index];
  const a = fmt.photoArea;
  const span = s ? s.span : 1, i = s ? s.index : 0;
  return { photoId: slide.photoId, strip: { w: a.w * span, h: a.h }, sliceX: i * a.w, dest: a, part: i, span };
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
    const lay = photoLayout(brand, deck, index, opts.slices || photoSlices(deck));
    const photo = lay && deck.photos[lay.photoId];
    const dest = lay ? lay.dest : (card.photo === 'split' ? fmt.splitCover[slide.part || 0] : fmt.photoArea);
    if (photo && photo.image) {
      clampPhoto(photo, lay.strip);
      drawPhotoSlice(ctx, photo, lay.strip, lay.sliceX, dest);
    } else {
      drawPlaceholder(ctx, dest);
      // Report a missing photo once per photo slot (the first slice).
      if (!lay || lay.part === 0) warnings.push({ code: 'no-photo' });
    }
    if (card.gradient) drawGradient(ctx, brand, dest);
  }

  const onThisPart = !card.text || card.text.onPart == null || card.text.onPart === (slide.part || 0);
  if (card.text && onThisPart) {
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
