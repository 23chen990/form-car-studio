export const PHOTO_INPUT_LIMITS = Object.freeze({
  bytes: 10 * 1024 * 1024,
  pixels: 40_000_000,
  headerBytes: 64 * 1024,
  previewEdge: 1200,
  previewBytes: 10 * 1024 * 1024,
});

export type PhotoInputErrorCode =
  | 'INPUT_EMPTY' | 'INPUT_BYTE_LIMIT' | 'INPUT_PIXEL_LIMIT' | 'INPUT_UNSUPPORTED_FORMAT'
  | 'INPUT_UNSUPPORTED_HEIC' | 'INPUT_UNREADABLE' | 'INPUT_DECODER_UNAVAILABLE'
  | 'INPUT_ORIENTATION_UNSUPPORTED' | 'INPUT_CONVERSION_FAILED' | 'PREVIEW_UNAVAILABLE'
  | 'PREVIEW_BYTE_LIMIT';

const ERROR_COPY: Record<PhotoInputErrorCode, string> = {
  INPUT_EMPTY: 'Choose a photo to continue.',
  INPUT_BYTE_LIMIT: 'This photo is larger than 10 MB. Choose a smaller photo.',
  INPUT_PIXEL_LIMIT: 'This photo is too large to process. Choose a smaller image.',
  INPUT_UNSUPPORTED_FORMAT: 'This format is not supported. Choose a JPEG or PNG photo.',
  INPUT_UNSUPPORTED_HEIC: 'This HEIC photo cannot be opened in this browser yet. Export or download it as JPEG or PNG, then try again.',
  INPUT_UNREADABLE: 'This photo could not be read. If it is stored in iCloud, download it to your device and try again.',
  INPUT_DECODER_UNAVAILABLE: 'This browser cannot prepare a photo preview. Try exporting the photo as JPEG or PNG.',
  INPUT_ORIENTATION_UNSUPPORTED: 'This browser could not apply the photo orientation. Export it as JPEG or PNG and try again.',
  INPUT_CONVERSION_FAILED: 'This photo could not be converted safely. Choose a JPEG or PNG photo instead.',
  PREVIEW_UNAVAILABLE: 'A local preview could not be prepared. Your original photo remains on this device.',
  PREVIEW_BYTE_LIMIT: 'A safe local preview could not be prepared. Choose a smaller photo.',
};

export class PhotoInputError extends Error {
  constructor(readonly code: PhotoInputErrorCode) {
    super(ERROR_COPY[code]);
    this.name = 'PhotoInputError';
  }
}

export interface PhotoHeader {
  format: 'png' | 'jpeg' | 'heic';
  width: number | null;
  height: number | null;
  orientation: number | null;
}

export interface NativePhotoAdapter {
  convertHeic(source: Blob): Promise<Blob>;
}

export interface PreparedPhoto {
  uploadBlob: Blob;
  previewBlob: Blob;
  format: 'png' | 'jpeg';
  width: number;
  height: number;
  orientation: number;
}

function unsupported(): never { throw new PhotoInputError('INPUT_UNSUPPORTED_FORMAT'); }
function unreadable(): never { throw new PhotoInputError('INPUT_UNREADABLE'); }
const ascii = (bytes: Uint8Array, start: number, value: string) =>
  start >= 0 && start + value.length <= bytes.length && [...value].every((char, index) => bytes[start + index] === char.charCodeAt(0));

export function assertPhotoByteLimit(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) unreadable();
  if (size === 0) throw new PhotoInputError('INPUT_EMPTY');
  if (size > PHOTO_INPUT_LIMITS.bytes) throw new PhotoInputError('INPUT_BYTE_LIMIT');
}

export function assertPhotoPixelLimit(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) unreadable();
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > PHOTO_INPUT_LIMITS.pixels) throw new PhotoInputError('INPUT_PIXEL_LIMIT');
}

function readOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (end - start < 14 || !ascii(bytes, start, 'Exif\0\0')) return null;
  const tiff = start + 6;
  const little = bytes[tiff] === 73 && bytes[tiff + 1] === 73;
  if (!little && !(bytes[tiff] === 77 && bytes[tiff + 1] === 77)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3 && u32(entry + 4) >= 1) {
      const orientation = u16(entry + 8);
      return orientation >= 1 && orientation <= 8 ? orientation : null;
    }
  }
  return null;
}

function inspectJpeg(bytes: Uint8Array): PhotoHeader {
  let offset = 2;
  let orientation = 1;
  for (let segments = 0; segments < 4096 && offset < bytes.length;) {
    if (bytes[offset] !== 255) unreadable();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0 || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) unreadable();
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) unreadable();
    const data = offset + 2;
    const end = offset + length;
    if (marker === 0xe1) orientation = readOrientation(bytes, data, end) ?? orientation;
    const frame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (frame) {
      if (length < 8 || bytes[data + 5] === 0) unreadable();
      const height = (bytes[data + 1]! << 8) | bytes[data + 2]!;
      const width = (bytes[data + 3]! << 8) | bytes[data + 4]!;
      return { format: 'jpeg', width, height, orientation };
    }
    offset = end;
    segments++;
  }
  return unreadable();
}

export function inspectPhotoHeader(bytes: Uint8Array): PhotoHeader {
  if (bytes.byteLength === 0) throw new PhotoInputError('INPUT_EMPTY');
  if (bytes.byteLength > PHOTO_INPUT_LIMITS.headerBytes) throw new PhotoInputError('INPUT_UNREADABLE');
  if (bytes.length >= 8 && bytes[0] === 137 && ascii(bytes, 1, 'PNG\r\n\x1a\n')) {
    if (bytes.length < 24 || !ascii(bytes, 12, 'IHDR')) unreadable();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false), height = view.getUint32(20, false);
    assertPhotoPixelLimit(width, height);
    return { format: 'png', width, height, orientation: 1 };
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    const header = inspectJpeg(bytes);
    assertPhotoPixelLimit(header.width!, header.height!);
    return header;
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 'ftyp')) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (['heic', 'heix', 'hevc', 'hevx', 'heif', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) {
      return { format: 'heic', width: null, height: null, orientation: null };
    }
  }
  return unsupported();
}

async function headerFor(blob: Blob): Promise<PhotoHeader> {
  try { return inspectPhotoHeader(new Uint8Array(await blob.slice(0, PHOTO_INPUT_LIMITS.headerBytes).arrayBuffer())); }
  catch (error) {
    if (error instanceof PhotoInputError) throw error;
    return unreadable();
  }
}

async function makePreview(bitmap: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, PHOTO_INPUT_LIMITS.previewEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new PhotoInputError('PREVIEW_UNAVAILABLE');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const preview = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value =>
    value ? resolve(value) : reject(new PhotoInputError('PREVIEW_UNAVAILABLE')), 'image/jpeg', 0.86));
  if (preview.size > PHOTO_INPUT_LIMITS.previewBytes) throw new PhotoInputError('PREVIEW_BYTE_LIMIT');
  return preview;
}

export async function preparePhoto(source: Blob, options: { nativeAdapter?: NativePhotoAdapter } = {}): Promise<PreparedPhoto> {
  assertPhotoByteLimit(source.size);
  let uploadBlob = source;
  let header = await headerFor(source);
  if (header.format === 'heic') {
    if (!options.nativeAdapter) throw new PhotoInputError('INPUT_UNSUPPORTED_HEIC');
    try { uploadBlob = await options.nativeAdapter.convertHeic(source); }
    catch { throw new PhotoInputError('INPUT_CONVERSION_FAILED'); }
    assertPhotoByteLimit(uploadBlob.size);
    header = await headerFor(uploadBlob);
    if (header.format === 'heic') throw new PhotoInputError('INPUT_CONVERSION_FAILED');
  }
  if (header.format !== 'png' && header.format !== 'jpeg') unsupported();
  assertPhotoPixelLimit(header.width!, header.height!);
  if (typeof globalThis.createImageBitmap !== 'function') throw new PhotoInputError('INPUT_DECODER_UNAVAILABLE');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(uploadBlob, { imageOrientation: 'from-image' }); }
  catch { throw new PhotoInputError('INPUT_UNREADABLE'); }
  try {
    assertPhotoPixelLimit(bitmap.width, bitmap.height);
    const swapped = header.orientation! >= 5 && header.orientation! <= 8;
    const expectedWidth = swapped ? header.height! : header.width!;
    const expectedHeight = swapped ? header.width! : header.height!;
    if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) throw new PhotoInputError('INPUT_ORIENTATION_UNSUPPORTED');
    return {
      uploadBlob, previewBlob: await makePreview(bitmap), format: header.format,
      width: bitmap.width, height: bitmap.height, orientation: header.orientation!,
    };
  } finally { bitmap.close(); }
}
