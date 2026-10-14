import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { PurchaseError, type ApplePurchaseService } from './purchases.js';

const MAX_BODY_BYTES = 64 * 1024;
export interface PurchaseRouterOptions { purchases: ApplePurchaseService }
class RouteError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
const asyncRoute = (fn: (request: Request, response: Response, next: NextFunction) => unknown): RequestHandler => (request, response, next) => { Promise.resolve(fn(request, response, next)).catch(next); };
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function bearer(request: Request): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.get('authorization') ?? '');
  if (!match) throw new RouteError('AUTH_REQUIRED', 401);
  return match[1];
}
function errorResult(error: unknown) {
  let status = 500, code = 'REQUEST_FAILED';
  if (error instanceof RouteError || error instanceof PurchaseError) { status = error.status; code = error.code; }
  else {
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.too.large') { status = 413; code = 'REQUEST_TOO_LARGE'; }
    else if (type === 'entity.parse.failed' || type === 'request.size.invalid') { status = 400; code = 'INVALID_REQUEST'; }
  }
  return { status, code, retryable: status >= 500, requestId: randomUUID() };
}

/** Explicit purchase routes; callers must mount this router deliberately after setting owner facts. */
export function createPurchaseRouter(options: PurchaseRouterOptions) {
  const router = express.Router();
  router.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(express.json({ limit: MAX_BODY_BYTES, strict: true }));
  router.get('/catalog', (_request, response) => response.status(200).json(options.purchases.catalog()));
  router.post('/purchases/verify', asyncRoute(async (request, response) => {
    if (!exact(request.body, ['signedTransaction', 'environment'])) throw new RouteError('PURCHASE_REQUEST_INVALID', 400);
    const result = await options.purchases.confirm(bearer(request), request.body);
    response.status(200).json(result);
  }));
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    const result = errorResult(error);
    response.status(result.status).set('Cache-Control', 'no-store').json({ code: result.code, message: 'The purchase request could not be completed.', retryable: result.retryable, requestId: result.requestId });
  });
  return router;
}
