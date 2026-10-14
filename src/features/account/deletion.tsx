import { useState } from 'react';

type DeletionReply = { status: string };
type Props = { requestDeletion: () => Promise<DeletionReply>; clearPrivateCache?: () => void };

function Confirmation({ kind, requestDeletion, clearPrivateCache }: Props & { kind: 'account' | 'project' }) {
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const account = kind === 'account';
  async function submit() {
    if (!confirmed || busy) return;
    setBusy(true); setStatus('');
    try {
      const result = await requestDeletion(); clearPrivateCache?.();
      setStatus(result.status === 'pending_policy'
        ? 'Deletion has started and new work is blocked. Cleanup is pending the required financial retention policy. Saved Photos copies and older backups are not guaranteed to be erased.'
        : 'Deletion has started. New work is blocked. Saved copies outside FORM and older backups are not guaranteed to be erased.');
    } catch {
      setStatus('We could not verify the deletion request. Check its status before trying again.');
    } finally { setBusy(false); }
  }
  const title = account ? 'Delete your FORM account' : 'Delete this FORM project';
  return <section aria-labelledby={`deletion-title-${kind}`}>
    <h2 id={`deletion-title-${kind}`}>{title}</h2>
    <p>{account ? 'This blocks new work and starts removal of FORM cloud content. Some minimal financial records may need to remain until an approved finite retention policy is applied.' : 'This blocks new work for the project and starts removal of its cloud content.'}</p>
    <p>Copies saved to Photos or elsewhere cannot be removed by this request. Existing backups are not erased immediately.</p>
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: 44 }}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} /> I understand this starts deletion and does not erase my saved copies or every backup.</label>
    <button type="button" style={{ minHeight: 44, minWidth: 44, font: 'inherit' }} disabled={!confirmed || busy} onClick={() => void submit()}>{busy ? 'Starting deletion…' : account ? 'Delete account' : 'Delete project'}</button>
    <p role="status" aria-live="polite">{status}</p>
  </section>;
}

export function AccountDeletionConfirmation(props: Props) { return <Confirmation {...props} kind="account" />; }
export function ProjectDeletionConfirmation(props: Props) { return <Confirmation {...props} kind="project" />; }
