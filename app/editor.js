// Rich-text field for post text: italic toggle + line breaks, stored as the
// same *italic* markup the renderer reads.

import { parseRuns } from '../core/text.js';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function markupToHtml(markup) {
  return parseRuns(markup || '').map(r => {
    const html = esc(r.text).replace(/\n/g, '<br>');
    return r.italic ? `<i>${html}</i>` : html;
  }).join('');
}

function isItalicEl(el) {
  return el.nodeType === 1 && (el.tagName === 'I' || el.tagName === 'EM' || el.style.fontStyle === 'italic');
}

export function htmlToMarkup(root) {
  const runs = [];
  const push = (text, italic) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.italic === italic) last.text += text; else runs.push({ text, italic });
  };
  const walk = (node, italic) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) push(n.nodeValue.replace(/ /g, ' ').replace(/\*/g, ''), italic);
      else if (n.nodeType === 1) {
        if (n.tagName === 'BR') { push('\n', false); continue; }
        const block = n.tagName === 'DIV' || n.tagName === 'P';
        if (block && runs.length && !runs[runs.length - 1].text.endsWith('\n')) push('\n', false);
        walk(n, italic || isItalicEl(n));
      }
    }
  };
  walk(root, false);
  // Keep spaces outside the markers so "*word* next" stays readable.
  let out = runs.map(r => {
    if (!r.italic || !r.text.trim()) return r.text;
    const m = r.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return `${m[1]}*${m[2]}*${m[3]}`;
  }).join('');
  return out.replace(/\n+$/, '');
}

export function createTextEditor(el, { onInput, onSelection }) {
  el.contentEditable = 'true';
  el.spellcheck = true;
  let value = '';

  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); document.execCommand('italic'); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') e.preventDefault(); // no bold in the brand
  });
  el.addEventListener('paste', e => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  el.addEventListener('input', () => {
    value = htmlToMarkup(el);
    el.classList.toggle('empty', !value);
    onInput(value);
  });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === el && onSelection) onSelection(document.queryCommandState('italic'));
  });

  return {
    get value() { return value; },
    setValue(markup) {
      if (markup === value) return;
      value = markup || '';
      el.innerHTML = markupToHtml(value);
      el.classList.toggle('empty', !value);
    },
    toggleItalic() {
      el.focus();
      document.execCommand('italic');
      if (onSelection) onSelection(document.queryCommandState('italic'));
    },
  };
}
