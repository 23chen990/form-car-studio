import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const data=JSON.parse(readFileSync(new URL('../data/api_surface_audit.json',import.meta.url),'utf8'));
const match=(method,path)=>data.rows.find(x=>x.method===method&&x.path===path);

test('S02 inventory has unique HTTP method + path and source/ownership contract',()=>{
  assert.equal(data.base_spec,'docs/form-handoff/specs/02-data-api.md');
  const ids=data.rows.map(x=>`${x.method} ${x.path}`);
  assert.equal(new Set(ids).size,ids.length);
  for(const x of data.rows){
    assert.ok(['ISOLATED_PRESENT','NOT_PRESENT_IN_INSPECTED_V2_ROUTERS','EXTERNAL_PHASE_BLOCKED'].includes(x.current_status));
    if(x.current_status==='ISOLATED_PRESENT')assert.ok(x.source?.file.startsWith('server/v2/routes-')&&x.source.line>0);
    else assert.equal(x.source,null);
    assert.ok(x.frontend_consumer_tasks.length>0);
  }
});
test('plan, submit, task status and idempotent lookup are represented as isolated modules',()=>{
 for(const [method,path] of [['POST','/api/v2/projects/:id/plans'],['POST','/api/v2/tasks'],['GET','/api/v2/tasks/:id'],['GET','/api/v2/submissions/:submissionId']]){
  assert.equal(match(method,path)?.current_status,'ISOLATED_PRESENT');
 }
});
test('do not pretend workspace/history/draft/favorite/feedback handlers already exist',()=>{
 for(const [method,path] of [['GET','/api/v2/bootstrap'],['GET','/api/v2/projects/:id'],['PATCH','/api/v2/projects/:id'],['GET','/api/v2/projects/:id/versions'],['PUT','/api/v2/projects/:id/draft'],['PATCH','/api/v2/versions/:id'],['POST','/api/v2/tasks/:id/feedback'],['GET','/api/v2/wallet']]){
  const row=match(method,path); assert.equal(row?.current_status,'NOT_PRESENT_IN_INSPECTED_V2_ROUTERS');assert.ok(row.suggested_owner?.startsWith('OWNER_ASSIGN_'));
 }
});
test('F23/F26 dependent endpoints are not marked ready in existing branch',()=>{
 for(const [method,path] of [['GET','/api/v2/catalog'],['POST','/api/v2/purchases/verify'],['DELETE','/api/v2/account']]){
  assert.equal(match(method,path)?.current_status,'EXTERNAL_PHASE_BLOCKED');
 }
});
test('no main-app integration is claimed',()=>assert.match(data.status_meanings.ISOLATED_PRESENT,/F32/));
