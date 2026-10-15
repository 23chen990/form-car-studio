import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'screenshots');
const EXE = '/Users/kker/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const FILE = 'file://' + join(__dirname, '..', '03_INTERACTIVE_WIREFRAME.html');
const RESULT = join(__dirname, 'qa_result.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (ok, msg, log) => {
  if (!ok) { log.push('FAIL: ' + msg); throw new Error(msg); }
  log.push('PASS: ' + msg);
};

const browser = await puppeteer.launch({ headless: true, executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.setViewport({ width: 1400, height: 1100, deviceScaleFactor: 2 });
await page.goto(FILE, { waitUntil: 'networkidle0' });

const state = async () => page.evaluate(() => window.__FORM_UX__.state);
const reset = async () => { await page.click('#resetBtn'); await sleep(200); };
const click = async sel => { await page.click(sel); await sleep(120); };
const setBalance = async n => { await page.evaluate(x => { window.__FORM_UX__.state.balance = x; window.__FORM_UX__.render(); }, n); await sleep(100); };
const deviceShot = async name => {
  const el = await page.$('#device');
  await el.screenshot({ path: join(OUT, name + '.png') });
};
const contains = async text => page.evaluate(t => document.body.innerText.includes(t), text);

const log = [];

async function run() {
  await reset();
  let s = await state();
  assert(s.screen === 'discover', 'starts on Discover', log);
  await deviceShot('01_discover');

  // A. First-time explore flow
  await click('[data-act="begin-look"]');
  assert((await state()).screen === 'photo', 'new user without cars goes to Add your car', log);
  await deviceShot('02_photo');
  await click('[data-act="use-sample"]');
  assert((await state()).screen === 'studio', 'sample car opens New look workspace', log);
  assert((await state()).draft.look === 'street', 'selected look carries into workspace', log);
  assert(await contains('BASE IMAGE · NOT CHANGED'), 'base image is unchanged while editing', log);
  await deviceShot('03_studio_with_look');

  await click('[data-act="open-confirm"]');
  assert((await state()).sheet === 'confirm', 'Create opens confirm sheet', log);
  assert(await contains('1 credit'), 'confirm shows exact cost', log);
  await deviceShot('04_confirm_sheet');

  await click('[data-act="submit"]');
  assert((await state()).screen === 'task', 'submit goes to task', log);
  assert((await state()).task.status === 'queued', 'task starts queued', log);
  await deviceShot('05_task_queued');

  await sleep(5200);
  s = await state();
  assert(s.screen === 'task' && s.task.status === 'succeeded', 'task reaches succeeded', log);
  await deviceShot('06_task_succeeded');

  await click('[data-act="view-result"]');
  assert((await state()).screen === 'result', 'result screen shown', log);
  assert(await contains('SIMULATED RESULT'), 'result honestly labelled as simulated', log);
  await deviceShot('07_result');

  await click('[data-act="compare"]');
  assert((await state()).screen === 'compare', 'compare screen shown', log);
  await deviceShot('08_compare');
  await click('[data-act="back"]');

  // B. Refine version with a colour change (top up credits for test)
  await setBalance(1);
  await click('[data-act="refine"]');
  assert((await state()).screen === 'studio', 'refine opens workspace', log);
  assert((await state()).baseVersionId !== null, 'refine bases on a version', log);
  await click('[data-act="open-add"]');
  assert((await state()).sheet === 'add', 'Add a change opens options', log);
  await deviceShot('09_add_change');

  await click('[data-act="open-color"][data-v="body"]');
  assert((await state()).sheet === 'color', 'Body colour sheet opens', log);
  await deviceShot('10_color_sheet');

  await click('[data-act="set-color"][data-v="steel"]');
  assert((await state()).draft.body === 'steel', 'tap applies colour to draft', log);
  assert((await state()).sheet === null, 'colour sheet closes on selection', log);
  await deviceShot('11_studio_with_colour');

  await click('[data-act="open-confirm"]');
  await click('[data-act="submit"]');
  await sleep(5200);
  await click('[data-act="view-result"]');
  await deviceShot('12_result_v2');

  await click('[data-act="back"]');
  await click('[data-act="tab"][data-v="garage"]');
  assert((await state()).screen === 'garage', 'Garage reachable', log);
  assert(await contains('Version 2'), 'garage lists both versions', log);
  await deviceShot('13_garage');

  // C. No credits path
  await reset();
  await page.click('#simControls input[data-sim="noCredits"]'); await sleep(100);
  await click('[data-act="begin-look"]');
  await click('[data-act="use-sample"]');
  await click('[data-act="open-confirm"]');
  const disabled = await page.evaluate(() => { const b = document.querySelector('[data-act="submit"]'); return b && b.disabled; });
  assert(disabled === true, 'Create disabled when no credits', log);
  await deviceShot('14_no_credits');
  await page.click('#simControls input[data-sim="noCredits"]'); await sleep(100);

  // D. Generation failure + credit returned
  await reset();
  await page.click('#simControls input[data-sim="genFail"]'); await sleep(100);
  await click('[data-act="begin-look"]');
  await click('[data-act="use-sample"]');
  await click('[data-act="open-confirm"]');
  await click('[data-act="submit"]');
  await sleep(5200);
  s = await state();
  assert(s.task.status === 'failed', 'generation fail leads to failed state', log);
  assert(s.balance === 1, 'credit returned on failure', log);
  await deviceShot('15_failed');
  await page.click('#simControls input[data-sim="genFail"]'); await sleep(100);

  // E. Draft save failure + retry
  await reset();
  await page.click('#simControls input[data-sim="draftFail"]'); await sleep(100);
  await click('[data-act="begin-look"]');
  await click('[data-act="use-sample"]');
  const err = await page.$('.callout.error');
  assert(err !== null, 'draft save failure shows error banner', log);
  await deviceShot('16_draft_error');
  await click('[data-act="retry-draft"]');
  const err2 = await page.$('.callout.error');
  assert(err2 === null, 'retry clears draft error', log);
  await page.click('#simControls input[data-sim="draftFail"]'); await sleep(100);

  // F. Responsive widths
  for (const w of ['320', '375', '430']) {
    await page.select('#widthSel', w); await sleep(200);
    const over = await page.evaluate(() => {
      const b = document.querySelector('.scr-wrap');
      return b ? b.scrollWidth > b.clientWidth : false;
    });
    assert(!over, 'width ' + w + ' has no horizontal overflow', log);
    await deviceShot('17_width_' + w);
  }
  await page.select('#widthSel', '390'); await sleep(200);

  // G. Persistence across reload
  await reset();
  await click('[data-act="begin-look"]');
  await click('[data-act="use-sample"]');
  await click('[data-act="open-confirm"]');
  await click('[data-act="submit"]');
  await page.reload({ waitUntil: 'networkidle0' });
  s = await state();
  assert(s.screen === 'task' && s.task.status === 'queued', 'reload restores active task', log);
  await deviceShot('18_reloaded_task');

  await click('[data-act="open-cancel"]');
  await click('[data-act="confirm-cancel"]');
  s = await state();
  assert(s.task.status === 'cancelled', 'queued task can be cancelled', log);
  assert(s.balance === 1, 'credit released on cancel', log);

  assert(errors.length === 0, 'no console/page errors', log);
}

try {
  await run();
  log.push('ALL TESTS PASSED');
} catch (e) {
  log.push('ABORTED: ' + e.message);
} finally {
  await browser.close();
}

writeFileSync(RESULT, JSON.stringify({ timestamp: new Date().toISOString(), passed: !errors.length && log.some(l => l.includes('ALL TESTS PASSED')), errors, log }, null, 2));
console.log(JSON.stringify({ errors, log }, null, 2));
