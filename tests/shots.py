"""iPhone-sized (440x956 @2x, iOS safe areas simulated) screenshots -> /workspace/kntc-shots, plus side-by-side
comparisons against the reference screenshots in reference/ (git-ignored) when present -> /workspace/kntc-shots/compare."""
import os
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8765/'); OUT = '/workspace/kntc-shots'
REF = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'reference')
PAIRS = [('editor', '01-editor'), ('add-shape', '02-add-shape'), ('add-media', '03-add-media'), ('add-audio', '04-add-audio'),
         ('add-object', '05-add-object'), ('add-template', '06-add-template'), ('layer-selected', '07-layer-selected'),
         ('edit-points', '08-edit-points'), ('drawing', '09-drawing'), ('home', '10-home'), ('create', '11-create'), ('layer-menu', '14-layer-menu'),
         ('timeline-layers', '15-timeline-layers'), ('copy-menu', '16-copy-menu')]
os.makedirs(OUT, exist_ok=True)
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_context(viewport={'width': 440, 'height': 956}, device_scale_factor=2, is_mobile=True, has_touch=True).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    P = pg.evaluate
    def shot(name, wait=350): pg.wait_for_timeout(wait); pg.screenshot(path=f'{OUT}/{name}.png'); print('wrote', f'{OUT}/{name}.png')
    pg.goto(BASE); pg.wait_for_function('window.__app && __app.project'); P('localStorage.clear()'); pg.reload()
    pg.wait_for_selector('[data-testid=home-open]')
    # simulate the iPhone status bar / home indicator insets (env() is 0 in desktop Chromium)
    P("document.documentElement.style.setProperty('--safe-t', '59px'); document.documentElement.style.setProperty('--safe-b', '34px')")
    P("(() => { const a = __app; a.project.name = 'Birthday intro'; a.commit(); a.showHome(); })()"); pg.wait_for_timeout(300)
    P("(() => { const a = __app; const p = a.demoProject('9:16'); p.name = 'Neon Demo'; a.setProject(p); a.showHome(); })()"); pg.wait_for_timeout(300)
    # a few more projects like the reference list (different ratios / backgrounds)
    P("""(() => { const a = __app; const st = a.store;
      const mk = (name, bg, fill) => { const p = a.demoProject('9:16'); p.name = name; p.bg = bg; p.layers = p.layers.filter(l => l.type !== 'solid' && l.type !== 'adjust');
        p.layers.forEach(l => { if (l.shape) l.shape.fill = fill; }); p.id = Math.random().toString(36).slice(2); st.saveProject(p); };
      mk('Logo sting', '#cfeee0', '#5be8a0'); mk('Story opener', '#3a3b44', '#ff7a00'); st.saveProject(a.project); a.showHome(); })()"""); pg.wait_for_timeout(300)
    shot('home')
    pg.click('[data-testid=home-new]'); shot('create', 500)
    pg.click('[data-testid=create-close]'); pg.wait_for_timeout(300)
    pg.click('[data-testid=home-open] >> nth=0'); pg.wait_for_timeout(300)
    shot('editor')
    pg.click('[data-testid=tab-add]'); shot('add-shape')
    for t in ('media', 'audio', 'object', 'template'):
        pg.click(f'[data-testid=sheet-{t}]'); shot(f'add-{t}')
    pg.click('[data-testid=sheet-shape]'); pg.click('[data-testid=add-rect]'); shot('layer-selected')
    pg.click('[data-testid=layer-more]'); shot('layer-menu', 450); pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    pg.click('[data-testid=tab-layer]'); shot('sub-transform')
    pg.click('[data-testid=panel-back]'); pg.click('[data-testid=tab-style]'); shot('sub-color-fill')
    # vector drawing -> Edit Points: tap a few points on the preview
    pg.click('[data-testid=btn-back]'); pg.click('[data-testid=btn-back]')
    pg.click('[data-testid=tab-add]'); pg.click('[data-testid=add-vector]'); pg.wait_for_timeout(200)
    sb = pg.locator('#stage').bounding_box()
    for fx, fy in [(0.3, 0.32), (0.72, 0.4), (0.62, 0.68), (0.28, 0.6)]:
        pg.mouse.click(sb['x'] + sb['width'] * fx, sb['y'] + sb['height'] * fy); pg.wait_for_timeout(120)
    shot('edit-points')
    # freehand drawing: a couple of strokes in two colours
    pg.click('[data-testid=btn-back]'); pg.wait_for_timeout(100)
    if P("document.body.dataset.mode") != 'none': pg.click('[data-testid=btn-back]')
    pg.click('[data-testid=tab-add]'); pg.click('[data-testid=add-draw]'); pg.wait_for_timeout(200)
    def stroke(pts):
        pg.mouse.move(sb['x'] + sb['width'] * pts[0][0], sb['y'] + sb['height'] * pts[0][1]); pg.mouse.down()
        for fx, fy in pts[1:]: pg.mouse.move(sb['x'] + sb['width'] * fx, sb['y'] + sb['height'] * fy, steps=6)
        pg.mouse.up(); pg.wait_for_timeout(100)
    stroke([(0.25, 0.3), (0.4, 0.22), (0.55, 0.35), (0.7, 0.25), (0.78, 0.4)])
    pg.locator('[data-testid=swatch]').nth(0).click()
    stroke([(0.3, 0.62), (0.45, 0.72), (0.6, 0.6), (0.72, 0.7)])
    shot('drawing')
    # multi-layer timeline like reference/15: a photo layer (our own editor shot) + five shapes, nothing selected, playhead mid-way
    pg.click('[data-testid=btn-back]'); pg.wait_for_timeout(100)
    if P("document.body.dataset.mode") != 'none': pg.click('[data-testid=btn-back]')
    P("""(() => { const a = __app; const p = a.demoProject('9:16'); p.name = 'Project Name 2'; p.layers = []; p.duration = 10; a.setProject(p); })()"""); pg.wait_for_timeout(200)
    pg.set_input_files('[data-testid=file-media]', f'{OUT}/editor.png'); pg.wait_for_timeout(900)
    P("""(() => { const a = __app, p = a.project;
      const T = 26 / 30, K = 234, px = d => T + d / K; // playhead at frame 26, ~one ruler tick per frame
      const mk = (kind, name, fill, s0, s1) => { const L = a.makeLayer(p, 'shape', { kind, fill }); L.name = name; L.start = s0; L.end = s1; if (kind === 'rect') L.shape.radius = L.shape.w * 0.12; p.layers.unshift(L); return L; };
      const img = p.layers[0]; img.start = 0; img.end = px(170);
      mk('rect', 'Rounded Rectangle 1', '#df4f96', px(-15.4), 10); mk('ellipse', 'Circle 1', '#7a40e0', px(-70), 10);
      mk('polygon', 'Polygon 1', '#ee82e8', px(180), 10); mk('star', 'Star 1', '#8d8a78', px(84.5), 10); mk('arrow', 'Arrow 1', '#d9b36c', px(84.5), 10);
      a.S.sel = null; a.S.multi.clear(); a.S.tab = null; a.S.autoFit = false; a.S.pps = K; a.S.t = T; a.commit(); a.seek(T);
      const tl = document.getElementById('tlScroll'); tl.scrollTop = 29; })()"""); pg.wait_for_timeout(300)
    shot('timeline-layers', 500)
    # ⧉ copy menu with nothing selected and an empty clipboard (only Select All Layers is active, as in reference/16)
    P("localStorage.removeItem('kntc.clipboard')")
    pg.click('[data-testid=copy-layer]'); shot('copy-menu', 400)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    b.close()
    print('page errors:', errs)

if os.path.isdir(REF):
    from PIL import Image
    os.makedirs(f'{OUT}/compare', exist_ok=True)
    for ours, ref in PAIRS:
        rp = f'{REF}/{ref}.jpg'
        if not os.path.exists(rp) or not os.path.exists(f'{OUT}/{ours}.png'): continue
        a = Image.open(rp).convert('RGB').resize((471, 1024)); o = Image.open(f'{OUT}/{ours}.png').convert('RGB').resize((471, 1024))
        c = Image.new('RGB', (950, 1024), 'white'); c.paste(a, (0, 0)); c.paste(o, (479, 0)); c.save(f'{OUT}/compare/{ours}.png')
        print('wrote', f'{OUT}/compare/{ours}.png')
