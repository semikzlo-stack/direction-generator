// Text: typography cleanup, *italic* markup, line breaking, bottom-anchored layout.
// Pure functions over a CanvasRenderingContext2D — no DOM, no global state.

const NBSP = ' ';

/**
 * Typographic cleanup for post text.
 * - straight / English quotes → language quotes („…”)
 * - non-breaking space after short words so they never end a line
 * - collapses runs of spaces, trims
 */
export function typo(text, rules = {}) {
  if (!text) return '';
  let s = String(text).replace(/\r\n?/g, '\n');
  s = s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

  if (rules.quotes) {
    const { open, close } = rules.quotes;
    // A quote is "opening" at start, after whitespace, or after an opening bracket.
    s = s.replace(/(^|[\s(\[{ ])["“”„]/g, `$1${open}`);
    s = s.replace(/["“”]/g, close);
  }

  if (rules.nbspAfter && rules.nbspAfter.length) {
    const words = rules.nbspAfter.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    // \p{L} lookbehind keeps us from matching inside longer words.
    const re = new RegExp(`(^|[^\\p{L}])(${words}) `, 'giu');
    // Run twice so chains like "i w domu" are both bound.
    s = s.replace(re, `$1$2${NBSP}`).replace(re, `$1$2${NBSP}`);
  }
  return s;
}

/**
 * Parse *italic* markup into runs. Unclosed markers are kept as literal text.
 * Returns [{text, italic}]
 */
export function parseRuns(text) {
  const runs = [];
  const parts = String(text).split('*');
  const closed = parts.length % 2 === 1; // odd number of parts = balanced markers
  parts.forEach((p, i) => {
    let italic = i % 2 === 1;
    if (!closed && i === parts.length - 1 && italic) { // dangling "*": treat as literal
      italic = false; p = '*' + p;
    }
    if (p) runs.push({ text: p, italic });
  });
  return runs;
}

export function fontString(style, italic) {
  return `${italic ? 'italic ' : ''}${style.weight || 400} ${style.size}px "${style.family}"`;
}

/** Split runs into words (by regular spaces / newlines). A word is a list of runs. */
function toTokens(runs) {
  const tokens = []; // {type:'word', runs:[...]} | {type:'break'}
  let cur = [];
  const flush = () => { if (cur.length) { tokens.push({ type: 'word', runs: cur }); cur = []; } };
  for (const r of runs) {
    const pieces = r.text.split(/( |\n)/);
    for (const piece of pieces) {
      if (piece === ' ') flush();
      else if (piece === '\n') { flush(); tokens.push({ type: 'break' }); }
      else if (piece) cur.push({ text: piece, italic: r.italic });
    }
  }
  flush();
  return tokens;
}

function measureRuns(ctx, style, runs) {
  let w = 0;
  for (const r of runs) {
    ctx.font = fontString(style, r.italic);
    w += ctx.measureText(r.text).width;
  }
  return w;
}

/**
 * Greedy line breaking.
 * Returns { lines: [{ runs:[{text,italic,x}], width }], tooWide: bool }
 * x positions are relative to the line start.
 */
export function breakLines(ctx, text, style, maxWidth) {
  const tokens = toTokens(parseRuns(text));
  ctx.font = fontString(style, false);
  const spaceW = ctx.measureText(' ').width;

  const lines = [];
  let line = [], lineW = 0, tooWide = false;
  const push = () => { lines.push({ words: line, width: lineW }); line = []; lineW = 0; };

  for (const t of tokens) {
    if (t.type === 'break') { push(); continue; }
    const w = measureRuns(ctx, style, t.runs);
    if (w > maxWidth) tooWide = true;
    if (line.length && lineW + spaceW + w > maxWidth) push();
    lineW += (line.length ? spaceW : 0) + w;
    line.push({ runs: t.runs, width: w });
  }
  if (line.length) push();

  // Flatten words into positioned runs.
  const out = lines.map(l => {
    const runs = []; let x = 0;
    l.words.forEach((word, i) => {
      if (i) x += spaceW;
      for (const r of word.runs) {
        ctx.font = fontString(style, r.italic);
        runs.push({ text: r.text, italic: r.italic, x });
        x += ctx.measureText(r.text).width;
      }
    });
    return { runs, width: l.width };
  });
  return { lines: out, tooWide };
}

/** Font vertical metrics (hhea-based), cached per font string. */
const metricsCache = new Map();
export function fontMetrics(ctx, style) {
  const key = fontString(style, false);
  if (metricsCache.has(key)) return metricsCache.get(key);
  ctx.font = key;
  const m = ctx.measureText('Hg');
  const asc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
  const res = { asc, desc };
  metricsCache.set(key, res);
  return res;
}

/**
 * Lay out a text block inside a box, anchored to the box bottom (as in Figma:
 * the last line box sits on the box's bottom edge, block grows upward).
 *
 * Line boxes follow Figma's model: height = size × lineHeight, glyph content
 * area (asc + desc) centred inside the line box.
 *
 * Returns { lines, baselines:[y], top, warnings:[...] }
 */
export function layoutBlock(ctx, text, style, box, opts = {}) {
  const { lines, tooWide } = breakLines(ctx, text, style, box.w);
  const L = style.size * style.lineHeight;
  const { asc, desc } = fontMetrics(ctx, style);
  const inset = (L - (asc + desc)) / 2;

  const n = lines.length;
  const bottom = box.y + box.h;
  const top = bottom - n * L;
  const baselines = lines.map((_, i) => top + i * L + inset + asc);

  const warnings = [];
  if (tooWide) warnings.push({ code: 'word-too-wide' });
  if (opts.maxLines && n > opts.maxLines) warnings.push({ code: 'too-many-lines', lines: n, max: opts.maxLines });
  if (top < box.y - 0.5) warnings.push({ code: 'overflow', overflowPx: Math.round(box.y - top) });

  return { lines, baselines, top, lineHeight: L, warnings };
}

export function drawBlock(ctx, layout, style, x, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  layout.lines.forEach((line, i) => {
    for (const r of line.runs) {
      ctx.font = fontString(style, r.italic);
      ctx.fillText(r.text, x + r.x, layout.baselines[i]);
    }
  });
  ctx.restore();
}
