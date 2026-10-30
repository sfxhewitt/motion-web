"""Tests for the Alight gap features (split/trim offsets, style keyframes, anchor, audio, speed, keys clipboard, bezier,
export formats, groups/parenting, masks). Desktop Chromium; run with the static server on :8765."""
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:8765/')
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail) if detail and not cond else ''), flush=True)

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1440, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_function('window.__app && __app.project')
    pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_function('window.__app && __app.project')
    E = lambda js, arg=None: pg.evaluate(js, arg)

    # --- B1: trimming / splitting media clips moves the source offset ---
    r = E("""async () => { const st = await import('./js/state.js'); const p = st.newProject('16:9');
      const L = st.makeLayer(p, 'video', { mediaId: 'm', w: 640, h: 360, mediaDuration: 6 });
      st.setStart(L, 2); const a = { start: L.start, off: L.media.offset };
      st.setStart(L, -5); const b = { start: L.start, off: L.media.offset };   // can't go before the source's first frame
      return { a, b }; }""")
    check('trim start cuts into the media (offset follows)', r['a'] == {'start': 2, 'off': 2} and r['b'] == {'start': 0, 'off': 0}, r)
    r = E("""async () => { const st = await import('./js/state.js'); const p = __app.project;
      const L = st.makeLayer(p, 'video', { mediaId: 'mx', w: 640, h: 360, mediaDuration: 6 }); p.layers.unshift(L); __app.S.sel = L.id;
      __app.seek(3); document.querySelector('[data-testid=tab-split]') || __app.refreshAll(); document.querySelector('[data-testid=tab-split]').click();
      const parts = __app.project.layers.filter(l => l.media && l.media.id === 'mx').map(l => [l.start, l.end, l.media.offset]).sort((a, b) => a[0] - b[0]);
      return parts; }""")
    check('split second half continues the source where the first ends', r == [[0, 3, 0], [3, 6, 3]], r)

    print('page errors', errs[:5])
    check('no page errors', not errs, errs[:3])
    b.close()
n = sum(ok for _, ok in results); print(f'{n}/{len(results)} passed'); sys.exit(0 if n == len(results) else 1)
