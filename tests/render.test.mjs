// Headless render + unit checks. Run: cd tests && node render.test.mjs
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

import { renderSlide } from '../core/render.js';
import { typo, parseRuns, layoutBlock } from '../core/text.js';
import { newDeck, setPostColor, nextPostColors, syncSpans, photoSlices, nextColor, deckWarnings, setSlideType, insertPreset, canMove, typesFor, addableTypes } from '../core/deck.js';
import { makeZip, slideFilename, slugify } from '../core/export.js';

const brand = JSON.parse(readFileSync(new URL('../brands/media/config.json', import.meta.url)));
for (const f of brand.fonts) {
  const ok = GlobalFonts.registerFromPath(new URL(`../brands/media/${f.file}`, import.meta.url).pathname, f.family);
  assert.ok(ok, `font registered: ${f.file}`);
}
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const out = name => new URL(`./out/${name}`, import.meta.url).pathname;

// ── unit: typography ──
const T = brand.typography;
assert.equal(typo('"Ostatni zamek" w księgarni', T), '„Ostatni zamek” w księgarni');
assert.equal(typo('“Ostatni zamek” na łamach', T), '„Ostatni zamek” na łamach');
assert.equal(typo('i w domu', T), 'i w domu');
assert.equal(typo('Kawa  i   herbata', T), 'Kawa i herbata');
assert.deepEqual(parseRuns('Mawia się, że *medium is the message* — środek'),
  [{ text: 'Mawia się, że ', italic: false }, { text: 'medium is the message', italic: true }, { text: ' — środek', italic: false }]);
assert.deepEqual(parseRuns('5 * 3'), [{ text: '5 ', italic: false }, { text: '* 3', italic: false }]);

// ── unit: deck / colors ──
assert.equal(nextColor(brand, 'orchid-pink'), 'mint-teal');
assert.equal(nextColor(brand, 'lime-light'), 'orchid-pink');
assert.equal(slugify('„Ostatni zamek” w księgarni Bęc Zmiany'), 'ostatni-zamek-w-ksiegarni-bec-zmiany');

// ── synthetic photos ──
async function synthPhoto(w, h, hue) {
  const c = createCanvas(w, h); const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue},55%,35%)`); g.addColorStop(1, `hsl(${hue + 60},55%,60%)`);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 6;
  for (let i = 0; i < w; i += 200) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
  for (let j = 0; j < h; j += 200) { x.beginPath(); x.moveTo(0, j); x.lineTo(w, j); x.stroke(); }
  x.fillStyle = 'rgba(255,255,255,.8)'; x.font = '160px "Mabry Pro"'; x.fillText(`${w}×${h}`, 80, h / 2);
  return loadImage(c.toBuffer('image/png'));
}

const photoA = { id: 'pA', image: await synthPhoto(3000, 4000, 10), zoom: 1, offX: 0, offY: 0, span: 1 };
const photoB = { id: 'pB', image: await synthPhoto(6000, 3000, 180), zoom: 1, offX: 0, offY: 0, span: 1 };

function buildDeck(format) {
  const d = newDeck(brand, { format, lineColorId: 'lime-light', bgColorId: 'orchid-pink' });
  d.slides[0].text = '"Ostatni zamek" w księgarni Bęc Zmiany';
  d.slides[0].photoId = 'pA';
  d.slides[1].text = '„Ostatni zamek” pojawił się na witrynie sklepu Fundacji Bęc Zmiana. A wokół moc niezwykle pięknie zaprojektowanych książek.';
  d.slides[2].photoId = 'pB';
  d.slides.push({ id: 's4', type: 'image', photoId: 'pB' }); // spans slides 3–4
  d.slides.push({ id: 's5', type: 'paragraph', text: 'Mawia się, że *medium is the message* — środek komunikacji sam jest przekazem.' });
  d.photos = { pA: { ...photoA }, pB: { ...photoB } };
  return syncSpans(d);
}

for (const format of ['instagram', 'linkedin']) {
  const deck = buildDeck(format);
  const fmt = brand.formats[format];
  assert.equal(deck.photos.pB.span, 2, 'pB spans two slides');
  assert.deepEqual(photoSlices(deck)[3], { photoId: 'pB', index: 1, span: 2 });
  assert.deepEqual(deckWarnings(deck), []);

  const sheet = createCanvas(fmt.width * deck.slides.length / 2, fmt.height / 2);
  const sx = sheet.getContext('2d');
  const files = [];
  deck.slides.forEach((_, i) => {
    const c = createCanvas(fmt.width, fmt.height);
    const { warnings } = renderSlide(c.getContext('2d'), brand, deck, i);
    assert.deepEqual(warnings, [], `${format} slide ${i + 1} renders without warnings: ${JSON.stringify(warnings)}`);
    const lp = [...c.getContext('2d').getImageData(540, 1345, 1, 1).data.slice(0, 3)];
    assert.deepEqual(lp, [0xDC, 0xEF, 0x6F], `${format} slide ${i + 1}: bottom line in the line color`);
    const png = c.toBuffer('image/png');
    files.push({ name: slideFilename(deck, i, new Date(2026, 9, 5)), data: new Uint8Array(png) });
    sx.drawImage(c, i * fmt.width / 2, 0, fmt.width / 2, fmt.height / 2);
  });
  writeFileSync(out(`${format}_sheet.png`), sheet.toBuffer('image/png'));
  writeFileSync(out(`${format}.zip`), makeZip(files));
  console.log(format, files.map(f => f.name).join(', '));
}

// ── geometry vs Figma ──
// Figma: Instagram paragraph text box = x 60, y 865, h 415 (5 lines); header box y 1114, h 166 (2 lines).
{
  const ctx = createCanvas(1080, 1350).getContext('2d');
  const style = { family: 'Mabry Pro', weight: 400, size: 75, lineHeight: 1.1 };
  const box = brand.formats.instagram.safeZone;
  const p = layoutBlock(ctx, typo('„Ostatni zamek” pojawił się na witrynie sklepu Fundacji Bęc Zmiana. A wokół moc niezwykle pięknie zaprojektowanych książek.', T), style, box);
  const h = layoutBlock(ctx, typo('„Ostatni zamek” w księgarni Bęc Zmiany', T), style, box);
  console.log('paragraph lines:', p.lines.length, 'top', p.top.toFixed(1), '| header lines:', h.lines.length, 'top', h.top.toFixed(1));
  console.log('paragraph breaks:', p.lines.map(l => l.runs.map(r => r.text).join('')).map(s => s.replace(/ /g, '·')));
  assert.equal(p.lines.length, 5); assert.ok(Math.abs(p.top - 867.5) < 3, 'paragraph top ≈ Figma 865');
  assert.equal(h.lines.length, 2); assert.ok(Math.abs(h.top - 1115) < 2, 'header top ≈ Figma 1114');

  // overflow + max lines warnings
  const long = layoutBlock(ctx, 'słowo '.repeat(200), style, box, { maxLines: 4 });
  assert.ok(long.warnings.some(w => w.code === 'overflow'));
  assert.ok(long.warnings.some(w => w.code === 'too-many-lines'));
}
// ── post colors ──
{
  const d = newDeck(brand, {});
  assert.notEqual(d.lineColorId, d.bgColorId, 'line and background differ');
  setPostColor(d, 'background', d.lineColorId);
  assert.notEqual(d.lineColorId, d.bgColorId, 'picking the line color for background swaps them');
  assert.deepEqual(nextPostColors(brand, 'orchid-pink'), { lineColorId: 'mint-teal', bgColorId: 'lime-light' });
}

// ── split cover ──
{
  const deck = newDeck(brand, { format: 'instagram', lineColorId: 'lime-light', bgColorId: 'mint-teal' });
  setSlideType(brand, deck, 0, 'cover-split');
  assert.equal(deck.slides.length, 4, 'split cover inserts its second half');
  assert.deepEqual(deck.slides.slice(0, 2).map(s => s.part), [0, 1]);
  assert.equal(deck.slides[0].photoId, deck.slides[1].photoId);
  assert.ok(!addableTypes(brand).includes('cover-split'), 'cover is not addable');
  assert.ok(!typesFor(brand, deck, 2).includes('cover-split'), 'cover only on slide 1');
  assert.deepEqual(typesFor(brand, deck, 1), [], 'second half has no type switch');
  assert.ok(!canMove(deck, 2, -1) && !canMove(deck, 0, 1), 'cover slides stay first');

  deck.slides[0].text = 'Zamczystość w „Vogue”';
  deck.photos[deck.slides[0].photoId] = { ...photoB, id: deck.slides[0].photoId };
  const teal = [0x64, 0xC7, 0xB2];
  const px = (c, x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)];
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 6);
  const sheet = createCanvas(1080, 675); const sx = sheet.getContext('2d');
  for (const i of [0, 1]) {
    const c = createCanvas(1080, 1350);
    const { warnings } = renderSlide(c.getContext('2d'), brand, deck, i);
    assert.deepEqual(warnings, [], `split cover slide ${i + 1}: ${JSON.stringify(warnings)}`);
    if (i === 0) { assert.ok(near(px(c, 30, 600), teal), 'left margin'); assert.ok(!near(px(c, 90, 600), teal), 'photo starts at 60'); assert.ok(!near(px(c, 1075, 600), teal), 'photo runs to the right edge'); }
    else { assert.ok(near(px(c, 1050, 600), teal), 'right margin'); assert.ok(!near(px(c, 5, 600), teal), 'photo continues from the left edge'); }
    assert.ok(near(px(c, 540, 1160), teal), 'band under the photo');
    assert.ok(near(px(c, 540, 1345), [0xDC, 0xEF, 0x6F]), 'lime bottom line on the cover');
    sx.drawImage(c, i * 540, 0, 540, 675);
  }
  writeFileSync(out('split_cover.png'), sheet.toBuffer('image/png'));
  deck.slides[0].text = 'Zamczystość w „Vogue” i jeszcze jedna długa linia nagłówka';
  const w = renderSlide(createCanvas(1080, 1350).getContext('2d'), brand, deck, 0).warnings;
  assert.ok(w.some(x => x.code === 'too-many-lines' && x.max === 1), 'split cover allows one line');

  setSlideType(brand, deck, 0, 'image-header');
  assert.equal(deck.slides.length, 3, 'leaving split cover removes the second half');
  assert.equal(deck.slides[0].part, undefined);

  const at = insertPreset(brand, deck, 'panorama', 0);
  assert.equal(at, 1);
  assert.equal(deck.slides[1].photoId, deck.slides[2].photoId);
  assert.equal(photoSlices(deck)[2].span, 2, 'panorama preset spans two slides');
}
console.log('all checks passed');
