import { useState } from 'react';
import type { TrialAvailability } from '../../../server/v2/trial.js';
import type { createV2Api, PlanQuoteDTO } from '../../lib/api-v2.js';

type TrialApi = Pick<ReturnType<typeof createV2Api>, 'submitConfirmedPlan'>;
export interface TrialPresentation { label: string; message: string; disabled: boolean }

export function trialPresentation(availability?: TrialAvailability | null): TrialPresentation {
  switch (availability?.status) {
    case 'check_required': return { label: 'Check trial availability', message: 'The server checks eligibility when you confirm this plan.', disabled: false };
    case 'use_existing_balance': return { label: 'Use existing balance', message: 'Use your existing credits for this generation.', disabled: true };
    case 'already_claimed': return { label: 'Trial already claimed', message: 'The first trial is limited to one claim per stable account.', disabled: true };
    case 'apple_required': return { label: 'Sign in with Apple', message: 'Sign in with Apple to check trial availability.', disabled: true };
    case 'budget_closed': return { label: 'Trial unavailable', message: 'Trial availability is currently closed.', disabled: true };
    case 'unavailable': return { label: 'Trial unavailable', message: 'Trial availability could not be verified.', disabled: true };
    default: return { label: 'Trial unavailable', message: 'Trial availability is currently disabled.', disabled: true };
  }
}

export function TrialClaimPrompt(props: {
  ownerId: string; quote: PlanQuoteDTO; consentRecordId: string; api: TrialApi; availability?: TrialAvailability | null;
}) {
  const view = trialPresentation(props.availability), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  async function confirm() {
    if (view.disabled || busy) return;
    setBusy(true); setStatus('');
    try {
      const task = await props.api.submitConfirmedPlan(props.ownerId, props.quote, props.consentRecordId, { operation: 'trial_claim' });
      setStatus(task.status === 'queued' ? 'The server accepted this trial task.' : 'The server returned the current task status.');
    } catch {
      setStatus('We could not confirm this request. It may already have been accepted. Check its status before trying again.');
    } finally { setBusy(false); }
  }
  return <section aria-label="Trial generation">
    <p>{view.message}</p>
    <button type="button" disabled={view.disabled || busy} onClick={() => void confirm()}>{busy ? 'Checking…' : view.label}</button>
    <p role="status" aria-live="polite">{status}</p>
  </section>;
}
