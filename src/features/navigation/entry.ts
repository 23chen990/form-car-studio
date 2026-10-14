import { parseEditRequest, STYLES, type EditRequest, type SourceRef } from '../../../shared/v2/edit-plan.js';

export interface PublishedCase {
  id: string;
  styleId: typeof STYLES[number];
  name: string;
  description: string;
  beforeUrl: string;
  afterUrl: string;
  licenseEvidenceId: string;
  qualityEvidenceId: string;
}

/** Publication data is supplied by the trusted release registry, never restored view state. */
export interface EntryCapabilities {
  explore: boolean;
  detail: boolean;
  publishedStyleIds: readonly typeof STYLES[number][];
  example: PublishedCase | null;
}

export interface RecentEntry {
  ownerId: string;
  projectId: string;
  name: string;
  selectedSource: SourceRef;
  styleId: typeof STYLES[number] | null;
  favorite: boolean;
  thumbnailUrl: string | null;
  activeTaskId: string | null;
}

export type EntryView = { screen: 'discover' } | { screen: 'details' } | { screen: 'photo'; intent: EditRequest };
export const DISCOVER: EntryView = Object.freeze({ screen: 'discover' });

export function publishedExample(cap: EntryCapabilities): PublishedCase | null {
  const item = cap.example;
  return item && STYLES.includes(item.styleId) &&
    [item.id, item.beforeUrl, item.afterUrl, item.licenseEvidenceId, item.qualityEvidenceId].every(value => typeof value === 'string' && value.trim()) ? item : null;
}

export function canExplore(cap: EntryCapabilities): boolean {
  const item = publishedExample(cap);
  return cap.explore === true && !!item && cap.publishedStyleIds.includes(item.styleId);
}

export function originalIntent(operation: 'detail' | 'explore', cap: EntryCapabilities): EditRequest | null {
  if (operation === 'detail' && cap.detail === true) return { schemaVersion: 2, source: { kind: 'original' }, operation, edits: {} };
  if (operation === 'explore' && canExplore(cap)) return { schemaVersion: 2, source: { kind: 'original' }, operation, styleId: cap.example!.styleId, edits: {} };
  return null;
}

/** A stale local route grants no capability, preset override or historical source. */
export function guardedEntry(value: unknown, cap: EntryCapabilities): EntryView {
  if (!value || typeof value !== 'object') return DISCOVER;
  const view = value as Partial<EntryView>;
  if (view.screen === 'discover') return value as EntryView;
  if (view.screen === 'details') return publishedExample(cap) ? value as EntryView : DISCOVER;
  if (view.screen !== 'photo' || !('intent' in view)) return DISCOVER;
  try {
    const intent = parseEditRequest(view.intent);
    if (intent.source.kind !== 'original' || Object.keys(intent.edits).length) return DISCOVER;
    if (intent.operation === 'detail') return cap.detail === true ? value as EntryView : DISCOVER;
    return canExplore(cap) && intent.styleId === cap.example!.styleId ? value as EntryView : DISCOVER;
  } catch { return DISCOVER; }
}
