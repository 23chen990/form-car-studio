import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PhotoIntake, type PublishedPhotoDisclosure } from '../features/photo/PhotoIntake.js';
import { DiscoverEntry } from '../features/discover/DiscoverEntry.js';
import type { EntryCapabilities } from '../features/navigation/entry.js';
import { TaskWait } from '../features/task/task-wait.js';
import { createV2Api, type SafeTaskDTO } from '../lib/api-v2.js';
import { createSubmissionStore } from '../lib/submission-store.js';

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

if (new URLSearchParams(window.location.search).get('feature') === 'entry') createRoot(document.getElementById('root')!).render(<EntryHarness />);
else if (new URLSearchParams(window.location.search).get('feature') === 'photo') mountPhotoHarness();
else createRoot(document.getElementById('root')!).render(<V2Harness />);
