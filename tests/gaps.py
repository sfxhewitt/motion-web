"""Tests for the Alight gap features (split/trim offsets, style keyframes, anchor, audio, speed, keys clipboard, bezier,
export formats, groups/parenting, masks). Desktop Chromium; run with the static server on :8765."""
import os, sys, wave, struct, math
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
    pg.click('[data-testid=home-open] >> nth=0'); pg.wait_for_timeout(300)

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

    # --- pivot, Scale X / Y, skew ---
    r = E("""async () => { const st = await import('./js/state.js'), R = await import('./js/render.js'); const p = st.newProject('1:1');
      const L = st.makeLayer(p, 'shape'); L.props.x = 500; L.props.y = 500; L.props.anchorX = 100; L.props.rotation = 90;
      const a = R.layerMatrix(L, 0, p).transformPoint({ x: 100, y: 0 });   // the pivot stays put under rotation
      const c = R.layerMatrix(L, 0, p).transformPoint({ x: 0, y: 0 });     // the content centre swings around it
      const M = st.makeLayer(p, 'shape'); M.props.x = 0; M.props.y = 0; M.props.scaleX = 2; M.props.scaleY = 0.5; M.props.skew = 45;
      const q = R.layerMatrix(M, 0, p).transformPoint({ x: 10, y: 10 });
      return { a: [Math.round(a.x), Math.round(a.y)], c: [Math.round(c.x), Math.round(c.y)], q: [Math.round(q.x), Math.round(q.y)], defaults: [st.valueAt(L, 'scaleX', 0), st.valueAt(L, 'skew', 0)] }; }""")
    check('pivot point, Scale X / Y and skew transform content', r['a'] == [500, 500] and r['c'] == [500, 400] and r['q'] == [40, 5] and r['defaults'] == [1, 0], r)
    r = E("""async () => { const A = __app, L = A.project.layers.find(l => l.type === 'shape'); A.selectLayer(L.id); A.openSub('layer'); await new Promise(r => setTimeout(r, 50));
      return ['scaleX', 'scaleY', 'skew', 'anchorX', 'anchorY'].every(k => document.querySelector('[data-testid=prop-' + k + ']') && document.querySelector('[data-testid=prop-' + k + '-key]')); }""")
    check('Move & Transform shows keyframeable Scale X/Y, Skew and Pivot', r)

    # --- audio: keyframed volume, fades, waveform on the clip ---
    r = E("""async () => { const st = await import('./js/state.js'), R = await import('./js/render.js'); const p = st.newProject('1:1');
      const L = st.makeLayer(p, 'audio', { mediaId: 'a', mediaDuration: 4 }); L.start = 0; L.end = 4; L.media.fadeIn = 1; L.media.fadeOut = 1;
      const g = [0.5, 2, 3.5].map(t => +R.mediaGain(L, t).toFixed(3));
      st.setKey(L, 'media.volume', 1, 1, { type: 'linear' }); st.setKey(L, 'media.volume', 3, 0); L.keys['media.volume'][0].ease = { type: 'linear' };
      return { g, k: +R.mediaGain(L, 2).toFixed(3) }; }""")
    check('fade in / out ramps and keyframed volume', r == {'g': [0.5, 1, 0.5], 'k': 0.5}, r)
    wav = '/tmp/kntc-test.wav'
    with wave.open(wav, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b''.join(struct.pack('<h', int(9000 * math.sin(2 * math.pi * 440 * i / 8000) * (i / 16000))) for i in range(16000)))
    E("() => { __app.deselect(); }")
    pg.set_input_files('#fileAudio', wav)
    pg.wait_for_function("__app.project.layers[0].type === 'audio'", timeout=8000)
    pg.wait_for_selector('[data-testid=wave]', timeout=8000)
    E("() => { __app.selectLayer(__app.project.layers[0].id); __app.openSub('edit'); }"); pg.wait_for_timeout(100)
    check('audio clip shows a waveform; Edit Audio has ◆ volume and fades', pg.locator('[data-testid=wave]').count() >= 1 and pg.locator('[data-testid=audio-volume-key]').count() == 1 and pg.locator('[data-testid=fade-in]').count() == 1)

    # --- speed and reverse ---
    r = E("""async () => { const st = await import('./js/state.js'); const p = st.newProject('1:1');
      const L = st.makeLayer(p, 'video', { mediaId: 'v', w: 10, h: 10, mediaDuration: 6 }); L.start = 0; L.end = 4; L.media.offset = 1;
      st.setSpeed(L, 2); const a = { end: L.end, t1: st.mediaTime(L, 1) };
      st.setReverse(L, true); const b = { t0: st.mediaTime(L, 0), tEnd: st.mediaTime(L, 2) };
      st.setEnd(L, 1); const c = { off: L.media.offset, t0: st.mediaTime(L, 0) };          // trimming a reversed clip's end keeps its first frame
      st.setReverse(L, false); st.setStart(L, 0.5); const d = { off: L.media.offset };
      return { a, b, c, d }; }""")
    check('speed stretches the clip, reverse flips source time, trims keep frames', r == {'a': {'end': 2, 't1': 3}, 'b': {'t0': 5, 'tEnd': 1}, 'c': {'off': 3, 't0': 5}, 'd': {'off': 4}}, r)
    E("() => { __app.selectLayer(__app.project.layers[0].id); }"); pg.click('[data-testid=tab-speed]'); pg.wait_for_timeout(100)
    pg.click('[data-testid=speed-2]'); pg.click('[data-testid=reverse]'); pg.wait_for_timeout(50)
    r = E("() => { const m = __app.project.layers[0].media; return [m.speed, m.reverse]; }")
    check('Speed tile opens the Speed panel (2×, Reverse)', r == [2, True], r)

    # --- keyframe clipboard + moving a selection together ---
    r = E("""async () => { const st = await import('./js/state.js'); const p = st.newProject('1:1');
      const A = st.makeLayer(p, 'shape'), B = st.makeLayer(p, 'text');
      st.setKey(A, 'x', 1, 100); st.setKey(A, 'x', 2, 300); st.setKey(A, 'shape.fill', 2, '#ff0000');
      const clip = st.copyKeys(st.allKeys(A)); const ks = st.pasteKeys(B, clip, 5);
      return { n: ks.length, x: B.keys.x.map(k => [k.t, k.v]), fill: !!B.keys['shape.fill'] }; }""")
    check('copy / paste keyframes keeps spacing, skips props the target lacks', r == {'n': 2, 'x': [[5, 100], [6, 300]], 'fill': False}, r)
    r = E("""async () => { const A = __app, L = A.project.layers.find(l => l.type === 'shape' && Object.keys(l.keys).length);
      A.selectLayer(L.id); A.S.selKeys.clear(); const before = Object.values(L.keys).flat().map(k => k.t);
      document.activeElement?.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
      return { sel: A.S.selKeys.size, n: before.length }; }""")
    check('Ctrl+A selects every keyframe on the layer', r['sel'] == r['n'] and r['n'] > 1, r)
    # drag one selected diamond -> all selected keys move by the same amount
    kf = pg.locator('.tl-row.sel [data-testid=kf]').first; bb = kf.bounding_box()
    r0 = E("() => { const L = __app.project.layers.find(l => l.id === __app.S.sel); return Object.values(L.keys).flat().map(k => k.t).sort((a, b) => a - b); }")
    pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); pg.mouse.down(); pg.wait_for_timeout(450)
    pps = E('__app.S.pps'); pg.mouse.move(bb['x'] + bb['width'] / 2 + pps * 0.5, bb['y'] + bb['height'] / 2, steps=6); pg.mouse.up(); pg.wait_for_timeout(100)
    r1 = E("() => { const L = __app.project.layers.find(l => l.id === __app.S.sel); return Object.values(L.keys).flat().map(k => k.t).sort((a, b) => a - b); }")
    d = [round(b - a, 3) for a, b in zip(r0, r1)]
    check('dragging a selected keyframe moves the whole selection', len(set(d)) == 1 and d[0] > 0.3, (r0, r1))

    # --- bezier points ---
    r = E("""async () => { const R = await import('./js/render.js');
      const corner = R.pathSample([[0, 0], [100, 0], [100, 100]], false), smooth = R.pathSample([[0, 0, 0, 0], [100, 0, 0, 50], [100, 100, 0, 0]], false, 8);
      const mid = smooth[4]; return { corner: corner.length, smooth: smooth.length, bulge: mid[1] < -10 }; }""")
    check('smooth path points sample as cubic beziers', r == {'corner': 3, 'smooth': 17, 'bulge': True}, r)
    r = E("""async () => { const A = __app, p = A.project; const L = A.makeLayer(p, 'shape', { kind: 'path', pts: [[-100, -100], [100, -100], [100, 100], [-100, 100]] }); A.addLayer(L);
      A.selectLayer(L.id); A.openSub('edit'); await new Promise(r => setTimeout(r, 50));
      document.querySelector('[data-testid=pt-curve]').click(); return [A.S.tab, A.S.curve]; }""")
    check('Edit Points has a working Curves toggle', r == ['points', True], r)
    hp = E("""() => { const A = __app, L = A.project.layers[0], r = document.querySelector('#view').getBoundingClientRect(), s = r.width / A.project.w;
      return [r.left + (L.props.x + 100) * s, r.top + (L.props.y - 100) * s]; }""")
    pg.mouse.click(hp[0], hp[1]); pg.wait_for_timeout(100)
    r = E("() => __app.project.layers[0].shape.pts.map(p => p.length)")
    check('tapping a point in Curves mode makes it smooth', r.count(4) == 1, r)

    print('page errors', errs[:5])
    check('no page errors', not errs, errs[:3])
    b.close()
n = sum(ok for _, ok in results); print(f'{n}/{len(results)} passed'); sys.exit(0 if n == len(results) else 1)
