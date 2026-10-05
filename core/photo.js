// Photos: cover fit, zoom, pan — on a strip that can span several slides.
//
// A photo is placed on a "strip" (w × h). Each slide shows one slice of it:
// the part starting at `sliceX` on the strip, drawn into a destination rect.
// Full-bleed panoramas: strip = span × photoArea.w, slices at i × photoArea.w.
// Split cover: strip = sum of the two photo boxes, slices at 0 and box1.w.
//
// Photo state (serialisable apart from `image`):
//   { id, image, zoom, offX, offY }
//   zoom  ≥ 1 — multiple of the cover scale (1 = exact cover)
//   offX/offY — pan from centre, in strip pixels

export const ZOOM_MAX = 3;

export function coverScale(image, w, h) {
  return Math.max(w / image.width, h / image.height);
}

/** Effective draw geometry of the photo on a strip {w, h}. */
export function photoGeometry(photo, strip) {
  const sc = coverScale(photo.image, strip.w, strip.h) * Math.max(1, photo.zoom || 1);
  const dw = photo.image.width * sc, dh = photo.image.height * sc;
  return {
    scale: sc, dw, dh,
    x: (strip.w - dw) / 2 + (photo.offX || 0),
    y: (strip.h - dh) / 2 + (photo.offY || 0),
  };
}

/** Keep the photo covering the strip: no background may show through. */
export function clampPhoto(photo, strip) {
  photo.zoom = Math.max(1, Math.min(ZOOM_MAX, photo.zoom || 1));
  if (!photo.image) return photo;
  const g = photoGeometry(photo, strip);
  const maxX = Math.max(0, (g.dw - strip.w) / 2);
  const maxY = Math.max(0, (g.dh - strip.h) / 2);
  photo.offX = Math.max(-maxX, Math.min(maxX, photo.offX || 0));
  photo.offY = Math.max(-maxY, Math.min(maxY, photo.offY || 0));
  return photo;
}

/** Draw the slice of the strip that starts at `sliceX` into rect `dest`, clipped. */
export function drawPhotoSlice(ctx, photo, strip, sliceX, dest) {
  const g = photoGeometry(photo, strip);
  ctx.save();
  ctx.beginPath();
  ctx.rect(dest.x, dest.y, dest.w, dest.h);
  ctx.clip();
  ctx.drawImage(photo.image, dest.x + g.x - sliceX, dest.y + g.y, g.dw, g.dh);
  ctx.restore();
}
