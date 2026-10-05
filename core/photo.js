// Photos: cover fit, zoom, pan — on a strip that can span several slides.
//
// A photo is placed on a "strip" = `span` slides laid side by side
// (strip width = span × photoArea.w). Each slide shows its own slice.
// span = 1 is an ordinary single-slide photo.
//
// Photo state (serialisable apart from `image`):
//   { id, image, span, zoom, offX, offY }
//   zoom  ≥ 1 — multiple of the cover scale (1 = exact cover)
//   offX/offY — pan from centre, in strip pixels

export const ZOOM_MAX = 3;

export function stripSize(area, span) {
  return { w: area.w * span, h: area.h };
}

export function coverScale(image, w, h) {
  return Math.max(w / image.width, h / image.height);
}

/** Effective draw geometry of the photo on its strip. */
export function photoGeometry(photo, area) {
  const strip = stripSize(area, photo.span || 1);
  const sc = coverScale(photo.image, strip.w, strip.h) * Math.max(1, photo.zoom || 1);
  const dw = photo.image.width * sc, dh = photo.image.height * sc;
  return {
    strip, scale: sc, dw, dh,
    // top-left of the image in strip coordinates
    x: (strip.w - dw) / 2 + (photo.offX || 0),
    y: (strip.h - dh) / 2 + (photo.offY || 0),
  };
}

/** Keep the photo covering the strip: no background may show through. */
export function clampPhoto(photo, area) {
  const g = photoGeometry(photo, area);
  const maxX = Math.max(0, (g.dw - g.strip.w) / 2);
  const maxY = Math.max(0, (g.dh - g.strip.h) / 2);
  photo.offX = Math.max(-maxX, Math.min(maxX, photo.offX || 0));
  photo.offY = Math.max(-maxY, Math.min(maxY, photo.offY || 0));
  photo.zoom = Math.max(1, Math.min(ZOOM_MAX, photo.zoom || 1));
  return photo;
}

/**
 * Draw slice `index` (0-based within the span) of the photo into `area` of the
 * current canvas. Clipped to the area.
 */
export function drawPhotoSlice(ctx, photo, area, index = 0) {
  const g = photoGeometry(photo, area);
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  ctx.drawImage(photo.image, area.x + g.x - index * area.w, area.y + g.y, g.dw, g.dh);
  ctx.restore();
}

/** Seam x-positions (strip coordinates) between slides of a spanning photo. */
export function seams(area, span) {
  return Array.from({ length: Math.max(0, span - 1) }, (_, i) => (i + 1) * area.w);
}
