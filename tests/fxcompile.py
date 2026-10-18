"""Compiles every effect shader in headless Chromium and reports GLSL errors."""
import os, sys, json
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8765/')
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(); pg.goto(BASE + 'tests/blank.html')
    r = pg.evaluate("""async () => { const m = await import('/js/fx/index.js'); const e = new m.FXEngine(); const bad = {};
      for (const k of Object.keys(m.SHADERS)) { try { e.prog(k); } catch (x) { bad[k] = String(x).slice(0, 600); } }
      return { n: Object.keys(m.SHADERS).length, fx: Object.keys(m.EFFECTS).length, bad }; }""")
    print(r['n'], 'shaders,', r['fx'], 'effects')
    for k, v in r['bad'].items(): print('BAD', k, v)
    sys.exit(1 if r['bad'] else 0)
