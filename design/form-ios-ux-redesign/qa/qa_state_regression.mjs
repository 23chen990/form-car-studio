// Offline state-regression checks for PR #10. No browser, network, provider or purchase.
// Run: node design/form-ios-ux-redesign/qa/qa_state_regression.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '03_INTERACTIVE_WIREFRAME.html'), 'utf8');
const match = html.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(match, 'inline prototype script exists');

const listeners = new Map();
const dom = new Map();
const storage = new Map();
const timers = [];
let timerId = 0;
const element = id => {
  if (dom.has(id)) return dom.get(id);
  const value = {
    innerHTML:'', textContent:'', value:'', dataset:{},
    style:{setProperty(){}}, setAttribute(){},
    addEventListener(type, fn){listeners.set(id + ':' + type, fn);}
  };
  dom.set(id, value);
  return value;
};
const document = {
  documentElement:element('html'), body:{appendChild(){}},
  getElementById:element,
  addEventListener(type, fn){listeners.set(type, fn);},
  createElement(){return {dataset:{},click(){},remove(){}};},
  querySelector(){return null;}
};
const localStorage = {
  getItem(key){return storage.get(key) ?? null;},
  setItem(key, value){storage.set(key, value);},
  removeItem(key){storage.delete(key);}
};
const setTimeout = (fn, ms) => {
  const id = ++timerId; timers.push({fn, ms, id}); return id;
};
const clearTimeout = id => {
  const at = timers.findIndex(t => t.id === id);
  if (at !== -1) timers.splice(at, 1);
};
const window = {};
runInNewContext(match[1], {window, document, localStorage, setTimeout, clearTimeout, console});
const state = () => window.__FORM_UX__.state;
const act = (name, value) => {
  const node = {dataset:{act:name, v:value ?? ''}, classList:{add(){},remove(){}}};
  listeners.get('click')({target:{closest(query){return query === '[data-act]' ? node : null;}}});
};
let count = 0;
function test(name, ok){assert.ok(ok, name); count++; console.log('PASS', name);}
act('begin-look'); act('use-sample'); act('open-confirm'); act('submit');
const firstTask = state().task.id;
test('one reservation on submit', state().balance === 0 && state().task.status === 'queued');
act('set-status', 'succeeded');
test('success creates one immutable version', state().cars[0].versions.length === 1 && state().task.settled);
act('set-status', 'failed');
test('terminal task cannot be changed', state().balance === 0 && state().task.status === 'succeeded' && state().cars[0].versions.length === 1);
act('view-result');
const firstVersion = state().viewVersionId;
test('result points to exact version', Boolean(firstVersion));
act('refine');
test('refine uses explicitly selected version', state().baseVersionId === firstVersion);
act('open-add'); act('open-color','body'); act('set-color','steel'); act('open-confirm'); act('submit');
test('no balance blocks a new request', state().task.id === firstTask && state().balance === 0);
state().balance = 1; window.__FORM_UX__.render(); act('open-confirm'); act('submit');
test('new task keeps selected parent source', state().task.id !== firstTask && state().task.baseVersionId === firstVersion);
act('confirm-cancel');
test('queued cancellation refunds once', state().balance === 1 && state().task.settled && state().task.status === 'cancelled');
act('confirm-cancel');
test('repeat cancel cannot refund twice', state().balance === 1);
act('go-garage'); act('view-version',firstVersion);
test('garage view opens selected older version', state().screen === 'result' && state().viewVersionId === firstVersion);
act('new-original'); act('open-add'); act('open-look'); act('set-look','street'); act('open-source'); act('set-source',firstVersion);
test('cannot apply full style to older version', state().baseVersionId === null);
state().sim.draftFail = true; window.__FORM_UX__.render(); act('open-confirm');
test('draft-save failure blocks creation', state().sheet === 'confirm' && state().balance === 1);
console.log(count + '/' + count + ' offline state regressions PASS. Browser/WebView/real services: NOT RUN.');
