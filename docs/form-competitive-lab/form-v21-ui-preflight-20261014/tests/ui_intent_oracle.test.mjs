import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  STYLE_IDS, BODY_COLORS, WHEEL_COLORS, FIRST_LAUNCH_FIELDS,
  IntentError, assertSource, tryCaseOnMyCar, directSingleDetail,
  refineSpecificVersion, exploreAnotherFromOriginal, assertNoExploreOverrides,
  openChoiceSheet, chooseInSheet, closeChoiceSheet, applyChoiceSheet,
  resultNextSource, isNoCallAction
} from '../reference/ui_intent_oracle.mjs';

const code = expected => e => e instanceof IntentError && e.code === expected;
const fieldCaps = [...FIRST_LAUNCH_FIELDS];

test('source: original has no versionId; explicit version keeps exact historic ID', () => {
  assert.deepEqual(assertSource({kind:'original'}), {kind:'original'});
  assert.deepEqual(assertSource({kind:'version',versionId:'old-v1'}), {kind:'version',versionId:'old-v1'});
});
test('source: invalid, cross-shape and empty historic ID are rejected', () => {
  for (const src of [null, {}, {kind:'original',versionId:'v1'}, {kind:'version'}, {kind:'version',versionId:'bad/id'}, {kind:'latest'}]) {
    assert.throws(() => assertSource(src), IntentError);
  }
});
test('explore: approved native style produces strict S01 request and no edit overrides', () => {
  const req = tryCaseOnMyCar({styleId:'sport',approvedStyleIds:['sport']});
  assert.deepEqual(req, {schemaVersion:2,source:{kind:'original'},operation:'explore',styleId:'sport',edits:{}});
  assert.deepEqual(assertNoExploreOverrides(req),req);
});
test('explore: none of the eight IDs is automatically published', () => {
  for(const styleId of STYLE_IDS) assert.throws(() => tryCaseOnMyCar({styleId}),code('STYLE_NOT_PUBLISHED'));
});
test('explore: editorial concept IDs are not backend style IDs', () => {
  for (const styleId of ['street','pitlane','stance','japanese','widebody']) {
    assert.throws(()=>tryCaseOnMyCar({styleId,approvedStyleIds:[styleId]}),code('STYLE_NOT_IN_FROZEN_CONTRACT'));
  }
});
test('explore: combining a style request with a paint override violates S01 first-launch plan', () => {
  const req={...tryCaseOnMyCar({styleId:'clean',approvedStyleIds:['clean']}),edits:{bodyColor:{action:'set',value:'red'}}};
  assert.throws(()=>assertNoExploreOverrides(req),code('EXPLORE_OVERRIDES_UNSUPPORTED'));
});
test('direct detail: original wheel color does not invent styleId', () => {
  assert.deepEqual(directSingleDetail({source:{kind:'original'},field:'wheelColor',value:'bronze',enabledFields:fieldCaps}),{
    schemaVersion:2,source:{kind:'original'},operation:'detail',edits:{wheelColor:{action:'set',value:'bronze'}}
  });
});
test('direct detail: preserve explicit historic version identity', () => {
  const r=refineSpecificVersion({versionId:'version-v1',field:'bodyColor',value:'red',enabledFields:fieldCaps});
  assert.equal(r.source.versionId,'version-v1'); assert.equal(r.styleId,undefined);assert.equal(r.edits.bodyColor.value,'red');
});
test('direct detail: unsupported bodyFinish, wheelDesign and arbitrary body kit stay blocked', () => {
  for(const field of ['bodyFinish','wheelDesign','bodyKit','stance'])assert.throws(
    ()=>directSingleDetail({source:{kind:'original'},field,value:'matte',enabledFields:[...fieldCaps,field]}),code('CAPABILITY_NOT_READY'));
});
test('direct detail: disabled supported field stays blocked', () => {
  assert.throws(()=>directSingleDetail({source:{kind:'original'},field:'wheelColor',value:'black'}),code('CAPABILITY_NOT_READY'));
});
test('direct detail: only schema-supported colors accepted', () => {
  assert.equal(BODY_COLORS.includes('bronze'),false);
  assert.equal(WHEEL_COLORS.includes('bronze'),true);
  assert.throws(()=>directSingleDetail({source:{kind:'original'},field:'bodyColor',value:'bronze',enabledFields:fieldCaps}),code('UNSUPPORTED_VALUE'));
});
test('sheet: cancel/escape leaves committed draft intact', () => {
  const committed={styleId:'sport',bodyColor:'silver',wheelColor:'silver'};
  const staging=chooseInSheet(chooseInSheet(openChoiceSheet(committed),'bodyColor','red'),'styleId','track');
  assert.deepEqual(closeChoiceSheet(staging),committed);
  assert.deepEqual(committed,{styleId:'sport',bodyColor:'silver',wheelColor:'silver'});
});
test('sheet: apply commits explicitly and does not change the original reference', () => {
  const committed={styleId:'sport',bodyColor:'black'};
  const staging=chooseInSheet(openChoiceSheet(committed),'bodyColor','red');
  assert.deepEqual(applyChoiceSheet(staging),{styleId:'sport',bodyColor:'red'});
  assert.equal(committed.bodyColor,'black');
});
test('sheet: attempts to stage locked feature are rejected', () => {
  assert.throws(()=>chooseInSheet(openChoiceSheet({}),'bodyFinish','matte'),code('CONTROL_NOT_READY'));
});
test('result: refine older version never uses latest or original', () => {
  assert.deepEqual(resultNextSource({action:'refine_selected_version',selectedVersionId:'v1'}),{kind:'version',versionId:'v1'});
});
test('result: another look starts from project original regardless of selected version', () => {
  assert.deepEqual(resultNextSource({action:'try_another_from_original',selectedVersionId:'v1'}),{kind:'original'});
});
test('result: refine without explicit version fails closed', () => {
  assert.throws(()=>resultNextSource({action:'refine_selected_version'}),code('SELECTED_VERSION_REQUIRED'));
});
test('result: unknown action fails closed', () => {
  assert.throws(()=>resultNextSource({action:'regenerate_auto',selectedVersionId:'v1'}),code('UNKNOWN_RESULT_ACTION'));
});
test('browse, compare, favorite and static export are never generation actions', () => {
  for(const action of ['browse','preview_example','stage_style','stage_color','cancel_sheet','apply_sheet','compare','favorite','export_static','open_history'])assert.equal(isNoCallAction(action),true);
});
test('confirm and submit are NOT classified as zero-call actions', () => {
  for (const action of ['quote','confirm','submit','unknown'])assert.equal(isNoCallAction(action),false);
});
test('another approved look recreates strict original-source explore', () => {
  const r=exploreAnotherFromOriginal({styleId:'track',approvedStyleIds:['track']});
  assert.deepEqual(r.source,{kind:'original'}); assert.equal(r.operation,'explore'); assert.deepEqual(r.edits,{});
});
test('source rejects arrays, prototype instance and malformed object data', () => {
  for(const s of [[],new Date(),Object.assign(Object.create({kind:'original'}),{})])assert.throws(()=>assertSource(s),IntentError);
});
