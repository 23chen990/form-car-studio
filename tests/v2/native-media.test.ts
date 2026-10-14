import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

async function load() {
  assert.ok(existsSync(new URL('../../src/platform/native-media.ts', import.meta.url)), 'native media adapter must exist');
  return import('../../src/platform/native-media.js');
}
const bytes = () => sharp({ create: { width: 2, height: 1, channels: 3, background: '#336699' } }).png().toBuffer();
async function selected() { const data = await bytes(); return { status: 'selected', data: data.toString('base64'), mime: 'image/png', width: 2, height: 1, bytes: data.length, orientation: 1 }; }
function port(overrides: Record<string, unknown> = {}): any {
  return { select: async () => ({ status: 'cancelled' }), convert: selected, save: async () => ({ status: 'saved' }), share: async () => ({ status: 'cancelled' }), discardTransient: async () => {}, addListener: async () => ({ remove: async () => {} }), ...overrides };
}
test('picker produces a local oriented file without uploading', async () => {
  const { createNativeMedia } = await load();
  const result = await createNativeMedia(port({ select: selected })).select('library');
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') {
    assert.equal(result.file.type, 'image/png'); assert.equal(result.width, 2); assert.equal(result.height, 1);
    assert.deepEqual(Buffer.from(await result.file.arrayBuffer()), await bytes());
  }
});
test('cancel, permission denial and unavailable camera never become selected/saved success', async () => {
  const { createNativeMedia } = await load();
  for (const status of ['cancelled', 'denied', 'unavailable']) {
    assert.deepEqual(await createNativeMedia(port({ select: async () => ({ status }) })).select('camera'), { status });
  }
  assert.deepEqual(await createNativeMedia(port({ save: async () => ({ status: 'denied' }) })).save({ bytes: await bytes(), width: 2, height: 1, mime: 'image/png', role: 'master' }), { status: 'denied' });
});
test('corrupt native result, unnormalized orientation and mismatched dimensions are rejected', async () => {
  const { createNativeMedia } = await load();
  for (const change of [{ width: 3 }, { orientation: 6 }, { mime: 'image/heic' }, { data: 'not-base64' }, { bytes: 0 }]) {
    await assert.rejects(createNativeMedia(port({ select: async () => ({ ...await selected(), ...change }) })).select('library'), /INVALID_NATIVE_MEDIA/);
  }
});
test('save preserves exact export bytes and actual dimensions', async () => {
  const { createNativeMedia } = await load(); const raw = await bytes(); let input: any;
  const media = createNativeMedia(port({ save: async (value: unknown) => { input = value; return { status: 'saved' }; } }));
  assert.equal((await media.save({ bytes: raw, width: 2, height: 1, mime: 'image/png', role: 'master' })).status, 'saved');
  assert.deepEqual(Buffer.from(input.data, 'base64'), raw); assert.equal(input.width, 2); assert.equal(input.height, 1);
});
test('display/original/invalid exports never reach native save or share', async () => {
  const { createNativeMedia } = await load(); let calls = 0;
  const media = createNativeMedia(port({ save: async () => { calls++; }, share: async () => { calls++; } }));
  for (const change of [{ role: 'display' }, { role: 'original' }, { width: 3 }, { bytes: new Uint8Array(0) }]) {
    await assert.rejects(media.save({ bytes: await bytes(), width: 2, height: 1, mime: 'image/png', role: 'master', ...change } as any), /INVALID_NATIVE_MEDIA/);
  }
  assert.equal(calls, 0);
});
test('share sheet cancellation stays cancellation and unknown outcome stays invalid', async () => {
  const { createNativeMedia } = await load(); const media = createNativeMedia(port());
  assert.deepEqual(await media.share({ bytes: await bytes(), width: 2, height: 1, mime: 'image/png', role: 'comparison' }), { status: 'cancelled' });
  await assert.rejects(createNativeMedia(port({ share: async () => ({ status: 'posted' }) })).share({ bytes: await bytes(), width: 2, height: 1, mime: 'image/png', role: 'recipe' }), /INVALID_NATIVE_MEDIA/);
});
test('multiple picker taps cannot launch another native selector', async () => {
  const { createNativeMedia } = await load(); let resolve!: (value: unknown) => void; let calls = 0;
  const media = createNativeMedia(port({ select: () => { calls++; return new Promise(r => { resolve = r; }); } }));
  const first = media.select('library'); await assert.rejects(media.select('camera'), /NATIVE_MEDIA_BUSY/);
  resolve({ status: 'cancelled' }); await first; assert.equal(calls, 1);
});
test('HEIC adapter returns decoded JPEG/PNG bytes for the existing photo preparation contract', async () => {
  const { createNativeMedia } = await load();
  const heic = new Blob([new Uint8Array([0,0,0,24,102,116,121,112,104,101,105,99])], { type: 'image/heic' });
  const converted = await createNativeMedia(port()).convertHeic(heic);
  assert.equal(converted.type, 'image/png'); assert.deepEqual(Buffer.from(await converted.arrayBuffer()), await bytes());
});
test('progress accepts actual native phases and removes its listener', async () => {
  const { createNativeMedia } = await load(); let callback!: (x: unknown) => void; const seen: unknown[] = []; let removed = false;
  const media = createNativeMedia(port({ addListener: async (_event: string, fn: (x: unknown) => void) => { callback = fn; return { remove: async () => { removed = true; } }; } }));
  const stop = await media.onProgress(value => seen.push(value));
  callback({ phase: 'loading' }); callback({ phase: 'loading', fraction: 0.5 }); callback({ phase: 'loading', fraction: 4 }); callback({ phase: 'model' });
  await stop(); assert.equal(removed, true); assert.deepEqual(seen, [{ phase: 'loading' }, { phase: 'loading', fraction: 0.5 }]);
});
test('native permission and temporary export boundaries are explicit', () => {
  const path = new URL('../../ios/App/App/Plugins/FORMMedia.swift', import.meta.url);
  assert.ok(existsSync(path), 'native media plugin must exist'); const source = readFileSync(path, 'utf8');
  assert.match(source, /selectionLimit = 1/); assert.match(source, /loadFileRepresentation/);
  assert.match(source, /requestAuthorization\(for: \.addOnly\)/); assert.doesNotMatch(source, /\.readWrite|startUpdatingLocation/);
  assert.match(source, /completionWithItemsHandler/); assert.match(source, /removeItem/); assert.match(source, /\.complete/);
});
