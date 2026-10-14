import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as cacheModule from '../../src/platform/cache';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = new Uint8Array([1,2,3]);
const key = (assetId = 'asset-a', ownerId = 'owner-a', projectId = 'project-a') => ({ ownerId, projectId, assetId, digest: hash(bytes) });
function loader() {
  assert.equal(typeof (cacheModule as any).createAuthorizedDisplayLoader, 'function', 'authorized display loader must exist');
  return (cacheModule as typeof import('../../src/platform/cache')).createAuthorizedDisplayLoader;
}
test('LRU byte budget and copy isolation survive reused asset IDs', () => {
  const cache = cacheModule.createPrivatePreviewCache(6); cache.setActiveOwner('owner-a');
  cache.set({ ...key('a'), kind: 'display', bytes }); cache.set({ ...key('b'), kind: 'thumbnail', bytes }); cache.get(key('a'));
  cache.set({ ...key('c'), kind: 'display', bytes }); assert.equal(cache.get(key('b')), null);
  const copy = cache.get(key('a'))!; copy[0] = 9; assert.equal(cache.get(key('a'))![0], 1); assert.equal(cache.stats().bytes, 6);
});
test('owner switch/logout/project deletion deny prior private previews and masters', () => {
  const cache = cacheModule.createPrivatePreviewCache(); cache.setActiveOwner('owner-a');
  assert.equal(cache.set({ ...key(), kind: 'original', bytes }), false); assert.equal(cache.set({ ...key(), kind: 'master', bytes }), false);
  cache.set({ ...key(), kind: 'display', bytes }); cache.clearProject('owner-a','project-a'); assert.equal(cache.get(key()), null);
  cache.set({ ...key(), kind: 'display', bytes }); cache.setActiveOwner('owner-b'); cache.setActiveOwner('owner-a'); assert.equal(cache.get(key()), null);
  cache.setActiveOwner(null); assert.equal(cache.set({ ...key(), kind: 'display', bytes }), false);
});
test('only matching already-fetched display bytes with actual SHA enter cache', async () => {
  const create = loader(), cache = cacheModule.createPrivatePreviewCache(); cache.setActiveOwner('owner-a');
  const display = create({ cache, owner: () => 'owner-a', sessionAllowsOffline: () => true, fetchDisplay: async () => ({ ...key(), bytes, kind: 'display' }) });
  assert.equal((await display.load(key(), false)).status, 'ready'); assert.deepEqual(cache.get(key()), bytes);
});
test('wrong content hash, owner or original/master never enters cache', async () => {
  const create = loader();
  for (const change of [{ digest: 'f'.repeat(64) }, { ownerId: 'owner-b' }, { kind: 'master' }, { kind: 'original' }]) {
    const cache = cacheModule.createPrivatePreviewCache(); cache.setActiveOwner('owner-a');
    const display = create({ cache, owner: () => 'owner-a', sessionAllowsOffline: () => true, fetchDisplay: async () => ({ ...key(), bytes, kind: 'display', ...change }) as any });
    assert.equal((await display.load(key(), false)).status, 'unavailable'); assert.equal(cache.stats().entries, 0);
  }
});
test('offline requires a valid session and cached bytes and invokes zero fetches', async () => {
  const create = loader(), cache = cacheModule.createPrivatePreviewCache(); cache.setActiveOwner('owner-a'); let calls = 0, allowed = true;
  const display = create({ cache, owner: () => 'owner-a', sessionAllowsOffline: () => allowed, fetchDisplay: async () => { calls++; return { ...key(), bytes, kind: 'display' }; } });
  assert.equal((await display.load(key(), true)).status, 'missing'); cache.set({ ...key(), bytes, kind: 'display' }); assert.equal((await display.load(key(), true)).status, 'ready');
  allowed = false; assert.equal((await display.load(key(), true)).status, 'unavailable'); assert.equal(calls, 0);
});
test('late fetch after owner switch or project tombstone cannot resurrect a preview', async () => {
  const create = loader();
  for (const mode of ['switch','delete']) {
    let owner = 'owner-a', finish!: (value: unknown) => void; const cache = cacheModule.createPrivatePreviewCache(); cache.setActiveOwner(owner);
    const display = create({ cache, owner: () => owner, sessionAllowsOffline: () => true, fetchDisplay: () => new Promise(resolve => { finish = resolve; }) as any });
    const pending = display.load(key(), false);
    if (mode === 'switch') { owner = 'owner-b'; cache.setActiveOwner(owner); } else cache.clearProject(owner,'project-a');
    finish({ ...key(), bytes, kind: 'display' }); assert.equal((await pending).status, 'unavailable'); assert.equal(cache.stats().entries, 0);
  }
});
