"""Local in-memory Chromium interaction tests. No competitor/live/native testing."""
from pathlib import Path
import json, os, re, time, traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=Path(os.environ.get('FORM_STUDY_HTML',str(ROOT/'FORM_FIRST_SESSION.html')))
OUT=ROOT/'evidence'; OUT.mkdir(exist_ok=True)
results=[]; errors=[]; requests=[]
def record(name,fn):
    try: fn(); results.append({'case':name,'status':'PASS'}); print('PASS',name,flush=True)
    except Exception as e: results.append({'case':name,'status':'FAIL','error':str(e)[:900]}); print('FAIL',name,str(e)[:140],flush=True)
def check(x,message='assertion failed'):
    if not x: raise AssertionError(message)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('FORM_CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    page.set_default_timeout(2500)
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.on('request',lambda r: requests.append(r.url))
    def reset(scenario='paid',width=390,height=844):
        page.set_viewport_size({'width':width,'height':height});page.set_content(HTML.read_text());page.wait_for_timeout(30)
        if scenario!='paid':page.locator(f'[data-scenario="{scenario}"]').click()
        if not page.locator('dialog[open]').count():page.locator('#auto').uncheck()
    def click(action):page.locator(f'[data-action="{action}"]').first.click()
    def screen():return page.locator('#screen').get_attribute('data-screen')
    def ready(): reset('ready')
    def completed():
        ready();click('next');click('process');click('complete');check(screen()=='result')
    def paid_path():
        reset();click('start');check(screen()=='photo');click('sample');click('next');check(page.locator('dialog[open]').count()==1)
        click('auth-ok');check(screen()=='review');click('next');check(page.locator('[data-action="consent-ok"]').is_disabled());page.locator('#demo-consent').check();click('consent-ok');click('next')
        page.locator('[data-action="buy"][data-units="5"]').click();check('Awaiting confirmation' in page.locator('dialog').inner_text());check('0 demo credits' in page.locator('#debug').inner_text())
        click('purchase-verify');check('Checking your purchase' in page.locator('dialog').inner_text());click('purchase-ok');check(screen()=='review');check('0 submitted' in page.locator('#debug').inner_text())
        click('next');check(screen()=='task');click('process');click('home');check(page.locator('.task-banner').count()==1);click('complete');check(screen()=='discover');click('open-result');check(screen()=='result')
    record('B01 complete paid-first illustrative journey; purchase never auto-submits',paid_path)
    def trial_path():
        reset('trial');click('start');click('sample');click('next');click('auth-ok');click('next');page.locator('#demo-consent').check();click('consent-ok');click('next');check('Try one example' in page.locator('dialog').inner_text());click('trial-ok');click('next');click('process');click('complete');click('refine');page.locator('[data-action="color"][data-field="wheel"][data-value="graphite"]').click();click('review');click('next');check(page.locator('dialog').inner_text().find('No subscription')>=0)
    record('B02 trial hypothesis ends at optional second-edit purchase',trial_path)
    def cancel_auth():
        reset();click('start');click('sample');click('next');click('close');check(screen()=='review');check(page.locator('[data-action="next"]').inner_text().find('Continue to your account')>=0)
    record('B03 cancelled login keeps source and intent',cancel_auth)
    def unchanged_preview():
        completed();click('refine');before=page.locator('.car-art').first.get_attribute('aria-label');page.locator('[data-action="color"][data-field="wheel"][data-value="graphite"]').click();after=page.locator('.car-art').first.get_attribute('aria-label');check(before==after);check('1 submitted' in page.locator('#debug').inner_text())
    record('B04 swatches do not repaint base or call generation',unchanged_preview)
    def blocked_no_change():
        completed();click('refine');click('review');check(page.locator('[data-action="next"]').is_disabled());check('Select a change' in page.locator('[data-action="next"]').inner_text())
    record('B05 no-change edit blocks spending',blocked_no_change)
    def fail_once():
        ready();click('next');click('process');click('fail');check('2 demo credits' in page.locator('#debug').inner_text());click('fail');check('2 demo credits' in page.locator('#debug').inner_text());click('complete');check('0 outputs' in page.locator('#debug').inner_text())
    record('B06 failure returns once and late success is ignored',fail_once)
    def cancel_started():
        ready();click('next');check(page.locator('[data-action="cancel"]').count()==1);click('process');check(page.locator('[data-action="cancel"]').count()==0)
    record('B07 processing no longer offers free cancellation',cancel_started)
    def leave_resume():
        reset('slow');click('garage');click('task');check(screen()=='task');check('1 submitted' in page.locator('#debug').inner_text());check('Processing' in page.locator('.job-state').inner_text())
    record('B08 browse and resume returns to same active request',leave_resume)
    def uncertain():
        reset('uncertain');check(page.locator('[data-action="retry"]').count()==0);check(page.locator('[data-action="cancel"]').count()==0);check('uncertain' in page.locator('.job-state').inner_text().lower())
    record('B09 uncertain request is not resubmitted',uncertain)
    def feedback():
        completed();click('problem');page.locator('[data-action="report"][data-category="identity"]').click();check('1 demo credits' in page.locator('#debug').inner_text());check('No automatic' in page.locator('.message').inner_text())
    record('B10 quality report does not grant credit or regenerate',feedback)
    def offline():
        ready();page.locator('#online').uncheck();check(page.locator('[data-action="next"]').is_disabled());check('Reconnect' in page.locator('[data-action="next"]').inner_text());page.locator('#online').check();check(page.locator('[data-action="next"]').is_enabled())
    record('B11 offline keeps choices and disables new requests',offline)
    def local_file():
        from PIL import Image
        import io
        f=io.BytesIO();Image.new('RGB',(160,90),'white').save(f,format='PNG')
        reset();click('start');page.locator('#photo-input').set_input_files({'name':'synthetic.png','mimeType':'image/png','buffer':f.getvalue()});page.wait_for_timeout(100)
        check(screen()=='review');check(page.locator('.local-photo').count()==1);check(page.locator('[data-action="next"]').is_disabled());check('On this device only' in page.locator('.art').inner_text());click('sample');check(page.locator('.local-photo').count()==0)
    record('B12 local photo preview cannot be passed off as generated',local_file)
    def bad_file():
        reset();click('start');page.locator('#photo-input').set_input_files({'name':'not-an-image.png','mimeType':'image/png','buffer':b'not png'});page.wait_for_timeout(100);check('could not be previewed' in page.locator('.message').inner_text());check(screen()=='photo')
    record('B13 corrupt file explains error without uploading',bad_file)
    def direct_detail():
        reset();click('direct');click('sample');check(screen()=='edit');check('Select a change' not in page.locator('h1').inner_text());page.locator('[data-action="color"][data-field="body"][data-value="green"]').click();click('review');check('One detail' in page.locator('.summary').inner_text())
    record('B14 original single-detail entry avoids full style preset',direct_detail)
    def compare():
        completed();before=page.locator('.car-art').first.get_attribute('aria-label');click('original');check(page.locator('.car-art').first.get_attribute('aria-label')!=before);click('styled');check(page.locator('.car-art').first.get_attribute('aria-label')==before)
    record('B15 visible before/after control uses existing example only',compare)
    def dialog_focus():
        ready();click('help');page.keyboard.press('Escape');check(page.locator('dialog[open]').count()==0);check(page.locator('[data-action="help"]').evaluate('(e)=>e===document.activeElement'))
    record('B16 Escape dismisses sheet and restores invoking control',dialog_focus)
    def color_focus():
        completed();click('refine');el=page.locator('[data-action="color"][data-field="wheel"][data-value="graphite"]');el.focus();page.keyboard.press('Enter');check(el.evaluate('(e)=>e===document.activeElement'))
    record('B17 keyboard swatch selection keeps focus',color_focus)
    def pending_no_second():
        reset('pending');check(page.locator('dialog [data-action="buy"]').count()==0);click('close');click('next');check('Awaiting confirmation' in page.locator('dialog').inner_text())
    record('B18 pending purchase cannot open a second pack purchase',pending_no_second)
    for width,height in [(320,568),(360,740),(375,667),(390,844),(430,932),(844,390),(1440,1100)]:
        def layout(w=width,h=height):
            reset(width=w,height=h)
            check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'horizontal overflow at {w}x{h}')
            button=page.locator('[data-action="start"]');box=button.bounding_box();device=page.locator('.device').bounding_box()
            check(box['width']>=44 and box['height']>=44,'primary target too small')
            check(box['y']>=device['y'] and box['y']+box['height']<=device['y']+device['height'],'CTA outside device')
        record(f'B19 layout {width}x{height}, CTA contained',layout)
    def targets():
        ready()
        bad=page.locator('.device button').evaluate_all('(es)=>es.map(e=>({label:e.textContent,r:e.getBoundingClientRect()})).filter(x=>x.r.width>0&&(x.r.width<44||x.r.height<44)).map(x=>x.label)')
        check(not bad,str(bad))
    record('B20 visible app button targets at least 44 CSS px in reference',targets)
    def reduced():
        page.emulate_media(reduced_motion='reduce');reset('slow');check(page.locator('.spinner').evaluate('(e)=>getComputedStyle(e).animationName')=='none');page.emulate_media(reduced_motion='no-preference')
    record('B21 Reduce Motion removes spinner animation',reduced)
    def large_text():
        reset(width=390,height=844)
        css=(ROOT/'prototype/style.css').read_text()
        enlarged=re.sub(r'font-size:([0-9.]+)px',lambda m:'font-size:'+str(float(m.group(1))*2)+'px',css)
        page.add_style_tag(content=enlarged+' .device{height:auto!important;min-height:844px}.content{overflow:visible!important}.primary-dock{max-height:none!important} h1,h2,h3,button{overflow-wrap:anywhere}')
        check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    record('B22 200% text-size reflow stress, not native Dynamic Type certification',large_text)
    record('B23 no JavaScript runtime errors',lambda:check(not errors,str(errors)))
    record('B24 no outbound network calls during scenarios',lambda:check(not [u for u in requests if u.startswith(('http:','https:'))],str(requests)))
    # Actual screenshots of representative reference screens, not competitor or production evidence.
    for name,prepare in [('01-home',lambda:reset()),('02-photo',lambda:(reset(),click('start'))),('03-review',ready),('04-wait',lambda:reset('slow')),('05-result',completed),('06-refine',lambda:(completed(),click('refine'))),('07-purchase',lambda:(ready(),click('purchase'))),('08-failure',lambda:reset('failed'))]:
        prepare();page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/(name+'.png')),full_page=False)
    reset(width=1440,height=1100);page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
    browser.close()
summary={'kind':'in_memory_chromium_reference_ui','environment':{'chromium':os.environ.get('FORM_CHROMIUM','/usr/bin/chromium'),'viewportBase':'390x844'},'passed':sum(x['status']=='PASS' for x in results),'failed':sum(x['status']=='FAIL' for x in results),'cases':results,'jsErrors':errors,'networkRequests':requests,'notRun':['WebKit','real iPhone','native Dynamic Type/VoiceOver','StoreKit','real AI','actual browser reload/session-storage integration','real user study']}
(OUT/'browser-results.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
raise SystemExit(1 if summary['failed'] else 0)
