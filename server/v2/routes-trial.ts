import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ConsentCatalog } from './consents.js';
import { PlanError, type PlanConfiguration } from './plans.js';
import { TaskError } from './tasks.js';
import { TrialError, createTrialService } from './trial.js';
import type { BudgetService } from './budget.js';
import { WalletError } from './wallet-repo.js';

export interface TrialRouterOptions {
  db: DatabaseSync; campaign?: unknown; getCampaign?: () => unknown; budget?: Pick<BudgetService, 'beforeAccept'>;
  consentCatalog?: ConsentCatalog | null; config?: PlanConfiguration; getConfig?: () => PlanConfiguration;
  storageQuotaBytes?: number | null; clock?: () => Date;
}
class RouteError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
function accessToken(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.get('authorization') ?? '');
  return match?.[1] ?? null;
}
function errorResult(error: unknown) {
  let status = 500, code = 'REQUEST_FAILED';
  if (error instanceof RouteError || error instanceof TrialError || error instanceof TaskError || error instanceof PlanError) { status = error.status; code = error.code; }
  else if (error instanceof WalletError) {
    code = error.code; status = ['INSUFFICIENT_CREDITS', 'TASK_STATE_CONFLICT', 'RESERVATION_STATE_RACE', 'TASK_STATE_RACE'].includes(code) ? 409 : 500;
  } else {
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.too.large') { status = 413; code = 'REQUEST_TOO_LARGE'; }
    else if (type === 'entity.parse.failed' || type === 'request.size.invalid') { status = 400; code = 'INVALID_REQUEST'; }
  }
  const messages: Record<string, string> = {
    AUTH_REQUIRED: 'Sign in with Apple is required.', INVALID_REQUEST: 'The request is invalid.', TASK_NOT_FOUND: 'Task not found.',
    PLAN_NOT_FOUND: 'The selected quote is unavailable.', PLAN_EXPIRED: 'The quote has expired. Request a new quote.',
    TRIAL_UNAVAILABLE: 'Trial availability could not be verified.', TRIAL_ALREADY_CLAIMED: 'The first trial has already been claimed.',
    TRIAL_USE_EXISTING_CREDITS: 'Use your existing credits for this generation.', TRIAL_BUDGET_EXHAUSTED: 'Trial availability is currently closed.',
    TRIAL_BUDGET_CLOSED: 'Trial availability could not be verified.', TRIAL_APPLE_IDENTITY_REQUIRED: 'Sign in with Apple to check trial availability.',
    TRIAL_CLAIM_REQUIRED: 'The matching trial claim could not be verified.', ACTIVE_TASK_EXISTS: 'Another task is already in progress.',
    INSUFFICIENT_CREDITS: 'There are not enough credits for this task.', SUPPLIER_BUDGET_EXCEEDED: 'Generation is temporarily unavailable.',
    STORAGE_QUOTA_EXCEEDED: 'There is not enough storage for this task.', CONSENT_INVALID: 'Current consent is required.',
  };
  return { status, code, message: messages[code] ?? 'The request could not be completed.', retryable: status >= 500, requestId: randomUUID() };
}

/** Explicit trial endpoint; it uses F20 bearer sessions and remains unmounted until F32. */
export function createTrialRouter(options: TrialRouterOptions) {
  const router = express.Router(), service = createTrialService(options), json = express.json({ limit: 4096, strict: true });
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  router.get('/trial/availability', asyncRoute(async (req, res) => {
    const token = accessToken(req); if (!token) throw new RouteError('AUTH_REQUIRED', 401);
    res.status(200).json(service.availability(token));
  }));
  router.post('/trial/claim', json, asyncRoute(async (req, res) => {
    const token = accessToken(req); if (!token) throw new RouteError('AUTH_REQUIRED', 401);
    const result = await service.submit(token, req.body);
    res.status(result.replayed ? 200 : 202).json(result.task);
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const result = errorResult(error);
    res.status(result.status).set('Cache-Control', 'private, no-store').json({ code: result.code, message: result.message, retryable: result.retryable, requestId: result.requestId });
  });
  return router;
}
