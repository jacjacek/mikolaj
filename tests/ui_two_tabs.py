"""Two-tab UX regression checks against a real deployed site.
Only an isolated browser's fictional demo data are changed; never real family data.
Requires existing Chromium and Python websockets, no local app server or build.
"""
import json, os, subprocess, tempfile, time, sys
from pathlib import Path
from cdp_browser import Browser

out = Path(os.environ['MIKOLAJ_QA_OUTPUT']) if os.environ.get('MIKOLAJ_QA_OUTPUT') else Path(tempfile.mkdtemp(prefix='mikolaj-two-tabs-',dir=os.environ.get('TMPDIR')))
out.mkdir(parents=True, exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix='chromium-',dir=out))
log = (out/'chromium.log').open('w')
proc = subprocess.Popen([
    os.environ['CHROMIUM_EXECUTABLE'], '--headless=new', '--no-sandbox',
    '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--disable-background-networking', '--remote-debugging-port=0',
    '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    '--user-data-dir='+str(profile), 'about:blank',
],stdout=log,stderr=log,env={**os.environ,'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/dbus/system_bus_socket'})
checks=[]
try:
    portfile=profile/'DevToolsActivePort'
    for _ in range(600):
        if portfile.exists():break
        if proc.poll() is not None:raise RuntimeError('Chromium exited')
        time.sleep(.1)
    port,route=portfile.read_text().splitlines()[:2]
    b=Browser.from_endpoint(f'ws://127.0.0.1:{port}{route}')
    base=sys.argv[1].rstrip('/') if len(sys.argv)>1 else 'https://mikolaj-preview.jac3k.workers.dev'
    b.page(base+'/?qa=two-tabs')
    b.viewport(390,844)
    b.call('Page.enable');b.call('Runtime.enable');b.call('Network.enable')
    b.call('Network.setCacheDisabled',cacheDisabled=True)
    b.call('Page.addScriptToEvaluateOnNewDocument',runImmediately=True,source="window.__qaErrors=[];addEventListener('error',e=>__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>__qaErrors.push(String(e.reason)));addEventListener('securitypolicyviolation',e=>__qaErrors.push('CSP '+e.violatedDirective));")
    def wait(expr):
        for _ in range(250):
            if b.js(expr):return
            time.sleep(.1)
        print('WAIT',b.js("({title:document.title,text:document.body.innerText.slice(0,1500)})"),flush=True)
        raise AssertionError('Timeout: '+expr)
    def act(expr):
        b.js(expr+';true');time.sleep(.15)
    def check(name,expr):
        value=b.js(expr)
        checks.append({'check':name,'passed':value is True,'value':value})
        (out/'results.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
        print(('PASS ' if value is True else 'FAIL ')+name,flush=True)
    def lists():
        act("document.querySelector('[data-nav=home]').click()")
        wait("document.querySelectorAll('.person-fold').length===4")
    def mine():
        act("document.querySelector('[data-nav=mine]').click()")
        wait("!!document.querySelector('#my-list') && !!document.querySelector('#my-reservations')")
    def person(name):
        act("document.querySelector('#demo-as').value='demo-"+name+"';document.querySelector('#demo-as').dispatchEvent(new Event('change',{bubbles:true}))")
        wait("document.querySelectorAll('.person-fold').length===4")
    def local_fixture(code):
        b.js("(async()=>{const {demoRequest:r}=await import('/demo.js');"+code+";return true})()")
    def open_person(name):
        act("document.querySelector('[data-person-id=demo-"+name+"] > summary').click()")
        wait("document.querySelector('[data-person-id=demo-"+name+"] .wishes-slot')!==null")
    wait("document.querySelectorAll('.person-fold').length===4")
    check('exactly two primary tabs named Listy and Moje',"[...document.querySelectorAll('.nav a')].map(e=>e.textContent.trim()).join('|')==='Listy|Moje'")
    check('all people initially collapsed and no unnecessary onboarding',"document.querySelectorAll('.person-fold[open]').length===0 && !document.querySelector('.setup-prompt')")
    check('family rows visible in first mobile viewport',"[...document.querySelectorAll('.person-fold > summary')].every(e=>e.getBoundingClientRect().bottom<760)")
    b.screenshot(str(out/'listy-mobile.png'))
    open_person('bartek');open_person('marta')
    check('people open independently without routing',"document.querySelectorAll('.person-fold[open]').length===2 && (!location.hash || location.hash==='#/')")
    check('optional row sections never render null placeholder text',"[...document.querySelectorAll('.person-fold[open] .person-fold__body')].every(e=>[...e.childNodes].every(n=>n.nodeType!==3 || !n.textContent.trim()))")
    check('gift details initially collapsed with visible price and status',"[...document.querySelectorAll('.person-fold[open] .wish')].every(e=>!e.open) && document.querySelector('[data-wish-id=demo-w-07] > summary').textContent.includes('120')")
    act("document.querySelector('[data-wish-id=demo-w-07] > summary').click()")
    check('opening gift reveals details while person remains open',"document.querySelector('[data-wish-id=demo-w-07]').open && document.querySelector('[data-person-id=demo-bartek]').open && document.querySelector('[data-wish-id=demo-w-07] .wish__note').getBoundingClientRect().height>0")
    act("document.querySelector('[data-fkey=res-demo-w-07]').click()")
    wait("!!document.querySelector('[data-fkey=buy-demo-w-07]')")
    check('reserve preserves both levels and other expanded people',"document.querySelector('[data-wish-id=demo-w-07]').open && document.querySelector('[data-person-id=demo-bartek]').open && document.querySelector('[data-person-id=demo-marta]').open")
    b.screenshot(str(out/'listy-expanded-mobile.png'))
    act("document.querySelector('[data-fkey=buy-demo-w-07]').click()")
    wait("document.querySelector('[data-fkey=buy-demo-w-07]')?.getAttribute('aria-pressed')==='true'")
    check('purchase state shown on collapsed gift summary',"document.querySelector('[data-wish-id=demo-w-07] > summary').textContent.includes('Kupione')")
    mine()
    check('one Moje page combines own list and reservations',"document.querySelector('h1').textContent==='Moje' && document.querySelectorAll('h1').length===1 && !!document.querySelector('#my-list .letter') && !!document.querySelector('#my-reservations [data-wish-id=demo-w-07]')")
    check('combined page does not leak incoming reservations on own wishes',"!document.querySelector('#my-list [data-fkey^=buy-],#my-list [data-fkey^=res-],#my-list [data-fkey^=cancel-]') && !document.querySelector('#my-list .wish__summary .tag')")
    act("document.querySelector('[data-fkey=jump-reservations]').click()")
    check('reservation shortcut focuses the correct section',"document.activeElement.id==='my-reservations-h'")
    act("document.querySelector('#my-list [data-fkey=letter-edit]').click();document.querySelector('#letter-input').value='Niezapisany tekst — dwie zakładki';document.querySelector('#letter-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-nav=home]').click()")
    wait("!!document.querySelector('dialog[open]')")
    act("[...document.querySelectorAll('dialog[open] button')].find(e=>e.textContent==='Anuluj').click()")
    check('switching tabs protects an unsaved letter',"location.hash==='#/moje' && document.querySelector('#letter-input').value==='Niezapisany tekst — dwie zakładki'")
    act("[...document.querySelectorAll('.letter__form button')].find(e=>e.textContent==='Anuluj').click()")
    act("document.querySelector('[data-fkey=cancel-demo-w-07]').click()")
    check('bought reservation cancellation still requires confirmation',"!!document.querySelector('dialog[open]') && document.querySelector('dialog[open]').textContent.includes('kupione')")
    act("document.querySelector('dialog[open] .btn--danger').click()")
    wait("!document.querySelector('dialog[open]')")
    check('confirmed release updates combined reservations section',"!document.querySelector('#my-reservations [data-wish-id=demo-w-07]')")
    check('snapshot warning survives combined layout',"!!document.querySelector('#my-reservations .inline-note') && [...document.querySelectorAll('#my-reservations .wish')].some(e=>e.textContent.includes('179'))")
    local_fixture("await r('PATCH','/api/letter',{letter:''})")
    lists()
    check('missing-letter prompt links to Moje',"document.querySelector('.setup-prompt').textContent.includes('Napisz list') && document.querySelector('.setup-prompt a').getAttribute('href')==='#/moje'")
    local_fixture("const own=await r('GET','/api/members/demo-ania/wishes');for(const w of own.wishes)await r('DELETE','/api/wishes/'+w.id);const rs=await r('GET','/api/reservations');for(const w of rs.wishes)await r('DELETE','/api/wishes/'+w.id+'/reserve')")
    mine();lists()
    check('both missing prompt has explicit combined CTA',"document.querySelector('.setup-prompt').textContent.includes('Uzupełnij moje')")
    act("document.querySelector('.setup-prompt a').click()")
    wait("!!document.querySelector('[data-empty=my-wishes]')")
    check('empty own wishes, letter and reservations each offer CTA',"!!document.querySelector('[data-empty=my-wishes] button') && !!document.querySelector('.letter [data-fkey=letter-edit]') && !!document.querySelector('[data-empty=reservations] a[href=\"#/\"]')")
    act("document.querySelector('[data-fkey=letter-edit]').click();document.querySelector('#letter-input').value='Lubię książki i spacery.';document.querySelector('#letter-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.letter__form').requestSubmit()")
    wait("!document.querySelector('#letter-input')")
    lists()
    check('only missing wishes produces relevant prompt',"document.querySelector('.setup-prompt').textContent.includes('Dodaj pierwsze życzenie') && !document.querySelector('.setup-prompt').textContent.includes('Napisz list')")
    mine()
    act("document.querySelector('[data-fkey=empty-add-wish]').focus();document.querySelector('[data-fkey=empty-add-wish]').click()")
    b.call('Input.dispatchKeyEvent',type='keyDown',key='Escape',code='Escape',windowsVirtualKeyCode=27)
    b.call('Input.dispatchKeyEvent',type='keyUp',key='Escape',code='Escape',windowsVirtualKeyCode=27)
    time.sleep(.1)
    check('empty-state dialog Escape restores CTA focus',"!document.querySelector('dialog[open]') && document.activeElement.dataset.fkey==='empty-add-wish'")
    act("document.querySelector('[data-fkey=empty-add-wish]').click();document.querySelector('dialog input[name=title]').value='Szalik — nowy UX';document.querySelector('dialog textarea[name=note]').value='<script>zwykły tekst</script>';document.querySelector('dialog input[name=price]').value='159,90';document.querySelector('dialog form').requestSubmit()")
    wait("!document.querySelector('dialog[open]')")
    check('empty-state add creates wish with literal note and Polish price',"document.querySelector('#my-list .wish').textContent.includes('159,90') && document.querySelector('#my-list .wish').textContent.includes('<script>zwykły tekst</script>') && !document.querySelector('main script')")
    b.js('window.__beforeReload=true');b.call('Page.reload')
    wait("!window.__beforeReload && !!document.querySelector('#my-list .wish')")
    check('new document preserves actual local changes',"document.querySelector('#my-list .wish').textContent.includes('Szalik — nowy UX') && document.querySelector('.letter__text').textContent==='Lubię książki i spacery.'")
    lists()
    check('completed own list removes onboarding prompt',"!document.querySelector('.setup-prompt')")
    person('bartek')
    local_fixture("const own=await r('GET','/api/members/demo-bartek/wishes');for(const w of own.wishes)await r('DELETE','/api/wishes/'+w.id);await r('PATCH','/api/letter',{letter:''})")
    person('ania')
    if not b.js("document.querySelector('[data-person-id=demo-bartek]').open"):open_person('bartek')
    wait("!!document.querySelector('[data-person-id=demo-bartek] .empty')")
    check('empty other-person list offers non-editing CTA',"document.querySelector('[data-person-id=demo-bartek] .empty').textContent.includes('Zobacz pozostałe listy') && !document.querySelector('[data-person-id=demo-bartek] [data-fkey^=edit-]')")
    act("document.querySelector('[data-person-id=demo-bartek] .empty button').click()")
    check('other empty-list CTA returns focus to the person row',"!document.querySelector('[data-person-id=demo-bartek]').open && document.activeElement.dataset.fkey==='person-demo-bartek'")
    act("location.hash='#/rezerwacje'")
    wait("location.hash==='#/moje' && !!document.querySelector('#my-reservations')")
    check('old reservations link resolves to combined Moje',"document.querySelector('h1').textContent==='Moje' && document.querySelector('.nav [aria-current=page]').dataset.nav==='mine'")
    check('demo makes no private API requests',"!performance.getEntriesByType('resource').some(e=>e.name.includes('/api/'))")
    check('no collected runtime errors or CSP violations',"Array.isArray(window.__qaErrors) && __qaErrors.length===0")
    act("document.querySelector('.demo__toggle').click();document.querySelector('.demo__panel button').click();document.querySelector('dialog[open] .btn--danger').click()")
    wait("document.querySelectorAll('.person-fold').length===4 && document.querySelector('#demo-as').value==='demo-ania'")
    check('confirmed reset restores sample and collapses all people',"[...document.querySelectorAll('.person-fold__count')].reduce((s,e)=>s+parseInt(e.textContent,10),0)===15 && document.querySelectorAll('.person-fold[open]').length===0")
    b.viewport(320,740)
    check('320px collapsed layout and two-tab bar fit',"innerWidth===320 && document.documentElement.scrollWidth<=innerWidth")
    open_person('bartek')
    check('320px expanded people and gifts fit',"document.documentElement.scrollWidth<=innerWidth")
    b.viewport(390,844);b.screenshot(str(out/'final-expanded-mobile.png'))
    b.viewport(1440,1000,False)
    check('desktop layout and two-tab navigation fit',"document.documentElement.scrollWidth<=innerWidth && document.querySelector('.nav').getBoundingClientRect().top<100")
    b.screenshot(str(out/'final-desktop.png'))
    mine();b.viewport(390,844);b.screenshot(str(out/'moje-mobile.png'))
    print('SUMMARY',json.dumps({'passed':sum(c['passed'] for c in checks),'total':len(checks),'allPassed':all(c['passed'] for c in checks)}),flush=True)
    if not all(c['passed'] for c in checks):sys.exit(1)
finally:
    proc.terminate()
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:proc.kill();proc.wait()
    log.close()
