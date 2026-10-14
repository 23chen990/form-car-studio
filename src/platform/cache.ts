export type PreviewKind = 'display' | 'thumbnail' | 'master' | 'original';
export type PreviewKey = { ownerId: string; projectId: string; assetId: string; digest: string };
type Entry = PreviewKey & { kind: PreviewKind; bytes: Uint8Array };
const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Ephemeral cache for already-fetched previews; originals and masters never enter it. */
export function createPrivatePreviewCache(maxBytes = 100 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) throw new Error('INVALID_PREVIEW_CACHE_LIMIT');
  const entries = new Map<string, Entry>();
  let bytes = 0, activeOwner: string | null = null, revision = 0;
  const keyOf = (key: PreviewKey) => JSON.stringify([key.ownerId, key.projectId, key.assetId, key.digest]);
  function validKey(key: PreviewKey) {
    return validId(key.ownerId) && validId(key.projectId) && validId(key.assetId) && /^[a-f0-9]{64}$/.test(key.digest);
  }
  function remove(key: string) { const entry = entries.get(key); if (entry) { bytes -= entry.bytes.byteLength; entries.delete(key); } }
  function set(input: PreviewKey & { kind: PreviewKind; bytes: Uint8Array }) {
    if (!validKey(input) || !['display','thumbnail','master','original'].includes(input.kind) || input.kind === 'master' || input.kind === 'original' || !(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > maxBytes || !activeOwner || activeOwner !== input.ownerId) return false;
    const key = keyOf(input), copy = new Uint8Array(input.bytes);
    remove(key);
    while (bytes + copy.byteLength > maxBytes) remove(entries.keys().next().value!);
    entries.set(key, { ...input, bytes: copy }); bytes += copy.byteLength;
    return true;
  }
  function get(key: PreviewKey): Uint8Array | null {
    if (!validKey(key) || !activeOwner || activeOwner !== key.ownerId) return null;
    const id = keyOf(key), entry = entries.get(id); if (!entry) return null;
    entries.delete(id); entries.set(id, entry); return new Uint8Array(entry.bytes);
  }
  function clearOwner(ownerId: string) { revision++; for (const [id, entry] of entries) if (entry.ownerId === ownerId) remove(id); }
  function clearProject(ownerId: string, projectId: string) { revision++; for (const [id, entry] of entries) if (entry.ownerId === ownerId && entry.projectId === projectId) remove(id); }
  function setActiveOwner(ownerId: string | null) {
    if (ownerId !== null && !validId(ownerId)) throw new Error('INVALID_PREVIEW_CACHE_OWNER');
    if (activeOwner !== ownerId) {
      revision++;
      if (activeOwner) clearOwner(activeOwner);
      else for (const [id, entry] of entries) if (entry.ownerId !== ownerId) remove(id);
      activeOwner = ownerId;
    }
  }
  return Object.freeze({ set, get, clearOwner, clearProject, setActiveOwner, lease: () => revision, clearAll: () => { revision++; entries.clear(); bytes = 0; }, stats: () => ({ bytes, entries: entries.size }) });
}
export type PrivatePreviewCache = ReturnType<typeof createPrivatePreviewCache>;
export type FetchedDisplay = PreviewKey & { kind: 'display' | 'thumbnail'; bytes: Uint8Array };
export type PreviewLoad = { status: 'ready'; bytes: Uint8Array } | { status: 'missing' | 'unavailable' };

/** Reads only the explicit owned display port; no generation, upload or original fallback. */
export function createAuthorizedDisplayLoader(options: {
  cache: PrivatePreviewCache; owner: () => string | null; sessionAllowsOffline: () => boolean;
  fetchDisplay: (key: PreviewKey) => Promise<FetchedDisplay>;
}) {
  return Object.freeze({ async load(key: PreviewKey, offline: boolean): Promise<PreviewLoad> {
    if (!validId(key.ownerId) || !validId(key.projectId) || !validId(key.assetId) || !/^[a-f0-9]{64}$/.test(key.digest) || options.owner() !== key.ownerId) return { status: 'unavailable' };
    if (offline && !options.sessionAllowsOffline()) return { status: 'unavailable' };
    const cached = options.cache.get(key); if (cached) return { status: 'ready', bytes: cached };
    if (offline) return { status: 'missing' };
    const lease = options.cache.lease();
    try {
      const fetched = await options.fetchDisplay({ ...key });
      if (!fetched || !['display','thumbnail'].includes(fetched.kind) || !(fetched.bytes instanceof Uint8Array) || Object.entries(key).some(([field, value]) => fetched[field as keyof PreviewKey] !== value)) return { status: 'unavailable' };
      const bytes = new Uint8Array(fetched.bytes);
      if (!bytes.byteLength || bytes.byteLength > 100 * 1024 * 1024) return { status: 'unavailable' };
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer)), byte => byte.toString(16).padStart(2,'0')).join('');
      if (digest !== key.digest || lease !== options.cache.lease() || options.owner() !== key.ownerId || !options.cache.set({ ...key, kind: fetched.kind, bytes })) return { status: 'unavailable' };
      return { status: 'ready', bytes: new Uint8Array(bytes) };
    } catch { return { status: 'unavailable' }; }
  } });
}
export type AuthorizedDisplayLoader = ReturnType<typeof createAuthorizedDisplayLoader>;
