from playwright.sync_api import sync_playwright
import pathlib
svg = pathlib.Path('/workspace/alight-web/icons/icon.svg').read_text()
with sync_playwright() as p:
    b = p.chromium.launch()
    for size, name in [(192,'icon-192.png'),(512,'icon-512.png'),(180,'apple-touch-icon.png')]:
        pg = b.new_page(viewport={'width':size,'height':size})
        pg.set_content(f'<html><body style="margin:0">{svg.replace("<svg ", f"<svg width=\"{size}\" height=\"{size}\" ",1)}</body></html>')
        pg.screenshot(path=f'/workspace/alight-web/icons/{name}')
    b.close()
