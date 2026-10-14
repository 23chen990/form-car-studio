import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openV2Database } from '../../server/v2/db.js';
import { WalletRepository } from '../../server/v2/wallet-repo.js';

const NOW = '2026-10-14T00:00:00.000Z';
const KEY = 'a5d393f0-4ce4-4fe7-aeac-9bf818c8c9b1';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'form-f28-'));
  const db = openV2Database(join(dir, 'form.sqlite'));
  for (const ownerId of ['owner-a', 'owner-b']) {
    db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(ownerId, NOW);
    db.prepare('INSERT INTO projects(id,owner_id,created_at) VALUES (?,?,?)').run(`project-${ownerId}`, ownerId, NOW);
  }
  db.prepare(`INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,created_at)
    VALUES ('task-a','owner-a','project-owner-a','submission-a','succeeded',1,?)`).run(NOW);
  db.prepare(`INSERT INTO versions(id,owner_id,project_id,task_id,created_at)
    VALUES ('version-a','owner-a','project-owner-a','task-a',?)`).run(NOW);
  db.prepare("UPDATE tasks SET result_version_id='version-a' WHERE id='task-a'").run();
  db.prepare(`INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,created_at)
    VALUES ('task-failed','owner-a','project-owner-a','submission-failed','failed',1,?)`).run(NOW);
  db.prepare(`INSERT INTO versions(id,owner_id,project_id,task_id,created_at)
    VALUES ('version-failed','owner-a','project-owner-a','task-failed',?)`).run(NOW);
  db.prepare("UPDATE tasks SET result_version_id='version-failed' WHERE id='task-failed'").run();
  db.prepare(`INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,created_at)
    VALUES ('task-other','owner-a','project-owner-a','submission-other','succeeded',1,?)`).run(NOW);
  db.prepare(`INSERT INTO versions(id,owner_id,project_id,task_id,created_at)
    VALUES ('version-other','owner-a','project-owner-a','task-other',?)`).run(NOW);
  db.prepare("UPDATE tasks SET result_version_id='version-other' WHERE id='task-other'").run();
  return { dir, db, repo: new WalletRepository(db), close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('first-party event parser accepts a safe retry action without treating it as retention', async () => {
  const module = await import('../../src/lib/events.js').catch(() => null);
  assert.ok(module, 'the first-party event contract is missing');
  const event = module.parseFirstPartyEvent({
    eventKey: 'a5d393f0-4ce4-4fe7-aeac-9bf818c8c9b1', kind: 'task_retry_requested', taskId: 'task-1',
  });
  assert.deepEqual(event, { eventKey: 'a5d393f0-4ce4-4fe7-aeac-9bf818c8c9b1', kind: 'task_retry_requested', taskId: 'task-1' });
});

test('event kinds keep technical, quality, exploration, favorite, autosave and share-sheet outcomes distinct', async () => {
  const module = await import('../../src/lib/events.js').catch(() => null);
  assert.ok(module, 'the first-party event contract is missing');
  const parsed = [
    { eventKey: KEY, kind: 'task_technical_failure', taskId: 'task-a', errorCode: 'PROVIDER_TIMEOUT_UNKNOWN', profileId: 'profile-1' },
    { eventKey: KEY, kind: 'quality_report_submitted', taskId: 'task-a', versionId: 'version-a', category: 'image_artifacts' },
    { eventKey: KEY, kind: 'voluntary_exploration_started', projectId: 'project-a' },
    { eventKey: KEY, kind: 'favorite_changed', versionId: 'version-a', isFavorite: true },
    { eventKey: KEY, kind: 'draft_autosaved', projectId: 'project-a' },
    { eventKey: KEY, kind: 'share_sheet_opened', versionId: 'version-a' },
  ].map(value => module.parseFirstPartyEvent(value));
  assert.deepEqual(parsed.map(event => event.kind), [
    'task_technical_failure', 'quality_report_submitted', 'voluntary_exploration_started',
    'favorite_changed', 'draft_autosaved', 'share_sheet_opened',
  ]);
  assert.throws(() => module.parseFirstPartyEvent({ eventKey: KEY, kind: 'share_posted', versionId: 'version-a' }));
  assert.throws(() => module.parseFirstPartyEvent({ eventKey: KEY, kind: 'task_retry_requested', taskId: 'task-a', ownerId: 'owner-a' }));
  assert.throws(() => module.parseFirstPartyEvent({ eventKey: KEY, kind: 'quality_report_submitted', taskId: 'task-a', versionId: 'version-a', category: 'image_artifacts', prompt: 'private prompt' }));
  assert.throws(() => module.parseFirstPartyEvent({ eventKey: KEY, kind: 'draft_autosaved', projectId: 'project-a', satisfaction: true }));
  assert.throws(() => module.parseFirstPartyEvent({ eventKey: KEY, kind: 'organic_retention', taskId: 'task-a' }));
  assert.throws(() => module.parseFirstPartyEvent({ eventKey: KEY, kind: 'task_retry_requested', taskId: '../private' }));
});

test('first-party events are idempotent, owner-scoped and reject deleted or foreign versions', async () => {
  const audit = await import('../../server/v2/audit.js').catch(() => null);
  assert.ok(audit, 'the audit service is missing');
  const f = fixture();
  try {
    const event = { eventKey: KEY, kind: 'share_sheet_opened', versionId: 'version-a' };
    assert.equal(f.repo.transaction(tx => audit.recordFirstPartyEventInTransaction(tx, 'owner-a', event, NOW)).replayed, false);
    assert.equal(f.repo.transaction(tx => audit.recordFirstPartyEventInTransaction(tx, 'owner-a', event, NOW)).replayed, true);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE event_type='first_party_event'").get() as { n: number }).n, 1);
    assert.throws(() => f.repo.transaction(tx => audit.recordFirstPartyEventInTransaction(tx, 'owner-a', { ...event, kind: 'favorite_changed', isFavorite: true }, NOW)));
    assert.throws(() => f.repo.transaction(tx => audit.recordFirstPartyEventInTransaction(tx, 'owner-b', event, NOW)));
    assert.throws(() => f.repo.transaction(tx => audit.recordFirstPartyEventInTransaction(tx, 'owner-a', { ...event, eventKey: 'different-key', versionId: 'missing-version' }, NOW)));
    f.db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').run(NOW, 'project-owner-a');
    assert.throws(() => f.repo.transaction(tx => audit.recordFirstPartyEventInTransaction(tx, 'owner-a', { ...event, eventKey: 'after-delete' }, NOW)));
  } finally { f.close(); }
});

test('feedback stores bounded redacted support text separately from analytics and validates the canonical result', async () => {
  const feedbackModule = await import('../../server/v2/feedback.js').catch(() => null);
  assert.ok(feedbackModule, 'the feedback service is missing');
  const f = fixture();
  try {
    const service = feedbackModule.createFeedbackService({ db: f.db, clock: () => new Date(NOW) });
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.c2lnYXR1cmV4';
    const imageData = `data:image/png;base64,${'A'.repeat(160)}`;
    const input = { eventKey: KEY, taskId: 'task-a', versionId: 'version-a', category: 'image_artifacts', body: `Please contact me at owner@example.test; token=super-secret. ${jwt} ${imageData}` };
    const result = service.submit('owner-a', input);
    assert.equal(result.replayed, false);
    const stored = f.db.prepare('SELECT body,category FROM feedback WHERE id=?').get(result.feedbackId) as { body: string; category: string };
    assert.equal(stored.category, 'image_artifacts');
    assert.equal(stored.body.includes('owner@example.test'), false);
    assert.equal(stored.body.includes('super-secret'), false);
    assert.equal(stored.body.includes(jwt), false);
    assert.equal(stored.body.includes(imageData), false);
    const audit = f.db.prepare("SELECT details_json FROM audit_events WHERE event_type='first_party_event'").get() as { details_json: string };
    assert.equal(audit.details_json.includes('owner@example.test'), false);
    assert.equal(audit.details_json.includes('super-secret'), false);
    assert.equal(audit.details_json.includes(jwt), false);
    assert.equal(audit.details_json.includes(imageData), false);
    assert.equal(service.submit('owner-a', input).replayed, true);
    assert.throws(() => service.submit('owner-a', { ...input, body: 'changed support text' }));
    assert.throws(() => service.submit('owner-a', { ...input, approved: true }));
    assert.throws(() => service.submit('owner-b', input));
    assert.throws(() => service.submit('owner-a', { ...input, eventKey: 'foreign-version', versionId: 'missing-version' }));
    f.db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').run(NOW, 'project-owner-a');
    assert.throws(() => service.submit('owner-a', { ...input, eventKey: 'deleted-project' }));
    f.db.prepare('UPDATE users SET deleted_at=? WHERE id=?').run(NOW, 'owner-a');
    assert.throws(() => service.submit('owner-a', { ...input, eventKey: 'deleted-owner' }));
  } finally { f.close(); }
});

test('feedback submissions round-trip through trusted review append and read using the returned case ID', async () => {
  const feedbackModule = await import('../../server/v2/feedback.js').catch(() => null);
  const audit = await import('../../server/v2/audit.js').catch(() => null);
  assert.ok(feedbackModule && audit, 'feedback and audit services are required');
  const f = fixture();
  try {
    const feedback = feedbackModule.createFeedbackService({ db: f.db, clock: () => new Date(NOW) });
    const saved = feedback.submit('owner-a', { eventKey: 'review-roundtrip', taskId: 'task-a', versionId: 'version-a', category: 'image_artifacts' });
    const command = { reviewKey: 'review-for-feedback', taskId: 'task-a', versionId: 'version-a', feedbackId: saved.feedbackId,
      category: 'image_artifacts', decision: 'needs_more_evidence', evidenceReference: 'evidence-1', policyVersion: 'quality-v1' };
    const authorize = () => ({ actorId: 'operator-1' });
    assert.throws(() => f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-b', command, authorize, NOW)));
    assert.throws(() => f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', {
      ...command, reviewKey: 'wrong-task', taskId: 'task-other', versionId: 'version-other',
    }, authorize, NOW)));
    assert.throws(() => f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', { ...command, reviewKey: 'wrong-category', category: 'preference_only' }, authorize, NOW)));
    assert.throws(() => f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', {
      ...command, reviewKey: 'malformed-namespaced-id', feedbackId: 'feedback:not-a-digest',
    }, authorize, NOW)));
    f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', command, authorize, NOW));
    f.db.prepare('INSERT INTO feedback(id,owner_id,task_id,category,body,created_at) VALUES(?,?,?,?,NULL,?)').run('legacy-feedback-1', 'owner-a', 'task-a', 'image_artifacts', NOW);
    f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', {
      ...command, reviewKey: 'legacy-review', feedbackId: 'legacy-feedback-1',
    }, authorize, NOW));
    const reviews = f.repo.transaction(tx => audit.readQualityReviewsInTransaction(tx, 'owner-a', { taskId: 'task-a' }, authorize));
    assert.equal(reviews.length, 2);
    assert.ok(reviews.some(review => review.feedbackId === saved.feedbackId));
    assert.ok(reviews.some(review => review.feedbackId === 'legacy-feedback-1'));
  } finally { f.close(); }
});

test('quality feedback and reviews require a succeeded task while technical failures remain recordable', async () => {
  const feedbackModule = await import('../../server/v2/feedback.js').catch(() => null);
  const audit = await import('../../server/v2/audit.js').catch(() => null);
  assert.ok(feedbackModule && audit, 'feedback and audit services are required');
  const f = fixture();
  try {
    const feedback = feedbackModule.createFeedbackService({ db: f.db, clock: () => new Date(NOW) });
    const technical = { eventKey: 'failed-task-diagnostic', kind: 'task_technical_failure', taskId: 'task-failed', errorCode: 'PROVIDER_TIMEOUT_UNKNOWN' };
    assert.equal(f.repo.transaction(tx => audit.recordFirstPartyEventInTransaction(tx, 'owner-a', technical, NOW)).replayed, false);
    assert.throws(() => feedback.submit('owner-a', { eventKey: 'failed-task-feedback', taskId: 'task-failed', versionId: 'version-failed', category: 'slow_or_failed' }));
    assert.throws(() => f.repo.transaction(tx => audit.recordFirstPartyEventInTransaction(tx, 'owner-a', {
      eventKey: 'failed-task-report', kind: 'quality_report_submitted', taskId: 'task-failed', versionId: 'version-failed', category: 'slow_or_failed',
    }, NOW)));
    assert.throws(() => f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', {
      reviewKey: 'failed-task-review', taskId: 'task-failed', versionId: 'version-failed', category: 'slow_or_failed',
      decision: 'rejected', evidenceReference: 'evidence-1', policyVersion: 'quality-v1',
    }, () => ({ actorId: 'operator-1' }), NOW)));
  } finally { f.close(); }
});

test('operator quality reviews are default-closed, synchronous, audited and transaction-reusable', async () => {
  const audit = await import('../../server/v2/audit.js').catch(() => null);
  assert.ok(audit, 'the operator review API is missing');
  const f = fixture();
  try {
    const command = { reviewKey: 'review-key-1', taskId: 'task-a', versionId: 'version-a', category: 'image_artifacts', decision: 'needs_more_evidence', evidenceReference: 'evidence-1', policyVersion: 'quality-v1' };
    assert.throws(() => f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', command, undefined)));
    assert.throws(() => f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', { ...command, actorId: 'client-actor' }, () => ({ actorId: 'operator-1' }))));
    assert.throws(() => f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', { ...command, role: 'operator', approved: true }, () => ({ actorId: 'operator-1' }))));
    assert.throws(() => f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', command, (() => Promise.resolve({ actorId: 'operator-1' })) as never)));
    const authorize = () => ({ actorId: 'operator-1' });
    const first = f.repo.transaction(tx => {
      const appended = audit.recordQualityReviewInTransaction(tx, 'owner-a', command, authorize, NOW);
      const sameTransactionRead = audit.readQualityReviewsInTransaction(tx, 'owner-a', { taskId: 'task-a' }, authorize);
      return { appended, sameTransactionRead };
    });
    const replay = f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', command, authorize, NOW));
    assert.equal(first.appended.replayed, false);
    assert.equal(first.sameTransactionRead.length, 1);
    assert.equal(replay.replayed, true);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE event_type='quality.review'").get() as { n: number }).n, 1);
    const reviews = f.repo.transaction(tx => audit.readQualityReviewsInTransaction(tx, 'owner-a', { taskId: 'task-a' }, authorize));
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0]!.actorId, 'operator-1');
    assert.throws(() => f.repo.transaction(tx => audit.recordQualityReviewInTransaction(tx, 'owner-a', { ...command, policyVersion: 'quality-v2' }, authorize, NOW)));
    assert.throws(() => f.repo.transaction(tx => audit.readQualityReviewsInTransaction(tx, 'owner-a', {}, undefined)));
  } finally { f.close(); }
});
