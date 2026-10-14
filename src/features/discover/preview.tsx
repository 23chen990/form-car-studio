import { useEffect, useRef, useState } from 'react';
import type { AuthorizedDisplayLoader, PreviewKey } from '../../platform/cache';
export type PreviewExample = { id: string; beforeUrl: string; afterUrl: string } & (
  { kind: 'licensed'; licenseEvidenceRef: string } | { kind: 'synthetic_demo' }
);
/** URLs are already fetched approved examples. Opening this dialog has no service port. */
export function ExamplePreview({ example }: { example: PreviewExample }) {
  const [open, setOpen] = useState(false), [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), button = useRef<HTMLButtonElement>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const available = !!example.beforeUrl && !!example.afterUrl && (example.kind === 'synthetic_demo' || !!example.licenseEvidenceRef);
  function cancelHold() { if (timer.current) clearTimeout(timer.current); timer.current = null; }
  function close() { dialog.current?.close(); setOpen(false); button.current?.focus(); }
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  useEffect(() => () => { cancelHold(); }, []);
  return <section aria-label="Example">
    <button ref={button} type="button" disabled={!available} onClick={() => setOpen(true)}
      onPointerDown={() => { cancelHold(); timer.current = setTimeout(() => setOpen(true), 450); }}
      onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}>View example</button>
    {!available && <p role="status">Example unavailable.</p>}
    <dialog ref={dialog} aria-label="Example preview" onCancel={event => { event.preventDefault(); close(); }} style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
      <p>Example - not your car</p>
      {example.kind === 'synthetic_demo' && <p>Demo color study</p>}
      {open && !failed ? <div>{[['before',example.beforeUrl],['after',example.afterUrl]].map(([label, url]) =>
        <img key={label} src={url} alt={`Example ${label}`} onError={() => setFailed(true)} style={{ maxWidth: '100%', maxHeight: '30vh', objectFit: 'contain' }} />)}</div>
        : failed && <p role="status">Example unavailable.</p>}
      <button type="button" onClick={close}>Close example</button>
    </dialog>
  </section>;
}

export function CachedPreview({ imageKey, viewerOwnerId, sessionAllowed, loader, offline, refreshKey = 0 }: {
  imageKey: PreviewKey; viewerOwnerId: string | null; sessionAllowed: boolean;
  loader: AuthorizedDisplayLoader; offline: boolean; refreshKey?: number;
}) {
  const tag = JSON.stringify([imageKey.ownerId, imageKey.projectId, imageKey.assetId, imageKey.digest, refreshKey]);
  const [loaded, setLoaded] = useState<{ tag: string; url: string } | null>(null);
  const [status, setStatus] = useState<'loading' | 'missing' | 'unavailable'>('loading');
  useEffect(() => {
    let current = true, url: string | null = null; setLoaded(null); setStatus('loading');
    if (!sessionAllowed || viewerOwnerId !== imageKey.ownerId) { setStatus('unavailable'); return; }
    void loader.load(imageKey, offline).then(result => {
      if (!current) return;
      if (result.status === 'ready') { url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes).buffer])); setLoaded({ tag, url }); }
      else setStatus(result.status);
    });
    return () => { current = false; if (url) URL.revokeObjectURL(url); };
  }, [tag, loader, offline, viewerOwnerId, sessionAllowed]);
  // Owner checks occur while rendering, before cleanup effects; no former-owner frame.
  const visible = sessionAllowed && viewerOwnerId === imageKey.ownerId && loaded?.tag === tag;
  return visible ? <img src={loaded!.url} alt="Private cached preview" style={{ width: 180, height: 120, objectFit: 'contain' }} onError={() => { setLoaded(null); setStatus('unavailable'); }} />
    : <p role="status">{status === 'missing' ? 'You are offline. Already downloaded previews may be available. Reconnect to create a new look.' : status === 'loading' ? 'Loading preview.' : 'Preview unavailable. Sign in or reconnect to view your image.'}</p>;
}
