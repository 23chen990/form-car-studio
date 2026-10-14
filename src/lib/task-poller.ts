import type { SafeTaskDTO } from './api-v2.js';

export interface TaskPollerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface TaskPollerOptions {
  getTask(): Promise<SafeTaskDTO>;
  onTask(task: SafeTaskDTO): void;
  onError(error: unknown): void;
  scheduler?: TaskPollerScheduler;
}

const TERMINAL = new Set<SafeTaskDTO['status']>(['succeeded', 'failed', 'cancelled']);
const DEFAULT_SCHEDULER: TaskPollerScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function createTaskPoller(options: TaskPollerOptions) {
  const scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  let running = false;
  let closed = false;
  let visible = true;
  let terminal = false;
  let inFlight = false;
  let refreshQueued = false;
  let startedAt = 0;
  let timer: unknown;
  let hasTimer = false;
  let queuedResolvers: ((task: SafeTaskDTO | undefined) => void)[] = [];

  function clearScheduled() {
    if (hasTimer) scheduler.clearTimeout(timer);
    timer = undefined;
    hasTimer = false;
  }

  function resolveQueued(task?: SafeTaskDTO) {
    const resolvers = queuedResolvers;
    queuedResolvers = [];
    for (const resolve of resolvers) resolve(task);
  }

  function stop() {
    running = false;
    closed = true;
    clearScheduled();
    refreshQueued = false;
    resolveQueued();
  }

  function delayUntilNextPoll() {
    return scheduler.now() - startedAt >= 30_000 ? 5_000 : 2_000;
  }

  function scheduleNext() {
    if (!running || !visible || terminal || inFlight) return;
    clearScheduled();
    timer = scheduler.setTimeout(() => {
      hasTimer = false;
      timer = undefined;
      void poll();
    }, delayUntilNextPoll());
    hasTimer = true;
  }

  async function poll(resolvers: ((task: SafeTaskDTO | undefined) => void)[] = []) {
    if (!running || !visible || terminal) {
      for (const resolve of resolvers) resolve(undefined);
      return;
    }
    if (inFlight) {
      queuedResolvers.push(...resolvers);
      refreshQueued = true;
      return;
    }
    inFlight = true;
    let result: SafeTaskDTO | undefined;
    try {
      const task = await options.getTask();
      if (running) {
        result = task;
        options.onTask(task);
        terminal = TERMINAL.has(task.status);
      }
    } catch (error) {
      if (running) options.onError(error);
    } finally {
      inFlight = false;
      for (const resolve of resolvers) resolve(result);
      if (!running) {
        resolveQueued();
        return;
      }
      if (terminal) {
        stop();
        return;
      }
      if (visible && (refreshQueued || queuedResolvers.length > 0)) {
        refreshQueued = false;
        const nextResolvers = queuedResolvers;
        queuedResolvers = [];
        void poll(nextResolvers);
        return;
      }
      scheduleNext();
    }
  }

  return Object.freeze({
    // A stopped instance is one-shot; a remounted screen creates a fresh poller.
    start() {
      if (running || terminal || closed) return;
      running = true;
      startedAt = scheduler.now();
      scheduleNext();
    },
    refresh(): Promise<SafeTaskDTO | undefined> {
      if (!running || !visible || terminal) return Promise.resolve(undefined);
      clearScheduled();
      return new Promise(resolve => { void poll([resolve]); });
    },
    setVisible(nextVisible: boolean) {
      if (visible === nextVisible) return;
      visible = nextVisible;
      if (!visible) {
        clearScheduled();
      } else if (running && !terminal) {
        clearScheduled();
        if (inFlight) refreshQueued = true;
        else void poll();
      }
    },
    stop,
  });
}
