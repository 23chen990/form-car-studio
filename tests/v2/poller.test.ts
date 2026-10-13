import assert from 'node:assert/strict';
import test from 'node:test';
import type { SafeTaskDTO } from '../../src/lib/api-v2.js';
import { createTaskPoller } from '../../src/lib/task-poller.js';

function task(status: SafeTaskDTO['status'] = 'queued'): SafeTaskDTO {
  return {
    id: 'task-1', projectId: 'project-1', planId: 'plan-1', status,
    userCostUnits: 1, createdAt: '2026-10-14T00:00:00.000Z', updatedAt: null,
    resultVersionId: status === 'succeeded' ? 'version-1' : null,
    creditReturned: status === 'failed' || status === 'cancelled', safeErrorCode: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class ManualClock {
  time = 0;
  nextId = 1;
  readonly delays: number[] = [];
  readonly timers = new Map<number, { at: number; run: () => void }>();
  setTimeout = (run: () => void, delay: number) => {
    const id = this.nextId++;
    this.delays.push(delay);
    this.timers.set(id, { at: this.time + delay, run });
    return id;
  };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  now = () => this.time;
  async tick() {
    const [id, timer] = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
    assert.ok(timer, 'expected a scheduled poll');
    this.timers.delete(id!);
    this.time = timer!.at;
    timer!.run();
    await Promise.resolve();
    await Promise.resolve();
  }
  async flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
}

test('poller keeps one request in flight and ignores a late response after stop', async () => {
  const clock = new ManualClock(), pending = deferred<SafeTaskDTO>();
  let calls = 0, updates = 0;
  const poller = createTaskPoller({
    getTask: () => { calls++; return pending.promise; },
    onTask: () => { updates++; }, onError: () => undefined,
    scheduler: clock,
  });
  poller.start();
  await clock.tick();
  assert.equal(calls, 1);
  void poller.refresh();
  void poller.refresh();
  assert.equal(calls, 1, 'manual refreshes must not overlap a slow request');
  poller.stop();
  pending.resolve(task('succeeded'));
  await clock.flush();
  assert.equal(updates, 0, 'stopped pollers must discard late responses');
  assert.equal(clock.timers.size, 0);
});

test('poller backs off after 30 seconds and foreground refreshes immediately', async () => {
  const clock = new ManualClock();
  let calls = 0;
  const poller = createTaskPoller({
    getTask: async () => { calls++; return task(); },
    onTask: () => undefined, onError: () => undefined,
    scheduler: clock,
  });
  poller.start();
  for (let index = 0; index < 15; index++) await clock.tick();
  assert.equal(calls, 15);
  assert.equal(clock.delays.at(-1), 5_000, 'the first poll after 30 seconds uses 5 seconds');
  poller.setVisible(false);
  const beforeHidden = calls;
  assert.equal(clock.timers.size, 0, 'hiding the page clears the scheduled poll');
  assert.equal(calls, beforeHidden, 'hidden pages pause scheduled polling');
  poller.setVisible(true);
  await clock.flush();
  assert.equal(calls, beforeHidden + 1, 'foreground refreshes without waiting for the timer');
  poller.stop();
});

test('terminal state stops future polling', async () => {
  const clock = new ManualClock();
  let calls = 0;
  const poller = createTaskPoller({
    getTask: async () => { calls++; return task('succeeded'); },
    onTask: () => undefined, onError: () => undefined,
    scheduler: clock,
  });
  poller.start();
  await clock.tick();
  assert.equal(calls, 1);
  assert.equal(clock.timers.size, 0);
  poller.setVisible(true);
  await clock.flush();
  assert.equal(calls, 1);
});

test('a stopped poller cannot restart and accept an older request in a new lifecycle', async () => {
  const clock = new ManualClock(), pending = deferred<SafeTaskDTO>();
  let calls = 0;
  const updates: SafeTaskDTO['status'][] = [];
  const poller = createTaskPoller({
    getTask: () => { calls++; return calls === 1 ? pending.promise : Promise.resolve(task('queued')); },
    onTask: next => { updates.push(next.status); }, onError: () => undefined,
    scheduler: clock,
  });
  poller.start();
  await clock.tick();
  poller.stop();
  poller.start();
  assert.equal(clock.timers.size, 0, 'a stopped one-shot poller cannot schedule a new lifecycle');
  pending.resolve(task('failed'));
  await clock.flush();
  assert.equal(calls, 1);
  assert.deepEqual(updates, []);
});
