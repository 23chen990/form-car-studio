import type { DatabaseSync } from 'node:sqlite';
import { createBudgetService, type BudgetService } from './budget.js';
import type { ConsentCatalog } from './consents.js';
import { workspaceTrialProgramsInTransaction } from './merge.js';
import type { PlanConfiguration } from './plans.js';
import { resolveAccessPrincipal, type AccessPrincipal } from './sessions.js';
import { createTaskService, TaskError, type SafeTaskDTO } from './tasks.js';
import type { BeforeAcceptHook, TaskServiceOptions, TrustedFundingHook } from './tasks.js';
import { WalletRepository, type WalletTransaction } from './wallet-repo.js';

export const FIRST_TRIAL_PROGRAM_ID = 'first-trial-v1';
export interface TrialCampaignPolicy {
  approved: boolean; enabled: boolean; campaignId: string; units: number; budgetUnits: number; maxSupplierCostMicrosUSD: number;
}
export const DEFAULT_TRIAL_POLICY: Readonly<TrialCampaignPolicy> = Object.freeze({
  approved: false, enabled: false, campaignId: 'disabled', units: 0, budgetUnits: 0, maxSupplierCostMicrosUSD: 0,
});
export type TrialAvailability =
  | { status: 'disabled' }
  | { status: 'apple_required' }
  | { status: 'already_claimed' }
  | { status: 'use_existing_balance' }
  | { status: 'budget_closed' }
  | { status: 'check_required' }
  | { status: 'unavailable' };
export interface TrialServiceOptions {
  db: DatabaseSync; campaign?: unknown; getCampaign?: () => unknown; budget?: Pick<BudgetService, 'beforeAccept'>;
  consentCatalog?: ConsentCatalog | null; config?: PlanConfiguration; getConfig?: () => PlanConfiguration;
  storageQuotaBytes?: number | null; clock?: () => Date; id?: () => string;
}

export class TrialError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'TrialError'; }
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function validPolicy(value: unknown): value is TrialCampaignPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const record = value as Record<string, unknown>, keys = ['approved', 'enabled', 'campaignId', 'units', 'budgetUnits', 'maxSupplierCostMicrosUSD'];
  return Reflect.ownKeys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key)) &&
    typeof record.approved === 'boolean' && typeof record.enabled === 'boolean' && typeof record.campaignId === 'string' && TOKEN.test(record.campaignId) &&
    Number.isSafeInteger(record.units) && (record.units === 0 || record.units === 1) &&
    Number.isSafeInteger(record.budgetUnits) && Number(record.budgetUnits) >= 0 && Number(record.budgetUnits) <= 1_000_000 &&
    Number.isSafeInteger(record.maxSupplierCostMicrosUSD) && Number(record.maxSupplierCostMicrosUSD) >= 0 && Number(record.maxSupplierCostMicrosUSD) <= 1_000_000_000;
}
function openPolicy(value: unknown): TrialCampaignPolicy | null {
  if (!validPolicy(value) || !value.approved || !value.enabled || value.units !== 1 || value.budgetUnits < 1 || value.maxSupplierCostMicrosUSD < 1) return null;
  return Object.freeze({ ...value });
}
function readNow(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TrialError('TRIAL_UNAVAILABLE', 503);
  return new Date(value.getTime());
}
function activePrincipal(db: DatabaseSync, token: string, clock: () => Date): AccessPrincipal {
  if (typeof token !== 'string' || token.length > 128) throw new TaskError('AUTH_REQUIRED', 401);
  const principal = resolveAccessPrincipal(db, token, readNow(clock));
  if (!principal) throw new TaskError('AUTH_REQUIRED', 401);
  return principal;
}
function recheckPrincipal(db: DatabaseSync, token: string, expected: AccessPrincipal, clock: () => Date): void {
  const current = resolveAccessPrincipal(db, token, readNow(clock));
  if (!current || current.ownerId !== expected.ownerId || current.sessionId !== expected.sessionId || current.familyId !== expected.familyId) throw new TaskError('AUTH_REQUIRED', 401);
}
function liveAvailableUnits(tx: WalletTransaction, ownerId: string): number {
  const row = tx.get<{ units: number }>("SELECT COALESCE(SUM(available_units),0) AS units FROM credit_lots WHERE owner_id=? AND scope='live'", ownerId);
  if (!row || !Number.isSafeInteger(row.units) || row.units < 0) throw new TrialError('TRIAL_UNAVAILABLE', 503);
  return row.units;
}
function claimedUnits(tx: WalletTransaction): number {
  const row = tx.get<{ units: number }>('SELECT COALESCE(SUM(units),0) AS units FROM trial_claims WHERE trial_program_id=?', FIRST_TRIAL_PROGRAM_ID);
  if (!row || !Number.isSafeInteger(row.units) || row.units < 0) throw new TrialError('TRIAL_UNAVAILABLE', 503);
  return row.units;
}
function requireLiveIdentity(tx: WalletTransaction, ownerId: string): void {
  if (!tx.get("SELECT 1 AS present FROM identities WHERE user_id=? AND provider='apple' LIMIT 1", ownerId)) throw new TrialError('TRIAL_APPLE_IDENTITY_REQUIRED', 403);
}
function assertCampaignOwner(tx: WalletTransaction, ownerId: string, policy: TrialCampaignPolicy): TrialAvailability['status'] {
  requireLiveIdentity(tx, ownerId);
  if (workspaceTrialProgramsInTransaction(tx, ownerId).length > 0) return 'already_claimed';
  if (liveAvailableUnits(tx, ownerId) > 0) return 'use_existing_balance';
  if (claimedUnits(tx) >= policy.budgetUnits) return 'budget_closed';
  return 'check_required';
}

export function createTrialService(options: TrialServiceOptions) {
  const { db } = options, repo = new WalletRepository(db), clock = options.clock ?? (() => new Date());
  const budget = options.budget ?? createBudgetService({ db, clock });
  const currentPolicy = () => {
    try { return openPolicy(options.getCampaign ? options.getCampaign() : options.campaign ?? DEFAULT_TRIAL_POLICY); }
    catch { return null; }
  };

  function availability(accessToken: string): TrialAvailability {
    const principal = activePrincipal(db, accessToken, clock), policy = currentPolicy();
    if (!policy) return { status: 'disabled' };
    try {
      return repo.transaction(tx => {
        recheckPrincipal(db, accessToken, principal, clock);
        try { return { status: assertCampaignOwner(tx, principal.ownerId, policy) }; }
        catch (error) { if (error instanceof TrialError && error.code === 'TRIAL_APPLE_IDENTITY_REQUIRED') return { status: 'apple_required' }; throw error; }
      });
    } catch { return { status: 'unavailable' }; }
  }

  async function submit(accessToken: string, raw: unknown): Promise<{ task: SafeTaskDTO; replayed: boolean }> {
    const principal = activePrincipal(db, accessToken, clock);
    let acceptedPolicy: TrialCampaignPolicy | null = null;
    const beforeAccept: BeforeAcceptHook = context => {
      recheckPrincipal(db, accessToken, principal, clock);
      const policy = currentPolicy();
      if (!policy) throw new TrialError('TRIAL_UNAVAILABLE');
      const { plan, ownerId, maximumExposureMicrosUSD } = context, semantic = plan.semantic, supplier = semantic.supplier;
      if (ownerId !== principal.ownerId || semantic.ownerId !== ownerId || semantic.walletScope !== 'live' || semantic.executionMode !== 'live' ||
        semantic.projectSource.kind === 'licensed_demo' || semantic.userCostUnits !== 1 || !supplier ||
        supplier.maxSupplierCostMicrosUSD !== policy.maxSupplierCostMicrosUSD || maximumExposureMicrosUSD !== policy.maxSupplierCostMicrosUSD ||
        semantic.supplierExposureMicrosUSD !== policy.maxSupplierCostMicrosUSD) throw new TrialError('TRIAL_UNAVAILABLE');
      const eligibility = assertCampaignOwner(context.tx, ownerId, policy);
      if (eligibility === 'already_claimed') throw new TrialError('TRIAL_ALREADY_CLAIMED');
      if (eligibility === 'use_existing_balance') throw new TrialError('TRIAL_USE_EXISTING_CREDITS');
      if (eligibility === 'budget_closed') throw new TrialError('TRIAL_BUDGET_EXHAUSTED');
      const decision: unknown = budget.beforeAccept(context);
      if (decision !== true) {
        if (decision && (typeof decision === 'object' || typeof decision === 'function')) void Promise.resolve(decision).catch(() => {});
        throw new TrialError('TRIAL_BUDGET_CLOSED', 503);
      }
      acceptedPolicy = policy;
      return true;
    };
    const trustedFunding: TrustedFundingHook = ({ tx, ownerId, taskId }) => {
      if (!acceptedPolicy || ownerId !== principal.ownerId) throw new TrialError('TRIAL_UNAVAILABLE');
      const task = tx.get<{ created_at: string }>('SELECT created_at FROM tasks WHERE id=? AND owner_id=? AND status=\'queued\'', taskId, ownerId);
      if (!task) throw new TrialError('TRIAL_UNAVAILABLE', 503);
      tx.run('INSERT INTO trial_claims(id,user_id,trial_program_id,units,created_at) VALUES (?,?,?,?,?)', taskId, ownerId, FIRST_TRIAL_PROGRAM_ID, 1, task.created_at);
      return { sourceEventKey: `trial:${FIRST_TRIAL_PROGRAM_ID}:${ownerId}` };
    };
    const taskOptions: TaskServiceOptions = { db, consentCatalog: options.consentCatalog, config: options.config, getConfig: options.getConfig,
      storageQuotaBytes: options.storageQuotaBytes, clock, id: options.id, beforeAccept, trustedFunding };
    const result = await createTaskService(taskOptions).submit(principal.ownerId, raw);
    repo.transaction(tx => {
      recheckPrincipal(db, accessToken, principal, clock);
      const marker = tx.get<{ user_id: string; trial_program_id: string; units: number }>('SELECT user_id,trial_program_id,units FROM trial_claims WHERE id=?', result.task.id);
      if (!marker || marker.user_id !== principal.ownerId || marker.trial_program_id !== FIRST_TRIAL_PROGRAM_ID || marker.units !== 1) throw new TrialError('TRIAL_CLAIM_REQUIRED');
    });
    return result;
  }

  return Object.freeze({ availability, submit });
}
