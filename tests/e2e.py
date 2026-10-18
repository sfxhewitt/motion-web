"""End-to-end tests: desktop (1440x900) and iPhone emulation (Chromium, iPhone 15 Pro Max descriptor)."""
import json, sys, os, struct, zlib, time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('BASE', 'http://localhost:8765/')
SHOTS = '/workspace/alight-web/screenshots'
OUT = '/workspace/alight-web/test-output'
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail) if detail else ''), flush=True)

def png_bytes(w=320, h=200):
    rows = b''.join(b'\x00' + b''.join(bytes([x * 255 // w, y * 255 // h, 200]) for x in range(w)) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')

SIG = """() => { const c = document.querySelector('#view'); const x = c.getContext('2d'); const d = x.getImageData(0,0,c.width,c.height).data;
  let h = 0, nz = 0; for (let i = 0; i < d.length; i += 97) { h = (h * 31 + d[i]) >>> 0; if (d[i] > 20) nz++; } return { h, nz, w: c.width }; }"""
PIX = """([fx, fy]) => { const c = document.querySelector('#view'); const d = c.getContext('2d').getImageData(Math.floor(fx*c.width), Math.floor(fy*c.height), 1, 1).data; return Array.from(d); }"""

def run(pw, label, ctx_opts, mobile):
    b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(accept_downloads=True, **ctx_opts)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(BASE); pg.wait_for_function('window.__app && __app.project')
    pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_function('window.__app && __app.project')
    pg.wait_for_timeout(800)
    P = lambda js: pg.evaluate(js)
    tab = lambda t: pg.click(f'[data-testid=tab-{t}]') if P(f"__app.S.tab") != t else None

    # 1. demo renders
    sig0 = pg.evaluate(SIG)
    check(f'[{label}] demo project loads & renders', P('__app.project.layers.length') == 5 and sig0['nz'] > 50, sig0)
    P('__app.seek(1.6)'); pg.wait_for_timeout(200)
    pg.screenshot(path=f'{SHOTS}/{label}-01-demo.png')
    # playback advances time
    pg.click('[data-testid=play]'); pg.wait_for_timeout(900); t_play = P('__app.S.t'); pg.click('[data-testid=play]')
    check(f'[{label}] playback advances playhead', abs(t_play - 1.6) > 0.1, round(t_play, 2))

    # 2. new 1:1 project
    tab('project'); pg.click('[data-testid=new-project]'); pg.click('[data-testid="new-1:1"]'); pg.wait_for_timeout(300)
    check(f'[{label}] new project 1:1', P('[__app.project.w, __app.project.h, __app.project.layers.length]') == [1080, 1080, 0])
    # aspect switch
    tab('project'); pg.click('[data-testid="aspect-16:9"]'); pg.wait_for_timeout(150)
    check(f'[{label}] aspect preset 16:9', P('[__app.project.w, __app.project.h]') == [1920, 1080])
    pg.click('[data-testid="aspect-9:16"]'); pg.wait_for_timeout(150)

    # 3. add layers
    tab('add'); pg.click('[data-testid=add-solid]'); pg.wait_for_timeout(100)
    tab('add'); pg.click('[data-testid=add-rect]'); pg.wait_for_timeout(100)
    tab('add'); pg.click('[data-testid=add-star]'); pg.wait_for_timeout(100)
    tab('add'); pg.click('[data-testid=add-text]'); pg.wait_for_timeout(100)
    types = P('__app.project.layers.map(l => l.type)')
    check(f'[{label}] add solid/shape/shape/text layers', types == ['text', 'shape', 'shape', 'solid'], types)
    tab('style'); pg.fill('[data-testid=text-content]', 'HELLO\nRUST'); pg.locator('[data-testid=text-content]').dispatch_event('change'); pg.wait_for_timeout(100)
    check(f'[{label}] edit text content', P('__app.project.layers[0].text.content') == 'HELLO\nRUST')
    # image import
    with open(f'{OUT}/grad.png', 'wb') as f: f.write(png_bytes())
    pg.set_input_files('[data-testid=file-media]', f'{OUT}/grad.png'); pg.wait_for_function("__app.project.layers[0].type === 'image'", timeout=5000)
    check(f'[{label}] image import', P('__app.project.layers[0].media.w') == 320)
    # select rect (index 2 now: image, text, star, rect, solid) -> select via timeline label
    pg.locator('.tl-row[data-layer] .tl-label').nth(3).click(); pg.wait_for_timeout(100)
    check(f'[{label}] select layer via timeline', P('__app.project.layers.find(l=>l.id===__app.S.sel).shape?.kind') == 'rect')

    # 4. keyframes on rect: x at 0 and 2s, rotation, scale
    P('__app.seek(0)'); tab('layer'); pg.wait_for_timeout(100)
    pg.click('[data-testid=prop-x-key]'); pg.wait_for_timeout(80)
    pg.click('[data-testid=prop-rotation-key]'); pg.wait_for_timeout(80)
    pg.click('[data-testid=prop-scale-key]'); pg.wait_for_timeout(80)
    P('__app.seek(2)'); pg.wait_for_timeout(150)
    num = lambda prop: pg.locator(f'.ctl:has([data-testid=prop-{prop}]) input.num')
    num('x').fill('900'); num('x').dispatch_event('change'); pg.wait_for_timeout(80)
    num('rotation').fill('180'); num('rotation').dispatch_event('change'); pg.wait_for_timeout(80)
    num('scale').fill('0.5'); num('scale').dispatch_event('change'); pg.wait_for_timeout(80)
    keys = P("(() => { const L = __app.project.layers.find(l=>l.id===__app.S.sel); return Object.fromEntries(Object.entries(L.keys).map(([k,v]) => [k, v.map(x => [x.t, x.v])])); })()")
    check(f'[{label}] keyframes created (x/rotation/scale x2)', all(len(keys.get(p, [])) == 2 for p in ['x', 'rotation', 'scale']), keys)
    # interpolation check in-app
    mid = []
    for tt in (0, 1, 2):
        P(f'__app.seek({tt})'); pg.wait_for_timeout(150); mid.append(pg.locator('[data-testid=prop-x]').input_value())
    check(f'[{label}] interpolated value changes over time', float(mid[0]) == 540 and float(mid[2]) == 900 and 540 < float(mid[1]) < 900, mid)
    # hide the image+text layer occluders to probe rect pixels
    P("__app.project.layers[0].visible=false; __app.project.layers[1].visible=false; __app.refreshAll()")
    P('__app.seek(0)'); pg.wait_for_timeout(100); a0 = pg.evaluate(PIX, [0.5, 0.5]); s0 = pg.evaluate(SIG)
    P('__app.seek(2)'); pg.wait_for_timeout(100); a2 = pg.evaluate(PIX, [0.5, 0.5]); s2 = pg.evaluate(SIG)
    check(f'[{label}] animation changes rendered frame', s0['h'] != s2['h'], (a0, a2))
    pg.screenshot(path=f'{SHOTS}/{label}-02-keyframes.png')

    # 5. easing: click keyframe diamond in rect's row, ease tab, pick backOut, check bezier editor
    row = pg.locator(f'.tl-row[data-layer="{P("__app.S.sel")}"] .kf').first
    row.click(); pg.wait_for_timeout(150)
    tab('ease'); pg.wait_for_timeout(100)
    pg.click('[data-testid=ease-backOut]'); pg.wait_for_timeout(100)
    eases = P("(() => { const L = __app.project.layers.find(l=>l.id===__app.S.sel); return Object.values(L.keys).map(v => v[0].ease.preset); })()")
    check(f'[{label}] easing preset applied to selected keys', 'backOut' in eases, eases)
    # drag bezier handle -> custom
    bz = pg.locator('[data-testid=bezier]'); bb = bz.bounding_box()
    pg.mouse.move(bb['x'] + bb['width'] * 0.40, bb['y'] + bb['height'] * 0.05); pg.mouse.down()
    pg.mouse.move(bb['x'] + bb['width'] * 0.30, bb['y'] + bb['height'] * 0.6, steps=5); pg.mouse.up(); pg.wait_for_timeout(100)
    cust = P("(() => { const L = __app.project.layers.find(l=>l.id===__app.S.sel); return Object.values(L.keys).map(v => v[0].ease); })()")
    check(f'[{label}] bezier editor sets custom curve', any(e.get('preset') == 'custom' for e in cust), cust[0])
    pg.screenshot(path=f'{SHOTS}/{label}-03-easing.png')

    # 6. effects via UI on the rect
    P('__app.seek(1)'); tab('fx'); pg.wait_for_timeout(100)
    before = pg.evaluate(SIG)
    pg.click('[data-testid=addfx-glow]'); pg.wait_for_timeout(150)
    after = pg.evaluate(SIG)
    check(f'[{label}] glow effect changes render', before['h'] != after['h'])
    pg.click('[data-testid=addfx-rgbsplit]'); pg.wait_for_timeout(100)
    pg.click('[data-testid=addfx-shake]'); pg.wait_for_timeout(100)
    check(f'[{label}] effect stack via UI', P("__app.project.layers.find(l=>l.id===__app.S.sel).effects.map(e=>e.type)") == ['glow', 'rgbsplit', 'shake'])
    pg.screenshot(path=f'{SHOTS}/{label}-04-effects.png')
    # every effect individually changes output, no GL errors
    fxres = P("""(() => {
      const rect = __app.project.layers.find(l=>l.id===__app.S.sel); const solid = __app.project.layers.find(l=>l.type==='solid');
      solid.solid.gradient = true; const out = {};
      const sig = () => { __app.seek(1.3); const c = document.querySelector('#view'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let h=0; for (let i=0;i<d.length;i+=53) h=(h*31+d[i])>>>0; return h; };
      for (const k of Object.keys(__app.EFFECTS)) {
        out[k] = false;
        for (const L of [rect, solid]) { const saved = L.effects; L.effects = []; const base = sig(); L.effects = [__app.makeEffect(k)]; const changed = sig() !== base; L.effects = saved; if (changed) { out[k] = true; break; } }
      }
      __app.refreshAll(); return { out, errors: __app.renderer.errors };
    })()""")
    check(f'[{label}] all effects alter output', fxres and all(fxres['out'].values()) and not fxres['errors'], fxres)

    # 7. blend modes
    tab('blend'); pg.click('[data-testid=blend-difference]'); pg.wait_for_timeout(100)
    check(f'[{label}] blend mode set via UI', P("__app.project.layers.find(l=>l.id===__app.S.sel).blend") == 'difference')
    pg.screenshot(path=f'{SHOTS}/{label}-05-blend.png')
    pg.click('[data-testid=blend-screen]')

    # 8. adjustment layer
    tab('add'); pg.click('[data-testid=add-adjust]'); pg.wait_for_timeout(200)
    check(f'[{label}] adjustment layer w/ color adjust', P("__app.project.layers[0].type") == 'adjust' and P("__app.project.layers[0].effects[0].type") == 'coloradj')

    # 9. undo/redo
    n = P('__app.project.layers.length'); pg.click('[data-testid=undo]'); pg.wait_for_timeout(100)
    n2 = P('__app.project.layers.length'); pg.click('[data-testid=redo]'); pg.wait_for_timeout(100)
    check(f'[{label}] undo/redo', n2 == n - 1 and P('__app.project.layers.length') == n, (n, n2))

    # 10. persistence: reload
    P("__app.project.layers.forEach(l => l.visible = true); __app.commit()")
    pg.wait_for_timeout(600); pid = P('__app.project.id'); nl = P('__app.project.layers.length')
    pg.reload(); pg.wait_for_function('window.__app && __app.project'); pg.wait_for_timeout(500)
    check(f'[{label}] localStorage persistence across reload', P('__app.project.id') == pid and P('__app.project.layers.length') == nl)
    pg.wait_for_function("(() => { const L = __app.project.layers.find(l => l.type==='image'); return !L || document.querySelector('#view') })()")

    # 11. JSON export / import
    tab('project')
    with pg.expect_download() as dl: pg.click('[data-testid=export-json]')
    jpath = f'{OUT}/{label}-project.kntc.json'; dl.value.save_as(jpath)
    data = json.load(open(jpath))
    check(f'[{label}] JSON export (with embedded media)', len(data['layers']) == nl and len(data.get('media', {})) == 1, os.path.getsize(jpath))
    pg.set_input_files('[data-testid=file-json]', jpath); pg.wait_for_timeout(800)
    check(f'[{label}] JSON import', P('__app.project.layers.length') == nl and P('__app.project.id') != pid)

    # 12. video export (short) via dialog
    P("__app.project.duration = 2; __app.project.layers.forEach(l => { l.end = Math.min(l.end, 2); }); __app.commit()")
    pg.click('[data-testid=btn-export]'); pg.wait_for_timeout(200)
    fmts = P('JSON.stringify(__app.supportedFormats())')
    pg.select_option('[data-testid=export-format]', 'webm')
    pg.locator('dialog .chip', has_text='480p').click()
    pg.screenshot(path=f'{SHOTS}/{label}-06-export-dialog.png')
    pg.click('[data-testid=export-start]')
    pg.wait_for_selector('[data-testid=export-result]', timeout=30000)
    le = P('window.__lastExport')
    with pg.expect_download() as dl: pg.click('[data-testid=export-download]')
    vpath = f'{OUT}/{label}-export.{"mp4" if "mp4" in le["mime"] else "webm"}'; dl.value.save_as(vpath)
    head = open(vpath, 'rb').read(4)
    check(f'[{label}] video export non-empty file', le['size'] > 1000 and os.path.getsize(vpath) == le['size'] and head == b'\x1a\x45\xdf\xa3', dict(le, formats=fmts))
    pg.wait_for_timeout(500)
    dec = pg.evaluate("""async () => { const v = document.querySelector('dialog video.preview'); v.muted = true;
      if (v.readyState < 2) await new Promise(r => v.addEventListener('loadeddata', r, { once: true }));
      v.currentTime = 1.0; await new Promise(r => v.addEventListener('seeked', r, { once: true }));
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext('2d'); x.drawImage(v, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let mn = 255, mx = 0; for (let i = 0; i < d.length; i += 4 * 37) { const l = d[i] + d[i+1] + d[i+2]; mn = Math.min(mn, l); mx = Math.max(mx, l); }
      return { w: v.videoWidth, h: v.videoHeight, dur: v.duration, range: mx - mn }; }""")
    check(f'[{label}] exported video decodes with visible content', dec['w'] == 480 and dec['range'] > 60, dec)
    pg.screenshot(path=f'{SHOTS}/{label}-07-export-done.png')
    # mp4 if supported in this engine
    if json.loads(fmts).get('mp4'):
        pg.select_option('[data-testid=export-format]', 'mp4'); pg.click('[data-testid=export-start]')
        pg.wait_for_function("window.__lastExport && window.__lastExport.mime.includes('mp4')", timeout=30000)
        le2 = P('window.__lastExport'); check(f'[{label}] MP4 export non-empty', le2['size'] > 1000, le2)
    pg.click('[data-testid=dlg-close]')

    # 13. import exported video as a layer
    pg.set_input_files('[data-testid=file-media]', vpath)
    try:
        pg.wait_for_function("__app.project.layers[0].type === 'video'", timeout=8000); ok = True
    except Exception: ok = False
    check(f'[{label}] video import as layer', ok)

    # 14. canvas drag moves selected layer (touch/mouse)
    tab('add'); pg.click('[data-testid=add-ellipse]'); P('__app.seek(0.5)'); pg.wait_for_timeout(100)
    x0 = P("__app.project.layers[0].props.x"); box = pg.locator('#stage').bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 40, cy + 10, steps=6); pg.mouse.up(); pg.wait_for_timeout(100)
    check(f'[{label}] drag on canvas moves layer', P("__app.project.layers[0].props.x") != x0, (x0, P("__app.project.layers[0].props.x")))
    tab('layer'); pg.wait_for_timeout(100)
    pg.screenshot(path=f'{SHOTS}/{label}-08-layer-panel.png')
    tab('style'); pg.wait_for_timeout(100); pg.screenshot(path=f'{SHOTS}/{label}-09-style-panel.png')

    # PWA bits
    man = pg.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
    check(f'[{label}] PWA manifest valid', man['display'] == 'standalone' and len(man['icons']) >= 2)
    check(f'[{label}] no page errors', not [e for e in errs if 'GL Driver' not in e], errs[:5])
    b.close()

with sync_playwright() as pw:
    iphone = dict(pw.devices['iPhone 15 Pro Max']); iphone['viewport'] = {'width': 440, 'height': 956}; iphone['screen'] = {'width': 440, 'height': 956}
    run(pw, 'desktop', dict(viewport={'width': 1440, 'height': 900}, device_scale_factor=1), False)
    run(pw, 'iphone', iphone, True)

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
json.dump([{'name': n, 'pass': p, 'detail': str(d)[:300]} for n, p, d in results], open(f'{OUT}/results.json', 'w'), indent=1)
sys.exit(1 if fails else 0)
