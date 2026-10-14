import { useEffect, useRef, useState } from 'react';
import type { Capabilities, Edit, EditRequest, Field, SourceRef } from '../../../shared/v2/edit-plan.js';
import { ConfirmLook, type ConfirmImage } from '../confirm/ConfirmLook.js';
import { DraftConflictError, createDraftState, hasEffectiveChanges, reduceDraft, type DraftAction, type DraftPersistence, type DraftSnapshot, type DraftState } from '../../lib/draft-v2.js';
import type { createV2Api } from '../../lib/api-v2.js';
import type { SubmissionStore } from '../../lib/submission-store.js';
import './editor.css';

type EditApi = Pick<ReturnType<typeof createV2Api>, 'quotePlan' | 'submitConfirmedPlan' | 'resumeSubmission'>;
export interface EditorSource extends ConfirmImage {}
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
interface PendingSave { snapshot: DraftSnapshot; fingerprint: string }

function fingerprint(snapshot: DraftSnapshot): string {
  return JSON.stringify([snapshot.ownerId, snapshot.projectId, snapshot.source, snapshot.edits]);
}

interface DraftEditorProps {
  ownerId: string; consentRecordId: string; initialDraft: DraftSnapshot; sources: readonly EditorSource[];
  projectId: string; persistence: DraftPersistence; api: EditApi; submissionStore: SubmissionStore;
  intent?: EditRequest; capabilities?: Capabilities; providerDisclosure?: string; blockingReason?: string; debounceMs?: number;
}

export function DraftEditor(props: DraftEditorProps) {
  if (props.initialDraft.ownerId !== props.ownerId || props.initialDraft.projectId !== props.projectId) {
    return <main className="v2-edit"><p role="alert">This project is unavailable for the current account.</p></main>;
  }
  const key = JSON.stringify([props.ownerId, props.projectId, props.intent?.operation, props.intent?.styleId]);
  return <DraftEditorSession key={key} {...props} />;
}

function DraftEditorSession(props: DraftEditorProps) {
  const [state, setState] = useState<DraftState>(() => createDraftState(props.initialDraft));
  const [screen, setScreen] = useState<'edit' | 'confirm'>('edit');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState<DraftConflictError | null>(null);
  const [retry, setRetry] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const revision = useRef(props.initialDraft.revision);
  const mounted = useRef(true);
  const saving = useRef(false);
  const pending = useRef<PendingSave | null>(null);
  const savedFingerprint = useRef(fingerprint(props.initialDraft));
  const pump = useRef<() => void>(() => undefined);
  const snapshot = state.snapshot;
  const currentFingerprint = fingerprint(snapshot);
  const currentSource = props.sources.find(option => option.source.kind === snapshot.source.kind &&
    (option.source.kind !== 'version' || (snapshot.source.kind === 'version' && option.source.versionId === snapshot.source.versionId)));
  const pendingSubmission = props.submissionStore.list(props.ownerId).some(item => item.projectId === props.projectId);
  const isSaved = saveStatus === 'saved' && savedFingerprint.current === currentFingerprint && !saving.current && !pending.current;

  pump.current = () => {
    if (saving.current || !pending.current || conflict) return;
    const item = pending.current;
    pending.current = null;
    const write = { ...item.snapshot, expectedRevision: revision.current };
    saving.current = true;
    setSaveStatus('saving');
    void props.persistence.saveDraft(write).then(acknowledged => {
      if (!mounted.current || props.ownerId !== write.ownerId || props.projectId !== write.projectId) return;
      revision.current = Math.max(revision.current, acknowledged.revision);
      setState(previous => reduceDraft(previous, { type: 'acknowledge', revision: revision.current }));
      savedFingerprint.current = item.fingerprint;
      if (fingerprint(stateRef.current.snapshot) === item.fingerprint) setSaveStatus('saved');
    }, error => {
      if (!mounted.current || props.ownerId !== write.ownerId || props.projectId !== write.projectId) return;
      if (error instanceof DraftConflictError) {
        setConflict(error);
        setSaveStatus('conflict');
        setSaveError('A newer saved draft exists. Your local changes are still here.');
      } else {
        setSaveStatus('error');
        setSaveError('Could not save this draft. Your changes are still here.');
      }
      pending.current = null;
    }).finally(() => {
      saving.current = false;
      if (mounted.current && pending.current && !conflict) pump.current();
    });
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (screen !== 'edit' || conflict || currentFingerprint === savedFingerprint.current) return;
    const timer = window.setTimeout(() => {
      pending.current = { snapshot, fingerprint: currentFingerprint };
      pump.current();
    }, props.debounceMs ?? 180);
    return () => window.clearTimeout(timer);
  }, [conflict, currentFingerprint, props.debounceMs, props.persistence, retry, screen, snapshot]);

  function dispatch(action: DraftAction) {
    setState(previous => reduceDraft(previous, action));
    setSaveError('');
  }
  function setEdit(field: 'bodyColor' | 'wheelColor', value: string) {
    dispatch({ type: 'edit', field, edit: value ? { action: 'set', value } : { action: 'preserve' } });
  }
  function selectSource(value: string) {
    const option = props.sources.find(item => item.source.kind === 'original' ? value === 'original' : value === item.source.versionId);
    if (option) dispatch({ type: 'source', source: option.source });
  }
  function retrySave() {
    setSaveError('');
    setSaveStatus('idle');
    setRetry(value => value + 1);
  }
  function useNewerDraft() {
    if (!conflict) return;
    if (conflict.current.ownerId !== props.ownerId || conflict.current.projectId !== props.projectId) {
      setSaveError('The saved draft could not be matched to this account and project. Your local changes are still here.');
      return;
    }
    revision.current = conflict.current.revision;
    savedFingerprint.current = fingerprint(conflict.current);
    setState(createDraftState(conflict.current));
    setConflict(null);
    setSaveError('');
    setSaveStatus('saved');
  }

  const operation = props.intent?.operation ?? 'detail';
  const styleId = operation === 'explore' ? props.intent?.styleId : undefined;
  const capabilities = props.capabilities ?? { enabled: false, fields: [], originalReference: false };
  const enabledFields = capabilities.enabled ? capabilities.fields : [];
  const unsupportedEdits = Object.keys(snapshot.edits).some(field => !enabledFields.includes(field as Field));
  const restoreRequested = Object.values(snapshot.edits).some(edit => edit?.action === 'restore_original');
  const exploreValid = operation === 'explore' && props.intent?.source.kind === 'original' && snapshot.source.kind === 'original' && !Object.keys(snapshot.edits).length && !!styleId;
  const effective = operation === 'explore' ? exploreValid : hasEffectiveChanges(snapshot);
  const restoreOnOriginal = snapshot.source.kind === 'original' && Object.values(snapshot.edits).some(edit => edit?.action === 'restore_original');
  const block = pendingSubmission ? '' : props.blockingReason || (!currentSource
    ? 'The selected photo version is unavailable. Choose an available source before continuing.'
    : operation === 'explore' && !exploreValid ? 'Explore requires its frozen style on the original photo without detail overrides.'
    : !capabilities.enabled ? operation === 'explore' ? 'Explore is unavailable until this project has an enabled capability.' : 'Editing controls are unavailable until this project has an enabled capability.'
    : operation === 'detail' && unsupportedEdits ? 'One or more requested controls are unavailable for this project.'
    : restoreRequested && !capabilities.originalReference ? 'Restore original is unavailable because the selected source has no verified original reference.'
    : restoreOnOriginal
    ? 'The original is already selected. Restoring it will not create a change.'
    : !effective ? 'Choose at least one change before generating.'
    : !isSaved ? 'Save your changes before continuing.' : '');
  const saveMessage = saveError || (isSaved ? 'Draft saved.' : '');
  const label = currentSource?.label ?? 'Unavailable';

  if (screen === 'confirm') return <ConfirmLook ownerId={props.ownerId} consentRecordId={props.consentRecordId}
    snapshot={snapshot} api={props.api} image={currentSource ?? null} submissionStore={props.submissionStore}
    capabilities={capabilities} operation={operation} styleId={styleId} providerDisclosure={props.providerDisclosure} onBack={() => setScreen('edit')} />;

  const bodyEdit = snapshot.edits.bodyColor;
  const wheelEdit = snapshot.edits.wheelColor;
  const selected = (edit: Edit | undefined) => edit?.action === 'set' ? edit.value : '';
  return <main className="v2-edit">
    <p className="v2-edit__eyebrow">Change one detail</p>
    <h1>Edit your selected photo</h1>
    {currentSource ? <img className="v2-edit__image" src={currentSource.imageUrl} alt={`Selected base: ${label}`} />
      : <p role="alert">The selected photo version is unavailable. Choose an available source before editing.</p>}
    <p>Selected base: {label}.</p>
    {operation === 'explore' ? <p>Direction: {styleId}. This frozen style uses the original photo without detail overrides.</p> : <p>Preview has not been updated yet.</p>}
    {operation === 'detail' && <label>Selected base
      <select value={props.sources.some(option => option.source.kind === 'original' ? snapshot.source.kind === 'original' : snapshot.source.kind === 'version' && option.source.versionId === snapshot.source.versionId)
        ? snapshot.source.kind === 'original' ? 'original' : snapshot.source.versionId : ''} onChange={event => selectSource(event.target.value)}>
        {!currentSource && <option value="">Choose an available source</option>}
        {props.sources.map(option => <option key={option.source.kind === 'original' ? 'original' : option.source.versionId} value={option.source.kind === 'original' ? 'original' : option.source.versionId}>
          {option.label}
        </option>)}
      </select>
    </label>}
    {operation === 'detail' && capabilities.enabled && capabilities.fields.includes('bodyColor') && <label>Body color
      <select value={selected(bodyEdit)} onChange={event => setEdit('bodyColor', event.target.value)}>
        <option value="">Keep current</option>
        {['white', 'black', 'silver', 'graphite', 'blue', 'green', 'red', 'yellow'].map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>}
    {operation === 'detail' && capabilities.enabled && capabilities.fields.includes('wheelColor') && <label>Wheel color
      <select value={selected(wheelEdit)} onChange={event => setEdit('wheelColor', event.target.value)}>
        <option value="">Keep current</option>
        {['silver', 'graphite', 'bronze', 'black', 'white'].map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>}
    {operation === 'detail' && capabilities.enabled && !capabilities.fields.includes('bodyColor') && <p>Body color is unavailable for this project.</p>}
    {operation === 'detail' && capabilities.enabled && !capabilities.fields.includes('wheelColor') && <p>Wheel color is unavailable for this project.</p>}
    {operation === 'detail' && snapshot.source.kind === 'version' && capabilities.enabled && capabilities.fields.includes('bodyColor') && capabilities.originalReference && <button type="button" onClick={() => dispatch({ type: 'edit', field: 'bodyColor', edit: { action: 'restore_original' } })}>Restore original</button>}
    {operation === 'detail' && snapshot.source.kind === 'version' && capabilities.enabled && capabilities.fields.includes('bodyColor') && !capabilities.originalReference && <p>Restore original is unavailable because the selected source has no verified original reference.</p>}
    {restoreOnOriginal && <p>{block}</p>}
    <section aria-label="Requested changes">
      <h2>Requested changes</h2>
      <ul>{Object.entries(snapshot.edits).filter(([, edit]) => edit && edit.action !== 'preserve').map(([field, edit]) =>
        <li key={field}>{field}: {edit?.action === 'restore_original' ? 'Restore original' : edit?.action === 'set' ? edit.value : 'Preserve'}</li>)}</ul>
    </section>
    <div className="v2-edit__actions">
      <button type="button" disabled={!state.history.length} onClick={() => dispatch({ type: 'undo' })}>Undo</button>
      <button type="button" disabled={!Object.keys(snapshot.edits).length} onClick={() => dispatch({ type: 'reset' })}>Reset changes</button>
      {saveStatus === 'error' && <button type="button" onClick={retrySave}>Retry draft save</button>}
      {conflict && <button type="button" onClick={useNewerDraft}>Use newer saved draft</button>}
      <button type="button" disabled={!!block} onClick={() => setScreen('confirm')}>{pendingSubmission ? 'Recover existing submission' : 'Continue to confirmation'}</button>
    </div>
    {pendingSubmission && <p role="status">A previous submission is saved. Recover it before creating another look.</p>}
    {saveMessage && <p role={saveError ? 'alert' : 'status'}>{saveMessage}</p>}
    {block && !restoreOnOriginal && <p>{block}</p>}
  </main>;
}
