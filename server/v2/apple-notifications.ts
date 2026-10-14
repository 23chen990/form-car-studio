import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { PurchaseError } from './purchases.js';
import type { AppleRefundService } from './refunds.js';

const MAX_BODY_BYTES = 64 * 1024;
export interface AppleNotificationRouterOptions { refunds: AppleRefundService }
class NotificationRouteError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
const asyncRoute = (fn: (request: Request, response: Response) => unknown): RequestHandler => (request, response, next) => { Promise.resolve(fn(request, response)).catch(next); };
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function errorResult(error: unknown) {
  let status = 500, code = 'APPLE_NOTIFICATION_FAILED';
  if (error instanceof NotificationRouteError || error instanceof PurchaseError) { status = error.status; code = error.code; }
  else {
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.too.large') { status = 413; code = 'REQUEST_TOO_LARGE'; }
    else if (type === 'entity.parse.failed' || type === 'request.size.invalid') { status = 400; code = 'INVALID_REQUEST'; }
  }
  return { status, code, retryable: status >= 500, requestId: randomUUID() };
}

/** Mount beneath /api/v2 to expose only the canonical POST /api/v2/webhooks/apple callback. */
export function createAppleNotificationRouter(options: AppleNotificationRouterOptions) {
  const router = express.Router();
  router.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(express.json({ limit: MAX_BODY_BYTES, strict: true }));
  router.post('/webhooks/apple', asyncRoute(async (request, response) => {
    if (!exact(request.body, ['signedPayload']) || typeof request.body.signedPayload !== 'string') throw new NotificationRouteError('APPLE_NOTIFICATION_INVALID', 400);
    const result = await options.refunds.processSignedNotification(request.body.signedPayload);
    response.status(200).json({ status: result.status, revokedUnits: result.revokedUnits });
  }));
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    const result = errorResult(error);
    response.status(result.status).set('Cache-Control', 'no-store').json({ code: result.code, message: 'The Apple notification could not be processed.', retryable: result.retryable, requestId: result.requestId });
  });
  return router;
}
