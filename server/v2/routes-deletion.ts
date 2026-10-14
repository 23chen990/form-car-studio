import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { resolveAccessPrincipal } from './sessions.js';
import { createDeletionService, type DeletionJournal } from './deletion.js';

export type DeletionRouterOptions = { db: DatabaseSync; journal: DeletionJournal; clock?: () => Date };
class RouteError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
function token(req: Request) { return /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') ?? '')?.[1] ?? null; }
function confirmed(body: unknown, expected: string) {
  return !!body && typeof body === 'object' && !Array.isArray(body) && Reflect.ownKeys(body).length === 1 && Object.hasOwn(body, 'confirmation') && (body as { confirmation?: unknown }).confirmation === expected;
}
function result(error: unknown) {
  const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : 'REQUEST_FAILED';
  const status = code === 'AUTH_REQUIRED' || code.startsWith('SESSION_REVOKED') ? 401 : code === 'SESSION_RECENT_AUTH_REQUIRED' ? 403 : code === 'PROJECT_NOT_FOUND' || code === 'DELETION_NOT_FOUND' ? 404 : code === 'DELETION_STATUS_INVALID' ? 503 : code.includes('INVALID') ? 400 : 503;
  const message = code === 'SESSION_RECENT_AUTH_REQUIRED' ? 'Sign in again before deleting your account.' : code === 'PROJECT_NOT_FOUND' ? 'Project not found.' : code === 'AUTH_REQUIRED' ? 'Sign in is required.' : 'The deletion request could not be completed.';
  return { status, body: { code, message, retryable: status >= 500, requestId: randomUUID() } };
}

/** F26 endpoints are intentionally unmounted until F32 supplies the reviewed deployment configuration. */
export function createDeletionRouter(options: DeletionRouterOptions) {
  const router = express.Router(), service = createDeletionService(options), json = express.json({ limit: 4096, strict: true }), clock = options.clock ?? (() => new Date());
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  const principal = (req: Request) => {
    const bearer = token(req); if (!bearer) throw new RouteError('AUTH_REQUIRED', 401);
    const found = resolveAccessPrincipal(options.db, bearer, clock()); if (!found) throw new RouteError('AUTH_REQUIRED', 401); return found;
  };
  router.delete('/account', json, asyncRoute(async (req, res) => {
    if (!confirmed(req.body, 'DELETE_ACCOUNT')) throw new RouteError('INVALID_CONFIRMATION', 400);
    const accepted = service.deleteAccount(principal(req));
    res.status(202).json({ ...accepted, message: 'Deletion has started. New work is blocked; required retention and older backup cleanup remain pending.' });
  }));
  router.delete('/projects/:projectId', json, asyncRoute(async (req, res) => {
    if (!confirmed(req.body, 'DELETE_PROJECT')) throw new RouteError('INVALID_CONFIRMATION', 400);
    const id = Array.isArray(req.params.projectId) ? req.params.projectId[0] ?? '' : req.params.projectId ?? '';
    const accepted = service.deleteProject(principal(req), id);
    res.status(202).json({ ...accepted, message: 'Deletion has started. New work on this project is blocked; older backup cleanup is not confirmed.' });
  }));
  router.get('/deletion/:id', asyncRoute(async (req, res) => {
    const actor = principal(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] ?? '' : req.params.id ?? '';
    const found = service.status(actor.ownerId, id);
    if (!found) throw new RouteError('DELETION_NOT_FOUND', 404);
    res.json(found);
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const mapped = result(error); res.status(mapped.status).set('Cache-Control', 'private, no-store').json(mapped.body);
  });
  return router;
}
