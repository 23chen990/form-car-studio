import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEditRequest, createDraftState, hasEffectiveChanges, reduceDraft, type DraftSnapshot } from '../../src/lib/draft-v2.js';

const base: DraftSnapshot = {
  ownerId: 'owner-a', projectId: 'project-1', revision: 4,
  source: { kind: 'version', versionId: 'version-7' },
  edits: { bodyColor: { action: 'set', value: 'blue' } },
};

test('draft transitions keep source and revision while undo restores the prior recipe', () => {
  const initial = createDraftState(base);
  const changed = reduceDraft(initial, { type: 'edit', field: 'wheelColor', edit: { action: 'set', value: 'bronze' } });
  const undone = reduceDraft(changed, { type: 'undo' });
  assert.deepEqual(undone.snapshot, base);
  assert.equal(undone.snapshot.revision, 4);
  assert.deepEqual(undone.snapshot.source, { kind: 'version', versionId: 'version-7' });
});

test('reset clears draft edits without changing the selected historical source or revision', () => {
  const initial = createDraftState(base);
  const reset = reduceDraft(initial, { type: 'reset' });
  assert.deepEqual(reset.snapshot, { ...base, edits: {} });
  assert.deepEqual(reduceDraft(reset, { type: 'undo' }).snapshot, base);
});

test('undo restores requested edits without rolling back an acknowledged persistence revision', () => {
  const edited = reduceDraft(createDraftState({ ...base, edits: {} }), { type: 'edit', field: 'bodyColor', edit: { action: 'set', value: 'blue' } });
  const saved = reduceDraft(edited, { type: 'acknowledge', revision: 5 });
  const undone = reduceDraft(saved, { type: 'undo' });
  assert.equal(undone.snapshot.revision, 5);
  assert.deepEqual(undone.snapshot.edits, {});
});

test('restoring an already-original source is a no-op and cannot be quoted', () => {
  const restore = { ...base, source: { kind: 'original' as const }, edits: { bodyColor: { action: 'restore_original' as const } } };
  assert.equal(hasEffectiveChanges(restore), false);
  assert.equal(hasEffectiveChanges({ ...restore, source: { kind: 'version' as const, versionId: 'version-7' } }), true);
});

test('detail request preserves the exact selected historical base and restore action', () => {
  const snapshot = { ...base, edits: { bodyColor: { action: 'restore_original' as const } } };
  assert.deepEqual(buildEditRequest(snapshot, 'detail'), {
    schemaVersion: 2, source: { kind: 'version', versionId: 'version-7' }, operation: 'detail',
    edits: { bodyColor: { action: 'restore_original' } },
  });
});

test('explore request is fixed to an original base and frozen style', () => {
  const snapshot = { ...base, source: { kind: 'original' as const }, edits: {} };
  assert.deepEqual(buildEditRequest(snapshot, 'explore', 'clean'), {
    schemaVersion: 2, source: { kind: 'original' }, operation: 'explore', styleId: 'clean', edits: {},
  });
  assert.throws(() => buildEditRequest(base, 'explore', 'clean'));
});
