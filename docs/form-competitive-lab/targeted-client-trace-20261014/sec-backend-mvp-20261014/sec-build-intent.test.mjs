import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSecResearchRequest, LAB_INTENT_VERSION} from './sec-build-intent.mjs';

const published = () => ({
  researchEnabled:true,
  catalogVersion:'sec-catalog-r1',templateVersion:'sec-template-r1',capabilityVersion:'sec-capability-r1',
  versionSourceEnabled:true,
  styles:{
    street:{enabled:true,allowedExtras:[null,'widebody','spoiler'],hasStandaloneChange:false},
    touring:{enabled:true,allowedExtras:[null,'spoiler'],hasStandaloneChange:true},
    unavailable:{enabled:false,allowedExtras:[null],hasStandaloneChange:true},
  },
  extras:{widebody:{enabled:true},spoiler:{enabled:true},retired:{enabled:false}},
  colors:{matte_black:{enabled:true,isKeep:false},metallic_silver:{enabled:true,isKeep:false},keep:{enabled:true,isKeep:true},retired:{enabled:false,isKeep:false}},
});
const request = (overrides={}) => ({schemaVersion:3,operation:'build',source:{kind:'original'},styleId:'street',extraId:'widebody',colorId:'matte_black',...overrides});
const run = (r=request(), c=published()) => parseSecResearchRequest(r,c);
const rejects = (r,code,c=published()) => assert.throws(()=>run(r,c), e=>e?.code===code);

test('validator is explicitly research-only, no provider or billing hooks',()=>{
 const x=run();assert.equal(x.researchOnly,true);assert.equal(typeof LAB_INTENT_VERSION,'string');
 for(const k of ['quote','charge','send','provider','owner','consent','wallet'])assert.equal(k in x,false);
});
test('build request is kept distinct from legacy schemaVersion 2',()=>rejects(request({schemaVersion:2}),'NOT_SEC_BUILD_V3'));
test('old explore operation is not silently reinterpreted as build',()=>rejects(request({operation:'explore'}),'NOT_SEC_BUILD_V3'));
test('old detail operation is not silently reinterpreted as build',()=>rejects(request({operation:'detail'}),'NOT_SEC_BUILD_V3'));
test('valid original build gives one immutable output-intent snapshot',()=>{
 const x=run();assert.equal(x.requestedIntent.outputCount,1);
 assert.deepEqual(x.requestedIntent.source,{kind:'original'});
 assert.equal(x.requestedIntent.styleId,'street');assert.equal(x.requestedIntent.extraId,'widebody');
 assert.equal(x.requestedIntent.colorId,'matte_black');assert.equal(Object.isFrozen(x.requestedIntent),true);
});
test('same catalog and request yields identical values',()=>assert.deepEqual(run(),run()));
test('explicit no-extra is supported for color changes',()=>{
 const x=run(request({extraId:null}));assert.equal(x.requestedIntent.extraId,null);
});
test('styles with verified standalone effect can be meaningful without extra/color',()=>{
 const x=run(request({styleId:'touring',extraId:null,colorId:'keep'}));assert.equal(x.requestedIntent.outputCount,1);
});
test('a style label with no actual modification is not itself an effective change',()=>rejects(request({extraId:null,colorId:'keep'}),'NO_EFFECTIVE_CHANGE'));
test('rejects incompatible style-extra pair before any quote is possible',()=>rejects(request({styleId:'touring',extraId:'widebody'}),'COMBINATION_INCOMPATIBLE'));
test('unknown style ID rejected',()=>rejects(request({styleId:'other'}),'STYLE_NOT_PUBLISHED'));
test('unknown extra ID rejected',()=>rejects(request({extraId:'other'}),'EXTRA_NOT_PUBLISHED'));
test('unknown color ID rejected',()=>rejects(request({colorId:'purple'}),'COLOR_NOT_PUBLISHED'));
test('disabled style is not silently published',()=>rejects(request({styleId:'unavailable',extraId:null}),'STYLE_DISABLED'));
test('disabled extra not chargeable',()=>rejects(request({extraId:'retired'}),'EXTRA_DISABLED'));
test('disabled color not chargeable',()=>rejects(request({colorId:'retired'}),'COLOR_DISABLED'));
test('extra must be one scalar and not an array',()=>rejects(request({extraId:['widebody','spoiler']}),'EXTRA_NOT_PUBLISHED'));
test('free text or client-provided model is not in the API',()=>rejects(request({userPrompt:'Make a spaceship'}),'REQUEST_SHAPE_INVALID'));
test('client cannot set a permission flag on request',()=>rejects(request({researchEnabled:true}),'REQUEST_SHAPE_INVALID'));
test('client cannot force provider or price',()=>rejects(request({supplier:'secret-provider'}),'REQUEST_SHAPE_INVALID'));
test('anonymous or empty catalog fails closed',()=>rejects(request(),'CATALOG_UNAVAILABLE',{}));
test('default-off catalog fails closed',()=>rejects(request(),'CATALOG_UNAVAILABLE',{...published(),researchEnabled:false}));
test('catalog with no immutable versions cannot produce frozen intent',()=>rejects(request(),'CATALOG_VERSION_INVALID',{...published(),templateVersion:undefined}));
test('exact saved source retained, not replaced with latest',()=>{
 const x=run(request({source:{kind:'version',versionId:'v_0123'}}));
 assert.deepEqual(x.requestedIntent.source,{kind:'version',versionId:'v_0123'});
});
test('saved-version source requires separately published capability',()=>rejects(request({source:{kind:'version',versionId:'v_0123'}}),'VERSION_SOURCE_NOT_SUPPORTED',{...published(),versionSourceEnabled:false}));
test('arbitrary foreign image URL is not a valid source',()=>rejects(request({source:{kind:'url',url:'https://example.com/car'}}),'INVALID_SOURCE'));
test('invalid saved version id is rejected',()=>rejects(request({source:{kind:'version',versionId:'../asset'}}),'INVALID_VERSION_SOURCE'));
test('hidden extra property in original source is rejected',()=>rejects(request({source:{kind:'original',versionId:'v_0123'}}),'INVALID_SOURCE'));
test('catalog template version is pinned in intent',()=>{
 const x=run(request(),{...published(),templateVersion:'sec-template-r9'});
 assert.equal(x.requestedIntent.templateVersion,'sec-template-r9');
});
test('catalog capability version pinned for replay',()=>{
 const x=run();assert.equal(x.requestedIntent.capabilityVersion,'sec-capability-r1');
});
test('all output fields have controlled origin, not arbitrary provider prompt',()=>{
 const x=run();assert.deepEqual(Object.keys(x.requestedIntent),['schemaVersion','operation','source','styleId','extraId','colorId','catalogVersion','templateVersion','capabilityVersion','outputCount']);
});
