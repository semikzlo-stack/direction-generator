// Password page. A light deterrent, not real security: the site and its code
// are public, so anyone determined can get past it. Only the SHA-256 of the
// password is stored here, so the password itself isn't readable in the repo.

const HASH = 'be937a2bed0d4b3c3b161655d6cf54088076e85b291cb946d3a9ae2fcba27264';
const KEY = 'dg_unlocked';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function remembered() {
  try { return localStorage.getItem(KEY) === HASH; } catch { return false; }
}

/** Resolves once the right password has been entered (or was entered before on this browser). */
export function passGate(texts) {
  const gate = document.getElementById('gate');
  if (remembered()) { gate.remove(); document.body.classList.remove('locked'); return Promise.resolve(); }

  const form = document.getElementById('gateForm');
  const input = document.getElementById('gateInput');
  const err = document.getElementById('gateError');
  document.getElementById('gateTitle').textContent = texts.gateTitle;
  input.placeholder = texts.gatePlaceholder;
  document.getElementById('gateBtn').textContent = texts.gateBtn;
  gate.hidden = false;
  setTimeout(() => input.focus(), 50);

  return new Promise(resolve => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (await sha256(input.value) === HASH) {
        try { localStorage.setItem(KEY, HASH); } catch { /* private mode: ask again next time */ }
        gate.remove();
        document.body.classList.remove('locked');
        resolve();
      } else {
        err.textContent = texts.gateWrong;
        input.select();
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      }
    });
  });
}
