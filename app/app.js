import { loadBrand } from '../core/brand.js';
import { renderSlide, textStyle, photoLayout, maxLinesFor } from '../core/render.js';
import { newDeck, nextPostColors, setPostColor, migrateDeck, syncSpans, photoSlices, deckWarnings, uid,
  typesFor, addableTypes, setSlideType, insertPreset, canMove, moveGroup, moveGroupTo, isCover, coverRange, groupRange, deleteGroup, isEmptySlide, withoutEmptySlides } from '../core/deck.js';
import { clampPhoto, ZOOM_MAX } from '../core/photo.js';
import { typo, layoutBlock } from '../core/text.js';
import { slideFilename, zipEntryName, postBaseName, makeZip, canvasToBytes, downloadBytes } from '../core/export.js';
import { saveDraft, listDrafts, getDraft, deleteDraft, serialiseDeck } from '../core/storage.js';
import { I18N } from './i18n.js';
import { createTextEditor } from './editor.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BRAND_ID = params.get('brand') || 'media';
const LS = { lang: 'dg_lang', lastColor: `dg_last_color_${BRAND_ID}` };

const state = {
  brand: null,
  deck: null,
  sel: 0,
  draftId: null,
  lang: lsGet(LS.lang) || 'pl',
  guides: true,
  dirty: false,
};

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
const t = () => I18N[state.lang];

// ───────────────────────── boot ─────────────────────────
async function boot() {
  state.brand = await loadBrand(`brands/${BRAND_ID}/`);
  $('brandName').textContent = state.brand.name;
  document.title = `${state.brand.name} · Post generator`;
  buildColors();
  buildTypeSeg();
  buildAddMenu();
  state.editor = createTextEditor($('textInput'), {
    onInput: onTextInput,
    onSelection: on => { $('italicBtn').classList.toggle('active', on); $('italicBtn').setAttribute('aria-pressed', on); },
  });
  wire();
  startNewDeck();
  renderDrafts();
  applyLang(state.lang);
  new ResizeObserver(() => { sizeCanvas(); renderMain(); }).observe($('canvasWrap'));
}

function startNewDeck() {
  const format = state.deck ? state.deck.format : 'instagram';
  state.deck = newDeck(state.brand, { format, ...nextPostColors(state.brand, lsGet(LS.lastColor)) });
  state.sel = 0;
  state.draftId = null;
  state.dirty = false;
  refreshAll();
}

// ───────────────────────── rendering ─────────────────────────
const preview = $('preview'), overlay = $('overlay');
let viewScale = 1;

function fmt() { return state.brand.formats[state.deck.format]; }

function sizeCanvas() {
  const wrap = $('canvasWrap');
  const f = fmt();
  const mw = wrap.clientWidth, mh = wrap.clientHeight;
  if (mw <= 0 || mh <= 0) return;
  viewScale = Math.min(mw / f.width, mh / f.height);
  const dpr = window.devicePixelRatio || 1;
  for (const c of [preview, overlay]) {
    c.width = Math.round(f.width * viewScale * dpr);
    c.height = Math.round(f.height * viewScale * dpr);
    c.style.width = `${f.width * viewScale}px`;
    c.style.height = `${f.height * viewScale}px`;
  }
}

let slideWarnings = [];   // per slide, from the last full render

function renderMain() {
  if (!state.brand) return;
  const dpr = window.devicePixelRatio || 1;
  const ctx = preview.getContext('2d');
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  const { warnings } = renderSlide(ctx, state.brand, state.deck, state.sel);
  slideWarnings[state.sel] = warnings;
  drawOverlay();
  renderPanelStatus();
}

function drawOverlay() {
  const dpr = window.devicePixelRatio || 1;
  const ctx = overlay.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  const f = fmt();
  const px = 1 / viewScale; // one screen pixel in format units

  if (state.guides) {
    const z = f.safeZone;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,9,.9)';
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([8 * px, 6 * px]);
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.restore();
  }

}

/** Re-render every thumbnail (cheap: drawn at thumbnail scale). */
function renderStrip() {
  const strip = $('strip');
  const f = fmt();
  const TH = 132, scale = TH / f.height, TW = Math.round(f.width * scale);
  const dpr = window.devicePixelRatio || 1;
  const slices = photoSlices(state.deck);
  const dw = deckWarnings(state.deck);

  strip.innerHTML = '';
  slideWarnings = [];
  state.deck.slides.forEach((slide, i) => {
    const item = document.createElement('button');
    item.className = 'thumb' + (i === state.sel ? ' selected' : '');
    const lay = photoLayout(state.brand, state.deck, i, slices);
    if (lay && lay.span > 1) {
      if (lay.part > 0) item.classList.add('span-left');
      if (lay.part < lay.span - 1) item.classList.add('span-right');
    }
    const c = document.createElement('canvas');
    c.width = TW * dpr; c.height = TH * dpr;
    c.style.width = `${TW}px`; c.style.height = `${TH}px`;
    const ctx = c.getContext('2d');
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    const { warnings } = renderSlide(ctx, state.brand, state.deck, i, { slices });
    const extra = dw.filter(w => w.slide === i);
    slideWarnings[i] = [...warnings, ...extra];

    const num = document.createElement('span');
    num.className = 'num'; num.textContent = i + 1;
    item.append(c, num);
    const [g0, g1] = groupRange(state.deck, i);
    const cover = isCover(state.brand, slide);
    // One delete button per group, on its first slide. Covers stay.
    if (i === g0 && !cover) {
      const del = document.createElement('span');
      del.className = 'thumb-del'; del.textContent = '✕';
      del.setAttribute('role', 'button');
      del.title = g1 > g0 ? t().deleteBoth : t().deleteSlide;
      del.onclick = e => { e.stopPropagation(); deleteSlide(i); };
      item.append(del);
    }
    if (!cover) wireDrag(item, i);
    item.onclick = () => select(i);
    strip.append(item);
  });
}

// Drag a thumbnail to reorder; double slides move together.
let dragFrom = null;
function wireDrag(item, i) {
  item.draggable = true;
  item.addEventListener('dragstart', e => {
    dragFrom = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
    const [a, b] = groupRange(state.deck, i);
    [...$('strip').children].forEach((el, k) => el.classList.toggle('dragging', k >= a && k <= b));
  });
  item.addEventListener('dragend', () => {
    dragFrom = null;
    [...$('strip').children].forEach(el => el.classList.remove('dragging', 'drop-before', 'drop-after'));
  });
}
function dropSide(e, el) {
  const r = el.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? -1 : 1;
}
function wireDropZone() {
  const strip = $('strip');
  strip.addEventListener('dragover', e => {
    if (dragFrom == null) return;
    const el = e.target.closest('.thumb'); if (!el) return;
    e.preventDefault();
    const side = dropSide(e, el);
    [...strip.children].forEach(x => x.classList.remove('drop-before', 'drop-after'));
    el.classList.add(side < 0 ? 'drop-before' : 'drop-after');
  });
  strip.addEventListener('drop', e => {
    const el = e.target.closest('.thumb');
    if (dragFrom == null || !el) return;
    e.preventDefault();
    const target = [...strip.children].indexOf(el);
    const sel = state.deck.slides[state.sel];
    const at = moveGroupTo(state.deck, dragFrom, target, dropSide(e, el), state.brand);
    dragFrom = null;
    if (at < 0) return refreshAll();
    state.sel = state.deck.slides.indexOf(sel);
    changed();
  });
}

// ───────────────────────── panel ─────────────────────────
function current() { return state.deck.slides[state.sel]; }

function refreshPanel() {
  const slide = current();
  const card = state.brand.cards[slide.type];
  const n = state.deck.slides.length;

  const allowed = typesFor(state.brand, state.deck, state.sel);
  document.querySelectorAll('#typeSeg button').forEach(b => {
    b.hidden = !allowed.includes(b.dataset.type);
    b.classList.toggle('active', b.dataset.type === slide.type);
  });
  $('typeSeg').hidden = allowed.length === 0;
  $('coverPartNote').hidden = slide.part !== 1;

  const hasText = !!card.text && (card.text.onPart == null || card.text.onPart === (slide.part || 0));
  $('textField').hidden = !hasText;
  if (hasText) {
    state.editor.setValue(slide.text || '');
    $('textInput').dataset.placeholder = card.text.role === 'paragraph' ? t().phParagraph : t().phHeader;
  }

  $('photoField').hidden = !card.photo;
  if (card.photo) {
    const prev = state.deck.slides[state.sel - 1];
    // Only full-bleed photos chain into panoramas; the split cover is a fixed pair.
    const canContinue = !!(prev && card.photo === 'cover' && state.brand.cards[prev.type].photo === 'cover' && prev.photoId);
    $('continueRow').hidden = !canContinue;
    $('continueToggle').checked = canContinue && slide.photoId === prev.photoId;

    const p0 = slide.photoId && state.deck.photos[slide.photoId];
    const photo = p0 && p0.image ? p0 : null;
    $('uploadBtn').textContent = photo ? t().replacePhoto : t().choosePhoto;
    $('resetPhotoBtn').disabled = !photo;
    $('zoomSlider').disabled = !photo;
    if (photo) $('zoomSlider').value = Math.round(((photo.zoom || 1) - 1) / (ZOOM_MAX - 1) * 100);

    const lay = photoLayout(state.brand, state.deck, state.sel);
    $('spanHint').textContent = lay && lay.span > 1 ? t().spanHint(lay.part + 1, lay.span) : '';
  }
}

function renderPanelStatus() {
  const slide = current();
  const card = state.brand.cards[slide.type];
  // Line counter
  const lc = $('lineCounter');
  if (!$('textField').hidden && slide.text && slide.text.trim()) {
    const ctx = preview.getContext('2d');
    const style = textStyle(state.brand, state.deck.format);
    const max = maxLinesFor(ctx, state.brand, state.deck.format, card);
    const lay = layoutBlock(ctx, typo(slide.text, state.brand.typography), style, fmt().safeZone, { maxLines: max });
    lc.textContent = t().lines(lay.lines.length, max);
    lc.classList.toggle('bad', lay.warnings.length > 0);
  } else { lc.textContent = ''; lc.classList.remove('bad'); }

  // Warnings
  const box = $('warnings');
  const ws = [...(slideWarnings[state.sel] || []), ...deckWarnings(state.deck).filter(w => w.slide === state.sel)];
  const uniq = [...new Map(ws.filter(isRealWarning).map(w => [w.code, w])).values()];
  box.innerHTML = '';
  for (const w of uniq) {
    const msg = t().w[w.code];
    const p = document.createElement('div');
    p.className = 'warning';
    p.textContent = typeof msg === 'function' ? msg(w) : (msg || w.code);
    box.append(p);
  }
}

/** Empty fields aren't problems worth a message; overflowing text is. */
const QUIET = new Set(['no-photo', 'no-text']);
const isRealWarning = w => !QUIET.has(w.code);

function refreshAll() {
  syncSpans(state.deck);
  document.querySelectorAll('#formatSeg button').forEach(b => b.classList.toggle('active', b.dataset.format === state.deck.format));
  document.querySelectorAll('#lineColors button').forEach(b => b.classList.toggle('active', b.dataset.color === state.deck.lineColorId));
  document.querySelectorAll('#bgColors button').forEach(b => b.classList.toggle('active', b.dataset.color === state.deck.bgColorId));
  sizeCanvas();
  renderStrip();
  refreshPanel();
  renderMain();
}

function select(i) {
  state.sel = Math.max(0, Math.min(state.deck.slides.length - 1, i));
  refreshAll();
}

function changed() { state.dirty = true; refreshAll(); }

// ───────────────────────── builders ─────────────────────────
function buildColors() {
  for (const [role, wrapId] of [['line', 'lineColors'], ['background', 'bgColors']]) {
    const wrap = $(wrapId);
    for (const c of state.brand.postColor.order) {
      const p = state.brand.palette.find(x => x.id === c);
      const b = document.createElement('button');
      b.dataset.color = c; b.title = p.name; b.style.background = p.value;
      // Picking the other role's color swaps them, so line and background never match.
      b.onclick = () => { setPostColor(state.deck, role, c); changed(); };
      wrap.append(b);
    }
  }
}

function buildTypeSeg() {
  const seg = $('typeSeg');
  for (const type of Object.keys(state.brand.cards)) {
    const b = document.createElement('button');
    b.dataset.type = type;
    b.onclick = () => setType(type);
    seg.append(b);
  }
}

function buildAddMenu() {
  const menu = $('addMenu');
  for (const type of addableTypes(state.brand)) {
    const b = document.createElement('button');
    b.dataset.type = type;
    b.onclick = () => { addSlide(type); menu.classList.remove('open'); };
    menu.append(b);
  }
  for (const name of Object.keys(state.brand.presets || {})) {
    const b = document.createElement('button');
    b.dataset.preset = name;
    b.onclick = () => { addPreset(name); menu.classList.remove('open'); };
    menu.append(b);
  }
}

// ───────────────────────── actions ─────────────────────────
function setType(type) {
  setSlideType(state.brand, state.deck, state.sel, type);
  pruneUnusedPhotos();
  changed();
}

/** New slides go after the current slide's group: never inside a cover or a panorama. */
function insertIndex() {
  const [, to] = groupRange(state.deck, state.sel);
  const cover = coverRange(state.deck);
  return Math.max(to + 1, cover ? cover[1] + 1 : 0);
}

function addSlide(type) {
  const at = insertIndex();
  state.deck.slides.splice(at, 0, { id: uid('s'), type, text: '' });
  state.sel = at;
  changed();
}

function addPreset(name) {
  state.sel = insertPreset(state.brand, state.deck, name, insertIndex() - 1);
  changed();
}

function moveSlide(dir) {
  if (!canMove(state.deck, state.sel, dir, state.brand)) return;
  state.sel = moveGroup(state.deck, state.sel, dir, state.brand);
  changed();
}

/** Delete a slide; double slides (split cover, photo on 2 slides) go together. */
function deleteSlide(index = state.sel) {
  if (isCover(state.brand, state.deck.slides[index])) return;
  const [from] = groupRange(state.deck, index);
  if (!deleteGroup(state.deck, index)) return toast(t().deleteLast);
  state.sel = Math.min(from, state.deck.slides.length - 1);
  changed();
}

function pruneUnusedPhotos() {
  const used = new Set(state.deck.slides.map(s => s.photoId).filter(Boolean));
  for (const id of Object.keys(state.deck.photos)) if (!used.has(id)) delete state.deck.photos[id];
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = URL.createObjectURL(blob);
  });
}

async function onFile(file) {
  if (!file) return;
  const image = await blobToImage(file);
  const slide = current();
  const existing = slide.photoId && state.deck.photos[slide.photoId];
  if (existing) {
    // Replace the picture of the whole panorama, keep its slides together.
    Object.assign(existing, { image, blob: file, zoom: 1, offX: 0, offY: 0 });
  } else {
    const id = uid('p');
    state.deck.photos[id] = { id, image, blob: file, span: 1, zoom: 1, offX: 0, offY: 0 };
    slide.photoId = id;
  }
  changed();
}

function toggleContinue(on) {
  const slide = current();
  const prev = state.deck.slides[state.sel - 1];
  if (on && prev && prev.photoId) {
    slide.photoId = prev.photoId;
    // Slides after this one that showed this slide's old photo keep it.
  } else {
    delete slide.photoId;
  }
  pruneUnusedPhotos();
  changed();
}

/** The current slide's photo, only if an image has been chosen. */
function currentPhoto() {
  const slide = current();
  const p = slide.photoId ? state.deck.photos[slide.photoId] : null;
  return p && p.image ? p : null;
}

function currentStrip() {
  const lay = photoLayout(state.brand, state.deck, state.sel);
  return lay ? lay.strip : fmt().photoArea;
}

// Drag to pan
let drag = null;
function onPointerDown(e) {
  const photo = currentPhoto();
  if (!photo || !state.brand.cards[current().type].photo) return;
  drag = { x: e.clientX, y: e.clientY, ox: photo.offX || 0, oy: photo.offY || 0 };
  overlay.setPointerCapture(e.pointerId);
  overlay.classList.add('dragging');
}
let rafPending = false;
function onPointerMove(e) {
  if (!drag) return;
  const photo = currentPhoto();
  photo.offX = drag.ox + (e.clientX - drag.x) / viewScale;
  photo.offY = drag.oy + (e.clientY - drag.y) / viewScale;
  clampPhoto(photo, currentStrip());
  if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; renderMain(); }); }
}
function onPointerUp() {
  if (!drag) return;
  drag = null;
  overlay.classList.remove('dragging');
  state.dirty = true;
  renderStrip();
}

// ───────────────────────── export ─────────────────────────
function renderFull(deck, i) {
  const f = state.brand.formats[deck.format];
  const c = document.createElement('canvas');
  c.width = f.width; c.height = f.height;
  renderSlide(c.getContext('2d'), state.brand, deck, i);
  return c;
}

async function downloadSlide() {
  if (isEmptySlide(state.brand, state.deck, state.sel)) return toast(t().emptySlide);
  const bytes = await canvasToBytes(renderFull(state.deck, state.sel));
  downloadBytes(bytes, slideFilename(state.deck, state.sel), 'image/png');
  lsSet(LS.lastColor, state.deck.lineColorId);
}

/** All slides with content, in carousel order; empty slides are skipped. */
async function downloadAll() {
  renderStrip();
  const deck = withoutEmptySlides(state.brand, state.deck);
  if (!deck.slides.length) return toast(t().nothingToSave);
  const kept = state.deck.slides.map((s, i) => deck.slides.includes(s) ? i : -1).filter(i => i >= 0);
  const bad = kept.filter(i => (slideWarnings[i] || []).some(isRealWarning)).length;
  if (bad && !confirm(t().exportWithIssues(bad))) return;
  const files = [];
  for (let i = 0; i < deck.slides.length; i++) {
    files.push({ name: zipEntryName(deck, i), data: await canvasToBytes(renderFull(deck, i)) });
  }
  downloadBytes(makeZip(files), `${postBaseName(deck)}.zip`, 'application/zip');
  lsSet(LS.lastColor, state.deck.lineColorId);
}

// ───────────────────────── drafts ─────────────────────────
async function doSaveDraft() {
  pruneUnusedPhotos();
  const deck = withoutEmptySlides(state.brand, state.deck);
  if (!deck.slides.length) return toast(t().nothingToSave);
  const thumbCanvas = document.createElement('canvas');
  const f = fmt();
  thumbCanvas.width = 216; thumbCanvas.height = Math.round(216 * f.height / f.width);
  const ctx = thumbCanvas.getContext('2d');
  ctx.scale(216 / f.width, 216 / f.width);
  renderSlide(ctx, state.brand, deck, 0);
  const thumb = await new Promise(r => thumbCanvas.toBlob(r, 'image/jpeg', 0.85));

  const photoBlobs = {};
  for (const [id, p] of Object.entries(deck.photos)) if (p.blob) photoBlobs[id] = p.blob;

  state.draftId = state.draftId || uid('d');
  const first = deck.slides.find(s => s.text && s.text.trim());
  await saveDraft({
    id: state.draftId, brandId: BRAND_ID,
    title: first ? first.text.replace(/\*/g, '').slice(0, 80) : '',
    thumb, deck: serialiseDeck(deck), photoBlobs,
  });
  state.dirty = false;
  toast(t().saved);
  renderDrafts();
}


/** Drafts column: newest first, the open draft highlighted. */
async function renderDrafts() {
  let list = [];
  try { list = (await listDrafts(BRAND_ID)).sort((a, b) => b.updatedAt - a.updatedAt); }
  catch (e) { console.warn('Drafts unavailable:', e); }
  const box = $('draftsList');
  box.innerHTML = '';
  for (const d of list) {
    const item = document.createElement('div');
    item.className = 'draft' + (d.id === state.draftId ? ' current' : '');
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    const img = document.createElement('img');
    img.alt = '';
    if (d.thumb) img.src = URL.createObjectURL(d.thumb);
    const title = document.createElement('span');
    title.className = 'title'; title.textContent = d.title || t().untitled;
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = new Date(d.updatedAt).toLocaleString(state.lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕';
    del.setAttribute('aria-label', t().remove);
    del.onclick = async e => {
      e.stopPropagation();
      await deleteDraft(d.id);
      if (state.draftId === d.id) state.draftId = null;
      renderDrafts();
    };
    item.onclick = () => loadDraft(d.id);
    item.onkeydown = e => { if (e.key === 'Enter') loadDraft(d.id); };
    item.append(img, title, date, del);
    box.append(item);
  }
}

async function loadDraft(id) {
  const d = await getDraft(id);
  if (!d) return;
  const deck = migrateDeck(state.brand, d.deck);
  for (const [pid, p] of Object.entries(deck.photos)) {
    const blob = d.photoBlobs[pid];
    if (blob) { p.blob = blob; p.image = await blobToImage(blob); }
  }
  state.deck = deck;
  state.draftId = d.id;
  state.sel = 0;
  state.dirty = false;
  refreshAll();
  renderDrafts();
}

// ───────────────────────── misc UI ─────────────────────────
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function applyLang(lang) {
  state.lang = lang;
  lsSet(LS.lang, lang);
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const v = t()[el.dataset.i18n];
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll('#typeSeg button, #addMenu button[data-type]').forEach(b => { b.textContent = t().types[b.dataset.type]; });
  document.querySelectorAll('#addMenu button[data-preset]').forEach(b => { b.textContent = t().presets[b.dataset.preset]; });
  document.querySelectorAll('#lang button').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  if (state.deck) { refreshPanel(); renderPanelStatus(); renderDrafts(); }
}

const plainLen = m => m.replace(/\*/g, '').length;

/** Lines the text would take on the current slide. */
function lineCount(markup) {
  const card = state.brand.cards[current().type];
  const ctx = preview.getContext('2d');
  const lay = layoutBlock(ctx, typo(markup, state.brand.typography), textStyle(state.brand, state.deck.format), fmt().safeZone);
  return { lines: lay.lines.length, max: maxLinesFor(ctx, state.brand, state.deck.format, card) };
}

let textRaf = false;
function onTextInput(value, prev) {
  // Hard limit: an edit that adds a line beyond the limit is undone.
  const { lines, max } = lineCount(value);
  if (lines > max && lines > lineCount(prev || '').lines) {
    const caret = state.editor.getCaret();
    state.editor.setValue(prev || '');
    if (caret != null) state.editor.setCaret(caret - (plainLen(value) - plainLen(prev || '')));
    const lc = $('lineCounter');
    lc.classList.remove('flash'); void lc.offsetWidth; lc.classList.add('flash');
    return;
  }
  current().text = value;
  state.dirty = true;
  if (textRaf) return;
  textRaf = true;
  requestAnimationFrame(() => { textRaf = false; renderMain(); renderStrip(); });
}

function wire() {
  document.querySelectorAll('#formatSeg button').forEach(b => b.onclick = () => {
    state.deck.format = b.dataset.format; changed();
  });
  document.querySelectorAll('#lang button').forEach(b => b.onclick = () => applyLang(b.dataset.lang));

  $('italicBtn').addEventListener('mousedown', e => e.preventDefault()); // keep the text selection
  $('italicBtn').onclick = () => state.editor.toggleItalic();

  $('uploadBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => { onFile(e.target.files[0]); e.target.value = ''; };
  $('continueToggle').onchange = e => toggleContinue(e.target.checked);
  $('resetPhotoBtn').onclick = () => {
    const p = currentPhoto(); if (!p) return;
    Object.assign(p, { zoom: 1, offX: 0, offY: 0 }); changed();
  };
  $('zoomSlider').oninput = e => {
    const p = currentPhoto(); if (!p) return;
    p.zoom = 1 + (Number(e.target.value) / 100) * (ZOOM_MAX - 1);
    clampPhoto(p, currentStrip());
    renderMain();
  };
  $('zoomSlider').onchange = () => renderStrip();

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);

  // Drop a photo onto the canvas
  const wrap = $('canvasWrap');
  wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drop'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
  wrap.addEventListener('drop', e => {
    e.preventDefault(); wrap.classList.remove('drop');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/') && state.brand.cards[current().type].photo) onFile(f);
  });

  $('guidesToggle').onclick = () => {
    state.guides = !state.guides;
    $('guidesToggle').classList.toggle('active', state.guides);
    $('guidesToggle').setAttribute('aria-pressed', state.guides);
    drawOverlay();
  };
  wireDropZone();

  $('addBtn').onclick = e => { e.stopPropagation(); $('addMenu').classList.toggle('open'); };
  document.addEventListener('click', e => { if (!$('addMenu').contains(e.target)) $('addMenu').classList.remove('open'); });

  $('newBtn').onclick = () => { if (!state.dirty || confirm(t().confirmNew)) { startNewDeck(); renderDrafts(); } };
  $('saveDraftBtn').onclick = doSaveDraft;
  $('downloadSlideBtn').onclick = downloadSlide;
  $('downloadAllBtn').onclick = downloadAll;

  document.addEventListener('keydown', e => {
    if (e.target.matches('textarea, input, [contenteditable]')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSlide(); }
    if (e.key === 'ArrowLeft') select(state.sel - 1);
    if (e.key === 'ArrowRight') select(state.sel + 1);
  });
  window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

// Expose for tests / debugging.
window.__dg = { state, refreshAll, select };

boot().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', `<div class="fatal">${err.message}</div>`);
});
