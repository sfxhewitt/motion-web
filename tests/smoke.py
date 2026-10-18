from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
    for name, ctx in [('desktop', dict(viewport={'width':1440,'height':900})), ('iphone', dict(**p.devices['iPhone 15 Pro Max']))]:
        c = b.new_context(**ctx); pg = c.new_page(); errs=[]
        pg.on('console', lambda m: errs.append(m.type+': '+m.text) if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERR '+str(e)))
        pg.goto('http://localhost:8765/'); pg.wait_for_timeout(1500)
        pg.evaluate('__app.seek(2)'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'/tmp/smoke-{name}.png')
        print(name, errs[:10], pg.evaluate('__app.renderer.errors'))
    b.close()
