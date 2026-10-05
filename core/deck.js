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
    // A split cover is its own group, even if the next slide reuses the photo.
    const key = s => s.photoId + (s.part != null ? '#split' : '');
    const k0 = key(deck.slides[i]);
    let j = i;
    while (j + 1 < deck.slides.length && key(deck.slides[j + 1]) === k0 &&
           !(deck.slides[j + 1].part === 0)) j++;
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

// ── Split cover & presets ──

/** Index range of the split cover, or null. A split cover always opens the post. */
export function coverRange(deck) {
  const s = deck.slides;
  return s[0] && s[0].part === 0 ? [0, 1] : null;
}

/** Card types offered for slide `index` (used by the type switcher). */
export function typesFor(brand, deck, index) {
  const slide = deck.slides[index];
  if (slide.part === 1) return [];                // second half of a split cover
  return Object.entries(brand.cards)
    .filter(([, c]) => !c.firstOnly || index === 0)
    .map(([type]) => type);
}

/** Card types offered when adding a slide: never first-only cards. */
export function addableTypes(brand) {
  return Object.entries(brand.cards).filter(([, c]) => c.addable !== false && !c.firstOnly).map(([t]) => t);
}

/**
 * Change the type of slide `index`, keeping split-cover invariants:
 * turning slide 1 into a split cover inserts its second half; leaving it removes it.
 */
export function setSlideType(brand, deck, index, type) {
  const slide = deck.slides[index];
  const card = brand.cards[type];
  if (!card || slide.type === type) return deck;
  if (card.firstOnly && index !== 0) return deck;

  const wasSplit = slide.part === 0;
  if (wasSplit) {
    deck.slides.splice(index + 1, 1);             // drop the second half
    delete slide.part;
  }
  slide.type = type;
  if (!card.photo) delete slide.photoId;

  if (card.slides === 2) {
    slide.part = 0;
    if (!slide.photoId) {
      const id = uid('p');
      deck.photos[id] = { id, image: null, zoom: 1, offX: 0, offY: 0 };
      slide.photoId = id;
    }
    deck.slides.splice(index + 1, 0, { id: uid('s'), type, part: 1, photoId: slide.photoId, text: '' });
  }
  return syncSpans(deck);
}

/** Insert a preset (e.g. panorama) after slide `index`; returns the first new index. */
export function insertPreset(brand, deck, name, index) {
  const preset = brand.presets && brand.presets[name];
  if (!preset) return index;
  let pid = null;
  if (preset.sharedPhoto) {
    pid = uid('p');
    deck.photos[pid] = { id: pid, image: null, zoom: 1, offX: 0, offY: 0 };
  }
  const at = Math.max(index + 1, coverRange(deck) ? 2 : 0);
  const slides = preset.slides.map(type => ({ id: uid('s'), type, text: '', ...(pid ? { photoId: pid } : {}) }));
  deck.slides.splice(at, 0, ...slides);
  syncSpans(deck);
  return at;
}

/** Can slide `index` move by `dir`? Split-cover slides stay at the start. */
export function canMove(deck, index, dir) {
  const to = index + dir;
  if (to < 0 || to >= deck.slides.length) return false;
  const cover = coverRange(deck);
  if (cover && (index <= cover[1] || to <= cover[1])) return false;
  return true;
}
