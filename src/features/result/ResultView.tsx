import { useEffect, useRef, useState } from 'react';
import type { SourceRef } from '../../../shared/v2/edit-plan.js';
import { Comparison } from '../../components/Comparison.js';
import type { SafeTaskDTO } from '../../lib/api-v2.js';
import './result.css';

export type ResultVerification = 'unverified' | 'unknown' | 'none';

/** Owner-scoped history data for a result view; F17 can reuse these stable IDs. */
export interface ResultVersionSnapshot {
  id: string;
  projectId: string;
  taskId: string;
  parentVersionId: string | null;
  displayAssetId: string;
  displayUrl: string | null;
  name: string;
  favorite: boolean;
  desiredRecipe: readonly string[];
  verification: ResultVerification;
}

/** `loadedForOwnerId` is the actor used for the owner-authorized project/history read. */
export interface ResultProjectSnapshot {
  id: string;
  loadedForOwnerId: string;
  name: string;
  originalAssetId: string | null;
  originalUrl: string | null;
  versions: readonly ResultVersionSnapshot[];
}

export interface ResultFavoriteChange {
  ownerId: string;
  projectId: string;
  versionId: string;
  favorite: boolean;
}

export interface ResultFavoriteAcknowledgement extends ResultFavoriteChange {}

export interface ResultDeviceSaveRequest {
  ownerId: string;
  projectId: string;
  versionId: string;
  displayAssetId: string;
}

export type ResultDeviceSaveOutcome = 'saved' | 'cancelled' | 'unavailable';

export type ResultFeedbackCategory =
  | 'identity_changed'
  | 'target_not_applied'
  | 'unwanted_structure'
  | 'image_artifacts'
  | 'preference_only'
  | 'slow_or_failed';

export interface ResultFeedbackRequest {
  ownerId: string;
  projectId: string;
  taskId: string;
  versionId: string;
  category: ResultFeedbackCategory;
  description?: string;
}

export interface ResultRefineRequest {
  ownerId: string;
  projectId: string;
  source: SourceRef;
}

export interface ResultViewProps {
  ownerId: string;
  project: ResultProjectSnapshot;
  task: SafeTaskDTO | null;
  selectedVersionId: string;
  onSelectVersion?(versionId: string): void;
  onRefine(request: ResultRefineRequest): void;
  onSetFavorite?(change: ResultFavoriteChange): Promise<ResultFavoriteAcknowledgement>;
  onSaveToDevice?(request: ResultDeviceSaveRequest): Promise<ResultDeviceSaveOutcome>;
  onSubmitFeedback?(request: ResultFeedbackRequest): Promise<void>;
}

const categories: readonly { id: ResultFeedbackCategory; label: string }[] = [
  { id: 'identity_changed', label: 'The car identity changed' },
  { id: 'target_not_applied', label: 'The requested change was not applied' },
  { id: 'unwanted_structure', label: 'Unexpected changes appeared' },
  { id: 'image_artifacts', label: 'Image artifacts' },
  { id: 'preference_only', label: 'I prefer a different look' },
  { id: 'slow_or_failed', label: 'The task was slow or failed' },
];

function unavailable() {
  return <main className="v2-result"><section className="v2-result__unavailable" role="region" aria-label="Result">
    <h1>Result unavailable</h1>
    <p>This saved result is unavailable for this account. Choose a result from its original project.</p>
  </section></main>;
}

function verificationCopy(value: ResultVerification): string {
  if (value === 'unverified') return 'Unverified';
  if (value === 'unknown') return 'Not assessed';
  return 'No verification claimed';
}

export function ResultView(props: ResultViewProps) {
  const version = props.project.versions.find(item => item.id === props.selectedVersionId && item.projectId === props.project.id);
  const matchingResult = props.ownerId === props.project.loadedForOwnerId && !!version && !!props.task &&
    props.task.status === 'succeeded' && props.task.projectId === props.project.id &&
    props.task.resultVersionId === version.id && props.task.id === version.taskId;
  if (!matchingResult || !version || !version.displayUrl || !version.displayAssetId) return unavailable();

  const task = props.task!;
  return <ResultSession key={`${props.ownerId}:${props.project.id}:${task.id}:${version.id}`} {...props} task={task}
    version={version as ResultVersionSnapshot & { displayUrl: string; displayAssetId: string }} />;
}

function ResultSession(props: ResultViewProps & { task: SafeTaskDTO; version: ResultVersionSnapshot & { displayUrl: string; displayAssetId: string } }) {
  const { ownerId, project, task, version } = props;
  const [baseline, setBaseline] = useState<SourceRef>({ kind: 'original' });
  const [favoriteAck, setFavoriteAck] = useState<boolean | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [category, setCategory] = useState<ResultFeedbackCategory | ''>('');
  const [description, setDescription] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [imageState, setImageState] = useState<{ url: string; status: 'loading' | 'ready' | 'failed' }>({ url: version.displayUrl, status: 'loading' });
  const mounted = useRef(true);
  const imageStatus = imageState.url === version.displayUrl ? imageState.status : 'loading';
  const favorite = favoriteAck ?? version.favorite;
  const sameProjectVersions = project.versions.filter(item => item.projectId === project.id && item.id !== version.id);
  const parent = version.parentVersionId ? sameProjectVersions.find(item => item.id === version.parentVersionId) : undefined;
  const baselineVersion = baseline.kind === 'version' ? sameProjectVersions.find(item => item.id === baseline.versionId) : undefined;
  const baselineUrl = baseline.kind === 'original' ? project.originalUrl : baselineVersion?.displayUrl;
  const baselineSource = baseline.kind === 'original' ? 'original' : `version:${baseline.versionId}`;
  const baselineLabel = baseline.kind === 'original' ? 'Original' : parent?.id === baseline.versionId
    ? `Parent version · ${parent.name}` : `Other version · ${baselineVersion?.name ?? 'Unavailable'}`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function changeFavorite() {
    if (!props.onSetFavorite || favoriteBusy) return;
    const change: ResultFavoriteChange = { ownerId, projectId: project.id, versionId: version.id, favorite: !favorite };
    setFavoriteBusy(true);
    setActionError('');
    setActionMessage('');
    try {
      const ack = await props.onSetFavorite(change);
      if (!mounted.current) return;
      if (ack.ownerId !== change.ownerId || ack.projectId !== change.projectId || ack.versionId !== change.versionId || ack.favorite !== change.favorite) {
        throw new Error('The saved favorite did not match this result.');
      }
      setFavoriteAck(ack.favorite);
      setActionMessage(ack.favorite ? 'Added to favorites.' : 'Removed from favorites.');
    } catch {
      if (mounted.current) setActionError('Favorite status could not be saved. Your saved state is unchanged.');
    } finally {
      if (mounted.current) setFavoriteBusy(false);
    }
  }

  async function saveToDevice() {
    if (!props.onSaveToDevice || deviceBusy) return;
    setDeviceBusy(true);
    setActionError('');
    setActionMessage('');
    try {
      const outcome = await props.onSaveToDevice({ ownerId, projectId: project.id, versionId: version.id, displayAssetId: version.displayAssetId });
      if (!mounted.current) return;
      setActionMessage(outcome === 'saved' ? 'Saved a copy to Photos.' : outcome === 'cancelled' ? 'Save to Photos cancelled.' : 'Saving to Photos is unavailable here.');
    } catch {
      if (mounted.current) setActionError('This image could not be saved to Photos. Try again.');
    } finally {
      if (mounted.current) setDeviceBusy(false);
    }
  }

  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.onSubmitFeedback || !category || feedbackBusy || feedbackSaved) return;
    setFeedbackBusy(true);
    setFeedbackError('');
    try {
      await props.onSubmitFeedback({ ownerId, projectId: project.id, taskId: task.id, versionId: version.id, category,
        ...(description.trim() ? { description: description.trim() } : {}) });
      if (!mounted.current) return;
      setFeedbackSaved(true);
    } catch {
      if (mounted.current) setFeedbackError('We could not save this report. Your category and notes are still here.');
    } finally {
      if (mounted.current) setFeedbackBusy(false);
    }
  }

  if (imageStatus === 'failed') return unavailable();

  return <main className="v2-result"><section className="v2-result__panel" role="region" aria-label="Result" data-result-version={version.id}>
    <header className="v2-result__header">
      <p className="v2-result__eyebrow">YOUR RESULT</p>
      <h1>Selected result: {version.name}</h1>
      <p className="v2-result__saved">{imageStatus === 'ready' ? 'Saved to your garage.' : 'Loading saved result…'}</p>
    </header>
    <div className="v2-result__layout">
      <div className="v2-result__visuals">
        <div className="v2-result__image-frame">
          <img src={version.displayUrl} alt={`Selected result: ${version.name}`}
            onLoad={() => setImageState({ url: version.displayUrl, status: 'ready' })}
            onError={() => setImageState({ url: version.displayUrl, status: 'failed' })} />
        </div>
        <nav className="v2-result__history" aria-label="Project versions">
          {project.versions.filter(item => item.projectId === project.id).map((item, index) => <button key={item.id} type="button"
            aria-label={`Show ${item.name} version`} aria-pressed={item.id === version.id} disabled={imageStatus !== 'ready' || !props.onSelectVersion || item.id === version.id}
            onClick={() => props.onSelectVersion?.(item.id)}>V{index + 1} · {item.name}</button>)}
        </nav>
        <section className="v2-result__compare" aria-label="Compare versions">
          <label htmlFor="v2-result-compare">Compare with</label>
          <select id="v2-result-compare" disabled={imageStatus !== 'ready'} value={baseline.kind === 'original' ? 'original' : `version:${baseline.versionId}`}
            onChange={event => setBaseline(event.target.value === 'original' ? { kind: 'original' } : { kind: 'version', versionId: event.target.value.slice('version:'.length) })}>
            <option value="original">Original</option>
            {parent && <option value={`version:${parent.id}`}>Parent version · {parent.name}</option>}
            {sameProjectVersions.filter(item => item.id !== parent?.id).map(item => <option key={item.id} value={`version:${item.id}`}>Other version · {item.name}</option>)}
          </select>
          <p data-testid="result-comparison-label">{baselineLabel}</p>
          {baselineUrl ? <div className="v2-result__comparison" data-testid="result-comparison" data-before-source={baselineSource}>
            <Comparison key={`${version.id}:${baselineSource}`} beforeUrl={baselineUrl} afterUrl={version.displayUrl} beforeLabel={baselineLabel} />
          </div> : <p role="alert">This comparison image is unavailable.</p>}
        </section>
      </div>
      <div className="v2-result__details">
        <h2>{project.name}</h2>
        <p className="v2-result__recipe-label">Requested changes · not a verified description of the image</p>
        <ul className="v2-result__recipe">{version.desiredRecipe.map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}</ul>
        {!version.desiredRecipe.length && <p>No saved request details are available.</p>}
        <p className="v2-result__verification">Verification: {verificationCopy(version.verification)}. No claim is made that every requested change appears in the image.</p>
        <div className="v2-result__actions" aria-label="Result actions">
          <button type="button" className="v2-result__primary" disabled={imageStatus !== 'ready'} onClick={() => props.onRefine({ ownerId, projectId: project.id, source: { kind: 'version', versionId: version.id } })}>Refine this version</button>
          <button type="button" disabled={imageStatus !== 'ready'} onClick={() => props.onRefine({ ownerId, projectId: project.id, source: { kind: 'original' } })}>Start again from original</button>
          <button type="button" aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={favorite}
            disabled={imageStatus !== 'ready' || !props.onSetFavorite || favoriteBusy} onClick={() => void changeFavorite()}>{favoriteBusy ? 'Saving favorite…' : favorite ? 'Remove from favorites' : 'Add to favorites'}</button>
          <button type="button" aria-describedby={!props.onSaveToDevice ? 'v2-result-device-unavailable' : undefined}
            disabled={imageStatus !== 'ready' || !props.onSaveToDevice || deviceBusy} onClick={() => void saveToDevice()}>{deviceBusy ? 'Opening Photos…' : 'Save to Photos'}</button>
        </div>
        {!props.onSaveToDevice && <p id="v2-result-device-unavailable">Saving to Photos is unavailable in this preview.</p>}
        {actionError && <p role="alert">{actionError}</p>}
        {actionMessage && <p role="status" data-testid="result-action-message">{actionMessage}</p>}
        <form className="v2-result__feedback" onSubmit={event => void submitFeedback(event)}>
          <h2>Report a problem</h2>
          <fieldset>
            <legend>Choose a category</legend>
            {categories.map(item => <label key={item.id}><input type="radio" name="result-problem" value={item.id}
              checked={category === item.id} onChange={() => setCategory(item.id)} />{item.label}</label>)}
          </fieldset>
          <label htmlFor="v2-result-feedback-text">Tell us more (optional)</label>
          <textarea id="v2-result-feedback-text" aria-label="Tell us more (optional)" maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} />
          {!props.onSubmitFeedback && <p>Feedback saving is unavailable in this preview.</p>}
          <button type="submit" disabled={imageStatus !== 'ready' || !props.onSubmitFeedback || !category || feedbackBusy || feedbackSaved}>
            {feedbackBusy ? 'Saving report…' : feedbackSaved ? 'Report recorded' : 'Submit report'}
          </button>
          {feedbackError && <p role="alert">{feedbackError}</p>}
          {feedbackSaved && <p role="status">Your report was saved. This does not automatically issue a refund.</p>}
        </form>
      </div>
    </div>
  </section></main>;
}
