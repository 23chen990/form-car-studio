import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const data=JSON.parse(readFileSync(new URL('../data/v21_visual_tokens.json',import.meta.url),'utf8'));
test('V2.1 visual tokens are exact source-derived reference, not production release',()=>{
 assert.match(data.source_sha256,/^[a-f0-9]{64}$/);
 assert.equal(data.theme_css_vars['--bg'],'#070b0d');
 assert.equal(data.theme_css_vars['--accent'],'#cbf85b');
 assert.equal(data.approval,'NOT_APPROVED_FOR_PRODUCTION');
 assert.ok(data.declared_media_conditions.includes('max-width:359px'));
 assert.ok(data.declared_media_conditions.includes('prefers-reduced-motion:reduce'));
});
