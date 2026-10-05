// Deck = one carousel post. Plain data, serialisable (photos keep their image
// separately so drafts can store blobs).
//
// {
//   format: 'instagram' | 'linkedin',
//   colorId: 'orchid-pink',
//   slides: [{ id, type, text?, photoId? }],
//   photos: { [photoId]: { id, image, span, zoom, offX, offY } }
// }
//
// Spanning photos: consecutive slides with the same photoId share one photo
// strip; the photo's `span` is derived from how many such slides there are.

let seq = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export function newDeck(brand, { format = 'instagram', colorId } = {}) {
  const order = brand.postColor.order;
  const slides = brand.storyOrder.default.map(type => ({ id: uid('s'), type, text: '' }));
  return { format, colorId: colorId || order[0], slides, photos: {} };
}

/**
 * Next post color given the previous post's color: the following color in the
 * brand order (so consecutive posts never match).
 */
export function nextColor(brand, prevColorId) {
  const order = brand.postColor.order;
  const i = order.indexOf(prevColorId);
  return order[(i + 1) % order.length];
}

/** For each slide: which slice of its photo it shows, and the photo's span. */
export function photoSlices(deck) {
  const out = deck.slides.map(() => null);
  let i = 0;
  while (i < deck.slides.length) {
    const pid = deck.slides[i].photoId;
    if (!pid) { i++; continue; }
    let j = i;
    while (j + 1 < deck.slides.length && deck.slides[j + 1].photoId === pid) j++;
    const span = j - i + 1;
    for (let k = i; k <= j; k++) out[k] = { photoId: pid, index: k - i, span };
    i = j + 1;
  }
  return out;
}

/** Sync each photo's span with the slides that use it. Call after edits. */
export function syncSpans(deck) {
  const slices = photoSlices(deck);
  const seen = {};
  slices.forEach(s => { if (s) seen[s.photoId] = Math.max(seen[s.photoId] || 0, s.span); });
  for (const [id, span] of Object.entries(seen)) if (deck.photos[id]) deck.photos[id].span = span;
  return deck;
}

/** Deck-level problems (not tied to rendering). */
export function deckWarnings(deck) {
  const w = [];
  // The same photo used on non-adjacent slides is two separate placements of one
  // strip — almost certainly a mistake.
  const firstRun = {};
  photoSlices(deck).forEach((s, i) => {
    if (!s || s.index !== 0) return;
    if (firstRun[s.photoId] !== undefined) w.push({ code: 'photo-split', photoId: s.photoId, slide: i });
    firstRun[s.photoId] = i;
  });
  return w;
}
