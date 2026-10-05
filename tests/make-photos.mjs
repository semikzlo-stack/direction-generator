// Synthetic test photos (a tall one and a wide panorama). Run: node make-photos.mjs
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
function photo(w, h, hue, name) {
  const c = createCanvas(w, h), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue},55%,30%)`); g.addColorStop(1, `hsl(${hue + 70},55%,62%)`);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.strokeStyle = 'rgba(255,255,255,.3)'; x.lineWidth = 5;
  for (let i = 0; i < w; i += 160) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
  for (let j = 0; j < h; j += 160) { x.beginPath(); x.moveTo(0, j); x.lineTo(w, j); x.stroke(); }
  x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(w / 2, h / 2, Math.min(w, h) / 8, 0, Math.PI * 2); x.fill();
  writeFileSync(new URL(`./out/${name}`, import.meta.url), c.toBuffer('image/jpeg', 88));
}
photo(2400, 3200, 15, 'photo_a.jpg');
photo(4800, 2400, 190, 'photo_b.jpg');
console.log('photos written');
