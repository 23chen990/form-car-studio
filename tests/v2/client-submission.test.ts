import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlanQuoteDTO, SafeTaskDTO } from '../../src/lib/api-v2.js';
import type { EditRequest, Field } from '../../shared/v2/edit-plan.js';

class MemoryStorage {
  readonly values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('storage unavailable');
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

const task: SafeTaskDTO = {
  id: 'task-1', projectId: 'project-1', planId: 'plan-1', status: 'queued', userCostUnits: 1,
  createdAt: '2026-10-13T03:00:00.000Z', updatedAt: null, resultVersionId: null,
  creditReturned: false, safeErrorCode: null,
};
const quoteIdentity = (planId = 'plan-1') => ({ planId, projectId: 'project-1', expiresAt: '2026-10-13T03:10:00.000Z' });
const response = (body: unknown, status = 202) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const planQuote = (ownerId = 'owner-a', projectId = 'project-1', planId = 'plan-1'): PlanQuoteDTO => ({
  schemaVersion: 1, planId, createdAt: '2026-10-13T03:00:00.000Z', expiresAt: '2026-10-13T03:10:00.000Z', planDigest: 'a'.repeat(64),
  semantic: {
    ownerId, projectId, walletScope: 'demo', executionMode: 'licensed_demo', supplierExposureMicrosUSD: 0, userCostUnits: 1, outputCount: 1,
    source: { kind: 'original', assetId: 'asset-1', assetKind: 'original', persistedSha256: 'a'.repeat(64), rawSha256: 'b'.repeat(64), canonicalSha256: 'c'.repeat(64), pixelSha256: 'd'.repeat(64), bytes: 10, width: 10, height: 10, rawGeometry: { width: 10, height: 10 }, canonicalGeometry: { width: 10, height: 10 }, normalizerVersion: 'normalizer-v1', sourceFormat: 'png', sourceOrientation: null },
    requestEdits: { schemaVersion: 2, source: { kind: 'original' }, operation: 'detail', edits: { bodyColor: { action: 'set', value: 'blue' } } },
    desiredRecipe: { changes: [{ field: 'bodyColor', action: 'set', value: 'blue' }], preserve: ['wheelColor', 'bodyFinish', 'wheelDesign'] as Field[], inherited: { styleId: null, verification: 'unknown', requested: [], preserve: ['bodyColor', 'wheelColor', 'bodyFinish', 'wheelDesign'] as Field[] } },
    observedRecipe: { status: 'unknown', fields: {} },
  },
});
const quote = (planId = 'plan-1') => planQuote('owner-a', 'project-1', planId);

async function modules() {
  const storeModule = await import('../../src/lib/submission-store.js');
  const apiModule = await import('../../src/lib/api-v2.js');
  return { ...storeModule, ...apiModule };
}

test('persists the exact submission identity before POST and validates the returned task DTO', async () => {
  const { createSubmissionStore, createV2Api } = await modules();
  const storage = new MemoryStorage();
  const store = createSubmissionStore({ storage, createId: () => 'submit-1', now: () => '2026-10-13T03:00:00.000Z' });
  store.activateActor('owner-a');
  let sent: RequestInit | undefined;
  const api = createV2Api({ store, fetcher: async (input, init) => {
    assert.equal(String(input), '/api/v2/tasks');
    assert.equal(store.list('owner-a')[0]?.submissionId, 'submit-1');
    sent = init;
    return response(task);
  } });
  const result = await api.submitConfirmedPlan('owner-a', quote(), 'consent-1');
  assert.deepEqual(result, task);
  assert.equal(sent?.method, 'POST');
  assert.equal(new Headers(sent?.headers).get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(String(sent?.body)), { planId: 'plan-1', submissionId: 'submit-1', consentRecordId: 'consent-1' });
  assert.equal(storage.values.size, 1);
});

test('refresh recovery resolves an accepted task by the same owner-scoped submission ID', async () => {
  const { createSubmissionStore, createV2Api, V2NetworkError } = await modules();
  const storage = new MemoryStorage();
  const store = createSubmissionStore({ storage, createId: () => 'submit-1' });
  store.activateActor('owner-a');
  let firstBody = '';
  const first = createV2Api({ store, fetcher: async (_input, init) => {
    firstBody = String(init?.body);
    throw new TypeError('network details must not escape');
  } });
  await assert.rejects(first.submitConfirmedPlan('owner-a', quote(), 'consent-1'), V2NetworkError);
  const acceptedReplay = createV2Api({ store, fetcher: async input => {
    assert.equal(String(input), '/api/v2/submissions/submit-1');
    return response(task, 200);
  } });
  const recovered = await acceptedReplay.resumeSubmission('owner-a', 'submit-1');
  assert.deepEqual(recovered, task);
  assert.deepEqual(JSON.parse(firstBody), { planId: 'plan-1', submissionId: 'submit-1', consentRecordId: 'consent-1' });
  assert.equal(store.list('owner-a')[0]?.submissionId, 'submit-1');
});

test('404 recovery replays the exact body and identity instead of minting a new submission', async () => {
  const { createSubmissionStore, createV2Api } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage(), createId: () => 'submit-stable' });
  store.activateActor('owner-a');
  let postCount = 0;
  const api = createV2Api({ store, fetcher: async (input, init) => {
    if (String(input).includes('/submissions/')) return response({ code: 'TASK_NOT_FOUND', message: 'Not found.', retryable: false, requestId: 'req-1' }, 404);
    postCount++;
    assert.deepEqual(JSON.parse(String(init?.body)), { planId: 'plan-1', submissionId: 'submit-stable', consentRecordId: 'consent-1' });
    return response(task, 200);
  } });
  const first = await api.submitConfirmedPlan('owner-a', quote(), 'consent-1');
  const replay = await api.resumeSubmission('owner-a', 'submit-stable');
  assert.equal(first.id, replay.id);
  assert.equal(postCount, 2);
  assert.equal(store.list('owner-a').length, 1);
});

test('HTTP errors retain their structured fields and remain distinct from uncertain network failures', async () => {
  const { createSubmissionStore, createV2Api, V2HttpError, V2NetworkError } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage(), createId: () => 'submit-1' });
  store.activateActor('owner-a');
  const expired = createV2Api({ store, fetcher: async () => response({ code: 'PLAN_EXPIRED', message: 'Quote expired.', retryable: false, requestId: 'opaque-7' }, 409) });
  await assert.rejects(expired.submitConfirmedPlan('owner-a', quote(), 'consent-1'), error => {
    assert.ok(error instanceof V2HttpError);
    assert.equal(error.status, 409); assert.equal(error.code, 'PLAN_EXPIRED'); assert.equal(error.retryable, false); assert.equal(error.requestId, 'opaque-7');
    return true;
  });
  assert.equal(store.list('owner-a').length, 1);
  const network = createV2Api({ store, fetcher: async () => { throw new TypeError('raw private URL or token'); } });
  await assert.rejects(network.submitConfirmedPlan('owner-a', quote(), 'consent-1'), error => error instanceof V2NetworkError && !error.message.includes('private URL'));
  assert.equal(store.list('owner-a')[0]?.submissionId, 'submit-1');
});

test('successful but invalid task JSON is uncertain and keeps the same pending identity', async () => {
  const { createSubmissionStore, createV2Api, V2UncertainResponseError } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage(), createId: () => 'submit-1' });
  store.activateActor('owner-a');
  const api = createV2Api({ store, fetcher: async () => new Response('{"id":"accepted-but-invalid"}', { status: 202, headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(api.submitConfirmedPlan('owner-a', quote(), 'consent-1'), V2UncertainResponseError);
  assert.equal(store.list('owner-a')[0]?.submissionId, 'submit-1');
});

test('local storage failure blocks the network request before submission', async () => {
  const { createSubmissionStore, createV2Api, SubmissionStoreError } = await modules();
  const storage = new MemoryStorage(); storage.failWrites = true;
  const store = createSubmissionStore({ storage, createId: () => 'submit-1' }); store.activateActor('owner-a');
  let calls = 0;
  const api = createV2Api({ store, fetcher: async () => { calls++; return response(task); } });
  await assert.rejects(api.submitConfirmedPlan('owner-a', quote(), 'consent-1'), SubmissionStoreError);
  assert.equal(calls, 0);
});

test('secure getRandomValues fallback emits an RFC 4122 v4 identity without Node crypto', async () => {
  const { createSubmissionStore } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage(), crypto: { getRandomValues(bytes: Uint8Array) { bytes.fill(0); return bytes; } } });
  store.activateActor('owner-a');
  const lease = store.begin('owner-a', quoteIdentity(), 'consent-1');
  assert.equal(lease.submission.submissionId, '00000000-0000-4000-8000-000000000000');
});

test('missing secure randomness blocks submission before writing or calling the network', async () => {
  const { createSubmissionStore, createV2Api, SubmissionStoreError } = await modules();
  const storage = new MemoryStorage();
  const store = createSubmissionStore({ storage, crypto: null }); store.activateActor('owner-a');
  let calls = 0;
  const api = createV2Api({ store, fetcher: async () => { calls++; return response(task); } });
  await assert.rejects(api.submitConfirmedPlan('owner-a', quote(), 'consent-1'), SubmissionStoreError);
  assert.equal(calls, 0); assert.equal(storage.values.size, 0);
});

test('owner namespaces are isolated and logout clears only the selected owner', async () => {
  const { createSubmissionStore } = await modules();
  const storage = new MemoryStorage();
  const store = createSubmissionStore({ storage, createId: (() => { let n = 0; return () => `submit-${++n}`; })() });
  store.activateActor('owner-a'); store.begin('owner-a', quoteIdentity(), 'consent-a');
  store.activateActor('owner-b'); store.begin('owner-b', quoteIdentity(), 'consent-b');
  assert.equal(store.list('owner-b')[0]?.consentRecordId, 'consent-b');
  store.clearActor('owner-a');
  assert.equal(store.list('owner-b').length, 1);
  store.activateActor('owner-a');
  assert.equal(store.list('owner-a').length, 0);
});

test('a delayed response after logout or actor switch cannot restore the cleared old-owner pointer', async () => {
  const { createSubmissionStore, createV2Api, V2ActorChangedError } = await modules();
  const storage = new MemoryStorage();
  const store = createSubmissionStore({ storage, createId: (() => { let n = 0; return () => `submit-${++n}`; })() });
  store.activateActor('owner-b'); store.begin('owner-b', quoteIdentity('plan-b'), 'consent-b');
  store.activateActor('owner-a');
  let finish!: (value: Response) => void;
  const waiting = new Promise<Response>(resolve => { finish = resolve; });
  const api = createV2Api({ store, fetcher: async () => waiting });
  const submission = api.submitConfirmedPlan('owner-a', quote(), 'consent-a');
  store.clearActor('owner-a');
  store.activateActor('owner-b');
  finish(response(task));
  await assert.rejects(submission, V2ActorChangedError);
  assert.equal(store.list('owner-b')[0]?.consentRecordId, 'consent-b');
  store.activateActor('owner-a');
  assert.equal(store.list('owner-a').length, 0);
});

test('a delayed owner-scoped lookup is discarded after logout and actor switch', async () => {
  const { createSubmissionStore, createV2Api, V2ActorChangedError } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage(), createId: () => 'submit-a' });
  store.activateActor('owner-a'); store.begin('owner-a', quoteIdentity(), 'consent-a');
  let finish!: (value: Response) => void;
  const waiting = new Promise<Response>(resolve => { finish = resolve; });
  const api = createV2Api({ store, fetcher: async () => waiting });
  const lookup = api.resumeSubmission('owner-a', 'submit-a');
  store.clearActor('owner-a'); store.activateActor('owner-b'); store.begin('owner-b', quoteIdentity('plan-b'), 'consent-b');
  finish(response(task, 200));
  await assert.rejects(lookup, V2ActorChangedError);
  assert.equal(store.list('owner-b')[0]?.consentRecordId, 'consent-b');
});

test('plan quote request carries only same-origin consent and accepts the complete owner-bound semantic snapshot', async () => {
  const { createSubmissionStore, createV2Api } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage() }); store.activateActor('owner-a');
  const edit: EditRequest = { schemaVersion: 2, source: { kind: 'original' }, operation: 'detail', edits: { bodyColor: { action: 'set', value: 'blue' } } };
  const api = createV2Api({ store, fetcher: async (input, init) => {
    assert.equal(String(input), '/api/v2/projects/project-1/plans');
    assert.equal(new Headers(init?.headers).get('X-Form-Consent-Id'), 'consent-1');
    assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), edit);
    return response(planQuote());
  } });
  const result = await api.quotePlan('owner-a', 'project-1', 'consent-1', edit);
  assert.equal(result.semantic.outputCount, 1);
});

test('incomplete or cross-owner plan snapshots are not accepted as confirmed quotes', async () => {
  const { createSubmissionStore, createV2Api, V2UncertainResponseError } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage() }); store.activateActor('owner-a');
  const edit = planQuote().semantic.requestEdits;
  for (const invalid of [
    (() => { const value = structuredClone(planQuote()); delete (value.semantic as Record<string, unknown>).source; return value; })(),
    (() => { const value = structuredClone(planQuote()); (value.semantic as Record<string, unknown>).outputCount = 2; return value; })(),
    (() => { const value = structuredClone(planQuote()); delete (value.semantic as Record<string, unknown>).desiredRecipe; return value; })(),
    (() => { const value = structuredClone(planQuote()); delete (value.semantic as Record<string, unknown>).observedRecipe; return value; })(),
    (() => { const value = structuredClone(planQuote()); delete (value.semantic as Record<string, unknown>).requestEdits; return value; })(),
    planQuote('owner-b'),
    (() => { const value = structuredClone(planQuote()); (value.semantic as Record<string, unknown>).projectId = 'other-project'; return value; })(),
  ]) {
    const api = createV2Api({ store, fetcher: async () => response(invalid, 201) });
    await assert.rejects(api.quotePlan('owner-a', 'project-1', 'consent-1', edit), V2UncertainResponseError);
  }
});

test('oversized successful responses are cancelled and treated as uncertain without parsing raw content', async () => {
  const { createSubmissionStore, createV2Api, V2UncertainResponseError } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage(), createId: () => 'submit-1' }); store.activateActor('owner-a');
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } });
  const api = createV2Api({ store, fetcher: async () => new Response(body, { status: 202, headers: { 'content-length': String(129 * 1024) } }) });
  await assert.rejects(api.submitConfirmedPlan('owner-a', quote(), 'consent-1'), V2UncertainResponseError);
  assert.equal(cancelled, true);
  assert.equal(store.list('owner-a')[0]?.submissionId, 'submit-1');
});

test('only an explicit server-confirmed terminal acknowledgment prunes a stored submission', async () => {
  const { createSubmissionStore, createV2Api } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage(), createId: () => 'submit-1' });
  store.activateActor('owner-a'); store.begin('owner-a', quoteIdentity(), 'consent-1');
  let dto: SafeTaskDTO = { ...task, status: 'queued' };
  const api = createV2Api({ store, fetcher: async () => response(dto, 200) });
  const active = await api.acknowledgeTerminalSubmission('owner-a', 'submit-1');
  assert.equal(active.removed, false);
  assert.equal(store.list('owner-a').length, 1);
  dto = { ...task, status: 'failed', updatedAt: '2026-10-13T03:01:00.000Z', safeErrorCode: 'GENERATION_FAILED' };
  const terminal = await api.acknowledgeTerminalSubmission('owner-a', 'submit-1');
  assert.equal(terminal.removed, true);
  assert.equal(terminal.task.status, 'failed');
  assert.equal(store.list('owner-a').length, 0);
});

test('incoherent task states cannot clear a pending confirmation as a completed result', async () => {
  const { createSubmissionStore, createV2Api, V2UncertainResponseError } = await modules();
  const store = createSubmissionStore({storage:new MemoryStorage(),createId:()=> 'submit-state'});
  store.activateActor('owner-a'); store.begin('owner-a', quoteIdentity(), 'consent-1');
  for (const invalid of [
    {...task,status:'succeeded' as const,resultVersionId:null},
    {...task,status:'processing' as const,resultVersionId:'version-before-success'},
    {...task,status:'queued' as const,creditReturned:true},
    {...task,userCostUnits:0},
  ]) {
    const api = createV2Api({store,fetcher:async()=>response(invalid,200)});
    await assert.rejects(api.acknowledgeTerminalSubmission('owner-a','submit-state'),V2UncertainResponseError);
    assert.equal(store.list('owner-a').length,1);
  }
});

test('expired plans require a new explicit quote and never mint another ID for the old quote', async () => {
  const { createSubmissionStore, createV2Api, V2HttpError } = await modules();
  const ids = ['submit-old', 'submit-new'];
  const store = createSubmissionStore({ storage: new MemoryStorage(), createId: () => ids.shift()! });
  store.activateActor('owner-a');
  const api = createV2Api({ store, fetcher: async () => response({ code: 'PLAN_EXPIRED', message: 'Quote expired.', retryable: false, requestId: 'req-expired' }, 409) });
  await assert.rejects(api.submitConfirmedPlan('owner-a', quote(), 'consent-1'), V2HttpError);
  await assert.rejects(api.submitConfirmedPlan('owner-a', quote(), 'consent-1'), V2HttpError);
  assert.equal(store.list('owner-a').length, 1);
  assert.equal(store.list('owner-a')[0]?.submissionId, 'submit-old');
  await assert.rejects(api.submitConfirmedPlan('owner-a', quote('plan-2'), 'consent-1'), V2HttpError);
  assert.deepEqual(store.list('owner-a').map(item => item.submissionId), ['submit-old', 'submit-new']);
});

test('consent issuance sends only frozen acknowledgments and discards a response after actor change', async () => {
  const { createSubmissionStore, createV2Api, V2ActorChangedError } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage() }); store.activateActor('owner-a');
  let sent: RequestInit | undefined;
  const api = createV2Api({ store, fetcher: async (_input, init) => { sent = init; return response({ consentRecordId: 'consent-1' }, 201); } });
  const consent = await api.issueConsent('owner-a', { policyId: 'policy.test:v2', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: false });
  assert.deepEqual(consent, { consentRecordId: 'consent-1' });
  assert.deepEqual(JSON.parse(String(sent?.body)), { policyId: 'policy.test:v2', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: false });
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const late = createV2Api({ store, fetcher: async () => pending }).issueConsent('owner-a', { policyId: 'policy-1', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: true });
  store.activateActor('owner-b'); finish(response({ consentRecordId: 'consent-late' }, 201));
  await assert.rejects(late, V2ActorChangedError);
});

test('project upload uses consent-bound browser multipart and validates the exact source DTO', async () => {
  const { createSubmissionStore, createV2Api, V2ActorChangedError, V2HttpError, V2UncertainResponseError } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage() }); store.activateActor('owner-a');
  let sent: RequestInit | undefined;
  const dto = { projectId: 'project-2', originalAssetId: 'asset-original', displayAssetId: 'asset-display', sourceKind: 'user_upload' };
  const order: string[] = [];
  const api = createV2Api({ store, fetcher: async (input, init) => {
    if (String(input) === '/api/v2/consents') { order.push('consent'); return response({ consentRecordId: 'consent-confirmed' }, 201); }
    assert.equal(String(input), '/api/v2/projects'); order.push('project'); sent = init; return response(dto, 201);
  } });
  const issued = await api.issueConsent('owner-a', { policyId: 'policy-1', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: false });
  assert.deepEqual(await api.createProject('owner-a', issued.consentRecordId, { name: 'Synthetic upload', file: new Blob(['synthetic'], { type: 'image/jpeg' }) }), dto);
  assert.deepEqual(order, ['consent', 'project']);
  assert.equal(new Headers(sent?.headers).get('X-Form-Consent-Id'), issued.consentRecordId);
  assert.equal(new Headers(sent?.headers).has('content-type'), false);
  assert.ok(sent?.body instanceof FormData);
  const form = sent?.body as FormData;
  assert.equal(form.get('name'), 'Synthetic upload'); assert.equal(form.get('demoId'), null);
  assert.ok(form.get('file') instanceof Blob); assert.equal(await (form.get('file') as Blob).text(), 'synthetic');
  for (const invalidDto of [{ ...dto, sourceKind: 'remote_url' }, { ...dto, extra: true }, { ...dto, originalAssetId: '../asset' }]) {
    const invalid = createV2Api({ store, fetcher: async (_input, init) => { assert.equal((init?.body as FormData).get('demoId'), 'demo.approved:1'); return response(invalidDto, 201); } });
    await assert.rejects(invalid.createProject('owner-a', issued.consentRecordId, { name: 'Synthetic', demoId: 'demo.approved:1' }), V2UncertainResponseError);
  }
  const failed = createV2Api({ store, fetcher: async () => response({ code: 'UPLOAD_INVALID', message: 'Choose another photo.', retryable: false, requestId: 'request-9' }, 415) });
  await assert.rejects(failed.createProject('owner-a', 'consent-1', { name: 'Synthetic', demoId: 'demo.approved:1' }), error => error instanceof V2HttpError && error.code === 'UPLOAD_INVALID' && error.status === 415);
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const late = createV2Api({ store, fetcher: async () => pending }).createProject('owner-a', 'consent-1', { name: 'Synthetic', demoId: 'demo.approved:1' });
  store.activateActor('owner-b'); finish(response({ ...dto, sourceKind: 'licensed_demo' }, 201));
  await assert.rejects(late, V2ActorChangedError);
});

test('lost trial-claim acknowledgment survives a fresh store and a 404 replays the same trial endpoint and ID', async () => {
  const { createSubmissionStore, createV2Api, V2NetworkError } = await modules();
  const storage = new MemoryStorage();
  const firstStore = createSubmissionStore({ storage, createId: () => 'trial-submit-1' });
  firstStore.activateActor('owner-a');
  const firstCalls: string[] = [];
  const first = createV2Api({ store: firstStore, fetcher: async (input, init) => {
    firstCalls.push(`${String(input)} ${init?.method}`);
    throw new TypeError('acknowledgment lost after claim acceptance');
  } });
  await assert.rejects(first.submitConfirmedPlan('owner-a', quote(), 'consent-1', { operation: 'trial_claim' }), V2NetworkError);
  assert.deepEqual(firstCalls, ['/api/v2/trial/claim POST']);
  assert.equal(firstStore.list('owner-a')[0]?.operation, 'trial_claim');

  const refreshedStore = createSubmissionStore({ storage, createId: () => 'must-not-be-used' });
  refreshedStore.activateActor('owner-a');
  const replayCalls: string[] = [];
  const replay = createV2Api({ store: refreshedStore, fetcher: async (input, init) => {
    const path = String(input);
    replayCalls.push(`${path} ${init?.method}`);
    if (path === '/api/v2/submissions/trial-submit-1') return response({ code: 'TASK_NOT_FOUND', message: 'Not found.', retryable: false, requestId: 'req-trial' }, 404);
    assert.equal(path, '/api/v2/trial/claim');
    assert.deepEqual(JSON.parse(String(init?.body)), { planId: 'plan-1', submissionId: 'trial-submit-1', consentRecordId: 'consent-1' });
    return response(task, 200);
  } });
  assert.deepEqual(await replay.resumeSubmission('owner-a', 'trial-submit-1'), task);
  assert.deepEqual(replayCalls, ['/api/v2/submissions/trial-submit-1 GET', '/api/v2/trial/claim POST']);
  assert.equal(replayCalls.some(call => call.includes('/api/v2/tasks')), false);
});

test('legacy v1 pending records default to task and migrate intact on the next write', async () => {
  const { createSubmissionStore, createV2Api } = await modules();
  const storage = new MemoryStorage();
  const key = 'form:v2:submissions:owner-a';
  const oldRecord = { planId: 'plan-1', projectId: 'project-1', submissionId: 'legacy-submit', consentRecordId: 'consent-1', expiresAt: '2026-10-13T03:10:00.000Z', createdAt: '2026-10-13T03:00:00.000Z' };
  storage.values.set(key, JSON.stringify({ schemaVersion: 1, submissions: [oldRecord] }));
  const store = createSubmissionStore({ storage, createId: () => 'new-submit' });
  store.activateActor('owner-a');
  assert.equal(store.list('owner-a')[0]?.operation, 'task');
  const paths: string[] = [];
  const api = createV2Api({ store, fetcher: async input => {
    paths.push(String(input));
    return response({ code: 'TASK_NOT_FOUND', message: 'Not found.', retryable: false, requestId: 'req-legacy' }, 404);
  } });
  await assert.rejects(api.resumeSubmission('owner-a', 'legacy-submit'));
  assert.deepEqual(paths, ['/api/v2/submissions/legacy-submit', '/api/v2/tasks']);

  store.begin('owner-a', quoteIdentity('plan-2'), 'consent-2');
  const saved = JSON.parse(storage.values.get(key)!);
  assert.equal(saved.schemaVersion, 2);
  assert.deepEqual(saved.submissions.map((item: { submissionId: string; operation: string }) => [item.submissionId, item.operation]), [['legacy-submit', 'task'], ['new-submit', 'task']]);
});

test('cross-operation reuse of a pending plan conflicts without replacing its identity', async () => {
  const { createSubmissionStore, SubmissionStoreError } = await modules();
  const store = createSubmissionStore({ storage: new MemoryStorage(), createId: () => 'task-submit' });
  store.activateActor('owner-a');
  const original = store.begin('owner-a', quoteIdentity(), 'consent-1');
  assert.equal(original.submission.operation, 'task');
  assert.throws(() => store.begin('owner-a', quoteIdentity(), 'consent-1', 'trial_claim'), (error: unknown) => error instanceof SubmissionStoreError && error.code === 'SUBMISSION_IDENTITY_CONFLICT');
  assert.deepEqual(store.list('owner-a').map(record => [record.operation, record.submissionId]), [['task', 'task-submit']]);
});

test('invalid persisted schema and operation stay stored and fail closed', async () => {
  const { createSubmissionStore, SubmissionStoreError } = await modules();
  const storage = new MemoryStorage();
  const key = 'form:v2:submissions:owner-a';
  const base = { planId: 'plan-1', projectId: 'project-1', submissionId: 'submit-1', consentRecordId: 'consent-1', expiresAt: '2026-10-13T03:10:00.000Z', createdAt: '2026-10-13T03:00:00.000Z' };
  for (const value of [
    { schemaVersion: 9, submissions: [base] },
    { schemaVersion: 2, submissions: [{ ...base, operation: 'unknown' }] },
    { schemaVersion: 1, submissions: [{ ...base, unexpected: true }] },
  ]) {
    const raw = JSON.stringify(value);
    storage.values.set(key, raw);
    const store = createSubmissionStore({ storage }); store.activateActor('owner-a');
    assert.throws(() => store.list('owner-a'), (error: unknown) => error instanceof SubmissionStoreError && error.code === 'SUBMISSION_STORE_INVALID');
    assert.equal(storage.values.get(key), raw);
  }
});

test('invalid submit operation is rejected before storage or network access', async () => {
  const { createSubmissionStore, createV2Api, SubmissionStoreError } = await modules();
  class CountingStorage extends MemoryStorage {
    reads = 0; writes = 0;
    getItem(key: string) { this.reads++; return super.getItem(key); }
    setItem(key: string, value: string) { this.writes++; super.setItem(key, value); }
  }
  const storage = new CountingStorage();
  const store = createSubmissionStore({ storage }); store.activateActor('owner-a');
  const invalidStoreOperation = 'trial' as unknown as 'task' | 'trial_claim';
  assert.throws(() => store.begin('owner-a', quoteIdentity(), 'consent-1', invalidStoreOperation), (error: unknown) => error instanceof SubmissionStoreError && error.code === 'INVALID_SUBMISSION_OPERATION');
  let calls = 0;
  const api = createV2Api({ store, fetcher: async () => { calls++; return response(task); } });
  const invalid = { operation: 'trial' } as unknown as { operation: 'task' | 'trial_claim' };
  await assert.rejects(api.submitConfirmedPlan('owner-a', quote(), 'consent-1', invalid), TypeError);
  await assert.rejects(api.submitConfirmedPlan('owner-a', quote(), 'consent-1', { operation: null } as never), TypeError);
  await assert.rejects(api.submitConfirmedPlan('owner-a', quote(), 'consent-1', { operation: 'trial_claim', [Symbol('extra')]: true } as never), TypeError);
  assert.equal(storage.reads, 0); assert.equal(storage.writes, 0); assert.equal(calls, 0);
});

test('trial submit persistence failure and actor change never fall back to task POST', async () => {
  const { createSubmissionStore, createV2Api, SubmissionStoreError, V2ActorChangedError } = await modules();
  const storage = new MemoryStorage(); storage.failWrites = true;
  const store = createSubmissionStore({ storage, createId: () => 'trial-submit' }); store.activateActor('owner-a');
  let calls = 0;
  const blocked = createV2Api({ store, fetcher: async () => { calls++; return response(task); } });
  await assert.rejects(blocked.submitConfirmedPlan('owner-a', quote(), 'consent-1', { operation: 'trial_claim' }), SubmissionStoreError);
  assert.equal(calls, 0);

  storage.failWrites = false;
  store.activateActor('owner-b');
  await assert.rejects(blocked.submitConfirmedPlan('owner-a', quote(), 'consent-1', { operation: 'trial_claim' }), SubmissionStoreError);
  assert.equal(calls, 0);
  store.activateActor('owner-a');
  let finish!: (value: Response) => void;
  const waiting = new Promise<Response>(resolve => { finish = resolve; });
  const paths: string[] = [];
  const changing = createV2Api({ store, fetcher: async input => { paths.push(String(input)); return waiting; } });
  const pending = changing.submitConfirmedPlan('owner-a', quote(), 'consent-1', { operation: 'trial_claim' });
  store.activateActor('owner-b');
  finish(response(task));
  await assert.rejects(pending, V2ActorChangedError);
  assert.deepEqual(paths, ['/api/v2/trial/claim']);
});
