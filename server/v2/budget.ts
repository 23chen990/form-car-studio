import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../shared/v2/edit-plan.js';
import { providerEditRequest, type PlanSnapshot } from './plans.js';
import { readTaskSnapshot, supplierLiability, type BeforeAcceptContext } from './tasks.js';
import { WalletRepository, type WalletTransaction } from './wallet-repo.js';
import type { ProviderInput, ProviderResult } from './provider.js';
import type { DispatchAuthorizationContext } from './worker.js';
import { countWindow, windowStart } from './rate-limits.js';

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UNVERIFIABLE_LIMIT = 'unverifiable_provider_limit';
const PROFILE_KEYS = ['supplierProfileId','profileVersion','providerId','protocol','endpoint','model','templateVersion','output','maxSupplierCostMicrosUSD','qualityEvidence','timeoutMs','maxInputBytes','maxOutputBytes','maxResponseBytes'] as const;
const POLICY_KEYS = ['externalSpendApproved','profile','globalBudgetMicrosUSD','accountBudgetMicrosUSD','maxActiveTasksGlobal','maxActiveTasksPerAccount','maxConcurrentAttemptsGlobal','maxConcurrentAttemptsPerAccount','maxAcceptedPerWindowGlobal','maxAcceptedPerWindowPerAccount','maxAttemptsPerWindowGlobal','maxAttemptsPerWindowPerAccount','windowMs'] as const;
const REASONS = ['operator_request','budget_limit','active_limit','rate_limit','provider_profile_mismatch','provider_cost_cap_breached','provider_context_invalid'] as const;
type Reason = typeof REASONS[number];
type Plain = Record<string, unknown>;

export class BudgetError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'BudgetError'; }
}

export interface ApprovedSupplierProfile {
  supplierProfileId: string; profileVersion: string; providerId: string; protocol: 'openai-images-edits'; endpoint: string;
  model: string; templateVersion: string; output: { format: 'png'; size: '1024x1024' | '1536x1024' | '1024x1536'; quality: 'low' | 'medium' | 'high' };
  maxSupplierCostMicrosUSD: number; qualityEvidence: string; timeoutMs: number; maxInputBytes: number; maxOutputBytes: number; maxResponseBytes: number;
}
export interface ApprovedBudgetPolicy {
  externalSpendApproved: true; profile: ApprovedSupplierProfile;
  globalBudgetMicrosUSD: number; accountBudgetMicrosUSD: number;
  maxActiveTasksGlobal: number; maxActiveTasksPerAccount: number;
  maxConcurrentAttemptsGlobal: number; maxConcurrentAttemptsPerAccount: number;
  maxAcceptedPerWindowGlobal: number; maxAcceptedPerWindowPerAccount: number;
  maxAttemptsPerWindowGlobal: number; maxAttemptsPerWindowPerAccount: number; windowMs: number;
}
export type BudgetControlTarget = { scope: 'global' } | { scope: 'account'; ownerId: string };
export interface OperatorCommand { action: 'pause' | 'resume'; target: BudgetControlTarget; reason: Reason }
export interface TrustedOperator { actorId: string }
export type OperatorAuthorizer = (command: Readonly<OperatorCommand>) => TrustedOperator | false | undefined;
export interface BudgetServiceOptions {
  db: DatabaseSync; approvedPolicy?: ApprovedBudgetPolicy | null; authorizeOperator?: OperatorAuthorizer;
  clock?: () => Date; id?: () => string;
}
export type BudgetControlReason = Reason;
export interface BudgetService {
  beforeAccept(context: BeforeAcceptContext): boolean | undefined;
  dispatchGuard(context: DispatchAuthorizationContext): boolean | undefined;
  pause(target: BudgetControlTarget, reason: Reason): void;
  resume(target: BudgetControlTarget, reason: Reason): void;
  protectProvider(provider: (input: ProviderInput) => Promise<ProviderResult>): (input: ProviderInput) => Promise<ProviderResult>;
  locallyFailClosed(): boolean;
}

function plain(value: unknown): value is Plain { return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function exact(value: Plain, keys: readonly string[]): boolean { return Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function safeId(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function token(value: unknown): value is string { return typeof value === 'string' && TOKEN.test(value); }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function thenable(value: unknown): value is PromiseLike<unknown> { return !!value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function'; }
function consumeThenable(value: PromiseLike<unknown>): void { void Promise.resolve(value).catch(() => {}); }
function safeAdd(a: bigint, b: number): bigint | null {
  if (!Number.isSafeInteger(b) || b < 0) return null;
  const sum = a + BigInt(b); return sum <= MAX ? sum : null;
}
function validatedPolicy(value: unknown): ApprovedBudgetPolicy | null {
  if (!plain(value) || !exact(value, POLICY_KEYS) || value.externalSpendApproved !== true || !plain(value.profile) || !exact(value.profile, PROFILE_KEYS)) return null;
  const profile = value.profile;
  if (!token(profile.supplierProfileId) || !token(profile.profileVersion) || !token(profile.providerId) || profile.protocol !== 'openai-images-edits' ||
    profile.endpoint !== 'https://api.openai.com/v1/images/edits' || !token(profile.model) || !token(profile.templateVersion) || !positive(profile.maxSupplierCostMicrosUSD) ||
    !token(profile.qualityEvidence) || !positive(profile.timeoutMs) || profile.timeoutMs > 300_000 || !positive(profile.maxInputBytes) || profile.maxInputBytes > 10 * 1024 * 1024 ||
    !positive(profile.maxOutputBytes) || profile.maxOutputBytes > 32 * 1024 * 1024 || !positive(profile.maxResponseBytes) || profile.maxResponseBytes > 48 * 1024 * 1024 ||
    !plain(profile.output) || !exact(profile.output, ['format','size','quality']) || profile.output.format !== 'png' ||
    !['1024x1024','1536x1024','1024x1536'].includes(String(profile.output.size)) || !['low','medium','high'].includes(String(profile.output.quality))) return null;
  const limits = POLICY_KEYS.filter(key => key !== 'externalSpendApproved' && key !== 'profile');
  if (!limits.every(key => positive(value[key]))) return null;
  if (!positive(value.windowMs) || value.windowMs > 31 * 24 * 60 * 60 * 1000) return null;
  return Object.freeze({ ...(structuredClone(value) as unknown as ApprovedBudgetPolicy), profile: Object.freeze({ ...(structuredClone(profile) as unknown as ApprovedSupplierProfile) }) });
}
function matchesProfile(supplier: PlanSnapshot['semantic']['supplier'], approved: ApprovedSupplierProfile): boolean {
  return !!supplier && supplier.supplierProfileId === approved.supplierProfileId && supplier.profileVersion === approved.profileVersion &&
    supplier.providerId === approved.providerId && supplier.protocol === approved.protocol && supplier.endpoint === approved.endpoint &&
    supplier.model === approved.model && supplier.templateVersion === approved.templateVersion && supplier.maxSupplierCostMicrosUSD === approved.maxSupplierCostMicrosUSD &&
    supplier.qualityEvidence === approved.qualityEvidence && supplier.timeoutMs === approved.timeoutMs && supplier.maxInputBytes === approved.maxInputBytes &&
    supplier.maxOutputBytes === approved.maxOutputBytes && supplier.maxResponseBytes === approved.maxResponseBytes && canonicalJson(supplier.output) === canonicalJson(approved.output);
}
function costWithin(actual: unknown, maximum: number): boolean { return actual === null || typeof actual === 'number' && Number.isSafeInteger(actual) && actual >= 0 && actual <= maximum; }
function iso(clock: () => Date): string {
  const now = clock(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BudgetError('BUDGET_CLOCK_UNAVAILABLE'); return now.toISOString();
}
function count(tx: WalletTransaction, sql: string, ...values: (string | number)[]): number {
  const row = tx.get<{ count: number }>(sql, ...values);
  if (!row || !Number.isSafeInteger(row.count) || row.count < 0) throw new BudgetError('BUDGET_COUNT_UNAVAILABLE');
  return row.count;
}
function taskCounts(tx: WalletTransaction, ownerId?: string): number {
  return count(tx, `SELECT count(*) AS count FROM tasks WHERE status IN ('queued','processing','uncertain')${ownerId === undefined ? '' : ' AND owner_id=?'}`,
    ...(ownerId === undefined ? [] : [ownerId]));
}
function attemptCounts(tx: WalletTransaction, ownerId?: string): number {
  return count(tx, `SELECT count(*) AS count FROM supplier_attempts WHERE status IN ('started','uncertain')${ownerId === undefined ? '' : ' AND owner_id=?'}`,
    ...(ownerId === undefined ? [] : [ownerId]));
}
function resultDenied(): ProviderResult {
  return { ok: false, error: { code: 'PROVIDER_DISABLED', category: 'disabled', retryable: false }, attempted: false,
    providerRequestId: null, usage: null, actualCostMicrosUSD: null, maxExposureMicrosUSD: null };
}
function declaredString(value: unknown): string | null { return token(value) ? value : null; }
function optionalCost(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }

interface CapturedCall { ownerId: string; projectId: string; taskId: string; attemptId: string; supplier: NonNullable<PlanSnapshot['semantic']['supplier']>; maximum: number }
interface CandidateRow {
  id: string; owner_id: string; project_id: string; status: string; request_snapshot_json: string | null; plan_id: string | null;
  confirmed_plan_id: string | null; submission_id: string; user_cost_units: number; quote_id: string | null; quote_owner_id: string | null;
  quote_project_id: string | null; quote_plan_digest: string | null; quote_snapshot_json: string | null; quote_user_cost_units: number | null;
  quote_confirmed_at: string | null; attempt_id: string; attempt_estimate: number | null;
  attempt_status: string; attempt_profile: string; attempt_version: string | null; exposure_status: string; exposure_profile: string;
  exposure_version: string; exposure_max: number;
}

function byteDigest(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function sourceRefMatches(value: unknown, expected: { kind: string; versionId?: string }): boolean {
  if (!plain(value) || expected.kind === 'original' && !exact(value, ['kind']) || expected.kind === 'version' && !exact(value, ['kind','versionId'])) return false;
  return value.kind === expected.kind && (expected.kind !== 'version' || value.versionId === expected.versionId);
}
function assetMatches(value: unknown, ownerId: string, projectId: string, expected: { assetId: string; canonicalSha256: string }, source: { kind: string; versionId?: string }): boolean {
  if (!plain(value) || !exact(value, ['ownerId','projectId','assetId','source','mimeType','sha256','bytes'])) return false;
  return value.ownerId === ownerId && value.projectId === projectId && value.assetId === expected.assetId && value.mimeType === 'image/png' &&
    value.sha256 === expected.canonicalSha256 && Buffer.isBuffer(value.bytes) && byteDigest(value.bytes) === expected.canonicalSha256 && sourceRefMatches(value.source, source);
}
function inputMatches(input: ProviderInput, ownerId: string, projectId: string, plan: PlanSnapshot): boolean {
  if (!plain(input) || !Reflect.ownKeys(input).every(key => typeof key === 'string' && ['ownerId','projectId','editRequest','primary','originalReference','signal'].includes(key)) ||
    input.ownerId !== ownerId || input.projectId !== projectId) return false;
  const semantic = plan.semantic, source = semantic.source;
  let edits: string; try { edits = canonicalJson(input.editRequest); } catch { return false; }
  if (edits !== canonicalJson(providerEditRequest(plan)) || !assetMatches(input.primary, ownerId, projectId, source,
    source.kind === 'version' ? { kind: 'version', versionId: source.versionId } : { kind: 'original' })) return false;
  const reference = semantic.originalReference;
  if (!reference) return input.originalReference === undefined;
  return assetMatches(input.originalReference, ownerId, projectId, reference, { kind: 'original' });
}

export function createBudgetService(options: BudgetServiceOptions): BudgetService {
  const { db } = options, approved = validatedPolicy(options.approvedPolicy), clock = options.clock ?? (() => new Date()), makeId = options.id ?? randomUUID;
  const nextId = () => { const value = makeId(); if (!safeId(value)) throw new BudgetError('BUDGET_ID_INVALID'); return value; };
  const repo = new WalletRepository(db, { newId: nextId, clock: () => iso(clock) });
  let localFailClosed = false;
  const deniedByDefault = () => !approved || localFailClosed;
  function hasUnverifiableLimit(tx: WalletTransaction): boolean {
    return !!tx.get('SELECT 1 FROM supplier_exposures WHERE estimate_basis=? LIMIT 1', UNVERIFIABLE_LIMIT);
  }
  function latestPaused(tx: WalletTransaction, target: BudgetControlTarget): boolean {
    const ownerId = target.scope === 'account' ? target.ownerId : undefined;
    const row = tx.get<{ details_json: string }>(`SELECT details_json FROM audit_events WHERE event_type='budget.control' AND ${ownerId === undefined ? 'owner_id IS NULL' : 'owner_id=?'} ORDER BY rowid DESC LIMIT 1`,
      ...(ownerId === undefined ? [] : [ownerId]));
    if (!row) return false;
    let detail: unknown; try { detail = JSON.parse(row.details_json); } catch { return true; }
    if (!plain(detail) || !exact(detail, ['v','scope','action','actorId','reason']) || detail.v !== 1 || detail.scope !== target.scope ||
      detail.action !== 'pause' && detail.action !== 'resume' || !token(detail.actorId) || !REASONS.includes(detail.reason as Reason)) return true;
    return detail.action === 'pause';
  }
  function paused(tx: WalletTransaction, ownerId: string): boolean {
    return deniedByDefault() || hasUnverifiableLimit(tx) || latestPaused(tx, { scope: 'global' }) || latestPaused(tx, { scope: 'account', ownerId });
  }
  function liabilitiesFit(tx: WalletTransaction, ownerId: string, candidate: number, expectedCurrent?: bigint): boolean {
    if (!approved) return false;
    const global = supplierLiability(tx), account = supplierLiability(tx, ownerId);
    if (expectedCurrent !== undefined && expectedCurrent !== global) return false;
    const globalTotal = safeAdd(global, candidate), accountTotal = safeAdd(account, candidate);
    return globalTotal !== null && accountTotal !== null && globalTotal <= BigInt(approved.globalBudgetMicrosUSD) && accountTotal <= BigInt(approved.accountBudgetMicrosUSD);
  }
  function timeFits(tx: WalletTransaction, ownerId: string, source: 'accepted' | 'attempted', globalLimit: number, accountLimit: number, candidateAlreadyCounted = false): boolean {
    if (!approved) return false;
    const since = windowStart(clock(), approved.windowMs);
    const global = countWindow(tx, source, since), account = countWindow(tx, source, since, ownerId);
    return candidateAlreadyCounted ? global <= globalLimit && account <= accountLimit : global < globalLimit && account < accountLimit;
  }
  function activeTasksFit(tx: WalletTransaction, ownerId: string, candidateAlreadyInserted: boolean): boolean {
    if (!approved) return false;
    const global = taskCounts(tx), account = taskCounts(tx, ownerId), extra = candidateAlreadyInserted ? 0 : 1;
    return global + extra <= approved.maxActiveTasksGlobal && account + extra <= approved.maxActiveTasksPerAccount;
  }
  function activeAttemptsFit(tx: WalletTransaction, ownerId: string, candidateAlreadyStarted: boolean): boolean {
    if (!approved) return false;
    const global = attemptCounts(tx), account = attemptCounts(tx, ownerId), extra = candidateAlreadyStarted ? 0 : 1;
    return global + extra <= approved.maxConcurrentAttemptsGlobal && account + extra <= approved.maxConcurrentAttemptsPerAccount;
  }
  function frozenAllowed(context: BeforeAcceptContext): boolean {
    const supplier = context.plan?.semantic?.supplier;
    if (!approved || deniedByDefault() || !safeId(context.ownerId) || !safeId(context.projectId) || !safeId(context.taskId) ||
      !positive(context.maximumExposureMicrosUSD) || !context.plan || context.plan.semantic.walletScope !== 'live' || context.plan.semantic.executionMode !== 'live' ||
      context.plan.semantic.ownerId !== context.ownerId || context.plan.semantic.projectId !== context.projectId || !supplier || !matchesProfile(supplier, approved.profile) ||
      context.maximumExposureMicrosUSD !== approved.profile.maxSupplierCostMicrosUSD || context.plan.semantic.supplierExposureMicrosUSD !== context.maximumExposureMicrosUSD ||
      !positive(supplier.approvedBudgetMicrosUSD) || context.maximumExposureMicrosUSD > supplier.approvedBudgetMicrosUSD) return false;
    return true;
  }
  function beforeAccept(context: BeforeAcceptContext): boolean | undefined {
    if (context?.plan?.semantic?.walletScope === 'demo') {
      return context.plan.semantic.executionMode === 'licensed_demo' && context.plan.semantic.supplier === null && context.maximumExposureMicrosUSD === 0 ? undefined : false;
    }
    try {
      if (!frozenAllowed(context) || typeof context.currentLiabilityMicrosUSD !== 'bigint' || paused(context.tx, context.ownerId) ||
        !liabilitiesFit(context.tx, context.ownerId, context.maximumExposureMicrosUSD, context.currentLiabilityMicrosUSD) ||
        !activeTasksFit(context.tx, context.ownerId, false) || !activeAttemptsFit(context.tx, context.ownerId, false) ||
        !timeFits(context.tx, context.ownerId, 'accepted', approved!.maxAcceptedPerWindowGlobal, approved!.maxAcceptedPerWindowPerAccount)) return false;
      return true;
    } catch { return false; }
  }
  function dispatchGuard(context: DispatchAuthorizationContext): boolean | undefined {
    try {
      if (deniedByDefault() || !approved || !safeId(context.ownerId) || !safeId(context.projectId) || !safeId(context.taskId) ||
        context.maximumExposureMicrosUSD !== approved.profile.maxSupplierCostMicrosUSD || !positive(context.maximumExposureMicrosUSD) || typeof context.currentLiabilityMicrosUSD !== 'bigint' || paused(context.tx, context.ownerId) ||
        !liabilitiesFit(context.tx, context.ownerId, 0, context.currentLiabilityMicrosUSD) || !activeTasksFit(context.tx, context.ownerId, true) ||
        !activeAttemptsFit(context.tx, context.ownerId, false) || !timeFits(context.tx, context.ownerId, 'attempted', approved.maxAttemptsPerWindowGlobal, approved.maxAttemptsPerWindowPerAccount)) return false;
      const candidate = context.tx.get<{ status: string; project_id: string }>(`SELECT t.status,t.project_id FROM tasks t WHERE t.id=? AND t.owner_id=?`, context.taskId, context.ownerId);
      const exposure = context.tx.get<{ status: string; provider_profile_id: string; provider_profile_version: string; max_cost_usd_micros: number; estimate_basis: string; cost_currency: string }>(
        'SELECT status,provider_profile_id,provider_profile_version,max_cost_usd_micros,estimate_basis,cost_currency FROM supplier_exposures WHERE owner_id=? AND task_id=?', context.ownerId, context.taskId);
      if (!candidate || candidate.status !== 'queued' || candidate.project_id !== context.projectId || !exposure || exposure.status !== 'reserved' ||
        exposure.provider_profile_id !== approved.profile.supplierProfileId || exposure.provider_profile_version !== approved.profile.profileVersion ||
        exposure.max_cost_usd_micros !== context.maximumExposureMicrosUSD || exposure.cost_currency !== 'USD' || exposure.estimate_basis !== 'profile_max_cost_usd_micros') return false;
      return true;
    } catch { return false; }
  }
  function appendControl(tx: WalletTransaction, action: 'pause' | 'resume', target: BudgetControlTarget, reason: Reason, actorId: string): void {
    const ownerId = target.scope === 'account' ? target.ownerId : null;
    tx.run("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES (?,?, 'budget.control',?,?)",
      nextId(), ownerId, canonicalJson({ v: 1, scope: target.scope, action, actorId, reason }), iso(clock));
  }
  function control(action: 'pause' | 'resume', target: BudgetControlTarget, reason: Reason): void {
    if (!plain(target) || target.scope !== 'global' && target.scope !== 'account' || target.scope === 'global' && !exact(target, ['scope']) ||
      target.scope === 'account' && (!exact(target, ['scope','ownerId']) || !safeId(target.ownerId)) || !REASONS.includes(reason)) throw new BudgetError('BUDGET_CONTROL_INVALID');
    const command: OperatorCommand = Object.freeze({ action, target: Object.freeze({ ...target }) as BudgetControlTarget, reason });
    let authorized: unknown;
    try { authorized = options.authorizeOperator?.(command); } catch { throw new BudgetError('BUDGET_OPERATOR_REQUIRED'); }
    if (thenable(authorized)) { consumeThenable(authorized); throw new BudgetError('BUDGET_OPERATOR_REQUIRED'); }
    if (!plain(authorized) || !exact(authorized, ['actorId']) || !token(authorized.actorId)) throw new BudgetError('BUDGET_OPERATOR_REQUIRED');
    try {
      repo.transaction(tx => {
        if (action === 'resume' && hasUnverifiableLimit(tx)) throw new BudgetError('BUDGET_REPAIR_REQUIRED');
        appendControl(tx, action, target, reason, authorized.actorId as string);
      });
    } catch (error) {
      localFailClosed = true;
      if (error instanceof BudgetError && error.code === 'BUDGET_REPAIR_REQUIRED') throw error;
      throw new BudgetError('BUDGET_AUDIT_WRITE_FAILED');
    }
  }
  function appendIncident(captured: CapturedCall | null, input: ProviderInput, reason: Reason, response?: unknown): void {
    const observed = plain(response) ? response : {};
    const record = {
      v: 1, reason, taskId: captured?.taskId ?? null, attemptId: captured?.attemptId ?? null,
      expectedProfile: captured?.supplier.supplierProfileId ?? approved?.profile.supplierProfileId ?? null,
      expectedVersion: captured?.supplier.profileVersion ?? approved?.profile.profileVersion ?? null,
      observedProfile: declaredString(observed.profileId), observedVersion: declaredString(observed.profileVersion),
      observedModel: declaredString(observed.model), observedTemplate: declaredString(observed.templateVersion),
      observedMaximumMicrosUSD: optionalCost(observed.maxExposureMicrosUSD), actualCostMicrosUSD: optionalCost(observed.actualCostMicrosUSD),
    };
    try {
      repo.transaction(tx => {
        const owner = captured?.ownerId ?? (safeId(input?.ownerId) && tx.get('SELECT 1 FROM users WHERE id=?', input.ownerId) ? input.ownerId : null);
        tx.run("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES (?,?, 'budget.case',?,?)", nextId(), owner, canonicalJson(record), iso(clock));
        appendControl(tx, 'pause', { scope: 'global' }, reason, 'system:budget-guard');
      });
    } catch {
      localFailClosed = true;
      if (!captured) return;
      // The frozen bound is no longer defensible. Keep this financial fact even
      // when the operator audit cannot be written; settlement does not erase it.
      try {
        repo.transaction(tx => {
          const held = tx.run(`UPDATE supplier_exposures SET estimate_basis=? WHERE owner_id=? AND task_id=?
            AND provider_profile_id=? AND provider_profile_version=? AND max_cost_usd_micros=?
            AND EXISTS (SELECT 1 FROM supplier_attempts WHERE id=? AND owner_id=? AND task_id=?)`,
            UNVERIFIABLE_LIMIT, captured.ownerId, captured.taskId, captured.supplier.supplierProfileId,
            captured.supplier.profileVersion, captured.maximum, captured.attemptId, captured.ownerId, captured.taskId);
          if (held.changes !== 1) throw new BudgetError('BUDGET_HOLD_WRITE_FAILED');
        });
      } catch { /* A fully unwritable store can only close this instance. */ }
    }
  }
  function inspectResponse(response: ProviderResult, captured: CapturedCall): Reason | null {
    if (!plain(response)) return 'provider_profile_mismatch';
    if (response.attempted === false) return null;
    const supplier = captured.supplier;
    if (response.maxExposureMicrosUSD !== captured.maximum || !costWithin(response.actualCostMicrosUSD, captured.maximum)) {
      return response.actualCostMicrosUSD !== null && typeof response.actualCostMicrosUSD === 'number' && response.actualCostMicrosUSD > captured.maximum
        ? 'provider_cost_cap_breached' : 'provider_profile_mismatch';
    }
    if (response.ok === true && (response.profileId !== supplier.supplierProfileId || response.profileVersion !== supplier.profileVersion ||
      response.model !== supplier.model || response.templateVersion !== supplier.templateVersion)) return 'provider_profile_mismatch';
    return null;
  }
  function capture(tx: WalletTransaction, input: ProviderInput): { kind: 'ready'; call: CapturedCall } | { kind: 'paused' } | { kind: 'invalid' } {
    if (!approved || !plain(input) || !safeId(input.ownerId) || !safeId(input.projectId)) return { kind: 'invalid' };
    if (paused(tx, input.ownerId)) return { kind: 'paused' };
    const rows = tx.all<CandidateRow>(`SELECT t.id,t.owner_id,t.project_id,t.status,t.request_snapshot_json,t.plan_id,t.confirmed_plan_id,t.submission_id,t.user_cost_units,
      q.id AS quote_id,q.owner_id AS quote_owner_id,q.project_id AS quote_project_id,q.plan_digest AS quote_plan_digest,q.snapshot_json AS quote_snapshot_json,
      q.user_cost_units AS quote_user_cost_units,q.confirmed_at AS quote_confirmed_at,a.id AS attempt_id,a.estimated_cost_usd_micros AS attempt_estimate,a.status AS attempt_status,
      a.provider_profile_id AS attempt_profile,a.provider_profile_version AS attempt_version,e.status AS exposure_status,
      e.provider_profile_id AS exposure_profile,e.provider_profile_version AS exposure_version,e.max_cost_usd_micros AS exposure_max
      FROM tasks t LEFT JOIN plans q ON q.id=t.confirmed_plan_id AND q.owner_id=t.owner_id AND q.project_id=t.project_id
      JOIN supplier_attempts a ON a.owner_id=t.owner_id AND a.task_id=t.id
      JOIN supplier_exposures e ON e.owner_id=t.owner_id AND e.task_id=t.id
      WHERE t.owner_id=? AND t.project_id=? AND t.status='processing' AND a.status='started' AND e.status='started'`, input.ownerId, input.projectId);
    if (rows.length !== 1) return { kind: 'invalid' };
    const row = rows[0]!;
    try {
      const snapshot = readTaskSnapshot(row.request_snapshot_json), plan = snapshot.plan, supplier = plan.semantic.supplier;
      if (row.status !== 'processing' || snapshot.scope !== 'live' || plan.semantic.walletScope !== 'live' || plan.semantic.executionMode !== 'live' ||
        row.request_snapshot_json !== canonicalJson(snapshot) || row.plan_id !== plan.planId || row.confirmed_plan_id !== plan.planId || row.submission_id !== snapshot.submissionId ||
        row.quote_id !== plan.planId || row.quote_owner_id !== row.owner_id || row.quote_project_id !== row.project_id || row.quote_plan_digest !== plan.planDigest ||
        row.quote_snapshot_json !== canonicalJson(plan) || row.quote_confirmed_at === null || row.quote_user_cost_units !== row.user_cost_units ||
        row.user_cost_units !== plan.semantic.userCostUnits || plan.semantic.ownerId !== row.owner_id || plan.semantic.projectId !== row.project_id || !supplier || !matchesProfile(supplier, approved.profile) ||
        row.attempt_status !== 'started' || row.attempt_profile !== supplier.supplierProfileId || row.attempt_version !== supplier.profileVersion ||
        row.attempt_estimate !== supplier.maxSupplierCostMicrosUSD || row.exposure_status !== 'started' || row.exposure_profile !== supplier.supplierProfileId ||
        row.exposure_version !== supplier.profileVersion || row.exposure_max !== supplier.maxSupplierCostMicrosUSD ||
        !inputMatches(input, row.owner_id, row.project_id, plan)) return { kind: 'invalid' };
      const call: CapturedCall = { ownerId: row.owner_id, projectId: row.project_id, taskId: row.id, attemptId: row.attempt_id, supplier, maximum: supplier.maxSupplierCostMicrosUSD };
      if (!liabilitiesFit(tx, call.ownerId, 0) || !activeTasksFit(tx, call.ownerId, true) || !activeAttemptsFit(tx, call.ownerId, true) ||
        !timeFits(tx, call.ownerId, 'accepted', approved.maxAcceptedPerWindowGlobal, approved.maxAcceptedPerWindowPerAccount, true) ||
        !timeFits(tx, call.ownerId, 'attempted', approved.maxAttemptsPerWindowGlobal, approved.maxAttemptsPerWindowPerAccount, true)) return { kind: 'invalid' };
      return { kind: 'ready', call };
    } catch { return { kind: 'invalid' }; }
  }
  function protectProvider(provider: (input: ProviderInput) => Promise<ProviderResult>) {
    return async (input: ProviderInput): Promise<ProviderResult> => {
      if (!approved || localFailClosed) return resultDenied();
      let captured: ReturnType<typeof capture>;
      try { captured = repo.transaction(tx => capture(tx, input)); }
      catch { captured = { kind: 'invalid' }; }
      if (captured.kind === 'paused') return resultDenied();
      if (captured.kind !== 'ready') { appendIncident(null, input, 'provider_context_invalid'); return resultDenied(); }
      const result = await provider(input);
      const issue = inspectResponse(result, captured.call);
      if (issue) appendIncident(captured.call, input, issue, result);
      return result;
    };
  }
  return Object.freeze({ beforeAccept, dispatchGuard, pause: (target: BudgetControlTarget, reason: Reason) => control('pause', target, reason),
    resume: (target: BudgetControlTarget, reason: Reason) => control('resume', target, reason), protectProvider, locallyFailClosed: () => localFailClosed });
}
