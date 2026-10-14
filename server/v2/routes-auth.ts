import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AppleAuthService } from './auth-apple.js';
import { AuthError } from './auth-apple.js';
import type { SessionService } from './sessions.js';
import { REFRESH_TTL_MS, SessionError } from './sessions.js';

const MAX_BODY_BYTES = 20 * 1024;
const ACCESS_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_MAX_AGE_SECONDS = Math.floor(REFRESH_TTL_MS / 1000);
const COOKIE_ACCESS = '__Host-form_access';
const COOKIE_REFRESH = '__Host-form_refresh';
const COOKIE_CSRF = '__Host-form_csrf';

export interface AuthRouterOptions {
  apple: AppleAuthService;
  sessions: SessionService;
  /** CORS is opt-in, exact-origin only, and never grants cookie credentials. */
  nativeOrigins?: readonly string[];
  /** Web cookies stay disabled without one explicitly approved HTTPS origin. */
  webOrigin?: string | null;
}
class RouteError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
function plain(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function assertOrigin(value: string, web = false): string {
  if (!value || value === '*' || value === 'null' || /[\s?#]/.test(value)) throw new TypeError('origin must be an exact origin');
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('origin must be an exact origin'); }
  if (url.username || url.password || url.pathname !== '/' && url.pathname !== '' || url.search || url.hash) throw new TypeError('origin must not contain a path or credentials');
  if (web && (url.protocol !== 'https:' || url.origin !== value)) throw new TypeError('web origin must be an exact HTTPS origin');
  if (!web && url.origin !== 'null' && url.origin !== value) throw new TypeError('native origin must be exact');
  if (!web && url.origin === 'null' && !/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]+$/.test(value)) throw new TypeError('native origin must be exact');
  return value;
}
function parseCookies(request: Request): Map<string, string> {
  const raw = request.headers.cookie;
  if (!raw) return new Map();
  if (raw.length > 4096) throw new RouteError('INVALID_REQUEST', 400);
  const result = new Map<string, string>();
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim(), value = part.slice(separator + 1).trim();
    if (result.has(name)) throw new RouteError('INVALID_REQUEST', 400);
    if (name === COOKIE_ACCESS || name === COOKIE_REFRESH || name === COOKIE_CSRF) result.set(name, value);
  }
  return result;
}
function csrfCheck(request: Request, expectedOrigin: string): Map<string, string> {
  if (request.get('origin') !== expectedOrigin || !/^application\/json(?:\s*;|$)/i.test(request.get('content-type') ?? '')) throw new RouteError('CSRF_REJECTED', 403);
  const jar = parseCookies(request), cookie = jar.get(COOKIE_CSRF), header = request.get('X-Form-CSRF');
  if (!cookie || !header || !/^[A-Za-z0-9_-]{43}$/.test(cookie) || !/^[A-Za-z0-9_-]{43}$/.test(header)) throw new RouteError('CSRF_REJECTED', 403);
  const left = Buffer.from(cookie), right = Buffer.from(header);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new RouteError('CSRF_REJECTED', 403);
  return jar;
}
function bearer(request: Request): string | null {
  const authorization = request.get('authorization');
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match?.[1] ?? null;
}
function sessionCookies(accessToken: string, refreshToken: string, csrf: string): string[] {
  return [
    `${COOKIE_ACCESS}=${accessToken}; Path=/; Max-Age=${ACCESS_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
    `${COOKIE_REFRESH}=${refreshToken}; Path=/; Max-Age=${REFRESH_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
    `${COOKIE_CSRF}=${csrf}; Path=/; Max-Age=${REFRESH_MAX_AGE_SECONDS}; Secure; SameSite=Lax`,
  ];
}
function clearCookies(): string[] {
  return [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_CSRF].map(name => `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}
function errorResult(error: unknown) {
  let status = 500, code = 'REQUEST_FAILED';
  if (error instanceof RouteError || error instanceof AuthError || error instanceof SessionError) { status = error.status; code = error.code; }
  else {
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.too.large') { status = 413; code = 'REQUEST_TOO_LARGE'; }
    else if (type === 'entity.parse.failed' || type === 'request.size.invalid') { status = 400; code = 'INVALID_REQUEST'; }
  }
  const messages: Record<string, string> = {
    AUTH_DISABLED: 'Sign in is unavailable.', AUTH_INVALID_REQUEST: 'The request is invalid.', APPLE_TOKEN_INVALID: 'The sign-in response could not be verified.',
    AUTH_CHALLENGE_INVALID: 'The sign-in challenge is invalid or expired.', AUTH_CHALLENGE_REPLAYED: 'The sign-in challenge has already been used.',
    AUTH_ACCOUNT_UNAVAILABLE: 'This account cannot sign in.', AUTH_UPGRADED_IDENTITY: 'Sign in with the account currently in use.',
    SESSION_INVALID: 'The session is invalid. Sign in again.', SESSION_EXPIRED: 'The session has expired. Sign in again.', SESSION_REVOKED: 'The session has been revoked. Sign in again.',
    SESSION_UPGRADED: 'Sign in with the account currently in use.', SESSION_REFRESH_RACE: 'Session refresh is already in progress. Retry with the current session.',
    SESSION_REUSE_DETECTED: 'The session could not be refreshed. Sign in again.', CSRF_REJECTED: 'The request could not be verified.', ORIGIN_NOT_ALLOWED: 'This origin is not allowed.',
    INVALID_REQUEST: 'The request is invalid.', REQUEST_TOO_LARGE: 'The request is too large.',
  };
  return { status, code, message: messages[code] ?? 'The request could not be completed.', retryable: status >= 500, requestId: randomUUID() };
}

/** Explicit auth routes; callers must mount this router deliberately after choosing real owner configuration. */
export function createAuthRouter(options: AuthRouterOptions) {
  const router = express.Router(), nativeOrigins = new Set((options.nativeOrigins ?? []).map(origin => assertOrigin(origin)));
  const webOrigin = options.webOrigin ? assertOrigin(options.webOrigin, true) : null;
  const allowedOrigins = new Set([...nativeOrigins, ...(webOrigin ? [webOrigin] : [])]);
  router.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const origin = request.get('origin');
    if (origin && !allowedOrigins.has(origin)) { next(new RouteError('ORIGIN_NOT_ALLOWED', 403)); return; }
    if (origin) { response.vary('Origin'); response.setHeader('Access-Control-Allow-Origin', origin); }
    if (request.method === 'OPTIONS') {
      if (origin) {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Form-CSRF');
        response.setHeader('Access-Control-Max-Age', '600');
      }
      response.status(204).end(); return;
    }
    next();
  });
  router.use(express.json({ limit: MAX_BODY_BYTES, strict: true }));

  router.post('/auth/challenge', asyncRoute(async (request, response) => {
    if (!exact(request.body, [])) throw new RouteError('INVALID_REQUEST', 400);
    response.status(201).json(options.apple.createChallenge());
  }));

  router.post('/auth/apple', asyncRoute(async (request, response) => {
    if (!exact(request.body, ['challengeId', 'identityToken'])) throw new RouteError('INVALID_REQUEST', 400);
    const result = await options.apple.authenticate(request.body);
    if (webOrigin && request.get('origin') === webOrigin) {
      const csrf = randomBytes(32).toString('base64url');
      response.setHeader('Set-Cookie', sessionCookies(result.accessToken, result.refreshToken, csrf));
      response.status(200).json({ ownerId: result.ownerId, accessExpiresAt: result.accessExpiresAt });
      return;
    }
    response.status(200).json(result);
  }));

  router.post('/session/refresh', asyncRoute(async (request, response) => {
    let refreshToken: string, web = false;
    if (webOrigin && request.get('origin') === webOrigin) {
      const jar = csrfCheck(request, webOrigin);
      if (!exact(request.body, [])) throw new RouteError('INVALID_REQUEST', 400);
      const cookie = jar.get(COOKIE_REFRESH); if (!cookie) throw new SessionError('SESSION_INVALID', 401);
      refreshToken = cookie; web = true;
    } else {
      if (!exact(request.body, ['refreshToken']) || typeof request.body.refreshToken !== 'string') throw new RouteError('INVALID_REQUEST', 400);
      refreshToken = request.body.refreshToken;
    }
    const result = await options.sessions.refresh(refreshToken);
    if (web) {
      const jar = parseCookies(request), csrf = jar.get(COOKIE_CSRF)!;
      response.setHeader('Set-Cookie', sessionCookies(result.accessToken, result.refreshToken, csrf));
      response.status(200).json({ ownerId: result.ownerId, accessExpiresAt: result.accessExpiresAt });
      return;
    }
    response.status(200).json(result);
  }));

  router.post('/session/logout', asyncRoute(async (request, response) => {
    if (!exact(request.body, [])) throw new RouteError('INVALID_REQUEST', 400);
    if (webOrigin && request.get('origin') === webOrigin) {
      const jar = csrfCheck(request, webOrigin), access = jar.get(COOKIE_ACCESS);
      if (!access) throw new SessionError('SESSION_INVALID', 401);
      options.sessions.logout(access);
      response.setHeader('Set-Cookie', clearCookies()); response.status(204).end(); return;
    }
    const access = bearer(request); if (!access) throw new SessionError('SESSION_INVALID', 401);
    options.sessions.logout(access);
    response.status(204).end();
  }));

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    const result = errorResult(error);
    response.status(result.status).set('Cache-Control', 'no-store').json({ code: result.code, message: result.message, retryable: result.retryable, requestId: result.requestId });
  });
  return router;
}
