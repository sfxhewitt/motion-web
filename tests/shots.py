"""Phone-sized (390x844) screenshots of home, editor, add menu and property panel -> /workspace/kntc-shots."""
import os
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8765/'); OUT = '/workspace/kntc-shots'
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True).new_page()
    pg.goto(BASE); pg.wait_for_function('window.__app && __app.project'); pg.evaluate('localStorage.clear()'); pg.reload()
    pg.wait_for_selector('[data-testid=home-open]')
    pg.evaluate("(() => { const a = __app; a.project.name = 'Birthday intro'; a.commit(); a.showHome(); })()"); pg.wait_for_timeout(300)
    pg.evaluate("(() => { const a = __app; const p = a.demoProject('9:16'); p.name = 'Neon Demo'; a.setProject(p); a.showHome(); })()"); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{OUT}/home.png')
    pg.click('[data-testid=home-open] >> nth=0'); pg.wait_for_timeout(300)
    pg.evaluate("__app.S.tab = null; __app.seek(1.6); __app.refreshAll()"); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/editor.png')
    pg.click('[data-testid=tab-add]'); pg.wait_for_timeout(300); pg.screenshot(path=f'{OUT}/add-menu.png')
    pg.evaluate("(() => { const a = __app; a.S.sel = a.project.layers[2].id; a.S.tab = 'layer'; a.refreshAll(); })()"); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/property-panel.png')
    pg.evaluate("(() => { const a = __app; a.S.tab = 'style'; a.refreshAll(); })()"); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/property-color-fill.png')
    b.close()
