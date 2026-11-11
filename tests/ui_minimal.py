import json, subprocess, tempfile, time, sys, os
from pathlib import Path
from cdp_browser import Browser

scratch = Path(os.environ['MIKOLAJ_QA_OUTPUT']) if os.environ.get('MIKOLAJ_QA_OUTPUT') else Path(tempfile.mkdtemp(prefix='mikolaj-ux-report-', dir=os.environ.get('TMPDIR')))
scratch.mkdir(parents=True, exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix='mikolaj-qa-chrome-', dir=scratch))
log = (scratch / 'mikolaj-qa-chrome.log').open('w')
proc = subprocess.Popen([
    os.environ['CHROMIUM_EXECUTABLE'],
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-extensions', '--no-first-run', '--disable-background-networking',
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + str(profile), 'about:blank',
], stdout=log, stderr=log, env={**__import__('os').environ, 'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/run/dbus/system_bus_socket'})
checks = []
output = scratch / 'mikolaj-minimal-final-qa.json'
try:
    portfile = profile / 'DevToolsActivePort'
    for _ in range(600):
        if portfile.exists(): break
        if proc.poll() is not None: raise RuntimeError('QA Chromium exited: ' + str(proc.returncode))
        time.sleep(.1)
    port, route = portfile.read_text().splitlines()[:2]
    b = Browser.from_endpoint(f'ws://127.0.0.1:{port}{route}')
    base_url = sys.argv[1].rstrip('/') if len(sys.argv)>1 else 'https://mikolaj-preview.jac3k.workers.dev'
    b.page(base_url + '/?qa=clean-final')
    b.viewport(390,844)
    b.call('Page.enable')
    b.call('Runtime.enable')
    b.call('Page.addScriptToEvaluateOnNewDocument', runImmediately=True, source="window.__qaErrors=[];addEventListener('error',e=>__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>__qaErrors.push(String(e.reason)));addEventListener('securitypolicyviolation',e=>__qaErrors.push('CSP '+e.violatedDirective+' '+e.blockedURI));")
    b.call('Network.enable')
    b.call('Network.setCacheDisabled', cacheDisabled=True)
    def wait(expr):
        for _ in range(60):
            if b.js(expr): return
            time.sleep(.1)
        raise AssertionError('Timed out waiting: ' + expr)
    def act(expr):
        b.js(expr + ';true')
        time.sleep(.15)
    def check(name, expr):
        value = b.js(expr)
        checks.append({'check':name, 'passed':value is True, 'value':value})
        output.write_text(json.dumps(checks,ensure_ascii=False,indent=2))
        print(('PASS ' if value is True else 'FAIL ') + name,flush=True)
        if value is not True: print('DETAIL',repr(value),flush=True)
    def person(name):
        act("document.querySelector('#demo-as').value='demo-"+name+"';document.querySelector('#demo-as').dispatchEvent(new Event('change',{bubbles:true}))")
        wait("!!document.querySelector('.people')")
    def member(name):
        act("document.querySelector('a.person[href=\"#/osoba/demo-"+name+"\"]').click()")
        wait("!!document.querySelector('.wishes-slot')")
    wait("document.querySelectorAll('.person').length===4")
    check('mobile family view opens without login and fits viewport', "innerWidth===390 && document.documentElement.scrollWidth<=innerWidth && !document.querySelector('input[type=password]')")
    check('family entries visible immediately', "document.querySelector('.person').getBoundingClientRect().top<300")
    act("document.querySelector('[data-fkey=home-add]').focus();document.querySelector('[data-fkey=home-add]').click()")
    b.call('Input.dispatchKeyEvent',type='keyDown',key='Escape',code='Escape',windowsVirtualKeyCode=27,nativeVirtualKeyCode=27)
    b.call('Input.dispatchKeyEvent',type='keyUp',key='Escape',code='Escape',windowsVirtualKeyCode=27,nativeVirtualKeyCode=27)
    time.sleep(.1)
    check('Escape closes dialog and restores add-button focus', "!document.querySelector('dialog[open]') && document.activeElement.dataset.fkey==='home-add'")
    act("document.querySelector('[data-fkey=home-add]').click();document.querySelector('dialog input[name=title]').value='Szalik — test UX';document.querySelector('dialog textarea[name=note]').value='Zielony. <script>zwykły tekst</script>';document.querySelector('dialog input[name=price]').value='159,90';document.querySelector('dialog form').requestSubmit()")
    wait("!document.querySelector('dialog[open]')")
    check('quick-add updates own family entry', "document.querySelector('.person--self .person__meta').textContent.includes('5 życzeń')")
    act("document.querySelector('[data-nav=mine]').click()")
    wait("!!document.querySelector('[data-fkey=letter-edit]')")
    b.js('window.__qaReloadMarker=true')
    b.call('Page.reload')
    wait("!window.__qaReloadMarker && document.readyState==='complete' && !!document.querySelector('[data-fkey=letter-edit]')")
    check('reload preserves price and safe literal user content', "[...document.querySelectorAll('.wish')].some(e=>e.textContent.includes('Szalik — test UX') && e.textContent.includes('159,90') && e.textContent.includes('<script>zwykły tekst</script>')) && !document.querySelector('main script')")
    check('author sees no reservation or purchase controls', "!document.querySelector('main [data-fkey^=buy-],main [data-fkey^=res-],main [data-fkey^=cancel-]')")
    act("document.querySelector('[data-fkey=letter-edit]').click();document.querySelector('#letter-input').value='Niezapisany list — test UX';document.querySelector('#letter-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#demo-as').value='demo-marta';document.querySelector('#demo-as').dispatchEvent(new Event('change',{bubbles:true}))")
    check('switching identity protects unsaved letter', "!!document.querySelector('dialog[open]') && document.querySelector('#demo-as').value==='demo-ania'")
    act("[...document.querySelectorAll('dialog[open] button')].find(e=>e.textContent==='Anuluj').click()")
    check('cancelling preserves the letter draft', "document.querySelector('#letter-input').value==='Niezapisany list — test UX'")
    act("document.querySelector('.letter__form').requestSubmit()")
    wait("!document.querySelector('#letter-input')")
    check('letter can be saved', "document.querySelector('.letter__text').textContent==='Niezapisany list — test UX'")
    person('bartek');member('ania')
    check('mobile letter disclosure prioritizes gifts', "!!document.querySelector('.letter--fold') && !document.querySelector('.letter--fold').open && document.querySelector('.wish').getBoundingClientRect().top<500")
    act("window.__expectedFree=document.querySelectorAll('.wish').length-document.querySelectorAll('.wish--taken').length;document.querySelector('[data-fkey=filter-free]').click()")
    check('available filter hides only gifts reserved by others', "document.querySelectorAll('.wish').length===__expectedFree && !document.querySelector('.wish--taken')")
    act("document.querySelector('.letter__summary').click()")
    act("window.__newId=document.querySelector('[data-fkey^=res-]').dataset.fkey.slice(4);document.querySelector('[data-fkey^=res-]').click()")
    wait("!!document.querySelector('[data-fkey=\"buy-'+__newId+'\"]')")
    check('new reservation remains visible under filter', "document.querySelectorAll('.wish').length===__expectedFree && !!document.querySelector('[data-fkey=\"buy-'+__newId+'\"]')")
    check('expanded letter survives reservation refresh', "document.querySelector('.letter--fold').open")
    act("document.querySelector('[data-fkey=\"buy-'+__newId+'\"]').click()")
    wait("document.querySelector('[data-fkey=\"buy-'+__newId+'\"]').getAttribute('aria-pressed')==='true'")
    check('purchased toggle updates accessible state', "document.querySelector('[data-fkey=\"buy-'+__newId+'\"]').getAttribute('aria-pressed')==='true'")
    act("document.querySelector('[data-nav=reservations]').click()")
    wait("document.querySelector('h1').textContent==='Moje prezenty'")
    check('gifts page preserves the purchased reservation', "document.querySelector('[data-fkey=\"buy-'+__newId+'\"]').getAttribute('aria-pressed')==='true'")
    act("document.querySelector('[data-fkey=\"cancel-'+__newId+'\"]').click()")
    check('cancelling a bought gift asks for confirmation', "!!document.querySelector('dialog[open]') && document.querySelector('dialog[open]').textContent.includes('jest oznaczone jako kupione')")
    act("[...document.querySelectorAll('dialog[open] button')].find(e=>e.textContent==='Anuluj').click()")
    check('cancelled confirmation preserves purchase', "document.querySelector('[data-fkey=\"buy-'+__newId+'\"]').getAttribute('aria-pressed')==='true'")
    act("document.querySelector('[data-fkey=\"cancel-'+__newId+'\"]').click();document.querySelector('dialog[open] .btn--danger').click()")
    wait("!document.querySelector('dialog[open]')")
    check('confirmed cancellation releases the gift', "!document.querySelector('[data-fkey=\"buy-'+__newId+'\"]')")
    person('ania')
    act("document.querySelector('[data-nav=reservations]').click()")
    wait("document.querySelector('h1').textContent==='Moje prezenty'")
    check('changed-gift warning and original purchase snapshot remain', "!!document.querySelector('.inline-note') && [...document.querySelectorAll('.wish')].some(e=>e.textContent.includes('179'))")
    check('demo never requests private API', "!performance.getEntriesByType('resource').some(e=>e.name.includes('/api/'))")
    print('BROWSER_ERRORS', b.js('JSON.stringify(window.__qaErrors)'),flush=True)
    check('no runtime or CSP errors after reload', "Array.isArray(window.__qaErrors) && __qaErrors.length===0")
    act("document.querySelector('.demo__toggle').click();document.querySelector('.demo__panel button').click()")
    check('demo reset is confirmed and explicitly excludes real data', "!!document.querySelector('dialog[open]') && document.querySelector('dialog[open]').textContent.includes('Prawdziwych danych rodziny to nie dotyczy')")
    act("document.querySelector('dialog[open] .btn--danger').click()")
    wait("document.querySelectorAll('.person').length===4")
    check('reset restores known 15-wish sample', "[...document.querySelectorAll('.person__meta')].reduce((n,e)=>n+parseInt(e.textContent,10),0)===15 && document.querySelector('#demo-as').value==='demo-ania'")
    b.viewport(320,740)
    check('320px layout has no horizontal overflow', "innerWidth===320 && document.documentElement.scrollWidth<=innerWidth")
    b.viewport(390,844)
    b.screenshot(str(scratch/'mikolaj-minimal-mobile.png'))
    person('bartek');member('ania')
    b.screenshot(str(scratch/'mikolaj-minimal-member.png'))
    act("document.querySelector('[data-nav=home]').click()")
    wait("document.querySelectorAll('.person').length===4")
    b.viewport(1440,1000,False)
    check('desktop family and navigation fit viewport', "document.documentElement.scrollWidth<=innerWidth && document.querySelector('.nav').getBoundingClientRect().top<100")
    b.screenshot(str(scratch/'mikolaj-minimal-desktop.png'))
    print('SUMMARY', json.dumps({'passed':sum(c['passed'] for c in checks),'total':len(checks),'allPassed':all(c['passed'] for c in checks),'results':str(output)}),flush=True)
    if not all(c['passed'] for c in checks):sys.exit(1)
finally:
    proc.terminate()
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:proc.kill();proc.wait()
    log.close()
