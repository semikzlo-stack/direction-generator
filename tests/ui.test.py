"""End-to-end editor test in headless Chromium.

    cd tests && node make-photos.mjs && python3 ui.test.py

Serves the repo root, drives the editor, checks exports and drafts,
and writes screenshots to tests/out/.
"""
import http.server, socketserver, threading, functools, os, zipfile, io, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tests' / 'out'
OUT.mkdir(exist_ok=True)
PORT = int(os.environ.get('PORT', 8765))

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Q, directory=str(ROOT))

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', PORT), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

errors = []
def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: errors.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: m.type == 'error' and errors.append(f'console: {m.text}'))
    page.goto(f'http://127.0.0.1:{PORT}/?brand=media')
    page.wait_for_function('window.__dg && window.__dg.state.deck')
    page.click('#lang button[data-lang=en]')

    st = lambda js: page.evaluate(f'(() => {{ const s = window.__dg.state; return {js}; }})()')
    check(st('s.deck.slides.length') == 3, 'new deck has 3 slides (header, paragraph, photo)')
    check(st('s.deck.slides.map(x=>x.type).join()') == 'image-header,paragraph,image', 'default story order')

    # Slide 1: header + photo
    page.fill('#textInput', '"Ostatni zamek" w księgarni Bęc Zmiany')
    page.set_input_files('#fileInput', str(OUT / 'photo_a.jpg'))
    page.wait_for_function('Object.keys(window.__dg.state.deck.photos).length === 1')
    check(page.inner_text('#lineCounter').startswith('2 / 4'), 'header line counter shows 2 / 4')

    # Drag the photo
    box = page.locator('#overlay').bounding_box()
    page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
    page.mouse.down(); page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2 + 80, steps=5); page.mouse.up()
    check(st('Object.values(s.deck.photos)[0].offY') > 0, 'dragging pans the photo')

    # Slide 2: paragraph
    page.click('.thumb >> nth=1')
    page.fill('#textInput', '„Ostatni zamek” pojawił się na witrynie sklepu Fundacji Bęc Zmiana. A wokół moc niezwykle pięknie zaprojektowanych książek.')
    check(page.locator('#photoField').is_hidden(), 'paragraph card hides photo controls')

    # Slide 3: panorama photo, then add slide 4 continuing it
    page.click('.thumb >> nth=2')
    page.set_input_files('#fileInput', str(OUT / 'photo_b.jpg'))
    page.wait_for_function('Object.keys(window.__dg.state.deck.photos).length === 2')
    page.click('#addBtn'); page.click('#addMenu button[data-type=image]')
    check(st('s.sel') == 3, 'added slide is selected')
    check(page.locator('#continueRow').is_visible(), '"continue photo" offered after a photo slide')
    page.check('#continueToggle')
    check(st('s.deck.photos[s.deck.slides[3].photoId].span') == 2, 'photo spans slides 3–4')
    check('Part 2 of 2' in page.inner_text('#spanHint'), 'span hint shown')
    page.screenshot(path=str(OUT / 'ui_instagram.png'))

    # Too-long header → warning
    page.click('.thumb >> nth=0')
    page.fill('#textInput', 'Bardzo długi nagłówek, który na pewno nie zmieści się w czterech liniach tekstu na zdjęciu, bo jest za długi i ciągnie się dalej')
    page.wait_for_timeout(150); print('   warnings:', repr(page.inner_text('#warnings')))
    check('Shorten' in page.inner_text('#warnings'), 'too-long header shows a warning')
    check(page.locator('.thumb >> nth=0').locator('.badge').count() == 1, 'thumbnail shows a warning badge')
    page.fill('#textInput', '"Ostatni zamek" w księgarni Bęc Zmiany')
    page.wait_for_timeout(150); print('   warnings after:', repr(page.inner_text('#warnings')))
    check(page.inner_text('#warnings').strip() == '', 'warning clears after shortening')

    # LinkedIn
    page.click('#formatSeg button[data-format=linkedin]')
    check(st('s.deck.format') == 'linkedin', 'switched to LinkedIn')
    page.screenshot(path=str(OUT / 'ui_linkedin.png'))

    # Export ZIP
    with page.expect_download() as dl:
        page.click('#downloadAllBtn')
    d = dl.value
    data = Path(d.path()).read_bytes()
    z = zipfile.ZipFile(io.BytesIO(data))
    names = z.namelist()
    check(len(names) == 4 and all(n.endswith('.png') for n in names), f'ZIP has 4 PNGs: {names[:1]}…')
    check(d.suggested_filename.endswith('_linkedin.zip'), f'zip name: {d.suggested_filename}')
    z.extract(names[2], OUT); z.extract(names[3], OUT)

    # Draft round trip
    page.click('#saveDraftBtn')
    page.wait_for_selector('#toast:not([hidden])')
    page.evaluate('window.__dg.state.dirty = false')
    page.click('#newBtn')
    check(st('Object.keys(s.deck.photos).length') == 0, 'new post is empty')
    check(st('s.deck.colorId') == 'mint-teal', 'next post gets the next color')
    page.click('#draftsBtn')
    page.click('#draftsList .draft >> nth=0 >> button >> nth=0')
    page.wait_for_function('Object.keys(window.__dg.state.deck.photos).length === 2')
    check(st('s.deck.slides.length') == 4 and st('s.deck.format') == 'linkedin', 'draft restores slides and format')
    check(st('Object.values(s.deck.photos).every(p => p.image && p.image.width > 0)'), 'draft restores photos')

    # Mobile layout sanity
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(200)
    overflow = page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
    print('   wide:', page.evaluate('[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>window.innerWidth+1).slice(0,6).map(e=>e.tagName+"#"+e.id+"."+e.className+" "+Math.round(e.getBoundingClientRect().right))'))
    check(not overflow, 'no horizontal page scroll at phone width')
    page.screenshot(path=str(OUT / 'ui_mobile.png'), full_page=True)
    b.close()

srv.shutdown()
for e in errors:
    if e.startswith(('pageerror', 'console')): print('     ', e)
print('ALL PASSED' if not errors else f'{len(errors)} problem(s)')
sys.exit(1 if errors else 0)
