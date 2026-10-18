"""End-to-end tests: desktop (1440x900) and iPhone emulation (Chromium, iPhone 15 Pro Max descriptor at 440x956 = iPhone 17 Pro Max)."""
import json, sys, os, struct, zlib, time, wave, math
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

def wav_bytes(path, secs=1.5, rate=8000):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', int(9000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(int(secs * rate))))

def run(pw, label, ctx_opts, mobile):
    b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(accept_downloads=True, **ctx_opts)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(BASE); pg.wait_for_function('window.__app && __app.project')
    pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_function('window.__app && __app.project')
    # home screen (project list) shows first; open the demo project from it
    pg.wait_for_selector('[data-testid=home-open]')
    check(f'[{label}] home screen lists projects with + button', pg.locator('[data-testid=home]').is_visible() and pg.locator('[data-testid=home-new]').is_visible() and pg.locator('[data-testid=home-project]').count() >= 1)
    P = lambda js: pg.evaluate(js)
    pg.on('dialog', lambda d: d.accept())  # confirm() for delete
    # light home screen: top bar, banner, pill tabs, project cards with meta grid, bottom tab bar with the mint + FAB
    hm = P("""(() => { const cs = s => getComputedStyle(document.querySelector(s)); const card = document.querySelector('[data-testid=home-project]');
      return { bg: cs('#home').backgroundColor, card: getComputedStyle(card).backgroundColor, fab: cs('#homeNew').backgroundColor, pill: cs('.h-pills button.on').backgroundColor,
        pills: [...document.querySelectorAll('.h-pills button')].map(b => b.firstChild.textContent), banner: !!document.querySelector('[data-testid=home-banner]').offsetParent,
        nav: [...document.querySelectorAll('.h-nav button b')].map(b => b.textContent), meta: [...card.querySelectorAll('.pc-m')].map(e => e.textContent),
        dur: card.querySelector('[data-testid=home-dur]').textContent, word: document.querySelector('.wordmark').textContent, font: cs('#home').fontFamily }; })()""")
    check(f'[{label}] home: light theme, banner, pills, meta grid, bottom tab bar', hm['bg'] == 'rgb(245, 245, 245)' and hm['card'] == 'rgb(255, 255, 255)' and hm['fab'] == 'rgb(116, 251, 175)'
          and hm['pill'] == 'rgb(32, 34, 57)' and hm['pills'] == ['Projects', 'Your Templates', 'Elements', 'Cloud'] and hm['banner'] and hm['nav'] == ['Home', 'Tutorials', 'Projects', 'Templates']
          and hm['meta'] == ['9:16', '1080p', hm['meta'][2], '30fps'] and hm['meta'][2].endswith('kb') and hm['dur'] == '00:06:00' and hm['word'] == 'KINETIC', hm)
    pg.click('.h-nav [data-nav=tutorials]'); pg.wait_for_timeout(100)
    check(f'[{label}] home: non-functional tabs say coming soon', 'coming soon' in (P("[...document.querySelectorAll('.toast')].map(t => t.textContent).join('|')") or ''))
    # banner Import opens the project-file picker; X dismisses (remembered)
    with pg.expect_file_chooser() as fc: pg.click('[data-testid=home-import]')
    check(f'[{label}] home: banner Import opens the project file picker', fc.value is not None)
    pg.click('[data-testid=home-banner-close]'); pg.wait_for_timeout(50)
    check(f'[{label}] home: banner dismissible', not pg.locator('[data-testid=home-banner]').is_visible() and P("localStorage.getItem('kntc.bannerX')") == '1')
    P("localStorage.removeItem('kntc.bannerX'); document.querySelector('#homeBanner').hidden = false")
    # + -> Create sheet
    pg.click('[data-testid=home-new]'); pg.wait_for_timeout(350)
    cr = P("""(() => { const q = s => document.querySelector(s); return { vis: !!q('#create .cr-sheet').offsetParent, name: q('[data-testid=create-name]').value,
      on: q('.cr-ratio.on').dataset.a, ratios: [...document.querySelectorAll('.cr-ratio')].map(b => b.dataset.a), size: q('[data-testid=create-size]').textContent,
      res: q('[data-testid=create-res]').value, fps: q('[data-testid=create-fps]').value, bg: q('[data-testid=create-bg]').value,
      sheet: getComputedStyle(q('.cr-sheet')).backgroundColor, seg: getComputedStyle(q('.cr-seg .on')).color, go: q('[data-testid=create-go]').textContent }; })()""")
    check(f'[{label}] create sheet: auto-numbered name, 9:16 active, 1080p / 30 fps / Light Grey', cr['vis'] and cr['name'] == 'Project Name 2' and cr['on'] == '9:16'
          and cr['ratios'] == ['16:9', '9:16', '4:5', '1:1', '4:3', 'custom'] and cr['size'] == 'Composition Size1080 × 1920' and cr['res'] == '1080' and cr['fps'] == '30'
          and cr['bg'] == '#d9d9d9' and cr['sheet'] == 'rgb(236, 236, 238)' and cr['seg'] == 'rgb(116, 251, 175)' and cr['go'] == 'Create from scratch', cr)
    if mobile: pg.screenshot(path=f'{SHOTS}/{label}-02-create-sheet.png')
    pg.click('[data-testid=create-name-clear]'); check(f'[{label}] create: clear name button', P("document.querySelector('[data-testid=create-name]').value") == '')
    pg.fill('[data-testid=create-name]', 'My Reel')
    pg.click('[data-testid="create-ratio-16:9"]'); pg.select_option('[data-testid=create-res]', '720'); pg.select_option('[data-testid=create-fps]', '60'); pg.select_option('[data-testid=create-bg]', '#000000')
    check(f'[{label}] create: composition size follows ratio + resolution', P("document.querySelector('[data-testid=create-size]').textContent") == 'Composition Size1280 × 720')
    pg.click('[data-testid=create-go]'); pg.wait_for_timeout(400)
    np_ = P("(() => { const p = __app.project; return [p.name, p.w, p.h, p.fps, p.bg, p.aspect, p.layers.length, document.getElementById('home').hidden, document.getElementById('create').hidden]; })()")
    corner = pg.evaluate(PIX, [0.02, 0.02])
    check(f'[{label}] create from scratch makes the project (16:9 720p 60fps, black bg on the canvas)', np_ == ['My Reel', 1280, 720, 60, '#000000', '16:9', 0, True, True] and corner[:3] == [0, 0, 0], (np_, corner))
    pg.click('[data-testid=btn-export]'); pg.wait_for_timeout(200)
    ex = P("({ res: document.querySelector('[data-testid=export-res-720]').classList.contains('on'), fps: document.querySelector('[data-testid=export-fps]').value, info: document.querySelector('dialog .hint').textContent })")
    check(f'[{label}] export defaults to the project resolution and fps', ex['res'] and ex['fps'] == '60' and ex['info'].startswith('1280×720 · 60fps'), ex)
    pg.click('[data-testid=dlg-close]')
    # custom ratio via the pencil
    pg.click('[data-testid=btn-back]'); pg.wait_for_timeout(200); pg.click('[data-testid=home-new]'); pg.wait_for_timeout(300)
    check(f'[{label}] create: next auto-number', P("document.querySelector('[data-testid=create-name]').value") == 'Project Name 3')
    pg.click('[data-testid=create-ratio-custom]'); pg.fill('[data-testid=create-custom-w]', '2'); pg.fill('[data-testid=create-custom-h]', '1'); pg.select_option('[data-testid=create-bg]', '#ffffff')
    pg.click('[data-testid=create-go]'); pg.wait_for_timeout(300)
    check(f'[{label}] create: custom ratio 2:1 @1080p', P("[__app.project.w, __app.project.h, __app.project.aspect, __app.project.bg]") == [2160, 1080, '2:1', '#ffffff'])
    # close via X keeps the home screen; card ... menu: rename / duplicate / delete
    pg.click('[data-testid=btn-back]'); pg.wait_for_timeout(200)
    pg.click('[data-testid=home-new]'); pg.wait_for_timeout(300); pg.click('[data-testid=create-close]'); pg.wait_for_timeout(300)
    check(f'[{label}] create sheet closes with X', P("document.getElementById('create').hidden") and pg.locator('[data-testid=home]').is_visible())
    n0 = pg.locator('[data-testid=home-project]').count()
    pg.locator('[data-testid=home-project]', has_text='My Reel').locator('[data-testid=home-more]').click(); pg.wait_for_timeout(80)
    pg.click('[data-testid=home-rename]'); pg.fill('[data-testid=rename-input]', 'Reel v2'); pg.click('[data-testid=rename-save]'); pg.wait_for_timeout(150)
    names = P("[...document.querySelectorAll('[data-testid=home-name]')].map(b => b.textContent)")
    check(f'[{label}] home menu: rename', 'Reel v2' in names and 'My Reel' not in names, names)
    pg.locator('[data-testid=home-project]', has_text='Reel v2').locator('[data-testid=home-more]').click(); pg.click('[data-testid=home-duplicate]'); pg.wait_for_timeout(150)
    check(f'[{label}] home menu: duplicate', pg.locator('[data-testid=home-project]').count() == n0 + 1 and pg.locator('[data-testid=home-name]', has_text='Reel v2 copy').count() == 1)
    pg.locator('[data-testid=home-project]', has_text='Reel v2 copy').locator('[data-testid=home-more]').click(); pg.click('[data-testid=home-delete]'); pg.wait_for_timeout(150)
    check(f'[{label}] home menu: delete', pg.locator('[data-testid=home-project]').count() == n0 and pg.locator('[data-testid=home-name]', has_text='Reel v2 copy').count() == 0)
    if mobile: pg.screenshot(path=f'{SHOTS}/{label}-02-home.png')
    # open the demo project again
    pg.locator('[data-testid=home-project]', has_text='Neon Demo').locator('[data-testid=home-open]').click(); pg.wait_for_timeout(1000)
    def to_none():  # back out of sheet / sub panel / selection to the plain editor
        for _ in range(5):
            if P("__app.S.tab") == 'add': pg.click('[data-testid=sheet-close]')
            elif P("document.body.dataset.mode") != 'none': pg.click('[data-testid=btn-back]')
            else: return
            pg.wait_for_timeout(60)
    def add(kind, sheet='shape'):  # + FAB -> sheet tab -> item (text / drawing / vector live in the right column)
        to_none(); pg.click('[data-testid=tab-add]'); pg.wait_for_timeout(60)
        if kind not in ('text', 'draw', 'vector') and P("__app.S.addTab") != sheet: pg.click(f'[data-testid=sheet-{sheet}]')
        pg.click(f'[data-testid=add-{kind}]'); pg.wait_for_timeout(100)
    def tab(t):  # open a property sub panel from the tile grid (or project settings from the gear)
        if P("__app.S.tab") == t: return
        if t == 'project': to_none(); pg.click('[data-testid=tab-project]'); pg.wait_for_timeout(60); return
        if P("document.body.dataset.mode") == 'sub': pg.click('[data-testid=panel-back]'); pg.wait_for_timeout(60)
        pg.click(f'[data-testid=tab-{t}]'); pg.wait_for_timeout(60)

    # 1. demo renders
    sig0 = pg.evaluate(SIG)
    check(f'[{label}] demo project loads & renders', P('__app.project.layers.length') == 5 and sig0['nz'] > 50, sig0)
    # full-height layout: tab bar pinned to the bottom, reclaimed height goes to the timeline
    lay = P("""(() => { const r = id => document.getElementById(id).getBoundingClientRect();
      return { vh: innerHeight, app: Math.round(r('app').bottom), bottom: Math.round(r('bottom').bottom), tl: Math.round(r('timeline').height), stage: Math.round(r('stageWrap').height),
               fab: !!document.getElementById('fab').offsetParent, panel: !!document.getElementById('panel').offsetParent, tcx: Math.round(r('tcPill').left + r('tcPill').width / 2), phx: Math.round(r('playhead').left), w: innerWidth }; })()""")
    check(f'[{label}] editor: mint + FAB, no panel, timecode pill centred on the fixed playhead', lay['fab'] and not lay['panel'] and abs(lay['tcx'] - lay['phx']) <= 2 and abs(lay['phx'] - lay['w'] / 2) <= 2, lay)
    if mobile:
        check(f'[{label}] bottom zone pinned to the viewport bottom', lay['bottom'] == lay['vh'], lay)
        check(f'[{label}] timeline gets the bottom zone (>250px) & preview stays large (>=400px)', lay['tl'] > 250 and lay['stage'] >= 400, lay)
        pg.screenshot(path=f'{SHOTS}/{label}-00-fullheight.png')
    else:
        check(f'[{label}] app fills viewport height', abs(lay['vh'] - lay['app']) <= 1, lay)
    P('__app.seek(1.6)'); pg.wait_for_timeout(200)
    pg.screenshot(path=f'{SHOTS}/{label}-01-demo.png')
    # playback advances time
    pg.click('[data-testid=play]'); pg.wait_for_timeout(900)
    try: pg.wait_for_function('__app.S.t > 1.75', timeout=4000)
    except Exception: pass
    t_play = P('__app.S.t'); pg.click('[data-testid=play]')
    check(f'[{label}] playback advances playhead', abs(t_play - 1.6) > 0.1, round(t_play, 2))

    # 2. new 1:1 project
    tab('project'); pg.click('[data-testid=new-project]'); pg.wait_for_timeout(300); pg.click('[data-testid="create-ratio-1:1"]'); pg.click('[data-testid=create-go]'); pg.wait_for_timeout(300)
    check(f'[{label}] new project 1:1 (editor New -> Create sheet)', P('[__app.project.w, __app.project.h, __app.project.layers.length]') == [1080, 1080, 0])
    # aspect switch
    tab('project'); pg.click('[data-testid="aspect-16:9"]'); pg.wait_for_timeout(150)
    check(f'[{label}] aspect preset 16:9', P('[__app.project.w, __app.project.h]') == [1920, 1080])
    pg.click('[data-testid="aspect-9:16"]'); pg.wait_for_timeout(150)

    # 3. add layers
    to_none(); pg.click('[data-testid=tab-add]'); pg.wait_for_timeout(100)
    sh = P("({ tabs: [...document.querySelectorAll('.sh-tab')].map(b => b.textContent.replace(/\\s+/g, ' ').trim()), side: document.querySelectorAll('.sh-sbtn').length, shapes: document.querySelectorAll('.sh-shape').length, on: document.querySelector('.sh-tab.on').textContent })")
    check(f'[{label}] add sheet: 5 tabs, right column, paged shape grid', len(sh['tabs']) == 5 and sh['side'] == 4 and sh['shapes'] >= 15 and sh['on'] == 'Shape', sh)
    add('solid', 'object')
    add('rect')
    rect = P("(() => { const L = __app.project.layers[0]; return { id: L.id, fill: L.shape.fill }; })()")
    px = pg.evaluate(PIX, [0.5, 0.5]); fill = [int(rect['fill'][i:i + 2], 16) for i in (1, 3, 5)]
    first = P("document.querySelector('.tl-row[data-layer]').dataset.layer")
    check(f'[{label}] newly added layer goes on top: first in the list, first timeline row, rendered in front', first == rect['id'] and all(abs(px[i] - fill[i]) < 12 for i in range(3)), (px, fill))
    add('star')
    add('text')
    types = P('__app.project.layers.map(l => l.type)')
    check(f'[{label}] add solid/shape/shape/text layers (newest on top)', types == ['text', 'shape', 'shape', 'solid'], types)
    check(f'[{label}] layer selected: tile grid replaces the FAB, header shows layer name + dup/trash/more', P("document.body.dataset.mode") == 'sel' and pg.locator('[data-testid=tab-style]').is_visible() and pg.locator('[data-testid=del-layer]').is_visible() and not pg.locator('#fab').is_visible())
    tab('edit'); pg.fill('[data-testid=text-content]', 'HELLO\nRUST'); pg.locator('[data-testid=text-content]').dispatch_event('change'); pg.wait_for_timeout(100)
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
    bz = pg.locator('[data-testid=bezier]'); bz.evaluate("e => e.scrollIntoView({ block: 'start' })"); pg.wait_for_timeout(100); bb = bz.bounding_box()
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
    add('adjust', 'object'); pg.wait_for_timeout(100)
    check(f'[{label}] adjustment layer w/ color adjust', P("__app.project.layers[0].type") == 'adjust' and P("__app.project.layers[0].effects[0].type") == 'coloradj')

    # 9. undo/redo
    n = P('__app.project.layers.length'); pg.click('[data-testid=undo]'); pg.wait_for_timeout(100)
    n2 = P('__app.project.layers.length'); pg.click('[data-testid=redo]'); pg.wait_for_timeout(100)
    check(f'[{label}] undo/redo', n2 == n - 1 and P('__app.project.layers.length') == n, (n, n2))

    # 10. persistence: reload
    P("__app.project.layers.forEach(l => l.visible = true); __app.commit()")
    pg.wait_for_timeout(600); pid = P('__app.project.id'); nl = P('__app.project.layers.length')
    pg.reload(); pg.wait_for_function('window.__app && __app.project'); pg.wait_for_timeout(500)
    pg.click('[data-testid=home-open] >> nth=0'); pg.wait_for_timeout(200)
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
    to_none(); pg.click('[data-testid=btn-export]'); pg.wait_for_timeout(200)
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
    add('ellipse'); P('__app.seek(0.5)'); pg.wait_for_timeout(100)
    x0 = P("__app.project.layers[0].props.x"); box = pg.locator('#stage').bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 40, cy + 10, steps=6); pg.mouse.up(); pg.wait_for_timeout(100)
    check(f'[{label}] drag on canvas moves layer', P("__app.project.layers[0].props.x") != x0, (x0, P("__app.project.layers[0].props.x")))
    tab('layer'); pg.wait_for_timeout(100)
    pg.screenshot(path=f'{SHOTS}/{label}-08-layer-panel.png')
    tab('style'); pg.wait_for_timeout(100); pg.screenshot(path=f'{SHOTS}/{label}-09-style-panel.png')

    # 15. freehand drawing: + > Freehand Drawing opens the Drawing panel; a stroke on the preview adds to the layer
    add('draw')
    check(f'[{label}] freehand drawing layer + Drawing panel (tools, size, colours)', P("__app.S.tab") == 'draw' and P("__app.project.layers[0].type") == 'draw' and pg.locator('[data-testid=tool-eraser]').is_visible() and pg.locator('[data-testid=draw-size]').is_visible() and pg.locator('[data-testid=swatch]').count() == 14)
    pg.locator('[data-testid=swatch]').nth(0).click(); s0 = pg.evaluate(SIG)
    box = pg.locator('#stage').bounding_box()
    pg.mouse.move(box['x'] + box['width'] * 0.3, box['y'] + box['height'] * 0.3); pg.mouse.down()
    pg.mouse.move(box['x'] + box['width'] * 0.7, box['y'] + box['height'] * 0.6, steps=8); pg.mouse.up(); pg.wait_for_timeout(150)
    st = P("__app.project.layers[0].draw.strokes.map(s => [s.tool, s.color, s.pts.length])")
    check(f'[{label}] drawing a stroke on the preview', len(st) == 1 and st[0][1] == '#ff4444' and st[0][2] > 3 and pg.evaluate(SIG)['h'] != s0['h'], st)
    pg.screenshot(path=f'{SHOTS}/{label}-13-drawing.png')
    # 16. vector drawing -> Edit Points: tap the preview to place points
    add('vector')
    for fx, fy in [(0.3, 0.3), (0.7, 0.35), (0.5, 0.7)]:
        pg.mouse.click(box['x'] + box['width'] * fx, box['y'] + box['height'] * fy); pg.wait_for_timeout(80)
    pg.click('[data-testid=pt-add]'); pg.wait_for_timeout(80)
    pts = P("__app.project.layers[0].shape.pts.length")
    check(f'[{label}] vector drawing: Edit Points places points (preview taps + add button)', P("__app.S.tab") == 'points' and P("__app.project.layers[0].shape.kind") == 'path' and pts == 4 and pg.locator('[data-testid=trackpad]').is_visible(), pts)
    pg.screenshot(path=f'{SHOTS}/{label}-14-edit-points.png')
    # 17. audio file -> audio layer
    wav_bytes(f'{OUT}/tone.wav')
    pg.set_input_files('[data-testid=file-audio]', f'{OUT}/tone.wav')
    try: pg.wait_for_function("__app.project.layers[0].type === 'audio'", timeout=6000); aok = True
    except Exception: aok = False
    check(f'[{label}] audio import as a layer', aok and abs(P("__app.project.layers[0].media.duration") - 1.5) < 0.1)
    to_none()

    # 18. tap on empty space deselects (canvas outside layers, dark surround, empty timeline); pans / long presses don't
    def tapat(x, y):
        if mobile: pg.touchscreen.tap(x, y)
        else: pg.mouse.click(x, y)
        pg.wait_for_timeout(120)
    P("(() => { const a = __app, p = a.demoProject('9:16'); p.layers = []; p.bg = '#000000'; a.setProject(p); a.deselect(); })()"); pg.wait_for_timeout(150)
    add('rect'); P("(() => { const L = __app.project.layers[0]; L.props.x = 270; L.props.y = 480; L.shape.w = L.shape.h = 240; L.name = 'Box'; __app.commit(); })()")
    add('arrow'); P("(() => { const L = __app.project.layers[0]; L.name = 'Arrow'; __app.commit(); })()")
    P('__app.seek(1)'); pg.wait_for_timeout(150)
    ids = P("__app.project.layers.map(l => l.id)"); A_, B_ = ids[0], ids[1]
    sb = pg.locator('#stage').bounding_box(); at = lambda fx, fy: (sb['x'] + sb['width'] * fx, sb['y'] + sb['height'] * fy)
    sel = lambda: P('__app.S.sel')
    tapat(*at(0.88, 0.9))
    check(f'[{label}] tap on empty canvas deselects (mint + FAB back)', sel() is None and P("document.body.dataset.mode") == 'none' and pg.locator('#fab').is_visible(), sel())
    tapat(*at(0.25, 0.25)); s1 = sel(); tapat(*at(0.5, 0.5)); s2 = sel()
    check(f'[{label}] tapping a layer on the canvas selects it (then another one)', s1 == B_ and s2 == A_, (s1, s2))
    x, y = at(0.88, 0.9)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 40, y - 30, steps=6); pg.mouse.up(); pg.wait_for_timeout(100)
    check(f'[{label}] a drag that starts on empty canvas does not deselect', sel() == A_)
    pg.mouse.move(x, y); pg.mouse.down(); pg.wait_for_timeout(700); pg.mouse.up(); pg.wait_for_timeout(100)
    check(f'[{label}] a long press on empty canvas does not deselect', sel() == A_)
    wr = pg.locator('#stageWrap').bounding_box()
    sx = sb['x'] - 12 if sb['x'] - wr['x'] > 20 else None
    if sx is None: sy = sb['y'] - 8 if sb['y'] - wr['y'] > 12 else sb['y'] + sb['height'] + 6; sx = wr['x'] + wr['width'] / 2
    else: sy = wr['y'] + wr['height'] / 2
    tapat(sx, sy)
    check(f'[{label}] tap on the dark area around the canvas deselects', sel() is None, (sx, sy, sb, wr))
    # timeline: empty space below the rows, beside the rows (left of t=0) -> deselect; the ruler doesn't
    def tl_pts():
        return P("""(() => { const tl = document.getElementById('tlScroll').getBoundingClientRect(); const pad = document.querySelector('[data-testid=tl-pad]').getBoundingClientRect();
          const row = document.querySelector(`.tl-row[data-layer="${__app.project.layers[0].id}"]`).getBoundingClientRect(); const ru = document.querySelector('[data-testid=ruler]').getBoundingClientRect();
          return { below: [tl.right - 40, Math.min(pad.top + 20, tl.bottom - 8)], beside: [tl.left + 110, row.top + row.height / 2], ruler: [tl.right - 60, ru.top + 8] }; })()""")
    P(f"__app.selectLayer('{A_}')"); pg.wait_for_timeout(150); tp = tl_pts()
    tapat(*tp['ruler']); r_ok = sel() == A_
    tapat(*tp['below']); b_ok = sel() is None
    P(f"__app.selectLayer('{A_}')"); pg.wait_for_timeout(150); tp = tl_pts(); tapat(*tp['beside']); s_ok = sel() is None
    check(f'[{label}] timeline: tap below / beside the rows deselects, the ruler does not', r_ok and b_ok and s_ok, (r_ok, b_ok, s_ok, tp))

    # 19. ⋯ layer menu: Alight-style dropdown anchored under the ⋯ button
    P(f"__app.selectLayer('{A_}')"); pg.wait_for_timeout(150)
    pg.click('[data-testid=layer-more]'); pg.wait_for_timeout(250)
    lm = P("""(() => { const m = document.querySelector('[data-testid=layer-menu]'), b = document.getElementById('btnMore').getBoundingClientRect(), r = m.getBoundingClientRect(), cs = getComputedStyle(m);
      const its = [...m.querySelectorAll('.lm-it span')]; return { labels: its.map(s => s.textContent), bg: cs.backgroundColor, top: r.top - b.bottom, right: Math.round(innerWidth - r.right),
        under: r.left < b.left && r.right > b.right - 30, fs: getComputedStyle(its[0]).fontSize, fsStretch: parseFloat(getComputedStyle(its[5]).fontSize), col: getComputedStyle(its[0]).color,
        hr: getComputedStyle(m.querySelector('.lm-hr')).backgroundColor, sw: m.querySelectorAll('.lm-sw').length, swOn: m.querySelector('.lm-sw.on')?.classList.contains('none'), dlg: document.getElementById('dlg').open,
        fits: its.every(s => s.scrollWidth <= s.clientWidth + 1) }; })()""")
    want = ['Save to My Elements', 'Flip Horizontally', 'Flip Vertically', 'Fit Composition Area', 'Fill Composition Area', 'Stretch to Composition Area', 'Create Clipping Mask', 'Convert to Outline',
            'Center on Canvas', 'Hide Layer', 'Lock', 'Move Up', 'Move Down', 'Easing', 'Rename']
    check(f'[{label}] ⋯ opens a dropdown under the ⋯ button (not a modal): Alight items, swatches, then our extras', lm['labels'] == want and not lm['dlg'] and 0 <= lm['top'] <= 16 and lm['under'], lm)
    check(f'[{label}] ⋯ menu colours/fonts match the reference (slate #35374e, 17px white, dark dividers, auto-shrunk Stretch)', lm['bg'] == 'rgb(53, 55, 78)' and lm['fs'] == '17px' and lm['col'] == 'rgb(255, 255, 255)'
          and lm['hr'] == 'rgb(33, 34, 54)' and lm['fsStretch'] < 17 and lm['fits'] and lm['sw'] >= 6 and lm['swOn'], lm)
    if mobile: pg.screenshot(path=f'{SHOTS}/{label}-15-layer-menu.png')
    tapat(*at(0.5, 0.92)); pg.wait_for_timeout(100)
    check(f'[{label}] tap outside closes the ⋯ menu (and does not deselect)', pg.locator('[data-testid=layer-menu]').count() == 0 and sel() == A_)
    def menu(item):
        pg.click('[data-testid=layer-more]'); pg.wait_for_timeout(150); pg.click(f'[data-testid=lm-{item}]'); pg.wait_for_timeout(150)
    s0 = pg.evaluate(SIG); menu('flip-h'); s1 = pg.evaluate(SIG)
    check(f'[{label}] Flip Horizontally mirrors the layer (scale -1 in x)', P("__app.project.layers[0].flipX") is True and s1['h'] != s0['h'] and pg.locator('[data-testid=layer-menu]').count() == 0)
    menu('flip-v'); menu('flip-h')
    check(f'[{label}] Flip Vertically / flip back', P("[!!__app.project.layers[0].flipX, !!__app.project.layers[0].flipY]") == [False, True])
    pg.click('[data-testid=undo]'); pg.wait_for_timeout(100)
    check(f'[{label}] flips are undoable', P("__app.project.layers[0].flipX") is True)
    def tr(): return P("(() => { const L = __app.project.layers[0]; return [L.props.x, L.props.y, L.props.scale, L.props.rotation, L.shape.w, L.shape.h]; })()")
    P("(() => { const L = __app.project.layers[0]; L.props.x = 100; L.props.rotation = 30; __app.commit(); })()")
    menu('fit'); f1 = tr(); menu('fill'); f2 = tr(); menu('stretch'); f3 = tr()
    check(f'[{label}] Fit / Fill / Stretch to Composition Area (centred, relative to the canvas)', f1 == [540, 960, 2.5, 0, 432, 432] and abs(f2[2] - 1920 / 432) < 1e-3 and f3 == [540, 960, 1, 0, 1080, 1920], (f1, f2, f3))
    for _ in range(4): pg.click('[data-testid=undo]'); pg.wait_for_timeout(100)
    fill0 = P("__app.project.layers[0].shape.fill"); menu('outline')
    ol = P("(() => { const s = __app.project.layers[0].shape; return [s.fillOn, s.strokeW > 0, s.stroke]; })()")
    check(f'[{label}] Convert to Outline: fill off, stroke on (in the fill colour)', ol == [False, True, fill0], (ol, fill0))
    clipq = f"document.querySelector('.tl-row[data-layer=\"{A_}\"] .clip')"
    menu('tag-1'); tg = P(f"(() => {{ const c = {clipq}; return [__app.project.layers[0].tag, c.dataset.tag, getComputedStyle(c).backgroundColor]; }})()")
    menu('tag-0'); tg0 = P(f"[__app.project.layers[0].tag ?? null, {clipq}.dataset.tag ?? null]")
    check(f'[{label}] colour tag swatches set the clip colour on the timeline (and X clears it)', tg == ['#e34829', '#e34829', 'rgb(227, 72, 41)'] and tg0 == [None, None], (tg, tg0))
    # clipping mask: a big blue square clipped to the small box below shows only inside the box
    P("""(() => { const a = __app, L = a.project.layers[0], B = a.project.layers[1]; L.shape.kind = 'rect'; L.shape.fillOn = true; L.shape.strokeW = 0; L.shape.fill = '#0000ff'; L.shape.w = L.shape.h = 900; L.shape.radius = 0;
      L.flipX = false; L.flipY = false; L.props.x = 540; L.props.y = 960; L.props.scale = 1; B.props.x = 540; B.props.y = 960; B.props.scale = 1; B.shape.w = B.shape.h = 200; B.shape.fill = '#ff0000'; B.shape.radius = 0; a.commit(); })()"""); pg.wait_for_timeout(150)
    out0, in0 = pg.evaluate(PIX, [0.3, 0.5]), pg.evaluate(PIX, [0.5, 0.5])
    menu('clip'); pg.wait_for_timeout(100)
    out1, in1 = pg.evaluate(PIX, [0.3, 0.5]), pg.evaluate(PIX, [0.5, 0.5])
    clipped_row = P(f"document.querySelector('.tl-row[data-layer=\"{A_}\"]').classList.contains('clipped')")
    pg.click('[data-testid=layer-more]'); pg.wait_for_timeout(150); rel = P("document.querySelector('[data-testid=lm-clip] span').textContent"); pg.click('[data-testid=lm-clip]'); pg.wait_for_timeout(150)
    out2 = pg.evaluate(PIX, [0.3, 0.5])
    check(f'[{label}] Create Clipping Mask: the layer only shows inside the layer below; Release restores', out0[2] > 200 and in0[2] > 200 and out1[:3] == [0, 0, 0] and in1[2] > 200 and in1[0] < 40 and clipped_row
          and rel == 'Release Clipping Mask' and out2[2] > 200, (out0, in0, out1, in1, clipped_row, rel, out2))
    menu('save'); check(f'[{label}] Save to My Elements says coming soon', 'coming soon' in (P("[...document.querySelectorAll('.toast')].map(t => t.textContent).join('|')") or ''))
    menu('hide'); h1 = P("__app.project.layers[0].visible"); menu('hide'); menu('down'); dn = P("__app.project.layers[1].id")
    menu('up'); up_ = P("__app.project.layers[0].id"); menu('lock'); lk = P("__app.project.layers[0].locked"); menu('lock')
    P("(() => { const L = __app.project.layers[0]; L.props.x = 100; __app.commit(); })()"); menu('center'); cx_ = P("__app.project.layers[0].props.x")
    menu('ease'); ez = P("__app.S.tab"); pg.click('[data-testid=panel-back]'); pg.wait_for_timeout(100)
    check(f'[{label}] our extras live on in the menu: Hide, Move down/up, Lock, Center, Easing', h1 is False and dn == A_ and up_ == A_ and lk is True and cx_ == 540 and ez == 'ease', (h1, dn, up_, lk, cx_, ez))
    pg.click('[data-testid=layer-more]'); pg.wait_for_timeout(150); pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    check(f'[{label}] Escape closes the ⋯ menu', pg.locator('[data-testid=layer-menu]').count() == 0 and sel() == A_)
    to_none()

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
