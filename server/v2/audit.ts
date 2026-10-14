import { createHash } from 'node:crypto';
import { canonicalJson } from '../../shared/v2/edit-plan.js';
import { parseFirstPartyEvent, type FeedbackCategory, type FirstPartyEvent } from '../../src/lib/events.js';
import type { WalletTransaction } from './wallet-repo.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DECISIONS = ['accepted', 'rejected', 'needs_more_evidence'] as const;
type Plain = Record<string, unknown>;

export class AuditError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'AuditError'; }
}

export interface QualityReviewCommand {
  reviewKey: string;
  taskId: string;
  versionId: string;
  category: FeedbackCategory;
  decision: typeof DECISIONS[number];
  evidenceReference: string;
  policyVersion: string;
  feedbackId?: string;
}

export interface QualityReviewAuthorizationCommand {
  action: 'read' | 'write';
  ownerId: string;
  taskId?: string | null;
  versionId?: string | null;
  reviewKey?: string;
}

export interface TrustedOperator { actorId: string }
export type QualityReviewAuthorizer = (command: Readonly<QualityReviewAuthorizationCommand>) => TrustedOperator | false | undefined;
export interface QualityReviewRecord extends QualityReviewCommand { ownerId: string; actorId: string; createdAt: string }

function plain(value: unknown): value is Plain {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exact(value: Plain, keys: readonly string[]): boolean {
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key));
}

function safeId(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function safeFeedbackId(value: unknown): value is string { return safeId(value) || typeof value === 'string' && /^feedback:[a-f0-9]{64}$/.test(value); }
function token(value: unknown): value is string { return typeof value === 'string' && TOKEN.test(value); }
function iso(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value; }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function thenable(value: unknown): value is PromiseLike<unknown> {
  return !!value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function';
}
function consumeThenable(value: PromiseLike<unknown>): void { void Promise.resolve(value).catch(() => {}); }

function trustedActor(authorize: QualityReviewAuthorizer | undefined, command: QualityReviewAuthorizationCommand): string {
  if (!authorize) throw new AuditError('OPERATOR_REQUIRED');
  let result: unknown;
  try { result = authorize(Object.freeze({ ...command })); } catch { throw new AuditError('OPERATOR_REQUIRED'); }
  if (thenable(result)) { consumeThenable(result); throw new AuditError('OPERATOR_REQUIRED'); }
  if (!plain(result) || !exact(result, ['actorId']) || !token(result.actorId)) throw new AuditError('OPERATOR_REQUIRED');
  return result.actorId;
}

function activeProject(tx: WalletTransaction, ownerId: string, projectId: string): boolean {
  return !!tx.get(`SELECT 1 FROM users u JOIN projects p ON p.owner_id=u.id
    WHERE u.id=? AND u.deleted_at IS NULL AND p.id=? AND p.deleted_at IS NULL`, ownerId, projectId);
}

function activeTaskVersion(tx: WalletTransaction, ownerId: string, taskId: string, versionId: string): boolean {
  return !!tx.get(`SELECT 1 FROM users u JOIN projects p ON p.owner_id=u.id JOIN tasks t ON t.owner_id=p.owner_id AND t.project_id=p.id
    JOIN versions v ON v.owner_id=t.owner_id AND v.project_id=t.project_id AND v.task_id=t.id
    WHERE u.id=? AND u.deleted_at IS NULL AND p.deleted_at IS NULL AND t.status='succeeded' AND t.id=? AND t.result_version_id=? AND v.id=?`, ownerId, taskId, versionId, versionId);
}

function activeVersion(tx: WalletTransaction, ownerId: string, versionId: string): boolean {
  return !!tx.get(`SELECT 1 FROM users u JOIN projects p ON p.owner_id=u.id JOIN versions v ON v.owner_id=p.owner_id AND v.project_id=p.id
    WHERE u.id=? AND u.deleted_at IS NULL AND p.deleted_at IS NULL AND v.id=?`, ownerId, versionId);
}

function validateTime(value: string | undefined): string {
  const createdAt = value ?? new Date().toISOString();
  if (!iso(createdAt)) throw new AuditError('AUDIT_TIME_INVALID');
  return createdAt;
}

function stableId(prefix: string, ownerId: string, key: string): string { return `${prefix}:${digest(`${ownerId}\0${key}`)}`; }

/** Append a parsed first-party event inside the caller's wallet transaction. */
export function recordFirstPartyEventInTransaction(tx: WalletTransaction, ownerId: string, value: unknown, createdAt?: string): { replayed: boolean } {
  if (!safeId(ownerId)) throw new AuditError('EVENT_INVALID');
  const event = parseFirstPartyEvent(value);
  if ('taskId' in event) {
    const task = tx.get<{ project_id: string }>(`SELECT t.project_id FROM users u JOIN projects p ON p.owner_id=u.id JOIN tasks t ON t.owner_id=p.owner_id AND t.project_id=p.id
      WHERE u.id=? AND u.deleted_at IS NULL AND p.deleted_at IS NULL AND t.id=?`, ownerId, event.taskId);
    if (!task) throw new AuditError('EVENT_TARGET_INVALID');
    if ('versionId' in event && !activeTaskVersion(tx, ownerId, event.taskId, event.versionId)) throw new AuditError('EVENT_TARGET_INVALID');
  } else if ('versionId' in event) {
    if (!activeVersion(tx, ownerId, event.versionId)) throw new AuditError('EVENT_TARGET_INVALID');
  } else if (!activeProject(tx, ownerId, event.projectId)) throw new AuditError('EVENT_TARGET_INVALID');

  const id = stableId('first-party', ownerId, event.eventKey), detailsJson = canonicalJson(event), time = validateTime(createdAt);
  const existing = tx.get<{ owner_id: string | null; event_type: string; details_json: string }>('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?', id);
  if (existing) {
    if (existing.owner_id !== ownerId || existing.event_type !== 'first_party_event' || existing.details_json !== detailsJson) throw new AuditError('EVENT_KEY_CONFLICT');
    return { replayed: true };
  }
  tx.run("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,?,'first_party_event',?,?)", id, ownerId, detailsJson, time);
  return { replayed: false };
}

function parseReviewCommand(value: unknown): QualityReviewCommand {
  if (!plain(value)) throw new AuditError('REVIEW_INVALID');
  const keys = Object.hasOwn(value, 'feedbackId')
    ? ['reviewKey', 'taskId', 'versionId', 'category', 'decision', 'evidenceReference', 'policyVersion', 'feedbackId']
    : ['reviewKey', 'taskId', 'versionId', 'category', 'decision', 'evidenceReference', 'policyVersion'];
  if (!exact(value, keys) || !safeId(value.reviewKey) || !safeId(value.taskId) || !safeId(value.versionId) ||
    typeof value.category !== 'string' || !['identity_changed', 'target_not_applied', 'unwanted_structure', 'image_artifacts', 'preference_only', 'slow_or_failed'].includes(value.category) ||
    typeof value.decision !== 'string' || !DECISIONS.includes(value.decision as typeof DECISIONS[number]) || !token(value.evidenceReference) || !token(value.policyVersion) ||
    Object.hasOwn(value, 'feedbackId') && !safeFeedbackId(value.feedbackId)) throw new AuditError('REVIEW_INVALID');
  return { reviewKey: value.reviewKey, taskId: value.taskId, versionId: value.versionId, category: value.category as FeedbackCategory,
    decision: value.decision as typeof DECISIONS[number], evidenceReference: value.evidenceReference, policyVersion: value.policyVersion,
    ...(value.feedbackId === undefined ? {} : { feedbackId: value.feedbackId as string }) };
}

function assertReviewTarget(tx: WalletTransaction, ownerId: string, command: QualityReviewCommand): void {
  if (!activeTaskVersion(tx, ownerId, command.taskId, command.versionId)) throw new AuditError('REVIEW_TARGET_INVALID');
  if (command.feedbackId && !tx.get('SELECT 1 FROM feedback WHERE id=? AND owner_id=? AND task_id=? AND category=?', command.feedbackId, ownerId, command.taskId, command.category)) {
    throw new AuditError('REVIEW_FEEDBACK_INVALID');
  }
}

/** Trusted operator write primitive; callers can share their wallet transaction with a compensation decision. */
export function recordQualityReviewInTransaction(
  tx: WalletTransaction,
  ownerId: string,
  value: unknown,
  authorizeOperator?: QualityReviewAuthorizer,
  createdAt?: string,
): { replayed: boolean; review: QualityReviewRecord } {
  if (!safeId(ownerId)) throw new AuditError('REVIEW_INVALID');
  const command = parseReviewCommand(value);
  const actorId = trustedActor(authorizeOperator, { action: 'write', ownerId, taskId: command.taskId, versionId: command.versionId, reviewKey: command.reviewKey });
  assertReviewTarget(tx, ownerId, command);
  const time = validateTime(createdAt);
  const details = { v: 1, reviewKey: command.reviewKey, actorId, taskId: command.taskId, versionId: command.versionId,
    feedbackId: command.feedbackId ?? null, category: command.category, decision: command.decision,
    evidenceReference: command.evidenceReference, policyVersion: command.policyVersion };
  const detailsJson = canonicalJson(details), id = stableId('quality-review', ownerId, command.reviewKey);
  const existing = tx.get<{ owner_id: string | null; event_type: string; details_json: string; created_at: string }>('SELECT owner_id,event_type,details_json,created_at FROM audit_events WHERE id=?', id);
  if (existing) {
    if (existing.owner_id !== ownerId || existing.event_type !== 'quality.review' || existing.details_json !== detailsJson) throw new AuditError('REVIEW_KEY_CONFLICT');
    return { replayed: true, review: { ownerId, actorId, ...command, createdAt: existing.created_at } };
  }
  tx.run("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,?,'quality.review',?,?)", id, ownerId, detailsJson, time);
  return { replayed: false, review: { ownerId, actorId, ...command, createdAt: time } };
}

export interface QualityReviewFilter { taskId?: string; versionId?: string; limit?: number }

type ParsedQualityReviewFilter = { taskId?: string; versionId?: string; limit: number };

function parseReviewFilter(value: unknown): ParsedQualityReviewFilter {
  if (!plain(value)) throw new AuditError('REVIEW_FILTER_INVALID');
  const keys = Object.keys(value);
  if (keys.some(key => !['taskId', 'versionId', 'limit'].includes(key)) || Reflect.ownKeys(value).length !== keys.length ||
    value.taskId !== undefined && !safeId(value.taskId) || value.versionId !== undefined && !safeId(value.versionId) ||
    value.limit !== undefined && (!Number.isSafeInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100)) throw new AuditError('REVIEW_FILTER_INVALID');
  return { ...(value.taskId === undefined ? {} : { taskId: value.taskId as string }),
    ...(value.versionId === undefined ? {} : { versionId: value.versionId as string }), limit: (value.limit as number | undefined) ?? 50 };
}

/** Trusted, bounded review read primitive for use inside the caller's wallet transaction. */
export function readQualityReviewsInTransaction(
  tx: WalletTransaction,
  ownerId: string,
  filterValue: unknown,
  authorizeOperator?: QualityReviewAuthorizer,
): QualityReviewRecord[] {
  if (!safeId(ownerId)) throw new AuditError('REVIEW_OWNER_INVALID');
  const filter = parseReviewFilter(filterValue);
  trustedActor(authorizeOperator, { action: 'read', ownerId, taskId: filter.taskId ?? null, versionId: filter.versionId ?? null });
  if (!tx.get('SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL', ownerId)) throw new AuditError('REVIEW_OWNER_INVALID');
  const rows = tx.all<{ details_json: string; created_at: string }>(`SELECT details_json,created_at FROM audit_events WHERE owner_id=? AND event_type='quality.review'
    AND (? IS NULL OR json_extract(details_json,'$.taskId')=?) AND (? IS NULL OR json_extract(details_json,'$.versionId')=?) ORDER BY rowid DESC LIMIT ?`,
    ownerId, filter.taskId ?? null, filter.taskId ?? null, filter.versionId ?? null, filter.versionId ?? null, filter.limit);
  const results: QualityReviewRecord[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try { parsed = JSON.parse(row.details_json); } catch { throw new AuditError('REVIEW_AUDIT_INVALID'); }
    if (!plain(parsed) || !exact(parsed, ['v', 'reviewKey', 'actorId', 'taskId', 'versionId', 'feedbackId', 'category', 'decision', 'evidenceReference', 'policyVersion']) ||
      parsed.v !== 1 || !safeId(parsed.reviewKey) || !token(parsed.actorId) || !safeId(parsed.taskId) || !safeId(parsed.versionId) ||
      parsed.feedbackId !== null && !safeFeedbackId(parsed.feedbackId) || typeof parsed.category !== 'string' ||
      !['identity_changed', 'target_not_applied', 'unwanted_structure', 'image_artifacts', 'preference_only', 'slow_or_failed'].includes(parsed.category) ||
      typeof parsed.decision !== 'string' || !DECISIONS.includes(parsed.decision as typeof DECISIONS[number]) || !token(parsed.evidenceReference) || !token(parsed.policyVersion) || !iso(row.created_at)) {
      throw new AuditError('REVIEW_AUDIT_INVALID');
    }
    const command: QualityReviewCommand = { reviewKey: parsed.reviewKey, taskId: parsed.taskId, versionId: parsed.versionId,
      ...(parsed.feedbackId === null ? {} : { feedbackId: parsed.feedbackId as string }), category: parsed.category as FeedbackCategory,
      decision: parsed.decision as typeof DECISIONS[number], evidenceReference: parsed.evidenceReference, policyVersion: parsed.policyVersion };
    if (!activeTaskVersion(tx, ownerId, command.taskId, command.versionId)) continue;
    if (command.feedbackId && !tx.get('SELECT 1 FROM feedback WHERE id=? AND owner_id=? AND task_id=? AND category=?', command.feedbackId, ownerId, command.taskId, command.category)) continue;
    results.push({ ownerId, actorId: parsed.actorId, ...command, createdAt: row.created_at });
  }
  return results;
}
