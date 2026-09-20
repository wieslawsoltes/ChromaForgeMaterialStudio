"""Offline browser checks for the static website and independent renderer example.
These checks do not navigate blocked network URLs or enable restricted GPU APIs.
Install Python Playwright separately and point CF_BROWSER at Chromium if needed.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64, json, os

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'dist/site'
QA = ROOT / 'docs/qa'
checks = []

def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append({'name': name, 'passed': True})
    print('PASS', name)

def inline_html(path, script):
    html = path.read_text()
    html = html.replace(f'<script type="module" src="./{script}"></script>',
                        '<script>' + (path.parent/script).read_text().replace('</script', '<\\/script') + '</script>')
    return html

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CF_BROWSER', '/usr/bin/chromium'),
                               headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1600, 'height': 1000}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    html = inline_html(SITE/'index.html', 'site.js')
    html = html.replace('<link rel="stylesheet" href="./site.css">', '<style>' + (SITE/'site.css').read_text() + '</style>')
    html = html.replace('src="./studio-preview.png"', 'src="data:image/png;base64,' + base64.b64encode((SITE/'studio-preview.png').read_bytes()).decode() + '"')
    page.set_content(html, wait_until='load', timeout=120000)
    page.wait_for_function('window.heroRenderer?.ready', timeout=60000)
    page.wait_for_timeout(400)
    check('website initializes an actual material renderer', page.evaluate('heroRenderer.frames>0'))
    mode = page.evaluate('heroRenderer.mode')
    check('desktop website has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    old_image = page.evaluate('heroRenderer.canvas.toDataURL()')
    page.locator('[data-material="teal"]').click()
    page.wait_for_timeout(300)
    check('material switcher exposes selected state', 'selected' in page.locator('[data-material="teal"]').get_attribute('class'))
    check('material switcher changes rendered pixels', page.evaluate('heroRenderer.canvas.toDataURL()') != old_image)
    initial_yaw = page.evaluate('heroRenderer.camera.yaw')
    box = page.locator('#hero-canvas').bounding_box()
    page.mouse.move(box['x']+box['width']*.5, box['y']+box['height']*.5)
    page.mouse.down()
    page.mouse.move(box['x']+box['width']*.6, box['y']+box['height']*.5, steps=4)
    page.mouse.up()
    page.wait_for_timeout(300)
    check('website preview supports real orbit interaction', page.evaluate('heroRenderer.camera.yaw') != initial_yaw)
    check('static studio links resolve within the site', page.locator('.nav .button').get_attribute('href') == './studio/')
    page.locator('[data-material="alloy"]').click()
    page.evaluate('heroRenderer.camera.yaw=.52;heroRenderer.invalidate()')
    page.wait_for_timeout(350)
    page.screenshot(path=str(QA/'site-desktop.png'), full_page=True)
    page.screenshot(path=str(QA/'site-hero.png'))
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(400)
    check('mobile website has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    check('mobile hero contains the complete interactive preview', page.evaluate("document.querySelector('.hero').getBoundingClientRect().bottom>=document.querySelector('.hero-render').getBoundingClientRect().bottom"))
    page.screenshot(path=str(QA/'site-mobile.png'), full_page=True)
    page.close()
    page = browser.new_page(viewport={'width':1280,'height':850}, device_scale_factor=1)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(inline_html(SITE/'examples/renderer.html', 'renderer.js'), wait_until='load')
    page.wait_for_function('window.exampleRenderer?.ready', timeout=60000)
    page.wait_for_timeout(250)
    check('independent renderer example initializes without the studio', page.evaluate('exampleRenderer.frames>0&&typeof chroma==="undefined"'))
    old_triangles = page.evaluate('exampleRenderer.mesh.triangleCount')
    page.locator('#model').select_option('cube')
    page.wait_for_timeout(250)
    check('example model selection replaces mesh geometry', page.evaluate('exampleRenderer.mesh.triangleCount') != old_triangles)
    old_image = page.evaluate('exampleRenderer.canvas.toDataURL()')
    page.locator('#material').select_option('teal')
    page.wait_for_timeout(250)
    check('example material selection changes rendered pixels', page.evaluate('exampleRenderer.canvas.toDataURL()') != old_image)
    page.locator('#wire').click()
    page.wait_for_timeout(250)
    check('example wireframe control changes rendering settings', page.evaluate('exampleRenderer.settings.wireframe===true'))
    page.screenshot(path=str(QA/'sdk-example.png'))
    check('website and SDK browser checks have no uncaught exceptions', not errors)
    (QA/'site-results.json').write_text(json.dumps({'mode':mode, 'loading':'offline set_content', 'checks':checks, 'errors':errors}, indent=2)+'\n')
    print(json.dumps({'checks':len(checks),'renderer':mode,'errors':errors},indent=2))
    browser.close()
