import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
const read = p=>readFileSync(new URL(p,import.meta.url),'utf8');
for(const name of ['../01_README_ZH.md','../02_ENGINEERING_GAPS_ZH.md','../03_UI_RFC_FIXES_ZH.md','../04_ACCEPTANCE_AND_CODEX_HANDOFF_ZH.md']){
 test(`preflight doc ${name} labels its approval/runtime boundary`,()=>{
  const x=read(name); assert.match(x,/F12|F23|S05/); assert.match(x,/(批准|待 Owner|需审阅|不改变|REVIEW)/);
 });
}
