import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoInputError, assertPhotoByteLimit, assertPhotoPixelLimit, inspectPhotoHeader } from '../../src/lib/photo-input.js';

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

function jpegSegment(marker: number, payload: Uint8Array) {
  const result = new Uint8Array(payload.length + 4);
  result.set([255, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255]);
  result.set(payload, 4);
  return result;
}

function jpegHeader(width: number, height: number, orientation: number) {
  const exif = new Uint8Array([
    69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0,
    18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const frame = new Uint8Array([8, height >> 8, height & 255, width >> 8, width & 255, 1]);
  const sof = jpegSegment(192, frame);
  const app1 = jpegSegment(225, exif);
  const result = new Uint8Array(2 + app1.length + sof.length);
  result.set([255, 216]);
  result.set(app1, 2);
  result.set(sof, 2 + app1.length);
  return result;
}

test('reads PNG format and bounded IHDR dimensions from bytes', () => {
  assert.deepEqual(inspectPhotoHeader(pngHeader(320, 180)), {
    format: 'png', width: 320, height: 180, orientation: 1,
  });
});

test('reads JPEG frame dimensions and EXIF orientation from bytes', () => {
  assert.deepEqual(inspectPhotoHeader(jpegHeader(640, 360, 6)), {
    format: 'jpeg', width: 640, height: 360, orientation: 6,
  });
});

test('recognizes HEIC by its container signature and rejects unrelated bytes', () => {
  const heic = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0]);
  assert.deepEqual(inspectPhotoHeader(heic), {
    format: 'heic', width: null, height: null, orientation: null,
  });
  assert.throws(() => inspectPhotoHeader(new Uint8Array([1, 2, 3])), (error) =>
    error instanceof PhotoInputError && error.code === 'INPUT_UNSUPPORTED_FORMAT');
});

test('enforces byte and pixel limits at their exact boundaries', () => {
  assert.doesNotThrow(() => assertPhotoByteLimit(10 * 1024 * 1024));
  assert.throws(() => assertPhotoByteLimit(10 * 1024 * 1024 + 1), (error) =>
    error instanceof PhotoInputError && error.code === 'INPUT_BYTE_LIMIT');
  assert.doesNotThrow(() => assertPhotoPixelLimit(8000, 5000));
  assert.throws(() => assertPhotoPixelLimit(8001, 5000), (error) =>
    error instanceof PhotoInputError && error.code === 'INPUT_PIXEL_LIMIT');
});
