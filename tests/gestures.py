"""Timeline touch-gesture tests: iPhone emulation at 440x956 with real touch input (CDP Input.dispatchTouchEvent -> pointerType 'touch')."""
import json, os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:8765/')
SHOTS = '/workspace/alight-web/screenshots'
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail) if detail != '' else ''), flush=True)

# first point (scanning the visible timeline) where elementFromPoint hits `sel` (optionally restricted to an element index / layer)
FIND = """([sel, layerId]) => {
  const tl = document.getElementById('tlScroll').getBoundingClientRect();
  const root = layerId ? document.querySelector(`.tl-row[data-layer="${layerId}"]`) : document;
  const wantItem = sel.includes('kf');
  for (const el of root.querySelectorAll(sel)) { const r = el.getBoundingClientRect(), y = r.top + r.height / 2;
    if (y < tl.top + 26 || y > tl.bottom - 6) continue;
    for (let x = Math.max(r.left + 2, tl.left + 100); x < Math.min(r.right - 2, tl.right - 10); x += 3) {
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest(sel) === el && (wantItem || !hit.closest('.kf, .trim'))) return { x, y };
    }
  }
  return null; }"""
KBOX = """(id) => { const k = document.querySelector(`.tl-row[data-layer="${id}"] .kf`); const r = k.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return { x: cx, y: cy, w: r.width, h: r.height, hit44: [[-20, 0], [20, 0], [0, -20], [0, 20]].every(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy)?.closest('.kf') === k) }; }"""
STATE = """() => { const tl = document.getElementById('tlScroll');
  return { sl: tl.scrollLeft, st: tl.scrollTop, sw: tl.scrollWidth - tl.clientWidth, sh: tl.scrollHeight - tl.clientHeight,
    wy: window.scrollY, wx: window.scrollX, de: document.documentElement.scrollTop, bt: document.body.scrollTop,
    app: Math.round(document.getElementById('app').getBoundingClientRect().top), pps: __app.S.pps, t: __app.S.t, sel: __app.S.sel }; }"""

def main():
    with sync_playwright() as pw:
        dev = dict(pw.devices['iPhone 15 Pro Max']); dev['viewport'] = {'width': 440, 'height': 956}; dev['screen'] = {'width': 440, 'height': 956}
        b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = b.new_context(**dev); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        cdp = ctx.new_cdp_session(pg)
        P = pg.evaluate
        def touch(typ, pts):
            cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': x, 'y': y, 'id': i, 'radiusX': 4, 'radiusY': 4, 'force': 1} for i, (x, y) in enumerate(pts)]})
        def gesture(paths, hold=0, steps=12, dt=16, end=True):
            """paths: list of (x0,y0,x1,y1) per finger."""
            touch('touchStart', [(p[0], p[1]) for p in paths])
            if hold: pg.wait_for_timeout(hold)
            for i in range(1, steps + 1):
                f = i / steps; touch('touchMove', [(p[0] + (p[2] - p[0]) * f, p[1] + (p[3] - p[1]) * f) for p in paths]); pg.wait_for_timeout(dt)
            if end: touch('touchEnd', [])
        def tap(x, y): touch('touchStart', [(x, y)]); pg.wait_for_timeout(60); touch('touchEnd', []); pg.wait_for_timeout(150)
        def settle():  # wait for any momentum to finish
            last = None
            for _ in range(60):
                cur = P("[document.getElementById('tlScroll').scrollLeft, document.getElementById('tlScroll').scrollTop]")
                if cur == last: return
                last = cur; pg.wait_for_timeout(80)
        def reset_scroll(): settle(); P("(() => { const t = document.getElementById('tlScroll'); t.scrollLeft = 0; t.scrollTop = 0; })()"); pg.wait_for_timeout(50)
        def layer(i): return P(f"(() => {{ const L = __app.project.layers[{i}]; return {{ id: L.id, start: L.start, end: L.end, keys: Object.fromEntries(Object.entries(L.keys).map(([k, v]) => [k, v.map(x => x.t)])) }}; }})()")

        pg.goto(BASE); pg.wait_for_function('window.__app && __app.project')
        P('localStorage.clear()'); pg.reload(); pg.wait_for_function('window.__app && __app.project'); pg.wait_for_timeout(600)
        # page-lock & meta checks
        css = P("""(() => { const cs = e => getComputedStyle(e); const h = document.documentElement, b = document.body, tl = document.getElementById('tlScroll');
          return { hPos: cs(h).position, bPos: cs(b).position, hOv: cs(h).overflow, bOver: cs(b).overscrollBehaviorY, bTA: cs(b).touchAction, appTA: cs(document.getElementById('app')).touchAction,
                   tlTA: cs(tl).touchAction, status: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]').content }; })()""")
        check('page shell locked (html/body fixed, overflow hidden, overscroll none, touch-action none)',
              css['hPos'] == 'fixed' and css['bPos'] == 'fixed' and css['hOv'] == 'hidden' and css['bOver'] == 'none' and css['bTA'] == 'none' and css['appTA'] == 'none' and css['tlTA'] == 'none', css)
        check("status bar style stays 'default'", css['status'] == 'default', css['status'])
        sw = P("fetch('sw.js').then(r => r.text())")
        check('service worker cache bumped to kntc-v3', "'kntc-v3'" in sw)

        # more layers so the timeline overflows vertically, deselect, zoom in so it overflows horizontally
        for _ in range(4): pg.click('[data-testid=add-rect]') if P('__app.S.tab') == 'add' else (pg.click('[data-testid=tab-add]'), pg.click('[data-testid=add-rect]'))
        P("__app.S.sel = null; __app.S.selKeys.clear(); __app.S.autoFit = false; __app.S.pps = 200; __app.seek(0); __app.refreshAll()"); pg.wait_for_timeout(200)
        s0 = P(STATE)
        check('timeline overflows both ways (precondition)', s0['sw'] > 200 and s0['sh'] > 30, s0)

        # find a layer that has keyframes (demo) and its unselected clip
        n = P('__app.project.layers.length')
        ki = next(i for i in range(n) if any(layer(i)['keys'].values()))
        P(f"__app.project.layers[{ki}].end = 4; __app.refreshAll()"); pg.wait_for_timeout(100)  # shorter than the comp so it can move
        L0 = layer(ki)
        cpt = P(FIND, ['.clip', L0['id']])
        check('found a clip point', cpt is not None, cpt)

        # 1. horizontal swipe on an (unselected) clip pans, clip doesn't move, page doesn't move
        reset_scroll()
        gesture([(cpt['x'], cpt['y'], cpt['x'] - 160, cpt['y'] + 6)], steps=14, dt=20); pg.wait_for_timeout(400)
        s1 = P(STATE); L1 = layer(ki)
        check('swipe on clip pans timeline horizontally', s1['sl'] >= 120, s1['sl'])
        check('swipe on clip does not move/trim the clip or its keys', L1 == L0, (L0, L1))
        check('swipe on clip: axis lock keeps vertical scroll at 0', s1['st'] == 0, s1['st'])
        check('page scroll stays 0 after horizontal swipe', s1['wy'] == 0 and s1['wx'] == 0 and s1['de'] == 0 and s1['bt'] == 0 and s1['app'] == 0, s1)
        check('swipe on clip does not select it', s1['sel'] is None, s1['sel'])

        # 2. vertical swipe on a clip pans vertically
        reset_scroll(); cpt = P(FIND, ['.clip', L0['id']])
        gesture([(cpt['x'], cpt['y'], cpt['x'] + 4, cpt['y'] - 120)], steps=12, dt=20); pg.wait_for_timeout(400)
        s2 = P(STATE)
        check('vertical swipe on clip pans timeline vertically', s2['st'] > 20 and s2['sl'] == 0, (s2['st'], s2['sl']))
        check('page scroll stays 0 after vertical swipe', s2['wy'] == 0 and s2['de'] == 0 and s2['bt'] == 0 and s2['app'] == 0, s2)
        check('vertical swipe leaves clip untouched', layer(ki) == L0)

        # 3. momentum: fast flick keeps scrolling after release
        reset_scroll(); cpt = P(FIND, ['.clip', L0['id']])
        gesture([(cpt['x'], cpt['y'], cpt['x'] - 90, cpt['y'])], steps=6, dt=10)
        a = P(STATE)['sl']; pg.wait_for_timeout(600); bsl = P(STATE)['sl']
        check('flick has momentum (keeps scrolling after release)', bsl > a + 20, (a, bsl))

        # 4. tap on clip selects it
        reset_scroll(); P("__app.S.sel = null; __app.refreshAll()"); pg.wait_for_timeout(100)
        cpt = P(FIND, ['.clip', L0['id']]); tap(cpt['x'], cpt['y'])
        check('tap on clip selects the layer', P('__app.S.sel') == L0['id'], P('__app.S.sel'))

        # 5. long press then drag moves an unselected clip
        P("__app.S.sel = null; __app.refreshAll()"); pg.wait_for_timeout(100); reset_scroll()
        cpt = P(FIND, ['.clip', L0['id']])
        touch('touchStart', [(cpt['x'], cpt['y'])]); pg.wait_for_timeout(420)
        grabbed = P("!!document.querySelector('.clip.grabbed')")
        for i in range(1, 11): touch('touchMove', [(cpt['x'] + 6 * i, cpt['y'] + 1)]); pg.wait_for_timeout(16)
        pg.screenshot(path=f'{SHOTS}/iphone-10-longpress-drag.png')
        touch('touchEnd', []); pg.wait_for_timeout(200)
        L5 = layer(ki); s5 = P(STATE)
        check('long press shows grab feedback (.grabbed)', grabbed)
        check('long press + drag moves the clip', abs((L5['start'] - L0['start']) - 60 / 200) < 0.06, (L0['start'], L5['start']))
        check('long press + drag does not pan the timeline', s5['sl'] == 0 and s5['st'] == 0, s5)
        check('grab feedback cleared after release', not P("!!document.querySelector('.grabbed')"))
        P("__app.S.sel = null; __app.S.selKeys.clear(); __app.refreshAll()"); pg.wait_for_timeout(100)

        # 6. selected clip: horizontal drag moves immediately (no long press needed)
        P(f"__app.S.sel = '{L0['id']}'; __app.refreshAll()"); pg.wait_for_timeout(100); reset_scroll()
        Lb = layer(ki); cpt = P(FIND, ['.clip.sel', None])
        gesture([(cpt['x'], cpt['y'], cpt['x'] - 40, cpt['y'])], steps=8); pg.wait_for_timeout(150)
        La = layer(ki)
        check('already-selected clip drags immediately', La['start'] < Lb['start'] - 0.1, (Lb['start'], La['start']))
        P("__app.S.sel = null; __app.S.selKeys.clear(); __app.refreshAll()"); pg.wait_for_timeout(100)

        # 7. keyframes: 44px hit box, swipe pans, long press drags
        reset_scroll(); Lk = layer(ki)
        kbox = P(KBOX, Lk['id']); hit44 = kbox['hit44']
        check('keyframe touch target is 44px', kbox['w'] >= 44 and hit44, kbox)
        kpt = P(FIND, ['.kf', Lk['id']])
        gesture([(kpt['x'], kpt['y'], kpt['x'] - 120, kpt['y'])], steps=12, dt=20); pg.wait_for_timeout(400)
        s7 = P(STATE); Lk2 = layer(ki)
        check('swipe starting on a keyframe pans, keyframe stays', s7['sl'] >= 80 and Lk2 == Lk, (s7['sl'], Lk['keys'], Lk2['keys']))
        reset_scroll(); P("__app.S.sel = null; __app.S.selKeys.clear(); __app.refreshAll()"); pg.wait_for_timeout(100)
        kpt = P(FIND, ['.kf', Lk['id']])
        touch('touchStart', [(kpt['x'], kpt['y'])]); pg.wait_for_timeout(420)
        kgrab = P("!!document.querySelector('.kf.grabbed')")
        for i in range(1, 11): touch('touchMove', [(kpt['x'] + 8 * i, kpt['y'])]); pg.wait_for_timeout(16)
        touch('touchEnd', []); pg.wait_for_timeout(200)
        Lk3 = layer(ki); s7b = P(STATE)
        moved = [p for p in Lk['keys'] if Lk['keys'][p] != Lk3['keys'][p]]
        check('long press on keyframe grabs it (feedback)', kgrab)
        check('long press + drag moves the keyframe', len(moved) >= 1 and s7b['sl'] == 0, (Lk['keys'], Lk3['keys']))

        # 8. trim handle on a selected clip has a 44px target and trims immediately
        P(f"__app.S.sel = '{L0['id']}'; __app.S.selKeys.clear(); __app.refreshAll()"); pg.wait_for_timeout(100)
        P("(() => { const t = document.getElementById('tlScroll'); const c = document.querySelector('.clip.sel').getBoundingClientRect(); t.scrollLeft += c.right - t.getBoundingClientRect().right + 80; })()"); pg.wait_for_timeout(50)
        tr = P("""(() => { const r = document.querySelector('.clip.sel').getBoundingClientRect(); const y = r.top + r.height / 2;
            return { x: r.right, y, out: document.elementFromPoint(r.right + 18, y)?.className, inn: document.elementFromPoint(r.right - 18, y)?.className }; })()""")
        check('selected clip trim handle has 44px touch area (±18px around edge)', 'trim' in str(tr['out']) and 'trim' in str(tr['inn']), tr)
        Le = layer(ki)
        gesture([(tr['x'] + 12, tr['y'], tr['x'] - 48, tr['y'])], steps=8); pg.wait_for_timeout(150)
        check('dragging the selected trim handle trims the clip end', layer(ki)['end'] < Le['end'] - 0.15 and layer(ki)['start'] == Le['start'], (Le['end'], layer(ki)['end']))
        P("__app.S.sel = null; __app.S.selKeys.clear(); __app.refreshAll()"); pg.wait_for_timeout(100)

        # 9. ruler scrubs (and does not pan)
        reset_scroll()
        rb = pg.locator('[data-testid=ruler]').bounding_box()
        gesture([(rb['x'] + 60, rb['y'] + 10, rb['x'] + 260, rb['y'] + 10)], steps=10); pg.wait_for_timeout(150)
        settle(); s9 = P(STATE)
        check('ruler swipe scrubs the playhead', abs(s9['t'] - 1.3) < 0.15 and s9['sl'] == 0, (s9['t'], s9['sl']))

        # 10. pinch zoom
        reset_scroll(); tlb = pg.locator('#tlScroll').bounding_box(); cy = tlb['y'] + tlb['height'] * 0.6; cx = tlb['x'] + 260
        pps0 = P('__app.S.pps')
        gesture([(cx - 20, cy, cx - 90, cy), (cx + 20, cy + 4, cx + 90, cy + 4)], steps=12, dt=24); pg.wait_for_timeout(200)
        pps1 = P('__app.S.pps')
        check('pinch out zooms time in', pps1 > pps0 * 2.5, (pps0, round(pps1, 1)))
        gesture([(cx - 90, cy, cx - 30, cy), (cx + 90, cy + 4, cx + 30, cy + 4)], steps=12, dt=24); pg.wait_for_timeout(200)
        pps2 = P('__app.S.pps')
        check('pinch in zooms time out', pps2 < pps1 * 0.5, (round(pps1, 1), round(pps2, 1)))
        check('pinch leaves clips untouched', layer(ki)['start'] == Lk3['start'])

        # 11. swipes on non-scrollable chrome (transport, header, stage edge) never move the page
        for sel in ['#transport', '#top', '#tabs']:
            bb = pg.locator(sel).bounding_box(); x, y = bb['x'] + bb['width'] * 0.55, bb['y'] + bb['height'] / 2
            gesture([(x, y, x - 60, y - 200)], steps=10)
        pg.wait_for_timeout(300); s11 = P(STATE)
        check('page scroll position stays 0 after swipes on app chrome', s11['wy'] == 0 and s11['wx'] == 0 and s11['de'] == 0 and s11['bt'] == 0 and s11['app'] == 0, s11)
        pg.screenshot(path=f'{SHOTS}/iphone-11-gestures.png')
        check('no page errors', not [e for e in errs if 'GL Driver' not in e], errs[:5])
        b.close()

main()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
