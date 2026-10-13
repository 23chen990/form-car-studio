import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ConsentCatalog } from './consents.js';
import { PlanError, type PlanConfiguration } from './plans.js';
import { TaskError, createTaskService } from './tasks.js';
import { WalletError } from './wallet-repo.js';

export type TaskActorResolver = (request: Request) => string | null | undefined | Promise<string | null | undefined>;
export interface TasksRouterOptions {
  db: DatabaseSync; actorResolver: TaskActorResolver; consentCatalog?: ConsentCatalog | null;
  config?: PlanConfiguration; getConfig?: () => PlanConfiguration; storageQuotaBytes?: number | null; clock?: () => Date;
}
class RouteError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
function errorResult(error: unknown) {
  let status = 500, code = 'REQUEST_FAILED';
  if (error instanceof RouteError || error instanceof TaskError || error instanceof PlanError) { status = error.status; code = error.code; }
  else if (error instanceof WalletError) {
    code = error.code;
    status = ['INSUFFICIENT_CREDITS', 'TASK_STATE_CONFLICT', 'RESERVATION_STATE_RACE', 'TASK_STATE_RACE'].includes(code) ? 409 : code.includes('TOMBSTONED') ? 404 : 500;
  } else {
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.too.large') { status = 413; code = 'REQUEST_TOO_LARGE'; }
    else if (type === 'entity.parse.failed' || type === 'request.size.invalid') { status = 400; code = 'INVALID_REQUEST'; }
  }
  const messages: Record<string, string> = {
    AUTH_REQUIRED: 'Sign in is required.', INVALID_REQUEST: 'The request is invalid.', PLAN_NOT_FOUND: 'The selected quote is unavailable.', PLAN_EXPIRED: 'The quote has expired. Request a new quote.',
    PLAN_ALREADY_CONFIRMED: 'This quote was already confirmed.', SUBMISSION_CONFLICT: 'This submission key was used for another request.', TASK_NOT_FOUND: 'Task not found.',
    ACTIVE_TASK_EXISTS: 'Another task is already in progress.', INSUFFICIENT_CREDITS: 'There are not enough credits for this task.', CONSENT_INVALID: 'Current consent is required.',
    LIVE_IDENTITY_REQUIRED: 'Sign in with Apple to use live generation.', STORAGE_QUOTA_UNAVAILABLE: 'Project storage is unavailable.', STORAGE_QUOTA_EXCEEDED: 'There is not enough storage for this task.',
    SUPPLIER_COST_UNAVAILABLE: 'Generation is unavailable because its cost cannot be verified.', SUPPLIER_BUDGET_EXCEEDED: 'Generation is temporarily unavailable.',
    SUPPLIER_LIABILITY_UNKNOWN: 'Generation is temporarily unavailable.', SUPPLIER_COST_CAP_BREACHED: 'Generation is temporarily unavailable.', TASK_NOT_CANCELLABLE: 'This task can no longer be cancelled.',
    SOURCE_CHANGED: 'The selected source changed. Request a new quote.', PLAN_CONFIGURATION_CHANGED: 'Editing settings changed. Request a new quote.',
  };
  return { status, code, message: messages[code] ?? 'The request could not be completed.', retryable: status >= 500, requestId: randomUUID() };
}
function param(req: Request, name: string): string { const value = req.params[name]; return Array.isArray(value) ? value[0] ?? '' : value ?? ''; }

/** Explicit F09 route surface. It is intentionally not mounted by the application entrypoint. */
export function createTasksRouter(options: TasksRouterOptions) {
  const router = express.Router(), service = createTaskService(options), resolver = options.actorResolver;
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  const withActor: RequestHandler = asyncRoute(async (req, res, next) => {
    let owner: string | null | undefined = null;
    try { if (typeof resolver === 'function') owner = await resolver(req); } catch { owner = null; }
    if (!owner) { next(new RouteError('AUTH_REQUIRED', 401)); return; }
    res.locals.ownerId = owner; next();
  });
  const json = express.json({ limit: 4096, strict: true });
  router.post('/tasks', withActor, json, asyncRoute(async (req, res) => {
    const result = await service.submit(res.locals.ownerId as string, req.body);
    res.status(result.replayed ? 200 : 202).json(result.task);
  }));
  router.get('/submissions/:submissionId', withActor, asyncRoute(async (req, res) => {
    res.status(200).json(service.readBySubmission(res.locals.ownerId as string, param(req, 'submissionId')));
  }));
  router.get('/tasks/:taskId', withActor, asyncRoute(async (req, res) => {
    res.status(200).json(service.readTask(res.locals.ownerId as string, param(req, 'taskId')));
  }));
  router.post('/tasks/:taskId/cancel', withActor, asyncRoute(async (req, res) => {
    const result = service.cancel(res.locals.ownerId as string, param(req, 'taskId'));
    res.status(200).json(result.task);
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const result = errorResult(error);
    res.status(result.status).set('Cache-Control', 'private, no-store').json({ code: result.code, message: result.message, retryable: result.retryable, requestId: result.requestId });
  });
  return router;
}
