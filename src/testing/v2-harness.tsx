import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PhotoIntake, type PublishedPhotoDisclosure } from '../features/photo/PhotoIntake.js';
import { DiscoverEntry } from '../features/discover/DiscoverEntry.js';
import type { EntryCapabilities } from '../features/navigation/entry.js';
import { TaskWait } from '../features/task/task-wait.js';
import { DraftEditor, type EditorSource } from '../features/editor/DraftEditor.js';
import { createV2Api, type PlanQuoteDTO, type SafeTaskDTO } from '../lib/api-v2.js';
import { createSubmissionStore, type SubmissionStore } from '../lib/submission-store.js';
import { DraftConflictError, type DraftPersistence, type DraftSnapshot, type DraftWrite } from '../lib/draft-v2.js';
import { FIELDS, type EditRequest, type Field, type SourceRef } from '../../shared/v2/edit-plan.js';
import { ResultView, type ResultFavoriteAcknowledgement, type ResultFavoriteChange, type ResultFeedbackRequest, type ResultProjectSnapshot, type ResultRefineRequest, type ResultVersionSnapshot } from '../features/result/ResultView.js';

function safeTask(id: string, status: SafeTaskDTO['status'], creditReturned = false, safeErrorCode: string | null = null): SafeTaskDTO {
  return {
    id, projectId: 'project-1', planId: 'plan-1', status, userCostUnits: 1,
    createdAt: '2026-10-14T00:00:00.000Z', updatedAt: null,
    resultVersionId: status === 'succeeded' ? 'version-1' : null,
    creditReturned: status === 'failed' || status === 'cancelled' ? creditReturned : false,
    safeErrorCode: status === 'failed' ? safeErrorCode ?? 'PROVIDER_UNAVAILABLE' : null,
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function createSyntheticBackend() {
  const requests: { method: string; path: string }[] = [];
  const tasks = new Map<string, SafeTaskDTO>([
    ['task-1', safeTask('task-1', 'queued')], ['task-2', safeTask('task-2', 'queued')],
    ['task-returned', safeTask('task-returned', 'failed', true)],
    ['task-unconfirmed', safeTask('task-unconfirmed', 'failed', false)],
    ['task-unchanged', safeTask('task-unchanged', 'failed', true, 'OUTPUT_UNCHANGED')],
    ['task-unchanged-unconfirmed', safeTask('task-unchanged-unconfirmed', 'failed', false, 'OUTPUT_UNCHANGED')],
    ['task-completed', safeTask('task-completed', 'succeeded')],
    ['task-uncertain', safeTask('task-uncertain', 'uncertain')],
    ['task-cancelled', safeTask('task-cancelled', 'cancelled', true)],
    ['task-cancelled-unconfirmed', safeTask('task-cancelled-unconfirmed', 'cancelled')],
  ]);
  let actorId = 'owner-a';
  let holdNextResponse = false;
  let holdNextCancelResponse = false;
  let nextFailure: 'offline' | 401 | 404 | null = null;
  let responseHeld = false;
  let cancelResponseHeld = false;
  let releaseHeldResponse: (() => void) | null = null;
  let releaseHeldCancelResponse: (() => void) | null = null;
  const storage = new Map<string, string>();
  const store = createSubmissionStore({
    storage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: key => { storage.delete(key); },
    },
    createId: () => 'submission-1',
    now: () => '2026-10-14T00:00:00.000Z',
  });
  store.activateActor(actorId);
  store.begin(actorId, { planId: 'plan-1', projectId: 'project-1', expiresAt: '2026-10-15T00:00:00.000Z' }, 'consent-1');

  const api = createV2Api({ store, fetcher: async (input, init) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ method, path });
    if (nextFailure && method === 'GET' && path.startsWith('/api/v2/tasks/')) {
      const failure = nextFailure;
      nextFailure = null;
      if (failure === 'offline') throw new TypeError('Synthetic offline response.');
      return json({ code: failure === 401 ? 'AUTH_REQUIRED' : 'TASK_NOT_FOUND', message: 'Synthetic status response.', retryable: false, requestId: 'request-status' }, failure);
    }
    if (path.endsWith('/cancel') && method === 'POST') {
      tasks.set('task-1', safeTask('task-1', 'processing'));
      const started = () => json({ code: 'TASK_ALREADY_STARTED', message: 'The task already started.', retryable: false, requestId: 'request-1' }, 409);
      if (holdNextCancelResponse) {
        holdNextCancelResponse = false;
        cancelResponseHeld = true;
        return await new Promise<Response>(resolve => {
          releaseHeldCancelResponse = () => { cancelResponseHeld = false; releaseHeldCancelResponse = null; resolve(started()); };
        });
      }
      return started();
    }
    if (path === '/api/v2/submissions/submission-1' && method === 'GET') return json(tasks.get('task-1'));
    const match = path.match(/^\/api\/v2\/tasks\/([A-Za-z0-9_-]+)$/);
    if (match && method === 'GET') {
      const task = tasks.get(match[1]!);
      if (!task) return json({ code: 'TASK_NOT_FOUND', message: 'Not found.', retryable: false, requestId: 'request-404' }, 404);
      if (holdNextResponse) {
        holdNextResponse = false;
        responseHeld = true;
        return await new Promise<Response>(resolve => {
          releaseHeldResponse = () => { responseHeld = false; releaseHeldResponse = null; resolve(json(task)); };
        });
      }
      return json(task);
    }
    return json({ code: 'TASK_NOT_FOUND', message: 'Not found.', retryable: false, requestId: 'request-404' }, 404);
  } });

  return {
    api,
    current: (id: string | undefined) => id ? tasks.get(id) : undefined,
    requests: () => requests.map(request => ({ ...request })),
    activateActor: (next: string) => { actorId = next; store.activateActor(next); },
    holdNext: () => { holdNextResponse = true; },
    holdCancel: () => { holdNextCancelResponse = true; },
    failNext: (failure: 'offline' | 401 | 404) => { nextFailure = failure; },
    held: () => responseHeld,
    cancelHeld: () => cancelResponseHeld,
    release: () => releaseHeldResponse?.(),
    releaseCancel: () => releaseHeldCancelResponse?.(),
    advanceTask: (id: string, status: SafeTaskDTO['status']) => { tasks.set(id, safeTask(id, status)); },
  };
}

function V2Harness() {
  const backend = useMemo(createSyntheticBackend, []);
  const [actorId, setActorId] = useState('owner-a');
  const [taskId, setTaskId] = useState<string | undefined>('task-1');
  const [showTask, setShowTask] = useState(true);
  const task = backend.current(taskId);

  useEffect(() => {
    Object.assign(window, { __v2TaskHarness: backend });
    return () => { delete (window as unknown as { __v2TaskHarness?: unknown }).__v2TaskHarness; };
  }, [backend]);

  function switchActor() {
    const next = actorId === 'owner-a' ? 'owner-b' : 'owner-a';
    backend.activateActor(next);
    setActorId(next);
  }

  return <main className="v2-harness">
    <p className="v2-harness__notice">DEV HARNESS · SYNTHETIC ONLY</p>
    <h1>FORM V2 component harness</h1>
    <p className="v2-harness__photo">Photo intake is unavailable in this checkout. No upload or model service is connected.</p>
    <section className="v2-harness__controls" aria-label="Synthetic task controls">
      <button type="button" onClick={backend.holdNext}>Hold next response</button>
      <button type="button" onClick={backend.holdCancel}>Hold next cancel</button>
      <button type="button" onClick={() => void backend.releaseCancel()}>Release held cancel</button>
      <button type="button" onClick={() => backend.advanceTask('task-1', 'processing')}>Advance task on server</button>
      <button type="button" onClick={() => backend.advanceTask('task-2', 'failed')}>Fail task two on server</button>
      <button type="button" onClick={() => backend.failNext('offline')}>Fail next request offline</button>
      <button type="button" onClick={() => backend.failNext(401)}>Return 401 next</button>
      <button type="button" onClick={() => backend.failNext(404)}>Return 404 next</button>
      <button type="button" onClick={() => void backend.release()}>Release held response</button>
      <button type="button" onClick={switchActor}>Switch actor</button>
      <button type="button" onClick={() => setTaskId(taskId === 'task-1' ? 'task-2' : 'task-1')}>Switch task</button>
      <button type="button" onClick={() => setTaskId('task-returned')}>Show returned failure</button>
      <button type="button" onClick={() => setTaskId('task-unconfirmed')}>Show unconfirmed failure</button>
      <button type="button" onClick={() => setTaskId('task-unchanged')}>Show unchanged result</button>
      <button type="button" onClick={() => setTaskId('task-unchanged-unconfirmed')}>Show unconfirmed unchanged result</button>
      <button type="button" onClick={() => setTaskId('task-completed')}>Show completed task</button>
      <button type="button" onClick={() => setTaskId('task-uncertain')}>Show uncertain task</button>
      <button type="button" onClick={() => setTaskId('task-cancelled')}>Show cancelled task</button>
      <button type="button" onClick={() => setTaskId('task-cancelled-unconfirmed')}>Show unconfirmed cancelled task</button>
      <button type="button" onClick={() => setTaskId(undefined)}>Show lost acknowledgement</button>
    </section>
    {showTask ? <TaskWait
      actorId={actorId}
      taskId={taskId}
      submissionId="submission-1"
      initialTask={task && !(actorId === 'owner-b' && taskId === 'task-2') ? { actorId, task } : undefined}
      api={backend.api}
      onBrowse={() => setShowTask(false)}
    /> : <section className="v2-harness__browse" aria-label="Browse">
      <h2>Browse</h2>
      <button type="button" onClick={() => setShowTask(true)}>Return to task</button>
    </section>}
  </main>;
}

function EntryHarness() {
  const query = new URLSearchParams(window.location.search);
  const [ownerId, setOwner] = useState('owner-a');
  const [closed, setClosed] = useState(query.get('closed') === '1');
  const [events, setEvents] = useState('');
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#dedfd5"/><rect x="100" y="160" width="440" height="120" rx="30" fill="#62695e"/><text x="90" y="60" font-size="25">SYNTHETIC TEST FIXTURE</text></svg>');
  const capabilities: EntryCapabilities = {
    explore: !closed, detail: !closed, publishedStyleIds: closed ? [] : ['clean'],
    example: query.get('missing') === '1' ? null : {
      id: 'case-fixture', styleId: 'clean', name: 'Synthetic color study',
      description: 'Synthetic fixture only; no production license or model quality is asserted.',
      beforeUrl: image, afterUrl: image,
      licenseEvidenceId: 'synthetic-license-fixture', qualityEvidenceId: 'synthetic-quality-fixture',
    },
  };
  const restoredView = query.get('restore') === 'explore' ? {
    screen: 'photo', intent: { schemaVersion: 2, source: { kind: 'original' }, operation: 'explore', styleId: 'clean', edits: {} },
  } : null;
  return <>
    <p className="v2-harness__notice">DEV HARNESS · SYNTHETIC ONLY</p>
    <div className="v2-harness__controls">
      <button type="button" onClick={() => setClosed(true)}>Close entry capabilities</button>
      <button type="button" onClick={() => setOwner(ownerId === 'owner-a' ? 'owner-b' : 'owner-a')}>Switch entry account</button>
    </div>
    <DiscoverEntry ownerId={ownerId} capabilities={capabilities} restoredView={restoredView}
      recent={[
        { ownerId: 'owner-a', projectId: 'project-own', name: 'Earlier rally look', selectedSource: { kind: 'version', versionId: 'version-old' }, styleId: 'rally', favorite: true, thumbnailUrl: image, activeTaskId: 'task-own' },
        { ownerId: 'owner-b', projectId: 'project-other', name: 'Other account private car', selectedSource: { kind: 'original' }, styleId: null, favorite: false, thumbnailUrl: null, activeTaskId: null },
      ]}
      renderPhoto={intent => <><output data-testid="entry-intent">{JSON.stringify(intent)}</output><PhotoIntake actorId={ownerId} api={null} disclosure={null} /></>}
      onOpenProject={(id, source) => setEvents(id + ':' + (source.kind === 'version' ? source.versionId : 'original'))}
      onOpenTask={setEvents} />
    <output data-testid="entry-events">{events}</output>
  </>;
}

interface EditHarnessRequest { method: string; path: string; submissionStoredAtPost?: boolean; requestEdits?: EditRequest }
interface EditHarnessBackend {
  api: ReturnType<typeof createV2Api>; store: SubmissionStore; persistence: DraftPersistence;
  initialDraft(ownerId: string): DraftSnapshot; activateOwner(ownerId: string): void;
  refreshRemoteDraft(ownerId: string): void;
  requests(): EditHarnessRequest[]; draftWrites(): DraftWrite[]; failNextSave(): void;
  holdNextDraftSave(): void; heldDraftSave(): boolean; releaseHeldDraftSave(): void;
}

function syntheticQuote(ownerId: string, projectId: string, request: EditRequest): PlanQuoteDTO {
  const fields: Field[] = [...FIELDS];
  const requestedChanges = Object.entries(request.edits).flatMap(([field, edit]) => edit && edit.action !== 'preserve'
    ? [{ field: field as Field, action: edit.action, ...(edit.action === 'set' ? { value: edit.value } : {}) }]
    : []);
  const changes = request.operation === 'explore'
    ? [{ field: 'bodyColor' as const, action: 'set' as const, value: 'silver' }]
    : requestedChanges;
  const source = {
    ...(request.source.kind === 'version' ? { kind: 'version' as const, versionId: request.source.versionId } : { kind: 'original' as const }),
    assetId: request.source.kind === 'original' ? 'asset-original' : 'asset-version',
    assetKind: request.source.kind === 'original' ? 'original' as const : 'master' as const,
    persistedSha256: 'a'.repeat(64), rawSha256: 'b'.repeat(64), canonicalSha256: 'c'.repeat(64), pixelSha256: 'd'.repeat(64),
    bytes: 400, width: 640, height: 400, rawGeometry: { width: 640, height: 400 }, canonicalGeometry: { width: 640, height: 400 },
    normalizerVersion: 'synthetic-normalizer-v1', sourceFormat: 'png', sourceOrientation: null,
  };
  return {
    schemaVersion: 1, planId: 'plan-fixture', createdAt: '2026-10-14T00:00:00.000Z', expiresAt: '2026-10-15T00:00:00.000Z', planDigest: 'e'.repeat(64),
    semantic: {
      ownerId, projectId, walletScope: 'demo', executionMode: 'licensed_demo', source,
      requestEdits: request, desiredRecipe: { changes, preserve: fields.filter(field => !changes.some(change => change.field === field)),
        inherited: { styleId: request.operation === 'explore' ? request.styleId! : null, verification: request.operation === 'explore' ? 'unverified' : 'unknown', requested: request.operation === 'explore' ? changes : [], preserve: fields.filter(field => !changes.some(change => change.field === field)) } },
      observedRecipe: { status: 'unknown', fields: {} }, userCostUnits: 1, outputCount: 1, supplierExposureMicrosUSD: 0,
    },
  };
}

function createSyntheticEditBackend(query: URLSearchParams): EditHarnessBackend {
  const requests: EditHarnessRequest[] = [], writes: DraftWrite[] = [];
  let ownerId = 'owner-a', failSave = false, holdSave = false, held = false, release: (() => void) | null = null;
  let conflictIssued = false, loseSubmit = query.get('submit') === 'lost';
  const draftKey = (owner: string) => `form:v2:synthetic-draft:${owner}`;
  const storage = {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    removeItem: (key: string) => window.localStorage.removeItem(key),
  };
  const store = createSubmissionStore({ storage, createId: () => 'submission-fixture', now: () => '2026-10-14T00:00:00.000Z' });
  store.activateActor(ownerId);
  if (query.get('pending') === '1') store.begin(ownerId, { planId: 'plan-fixture', projectId: 'project-1', expiresAt: '2026-10-15T00:00:00.000Z' }, 'consent-fixture');
  const remoteDraft: DraftSnapshot = { ownerId, projectId: 'project-1', revision: 5, source: { kind: 'version', versionId: 'version-new' }, edits: { bodyColor: { action: 'set', value: 'red' } } };
  const saveNow = async (write: DraftWrite): Promise<DraftSnapshot> => {
    if (failSave) { failSave = false; throw new Error('synthetic save unavailable'); }
    if (query.get('save') === 'conflict' && !conflictIssued) {
      conflictIssued = true;
      storage.setItem(draftKey(write.ownerId), JSON.stringify(remoteDraft));
      throw new DraftConflictError(remoteDraft);
    }
    const raw = storage.getItem(draftKey(write.ownerId));
    const current = raw ? JSON.parse(raw) as DraftSnapshot : { ownerId: write.ownerId, projectId: write.projectId, revision: 4, source: { kind: 'original' as const }, edits: {} };
    if (current.revision !== write.expectedRevision) throw new DraftConflictError(current);
    const saved: DraftSnapshot = { ownerId: write.ownerId, projectId: write.projectId, revision: current.revision + 1, source: write.source, edits: write.edits };
    storage.setItem(draftKey(write.ownerId), JSON.stringify(saved));
    return saved;
  };
  const persistence: DraftPersistence = { saveDraft: write => {
    writes.push(structuredClone(write));
    if (!holdSave) return saveNow(write);
    holdSave = false;
    held = true;
    return new Promise<DraftSnapshot>((resolve, reject) => {
      release = () => { held = false; release = null; void saveNow(write).then(resolve, reject); };
    });
  } };
  const statuses: SafeTaskDTO['status'][] = ['queued', 'processing', 'uncertain', 'succeeded', 'failed', 'cancelled'];
  const requestedStatus = query.get('recover-status');
  const taskStatus = statuses.find(status => status === requestedStatus) ?? 'queued';
  const task: SafeTaskDTO = {
    id: 'task-fixture', projectId: 'project-1', planId: 'plan-fixture', status: taskStatus, userCostUnits: 1,
    createdAt: '2026-10-14T00:00:00.000Z', updatedAt: null, resultVersionId: taskStatus === 'succeeded' ? 'version-recovered' : null,
    creditReturned: false, safeErrorCode: taskStatus === 'failed' ? 'PROVIDER_UNAVAILABLE' : null,
  };
  const api = createV2Api({ store, fetcher: async (input, init) => {
    const path = new URL(String(input), window.location.origin).pathname, method = init?.method ?? 'GET';
    const record: EditHarnessRequest = { path, method };
    if (path === '/api/v2/tasks' && method === 'POST') {
      record.submissionStoredAtPost = store.list(ownerId).some(item => item.planId === 'plan-fixture');
      requests.push(record);
      if (loseSubmit) { loseSubmit = false; throw new TypeError('synthetic lost acknowledgement'); }
      return json(task, 202);
    }
    if (path === '/api/v2/projects/project-1/plans' && method === 'POST') {
      const requestEdits = JSON.parse(String(init?.body)) as EditRequest;
      record.requestEdits = requestEdits;
      requests.push(record);
      return json(syntheticQuote(ownerId, 'project-1', requestEdits), 201);
    }
    requests.push(record);
    if (path === '/api/v2/submissions/submission-fixture' && method === 'GET') return json(task);
    return json({ code: 'NOT_FOUND', message: 'Synthetic endpoint unavailable.', retryable: false, requestId: 'request-fixture' }, 404);
  } });
  return {
    api, store, persistence,
    initialDraft: (owner: string) => {
      if (query.get('source') === 'missing') return { ownerId: owner, projectId: 'project-1', revision: 4, source: { kind: 'version', versionId: 'version-gone' }, edits: {} };
      const raw = storage.getItem(draftKey(owner));
      return raw ? JSON.parse(raw) as DraftSnapshot : { ownerId: owner, projectId: 'project-1', revision: 4, source: { kind: 'original' }, edits: {} };
    },
    refreshRemoteDraft: owner => storage.setItem(draftKey(owner), JSON.stringify({ ownerId: owner, projectId: 'project-1', revision: 5,
      source: { kind: 'version', versionId: 'version-new' }, edits: { bodyColor: { action: 'set', value: 'red' } } } satisfies DraftSnapshot)),
    activateOwner: next => { ownerId = next; store.activateActor(next); },
    requests: () => requests.map(request => ({ ...request })),
    draftWrites: () => writes.map(write => structuredClone(write)),
    failNextSave: () => { failSave = true; },
    holdNextDraftSave: () => { holdSave = true; }, heldDraftSave: () => held,
    releaseHeldDraftSave: () => release?.(),
  };
}

function EditHarness() {
  const query = new URLSearchParams(window.location.search);
  const backend = useMemo(() => createSyntheticEditBackend(query), []);
  const [ownerId, setOwnerId] = useState('owner-a');
  const [, refresh] = useState(0);
  const explore = query.get('operation') === 'explore';
  const capabilities = query.get('capabilities') === 'closed' ? undefined : query.get('original') === 'closed'
    ? { enabled: true, fields: ['bodyColor', 'wheelColor'] as Field[], originalReference: false }
    : { enabled: true, fields: ['bodyColor', 'wheelColor'] as Field[], originalReference: true };
  const intent: EditRequest | undefined = explore
    ? { schemaVersion: 2, source: { kind: 'original' }, operation: 'explore', styleId: 'clean', edits: {} }
    : undefined;
  const image = (tone: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#dedfd5"/><rect x="100" y="160" width="440" height="120" rx="30" fill="${tone}"/><text x="90" y="60" font-size="25">SYNTHETIC TEST FIXTURE</text></svg>`);
  const sources: EditorSource[] = [
    { source: { kind: 'original' }, label: 'Original', imageUrl: image('#62695e') },
    { source: { kind: 'version', versionId: 'version-old' }, label: 'Earlier version', imageUrl: image('#7f5642') },
    { source: { kind: 'version', versionId: 'version-new' }, label: 'Newer version', imageUrl: image('#496784') },
  ];
  const reasons: Record<string, string> = {
    offline: 'You are offline. Reconnect to create a new look.', balance: 'You need at least 1 credit to create this look.',
    consent: 'Confirm the required photo permissions before continuing.', photo: 'This photo is not supported for editing.',
    active: 'Finish or recover your active task before creating another look.',
  };
  function switchOwner() {
    const next = ownerId === 'owner-a' ? 'owner-b' : 'owner-a';
    backend.activateOwner(next);
    setOwnerId(next);
  }
  useEffect(() => {
    Object.assign(window, { __v2EditHarness: backend });
    return () => { delete (window as unknown as { __v2EditHarness?: unknown }).__v2EditHarness; };
  }, [backend]);
  return <div className="harness-shell">
    <aside className="harness-notice"><strong>DEV HARNESS · SYNTHETIC ONLY</strong><span>No production draft service, model, real photo or paid account is connected.</span></aside>
    <div className="harness-account"><span>Test account: <code>{ownerId}</code></span><button type="button" onClick={switchOwner}>Switch synthetic owner</button></div>
    <div className="v2-edit__harness-controls">
      <button type="button" onClick={backend.failNextSave}>Fail next draft save</button>
      <button type="button" onClick={backend.holdNextDraftSave}>Hold next draft save</button>
      <button type="button" onClick={backend.releaseHeldDraftSave}>Release held draft save</button>
      <button type="button" onClick={() => { backend.refreshRemoteDraft(ownerId); refresh(value => value + 1); }}>Refresh remote draft</button>
    </div>
    <DraftEditor ownerId={ownerId} projectId="project-1" consentRecordId="consent-fixture" initialDraft={backend.initialDraft(ownerId)}
      sources={sources} persistence={backend.persistence} api={backend.api} submissionStore={backend.store} intent={intent} capabilities={capabilities}
      providerDisclosure="Synthetic demo quote only. No production provider or model is connected."
      blockingReason={query.get('gate') ? reasons[query.get('gate')!] : undefined} />
  </div>;
}

type ResultHarnessEvent = { type: string; ownerId?: string; projectId?: string; versionId?: string; source?: SourceRef; favorite?: boolean; category?: string; description?: string };
interface ResultHarnessBridge {
  events(): ResultHarnessEvent[]; modelCalls(): { method: string; path: string }[];
  holdFavorite(): void; favoriteHeld(): boolean; releaseFavorite(): void; failNextFeedback(): void;
  recordRefine(request: ResultRefineRequest): void;
  setFavorite(change: ResultFavoriteChange): Promise<ResultFavoriteAcknowledgement>;
  saveToDevice(request: { ownerId: string; projectId: string; versionId: string; displayAssetId: string }): Promise<'saved' | 'cancelled' | 'unavailable'>;
  submitFeedback(request: ResultFeedbackRequest): Promise<void>;
}

function createResultHarnessBridge(deviceOutcome: string | null): ResultHarnessBridge {
  const recorded: ResultHarnessEvent[] = [];
  let holdNext = false, held = false, release: (() => void) | null = null, failFeedback = false;
  return {
    events: () => recorded.map(event => ({ ...event })), modelCalls: () => [],
    holdFavorite: () => { holdNext = true; }, favoriteHeld: () => held,
    releaseFavorite: () => release?.(), failNextFeedback: () => { failFeedback = true; },
    recordRefine: request => { recorded.push({ type: 'refine', ...request }); },
    setFavorite: async change => {
      if (holdNext) {
        holdNext = false; held = true;
        await new Promise<void>(resolve => { release = () => { held = false; release = null; resolve(); }; });
      }
      recorded.push({ type: 'favorite', ...change });
      return { ...change };
    },
    saveToDevice: async request => { recorded.push({ type: 'device_save', ...request }); return deviceOutcome === 'cancelled' || deviceOutcome === 'unavailable' ? deviceOutcome : 'saved'; },
    submitFeedback: async request => {
      if (failFeedback) { failFeedback = false; throw new Error('Synthetic feedback write failed.'); }
      recorded.push({ type: 'feedback', ...request });
    },
  };
}

function resultImage(label: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#dedfd5"/><rect x="90" y="150" width="460" height="130" rx="34" fill="${color}"/><text x="22" y="35" font-size="18">SYNTHETIC ${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function ResultHarness() {
  const query = new URLSearchParams(window.location.search);
  const invalid = query.get('invalid');
  const bridge = useMemo(() => createResultHarnessBridge(query.get('device')), []);
  const [ownerId, setOwnerId] = useState('owner-a');
  const [selectedVersionId, setSelectedVersionId] = useState(query.get('selected') ?? 'version-new');
  useEffect(() => {
    Object.assign(window, { __v2ResultHarness: bridge });
    return () => { delete (window as unknown as { __v2ResultHarness?: unknown }).__v2ResultHarness; };
  }, [bridge]);

  const projectId = ownerId === 'owner-a' ? 'project-1' : 'project-b';
  const originalUrl = resultImage('ORIGINAL', '#62695e');
  const versions: ResultVersionSnapshot[] = ownerId === 'owner-a' ? [
    { id: 'version-old', projectId, taskId: 'task-old', parentVersionId: null, displayAssetId: 'asset-old', displayUrl: resultImage('EARLIER', '#899b69'), name: 'Earlier look', favorite: false, desiredRecipe: ['Body color requested: green'], verification: 'unverified' as const },
    { id: 'version-other', projectId, taskId: 'task-other', parentVersionId: 'version-old', displayAssetId: 'asset-other', displayUrl: resultImage('ALTERNATE', '#897f69'), name: 'Alternate look', favorite: false, desiredRecipe: ['Wheel style requested: silver'], verification: 'unknown' as const },
    { id: 'version-new', projectId, taskId: 'task-new', parentVersionId: 'version-old', displayAssetId: 'asset-new', displayUrl: resultImage('NEWER', '#536b7b'), name: 'Newer look', favorite: false, desiredRecipe: ['Body color requested: blue'], verification: 'unverified' as const },
  ] : [
    { id: 'version-b', projectId, taskId: 'task-b', parentVersionId: null, displayAssetId: 'asset-b', displayUrl: resultImage('ACCOUNT B', '#735b6d'), name: 'Account B look', favorite: false, desiredRecipe: ['Color request: violet'], verification: 'unknown' as const },
  ];
  const project: ResultProjectSnapshot = {
    id: projectId, loadedForOwnerId: invalid === 'owner' && ownerId === 'owner-a' ? 'owner-b' : ownerId,
    name: ownerId === 'owner-a' ? 'Synthetic garage project' : 'Account B project', originalAssetId: 'asset-original', originalUrl,
    versions: invalid === 'image' && ownerId === 'owner-a' ? versions.map(item => item.id === selectedVersionId ? { ...item, displayUrl: null } : item)
      : invalid === 'image-load' && ownerId === 'owner-a' ? versions.map(item => item.id === selectedVersionId ? { ...item, displayUrl: 'data:image/png;base64,broken' } : item) : versions,
  };
  const version = project.versions.find(item => item.id === selectedVersionId) ?? project.versions[project.versions.length - 1]!;
  let task: SafeTaskDTO = {
    id: version.taskId, projectId, planId: 'plan-fixture', status: 'succeeded', userCostUnits: 1,
    createdAt: '2026-10-14T00:00:00.000Z', updatedAt: null, resultVersionId: version.id, creditReturned: false, safeErrorCode: null,
  };
  if (invalid === 'project') task = { ...task, projectId: 'project-other' };
  if (invalid === 'status') task = { ...task, status: 'processing', resultVersionId: null };
  if (invalid === 'result-version') task = { ...task, resultVersionId: 'version-other' };
  if (invalid === 'version-task') task = { ...task, id: 'task-other' };

  function switchOwner() {
    const next = ownerId === 'owner-a' ? 'owner-b' : 'owner-a';
    setOwnerId(next); setSelectedVersionId(next === 'owner-a' ? 'version-new' : 'version-b');
  }
  return <>
    <p className="v2-harness__notice">DEV HARNESS · SYNTHETIC ONLY · NO SERVICE, DEVICE, REAL PHOTO OR MODEL CONNECTED</p>
    <div className="v2-harness__controls" aria-label="Synthetic result controls">
      <button type="button" onClick={bridge.holdFavorite}>Hold next favorite acknowledgement</button>
      <button type="button" onClick={bridge.releaseFavorite}>Release held favorite acknowledgement</button>
      <button type="button" onClick={switchOwner}>Switch result owner</button>
      <button type="button" onClick={bridge.failNextFeedback}>Fail next feedback</button>
    </div>
    <ResultView ownerId={ownerId} project={project} task={task} selectedVersionId={version.id} onSelectVersion={setSelectedVersionId}
      onRefine={bridge.recordRefine}
      onSetFavorite={bridge.setFavorite} onSaveToDevice={bridge.saveToDevice} onSubmitFeedback={bridge.submitFeedback} />
  </>;
}

function mountPhotoHarness() {

interface SyntheticRequest {
  path: string;
  method: string;
  consent?: { acknowledgePhotoRights: boolean; acknowledgeUploadStorage: boolean; acknowledgeSharing: boolean };
  project?: { consentId: string; size: number };
}
interface HarnessWindow extends Window {
  __FORM_V2_TEST__: { requests: SyntheticRequest[]; urls: { created: string[]; revoked: string[] } };
}

const testWindow = window as unknown as HarnessWindow;
const urls = { created: [] as string[], revoked: [] as string[] };
const originalCreate = URL.createObjectURL.bind(URL);
const originalRevoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob) => {
  const value = originalCreate(blob);
  urls.created.push(value);
  return value;
};
URL.revokeObjectURL = (value: string) => {
  urls.revoked.push(value);
  originalRevoke(value);
};

const requests: SyntheticRequest[] = [];
testWindow.__FORM_V2_TEST__ = { requests, urls };
const storageValues = new Map<string, string>();
const store = createSubmissionStore({ storage: {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => { storageValues.set(key, value); },
  removeItem: key => { storageValues.delete(key); },
} });
store.activateActor('owner-a');

const scenario = new URLSearchParams(window.location.search);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

async function syntheticFetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = new URL(String(input), window.location.origin).pathname;
  const method = init?.method ?? 'GET';
  const record: SyntheticRequest = { path, method };
  requests.push(record);
  if (path === '/api/v2/consents' && method === 'POST') {
    try { record.consent = JSON.parse(String(init?.body)) as SyntheticRequest['consent']; }
    catch { return json({ code: 'INVALID_REQUEST', message: 'The request is invalid.', retryable: false, requestId: 'request-1' }, 400); }
    if (scenario.get('consent') === 'delay') await new Promise(resolve => setTimeout(resolve, 700));
    if (scenario.get('consent') === 'fail') return json({ code: 'CONSENT_UNAVAILABLE', message: 'Consent is unavailable right now.', retryable: true, requestId: 'request-2' }, 503);
    return json({ consentRecordId: 'consent-fixture' }, 201);
  }
  if (path === '/api/v2/projects' && method === 'POST') {
    const form = init?.body as FormData;
    const file = form?.get('file');
    const consentId = new Headers(init?.headers).get('X-Form-Consent-Id') ?? '';
    record.project = { consentId, size: file instanceof Blob ? file.size : 0 };
    if (scenario.get('project') === 'ambiguous') throw new TypeError('synthetic transport disconnect');
    return json({ projectId: 'project-fixture', originalAssetId: 'asset-original', displayAssetId: 'asset-display', sourceKind: 'user_upload' }, 201);
  }
  return json({ code: 'NOT_FOUND', message: 'This synthetic endpoint is unavailable.', retryable: false, requestId: 'request-404' }, 404);
}

const api = createV2Api({ store, fetcher: syntheticFetcher });
const disclosure: PublishedPhotoDisclosure = {
  policyId: 'policy-fixture-v1',
  policyVersion: 'fixture-1',
  providerName: 'Synthetic image service',
  purpose: 'a local harness upload test',
};

function PhotoHarness() {
  const [actorId, setActorId] = useState('owner-a');
  const policy = useMemo(() => scenario.get('policy') === 'missing' ? null : disclosure, []);
  function switchActor() {
    const next = actorId === 'owner-a' ? 'owner-b' : 'owner-a';
    store.activateActor(next);
    setActorId(next);
  }
  return <div className="harness-shell">
    <aside className="harness-notice">
      <strong>DEV HARNESS · SYNTHETIC ONLY</strong>
      <span>No production server, real photo, model or owner facts are connected.</span>
    </aside>
    <div className="harness-account">
      <span>Test account: <code>{actorId}</code></span>
      <button type="button" onClick={switchActor}>Switch synthetic account</button>
    </div>
    <PhotoIntake actorId={actorId} api={api} disclosure={policy} />
    <details className="harness-log">
      <summary>Synthetic service request log</summary>
      <pre data-testid="synthetic-request-log">{JSON.stringify(requests, null, 2)}</pre>
    </details>
  </div>;
}

const root = createRoot(document.getElementById('root')!);
Object.assign(testWindow, { __FORM_V2_UNMOUNT__: () => root.unmount() });
root.render(<PhotoHarness />);
}

if (new URLSearchParams(window.location.search).get('feature') === 'result') createRoot(document.getElementById('root')!).render(<ResultHarness />);
else if (new URLSearchParams(window.location.search).get('feature') === 'edit') createRoot(document.getElementById('root')!).render(<EditHarness />);
else if (new URLSearchParams(window.location.search).get('feature') === 'entry') createRoot(document.getElementById('root')!).render(<EntryHarness />);
else if (new URLSearchParams(window.location.search).get('feature') === 'photo') mountPhotoHarness();
else createRoot(document.getElementById('root')!).render(<V2Harness />);
