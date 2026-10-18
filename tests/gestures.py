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
    if (y < tl.top + 50 || y > tl.bottom - 6) continue;
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
        def reset_scroll():  # t = 0; vertical 0, or (with a selection) the selected row at the top like the app does on select
            settle(); P("""(() => { const t = document.getElementById('tlScroll'); t.scrollLeft = 0; t.scrollTop = 0;
              const r = __app.S.sel && document.querySelector(`.tl-row[data-layer="${__app.S.sel}"]`);
              if (r) t.scrollTop += r.getBoundingClientRect().top - t.getBoundingClientRect().top - 48; })()"""); pg.wait_for_timeout(50)
        def layer(i): return P(f"(() => {{ const L = __app.project.layers[{i}]; return {{ id: L.id, start: L.start, end: L.end, keys: Object.fromEntries(Object.entries(L.keys).map(([k, v]) => [k, v.map(x => x.t)])) }}; }})()")

        pg.goto(BASE); pg.wait_for_function('window.__app && __app.project')
        P('localStorage.clear()'); pg.reload(); pg.wait_for_function('window.__app && __app.project'); pg.wait_for_timeout(600)
        pg.click('[data-testid=home-open] >> nth=0'); pg.wait_for_timeout(200)
        # panning now scrubs the preview under the fixed centre playhead; swiftshader software-GL needs ~700ms per preview frame at DPR 3,
        # which would starve the touch-event timing these tests measure. Stub the preview renderer: this suite tests the timeline only.
        P("__app.renderer.render = () => {}")
        # page-lock & meta checks
        css = P("""(() => { const cs = e => getComputedStyle(e); const h = document.documentElement, b = document.body, tl = document.getElementById('tlScroll');
          return { hPos: cs(h).position, bPos: cs(b).position, hOv: cs(h).overflow, bOver: cs(b).overscrollBehaviorY, bTA: cs(b).touchAction, appTA: cs(document.getElementById('app')).touchAction,
                   tlTA: cs(tl).touchAction, status: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]').content }; })()""")
        check('page shell locked (html/body fixed, overflow hidden, overscroll none, touch-action none)',
              css['hPos'] == 'fixed' and css['bPos'] == 'fixed' and css['hOv'] == 'hidden' and css['bOver'] == 'none' and css['bTA'] == 'none' and css['appTA'] == 'none' and css['tlTA'] == 'none', css)
        check("status bar style stays 'default'", css['status'] == 'default', css['status'])
        sw = P("fetch('sw.js').then(r => r.text())")
        check('service worker cache bumped to kntc-v11', "'kntc-v11'" in sw)

        # more layers so the timeline overflows vertically, deselect, zoom in so it overflows horizontally
        for _ in range(4):
            if P("document.body.dataset.mode") != 'none': pg.click('[data-testid=btn-back]'); pg.wait_for_timeout(60)
            pg.click('[data-testid=tab-add]'); pg.click('[data-testid=add-rect]'); pg.wait_for_timeout(60)
        check('new layers are added on top', P("__app.project.layers.slice(0, 4).every(l => l.type === 'shape' && l.shape.kind === 'rect')"))
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

        # 6. selected clip: a quick drag pans (never moves it); moving still needs the long press
        P(f"__app.S.sel = '{L0['id']}'; __app.refreshAll()"); pg.wait_for_timeout(100); reset_scroll()
        Lb = layer(ki); cpt = P(FIND, ['.clip.sel', None])
        gesture([(cpt['x'], cpt['y'], cpt['x'] - 40, cpt['y'])], steps=8); pg.wait_for_timeout(400); settle()
        check('quick drag on a selected clip pans and does not move it', layer(ki) == Lb and P(STATE)['sl'] > 20, (Lb['start'], layer(ki)['start'], P(STATE)['sl']))
        P("__app.S.sel = null; __app.S.selKeys.clear(); __app.refreshAll()"); pg.wait_for_timeout(100)

        # 7. keyframes: 44px hit box, swipe pans, long press drags
        reset_scroll(); Lk = layer(ki)
        TOROW = """(id) => { const t = document.getElementById('tlScroll'), r = document.querySelector(`.tl-row[data-layer="${id}"]`); t.scrollTop += r.getBoundingClientRect().top - t.getBoundingClientRect().top - 48; return t.scrollTop; }"""
        P(TOROW, Lk['id']); P(f"(() => {{ const t = document.getElementById('tlScroll'), k = document.querySelector('.tl-row[data-layer=\"{Lk['id']}\"] .kf').getBoundingClientRect(), r = t.getBoundingClientRect(); t.scrollTop -= 10; t.scrollLeft += k.left + k.width / 2 - (r.left + r.width / 2) + 60; }})()"); pg.wait_for_timeout(50)  # 32px rows: keep the 44px box clear of the sticky ruler band
        kbox = P(KBOX, Lk['id']); hit44 = kbox['hit44']
        check('keyframe touch target is 44px', kbox['w'] >= 44 and hit44, kbox)
        kpt = P(FIND, ['.kf', Lk['id']])
        gesture([(kpt['x'], kpt['y'], kpt['x'] - 120, kpt['y'])], steps=12, dt=20); pg.wait_for_timeout(400)
        s7 = P(STATE); Lk2 = layer(ki)
        check('swipe starting on a keyframe pans, keyframe stays', s7['sl'] >= 80 and Lk2 == Lk, (s7['sl'], Lk['keys'], Lk2['keys']))
        reset_scroll(); P("__app.S.sel = null; __app.S.selKeys.clear(); __app.refreshAll()"); pg.wait_for_timeout(100)
        # a selected (on) keyframe still needs the long press: a quick drag pans
        P(f"__app.S.sel = '{Lk['id']}'; __app.S.selKeys.clear(); __app.project.layers[{ki}].keys.scale.forEach(k => __app.S.selKeys.add(k.id)); __app.refreshAll()"); pg.wait_for_timeout(100)
        kon = P(FIND, ['.kf.on', Lk['id']])
        gesture([(kon['x'], kon['y'], kon['x'] - 50, kon['y'])], steps=8); pg.wait_for_timeout(400); settle()
        check('quick drag on a selected keyframe pans, does not move it', layer(ki) == Lk and P(STATE)['sl'] > 20, (layer(ki)['keys'], P(STATE)['sl']))
        reset_scroll(); P("__app.S.sel = null; __app.S.selKeys.clear(); __app.refreshAll()"); pg.wait_for_timeout(100)
        kst = P(TOROW, Lk['id']); pg.wait_for_timeout(50)
        kpt = P(FIND, ['.kf', Lk['id']])
        touch('touchStart', [(kpt['x'], kpt['y'])]); pg.wait_for_timeout(420)
        kgrab = P("!!document.querySelector('.kf.grabbed')")
        for i in range(1, 11): touch('touchMove', [(kpt['x'] - 8 * i, kpt['y'])]); pg.wait_for_timeout(16)  # leftwards: t=0 sits mid-screen, keep clear of the right auto-scroll edge
        touch('touchEnd', []); pg.wait_for_timeout(200)
        Lk3 = layer(ki); s7b = P(STATE)
        moved = [p for p in Lk['keys'] if Lk['keys'][p] != Lk3['keys'][p]]
        check('long press on keyframe grabs it (feedback)', kgrab)
        check('long press + drag moves the keyframe', len(moved) >= 1 and s7b['sl'] == 0 and s7b['st'] == kst, (Lk['keys'], Lk3['keys'], s7b['sl']))

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

        # 9. the ruler pans like the tracks; the fixed centre playhead scrubs (t = scrollLeft / pps)
        reset_scroll()
        rb = pg.locator('[data-testid=ruler]').bounding_box(); tx = pg.locator('#tlScroll').bounding_box()['x']
        gesture([(tx + 300, rb['y'] + 20, tx + 100, rb['y'] + 20)], steps=10, dt=30); pg.wait_for_timeout(150)
        settle(); s9 = P(STATE)
        check('ruler swipe pans the timeline and scrubs under the centre playhead', s9['sl'] > 150 and abs(s9['t'] - min(s9['sl'] / s9['pps'], P('__app.project.duration'))) < 0.02, (s9['t'], s9['sl']))
        tc = P("(() => { const p = document.getElementById('playhead').getBoundingClientRect(), t = document.getElementById('tlScroll').getBoundingClientRect(); return Math.abs(p.left - (t.left + t.width / 2)); })()")
        check('playhead fixed at the centre of the timeline', tc <= 2, tc)

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
        for sel in ['#transport', '#top']:
            bb = pg.locator(sel).bounding_box(); x, y = bb['x'] + bb['width'] * 0.55, bb['y'] + bb['height'] / 2
            gesture([(x, y, x - 60, y - 200)], steps=10)
        pg.wait_for_timeout(300); s11 = P(STATE)
        check('page scroll position stays 0 after swipes on app chrome', s11['wy'] == 0 and s11['wx'] == 0 and s11['de'] == 0 and s11['bt'] == 0 and s11['app'] == 0, s11)
        pg.screenshot(path=f'{SHOTS}/iphone-11-gestures.png')

        # ---------- virtual timeline (pan past the end, empty space, rubber band, auto-scroll, END marker) ----------
        P("__app.S.sel = null; __app.S.selKeys.clear(); __app.S.autoFit = false; __app.S.pps = 100; __app.refreshAll()"); pg.wait_for_timeout(150); reset_scroll()
        tlb = pg.locator('#tlScroll').bounding_box(); R = tlb['x'] + tlb['width']; OX = P("Math.round(document.getElementById('tlScroll').clientWidth / 2)")
        VIS = """() => { const tl = document.getElementById('tlScroll'), S = __app.S, o = Math.round(tl.clientWidth / 2);
          return { l: (tl.scrollLeft - o) / S.pps, r: (tl.scrollLeft + tl.clientWidth - o) / S.pps, dur: __app.project.duration, sw: tl.scrollWidth }; }"""
        v0 = P(VIS)
        check('extent covers project end + >= 1 screen at rest', P("document.getElementById('tlInner').offsetWidth") >= OX + (v0['dur'] + 2) * 100, P("document.getElementById('tlInner').offsetWidth"))
        # empty track point (not on a clip/key) in the given layer row
        EMPTY = """([id, xmin]) => { const row = document.querySelector(`.tl-row[data-layer="${id}"] .tl-track`); const r = row.getBoundingClientRect(), y = r.top + r.height / 2;
          const tl = document.getElementById('tlScroll').getBoundingClientRect();
          for (const yy of [y, r.top + 2, r.bottom - 2]) for (let x = Math.max(xmin, tl.left + 100); x < tl.right - 70; x += 4) { const h = document.elementFromPoint(x, yy); if (h === row) return { x, y: yy }; }
          // 32px rows: a selected clip fills its row, so fall back to the row's own empty space left of t = 0 (beside the pill)
          for (let x = Math.max(xmin, tl.left + 80); x < tl.right - 70; x += 4) { const h = document.elementFromPoint(x, y); if (h === row.parentElement) return { x, y }; } return null; }"""
        rows = P("__app.project.layers.map(l => l.id)")
        ept = P(EMPTY, [rows[0], 0])
        for _ in range(7):
            gesture([(R - 70, ept['y'], tlb['x'] + 110, ept['y'])], steps=14, dt=24); pg.wait_for_timeout(120); settle()
        v1 = P(VIS)
        check('panning past the project end works (whole view beyond the end)', v1['l'] > v1['dur'] and v1['r'] > v1['dur'] + 3, v1)
        check('extent grows dynamically while panning', v1['sw'] > v0['sw'], (v0['sw'], v1['sw']))
        pg.screenshot(path=f'{SHOTS}/iphone-12-past-end.png')
        check('past-end region shaded with END marker', P("(() => { const a = document.getElementById('tlPast').getBoundingClientRect(); return a.width > 200 && getComputedStyle(document.getElementById('tlPast')).borderLeftStyle === 'solid' && !!document.querySelector('[data-testid=end-marker]'); })()"))
        check('ruler ticks continue past the end', P("[...document.querySelectorAll('.tl-ruler i.maj')].some(i => parseInt(i.textContent) > __app.project.duration + 3)"))
        # swipe starting in the shaded past-end area pans both ways (nothing selected)
        P(f"document.getElementById('tlScroll').scrollLeft = {304 + OX}"); pg.wait_for_timeout(60)
        endx = P("document.getElementById('tlPast').getBoundingClientRect().left")
        ppt = P(EMPTY, [rows[1], endx + 20])
        sA = P(STATE); gesture([(ppt['x'], ppt['y'], ppt['x'] - 120, ppt['y'])], steps=10, dt=20); pg.wait_for_timeout(100); settle(); sB = P(STATE)
        check('swipe starting past the project end pans horizontally', sB['sl'] > sA['sl'] + 80, (sA['sl'], sB['sl'], ppt, endx))
        gesture([(ppt['x'], ppt['y'], ppt['x'], ppt['y'] - 100)], steps=10, dt=20); pg.wait_for_timeout(100); settle()
        check('swipe starting past the project end pans vertically', P(STATE)['st'] > 30, P(STATE)['st'])
        # empty space below the last track
        P("(() => { const t = document.getElementById('tlScroll'); t.scrollTop = t.scrollHeight; t.scrollLeft = 0; })()"); pg.wait_for_timeout(60)
        pad = P("(() => { const r = document.querySelector('[data-testid=tl-pad] .tl-track').getBoundingClientRect(), tl = document.getElementById('tlScroll').getBoundingClientRect(); return { x: tl.left + 260, y: Math.min(r.bottom, tl.bottom) - 12, top: r.top }; })()")
        sA = P(STATE); gesture([(pad['x'], pad['y'], pad['x'] - 150, pad['y'])], steps=10, dt=20); pg.wait_for_timeout(100); settle(); sB = P(STATE)
        check('swipe from empty space below the tracks pans horizontally', sB['sl'] > 100, (sA, sB, pad))
        gesture([(pad['x'], pad['y'], pad['x'], pad['y'] + 120)], steps=10, dt=20); pg.wait_for_timeout(100); settle()
        check('swipe from empty space below the tracks pans vertically', P(STATE)['st'] < sB['st'] - 40, (sB['st'], P(STATE)['st']))
        # rubber band left of 0
        reset_scroll(); ept = P(EMPTY, [rows[0], 0])
        gesture([(ept['x'], ept['y'], ept['x'] + 150, ept['y'])], steps=10, dt=20, end=False)
        rb = P("parseFloat(document.getElementById('tlInner').style.getPropertyValue('--rb'))")
        touch('touchEnd', []); pg.wait_for_timeout(600)
        rb2 = P("parseFloat(document.getElementById('tlInner').style.getPropertyValue('--rb'))")
        check('pan left of 0 rubber-bands and springs back to 0', rb > 20 and rb2 == 0 and P(STATE)['sl'] == 0, (rb, rb2))

        # selection locks panning to horizontal; tap empty space deselects and restores vertical
        reset_scroll(); P(f"__app.S.sel = '{L0['id']}'; __app.refreshAll()"); pg.wait_for_timeout(100)
        reset_scroll(); st0 = P(STATE)['st']
        Lb = layer(ki); cpt = P(FIND, ['.clip.sel', None])
        gesture([(cpt['x'], cpt['y'], cpt['x'] + 3, cpt['y'] - 120)], steps=10, dt=20); pg.wait_for_timeout(300); settle()
        check('selected: vertical swipe does not scroll vertically', P(STATE)['st'] == st0 and layer(ki) == Lb, (st0, P(STATE)))
        ept = P(EMPTY, [L0['id'], 0])
        gesture([(ept['x'] + 120, ept['y'], ept['x'] - 20, ept['y'] - 60)], steps=10, dt=20); pg.wait_for_timeout(300); settle(); sS = P(STATE)
        check('selected: diagonal/horizontal swipe pans horizontally only', sS['sl'] > 80 and sS['st'] == st0 and sS['sel'] == L0['id'], sS)
        reset_scroll(); cpt = P(FIND, ['.clip.sel', None])
        touch('touchStart', [(cpt['x'], cpt['y'])]); pg.wait_for_timeout(420)
        for i in range(1, 11): touch('touchMove', [(cpt['x'] + 6 * i, cpt['y'] + 4 * i)]); pg.wait_for_timeout(16)
        touch('touchEnd', []); pg.wait_for_timeout(200); La = layer(ki)
        check('selected: long press + drag moves the clip in time only', abs((La['start'] - Lb['start']) - 0.6) < 0.06 and P(STATE)['st'] == st0 and P(STATE)['sl'] == 0, (Lb['start'], La['start']))
        ept = P(EMPTY, [L0['id'], 0]); tap(ept['x'], ept['y'])
        check('tap on empty track space deselects', P('__app.S.sel') is None, P('__app.S.sel'))
        gesture([(ept['x'], ept['y'], ept['x'] + 3, ept['y'] - 120)], steps=10, dt=20); pg.wait_for_timeout(300); settle()
        check('after deselect, vertical panning works again', P(STATE)['st'] > 30, P(STATE)['st'])

        # long press + drag a clip into the right edge -> auto-scroll; end goes past the duration
        snap = P(f"JSON.stringify(__app.project.layers[{ki}])")
        reset_scroll(); Lb = layer(ki); cpt = P(FIND, ['.clip', L0['id']]); dur = P('__app.project.duration')
        touch('touchStart', [(cpt['x'], cpt['y'])]); pg.wait_for_timeout(420)
        for i in range(1, 13): touch('touchMove', [(cpt['x'] + (R - 10 - cpt['x']) * i / 12, cpt['y'])]); pg.wait_for_timeout(16)
        pg.wait_for_timeout(900); sAS = P(STATE); Lm = layer(ki)
        touch('touchEnd', []); pg.wait_for_timeout(200); La = layer(ki)
        check('dragging a clip at the right edge auto-scrolls the timeline', sAS['sl'] > 300, sAS['sl'])
        check('clip follows the auto-scroll past the project end (not clamped)', La['end'] > dur + 1 and La['start'] > Lb['start'] + 2, (dur, La['start'], La['end']))
        # and back to the left edge: auto-scrolls left, start stops at 0
        settle(); P(f"document.getElementById('tlScroll').scrollLeft = {OX} + __app.project.layers[{ki}].start * __app.S.pps - 180"); pg.wait_for_timeout(80); sAS = P(STATE)
        cpt2 = P(FIND, ['.clip', L0['id']])
        if cpt2:
            touch('touchStart', [(cpt2['x'], cpt2['y'])]); pg.wait_for_timeout(420)
            g2 = P("!!document.querySelector('.clip.grabbed')")
            for i in range(1, 13): touch('touchMove', [(cpt2['x'] + (tlb['x'] + 90 - cpt2['x']) * i / 12, cpt2['y'])]); pg.wait_for_timeout(16)
            for _ in range(60):
                if P(STATE)['sl'] == 0: break
                pg.wait_for_timeout(100)
            pg.wait_for_timeout(200); touch('touchEnd', []); pg.wait_for_timeout(200)
        check('dragging to the left edge auto-scrolls back; start clamps at 0', cpt2 and layer(ki)['start'] == 0 and P(STATE)['sl'] < sAS['sl'] - 200, (layer(ki)['start'], P(STATE)['sl'], cpt2, cpt2 and g2))
        P(f"(s => {{ __app.project.layers[{ki}] = JSON.parse(s); __app.S.sel = null; __app.S.selKeys.clear(); __app.commit(); }})", snap); pg.wait_for_timeout(150)

        # keyframe long press + drag beyond the current view (auto-scroll)
        reset_scroll(); Lk = layer(ki); P(TOROW, Lk['id']); pg.wait_for_timeout(50); kpt = P(FIND, ['.kf', Lk['id']])
        touch('touchStart', [(kpt['x'], kpt['y'])]); pg.wait_for_timeout(420)
        for i in range(1, 13): touch('touchMove', [(kpt['x'] + (R - 10 - kpt['x']) * i / 12, kpt['y'])]); pg.wait_for_timeout(16)
        pg.wait_for_timeout(700); touch('touchEnd', []); pg.wait_for_timeout(200)
        Lk2 = layer(ki); kmax = max(max(v) for v in Lk2['keys'].values())
        check('keyframe dragged past the visible area with auto-scroll', kmax > (R - tlb['x'] - OX) / 100 + 1 and P(STATE)['sl'] > 200, (Lk['keys'], Lk2['keys'], P(STATE)['sl']))
        P("__app.S.sel = null; __app.S.selKeys.clear(); __app.refreshAll()")

        # END marker on the ruler drags the duration
        P(f"document.getElementById('tlScroll').scrollLeft = {304 + OX}"); pg.wait_for_timeout(60); dur0 = P('__app.project.duration')
        eb = P("(() => { const r = document.querySelector('[data-testid=end-marker]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()")
        gesture([(eb['x'], eb['y'], eb['x'] + 60, eb['y'])], steps=10); pg.wait_for_timeout(200)
        check('dragging the END marker changes the duration', abs(P('__app.project.duration') - (dur0 + 0.6)) < 0.05, (dur0, P('__app.project.duration')))
        P(f"__app.project.duration = {dur0}; __app.commit()"); pg.wait_for_timeout(100)
        P("__app.seek(1000)"); check('playhead/playback stays within the duration', P('__app.S.t') == dur0, P('__app.S.t'))

        # trim the selected clip's end past the duration (direct drag on the handle + auto-scroll), then save & reload
        reset_scroll(); P(f"__app.S.sel = '{L0['id']}'; __app.refreshAll()"); pg.wait_for_timeout(100)
        P("(() => { const t = document.getElementById('tlScroll'); const c = document.querySelector('.clip.sel').getBoundingClientRect(); t.scrollLeft += c.right - t.getBoundingClientRect().left - 250; })()"); pg.wait_for_timeout(60); slT = P(STATE)['sl']
        tr = P("(() => { const r = document.querySelector('.clip.sel').getBoundingClientRect(); return { x: r.right - 6, y: r.top + r.height / 2 }; })()")
        gesture([(tr['x'], tr['y'], R - 8, tr['y'])], steps=10, end=False); pg.wait_for_timeout(700); touch('touchEnd', []); pg.wait_for_timeout(200)
        Lt = layer(ki)
        check('trimming the end past the duration works (with auto-scroll)', Lt['end'] > dur0 + 1 and P(STATE)['sl'] > slT + 100, (dur0, Lt['end']))
        pg.wait_for_timeout(700); pg.reload(); pg.wait_for_function('window.__app && __app.project'); pg.wait_for_timeout(500)
        pg.click('[data-testid=home-open] >> nth=0'); pg.wait_for_timeout(200)
        Lr = P(f"(() => {{ const L = __app.project.layers.find(l => l.id === '{L0['id']}'); return L && {{ start: L.start, end: L.end }}; }})()")
        check('clip end beyond the duration persists after save/reload', Lr and abs(Lr['end'] - Lt['end']) < 1e-6 and Lr['end'] > P('__app.project.duration'), (Lt['end'], Lr, P('__app.project.duration')))
        # tap on empty space deselects -- only a short tap with little movement (real touch input)
        P("__app.renderer.render = () => {}")
        P("(() => { const a = __app, p = a.demoProject('9:16'); p.layers = []; a.setProject(p); a.addLayer(a.makeLayer(a.project, 'shape', { kind: 'rect' })); a.seek(1); })()"); pg.wait_for_timeout(200)
        lid = P('__app.S.sel'); sb = P("(() => { const r = document.getElementById('stage').getBoundingClientRect(), w = document.getElementById('stageWrap').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, wx: w.left, wy: w.top, ww: w.width, wh: w.height }; })()")
        ex, ey = sb['x'] + sb['w'] * 0.88, sb['y'] + sb['h'] * 0.88
        reselect = lambda: (P(f"__app.selectLayer('{lid}')"), pg.wait_for_timeout(120))
        gesture([(ex, ey, ex - 60, ey - 50)], steps=10, dt=16); pg.wait_for_timeout(150); a1 = P('__app.S.sel')
        touch('touchStart', [(ex, ey)]); pg.wait_for_timeout(700); touch('touchEnd', []); pg.wait_for_timeout(150); a2 = P('__app.S.sel')
        sc0 = P('__app.project.layers[0].props.scale')
        gesture([(ex - 40, ey - 40, ex - 70, ey - 70), (ex, ey, ex + 20, ey + 20)], steps=10, dt=16); pg.wait_for_timeout(150); a3 = P('__app.S.sel'); sc1 = P('__app.project.layers[0].props.scale')
        vz1 = P('[__app.S.vz.k, document.getElementById("zoomHud").classList.contains("show"), document.querySelector("#zoomHud b").textContent]')
        check('canvas: swipe, long press and pinch on empty canvas keep the selection', a1 == lid and a2 == lid and a3 == lid, (a1, a2, a3))
        check('canvas: a pinch away from the selected layer zooms the preview (layer untouched) and shows the % HUD', vz1[0] > 1.3 and sc1 == sc0 and vz1[1] and vz1[2] == f'{round(vz1[0] * 100)}%', (vz1, sc0, sc1))
        # one-finger drag on empty canvas while zoomed pans the view (and keeps the selection)
        st0 = P('[__app.S.vz.x, __app.S.vz.y]'); bx = P("(() => { const r = document.getElementById('stageWrap').getBoundingClientRect(); return [r.left + 30, r.bottom - 30]; })()")
        gesture([(bx[0], bx[1], bx[0] + 60, bx[1] - 40)], steps=10, dt=16); pg.wait_for_timeout(120); st1 = P('[__app.S.vz.x, __app.S.vz.y]')
        check('canvas: one-finger drag pans the zoomed preview', abs(st1[0] - st0[0] - 60) < 2 and abs(st1[1] - st0[1] + 40) < 2 and P('__app.S.sel') == lid, (st0, st1))
        P('__app.resetZoom()'); pg.wait_for_timeout(100)
        # pinch with a finger on the selected layer still scales the layer (no view zoom)
        sb2 = P("(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
        gesture([(sb2[0], sb2[1], sb2[0] - 10, sb2[1] - 10), (sb2[0] + 60, sb2[1] + 60, sb2[0] + 110, sb2[1] + 110)], steps=10, dt=16); pg.wait_for_timeout(150)
        check('canvas: a pinch on the selected layer scales the layer, not the view', P('__app.project.layers[0].props.scale') != sc0 and P('__app.S.vz.k') == 1, (sc0, P('__app.project.layers[0].props.scale'), P('__app.S.vz.k')))
        P("__app.project.layers[0].props.scale = " + str(sc0) + "; __app.commit()"); pg.wait_for_timeout(80)
        # nothing selected: a pinch anywhere on the preview zooms the view
        P('__app.deselect()'); pg.wait_for_timeout(80)
        gesture([(sb2[0], sb2[1], sb2[0] - 30, sb2[1] - 30), (sb2[0] + 40, sb2[1] + 40, sb2[0] + 90, sb2[1] + 90)], steps=10, dt=16); pg.wait_for_timeout(150)
        check('canvas: with nothing selected a pinch over a layer zooms the view', P('__app.S.vz.k') > 1.3 and P('__app.S.sel') is None, P('__app.S.vz.k'))
        pg.click('[data-testid=zoom-fit]'); pg.wait_for_timeout(100); reselect()
        tap(ex, ey); check('canvas: a short tap on empty canvas deselects', P('__app.S.sel') is None and P("document.body.dataset.mode") == 'none')
        reselect(); cx, cy = sb['x'] + sb['w'] / 2, sb['y'] + sb['h'] / 2
        tap(cx, cy); check('canvas: tapping the layer keeps it selected', P('__app.S.sel') == lid)
        ox_ = sb['x'] - 14 if sb['x'] - sb['wx'] > 20 else sb['wx'] + sb['ww'] / 2
        oy_ = sb['wy'] + sb['wh'] / 2 if sb['x'] - sb['wx'] > 20 else sb['y'] + sb['h'] + 6
        gesture([(ox_, oy_, ox_ - 10, oy_ + 60)], steps=8); pg.wait_for_timeout(150); a4 = P('__app.S.sel')
        tap(ox_, oy_); a5 = P('__app.S.sel')
        check('dark surround: swipe keeps the selection, a short tap deselects', a4 == lid and a5 is None, (a4, a5, ox_, oy_))
        reselect(); reset_scroll()
        # with a selection the panel covers all but one row, so the empty space is beside the row (left of t = 0)
        pad = P(f"(() => {{ const r = document.querySelector('.tl-row[data-layer=\"{lid}\"]').getBoundingClientRect(), t = document.getElementById('tlScroll').getBoundingClientRect(); return {{ x: t.left + 110, y: r.top + r.height / 2 }}; }})()")
        check('timeline: the spot beside the row is empty track space', P(f"document.elementFromPoint({pad['x']}, {pad['y']}).className").split()[0] in ('tl-track', 'tl-row'), P(f"document.elementFromPoint({pad['x']}, {pad['y']}).className"))
        gesture([(pad['x'], pad['y'], pad['x'] + 120, pad['y'])], steps=10, dt=20); pg.wait_for_timeout(300); settle(); b1 = P('__app.S.sel')
        touch('touchStart', [(pad['x'], pad['y'])]); pg.wait_for_timeout(700); touch('touchEnd', []); pg.wait_for_timeout(150); b2 = P('__app.S.sel')
        reset_scroll()
        ru = P("(() => { const r = document.querySelector('[data-testid=ruler]').getBoundingClientRect(), t = document.getElementById('tlScroll').getBoundingClientRect(); return { x: Math.min(r.right, t.right) - 50, y: r.top + 8 }; })()"); tap(ru['x'], ru['y']); b3 = P('__app.S.sel')
        reset_scroll()
        tap(pad['x'], pad['y']); b4 = P('__app.S.sel')
        check('timeline: pan / long press on empty space and taps on the ruler keep the selection; a short tap deselects', b1 == lid and b2 == lid and b3 == lid and b4 is None, (b1, b2, b3, b4))
        # ---- Alight row geometry (reference/15 at 3x): 32px pitch, 29px pill (3px gap), 26px clip (6px gap), ☰ handle pinned right ----
        P("""(() => { const a = __app, p = a.demoProject('9:16'); a.setProject(p); for (let i = 0; i < 4; i++) a.addLayer(a.makeLayer(a.project, 'shape', { kind: 'rect' }));
          a.S.sel = null; a.S.multi.clear(); a.S.tab = null; a.S.autoFit = false; a.S.pps = 60; a.seek(0.5); a.refreshAll(); })()"""); pg.wait_for_timeout(250); reset_scroll()
        geo = P("""(() => { const rows = [...document.querySelectorAll('.tl-row[data-layer]')], R = e => e.getBoundingClientRect();
          const a = rows[0], b = rows[1], pa = R(a.querySelector('.tl-label')), pb = R(b.querySelector('.tl-label')), ca = R(a.querySelector('.clip')), cb = R(b.querySelector('.clip'));
          const tl = R(document.getElementById('tlScroll')), hd = R(a.querySelector('.tl-hd')), cs = getComputedStyle(a.querySelector('.clip')), ps = getComputedStyle(a.querySelector('.tl-label'));
          return { pitch: R(b).top - R(a).top, pillH: pa.height, pillGap: pb.top - pa.bottom, clipH: ca.height, clipGap: cb.top - ca.bottom, pillW: pa.width,
            pillR: ps.borderTopRightRadius, pillBg: ps.backgroundColor, clipBg: cs.backgroundColor, clipImg: cs.backgroundImage.slice(0, 26), hdRight: tl.right - hd.right, hdW: hd.width,
            pillCentre: (pa.top + pa.bottom) / 2 - (ca.top + ca.bottom) / 2, thumb: !!a.querySelector('.tl-label img.th'), name: a.querySelector('.clip .cn').textContent }; })()""")
        check('rows: 32px pitch, 29px pill + 3px gap, 26px clip + 6px gap, pill centred on clip', geo['pitch'] == 32 and abs(geo['pillH'] - 29) < .01 and abs(geo['pillGap'] - 3) < .01 and geo['clipH'] == 26 and geo['clipGap'] == 6 and abs(geo['pillCentre']) < .6, geo)
        check('pill: dark slate, rounded right edge, eye + shape thumbnail', geo['pillBg'] == 'rgb(38, 40, 53)' and geo['pillR'] == '14.5px' and geo['thumb'] and 66 <= geo['pillW'] <= 72, geo)
        check('clip: sampled teal with subtle vertical stripes, layer name inside', geo['clipBg'] == 'rgb(101, 171, 205)' and geo['clipImg'].startswith('repeating-linear-gradient') and geo['name'], geo)
        check('☰ handle pinned at the right edge of the view', 0 <= geo['hdRight'] <= 8 and geo['hdW'] >= 28, geo)
        sl0 = P(STATE)['sl']; P("document.getElementById('tlScroll').scrollLeft += 300"); pg.wait_for_timeout(80)
        hd2 = P("(() => { const t = document.getElementById('tlScroll').getBoundingClientRect(), h = document.querySelector('.tl-row[data-layer] .tl-hd').getBoundingClientRect(); return t.right - h.right; })()")
        check('☰ handle stays pinned while the timeline pans', abs(hd2 - geo['hdRight']) < 1, (geo['hdRight'], hd2))
        reset_scroll()
        # thumbnails show the layer's own shape/colour: centre pixel of a rect pill thumbnail matches its fill
        thc = P("""new Promise(res => { const L = __app.project.layers.find(l => l.type === 'shape' && l.shape.kind === 'rect'); const img = document.querySelector(`.tl-row[data-layer="${L.id}"] img.th`);
          const go = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
            const d = g.getImageData(c.width / 2, c.height / 2, 1, 1).data, corner = g.getImageData(1, 1, 1, 1).data; res({ fill: L.shape.fill, px: [d[0], d[1], d[2]], cornerA: corner[3] }); };
          img.complete ? go() : (img.onload = go); })""")
        hx = thc['fill'].lstrip('#'); want = [int(hx[i:i + 2], 16) for i in (0, 2, 4)]
        check('pill thumbnail is the actual shape in its colour on a transparent tile', all(abs(a - b) < 12 for a, b in zip(thc['px'], want)) and thc['cornerA'] == 0, (thc, want))
        # ☰ handle: vertical drag reorders right away (no long press); a horizontal swipe on it still pans
        ids0 = P("__app.project.layers.map(l => l.id)")
        hp = P(f"(() => {{ const h = document.querySelector('.tl-row[data-layer=\"{ids0[0]}\"] .tl-hd').getBoundingClientRect(); return {{ x: h.left + h.width / 2, y: h.top + h.height / 2 }}; }})()")
        gesture([(hp['x'], hp['y'], hp['x'], hp['y'] + 2 * 32 + 4)], steps=12, dt=20); pg.wait_for_timeout(300)
        ids1 = P("__app.project.layers.map(l => l.id)")
        check('☰ drag down two rows moves the layer two places down the stack', ids1[2] == ids0[0] and ids1[0] == ids0[1] and ids1[1] == ids0[2] and sorted(ids1) == sorted(ids0), (ids0[:4], ids1[:4]))
        P("__app.project.layers.unshift(__app.project.layers.splice(2, 1)[0]); __app.commit()"); pg.wait_for_timeout(150); reset_scroll()
        sA = P(STATE); gesture([(hp['x'], hp['y'], hp['x'] - 140, hp['y'] + 3)], steps=10, dt=20); pg.wait_for_timeout(200); settle(); sB = P(STATE)
        check('horizontal swipe starting on ☰ pans and does not reorder', sB['sl'] > sA['sl'] + 80 and P("__app.project.layers.map(l => l.id)") == ids0, (sA['sl'], sB['sl']))
        # Select All Layers (⧉ menu) outlines every clip; a tap on empty timeline space clears it
        reset_scroll(); pg.click('[data-testid=copy-layer]'); pg.wait_for_timeout(150); pg.click('[data-testid=cm-select-all]'); pg.wait_for_timeout(200)
        ms = P("[__app.S.multi.size, __app.project.layers.length, document.querySelectorAll('.clip.msel').length]")
        check('Select All Layers selects every layer (all clips outlined)', ms[0] == ms[1] and ms[2] == ms[1], ms)
        P("document.getElementById('tlScroll').scrollTop = 1e6"); pg.wait_for_timeout(60)
        pad = P("(() => { const r = document.querySelector('[data-testid=tl-pad] .tl-track').getBoundingClientRect(), tl = document.getElementById('tlScroll').getBoundingClientRect(); return { x: tl.left + 260, y: Math.min(r.bottom, tl.bottom) - 12 }; })()")
        tap(pad['x'], pad['y'])
        check('tap on empty timeline space clears the multi-selection', P('__app.S.multi.size') == 0)
        check('no page errors', not [e for e in errs if 'GL Driver' not in e], errs[:5])
        b.close()

main()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
