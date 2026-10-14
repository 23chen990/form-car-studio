import { useEffect, useRef, useState } from 'react';
import { canonicalJson, type Capabilities, type EditRequest, type Field, type SourceRef } from '../../../shared/v2/edit-plan.js';
import { buildEditRequest, hasEffectiveChanges, type DraftSnapshot } from '../../lib/draft-v2.js';
import type { createV2Api, PlanQuoteDTO, SafeTaskDTO } from '../../lib/api-v2.js';
import type { PendingSubmission, SubmissionStore } from '../../lib/submission-store.js';

type EditApi = Pick<ReturnType<typeof createV2Api>, 'quotePlan' | 'submitConfirmedPlan' | 'resumeSubmission'>;
export interface ConfirmImage { source: SourceRef; label: string; imageUrl: string }

interface ConfirmProps {
  ownerId: string; consentRecordId: string; snapshot: DraftSnapshot; api: EditApi;
  image: ConfirmImage | null; submissionStore: SubmissionStore; capabilities?: Capabilities;
  operation: EditRequest['operation']; styleId?: EditRequest['styleId']; providerDisclosure?: string; onBack(): void;
}

function sameSource(a: SourceRef, b: SourceRef): boolean {
  return a.kind === b.kind && (a.kind === 'original' || (b.kind === 'version' && a.versionId === b.versionId));
}

export function ConfirmLook(props: ConfirmProps) {
  const requestKey = canonicalJson([props.ownerId, props.snapshot.projectId, props.snapshot.source, props.snapshot.edits,
    props.operation, props.styleId ?? null, props.consentRecordId, props.capabilities ?? null, props.image?.source ?? null, props.image?.imageUrl ?? null]);
  return <ConfirmLookSession key={requestKey} {...props} />;
}

function ConfirmLookSession(props: ConfirmProps) {
  const [quote, setQuote] = useState<PlanQuoteDTO | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [message, setMessage] = useState('');
  const [task, setTask] = useState<SafeTaskDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  const mounted = useRef(true);
  const lifecycle = useRef(0);
  const requestKey = canonicalJson([props.ownerId, props.snapshot.projectId, props.snapshot.source, props.snapshot.edits, props.operation, props.styleId ?? null]);

  useEffect(() => {
    let current = true;
    mounted.current = true;
    lifecycle.current++;
    setQuote(null);
    setTask(null);
    setMessage('');
    try {
      const savedSubmission = props.submissionStore.list(props.ownerId).find(item => item.projectId === props.snapshot.projectId);
      if (savedSubmission) {
        setPendingSubmission(savedSubmission);
        setMessage('A previous submission is awaiting acknowledgement. Recover it before creating another look.');
        return () => { current = false; };
      }
      const capabilities = props.capabilities ?? { enabled: false, fields: [], originalReference: false };
      if (!capabilities.enabled) {
        setMessage(props.operation === 'explore'
          ? 'Explore is unavailable until this project has an enabled capability.'
          : 'Editing controls are unavailable until this project has an enabled capability.');
        return () => { current = false; };
      }
      if (!props.image || !sameSource(props.image.source, props.snapshot.source)) {
        setMessage('The selected photo version is unavailable. Choose an available source before confirming.');
        return () => { current = false; };
      }
      if (props.operation === 'detail') {
        const editedFields = Object.keys(props.snapshot.edits);
        const unsupported = editedFields.some(field => !capabilities.enabled || !capabilities.fields.includes(field as Field));
        const restore = Object.values(props.snapshot.edits).some(edit => edit?.action === 'restore_original');
        if (unsupported || (restore && !capabilities.originalReference)) {
          setMessage('This editing capability is not available for the selected project.');
          return () => { current = false; };
        }
        if (!hasEffectiveChanges(props.snapshot)) { setMessage('Choose at least one change before generating.'); return () => { current = false; }; }
      }
      if (props.operation === 'explore' && (props.snapshot.source.kind !== 'original' || Object.keys(props.snapshot.edits).length || !props.styleId)) {
        setMessage('Explore uses its frozen style on the original photo without detail overrides.');
        return () => { current = false; };
      }
      setMessage('');
      const request: EditRequest = buildEditRequest(props.snapshot, props.operation, props.styleId);
      void props.api.quotePlan(props.ownerId, props.snapshot.projectId, props.consentRecordId, request).then(result => {
        if (!current) return;
        if (result.semantic.ownerId !== props.ownerId || result.semantic.projectId !== props.snapshot.projectId ||
          canonicalJson(result.semantic.requestEdits) !== canonicalJson(request)) {
          setMessage('The quote did not match the selected photo and requested look. Review the draft and retry.');
          return;
        }
        setQuote(result);
      }, () => { if (current) setMessage('We could not confirm the cost. Retry before creating this look.'); });
    } catch { setMessage('This change cannot be quoted. Review the selected source and changes.'); }
    return () => { current = false; };
  }, [props.api, props.capabilities, props.consentRecordId, props.image, props.operation, props.ownerId, requestKey, props.submissionStore]);

  useEffect(() => () => { mounted.current = false; lifecycle.current++; }, []);

  async function create() {
    if (!quote || submitted.current || busy) return;
    submitted.current = true;
    setBusy(true);
    const generation = lifecycle.current;
    try {
      const result = await props.api.submitConfirmedPlan(props.ownerId, quote, props.consentRecordId);
      if (mounted.current && lifecycle.current === generation) setTask(result);
    } catch {
      submitted.current = false;
      if (mounted.current && lifecycle.current === generation) {
        const pending = props.submissionStore.list(props.ownerId).find(item => item.planId === quote.planId);
        if (pending) setPendingSubmission(pending);
        setMessage(pending ? 'We could not confirm that submission. Recover the same saved submission.' : 'We could not confirm that submission. Retry with the same confirmed plan.');
      }
    } finally { if (mounted.current && lifecycle.current === generation) setBusy(false); }
  }

  async function recover() {
    if (!pendingSubmission || submitted.current || busy) return;
    submitted.current = true;
    setBusy(true);
    const generation = lifecycle.current;
    try {
      const result = await props.api.resumeSubmission(props.ownerId, pendingSubmission.submissionId);
      if (mounted.current && lifecycle.current === generation) setTask(result);
    } catch {
      submitted.current = false;
      if (mounted.current && lifecycle.current === generation) setMessage('We could not confirm the saved submission yet. Retry recovery with the same identity.');
    } finally { if (mounted.current && lifecycle.current === generation) setBusy(false); }
  }

  const frozenChanges = quote?.semantic.desiredRecipe.changes ?? [];
  const style = quote?.semantic.requestEdits.operation === 'explore' ? quote.semantic.requestEdits.styleId : undefined;

  return <section className="v2-edit__panel" aria-labelledby="confirm-title">
    <h2 id="confirm-title">Review your look</h2>
    {props.image && <><img className="v2-edit__image" src={props.image.imageUrl} alt={`Selected base: ${props.image.label}`} />
    <p>Selected base: {props.image.label}</p></>}
    {style && <p>Direction: {style}</p>}
    <h3>Requested changes</h3>
    {quote ? <ul>{frozenChanges.map(change => <li key={change.field}>{change.field === 'bodyColor' ? 'Body color' : change.field === 'wheelColor' ? 'Wheel color' : change.field}: {change.action === 'restore_original' ? 'Restore original' : change.value}</li>)}</ul>
      : <p>Confirming the selected recipe and cost…</p>}
    <p>One output. Requested protection: preserve vehicle identity, scene and camera. Your original photo is retained.</p>
    {props.providerDisclosure && <p>{props.providerDisclosure}</p>}
    {quote && <p className="v2-edit__quote">Create {quote.semantic.outputCount} look - {quote.semantic.userCostUnits} credit</p>}
    {message && <p role="alert">{message}</p>}
    {task ? <p role="status">{task.status === 'queued' ? `Queued task ${task.id}.` : `Task ${task.id} status: ${task.status}.`}</p> : pendingSubmission ? <div className="v2-edit__actions">
      <button type="button" onClick={props.onBack}>Back to edits</button>
      <button type="button" disabled={busy} onClick={() => void recover()}>Recover same submission</button>
    </div> : <div className="v2-edit__actions">
      <button type="button" onClick={props.onBack}>Back to edits</button>
      <button type="button" disabled={!quote || busy} onClick={() => void create()}>{quote ? `Create ${quote.semantic.outputCount} look` : 'Create 1 look'}</button>
    </div>}
  </section>;
}
