import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { V2HttpError, V2NetworkError, V2UncertainResponseError, type createV2Api } from '../../lib/api-v2.js';
import { PhotoInputError, preparePhoto, type NativePhotoAdapter, type PreparedPhoto } from '../../lib/photo-input.js';
import './photo.css';

export interface PublishedPhotoDisclosure {
  policyId: string;
  policyVersion: string;
  providerName: string;
  purpose: string;
}

type PhotoApi = Pick<ReturnType<typeof createV2Api>, 'issueConsent' | 'createProject'>;
type Selection = { file: File; state: 'preparing' | 'ready' | 'error'; prepared?: PreparedPhoto; previewUrl?: string; error?: string };

function disclosureIsReady(value: PublishedPhotoDisclosure | null | undefined): value is PublishedPhotoDisclosure {
  return !!value && [value.policyId, value.policyVersion, value.providerName, value.purpose]
    .every(part => typeof part === 'string' && part.trim().length > 0);
}

function uploadError(error: unknown): string {
  if (error instanceof PhotoInputError) return error.message;
  if (error instanceof V2HttpError) return error.message;
  return 'The request could not be completed. Your photo remains selected on this device.';
}

export function PhotoIntake(props: {
  actorId: string | null;
  api: PhotoApi | null;
  disclosure: PublishedPhotoDisclosure | null;
  nativeAdapter?: NativePhotoAdapter;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [photoRights, setPhotoRights] = useState(false);
  const [uploadStorage, setUploadStorage] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [finished, setFinished] = useState(false);
  const [uncertainUpload, setUncertainUpload] = useState(false);
  const [status, setStatus] = useState('');
  const selectionRef = useRef<Selection | null>(null);
  const actorRef = useRef(props.actorId);
  const operationId = useRef(0);
  const selectionId = useRef(0);
  const busyRef = useRef(false);
  actorRef.current = props.actorId;
  selectionRef.current = selection;
  const published = disclosureIsReady(props.disclosure) ? props.disclosure : null;

  useEffect(() => () => {
    operationId.current++;
    selectionId.current++;
    busyRef.current = false;
    selectionRef.current = null;
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => () => {
    if (selection?.previewUrl) URL.revokeObjectURL(selection.previewUrl);
  }, [selection?.previewUrl]);

  useEffect(() => {
    operationId.current++;
    selectionId.current++;
    busyRef.current = false;
    selectionRef.current = null;
    setSelection(null);
    setPhotoRights(false);
    setUploadStorage(false);
    setSharing(false);
    setBusy(false);
    setFinished(false);
    setUncertainUpload(false);
    setStatus('');
  }, [props.actorId]);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    operationId.current++;
    busyRef.current = false;
    setBusy(false);
    const currentSelectionId = ++selectionId.current;
    const currentActor = actorRef.current;
    const pending: Selection = { file, state: 'preparing' };
    selectionRef.current = pending;
    setSelection(pending);
    setPhotoRights(false);
    setUploadStorage(false);
    setSharing(false);
    setFinished(false);
    setUncertainUpload(false);
    setStatus('Preparing a local preview. Your photo has not been uploaded.');
    void preparePhoto(file, { nativeAdapter: props.nativeAdapter }).then(prepared => {
      if (selectionId.current !== currentSelectionId || actorRef.current !== currentActor) return;
      const ready: Selection = { file, state: 'ready', prepared, previewUrl: URL.createObjectURL(prepared.previewBlob) };
      selectionRef.current = ready;
      setSelection(ready);
      setStatus('Your photo is ready. It has not been uploaded.');
    }).catch(error => {
      if (selectionId.current !== currentSelectionId || actorRef.current !== currentActor) return;
      const message = uploadError(error);
      const failed: Selection = { file, state: 'error', error: message };
      selectionRef.current = failed;
      setSelection(failed);
      setStatus(message);
    });
  }

  function removeSelection() {
    operationId.current++;
    selectionId.current++;
    busyRef.current = false;
    selectionRef.current = null;
    setSelection(null);
    setPhotoRights(false);
    setUploadStorage(false);
    setSharing(false);
    setBusy(false);
    setFinished(false);
    setUncertainUpload(false);
    setStatus('');
  }

  const disclosureReady = published !== null;
  const uploadReady = !!selection?.prepared && selection.state === 'ready' && !!props.actorId && !!props.api &&
    disclosureReady && photoRights && uploadStorage && online && !busy && !finished && !uncertainUpload;
  const disabledReason = !online
    ? 'Reconnect before uploading. Your photo stays on this device.'
    : !disclosureReady
      ? 'Consent details are unavailable, so upload is disabled.'
      : !props.actorId || !props.api
        ? 'Upload is unavailable until account services are ready.'
        : selection?.state === 'preparing'
          ? 'Preparing a local preview…'
          : selection?.state === 'error'
            ? selection.error ?? 'Choose a supported photo.'
            : !selection?.prepared
              ? 'Choose a photo first.'
              : !photoRights || !uploadStorage
                ? 'Acknowledge photo rights and upload storage to continue.'
                : uncertainUpload
                  ? 'Check your project list before selecting this photo again.'
                  : finished
                    ? 'This photo was uploaded. Remove the selection to start again.'
                    : busy
                      ? 'Your consent and upload are being sent.'
                      : 'Ready when you are.';

  async function uploadPhoto() {
    if (!uploadReady || busyRef.current || !selection?.prepared || !published || !props.api || !props.actorId) return;
    busyRef.current = true;
    const currentOperation = ++operationId.current;
    const currentSelection = selection;
    const currentActor = props.actorId;
    const api = props.api;
    setBusy(true);
    setStatus('Saving your consent…');
    let stage: 'consent' | 'project' = 'consent';
    const stillCurrent = () => operationId.current === currentOperation && actorRef.current === currentActor && selectionRef.current === currentSelection;
    try {
      const consent = await api.issueConsent(currentActor, {
        policyId: published.policyId,
        acknowledgePhotoRights: true,
        acknowledgeUploadStorage: true,
        acknowledgeSharing: sharing,
      });
      if (!stillCurrent()) return;
      stage = 'project';
      setStatus('Uploading your photo…');
      await api.createProject(currentActor, consent.consentRecordId, { name: 'New project', file: selection.prepared.uploadBlob });
      if (!stillCurrent()) return;
      setFinished(true);
      setStatus('Your photo was added to a new project.');
    } catch (error) {
      if (!stillCurrent()) return;
      if (stage === 'project' && (error instanceof V2NetworkError || error instanceof V2UncertainResponseError || error instanceof V2HttpError && error.status >= 500)) {
        setUncertainUpload(true);
        setStatus('The upload status is unclear. This photo was not sent again. Check your project list before trying again.');
      } else if (stage === 'consent' && (error instanceof V2NetworkError || error instanceof V2UncertainResponseError)) {
        setStatus('Consent could not be confirmed. No project upload was started. You can try again.');
      } else {
        setStatus(uploadError(error));
      }
    } finally {
      if (operationId.current === currentOperation) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  return <main className="photo-intake">
    <header className="photo-header">
      <a className="photo-wordmark" href="#photo-start" aria-label="FORM home">FORM<span>V2</span></a>
      <span className="photo-local-badge"><i aria-hidden="true" />Local preview</span>
    </header>
    <section className="photo-layout" id="photo-start" aria-labelledby="photo-title">
      <div className="photo-intro">
        <p className="photo-eyebrow">01 / YOUR PHOTO</p>
        <h1 id="photo-title">Start with the photo.</h1>
        <p className="photo-lede">Choose a clear view of the whole car. We will show a local preview before anything is uploaded.</p>
        <p className="photo-tip"><span aria-hidden="true">↗</span> Leave room around the bumpers and wheels.</p>
      </div>
      <div className="photo-workbench">
        <div className="photo-select-row">
          <div>
            <p className="photo-eyebrow">PHOTO SOURCE</p>
            <p className="photo-caption">JPEG or PNG · up to 10 MB</p>
          </div>
          <input id="photo-file" className="photo-file-input" type="file" accept="image/*" aria-label="Choose a photo" onChange={selectFile} />
          <label className="photo-choose" htmlFor="photo-file">Choose a photo</label>
        </div>
        {selection?.state === 'ready' && selection.previewUrl ? <figure className="photo-preview">
          <img src={selection.previewUrl} alt="Selected photo preview showing the full image." />
          <figcaption>
            <span>{selection.prepared!.width} × {selection.prepared!.height} px{selection.prepared!.orientation !== 1 ? ' · orientation corrected' : ''}</span>
            <button className="photo-remove" type="button" onClick={removeSelection}>Remove selection</button>
          </figcaption>
        </figure> : selection ? <div className="photo-empty photo-empty-active" aria-live="polite">
          <span className="photo-empty-icon" aria-hidden="true">{selection.state === 'preparing' ? '···' : '!'}</span>
          <p>{selection.state === 'preparing' ? 'Preparing a local preview…' : selection.error}</p>
          <button className="photo-remove" type="button" onClick={removeSelection}>Remove selection</button>
        </div> : <div className="photo-empty">
          <span className="photo-empty-icon" aria-hidden="true">＋</span>
          <p>Your photo stays on this device until you upload.</p>
        </div>}
        <section className="photo-consent" aria-labelledby="photo-consent-title">
          <div className="photo-consent-heading">
            <p className="photo-eyebrow">BEFORE UPLOAD</p>
            <h2 id="photo-consent-title">Your choice, clearly.</h2>
          </div>
          {published ? <p className="photo-disclosure">Upload and storage are described in policy {published.policyVersion}. Sharing with {published.providerName} is a separate choice for {published.purpose}.</p> : <p className="photo-disclosure" role="note">Consent details are unavailable, so upload is disabled.</p>}
          <label className="photo-check"><input type="checkbox" checked={photoRights} onChange={event => setPhotoRights(event.currentTarget.checked)} /><span>I have the right to use this photo</span></label>
          <label className="photo-check"><input type="checkbox" checked={uploadStorage} onChange={event => setUploadStorage(event.currentTarget.checked)} /><span>I agree to upload and store this photo</span></label>
          {published && <label className="photo-check photo-share-check"><input type="checkbox" checked={sharing} onChange={event => setSharing(event.currentTarget.checked)} /><span>I agree to share this photo with {published.providerName} for {published.purpose}</span></label>}
        </section>
        <div className="photo-action">
          <button className="photo-upload" type="button" disabled={!uploadReady} onClick={() => void uploadPhoto()}>{busy ? 'Uploading…' : finished ? 'Photo uploaded' : 'Upload photo'}</button>
          <p className="photo-action-help" id="photo-action-help">{disabledReason}</p>
          <p className="photo-status" role="status" aria-live="polite">{status}</p>
        </div>
        {selection && selection.state !== 'ready' && <button className="photo-remove photo-remove-bottom" type="button" onClick={removeSelection}>Remove selection</button>}
      </div>
    </section>
    <footer className="photo-footer"><span>FORM / V2</span><span>Keep the whole car in frame.</span></footer>
  </main>;
}
