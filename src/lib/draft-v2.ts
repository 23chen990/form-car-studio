import { parseEditRequest, type EditRequest, type Edit, type Field, type SourceRef } from '../../shared/v2/edit-plan.js';

export type DraftEdits = Partial<Record<Field, Edit>>;
export interface DraftSnapshot { ownerId: string; projectId: string; revision: number; source: SourceRef; edits: DraftEdits }
export interface DraftWrite { ownerId: string; projectId: string; expectedRevision: number; source: SourceRef; edits: DraftEdits }
export interface DraftPersistence { saveDraft(write: DraftWrite): Promise<DraftSnapshot> }
export interface DraftState { snapshot: DraftSnapshot; history: DraftSnapshot[] }
export type DraftAction =
  | { type: 'edit'; field: Field; edit: Edit }
  | { type: 'source'; source: SourceRef }
  | { type: 'acknowledge'; revision: number }
  | { type: 'undo' }
  | { type: 'reset' };

export class DraftConflictError extends Error {
  constructor(readonly current: DraftSnapshot) { super('This draft changed elsewhere. Review it before saving again.'); this.name = 'DraftConflictError'; }
}

function copy(snapshot: DraftSnapshot): DraftSnapshot {
  return {
    ...snapshot,
    source: snapshot.source.kind === 'original' ? { kind: 'original' } : { kind: 'version', versionId: snapshot.source.versionId },
    edits: Object.fromEntries(Object.entries(snapshot.edits).map(([field, edit]) => [field, edit ? { ...edit } : edit])) as DraftEdits,
  };
}

export function createDraftState(snapshot: DraftSnapshot): DraftState { return { snapshot: copy(snapshot), history: [] }; }

export function reduceDraft(state: DraftState, action: DraftAction): DraftState {
  if (action.type === 'acknowledge') {
    if (!Number.isSafeInteger(action.revision) || action.revision < 0) throw new TypeError('Invalid acknowledged draft revision.');
    return { ...state, snapshot: { ...copy(state.snapshot), revision: Math.max(state.snapshot.revision, action.revision) } };
  }
  if (action.type === 'undo') {
    if (!state.history.length) return state;
    return { snapshot: { ...copy(state.history.at(-1)!), revision: state.snapshot.revision }, history: state.history.slice(0, -1) };
  }
  if (action.type === 'reset') {
    if (!Object.keys(state.snapshot.edits).length) return state;
    return { snapshot: { ...copy(state.snapshot), edits: {} }, history: [...state.history, copy(state.snapshot)] };
  }
  const next = copy(state.snapshot);
  if (action.type === 'source') next.source = action.source.kind === 'original' ? { kind: 'original' } : { kind: 'version', versionId: action.source.versionId };
  else if (action.edit.action === 'preserve') delete next.edits[action.field];
  else next.edits[action.field] = { ...action.edit };
  return { snapshot: next, history: [...state.history, copy(state.snapshot)] };
}

export function hasEffectiveChanges(snapshot: DraftSnapshot): boolean {
  return Object.values(snapshot.edits).some(edit => edit?.action === 'set') ||
    (snapshot.source.kind === 'version' && Object.values(snapshot.edits).some(edit => edit?.action === 'restore_original'));
}

export function buildEditRequest(snapshot: DraftSnapshot, operation: EditRequest['operation'], styleId?: EditRequest['styleId']): EditRequest {
  if (operation === 'explore' && Object.keys(snapshot.edits).length) throw new TypeError('Explore uses its frozen preset without detail overrides.');
  return parseEditRequest({
    schemaVersion: 2, source: snapshot.source, operation,
    ...(operation === 'explore' ? { styleId } : {}), edits: snapshot.edits,
  });
}
