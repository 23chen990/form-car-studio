"""Browser QA for a standalone offline HTML prototype.
The managed Chromium runtime blocks file:// and localhost navigation with
ERR_BLOCKED_BY_ADMINISTRATOR, so this harness renders identical HTML via
Playwright page.set_content() on about:blank. localStorage is polyfilled to
exercise the UI state machine. IndexedDB persistence and iPhone native APIs
are specifically NOT RUN; see 12_UX_QA_REPORT_ZH.md.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
from datetime import datetime,timezone
import json, traceback
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'11_INTERACTIVE_PROTOTYPE.html').read_text()
SHOT=ROOT/'screenshots/revision'
REPORT=ROOT/'qa/qa_revised_result.json'
RESULTS=[]
ERRORS=[]
checks=0

def expect(cond,desc):
 global checks
 checks+=1
 print('CHECK',checks,desc,'PASS' if cond else 'FAIL',flush=True)
 RESULTS.append({'name':desc,'status':'PASS' if cond else 'FAIL'})
 if not cond: raise AssertionError(desc)

def state(p):return p.evaluate('window.__FORM_REVISION__.state')
def clear_toast(p):p.evaluate("() => {window.__FORM_REVISION__.state.toast=null;window.__FORM_REVISION__.render()}")
def act(p,name,v=None):
 sel=('.sheetHead [data-act="closeSheet"]' if name=='closeSheet' else '[data-act="'+name+'"]')
 if v is not None:sel+='[data-v="'+v+'"]'
 p.locator(sel).first.click()
def screenshot(p,name):
 clear_toast(p)
 p.locator('#phone').screenshot(path=str(SHOT/name))
 im=Image.open(SHOT/name)
 w=state(p)['width']
 # Locator screenshot may include one extra CSS pixel when centered at x=.5.
 # Normalize only the 1px left/right capture round-off; never scale UI.
 if im.width==w*2+2:
  im=im.crop((1,0,im.width-1,im.height));im.save(SHOT/name)
 expect(im.size==(w*2,844*2),f'Screenshot {name} dimensions {w}x844 @2x')

def new_page(browser,saved=None):
 p=browser.new_page(viewport={'width':1400,'height':1100},device_scale_factor=2)
 p.on('pageerror',lambda e:ERRORS.append('pageerror: '+str(e)))
 p.on('console',lambda m:ERRORS.append('console.error: '+m.text) if m.type=='error' else None)
 stub=json.dumps({'form-afterhours-revision-v1':saved} if saved else {})
 p.evaluate('''data => {let m=JSON.parse(data);Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m[k]||null,setItem:(k,v)=>m[k]=v,removeItem:k=>delete m[k]}})}''',stub)
 p.set_content(HTML,wait_until='load');p.set_default_timeout(4000)
 expect(p.locator('#app').count()==1,'HTML rendered in real Chromium DOM')
 return p

def set_sim(p,k,val=True):
 p.evaluate('(kv) => {window.__FORM_REVISION__.state.sim[kv[0]]=kv[1];window.__FORM_REVISION__.render()}',[k,val])

def test_actual_photo(browser):
 p=new_page(browser)
 screenshot(p,'01_explore.png')
 expect('Try Clean on my car' in p.locator('#app').inner_text(),'Explore primary CTA states chosen direction')
 act(p,'startExplore');expect(state(p)['page']=='photo','First visit opens Photo without car-picker detour')
 screenshot(p,'02_photo_guide.png')
 file1=str(ROOT/'qa/fixture_local_car.png')
 p.locator('#photoFile').set_input_files(file1)
 p.locator('.photoStage img').wait_for(timeout=4000)
 expect(p.locator('.photoStage img').count()==1,'Local file really decoded and displayed in picker')
 expect(p.locator('.photoStage img').get_attribute('src').startswith('blob:'),'Local photo uses object URL, no network request')
 screenshot(p,'03_photo_selected.png')
 selected_src=p.locator('.photoStage img').get_attribute('src')
 p.locator('#photoFile').set_input_files(str(ROOT/'qa/fixture_second_car.png'))
 p.wait_for_function('(old) => document.querySelector(".photoStage img")?.src!==old',arg=selected_src,timeout=4000)
 expect(p.locator('.photoStage img').get_attribute('src')!=selected_src,'Reselection changes local preview without creating a car')
 expect(len(state(p)['cars'])==0,'Photo is not committed before explicit continue')
 # Rechoose first photo to follow this specific source through the journey.
 p.locator('#photoFile').set_input_files(file1)
 p.wait_for_function('() => !!document.querySelector(".fileMeta") && document.querySelector(".fileMeta").textContent.includes("fixture_local_car")',timeout=4000)
 act(p,'acceptPhoto');p.wait_for_timeout(200)
 expect(state(p)['page']=='studio','Accept photo enters central Studio directly')
 expect(len(state(p)['cars'])==1 and state(p)['cars'][0]['kind']=='local','Actual local photo is represented as a separate car')
 expect(p.locator('.studioStage img').count()==1,'Studio displays real uploaded pixels not a car SVG')
 src=p.locator('.studioStage img').get_attribute('src')
 expect(src.startswith('blob:'),'Selected local photo persists in Studio visual')
 expect(p.locator('.studioStage img').evaluate('(e) => e.complete && e.naturalWidth===920'),'Photo decodes at original fixture width')
 expect(p.locator('.studioStage img').evaluate('(e)=>getComputedStyle(e).objectFit')=='contain','Studio object-fit contain prevents car crop')
 screenshot(p,'04_studio_own_photo.png')
 act(p,'openColor','body')
 expect(p.locator('.sheet').count()==1 and p.locator('.studioStage img').count()==1,'Paint sheet keeps car visible underneath')
 screenshot(p,'05_paint_sheet.png')
 act(p,'setColor','graphite')
 expect(state(p)['draft']['body']=='graphite' and state(p)['draft']['style'] is None,'Color selection replaces incompatible Style draft')
 expect(p.locator('.studioStage img').get_attribute('src')==src,'Color draft leaves actual image bytes and URL untouched')
 screenshot(p,'06_studio_paint_selected.png')
 act(p,'review')
 expect(p.locator('.identity img').get_attribute('src')==src,'Confirm thumbnail is exact selected user photo')
 expect('Not a server quote' in p.locator('.sheet').inner_text(),'Confirm explicitly refuses to call fake price a server quote')
 screenshot(p,'07_review_own_photo.png')
 act(p,'submit');t=state(p)['task']
 expect(state(p)['page']=='task' and t['status']=='queued','One explicit Confirm creates one queued demo task')
 expect(state(p)['balance']==1,'Exactly one simulated credit reserved')
 expect(p.locator('.taskVisual img').get_attribute('src')==src,'Task continues to display own photo')
 screenshot(p,'08_task_queued.png')
 act(p,'leaveTask');expect(state(p)['page']=='garage','Leaving Task goes to Garage (not a fake back gesture)')
 expect(p.locator('[data-act="resume"]').count()==1,'Garage contains resume entry for active task')
 screenshot(p,'09_garage_task_active.png')
 act(p,'resume');expect(state(p)['task']['submissionId']==t['submissionId'],'Resume uses same stable submission ID')
 p.wait_for_timeout(5650)
 expect(state(p)['task']['status']=='succeeded','Timer moves queued/processing to simulated success')
 expect(len(state(p)['cars'][0]['versions'])==1,'Success creates one and only one simulated version')
 screenshot(p,'10_task_completed.png')
 p.evaluate('window.__FORM_REVISION__.force("succeeded")')
 expect(len(state(p)['cars'][0]['versions'])==1 and state(p)['balance']==1,'Repeat settlement cannot double-charge or duplicate version')
 act(p,'viewTaskResult')
 expect(p.locator('.resultStage img').get_attribute('src')==src,'Simulated result visibly retains original pixels instead of fake output')
 expect('No AI image was generated' in p.locator('#app').inner_text(),'Result labels simulation as not a generated output')
 screenshot(p,'11_result_simulated_own_photo.png')
 act(p,'favourite');v=state(p)['viewId'];expect(v in state(p)['favourites'],'Favourite persisted on selected version identity')
 act(p,'saveInfo');expect('No image to save' in p.locator('.sheet').inner_text(),'Save simulated result does not falsely report download success')
 screenshot(p,'12_save_disabled_explained.png')
 act(p,'closeSheet');act(p,'compare')
 expect('Both sides show the same unmodified source pixels' in p.locator('#app').inner_text(),'Compare makes unchanged pixels explicit')
 p.locator('input[data-range="compare"]').fill('75')
 expect(state(p)['compare']==75,'Compare divider is controllable')
 screenshot(p,'13_compare_simulated.png')
 act(p,'back');expect(state(p)['page']=='result','Compare back returns to selected version')
 act(p,'refine')
 expect(state(p)['sourceId']==v,'Refine correctly binds the exact selected version as base')
 expect(state(p)['draft']=={'style':None,'body':'keep','wheel':'keep'},'Refine begins separate empty draft without inheriting original Style')
 screenshot(p,'14_refine_old_version.png')
 act(p,'openColor','wheel');act(p,'setColor','bronze');act(p,'review')
 expect('Version 1' in p.locator('.sheet').inner_text(),'Second request explicitly names Version 1 as base')
 screenshot(p,'15_review_version_1.png')
 act(p,'submit');p.evaluate('window.__FORM_REVISION__.force("succeeded")')
 expect(len(state(p)['cars'][0]['versions'])==2,'Second request creates Version 2 not overwrite Version 1')
 v2=state(p)['cars'][0]['versions'][1]
 expect(v2['sourceId']==v,'Version 2 parent is exactly selected Version 1 ID')
 act(p,'viewTaskResult');act(p,'back')
 expect(state(p)['page']=='garage','Result back goes to Garage instead of old Task')
 screenshot(p,'16_garage_versions.png')
 # Old-version selection after newer version exists.
 act(p,'viewVersion',state(p)['carId']+'|'+v)
 expect(state(p)['viewId']==v,'Opening old V1 does not redirect to newest V2')
 act(p,'refine');expect(state(p)['sourceId']==v,'Old V1 Refine still uses V1 not latest')
 act(p,'back');expect(state(p)['page']=='result' and state(p)['viewId']==v,'Back from version edit returns to that specific V1 result')
 # From original Explore should resume recent car context rather than repeat upload.
 act(p,'back');act(p,'root','explore')
 expect(p.locator('[data-act="resumeCar"]').count()==1,'Explore offers recently used car shortcut')
 act(p,'startExplore');expect(p.locator('.sheet').count()==1,'Returning user gets inline car selection sheet not full choose-car screen')
 screenshot(p,'17_returning_car_picker.png')
 act(p,'closeSheet');p.close()

def test_failures(browser):
 p=new_page(browser)
 act(p,'startSample')
 # Style/colour sheet + undo switch; no same-screen fake photo change.
 act(p,'openColor','wheel');act(p,'setColor','bronze')
 expect(state(p)['draft']=={'style':None,'body':'keep','wheel':'bronze'},'Switching to Wheel removes full Style, never combines them')
 act(p,'undo-switch');expect(state(p)['draft']['style']=='clean' and state(p)['draft']['wheel']=='keep','Undo restores incompatible-mode switch safely')
 act(p,'resetDraft');expect(not state(p)['draft']['style'],'Reset clears selection')
 act(p,'undoReset');expect(state(p)['draft']['style']=='clean','Undo Reset restores prior draft')
 act(p,'openColor','body');act(p,'closeSheet');expect(state(p)['draft']['style']=='clean','Close sheet with no selection does not change draft')
 act(p,'source');expect(p.locator('.sheet').count()==1,'Source chooser sheet opens')
 act(p,'closeSheet')
 # Quote error states
 for flag in ['noCredits','offline','quoteFail','draftFail']:
  set_sim(p,flag,True);act(p,'review')
  expect(p.locator('[data-act="submit"]').is_disabled(),f'{flag} blocks confirmation before demo submit')
  expect(len(p.locator('.alert.err').all())>0,f'{flag} shows explanatory error state')
  if flag=='noCredits':screenshot(p,'18_no_credits.png')
  if flag=='quoteFail':screenshot(p,'19_quote_unavailable.png')
  if flag=='draftFail':screenshot(p,'20_draft_error.png')
  act(p,'closeSheet');set_sim(p,flag,False)
 set_sim(p,'draftFail',True);act(p,'retrySave');expect(state(p)['sim']['draftFail']==False,'Draft retry clears simulated save failure')
 # Queued cancel: refund once; do not generate or mutate finished task.
 act(p,'review');act(p,'submit');expect(state(p)['balance']==1,'First simulated credit is reserved once')
 act(p,'cancelSheet');screenshot(p,'21_cancel_queued.png');act(p,'confirmCancel')
 expect(state(p)['task']['status']=='cancelled','Queued cancellation records terminal cancelled state')
 expect(state(p)['balance']==2,'Queued cancellation releases one demo credit')
 p.evaluate('window.__FORM_REVISION__.force("failed")')
 expect(state(p)['balance']==2,'Terminal refund idempotency holds')
 # Failure + retry path.
 act(p,'back');act(p,'root','garage')
 act(p,'editOriginal',state(p)['carId']);act(p,'openColor','body');act(p,'setColor','red')
 set_sim(p,'genFail',True);act(p,'review');act(p,'submit')
 p.evaluate('window.__FORM_REVISION__.force("failed")')
 expect(state(p)['task']['status']=='failed','Simulated task failure reachable')
 expect(state(p)['balance']==2,'Failure returns reserved demo credit once')
 screenshot(p,'22_task_failed.png')
 act(p,'retryTask');expect(state(p)['page']=='studio' and state(p)['draft']['body']=='red','Failure retry recovers same exact draft and source')
 # Processing cancellation conflict
 set_sim(p,'genFail',False);act(p,'review');act(p,'submit');p.wait_for_timeout(1550)
 expect(state(p)['task']['status']=='processing','Task enters processing state')
 expect(p.locator('[data-act="cancelSheet"]').count()==0,'Processing task offers no free cancel')
 p.evaluate('window.__FORM_REVISION__.force("succeeded")')
 expect(state(p)['task']['status']=='succeeded','Processing can settle once')
 # Unknown status remains unknown on simulated reload with same stored state.
 act(p,'viewTaskResult');act(p,'refine');act(p,'openColor','wheel');act(p,'setColor','black');act(p,'review');act(p,'submit')
 active_id=state(p)['task']['submissionId'];p.evaluate('''() => { const s=window.__FORM_REVISION__.state;s.task.status='uncertain';window.__FORM_REVISION__.render() }''')
 saved=p.evaluate('localStorage.getItem("form-afterhours-revision-v1")')
 screenshot(p,'23_task_uncertain.png')
 p.close()
 q=new_page(browser,saved)
 expect(state(q)['task']['submissionId']==active_id and state(q)['task']['status']=='uncertain','Refresh reconstructs same uncertain task ID without auto-success')
 expect(state(q)['balance']==0,'Uncertain resume does not refund or re-charge')
 screenshot(q,'24_task_uncertain_reloaded.png')
 # New submit cannot bypass active unknown request
 act(q,'leaveTask');act(q,'editOriginal',state(q)['carId']);act(q,'openColor','body');act(q,'setColor','blue');act(q,'review')
 expect(q.locator('[data-act="submit"]').is_disabled(),'Active uncertain request prohibits second concurrent submit')
 q.close()

def test_multi_car(browser):
 p=new_page(browser)
 act(p,'startSample')
 a=state(p)['carId'];expect(len(state(p)['cars'])==1,'Car A exists as independent concept car')
 act(p,'openColor','wheel');act(p,'setColor','bronze')
 expect(state(p)['draft']['wheel']=='bronze','Car A has a wheel-colour draft')
 act(p,'back');act(p,'root','garage')
 act(p,'addCar')
 expect(state(p)['page']=='photo','Garage add-car opens separate photo intake')
 p.locator('#photoFile').set_input_files(str(ROOT/'qa/fixture_second_car.png'))
 p.locator('.photoStage img').wait_for()
 act(p,'acceptPhoto');p.wait_for_timeout(200)
 b=state(p)['carId']
 expect(b!=a and len(state(p)['cars'])==2,'Car B creates a separate source identity')
 expect(p.locator('.studioStage img').count()==1,'Car B displays uploaded local file')
 act(p,'openColor','body');act(p,'setColor','blue')
 expect(state(p)['draft']['body']=='blue' and state(p)['draft']['wheel']=='keep','Car B independent draft is paint-blue only')
 act(p,'back');expect(state(p)['page']=='garage','Second car returns to its correct Garage origin')
 act(p,'pickCarSource',a)
 expect(state(p)['page']=='studio' and p.locator('.sheet').count()==1,'Garage choose-source opens Studio with source chooser')
 act(p,'selectSource',a+'|')
 expect(state(p)['carId']==a and state(p)['draft']['wheel']=='bronze','Switch back to Car A restores its own draft')
 act(p,'source');act(p,'selectSource',b+'|')
 expect(state(p)['carId']==b and state(p)['draft']['body']=='blue','Switch from A to B restores B draft without crossover')
 screenshot(p,'29_second_car_restored.png')
 # Simulate a photo evicted from ephemeral browser memory: never show generic car as the owner's photo.
 p.evaluate('(id)=>{window.__FORM_REVISION__.media.delete(id);window.__FORM_REVISION__.render()}',b)
 expect(p.locator('.studioStage .missingPhoto').count()==1,'Missing local photo never silently becomes a generic car illustration')
 expect('Photo not available' in p.locator('.studioStage').inner_text(),'Unavailable photo has explicit non-deceptive recovery copy')
 screenshot(p,'30_missing_local_photo.png')
 p.close()

def test_sizes(browser):
 for width in (320,375,390,430):
  p=new_page(browser)
  p.locator('#width').select_option(str(width))
  screenshot(p,f'25_explore_{width}.png')
  act(p,'startSample')
  screenshot(p,f'26_studio_{width}.png')
  act(p,'openColor','body')
  screenshot(p,f'27_sheet_{width}.png')
  act(p,'setColor','silver');act(p,'review')
  screenshot(p,f'28_review_{width}.png')
  overflow=p.evaluate('''() => {
     const a=document.getElementById('app'),ph=document.getElementById('phone');
     return {app:a.scrollWidth-a.clientWidth,phone:ph.scrollWidth-ph.clientWidth,
     sheet:document.querySelector('.sheet')?.scrollWidth-document.querySelector('.sheet')?.clientWidth};
  }''')
  expect(all(x<=2 for x in overflow.values()),f'{width}px no horizontal overflow in confirm UI: {overflow}')
  click_loc=p.locator('[data-act="submit"]')
  box=click_loc.bounding_box();device=p.locator('#phone').bounding_box()
  expect(box['x']>=device['x']-1 and box['x']+box['width']<=device['x']+device['width']+1 and box['height']>=44,f'{width}px confirmation CTA inside phone and >=44px')
  p.close()

def test_honest_photo_and_mode_edges(browser):
 p=new_page(browser)
 act(p,'startSample')
 initial_style=state(p)['draft']['style']
 act(p,'openColor','body');act(p,'setColor','keep')
 expect(state(p)['draft']=={'style':initial_style,'body':'keep','wheel':'keep'},'Keep color cannot erase a Style intent')
 act(p,'openColor','body');act(p,'setColor','red')
 expect(state(p)['draft']['style'] is None and state(p)['draft']['body']=='red','Explicit red paint replaces Style')
 act(p,'openStyle');act(p,'setStyle','sport')
 expect(state(p)['draft']['style']=='sport' and state(p)['draft']['body']=='keep','Style replaces earlier detailed color draft')
 expect(p.locator('[data-act="undo-switch"]').count()==1,'Incompatible switch exposes immediate Undo')
 act(p,'undo-switch')
 expect(state(p)['draft']=={'style':None,'body':'red','wheel':'keep'},'Undo reverses Style over Detail replacement')
 act(p,'openColor','body');act(p,'setColor','blue')
 expect(p.locator('[data-act="undo-switch"]').count()==0,'Unrelated later color does not expose stale Undo')
 act(p,'back');act(p,'root','garage');act(p,'addCar')
 p.locator('#photoFile').set_input_files(str(ROOT/'qa/fixture_local_car.png'))
 p.locator('.photoStage img').wait_for()
 p.evaluate('() => { const e=document.querySelector(\'[data-act="acceptPhoto"]\'); e.click(); e.click(); }')
 p.wait_for_function('() => window.__FORM_REVISION__.state.page === "studio"')
 expect(len(state(p)['cars'])==2,'Double-tap photo acceptance creates only one new car')
 c=state(p)['carId']
 p.evaluate('(id)=>{window.__FORM_REVISION__.media.delete(id);window.__FORM_REVISION__.render()}',c)
 expect(p.locator('.studioStage .sampleSvg').count()==0 and p.locator('.studioStage .missingPhoto').count()==1,'Lost user image never falls back to sample-car art')
 act(p,'openColor','body');act(p,'setColor','black')
 expect(not p.evaluate('window.__FORM_REVISION__.quote()')['ok'],'Missing source photo explicitly blocks demo creation')
 expect(p.locator('[data-act="review"]').count()==0 and p.locator('.footer [data-act="addCar"]').count()==1,'Missing image removes misleading generation CTA and offers recovery')
 expect('original photo is not available' in p.evaluate('window.__FORM_REVISION__.quote()')['reason'],'Missing image explains why request is blocked')
 act(p,'back')
 expect(p.locator('.garageHero .missingPhoto').count()==1,'Garage cover also avoids misleading substitute art')
 expect(p.locator('.versionRow .sampleSvg').count()==0,'No fake version thumbnail shown when source disappears')
 act(p,'addCar')
 p.locator('#photoFile').set_input_files(str(ROOT/'qa/fixture_second_car.png'))
 p.locator('.photoStage img').wait_for()
 act(p,'acceptPhoto');p.wait_for_function('() => window.__FORM_REVISION__.state.page === "studio"')
 expect(state(p)['carId']!=c and p.locator('.studioStage img').count()==1,'Recovery creates a distinct car with a real source photo')
 p.evaluate('window.__FORM_REVISION__.reset()')
 p.wait_for_function('() => window.__FORM_REVISION__.state.cars.length === 0')
 expect(state(p)['balance']==2 and len(state(p)['cars'])==0,'Reset clears all simulated cars, versions and credits')
 expect(p.evaluate('window.__FORM_REVISION__.media.size')==0,'Reset revokes local photo preview records')
 p.close()

def run():
 SHOT.mkdir(parents=True,exist_ok=True)
 with sync_playwright() as playwright:
  browser=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  try:
   test_actual_photo(browser)
   test_failures(browser)
   test_sizes(browser)
   test_multi_car(browser)
   test_honest_photo_and_mode_edges(browser)
  except Exception as e:
   ERRORS.append('Assertion/test exception: '+str(e))
   traceback.print_exc()
  finally:browser.close()
 output={
 'generated_at':datetime.now(timezone.utc).isoformat(),
 'browser':'System Chromium (Playwright Python) with about:blank set_content due managed navigation policy',
 'viewport':'1400x1100 outer; device 390x844 / 320 375 430; @2x screenshot',
 'checks_total':checks,'passed':sum(r['status']=='PASS' for r in RESULTS),'failed':sum(r['status']=='FAIL' for r in RESULTS),
 'page_or_console_errors':ERRORS,'checks':RESULTS,
 'not_run':['Real file:// navigation in managed Chromium (ERR_BLOCKED_BY_ADMINISTRATOR)','IndexedDB persistence across a real-origin full reload','Real iOS/Capacitor/HEIC/camera/Photos permission/VoiceOver/StoreKit','Real server immutable quote/ownership/consent, paid model and real wallet','8-12 target-user moderated usability sessions']}
 REPORT.write_text(json.dumps(output,ensure_ascii=False,indent=2))
 print(json.dumps({k:output[k] for k in ['checks_total','passed','failed','page_or_console_errors']},ensure_ascii=False,indent=2))
 print('screen count',len(list(SHOT.glob('*.png'))))
 if ERRORS or output['failed']:raise SystemExit(1)

if __name__=='__main__':run()