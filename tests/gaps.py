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
    pg = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True).new_page(); errs = []
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

    # --- export: frame-accurate WebM via WebCodecs, GIF, PNG ZIP, transparency ---
    E("() => { __app.project.duration = 1; __app.commit(); }")
    r = E("""async () => { const X = await import('./js/export.js'); await X.formatsReady; const p = __app.project;
      const out = {};
      const v = await X.exportVideo(p, { format: 'webm', shortSide: 240, fps: 12, bitrate: 1e6, audio: true });
      const url = URL.createObjectURL(v.blob), el = document.createElement('video'); el.muted = true; el.src = url;
      await new Promise(r => { el.onloadedmetadata = r; el.onerror = r; });
      out.webm = { exact: !!v.exact, w: el.videoWidth, dur: +el.duration.toFixed(2), size: v.blob.size };
      const g = await X.exportVideo(p, { format: 'gif', shortSide: 120, fps: 10, transparent: true });
      const img = new Image(); img.src = URL.createObjectURL(g.blob); await img.decode().catch(() => {});
      const head = String.fromCharCode(...new Uint8Array(await g.blob.slice(0, 6).arrayBuffer()));
      out.gif = { head, w: img.naturalWidth, ok: img.complete && img.naturalWidth > 0 };
      const z = await X.exportVideo(p, { format: 'png', shortSide: 120, fps: 5, transparent: true });
      const zb = new Uint8Array(await z.blob.arrayBuffer());
      out.png = { frames: z.frames, sig: zb[0] === 0x50 && zb[1] === 0x4b, firstPng: zb[30 + 'frame_00001.png'.length + 1] === 0x50 };
      return out; }""")
    check('WebM export renders every frame (WebCodecs) at the right length', r['webm']['exact'] and r['webm']['w'] == 240 and abs(r['webm']['dur'] - 1) < 0.15 and r['webm']['size'] > 500, r['webm'])
    check('GIF export decodes', r['gif']['head'] == 'GIF89a' and r['gif']['ok'] and r['gif']['w'] > 0, r['gif'])
    check('PNG sequence ZIP has one PNG per frame', r['png'] == {'frames': 5, 'sig': True, 'firstPng': True}, r['png'])
    r = E("""async () => { const R = await import('./js/render.js'); const c = document.createElement('canvas'); c.width = 60; c.height = 60;
      new R.Renderer().render({ ...__app.project, layers: [] }, 0, c, { transparent: true }); return c.getContext('2d').getImageData(5, 5, 1, 1).data[3]; }""")
    check('transparent render leaves the background clear', r == 0, r)

    # --- parenting, null objects, groups ---
    r = E("""async () => { const A = __app, p = A.project; p.duration = 4;
      const par = A.makeLayer(p, 'null'); par.props.x = 300; par.props.y = 300; A.addLayer(par);
      const kid = A.makeLayer(p, 'shape'); kid.props.x = 400; kid.props.y = 300; A.addLayer(kid);
      const w0 = A.layerMatrix(kid, 0, p).transformPoint({ x: 0, y: 0 });
      A.seek(0); A.reparent(kid, par.id);
      const w1 = A.layerMatrix(kid, 0, p).transformPoint({ x: 0, y: 0 });
      par.props.rotation = 90; const w2 = A.layerMatrix(kid, 0, p).transformPoint({ x: 0, y: 0 }); par.props.rotation = 0;
      A.reparent(kid, null); const w3 = A.layerMatrix(kid, 0, p).transformPoint({ x: 0, y: 0 });
      const r = v => [Math.round(v.x), Math.round(v.y)];
      return { w0: r(w0), w1: r(w1), w2: r(w2), w3: r(w3), parent: kid.parent || null }; }""")
    check('parenting keeps the layer in place and makes it follow its parent', r == {'w0': [400, 300], 'w1': [400, 300], 'w2': [300, 400], 'w3': [400, 300], 'parent': None}, r)
    r = E("""async () => { const A = __app, p = A.project;
      const a = A.makeLayer(p, 'shape'), b = A.makeLayer(p, 'shape'); a.props.x = 200; b.props.x = 600; a.props.y = b.props.y = 500; A.addLayer(b); A.addLayer(a);
      A.groupLayers([a, b]); const g = p.layers.find(l => l.id === A.S.sel);
      const ok1 = g.type === 'group' && a.group === g.id && b.group === g.id && p.layers.indexOf(a) === p.layers.indexOf(g) + 1;
      // render: the group draws its members; hiding the group hides them
      const c = document.createElement('canvas'); c.width = p.w / 4; c.height = p.h / 4; const R = A.renderer;
      const px = () => { R.render(p, 0, c, { skipMediaSync: true }); return Array.from(c.getContext('2d').getImageData(Math.round(200 / 4), Math.round(500 / 4), 1, 1).data).slice(0, 3).join(); };
      const shown = px(); g.visible = false; const hidden = px(); g.visible = true;
      g.props.opacity = 0; const faded = px(); g.props.opacity = 1;
      A.duplicateLayer(g); const groups = p.layers.filter(l => l.type === 'group').length, copies = p.layers.filter(l => l.group && l.group !== g.id).length;
      A.selectLayer(g.id); A.ungroup(g); const freed = !a.group && !a.parent && Math.round(A.layerMatrix(a, 0, p).e) === 200;
      return { ok1, changed: shown !== hidden, faded: faded === hidden, groups, copies, freed }; }""")
    check('groups render their members, honour visibility / opacity, duplicate and ungroup', r == {'ok1': True, 'changed': True, 'faded': True, 'groups': 2, 'copies': 2, 'freed': True}, r)

    # --- track matte masks ---
    r = E("""async () => { const A = __app, R = await import('./js/render.js'), st = await import('./js/state.js');
      const p = st.newProject('1:1', 'm', { bg: '#000000' }); p.w = p.h = 200;
      const base = st.makeLayer(p, 'solid'); base.solid.color = '#ffffff';
      const m = st.makeLayer(p, 'shape', { kind: 'rect' }); m.shape.w = 100; m.shape.h = 200; m.shape.radius = 0; m.props.x = 50; m.props.y = 100; m.visible = false; m.shape.fill = '#ffffff';
      p.layers = [base, m]; base.matte = { layer: m.id };
      const c = document.createElement('canvas'); c.width = c.height = 200; const r = new R.Renderer();
      const at = x => { r.render(p, 0, c, { skipMediaSync: true }); return c.getContext('2d').getImageData(x, 100, 1, 1).data[0]; };
      const a = [at(20), at(180)]; base.matte.invert = true; const b = [at(20), at(180)];
      base.matte = { layer: m.id, mode: 'luma' }; m.shape.fill = '#000000'; const l = at(20);
      return { a, b, l }; }""")
    check('track matte: alpha keeps the inside, invert the outside, luma uses brightness', r == {'a': [255, 0], 'b': [0, 255], 'l': 0}, r)
    E("() => { __app.selectLayer(__app.project.layers.find(l => l.type === 'shape').id); __app.openSub('blend'); }"); pg.wait_for_timeout(100)
    check('Blending & Opacity has a Mask Layer picker', pg.locator('[data-testid=matte-layer]').count() == 1)

    # --- fonts: more built-in stacks + importing a font file ---
    font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    if os.path.exists(font):
        E("() => { const A = __app, L = A.makeLayer(A.project, 'text'); A.addLayer(L); A.openSub('edit'); }"); pg.wait_for_timeout(100)
        opts = E("() => [...document.querySelectorAll('[data-testid=text-font] option')].map(o => o.value)")
        r = E("""async (b64) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const f = new File([bin], 'DejaVuSans.ttf', { type: 'font/ttf' });
          const A = __app, L = A.project.layers[0]; await A.importFont(f, L);
          return { font: L.text.font, listed: (A.project.fonts || []).length, loaded: [...document.fonts].some(x => x.family === 'kf_' + L.text.font.slice(2) && x.status === 'loaded') }; }""",
          __import__('base64').b64encode(open(font, 'rb').read()).decode())
        check('font list has more fonts plus Import Font…', len(opts) >= 15 and '+import' in opts, opts)
        check('imported font is registered and applied to the text layer', r['font'].startswith('f:') and r['listed'] == 1 and r['loaded'], r)

    # --- project motion blur, markers, beat markers, share ---
    r = E("""async () => { const R = await import('./js/render.js'), st = await import('./js/state.js');
      const p = st.newProject('1:1', 'mb', { bg: '#000000', fps: 10 }); p.w = p.h = 200;
      const L = st.makeLayer(p, 'shape', { kind: 'rect' }); L.shape.w = L.shape.h = 20; L.shape.radius = 0; L.shape.fill = '#ffffff'; L.props.y = 100;
      st.setKey(L, 'x', 0, 0, { type: 'linear' }); st.setKey(L, 'x', 1, 200); L.keys.x[0].ease = { type: 'linear' }; p.layers = [L];
      const c = document.createElement('canvas'); c.width = c.height = 200; const r = new R.Renderer();
      const lit = () => { r.render(p, 0.5, c, { skipMediaSync: true }); const d = c.getContext('2d').getImageData(0, 100, 200, 1).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 8) n++; return n; };
      const sharp = lit(); p.motionBlur = { on: true, shutter: 180, samples: 8 }; const blurred = lit(); return { sharp, blurred }; }""")
    check('project Motion Blur smears animated layers', r['blurred'] >= r['sharp'] + 8, r)
    r = E("""() => { const A = __app; A.project.markers = []; A.seek(0.5); A.addMarker(0.5); A.addMarker(0.5); return A.project.markers.length; }""")
    pg.wait_for_timeout(50)
    check('markers: added at the playhead (no duplicates) and drawn on the ruler', r == 1 and pg.locator('[data-testid=marker]').count() == 1, r)
    E("() => { const A = __app, L = A.project.layers.find(l => l.type === 'audio'); A.selectLayer(L.id); A.openSub('edit'); }"); pg.wait_for_timeout(100)
    n0 = E('__app.project.markers.length'); pg.click('[data-testid=beat-markers]'); pg.wait_for_timeout(100)
    check('Add Beat Markers runs on an audio clip', E('__app.project.markers.length') >= n0, E('__app.project.markers.length'))
    with pg.expect_download() as dl: E('__app.shareProject()')
    check('Share Project hands over a .kntc.json file', dl.value.suggested_filename.endswith('.kntc.json'), dl.value.suggested_filename)

    # --- colour tools: eyedropper on the preview + recent swatches ---
    r = E("""async () => { const A = __app, L = A.project.layers.find(l => l.type === 'shape' && !l.group);
      A.selectLayer(L.id); A.openSub('style'); await new Promise(r => setTimeout(r, 50));
      const drop = !!document.querySelector('[data-testid=fill-color-drop]');
      A.S.pick = null; const want = A.samplePreview(5, 5);
      return { drop, want, id: L.id }; }""")
    E("() => { __app.S.pick = null; }")
    E("""() => { const A = __app, L = A.project.layers.find(l => l.id === A.S.sel); window.__picked = null;
      A.S.pick = v => { window.__picked = v; }; document.querySelector('#stage').classList.add('picking'); }""")
    bb = pg.locator('#stage').bounding_box(); pg.mouse.click(bb['x'] + 3, bb['y'] + 3); pg.wait_for_timeout(50)
    picked = E('window.__picked')
    check('colour fields have an eyedropper that samples the preview', r['drop'] and picked and picked.startswith('#') and len(picked) == 7, (r, picked))
    E("""() => { const i = document.querySelector('[data-testid=fill-color]'); i.value = '#123456'; i.dispatchEvent(new Event('change')); }"""); pg.wait_for_timeout(50)
    check('used colours show up as swatches', E("JSON.parse(localStorage.getItem('kntc.swatches'))[0]") == '#123456' and pg.locator('.csw').count() >= 1)

    # --- My Elements and nested projects ---
    r = E("""async () => { const A = __app, p = A.project;
      const g = p.layers.find(l => l.type === 'group'); A.saveElement(g);
      const el = JSON.parse(localStorage.getItem('kntc.elements'))[0];
      const n0 = p.layers.length; A.seek(1); A.insertElement(el);
      const made = p.layers.slice(0, el.layers.length), ng = made.find(l => l.type === 'group');
      return { saved: el.layers.length, added: p.layers.length - n0, linked: made.filter(l => l.group).every(l => l.group === ng.id), fresh: !made.some(l => l.id === g.id), start: ng.start }; }""")
    check('Save to My Elements / insert brings the group back with fresh ids at the playhead', r['saved'] >= 3 and r['added'] == r['saved'] and r['linked'] and r['fresh'] and abs(r['start'] - 1) < 0.05, r)
    r = E("""async () => { const A = __app, st = await import('./js/state.js'), store = await import('./js/storage.js');
      const sub = st.newProject('1:1', 'Sub', { bg: '#ff0000' }); sub.duration = 2; const sh = st.makeLayer(sub, 'solid'); sh.solid.color = '#00ff00'; sub.layers = [sh];
      store.saveProject(sub); const cur = A.project; store.saveProject(cur);
      await A.addComp(sub.id); const L = A.project.layers[0];
      A.project.layers.forEach(l => { if (l !== L) l.visible = false; }); L.props.x = A.project.w / 2; L.props.y = A.project.h / 2; L.props.scale = 0.2;
      const c = document.createElement('canvas'); c.width = A.project.w / 4; c.height = A.project.h / 4; A.renderer.render(A.project, 0.5, c, { skipMediaSync: true });
      const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data;
      A.project.layers.forEach(l => (l.visible = true));
      return { type: L.type, px: [d[0], d[1], d[2]] }; }""")
    check('a project placed as a nested element renders inside this one', r['type'] == 'comp' and r['px'][1] > 200 and r['px'][0] < 50, r)

    # --- 3D layers and the camera ---
    r = E("""async () => { const R = await import('./js/render.js'), st = await import('./js/state.js');
      const p = st.newProject('1:1', '3d', { bg: '#000000' }); p.w = p.h = 400;
      const L = st.makeLayer(p, 'solid'); L.solid.color = '#ffffff'; L.props.scale = 0.5; p.layers = [L];
      const c = document.createElement('canvas'); c.width = c.height = 400; const r = new R.Renderer();
      const row = y => { r.render(p, 0, c, { skipMediaSync: true }); const d = c.getContext('2d').getImageData(0, y, 400, 1).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 128) n++; return n; };
      const flat = [row(110), row(290)];
      L.is3d = true; L.props.rotX = 50; const tilted = [row(140), row(260)];
      L.props.rotX = 0; L.props.z = 400; const far = row(200);
      const cam = st.makeLayer(p, 'camera'); cam.props.zoom = 2; p.layers.push(cam); const zoomed = row(200);
      return { flat, tilted, far, zoomed }; }""")
    t = r['tilted']
    check('3D layer: Rotate X tilts with perspective (near edge wider than far edge)', r['flat'][0] == r['flat'][1] and abs(t[0] - t[1]) > 8, r)
    check('3D layer: Z pushes it back; camera zoom brings it closer', r['far'] < r['flat'][0] and r['zoomed'] > r['far'], r)
    E("() => { const A = __app, L = A.project.layers.find(l => l.type === 'shape' && !l.group); A.selectLayer(L.id); A.openSub('layer'); }"); pg.wait_for_timeout(80)
    pg.click('[data-testid=is3d]'); pg.wait_for_timeout(80)
    check('Move & Transform has a 3D Layer switch with Z / Rotate X / Rotate Y', pg.locator('[data-testid=prop-rotX]').count() == 1 and pg.locator('[data-testid=prop-z-key]').count() == 1)

    print('page errors', errs[:5])
    check('no page errors', not errs, errs[:3])
    b.close()
n = sum(ok for _, ok in results); print(f'{n}/{len(results)} passed'); sys.exit(0 if n == len(results) else 1)
