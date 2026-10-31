"""Home tabs (Your Templates, Elements, Cloud backup), Tutorials, Templates browse, Create > Element and the Account sheet:
everything that used to toast "coming soon". Desktop Chromium; run with the static server on :8765."""
import os, sys, json
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:8765/')
SHOTS = os.environ.get('SHOTS', '/workspace/alight-web/screenshots')
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail) if detail and not cond else ''), flush=True)

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width': 440, 'height': 956}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept())
    pg.goto(BASE); pg.wait_for_function('window.__app && __app.project')
    pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_function('window.__app && __app.project')
    E = lambda js, arg=None: pg.evaluate(js, arg)
    toasts = lambda: E("[...document.querySelectorAll('.toast')].map(t => t.textContent).join('|')")
    check('nothing on Home says coming soon any more', 'coming soon' not in open('js/main.js').read() and 'data-soon' not in open('index.html').read())

    # --- Your Templates: starter grid, Use makes a project; Save as template from the project ⋯ menu ---
    pg.click('[data-testid=pill-templates]'); pg.wait_for_timeout(150)
    n = pg.locator('[data-testid=tpl-grid] .tcard').count()
    check('Your Templates tab: 5 starter templates with thumbnails, empty "your templates" note', n == 5 and pg.locator('.h-note').count() == 1 and E("document.querySelector('#homeHead').textContent") == 'Templates', n)
    pg.screenshot(path=f'{SHOTS}/iphone-19-templates.png')
    pg.click('[data-testid=tpl-lower3]'); pg.wait_for_timeout(200)
    pr = E("({ name: __app.project.name, layers: __app.project.layers.map(l => l.name), keys: Object.keys(__app.project.layers[2].keys), home: document.querySelector('#home').hidden })")
    check('Use starter template: new project from it opens in the editor with animated layers', pr['name'] == 'Lower Third' and pr['layers'] == ['Name', 'Role', 'Bar'] and 'x' in pr['keys'] and pr['home'], pr)
    E("__app.showHome()"); pg.click('[data-testid=pill-projects]'); pg.wait_for_timeout(100)
    pg.click('[data-testid=home-more] >> nth=0'); pg.click('[data-testid=home-template]'); pg.wait_for_timeout(150)
    tp = E("({ tab: document.querySelector('.h-pills .on').dataset.tab, cards: [...document.querySelectorAll('.pcard')].map(c => c.querySelector('[data-testid=home-name]').textContent), idx: __app.store.listProjects().map(x => x.kind || 'project') })")
    check('Save as template: a TEMPLATE copy shows under Your Templates, kept out of the Projects list', tp['tab'] == 'templates' and tp['cards'] == ['Lower ThirdTEMPLATE'] and tp['idx'].count('template') == 1, tp)
    pg.click('[data-testid=home-more] >> nth=0'); pg.click('[data-testid=home-use]'); pg.wait_for_timeout(200)
    check('Use your template: a fresh project named after it', E("({ n: __app.project.name, k: __app.project.kind || null })") == {'n': 'Lower Third 2', 'k': None})
    E("__app.showHome()")

    # --- + sheet › Template › View All inserts a starter template's layers into the open project ---
    pg.click('[data-testid=home-open] >> nth=0'); pg.wait_for_timeout(200)
    before = E("__app.project.layers.length")
    E("__app.openSheet('template')"); pg.click('[data-testid=tpl-all]'); pg.wait_for_timeout(150)
    check('View All opens the Templates dialog with starters and your templates', pg.locator('[data-testid=templates] .tcard').count() == 6)
    pg.click('[data-testid=templates] [data-testid=tpl-countdown]'); pg.wait_for_timeout(150)
    check('inserting a starter adds its layers at the playhead', E("__app.project.layers.length") == before + 5 and 'Added Countdown' in toasts())
    E("__app.showHome()")

    # --- Create › Element: transparent element project, listed under Elements, placeable from + › Object ---
    pg.click('[data-testid=home-new]'); pg.wait_for_timeout(350); pg.click('[data-testid=create-seg-element]'); pg.wait_for_timeout(50)
    cr = E("({ name: document.querySelector('[data-testid=create-name]').value, go: document.querySelector('[data-testid=create-go]').textContent, bgHidden: document.querySelector('[data-testid=create-bg]').closest('.cr-row').hidden })")
    check('Create › Element: auto-named, no background row, Create element button', cr == {'name': 'Element 1', 'go': 'Create element', 'bgHidden': True}, cr)
    pg.click('[data-testid=create-go]'); pg.wait_for_timeout(200)
    el = E("({ kind: __app.project.kind, bg: __app.project.bg, last: localStorage.getItem('kntc.last') === __app.project.id })")
    check('element project is transparent and never becomes the last-opened project', el == {'kind': 'element', 'bg': 'transparent', 'last': False}, el)
    E("__app.addLayer(__app.makeLayer(__app.project, 'shape', { kind: 'star' })); __app.showHome()"); pg.click('[data-testid=pill-elements]'); pg.wait_for_timeout(150)
    ev = E("[...document.querySelectorAll('.pcard [data-testid=home-name]')].map(e => e.textContent)")
    check('Elements tab lists element projects with an ELEMENT badge', ev == ['Element 1ELEMENT'], ev)
    pg.screenshot(path=f'{SHOTS}/iphone-20-elements.png')
    pg.click('[data-testid=pill-projects]'); pg.click('[data-testid=home-open] >> nth=0'); pg.wait_for_timeout(200)
    E("__app.openSheet('object')"); pg.click('[data-testid=add-element]'); pg.wait_for_timeout(150)
    ok = pg.locator('[data-testid=elements] [data-testid^=comp-]').count()
    pg.click('[data-testid=elements] [data-testid^=comp-] >> nth=0'); pg.wait_for_timeout(300)
    check('+ › Object › Element lists the element project first and places it as a nested layer', ok >= 1 and E("__app.project.layers[0].type") == 'comp' and E("__app.project.layers[0].name") == 'Element 1')
    E("__app.showHome()")

    # --- Tutorials: lessons with steps, Try it opens a project ---
    pg.click('[data-testid=nav-tutorials]'); pg.wait_for_timeout(150)
    tt = E("({ head: document.querySelector('#homeHead').textContent, n: document.querySelectorAll('.tut').length, pills: document.querySelector('.h-pills').hidden, on: document.querySelector('.h-nav .on').dataset.nav })")
    check('Tutorials: 6 lessons, pills hidden, nav highlighted', tt == {'head': 'Tutorials', 'n': 6, 'pills': True, 'on': 'tutorials'}, tt)
    pg.click('[data-testid=tut-keyframes] summary'); pg.wait_for_timeout(100)
    pg.screenshot(path=f'{SHOTS}/iphone-21-tutorials.png')
    pg.click('[data-testid=tut-try-keyframes]'); pg.wait_for_timeout(200)
    check('Try it opens the lesson project in the editor', E("__app.project.name") == 'Animate with keyframes' and E("document.querySelector('#home').hidden"))
    E("__app.showHome()")
    pg.click('[data-testid=nav-templates]'); pg.wait_for_timeout(100)
    check('bottom bar Templates opens the templates tab', E("document.querySelector('.h-pills .on').dataset.tab") == 'templates')

    # --- Cloud: back up everything to one file, restore it ---
    pg.click('[data-testid=pill-cloud]'); pg.wait_for_timeout(100)
    with pg.expect_download() as dl: pg.click('[data-testid=cloud-backup]')
    path = dl.value.path(); bk = json.load(open(path))
    kinds = sorted(p.get('kind', 'project') for p in bk['projects'])
    check('Back up downloads every project (projects, template, element) in one file', bk['backup'] == 1 and len(bk['projects']) >= 5 and 'template' in kinds and 'element' in kinds and bk['elements'] == [], kinds)
    pg.wait_for_timeout(100)
    check('last backup time is shown', 'Last backup' in E("document.querySelector('[data-testid=cloud-last]').textContent"))
    pg.screenshot(path=f'{SHOTS}/iphone-22-cloud.png')
    E("localStorage.clear(); __app.setHomeTab('projects')"); pg.wait_for_timeout(100)
    before = pg.locator('.pcard').count()
    pg.click('[data-testid=pill-cloud]'); pg.wait_for_timeout(50)
    with pg.expect_file_chooser() as fc: pg.click('[data-testid=cloud-restore]')
    fc.value.set_files(path); pg.wait_for_timeout(600)
    after = E("__app.store.listProjects().length")
    check('Restore brings every project back', before <= 1 and after == len(bk['projects']) and 'Restored' in toasts(), (before, after))

    # --- Account sheet: name -> avatar initials, stats, backup / reset entries ---
    pg.click('[data-testid=home-account]'); pg.wait_for_timeout(150)
    pg.fill('[data-testid=account-name]', 'Daniel Hewitt'); pg.press('[data-testid=account-name]', 'Tab'); pg.wait_for_timeout(50)
    ac = E("({ av: document.querySelector('#homeAvatar').textContent, projects: document.querySelector('[data-testid=account-projects] b').textContent, has: ['account-backup', 'account-reset'].every(t => document.querySelector('[data-testid=' + t + ']')) })")
    check('Account: name gives the avatar initials, project count, backup and erase actions', ac['av'] == 'DH' and int(ac['projects']) >= 3 and ac['has'], ac)
    pg.screenshot(path=f'{SHOTS}/iphone-23-account.png')
    pg.click('[data-testid=dlg-close]')
    pg.reload(); pg.wait_for_function('window.__app && __app.project'); pg.wait_for_timeout(100)
    check('profile survives a reload', E("document.querySelector('#homeAvatar').textContent") == 'DH')

    # --- audio tiles: no "coming soon" ---
    pg.click('[data-testid=home-open] >> nth=0'); pg.wait_for_timeout(200)
    E("__app.addLayer(__app.makeLayer(__app.project, 'audio', { mediaId: 'none', name: 'Beat', mediaDuration: 2 }))"); pg.wait_for_timeout(50)
    pg.click('[data-testid=tab-style]'); pg.wait_for_timeout(50)
    check('audio layer: Color & Fill explains itself instead of coming soon', 'Not available for audio layers' in toasts())

    check('no page errors', not errs, errs[:3])
    b.close()

fails = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
if fails: print('FAILED:', *fails, sep='\n  '); sys.exit(1)
