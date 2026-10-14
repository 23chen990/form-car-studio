import assert from 'node:assert/strict';
import test from 'node:test';
import { assertExportDimensions, createGarageExport, fitContainedRect, validateOwnedAssetBlob, type GarageExportRuntime } from '../../src/lib/export-v2.js';

test('full-car export geometry contains a landscape image without cropping', () => {
  assert.deepEqual(fitContainedRect(640, 400, 320, 320), { x: 0, y: 60, width: 320, height: 200 });
});

test('full-car export geometry contains a portrait image without cropping', () => {
  assert.deepEqual(fitContainedRect(400, 640, 300, 200), { x: 87.5, y: 0, width: 125, height: 200 });
});

test('decoded dimensions must be safe and stay within the pixel ceiling', () => {
  assert.doesNotThrow(() => assertExportDimensions(6000, 6000));
  assert.throws(() => assertExportDimensions(7000, 7000), /dimension|pixel/i);
  assert.throws(() => assertExportDimensions(0, 400), /dimension|pixel/i);
});

test('export bytes must be an owned bounded PNG or JPEG blob', () => {
  const identity = { ownerId: 'owner-a', projectId: 'project-a', assetId: 'asset-a' };
  const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  assert.equal(validateOwnedAssetBlob({ ...identity, bytes: png }, identity), png);
  assert.throws(() => validateOwnedAssetBlob({ ...identity, ownerId: 'owner-b', bytes: png }, identity), /owner|asset|scope/i);
  assert.throws(() => validateOwnedAssetBlob({ ...identity, bytes: new Blob(['<svg/>'], { type: 'image/svg+xml' }) }, identity), /image|asset|type/i);
});

test('clean and comparison exports use decoded dimensions and contain every source image', async () => {
  const draws: number[][] = [];
  const texts: string[] = [];
  const runtime: GarageExportRuntime = {
    decode: async blob => ({ width: blob.size === 1 ? 640 : 400, height: blob.size === 1 ? 400 : 640,
      draw: (_context, ...rect) => { draws.push(rect); }, close: () => undefined }),
    canvas: (width, height) => ({ width, height, context: { fillStyle: '', font: '', textBaseline: 'top',
      fillRect: () => undefined, drawImage: (_image, x, y, w, h) => { draws.push([x, y, w, h]); },
      fillText: value => { texts.push(value); },
    }, toBlob: async () => new Blob(['export'], { type: 'image/png' }) }),
  };
  const asset = (assetId: string, size: number) => ({ ownerId: 'owner-a', projectId: 'project-a', assetId,
    bytes: new Blob([new Uint8Array(size)], { type: 'image/png' }) });
  const clean = await createGarageExport({ kind: 'clean', ownerId: 'owner-a', projectId: 'project-a', versionId: 'version-a', assetId: 'asset-a',
    asset: asset('asset-a', 1) }, runtime);
  assert.deepEqual([clean.width, clean.height], [640, 400]);
  assert.deepEqual(draws.pop(), [0, 0, 640, 400]);
  const comparison = await createGarageExport({ kind: 'comparison', ownerId: 'owner-a', projectId: 'project-a', versionId: 'version-a', assetId: 'asset-a',
    asset: asset('asset-a', 1), comparison: { versionId: 'version-b', assetId: 'asset-b', asset: asset('asset-b', 2) } }, runtime);
  assert.deepEqual([comparison.width, comparison.height], [1280, 640]);
  assert.deepEqual(draws.slice(-2), [[0, 120, 640, 400], [760, 0, 400, 640]]);
});

test('portrait recipe export has explicit static dimensions and uses requested text only', async () => {
  const texts: string[] = [];
  const runtime: GarageExportRuntime = {
    decode: async () => ({ width: 640, height: 400, draw: () => undefined, close: () => undefined }),
    canvas: (width, height) => ({ width, height, context: { fillStyle: '', font: '', textBaseline: 'top', fillRect: () => undefined, drawImage: () => undefined,
      fillText: value => { texts.push(value); } }, toBlob: async () => new Blob(['export'], { type: 'image/png' }) }),
  };
  const result = await createGarageExport({ kind: 'recipe', ownerId: 'owner-a', projectId: 'project-a', versionId: 'version-a', assetId: 'asset-a',
    asset: { ownerId: 'owner-a', projectId: 'project-a', assetId: 'asset-a', bytes: new Blob(['x'], { type: 'image/jpeg' }) },
    recipe: ['Requested body color: green'] }, runtime);
  assert.deepEqual([result.width, result.height], [1080, 1350]);
  assert.ok(texts.includes('Requested recipe'));
  assert.ok(texts.includes('• Requested body color: green'));
  assert.equal(result.blob.type, 'image/png');
});

test('decoded pixel ceiling and owner envelope are checked before export', async () => {
  const runtime: GarageExportRuntime = {
    decode: async () => ({ width: 7000, height: 7000, draw: () => undefined, close: () => undefined }),
    canvas: () => { throw new Error('canvas should not be allocated'); },
  };
  await assert.rejects(createGarageExport({ kind: 'clean', ownerId: 'owner-a', projectId: 'project-a', versionId: 'version-a', assetId: 'asset-a',
    asset: { ownerId: 'owner-b', projectId: 'project-a', assetId: 'asset-a', bytes: new Blob(['x'], { type: 'image/png' }) } }, runtime), /asset|owner|scope/i);
  await assert.rejects(createGarageExport({ kind: 'clean', ownerId: 'owner-a', projectId: 'project-a', versionId: 'version-a', assetId: 'expected-asset',
    asset: { ownerId: 'owner-a', projectId: 'project-a', assetId: 'other-asset', bytes: new Blob(['x'], { type: 'image/png' }) } }, runtime), /asset|owner|scope/i);
  await assert.rejects(createGarageExport({ kind: 'clean', ownerId: 'owner-a', projectId: 'project-a', versionId: 'version-a', assetId: 'asset-a',
    asset: { ownerId: 'owner-a', projectId: 'project-a', assetId: 'asset-a', bytes: new Blob(['x'], { type: 'image/png' }) } }, runtime), /pixel|dimension/i);
});

test('empty PNG encoding fails and closes decoded resources', async () => {
  let closed = 0;
  const runtime: GarageExportRuntime = {
    decode: async () => ({ width: 10, height: 10, draw: () => undefined, close: () => { closed++; } }),
    canvas: (width, height) => ({ width, height, context: { fillStyle: '', font: '', textBaseline: 'top', fillRect: () => undefined,
      drawImage: () => undefined, fillText: () => undefined }, toBlob: async () => new Blob([], { type: 'image/png' }) }),
  };
  await assert.rejects(createGarageExport({ kind: 'clean', ownerId: 'owner-a', projectId: 'project-a', versionId: 'version-a', assetId: 'asset-a',
    asset: { ownerId: 'owner-a', projectId: 'project-a', assetId: 'asset-a', bytes: new Blob(['x'], { type: 'image/png' }) } }, runtime), /bounded|empty|export/i);
  assert.equal(closed, 1);
});
