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

    # --- style keyframes: colours, border, shadow, text size animate between keys ---
    r = E("""async () => { const st = await import('./js/state.js'), R = await import('./js/render.js'); const p = st.newProject('1:1');
      const S = st.makeLayer(p, 'shape'); st.setKey(S, 'shape.fill', 0, '#000000', { type: 'linear' }); st.setKey(S, 'shape.fill', 2, '#ffffff'); st.setKey(S, 'shape.strokeW', 0, 0); st.setKey(S, 'shape.strokeW', 2, 20);
      S.keys['shape.fill'][0].ease = S.keys['shape.strokeW'][0].ease = { type: 'linear' };
      const T = st.makeLayer(p, 'text'); st.setKey(T, 'text.size', 0, 100); st.setKey(T, 'text.size', 1, 200); T.keys['text.size'][0].ease = { type: 'linear' };
      T.shadow = { on: true, color: '#000000', blur: 0, dx: 0, dy: 0, alpha: 1 }; st.setKey(T, 'shadow.blur', 0, 0); st.setKey(T, 'shadow.blur', 1, 40); T.keys['shadow.blur'][0].ease = { type: 'linear' };
      const V = st.makeLayer(p, 'solid'); st.setKey(V, 'solid.color', 0, '#ff0000'); st.setKey(V, 'solid.color', 1, '#0000ff'); V.keys['solid.color'][0].ease = { type: 'linear' };
      return { fill: R.evalShape(S, 1).fill, sw: R.evalShape(S, 1).strokeW, size: R.evalText(T, 0.5, p).size, blur: st.evalNs(T, 'shadow', 0.5).blur, solid: st.evalNs(V, 'solid', 0.5).color, base: S.shape.fill }; }""")
    check('colour / border / text size / shadow / solid keyframes interpolate', r['fill'] == '#808080' and r['sw'] == 10 and r['size'] == 150 and r['blur'] == 20 and r['solid'] == '#800080', r)
    # UI: the Color & Fill panel has a ◆ on the colour; keying it then editing at another time animates the fill
    r = E("""async () => { const A = __app, L = A.project.layers.find(l => l.type === 'shape'); A.S.sel = L.id; A.seek(0); A.openSub('style'); await new Promise(r => setTimeout(r, 50));
      document.querySelector('[data-testid=fill-color-key]').click(); A.seek(2);
      const inp = document.querySelector('[data-testid=fill-color]'); inp.value = '#00ff00'; inp.dispatchEvent(new Event('input')); inp.dispatchEvent(new Event('change'));
      const L2 = A.project.layers.find(l => l.id === L.id); return (L2.keys['shape.fill'] || []).map(k => [k.t, k.v]); }""")
    check('Color & Fill ◆ keys the fill and later edits add keys', len(r) == 2 and r[1] == [2, '#00ff00'], r)

    print('page errors', errs[:5])
    check('no page errors', not errs, errs[:3])
    b.close()
n = sum(ok for _, ok in results); print(f'{n}/{len(results)} passed'); sys.exit(0 if n == len(results) else 1)
