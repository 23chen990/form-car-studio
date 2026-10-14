import { useEffect, useRef, useState } from 'react';
import { V2HttpError, V2NetworkError, type SafeTaskDTO, type createV2Api } from '../../lib/api-v2.js';
import { createTaskPoller } from '../../lib/task-poller.js';
import './task-wait.css';

type TaskApi = Pick<ReturnType<typeof createV2Api>, 'getTask' | 'cancelTask' | 'resumeSubmission'>;
type Snapshot = { identity: string; task: SafeTaskDTO };
type Message = { identity: string; text: string };
const TERMINAL = new Set<SafeTaskDTO['status']>(['succeeded', 'failed', 'cancelled']);

function errorCopy(error: unknown): string {
  if (!navigator.onLine || error instanceof V2NetworkError) return 'You appear to be offline. Reconnect to check this task.';
  if (error instanceof V2HttpError && error.status === 401) return 'Sign in again to check this task.';
  if (error instanceof V2HttpError && error.status === 404) return 'This task is not available for the current account.';
  return 'We could not refresh this task. Try again when your connection is available.';
}

function stateCopy(task: SafeTaskDTO): { heading: string; detail: string } {
  switch (task.status) {
    case 'queued': return { heading: 'Waiting to start.', detail: 'You can leave this screen. Your task will continue.' };
    case 'processing': return { heading: 'Creating your look.', detail: 'You can leave this screen. Your task will continue.' };
    case 'uncertain': return { heading: 'Checking an interrupted request.', detail: 'We will not submit it again automatically.' };
    case 'succeeded': return { heading: 'Your look is ready.', detail: 'Your saved result is ready to view.' };
    case 'failed':
      if (task.safeErrorCode === 'OUTPUT_UNCHANGED') return { heading: 'This look could not be completed.', detail: task.creditReturned ? 'This request did not produce a changed image. Your credit was returned.' : 'This request did not produce a changed image. Your credit return is not confirmed.' };
      return { heading: 'This look could not be completed.', detail: task.creditReturned ? 'We could not complete this look. Your credit was returned.' : 'We could not complete this look. Your credit return is not confirmed.' };
    case 'cancelled': return { heading: 'This look was cancelled.', detail: task.creditReturned ? 'This task was cancelled. Your credit was returned.' : 'This task was cancelled. Your credit return is not confirmed.' };
  }
}

export function TaskWait(props: {
  actorId: string;
  taskId?: string;
  submissionId?: string;
  initialTask?: { actorId: string; task: SafeTaskDTO };
  api: TaskApi;
  onBrowse?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [recovered, setRecovered] = useState<{ actorId: string; submissionId: string; task: SafeTaskDTO } | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busyIdentity, setBusyIdentity] = useState('');
  const poller = useRef<ReturnType<typeof createTaskPoller> | null>(null);
  const mounted = useRef(true);
  const activeTaskId = props.taskId ?? (recovered?.actorId === props.actorId && recovered.submissionId === props.submissionId ? recovered.task.id : undefined);
  const identity = `${props.actorId}:${activeTaskId ?? 'pending'}:${props.submissionId ?? ''}`;
  const lifecycle = useRef({ identity, revision: 0 });
  if (lifecycle.current.identity !== identity) lifecycle.current = { identity, revision: lifecycle.current.revision + 1 };
  const revision = lifecycle.current.revision;
  const isCurrent = () => mounted.current && lifecycle.current.identity === identity && lifecycle.current.revision === revision;
  const initial = props.initialTask?.actorId === props.actorId && props.initialTask.task.id === activeTaskId ? props.initialTask.task : undefined;
  const recoveredTask = recovered?.actorId === props.actorId && recovered.submissionId === props.submissionId && recovered.task.id === activeTaskId ? recovered.task : undefined;
  const task = snapshot?.identity === identity ? snapshot.task : recoveredTask ?? initial;
  const currentMessage = message?.identity === identity ? message.text : '';
  const busy = busyIdentity === identity;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let disposed = false;
    setBusyIdentity('');
    setMessage({ identity, text: '' });
    if (!activeTaskId || (task && TERMINAL.has(task.status))) {
      poller.current = null;
      return () => { disposed = true; };
    }
    const currentPoller = createTaskPoller({
      getTask: () => props.api.getTask(props.actorId, activeTaskId),
      onTask: next => { if (!disposed) { setSnapshot({ identity, task: next }); setMessage({ identity, text: '' }); } },
      onError: error => { if (!disposed) setMessage({ identity, text: errorCopy(error) }); },
    });
    poller.current = currentPoller;
    const visibilityChanged = () => currentPoller.setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', visibilityChanged);
    visibilityChanged();
    currentPoller.start();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', visibilityChanged);
      currentPoller.stop();
      if (poller.current === currentPoller) poller.current = null;
    };
  }, [activeTaskId, identity, props.actorId, props.api]);

  async function recoverSameSubmission() {
    if (!props.submissionId || busy) return;
    setBusyIdentity(identity);
    setMessage({ identity, text: '' });
    try {
      const next = await props.api.resumeSubmission(props.actorId, props.submissionId);
      if (!isCurrent()) return;
      setRecovered({ actorId: props.actorId, submissionId: props.submissionId, task: next });
      setSnapshot({ identity: `${props.actorId}:${next.id}:${props.submissionId}`, task: next });
    } catch (error) {
      if (isCurrent()) setMessage({ identity, text: errorCopy(error) });
    } finally {
      if (isCurrent()) setBusyIdentity('');
    }
  }

  async function cancelQueued() {
    if (!task || task.status !== 'queued' || busy) return;
    setBusyIdentity(identity);
    setMessage({ identity, text: '' });
    try {
      const next = await props.api.cancelTask(props.actorId, task.id);
      if (!isCurrent()) return;
      setSnapshot({ identity, task: next });
      if (TERMINAL.has(next.status)) poller.current?.stop();
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof V2HttpError && error.status === 409) {
        const latest = await poller.current?.refresh();
        if (!isCurrent()) return;
        if (latest?.status === 'processing' || latest?.status === 'uncertain') setMessage({ identity, text: 'This look has already started. You can leave and return later.' });
        else if (latest?.status === 'queued') setMessage({ identity, text: 'This task is still waiting to start. Check its status before trying again.' });
      } else setMessage({ identity, text: errorCopy(error) });
    } finally {
      if (isCurrent()) setBusyIdentity('');
    }
  }

  const presentation = task ? stateCopy(task) : { heading: 'Checking your task.', detail: 'We are checking the same request.' };
  return <section className="v2-task" aria-label="Task status" data-task-status={task?.status ?? 'checking'}>
    <p className="v2-task__eyebrow">YOUR TASK</p>
    <h2 aria-live="polite">{presentation.heading}</h2>
    <p className="v2-task__detail">{presentation.detail}</p>
    {currentMessage && <p className="v2-task__message" role="alert">{currentMessage}</p>}
    <div className="v2-task__actions">
      {task?.status === 'queued' && <button className="v2-task__secondary" type="button" disabled={busy} onClick={() => void cancelQueued()}>{busy ? 'Cancelling…' : 'Cancel before processing'}</button>}
      {activeTaskId && (!task || !TERMINAL.has(task.status)) && <button className="v2-task__secondary" type="button" disabled={busy} onClick={() => void poller.current?.refresh()}>Refresh status</button>}
      {!activeTaskId && props.submissionId && <button className="v2-task__primary" type="button" disabled={busy} onClick={() => void recoverSameSubmission()}>{busy ? 'Checking same request…' : 'Recover same submission'}</button>}
      {props.onBrowse && <button className="v2-task__text" type="button" onClick={props.onBrowse}>Browse</button>}
    </div>
  </section>;
}
