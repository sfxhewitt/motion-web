"""Before / after renders of effects on their sample scenes -> /workspace/kntc-shots/effects/ba-<id>.png
usage: python3 tests/fx_shots.py [ids...]   (default: the key effects list)"""
import base64, os, sys
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8765/')
OUT = os.environ.get('OUT', '/workspace/kntc-shots/effects')
KEY = ['gaussblur', 'glow', 'lightglow', 'chromakey', 'exposure', 'tiles', 'reorient360', 'starprism', 'cube', 'rextrude', 'pagecurl', 'lensflare',
       'longshadow', 'rgbsplit', 'cmykhalftone', 'kaleido', 'wavewarp', 'swirl', 'zoomblur', 'lensblur', 'glass', 'voronoi', 'clouds', 'radialrepeat',
       'texttransform', 'strokecolor', 'bevel', 'electricedges', 'vignette', 'dissolve', 'motionblur', 'echo', 'gradmap', 'spherize', 'tunnel', 'lightning']
ids = sys.argv[1:] or KEY
JS = r"""async ({ ids, size }) => {
  const { sampleProject, SAMPLE_T } = await import('../js/fxsample.js');
  const { Renderer } = await import('../js/render.js'); const { EFFECTS } = await import('../js/effects.js');
  const R = new Renderer(), cv = document.createElement('canvas'); cv.width = cv.height = size; const out = {};
  for (const id of ids) {
    const o = document.createElement('canvas'); o.width = size * 2 + 12; o.height = size + 40; const g = o.getContext('2d');
    g.fillStyle = '#191b27'; g.fillRect(0, 0, o.width, o.height);
    [false, true].forEach((fx, i) => { const { project } = sampleProject(id, { fx, size: 540 }); R.render(project, SAMPLE_T, cv); g.drawImage(cv, i * (size + 12), 40); });
    g.fillStyle = '#fff'; g.font = '600 20px system-ui'; g.fillText('Before', 8, 27); g.fillText(EFFECTS[id].name + ' (default settings)', size + 20, 27);
    out[id] = o.toDataURL('image/png');
  }
  return { out, errs: [...R.errors, ...R.fx.errors] };
}"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(service_workers='block'); pg.goto(BASE + 'tests/blank.html')
    r = pg.evaluate(JS, {'ids': ids, 'size': 480})
    b.close()
os.makedirs(OUT, exist_ok=True)
for k, v in r['out'].items():
    with open(os.path.join(OUT, f'ba-{k}.png'), 'wb') as f: f.write(base64.b64decode(v.split(',', 1)[1]))
print(len(r['out']), 'before/after shots ->', OUT, 'errors:', r['errs'][:5])
