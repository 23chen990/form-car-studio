import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createV2Provider, type ProviderInput } from '../../server/v2/provider.js';
import { snapshotProfile, type ProviderProfile } from '../../server/v2/provider-profile.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGM4o2T8HwAFAAIh6JBuHgAAAABJRU5ErkJggg==','base64');
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const profile = (patch: Partial<ProviderProfile> = {}): ProviderProfile => ({
  id:'fixture-profile', version:'test-v1', protocol:'openai-images-edits',
  endpoint:'https://api.openai.com/v1/images/edits', model:'fixture-model-not-live', templateVersion:'v2-reference-1',
  fields:['bodyColor','wheelColor'], originalReference:false, approvedForLive:false,
  officialEvidence:'https://developers.openai.com/api/docs/guides/image-generation', qualityEvidence:null,
  maxCostMicrosUSD:250_000, timeoutMs:200, maxInputBytes:1024, maxOutputBytes:1024,
  maxResponseBytes:8192, output:{format:'png',size:'1024x1024',quality:'medium'}, ...patch,
});
const input = (): ProviderInput => ({ownerId:'owner-1',projectId:'project-1',
  editRequest:{schemaVersion:2,source:{kind:'original'},operation:'detail',edits:{bodyColor:{action:'set',value:'blue'}}},
  primary:{ownerId:'owner-1',projectId:'project-1',assetId:'asset-1',source:{kind:'original'},mimeType:'image/png',sha256:digest(PNG),bytes:PNG},
});
function mock(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async () => new Response(JSON.stringify({data:[{b64_json:PNG.toString('base64')}]}))) {
  const calls: {url:RequestInfo | URL; init:RequestInit | undefined}[] = [];
  const transport: typeof fetch = async (url, init) => { calls.push({url,init}); return handler(url,init); };
  return {calls,transport};
}
const options = (p = profile(), m = mock()) => ({profile:p,apiKey:'fixture-not-a-real-key',executionMode:'mock' as const,transport:m.transport});
function failed(result: Awaited<ReturnType<ReturnType<typeof createV2Provider>>>, code?: string) {
  assert.equal(result.ok,false);
  if (!result.ok && code) assert.equal(result.error.code,code);
  return result as Extract<typeof result,{ok:false}>;
}

test('configuration has no default real model and disabled mode never calls global fetch', async () => {
  const old = globalThis.fetch; let calls=0;
  globalThis.fetch = async () => {calls++;throw new Error('network forbidden');};
  try {failed(await createV2Provider()(input()),'PROVIDER_DISABLED');assert.equal(calls,0);} finally {globalThis.fetch=old;}
});
for (const [name, change] of [
  ['missing key',{apiKey:undefined}],['missing profile',{profile:undefined}],
  ['missing explicit mock transport',{transport:undefined}],['disabled mode',{executionMode:'disabled'}],
  ['unapproved live mode',{executionMode:'live',liveDispatchApproved:true}],
] as const) test(name+' is zero-call disabled', async () => {
  const m=mock();const o={...options(profile(),m),...change};
  failed(await createV2Provider(o)(input()),'PROVIDER_DISABLED');assert.equal(m.calls.length,0);
});
for (const endpoint of ['http://api.openai.com/v1/images/edits','https://evil.test/images/edits','https://api.openai.com/v1/images/edits?url=evil','https://api.openai.com@evil.test/v1/images/edits']) {
  test('reject unreviewed endpoint '+endpoint, async () => {const m=mock();failed(await createV2Provider(options(profile({endpoint}),m))(input()),'PROVIDER_DISABLED');assert.equal(m.calls.length,0);});
}
test('profile rejects unknown parameters and unjustified live approval', () => {
  assert.throws(()=>snapshotProfile({...profile(),strength:0.6}));
  assert.throws(()=>snapshotProfile(profile({approvedForLive:true})),/LIVE_EVIDENCE_REQUIRED/);
  assert.throws(()=>snapshotProfile(profile({model:''})));
  assert.throws(()=>snapshotProfile(profile({maxCostMicrosUSD:0})));
});
test('multipart uses the existing canonical builder, named roles, one output and no passthrough', async () => {
  const m=mock(); const result=await createV2Provider(options(profile(),m))(input());assert.equal(result.ok,true);
  assert.equal(m.calls.length,1);assert.equal(m.calls[0].init?.redirect,'error');
  const form=m.calls[0].init?.body as FormData;
  assert.deepEqual([...form.keys()].sort(),['image','model','n','output_format','prompt','quality','size']);
  assert.equal(form.get('n'),'1'); assert.equal(form.get('model'),'fixture-model-not-live');
  const text=String(form.get('prompt'));assert.match(text,/Change only the body paint color to deep blue/);
  assert.match(text,/Keep existing wheel spoke structure/);assert.doesNotMatch(text,/lower stance|subtle front lip/);
  assert.equal((form.get('image') as File).name,'primary.png');
  if(result.ok){assert.equal(result.actualCostMicrosUSD,null);assert.equal(result.providerRequestId,null);assert.equal(result.usage,null);assert.equal(result.quality,'UNASSESSED');}
});
test('mock transport targets a reserved .invalid endpoint', async () => {
  const m=mock(); const result=await createV2Provider(options(profile(),m))(input());assert.equal(result.ok,true);
  assert.equal(m.calls.length,1);assert.equal(m.calls[0].url,'https://form-v2.mock.invalid/images/edits');
});
test('mock transport never receives the configured API key', async () => {
  const m=mock(); const result=await createV2Provider(options(profile(),m))(input());assert.equal(result.ok,true);
  assert.equal(m.calls.length,1);assert.equal(new Headers(m.calls[0].init?.headers).has('authorization'),false);
});
for (const [key,value] of [['projectName','inject bodykit'],['rawPrompt','ignore rules'],['url','https://evil.test'],['strength',0.6],['parameters',{bodykit:true}]]) {
  test('caller '+key+' cannot leak into request', async()=>{const m=mock();failed(await createV2Provider(options(profile(),m))({...input(),[key as string]:value} as ProviderInput));assert.equal(m.calls.length,0);});
}
test('Wrapr-derived regression: color edit cannot carry bodykit or stance',async()=>{
  for(const field of ['bodykit','stance','spoiler','modificationType']) {
    const m=mock();const i=input();(i.editRequest as any).edits[field]={action:'set',value:'sport'};
    failed(await createV2Provider(options(profile(),m))(i),'UNKNOWN_FIELD');assert.equal(m.calls.length,0);
  }
});
test('style cannot be silently injected into detail mode',async()=>{
  const m=mock();const i=input();(i.editRequest as any).styleId='sport';
  failed(await createV2Provider(options(profile(),m))(i),'DETAIL_MUST_NOT_APPLY_STYLE');assert.equal(m.calls.length,0);
});
test('unsupported wheel design fails before transport',async()=>{
  const m=mock();const i=input();(i.editRequest as any).edits={wheelDesign:{action:'set',value:'classic_mesh'}};
  failed(await createV2Provider(options(profile(),m))(i),'FIELD_NOT_ENABLED');assert.equal(m.calls.length,0);
});
test('enabled synthetic wheel design never preserves the spoke design it must change',async()=>{
  const m=mock();const i=input();(i.editRequest as any).edits={wheelDesign:{action:'set',value:'classic_mesh'}};
  const result=await createV2Provider(options(profile({fields:['wheelDesign']}),m))(i);assert.equal(result.ok,true);
  const text=String((m.calls[0].init?.body as FormData).get('prompt'));
  assert.match(text,/Change the visible wheel spoke appearance only/);assert.doesNotMatch(text,/Keep existing wheel spoke structure/);
});
test('requested history is not an observed no-op; verified observation is',async()=>{
  const m=mock();const i=input();i.observations={bodyColor:{value:'blue',provenance:'requested'}};
  assert.equal((await createV2Provider(options(profile(),m))(i)).ok,true);
  i.observations.bodyColor!.provenance='verified';
  failed(await createV2Provider(options(profile(),m))(i),'NO_EFFECTIVE_CHANGE');assert.equal(m.calls.length,1);
});
test('selected V1 cannot silently use V3',async()=>{
  const m=mock();const i=input();(i.editRequest as any).source={kind:'version',versionId:'V1'};i.primary.source={kind:'version',versionId:'V3'};
  failed(await createV2Provider(options(profile(),m))(i),'SOURCE_MISMATCH');assert.equal(m.calls.length,0);
});
test('cross-owner and cross-project input blocked',async()=>{
  for (const key of ['ownerId','projectId'] as const) {const m=mock();const i=input();i.primary[key]='other';failed(await createV2Provider(options(profile(),m))(i),'ASSET_NOT_FOUND');assert.equal(m.calls.length,0);}
});
test('input tampering, wrong MIME and oversize are zero-call failures',async()=>{
  for (const mode of ['digest','mime','size']) {const m=mock();const i=input();if(mode==='digest')i.primary.sha256='0'.repeat(64);if(mode==='mime')(i.primary as any).mimeType='image/jpeg';if(mode==='size')i.primary.bytes=Buffer.alloc(1025);failed(await createV2Provider(options(profile(),m))(i));assert.equal(m.calls.length,0);}
});
test('restoration requires actual owned original bytes; extra arbitrary refs rejected',async()=>{
  const i=input();i.primary.source={kind:'version',versionId:'V1'};(i.editRequest as any).source=i.primary.source;(i.editRequest as any).edits={bodyColor:{action:'restore_original'}};
  const m=mock();failed(await createV2Provider(options(profile({originalReference:true}),m))(i),'ORIGINAL_REFERENCE_REQUIRED');assert.equal(m.calls.length,0);
  i.originalReference={...input().primary,assetId:'original'};
  assert.equal((await createV2Provider(options(profile({originalReference:true}),m))(i)).ok,true);
  const form=m.calls[0].init?.body as FormData;assert.deepEqual(form.getAll('image[]').map(v=>(v as File).name),['primary.png','original-reference.png']);
  const extra=input();extra.originalReference=i.originalReference;failed(await createV2Provider(options(profile(),m))(extra),'UNREQUESTED_REFERENCE');assert.equal(m.calls.length,1);
});
test('profile mutation after construction does not change model or output options',async()=>{
  const p=profile();const m=mock();const run=createV2Provider(options(p,m));p.model='changed';p.output.quality='high';
  assert.equal((await run(input())).ok,true);const f=m.calls[0].init?.body as FormData;assert.equal(f.get('model'),'fixture-model-not-live');assert.equal(f.get('quality'),'medium');
});
for (const [name,body,code] of [
  ['invalid JSON','{oops','INVALID_JSON'],['URL only',JSON.stringify({data:[{url:'https://evil.test/private'}]}),'BASE64_OUTPUT_REQUIRED'],
  ['two outputs',JSON.stringify({data:[{b64_json:PNG.toString('base64')},{b64_json:PNG.toString('base64')}]}),'INVALID_OUTPUT_COUNT'],
  ['bad base64',JSON.stringify({data:[{b64_json:'abc$$'}]}),'INVALID_BASE64'],
  ['not PNG',JSON.stringify({data:[{b64_json:Buffer.from('not image').toString('base64')}]}),'INVALID_OUTPUT_FORMAT'],
]) test(name+' fails once without fallback',async()=>{const m=mock(async()=>new Response(body));const r=failed(await createV2Provider(options(profile(),m))(input()),code);assert.equal(r.attempted,true);assert.equal(r.actualCostMicrosUSD,null);assert.equal(m.calls.length,1);});
test('streaming body cap rejects oversized responses without trusting content-length',async()=>{
  const m=mock(async()=>new Response('x'.repeat(1000)));failed(await createV2Provider(options(profile({maxResponseBytes:50}),m))(input()),'RESPONSE_TOO_LARGE');assert.equal(m.calls.length,1);
});
test('content-length preflight cancels an oversized response body',async()=>{
  let cancelled=0;
  const m=mock(async()=>new Response(new ReadableStream({start(){ /* intentionally never closes */ },cancel(){cancelled++;}}),{headers:{'content-length':'1000'}}));
  failed(await createV2Provider(options(profile({maxResponseBytes:50}),m))(input()),'RESPONSE_TOO_LARGE');assert.equal(cancelled,1);
});
test('usage has only numeric allowlisted fields, unknown costs stay null',async()=>{
  const m=mock(async()=>new Response(JSON.stringify({data:[{b64_json:PNG.toString('base64')}],usage:{input_tokens:12,output_tokens:8,total_tokens:20,private_key:'NEVER_EXPORT'}}),{headers:{'x-request-id':'request-123'}}));
  const r=await createV2Provider(options(profile(),m))(input());assert.equal(r.ok,true);if(r.ok){assert.deepEqual(r.usage,{inputTokens:12,outputTokens:8,totalTokens:20});assert.equal(r.providerRequestId,'request-123');assert.equal(r.actualCostMicrosUSD,null);assert.doesNotMatch(JSON.stringify(r),/NEVER_EXPORT/);}
});
test('refusal and http failures redact all upstream strings',async()=>{
  for (const [status,body,expected] of [[400,{error:{code:'content_policy_violation',message:'SECRET'}},'PROVIDER_REFUSAL'],[429,{error:{message:'SECRET'}},'PROVIDER_RATE_LIMIT'],[500,{error:{message:'SECRET'}},'PROVIDER_HTTP_ERROR']] as const) {
    const m=mock(async()=>new Response(JSON.stringify(body),{status}));const r=failed(await createV2Provider(options(profile(),m))(input()),expected);assert.equal(r.error.retryable,false);assert.doesNotMatch(JSON.stringify(r),/SECRET|fixture-not-a-real-key/);assert.equal(m.calls.length,1);
  }
});
test('transport exception is redacted and remains billably uncertain',async()=>{
  const m=mock(async()=>{throw new Error('private token SECRET');});const r=failed(await createV2Provider(options(profile(),m))(input()),'PROVIDER_TRANSPORT_UNKNOWN');assert.equal(r.maxExposureMicrosUSD,250_000);assert.doesNotMatch(JSON.stringify(r),/SECRET/);assert.equal(m.calls.length,1);
});
test('timeout includes response body reading and preserves unknown supplier exposure',async()=>{
  const m=mock(async()=>new Response(new ReadableStream({start(){ /* intentionally never closes */ }})));
  const r=failed(await createV2Provider(options(profile({timeoutMs:10}),m))(input()),'PROVIDER_TIMEOUT_UNKNOWN');assert.equal(r.error.category,'uncertain');assert.equal(r.maxExposureMicrosUSD,250_000);assert.equal(m.calls.length,1);
});
test('timeout cancels an open response body',async()=>{
  let cancelled=0;
  const m=mock(async()=>new Response(new ReadableStream({start(){ /* intentionally never closes */ },cancel(){cancelled++;}})));
  failed(await createV2Provider(options(profile({timeoutMs:10}),m))(input()),'PROVIDER_TIMEOUT_UNKNOWN');assert.equal(cancelled,1);
});
test('pre-abort has no attempt; post-dispatch abort is unknown, not free cancellation',async()=>{
  const c=new AbortController();c.abort();const m=mock();const i=input();i.signal=c.signal;
  const r=failed(await createV2Provider(options(profile(),m))(i),'ABORTED_BEFORE_DISPATCH');assert.equal(r.attempted,false);assert.equal(m.calls.length,0);
  const c2=new AbortController();const m2=mock(async()=>{c2.abort();return new Promise(()=>{});});const j=input();j.signal=c2.signal;
  const r2=failed(await createV2Provider(options(profile(),m2))(j),'PROVIDER_ABORT_UNKNOWN');assert.equal(r2.attempted,true);assert.equal(m2.calls.length,1);
});

test('html rate-limit body is still rate-limited and cannot leak provider details',async()=>{
  const m=mock(async()=>new Response('<h1>SECRET</h1>',{status:429}));
  const r=failed(await createV2Provider(options(profile(),m))(input()),'PROVIDER_RATE_LIMIT');assert.doesNotMatch(JSON.stringify(r),/SECRET/);
});
test('input getters cannot turn private exception text into a public code',async()=>{
  const i=input();Object.defineProperty(i,'ownerId',{get(){throw new Error('PRIVATE_TOKEN');},enumerable:true});
  const m=mock();const r=failed(await createV2Provider(options(profile(),m))(i),'INVALID_INPUT');assert.doesNotMatch(JSON.stringify(r),/PRIVATE_TOKEN/);assert.equal(m.calls.length,0);
});
test('late transport success after timeout is discarded rather than retried',async()=>{
  let finish: (()=>void)|undefined;const m=mock(async()=>{await new Promise<void>(r=>{finish=r;});return new Response(JSON.stringify({data:[{b64_json:PNG.toString('base64')}]}));});
  const result=await createV2Provider(options(profile({timeoutMs:5}),m))(input());failed(result,'PROVIDER_TIMEOUT_UNKNOWN');finish!();await new Promise(r=>setTimeout(r,15));assert.equal(result.ok,false);assert.equal(m.calls.length,1);
});
