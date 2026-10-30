"""Effects tests (iPhone 15 Pro Max emulation): Add Effect browser, live search, preset sheet, effect cards + ⋯ menu,
keyframed effect parameters, the Keyframes Required popup, the Easing Curve panel (presets, physics, yellow dot), shape
morph easing, a visual sanity check of every effect (non-blank, differs from the input) and preview/export parity.
Saves UI shots to /workspace/kntc-shots/effects/."""
import os, sys
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8765/')
SHOTS = '/workspace/kntc-shots/effects'
os.makedirs(SHOTS, exist_ok=True)
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail)[:600] if detail and not cond else ''), flush=True)

CATS = ['Color & Light', 'Drawing & Edge', 'Blur', 'Distortion/Warp', 'Procedural', '3D', 'Move/Transform', 'Repeat', 'Matte/Mask/Key', 'Opacity/Visibility', 'Text', 'Other']
COUNTS = {'color': 29, 'draw': 17, 'blur': 18, 'distort': 27, 'proc': 23, '3d': 19, 'move': 12, 'repeat': 7, 'matte': 11, 'opacity': 7, 'text': 6, 'other': 7}

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(**pw.devices['iPhone 15 Pro Max'], service_workers='block')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    P = lambda js, *a: pg.evaluate(js, *a)
    pg.goto(BASE + '?editor'); pg.wait_for_function('window.__app && __app.project')
    P("localStorage.clear()")
    # a clean project: gradient backdrop + a purple rounded square
    P("""() => { const a = __app, p = a.demoProject('9:16'); p.layers = p.layers.filter(l => l.name === 'Backdrop'); a.setProject(p);
      const L = a.makeLayer(a.project, 'shape', { kind: 'rect' }); L.shape.w = L.shape.h = 420; L.shape.radius = 60; L.shape.fill = '#7b4dff'; L.name = 'Square'; a.addLayer(L); a.seek(0); }""")
    pg.wait_for_timeout(200)
    SIG = """() => { const c = document.querySelector('#view'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 41) h = (h * 31 + d[i]) >>> 0; return h; }"""
    L = "__app.project.layers.find(l => l.id === __app.S.sel)"

    # ---- Effects panel: empty list with + Add Effect ----
    P("__app.openSub('fx')"); pg.wait_for_timeout(150)
    check('Effects panel title + empty list with "+ Add Effect"', P("document.querySelector('#title, .title, header b')?.textContent || ''") is not None and pg.locator('[data-testid=add-effect]').inner_text().strip() == '+ Add Effect' and pg.locator('.fxc').count() == 0)
    # ---- browser ----
    pg.click('[data-testid=add-effect]'); pg.wait_for_selector('[data-testid=fx-browser]'); pg.wait_for_timeout(600)
    home = P("""() => ({ title: document.querySelector('.fxb-h b').textContent, big: [...document.querySelectorAll('.fxb-big span')].map(e => e.textContent),
      small: [...document.querySelectorAll('.fxb-sm span')].map(e => e.textContent), cats: [...document.querySelectorAll('.fxb-cat span')].map(e => e.textContent),
      close: !!document.querySelector('[data-testid=fxb-close]'), search: !!document.querySelector('[data-testid=fxb-search]') })""")
    check('Add Effect: X, title, search, carousel (Tiles, Chroma Key, Exposure / Gamma…) + small row (Auto-Shake, Contour Strips, Oscillate)', home['title'] == 'Add Effect' and home['close'] and home['search']
          and home['big'][:3] == ['Tiles', 'Chroma Key', 'Exposure / Gamma'] and home['small'] == ['Auto-Shake', 'Contour Strips', 'Oscillate'], home)
    check('Add Effect: 12 category buttons with the exact names', home['cats'] == CATS, home['cats'])
    pg.screenshot(path=f'{SHOTS}/ui-01-add-effect.png')
    counts = {}
    for cid in COUNTS:
        pg.click(f'[data-testid=cat-{cid}]'); pg.wait_for_timeout(60)
        counts[cid] = pg.locator('.fxb-grid .fxb-it').count()
        if cid == 'blur': pg.wait_for_timeout(400); pg.screenshot(path=f'{SHOTS}/ui-02-category-blur.png')
        if cid == '3d': pg.wait_for_timeout(400); pg.screenshot(path=f'{SHOTS}/ui-03-category-3d.png')
        pg.click('[data-testid=fxb-back]'); pg.wait_for_timeout(40)
    check('category pages list 29/17/18/27/23/19/12/7/11/7/6/7 effects (183, Parenting Helper left out)', counts == COUNTS, counts)
    pg.click('[data-testid=cat-blur]'); pg.click('[data-testid=cat-next]'); pg.wait_for_timeout(60)
    nxt = P("document.querySelector('.fxb-h b').textContent"); pg.click('[data-testid=cat-prev]'); pg.click('[data-testid=cat-prev]'); prv = P("document.querySelector('.fxb-h b').textContent")
    check('category < > arrows page through categories', nxt == 'Distortion/Warp' and prv == 'Drawing & Edge', (nxt, prv))
    pg.click('[data-testid=fxb-back]')
    # ---- search ----
    pg.click('[data-testid=fxb-search]'); pg.wait_for_timeout(100)
    tags = P("[...document.querySelectorAll('.fxb-tag')].map(e => e.textContent)")
    check('search page: "Type Here to Search" + tag chips Auto, Camera, Layer Parenting, Property Adjust, Transform', P("document.querySelector('[data-testid=fx-search-input]').placeholder") == 'Type Here to Search' and tags == ['Auto', 'Camera', 'Layer Parenting', 'Property Adjust', 'Transform'], tags)
    pg.screenshot(path=f'{SHOTS}/ui-04-search-empty.png')
    pg.type('[data-testid=fx-search-input]', 'sha', delay=40); pg.wait_for_timeout(150)
    res = P("""() => [...document.querySelectorAll('.fxb-res')].map(r => ({ id: r.dataset.testid, name: r.querySelector('b').textContent, mark: r.querySelector('mark')?.textContent, desc: r.querySelector('small').textContent }))""")
    asr = next((r for r in res if r['id'] == 'res-autoshake'), None)
    check("live search 'sha' finds Auto-Shake with its description, match highlighted", asr and asr['desc'] == 'Moves the layer randomly over time within specified parameters.' and asr['mark'] == 'Sha', res)
    pg.screenshot(path=f'{SHOTS}/ui-05-search-sha.png')
    pg.fill('[data-testid=fx-search-input]', 'zzzq'); pg.wait_for_timeout(60)
    check('search with no match says so', 'No effects found' in pg.locator('.fxb-body').inner_text())
    pg.fill('[data-testid=fx-search-input]', ''); pg.click('[data-testid=tag-Camera]'); pg.wait_for_timeout(60)
    camera = P("[...document.querySelectorAll('.fxb-res')].map(r => r.dataset.testid)")
    check('tag chip filters (Camera includes Auto-Shake)', 'res-autoshake' in camera, camera)
    pg.fill('[data-testid=fx-search-input]', 'shake'); pg.wait_for_timeout(60)
    # ---- preset sheet ----
    pg.click('[data-testid=res-autoshake]'); pg.wait_for_selector('[data-testid=preset-sheet]'); pg.wait_for_timeout(300)
    ps = P("""() => ({ name: document.querySelector('.fxps-info b').textContent, desc: document.querySelector('.fxps-info p').textContent,
      tags: [...document.querySelectorAll('.fxps-tags i')].map(e => e.textContent), guide: document.querySelector('[data-testid=preset-guide]').textContent,
      rows: [...document.querySelectorAll('.fxps-row')].map(r => [r.querySelector('small')?.textContent || '', r.querySelector('b').textContent]) })""")
    check('preset sheet: name, description, tag chips Auto/Camera/Layer Parenting/Property Adjust, Guide', ps['name'] == 'Auto-Shake' and ps['tags'] == ['Auto', 'Camera', 'Layer Parenting', 'Property Adjust'] and ps['guide'] == 'Guide', ps)
    want = [['', 'Standard Settings'], ['PRESET: TF', 'Transition Out: Fast'], ['PRESET: NF', 'Transition In: Fast'], ['PRESET: IN', 'Transition In'], ['PRESET: OU', 'Transition Out'], ['PRESET: HO', 'Horizontal'], ['PRESET: VE', 'Vertical']]
    check('preset list: Standard Settings, TF, NF, IN, OU, HO, VE', ps['rows'][:7] == want, ps['rows'])
    pg.screenshot(path=f'{SHOTS}/ui-06-preset-sheet.png')
    pg.click('[data-testid=preset-guide]'); pg.wait_for_timeout(100)
    check('Guide shows the effect details', pg.locator('[data-testid=fxdetails]').is_visible() and 'Magnitude' in pg.locator('[data-testid=fxdetails]').inner_text())
    pg.click('[data-testid=fxdetails-ok]')
    h0 = P(SIG)
    pg.click('[data-testid=preset-std]'); pg.wait_for_timeout(250)
    card = P("""() => { const c = document.querySelector('[data-testid=fx-autoshake]'); return c && { name: c.querySelector('.fxc-h b').textContent,
      rows: [...c.querySelectorAll('.fxp')].slice(0, 4).map(r => [r.querySelector('.fxp-l').textContent, r.querySelector('.fx-num')?.value]) }; }""")
    check('picking a preset adds the effect and closes the browser', not pg.locator('[data-testid=fx-browser]').count() and P(f"{L}.effects.map(e => e.type)") == ['autoshake'])
    check('Auto-Shake card: Magnitude 50, Frequency 2.00Hz, Evolution 0.00, Seed 0.00', card and card['rows'] == [['Magnitude', '50.0'], ['Frequency', '2.00Hz'], ['Evolution', '0.00'], ['Seed', '0.00']], card)
    P("__app.seek(0.7)"); pg.wait_for_timeout(100)
    check('Auto-Shake moves the layer over time', P(SIG) != h0)
    pg.screenshot(path=f'{SHOTS}/ui-07-effect-card.png')
    # ---- card ⋯ menu ----
    pg.click('[data-testid=fx-autoshake] [data-testid=fx-more]'); pg.wait_for_timeout(100)
    items = P("[...document.querySelectorAll('[data-testid=fx-menu] .fxm-it')].map(e => e.textContent)")
    check('⋯ menu: Reset to Defaults, Duplicate, Copy Effect, Effect Details', items[:4] == ['Reset to Defaults', 'Duplicate', 'Copy Effect', 'Effect Details'], items)
    pg.screenshot(path=f'{SHOTS}/ui-08-card-menu.png')
    pg.click('[data-testid=fxm-dup]'); pg.wait_for_timeout(100)
    check('Duplicate stacks a second copy', P(f"{L}.effects.map(e => e.type)") == ['autoshake', 'autoshake'])
    P(f"{L}.effects[1].params.mag = 300; __app.commit()"); pg.wait_for_timeout(50)
    pg.locator('[data-testid=fx-more]').nth(1).click(); pg.click('[data-testid=fxm-reset]'); pg.wait_for_timeout(80)
    check('Reset to Defaults restores the parameters', P(f"{L}.effects[1].params.mag") == 50)
    pg.locator('[data-testid=fx-more]').nth(1).click(); pg.click('[data-testid=fxm-copy]'); pg.wait_for_timeout(50)
    pg.locator('[data-testid=fx-more]').nth(0).click(); pg.click('[data-testid=fxm-paste]'); pg.wait_for_timeout(80)
    check('Copy Effect / Paste Effect', P(f"{L}.effects.length") == 3)
    pg.locator('[data-testid=fx-more]').nth(0).click(); pg.click('[data-testid=fxm-details]'); pg.wait_for_timeout(80)
    check('Effect Details dialog', pg.locator('[data-testid=fxdetails]').is_visible() and 'Moves the layer randomly' in pg.locator('[data-testid=fxdetails]').inner_text())
    pg.click('[data-testid=fxdetails-ok]')
    pg.locator('[data-testid=fx-del]').nth(2).click(); pg.locator('[data-testid=fx-del]').nth(1).click(); pg.wait_for_timeout(80)
    pg.locator('[data-testid=fx-collapse]').first.click(); pg.wait_for_timeout(60)
    closed = pg.locator('[data-testid=fx-autoshake] .fxp').count()
    pg.locator('[data-testid=fx-collapse]').first.click(); pg.wait_for_timeout(60)
    check('cards collapse and expand; trash removes', P(f"{L}.effects.length") == 1 and closed == 0 and pg.locator('[data-testid=fx-autoshake] .fxp').count() == 7, closed)
    # ---- Keyframes Required ----
    P("__app.seek(0)"); pg.wait_for_timeout(60)
    pg.click('[data-testid=fxp-mag]'); pg.click('[data-testid=fx-ease]'); pg.wait_for_timeout(100)
    kr = pg.locator('[data-testid=kreq]')
    check('graph icon with < 2 keyframes shows "Keyframes Required" with OK', kr.is_visible() and 'Keyframes Required' in kr.inner_text() and 'Before adjusting animation easing you must first create at least two keyframes' in kr.inner_text())
    pg.screenshot(path=f'{SHOTS}/ui-09-keyframes-required.png')
    pg.click('[data-testid=kreq-ok]'); pg.wait_for_timeout(50)
    check('OK dismisses the popup', not pg.locator('[data-testid=kreq]').count())
    # ---- keyframe an effect parameter: ◆ at 0 s (Magnitude 0), then type 300 at 2 s -> second key ----
    pg.fill('[data-testid=fxv-mag]', '0'); pg.press('[data-testid=fxv-mag]', 'Enter'); pg.wait_for_timeout(60)
    pg.click('[data-testid=fx-key]'); pg.wait_for_timeout(60)
    P("__app.seek(2)"); pg.wait_for_timeout(120)
    pg.fill('[data-testid=fxv-mag]', '300'); pg.press('[data-testid=fxv-mag]', 'Enter'); pg.wait_for_timeout(120)
    ks = P(f"(() => {{ const l = {L}; const k = Object.keys(l.keys).find(k => k.endsWith('.mag')); return k && l.keys[k].map(q => [q.t, q.v]); }})()")
    check('effect params are keyframeable (◆ then edit at another time adds a key)', ks == [[0, 0], [2, 300]], ks)
    check('timeline shows the effect keyframes', pg.locator('.tl-row .kf').count() >= 2)
    KF = "() => [[...document.querySelectorAll('.tl-row.sel .kf')].map(e => e.classList.contains('hi') ? 'hi' : e.classList.contains('lo') ? 'lo' : ''), document.querySelector('[data-testid=fx-ease]').classList.contains('off')]"
    lit = P(KF)
    P("document.querySelector('.fxp-l:not([data-testid=fxp-mag])').click()"); pg.wait_for_timeout(100)
    unlit = P(KF)
    pg.click('[data-testid=fxp-mag]'); pg.wait_for_timeout(100)
    check('only the selected parameter lights its keyframes; easing dims for a parameter without them', lit == [['hi', 'hi'], False] and unlit == [['lo', 'lo'], True], (lit, unlit))
    # ---- Easing Curve ----
    pg.click('[data-testid=fx-ease]'); pg.wait_for_timeout(250)
    check('graph icon opens the Easing Curve panel', P("__app.S.tab") == 'ease' and 'Easing Curve' in pg.locator('body').inner_text() and pg.locator('[data-testid=bezier]').is_visible())
    lin = P("""() => { const l = %s, k = Object.keys(l.keys).find(k => k.endsWith('.mag')); return [l.keys[k][0].ease.preset]; }""" % L)
    pg.screenshot(path=f'{SHOTS}/ui-10-easing-curve.png')
    groups = P("[...document.querySelectorAll('.ez-g')].map(e => e.dataset.testid)")
    pg.click('[data-testid=eg-physics]'); pg.wait_for_timeout(80)
    phys = P("[...document.querySelectorAll('.ez-p')].map(e => e.dataset.testid)")
    check('easing groups Curve / Physics / Steps; physics presets incl. bounce, overshoot, elastic', groups == ['eg-curve', 'eg-physics', 'eg-steps'] and {'ease-bounce', 'ease-overshoot', 'ease-elastic'} <= set(phys), (groups, phys))
    pg.click('[data-testid=ease-bounce]'); pg.wait_for_timeout(120)
    ez = P("""() => { const l = %s, k = Object.keys(l.keys).find(k => k.endsWith('.mag')); return l.keys[k][0].ease; }""" % L)
    check('Bounce applied to the keyframe', ez['type'] == 'bounce' and pg.locator('[data-testid=ease-name]').inner_text() == 'Bounce', ez)
    # easing really drives the interpolation (bounce overshoots linear early)
    vals = P("""async () => { const E = await import('./js/effects.js'); const l = %s, f = l.effects[0]; return [0.3, 0.5, 1.0, 1.5].map(t => +E.evalParams(l, f, t).mag.toFixed(2)); }""" % L)
    check('effect param interpolation follows the bounce curve (not linear)', vals[0] > 45 * 1.3 and any(abs(v - lv) > 20 for v, lv in zip(vals, [45, 75, 150, 225])), vals)
    # yellow dot traces the curve while the playhead is in the segment
    P("__app.seek(0.8)"); pg.wait_for_timeout(150)
    yellow = P("""() => { const c = document.querySelector('[data-testid=bezier]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i+1] > 190 && d[i+1] < 220 && d[i+2] < 110 && d[i+3] > 200) n++; return n; }""")
    check('yellow dot drawn on the curve at the playhead', yellow > 30, yellow)
    pg.screenshot(path=f'{SHOTS}/ui-11-easing-bounce.png')
    P("__app.togglePlay(true)"); pg.wait_for_timeout(500); P("__app.togglePlay(false)")
    pg.click('[data-testid=eg-curve]'); pg.wait_for_timeout(60); pg.click('[data-testid=ease-easeIn]'); pg.wait_for_timeout(80)
    bz = pg.locator('[data-testid=bezier]').bounding_box()
    pg.mouse.move(bz['x'] + bz['width'] * 0.4, bz['y'] + bz['height'] * 0.85); pg.mouse.down(); pg.mouse.move(bz['x'] + bz['width'] * 0.2, bz['y'] + bz['height'] * 0.15, steps=6); pg.mouse.up(); pg.wait_for_timeout(100)
    ez2 = P("""() => { const l = %s, k = Object.keys(l.keys).find(k => k.endsWith('.mag')); return l.keys[k][0].ease; }""" % L)
    check('dragging a bezier handle makes a custom cubic-bezier', ez2['preset'] == 'custom' and ez2['type'] == 'bezier' and pg.locator('[data-testid=ease-name]').inner_text() == 'Cubic Bezier Easing', ez2)
    pg.screenshot(path=f'{SHOTS}/ui-12-easing-bezier.png')
    pg.click('[data-testid=panel-back]'); pg.wait_for_timeout(80)
    check('back from Easing Curve returns to Effects', P("__app.S.tab") == 'fx')
    # ---- shape morph easing: rounded square -> circle ----
    P("__app.seek(0)"); P("__app.openSub('edit')"); pg.wait_for_timeout(100)
    pg.click('[data-testid=shape-radius-key]'); pg.wait_for_timeout(50)
    P("__app.seek(2)"); pg.wait_for_timeout(80)
    pg.locator('[data-testid=shape-radius] + input, [data-testid=shape-radius] ~ input.num').first.fill('210'); pg.locator('[data-testid=shape-radius] ~ input.num').first.dispatch_event('change'); pg.wait_for_timeout(80)
    rk = P(f"{L}.keys['shape.radius']?.map(k => [k.t, k.v])")
    check('shape Corner is keyframeable (60 -> 210 = circle)', rk == [[0, 60], [2, 210]], rk)
    P(f"(() => {{ const l = {L}; l.keys['shape.radius'][0].ease = {{ preset: 'easeIn', type: 'bezier', bz: [0.9, 0, 1, 1] }}; l.effects = []; __app.commit(); }})()")
    corner = """() => { const c = document.querySelector('#view'), p = __app.project, l = %s, s = c.width / p.w; const x = (l.props.x - 186) * s, y = (l.props.y - 186) * s;
      return Array.from(c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data); }""" % L
    P("__app.seek(1)"); pg.wait_for_timeout(100); c1 = P(corner); r1 = P(f"__app.evalShape({L}, 1).radius")
    P("__app.seek(2)"); pg.wait_for_timeout(100); c2 = P(corner)
    check('easing applies to the shape morph (easeIn: radius still small at mid-time; circle at the end)', r1 < 80 and c1[2] > 200 and c2[2] < 120, (r1, c1, c2))
    pg.locator('#view').screenshot(path=f'{SHOTS}/ui-13-morph-end.png')
    # ---- every effect: renders non-blank and differs from the input ----
    sanity = P("""async () => {
      const { sampleProject } = await import('./js/fxsample.js'); const { Renderer } = await import('./js/render.js'); const { EFFECTS } = await import('./js/effects.js');
      const R = new Renderer(), cv = document.createElement('canvas'); cv.width = cv.height = 160; const g = cv.getContext('2d');
      const grab = (id, fx, t) => { const { project } = sampleProject(id, { fx, size: 540 }); R.render(project, t, cv); return g.getImageData(0, 0, 160, 160).data; };
      const out = {};
      for (const id of Object.keys(EFFECTS)) {
        let best = null;
        for (const t of [1.07, 0.15, 3.85, 0.55, 2.3, 1.6]) {   // time-based effects (blink, fades, echo…) show at some of these times
          const a = grab(id, false, t), b = grab(id, true, t); let diff = 0, m = 0, m2 = 0, n = 0;
          for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]); diff += d; const l = b[i] * .3 + b[i+1] * .59 + b[i+2] * .11; m += l; m2 += l * l; n++; }
          const r = { t, diff: +(diff / n).toFixed(3), sd: +Math.sqrt(Math.max(0, m2 / n - (m / n) ** 2)).toFixed(2), a: +(b.reduce((s, v, i) => i % 4 === 3 ? s + v : s, 0) / n).toFixed(1) };
          if (!best || r.diff > best.diff) best = r; if (r.diff > 0.15) break;
        }
        out[id] = best;
      }
      return { out, errs: [...R.errors, ...R.fx.errors] }; }""")
    UNIFORM = {'solidcolor'}  # fills the layer with one flat colour by design
    bad = {k: v for k, v in sanity['out'].items() if not (v['diff'] > 0.15 and (v['sd'] > 1.0 or k in UNIFORM or v['diff'] > 5) and v['a'] > 0)}
    check(f"all {len(sanity['out'])} effects render non-blank and differ from the input", not bad and not sanity['errs'], (bad, sanity['errs'][:3]))
    # ---- preview / export parity: the same frame at preview and export resolution matches (after downscaling) ----
    parity = P("""async () => {
      const { sampleProject } = await import('./js/fxsample.js'); const { Renderer } = await import('./js/render.js'); const { EFFECTS } = await import('./js/effects.js');
      const small = (src) => { const c = document.createElement('canvas'); c.width = c.height = 24; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, 24, 24); return x.getImageData(0, 0, 24, 24).data; };
      const prev = new Renderer(), exp = new Renderer(), a = document.createElement('canvas'), b = document.createElement('canvas'); a.width = a.height = 270; b.width = b.height = 1080;
      const out = {};
      for (const id of Object.keys(EFFECTS)) { const { project } = sampleProject(id, { size: 1080 }); prev.render(project, 1.07, a); exp.render(project, 1.07, b);
        const x = small(a), y = small(b); let d = 0; for (let i = 0; i < x.length; i += 4) d += Math.abs(x[i] - y[i]) + Math.abs(x[i+1] - y[i+1]) + Math.abs(x[i+2] - y[i+2]); out[id] = +(d / (x.length / 4) / 3).toFixed(2); }
      return out; }""")
    worst = sorted(parity.items(), key=lambda kv: -kv[1])[:8]
    off = {k: v for k, v in parity.items() if v > 12}
    check('preview (270 px) and export (1080 px) renders match for every effect (mean |Δ| per channel on a 24 px downscale ≤ 12/255)', not off, (off, worst))
    print('parity worst:', worst)
    check('no page errors', not errs, errs[:5])
    b.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
