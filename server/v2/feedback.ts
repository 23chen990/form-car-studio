import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { parseFirstPartyEvent, type FeedbackCategory } from '../../src/lib/events.js';
import { WalletRepository } from './wallet-repo.js';
import { recordFirstPartyEventInTransaction } from './audit.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_BODY = 1000;
type Plain = Record<string, unknown>;

export class FeedbackError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'FeedbackError'; }
}

export interface FeedbackRequest {
  eventKey: string;
  taskId: string;
  versionId: string;
  category: FeedbackCategory;
  body?: string;
}

export interface FeedbackServiceOptions { db: DatabaseSync; clock?: () => Date }

function plain(value: unknown): value is Plain {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exact(value: Plain, keys: readonly string[]): boolean {
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key));
}

function safeId(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }

function request(value: unknown): FeedbackRequest {
  if (!plain(value)) throw new FeedbackError('FEEDBACK_INVALID');
  const keys = Object.hasOwn(value, 'body') ? ['eventKey', 'taskId', 'versionId', 'category', 'body'] : ['eventKey', 'taskId', 'versionId', 'category'];
  if (!exact(value, keys) || !safeId(value.eventKey) || !safeId(value.taskId) || !safeId(value.versionId) ||
    value.body !== undefined && (typeof value.body !== 'string' || value.body.length > MAX_BODY)) throw new FeedbackError('FEEDBACK_INVALID');
  let event: ReturnType<typeof parseFirstPartyEvent>;
  try { event = parseFirstPartyEvent({ eventKey: value.eventKey, kind: 'quality_report_submitted', taskId: value.taskId, versionId: value.versionId, category: value.category }); }
  catch { throw new FeedbackError('FEEDBACK_INVALID'); }
  if (event.kind !== 'quality_report_submitted') throw new FeedbackError('FEEDBACK_INVALID');
  return { eventKey: event.eventKey, taskId: event.taskId, versionId: event.versionId, category: event.category,
    ...(value.body === undefined ? {} : { body: value.body as string }) };
}

/** Keep support text bounded and redact common contact/credential/network values before private storage. */
export function redactSupportText(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > MAX_BODY) throw new FeedbackError('FEEDBACK_INVALID');
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!clean) return null;
  return clean
    .replace(/\b(?:api[_ -]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{8,}={0,2}\.[A-Za-z0-9_-]{8,}={0,2}\.[A-Za-z0-9_-]{8,}={0,2}\b/g, '[redacted]')
    .replace(/data:image\/[^;,\s]+(?:;charset=[^;,\s]+)?(?:;base64)?,[^\s]+/gi, '[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted]')
    .replace(/\b(?:https?:\/\/|www\.)[^\s]+/gi, '[redacted]')
    .replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, '[redacted]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted]')
    .replace(/(?:\/Users\/|[A-Z]:\\Users\\)[^\s]+/g, '[redacted]');
}

function validTime(clock: () => Date): string {
  let date: Date;
  try { date = clock(); } catch { throw new FeedbackError('FEEDBACK_UNAVAILABLE'); }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new FeedbackError('FEEDBACK_UNAVAILABLE');
  return date.toISOString();
}

function feedbackId(ownerId: string, eventKey: string): string {
  return `feedback:${createHash('sha256').update(`${ownerId}\0${eventKey}`).digest('hex')}`;
}

export function createFeedbackService(options: FeedbackServiceOptions) {
  const repository = new WalletRepository(options.db), clock = options.clock ?? (() => new Date());
  return Object.freeze({
    submit(ownerId: string, input: unknown): { feedbackId: string; replayed: boolean } {
      if (!safeId(ownerId)) throw new FeedbackError('FEEDBACK_INVALID');
      const value = request(input), body = redactSupportText(value.body), id = feedbackId(ownerId, value.eventKey), createdAt = validTime(clock);
      try {
        return repository.transaction(tx => {
          const target = tx.get(`SELECT 1 FROM users u JOIN projects p ON p.owner_id=u.id JOIN tasks t ON t.owner_id=p.owner_id AND t.project_id=p.id
            JOIN versions v ON v.owner_id=t.owner_id AND v.project_id=t.project_id AND v.task_id=t.id
            WHERE u.id=? AND u.deleted_at IS NULL AND p.deleted_at IS NULL AND t.status='succeeded' AND t.id=? AND t.result_version_id=? AND v.id=?`,
            ownerId, value.taskId, value.versionId, value.versionId);
          if (!target) throw new FeedbackError('FEEDBACK_TARGET_INVALID');
          const existing = tx.get<{ owner_id: string; task_id: string; category: string; body: string | null }>('SELECT owner_id,task_id,category,body FROM feedback WHERE id=?', id);
          if (existing && (existing.owner_id !== ownerId || existing.task_id !== value.taskId || existing.category !== value.category || existing.body !== body)) {
            throw new FeedbackError('FEEDBACK_KEY_CONFLICT');
          }
          if (!existing) tx.run('INSERT INTO feedback(id,owner_id,task_id,category,body,created_at) VALUES(?,?,?,?,?,?)', id, ownerId, value.taskId, value.category, body, createdAt);
          const event = recordFirstPartyEventInTransaction(tx, ownerId, {
            eventKey: value.eventKey, kind: 'quality_report_submitted', taskId: value.taskId, versionId: value.versionId, category: value.category,
          }, createdAt);
          return { feedbackId: id, replayed: !!existing && event.replayed };
        });
      } catch (error) {
        if (error instanceof FeedbackError) throw error;
        throw new FeedbackError('FEEDBACK_UNAVAILABLE');
      }
    },
  });
}
