import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { inspectPhotoHeader, PHOTO_INPUT_LIMITS, type NativePhotoAdapter } from '../lib/photo-input';
import { NATIVE_PLUGINS } from './ios-shell';

type Status = 'cancelled' | 'denied' | 'unavailable';
export type MediaSelection = { status: Status } | { status: 'selected'; file: File; width: number; height: number };
export type NativeExport = { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png'; width: number; height: number; role: 'master' | 'comparison' | 'recipe' };
export type MediaProgress = { phase: 'loading' | 'share_sheet_opened'; fraction?: number };
export interface NativeMediaPlugin {
  select(options: { source: 'library' | 'camera' }): Promise<unknown>;
  convert(options: { data: string }): Promise<unknown>;
  save(options: { data: string; mime: string; width: number; height: number }): Promise<unknown>;
  share(options: { data: string; mime: string; width: number; height: number }): Promise<unknown>;
  discardTransient(): Promise<void>;
  addListener(event: 'importProgress', listener: (data: unknown) => void): Promise<PluginListenerHandle>;
}
const plugin = registerPlugin<NativeMediaPlugin>(NATIVE_PLUGINS.media);
const invalid = (): never => { throw new Error('INVALID_NATIVE_MEDIA'); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function encode(bytes: Uint8Array): string {
  let raw = ''; for (let offset = 0; offset < bytes.length; offset += 8192) raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(raw);
}
function validate(bytes: Uint8Array, mime: unknown, width: unknown, height: unknown, limit: number) {
  if (!bytes.byteLength || bytes.byteLength > limit || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || (width as number) < 1 || (height as number) < 1 || (width as number) * (height as number) > PHOTO_INPUT_LIMITS.pixels) invalid();
  try {
    const header = inspectPhotoHeader(bytes.subarray(0, PHOTO_INPUT_LIMITS.headerBytes));
    if (header.format === 'heic' || mime !== `image/${header.format}` || header.width !== width || header.height !== height || header.orientation !== 1) invalid();
  } catch { invalid(); }
}
function selection(value: unknown): MediaSelection {
  if (!object(value)) return invalid();
  if (['cancelled','denied','unavailable'].includes(String(value.status))) return { status: value.status as Status };
  if (value.status !== 'selected' || value.orientation !== 1 || typeof value.data !== 'string' || value.data.length > Math.ceil(PHOTO_INPUT_LIMITS.bytes / 3) * 4 || value.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) return invalid();
  const bytes = Uint8Array.from(atob(value.data), char => char.charCodeAt(0));
  if (value.bytes !== bytes.byteLength) return invalid();
  validate(bytes, value.mime, value.width, value.height, PHOTO_INPUT_LIMITS.bytes);
  return { status: 'selected', file: new File([bytes], value.mime === 'image/png' ? 'FORM-photo.png' : 'FORM-photo.jpg', { type: value.mime as string }), width: value.width as number, height: value.height as number };
}
/** Local bytes only. Upload remains an explicit consent operation in the existing intake flow. */
export function createNativeMedia(native: NativeMediaPlugin = plugin) {
  let busy = false;
  async function exclusive<T>(action: () => Promise<T>) {
    if (busy) throw new Error('NATIVE_MEDIA_BUSY'); busy = true;
    try { return await action(); } finally { busy = false; }
  }
  async function output(action: 'save' | 'share', image: NativeExport) {
    if (!['master','comparison','recipe'].includes(image.role) || !(image.bytes instanceof Uint8Array)) invalid();
    validate(image.bytes, image.mime, image.width, image.height, 32 * 1024 * 1024);
    return exclusive(async () => {
      const result = await native[action]({ data: encode(image.bytes), mime: image.mime, width: image.width, height: image.height });
      const allowed = action === 'save' ? ['saved','denied','unavailable','cancelled'] : ['shared','cancelled','unavailable'];
      if (!object(result) || !allowed.includes(String(result.status))) return invalid();
      return { status: result.status as 'saved' | 'shared' | Status };
    });
  }
  const convertHeic: NativePhotoAdapter['convertHeic'] = async source => {
    if (!source.size || source.size > PHOTO_INPUT_LIMITS.bytes) invalid();
    return exclusive(async () => {
      const result = selection(await native.convert({ data: encode(new Uint8Array(await source.arrayBuffer())) }));
      if (result.status !== 'selected') return invalid();
      return result.file;
    });
  };
  return Object.freeze({
    select: (source: 'library' | 'camera') => exclusive(async () => {
      if (!['library','camera'].includes(source)) invalid();
      return selection(await native.select({ source }));
    }), convertHeic, save: (image: NativeExport) => output('save', image), share: (image: NativeExport) => output('share', image),
    discardTransient: () => native.discardTransient(),
    async onProgress(listener: (progress: MediaProgress) => void) {
      const handle = await native.addListener('importProgress', value => {
        if (!object(value) || !['loading','share_sheet_opened'].includes(String(value.phase)) || value.fraction !== undefined && (typeof value.fraction !== 'number' || !Number.isFinite(value.fraction) || value.fraction < 0 || value.fraction > 1)) return;
        listener(value.fraction === undefined ? { phase: value.phase as MediaProgress['phase'] } : { phase: value.phase as MediaProgress['phase'], fraction: value.fraction as number });
      });
      return () => handle.remove();
    },
  });
}
