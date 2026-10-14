export const FEEDBACK_CATEGORIES = Object.freeze([
  'identity_changed', 'target_not_applied', 'unwanted_structure', 'image_artifacts', 'preference_only', 'slow_or_failed',
] as const);

export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];

export type FirstPartyEvent =
  | { eventKey: string; kind: 'task_retry_requested'; taskId: string }
  | { eventKey: string; kind: 'task_technical_failure'; taskId: string; errorCode: string; profileId?: string }
  | { eventKey: string; kind: 'quality_report_submitted'; taskId: string; versionId: string; category: FeedbackCategory }
  | { eventKey: string; kind: 'voluntary_exploration_started'; projectId: string }
  | { eventKey: string; kind: 'favorite_changed'; versionId: string; isFavorite: boolean }
  | { eventKey: string; kind: 'share_sheet_opened'; versionId: string }
  | { eventKey: string; kind: 'draft_autosaved'; projectId: string };

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CODE = /^[A-Z0-9_]{1,80}$/;
type Plain = Record<string, unknown>;

export class EventContractError extends Error {
  constructor(readonly code = 'EVENT_INVALID') { super(code); this.name = 'EventContractError'; }
}

function plain(value: unknown): value is Plain {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exact(value: Plain, keys: readonly string[]): boolean {
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key));
}

function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }

/** Parse only first-party, low-sensitivity event fields. This contract does not infer user satisfaction or sharing. */
export function parseFirstPartyEvent(value: unknown): FirstPartyEvent {
  if (!plain(value) || !id(value.eventKey)) throw new EventContractError();
  if (value.kind === 'task_retry_requested' && exact(value, ['eventKey', 'kind', 'taskId']) && id(value.taskId)) {
    return Object.freeze({ eventKey: value.eventKey, kind: value.kind, taskId: value.taskId });
  }
  if (value.kind === 'task_technical_failure' &&
    (exact(value, ['eventKey', 'kind', 'taskId', 'errorCode']) || exact(value, ['eventKey', 'kind', 'taskId', 'errorCode', 'profileId'])) &&
    id(value.taskId) && typeof value.errorCode === 'string' && CODE.test(value.errorCode) && (value.profileId === undefined || id(value.profileId))) {
    return Object.freeze({ eventKey: value.eventKey, kind: value.kind, taskId: value.taskId, errorCode: value.errorCode,
      ...(value.profileId === undefined ? {} : { profileId: value.profileId }) });
  }
  if (value.kind === 'quality_report_submitted' && exact(value, ['eventKey', 'kind', 'taskId', 'versionId', 'category']) &&
    id(value.taskId) && id(value.versionId) && FEEDBACK_CATEGORIES.includes(value.category as FeedbackCategory)) {
    return Object.freeze({ eventKey: value.eventKey, kind: value.kind, taskId: value.taskId, versionId: value.versionId, category: value.category as FeedbackCategory });
  }
  if ((value.kind === 'voluntary_exploration_started' || value.kind === 'draft_autosaved') && exact(value, ['eventKey', 'kind', 'projectId']) && id(value.projectId)) {
    return Object.freeze({ eventKey: value.eventKey, kind: value.kind, projectId: value.projectId });
  }
  if (value.kind === 'favorite_changed' && exact(value, ['eventKey', 'kind', 'versionId', 'isFavorite']) && id(value.versionId) && typeof value.isFavorite === 'boolean') {
    return Object.freeze({ eventKey: value.eventKey, kind: value.kind, versionId: value.versionId, isFavorite: value.isFavorite });
  }
  if (value.kind === 'share_sheet_opened' && exact(value, ['eventKey', 'kind', 'versionId']) && id(value.versionId)) {
    return Object.freeze({ eventKey: value.eventKey, kind: value.kind, versionId: value.versionId });
  }
  throw new EventContractError();
}
