import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { WalletRepository, type WalletTransaction } from './wallet-repo.js';
import { issueSessionInTransaction, type SessionPair } from './sessions.js';

export const APPLE_ISSUER = 'https://appleid.apple.com';
export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
export const APPLE_CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_IDENTITY_TOKEN_BYTES = 16 * 1024;
const MAX_TOKEN_AGE_MS = 5 * 60_000;
const CLOCK_TOLERANCE_SECONDS = 5;

export interface AppleIdentityTokenPayload extends JWTPayload {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  nonce: string;
  email?: string;
}
export interface AppleChallenge { challengeId: string; nonce: string; expiresAt: string }
export interface AppleAuthenticateRequest { challengeId: string; identityToken: string }
export type AppleAuthService = ReturnType<typeof createAppleAuthService>;
export interface AppleAuthOptions {
  db: DatabaseSync;
  approvedAudiences?: readonly string[];
  /** Test-only/local resolver injection; HTTP requests cannot choose or override a key URL. */
  keyResolver?: JWTVerifyGetKey;
  clock?: () => Date;
  id?: () => string;
  nonce?: () => string;
  sessionToken?: () => string;
}

export class AuthError extends Error {
  constructor(readonly code: string, readonly status = 401) { super(code); this.name = 'AuthError'; }
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const rawNonce = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').length === 32 && Buffer.from(value, 'base64url').toString('base64url') === value;
function currentTime(clock: () => Date): { date: Date; iso: string; ms: number } {
  const date = clock();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new AuthError('AUTH_UNAVAILABLE', 503);
  return { date, iso: date.toISOString(), ms: date.getTime() };
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validateRequest(value: unknown): AppleAuthenticateRequest {
  if (!isRecord(value) || Reflect.ownKeys(value).length !== 2 || !Object.hasOwn(value, 'challengeId') || !Object.hasOwn(value, 'identityToken') ||
      !safeId(value.challengeId) || typeof value.identityToken !== 'string' || value.identityToken.length < 1 || Buffer.byteLength(value.identityToken, 'utf8') > MAX_IDENTITY_TOKEN_BYTES) {
    throw new AuthError('AUTH_INVALID_REQUEST', 400);
  }
  return { challengeId: value.challengeId, identityToken: value.identityToken };
}
function isCompletedUpgrade(tx: WalletTransaction, ownerId: string): boolean {
  return !!tx.get("SELECT 1 FROM owner_upgrades WHERE source_owner_id=? AND status='completed' AND completed_at IS NOT NULL", ownerId);
}

export function createAppleAuthService(options: AppleAuthOptions) {
  const { db } = options, repo = new WalletRepository(db), clock = options.clock ?? (() => new Date());
  const audiences = Object.freeze([...(options.approvedAudiences ?? [])]);
  const configValid = Array.isArray(options.approvedAudiences ?? []) && audiences.length > 0 && audiences.every(value => typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\s\u0000-\u001f]/.test(value)) && new Set(audiences).size === audiences.length;
  const keyResolver = options.keyResolver ?? (configValid ? createRemoteJWKSet(new URL(APPLE_JWKS_URL), { timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 }) : undefined);
  const makeId = options.id ?? randomUUID;
  const makeNonce = options.nonce ?? (() => randomBytes(32).toString('base64url'));
  const makeSessionToken = options.sessionToken ?? (() => randomBytes(32).toString('base64url'));

  function enabledResolver(): JWTVerifyGetKey {
    if (!configValid || !keyResolver) throw new AuthError('AUTH_DISABLED', 503);
    return keyResolver;
  }

  function createChallenge(): AppleChallenge {
    enabledResolver();
    const time = currentTime(clock), nonce = makeNonce(), challengeId = makeId();
    if (!rawNonce(nonce) || !safeId(challengeId)) throw new AuthError('AUTH_UNAVAILABLE', 503);
    const expiresAt = new Date(time.ms + APPLE_CHALLENGE_TTL_MS).toISOString();
    repo.transaction(tx => { tx.run('INSERT INTO auth_challenges(id,nonce_digest,created_at,expires_at) VALUES(?,?,?,?)', challengeId, hash(nonce), time.iso, expiresAt); });
    return Object.freeze({ challengeId, nonce, expiresAt });
  }

  async function authenticate(raw: unknown): Promise<SessionPair> {
    const resolver = enabledResolver();
    const request = validateRequest(raw), verificationTime = currentTime(clock);
    let header: ReturnType<typeof decodeProtectedHeader>;
    try { header = decodeProtectedHeader(request.identityToken); }
    catch { throw new AuthError('APPLE_TOKEN_INVALID', 401); }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length < 1 || header.kid.length > 128 ||
        ['jku', 'jwk', 'x5u', 'x5c'].some(key => Object.hasOwn(header, key))) throw new AuthError('APPLE_TOKEN_INVALID', 401);

    let payload: AppleIdentityTokenPayload;
    try {
      const verified = await jwtVerify(request.identityToken, resolver, {
        issuer: APPLE_ISSUER,
        audience: [...audiences],
        algorithms: ['RS256'],
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'nonce'],
        maxTokenAge: '5m',
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: verificationTime.date,
      });
      payload = verified.payload as AppleIdentityTokenPayload;
    } catch { throw new AuthError('APPLE_TOKEN_INVALID', 401); }

    const afterVerify = currentTime(clock), issuedAt = payload.iat * 1000, expiresAt = payload.exp * 1000;
    if (payload.iss !== APPLE_ISSUER || typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 255 ||
        /[\u0000-\u001f\u007f]/.test(payload.sub) || !rawNonce(payload.nonce) || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
        issuedAt > afterVerify.ms + CLOCK_TOLERANCE_SECONDS * 1000 || afterVerify.ms - issuedAt > MAX_TOKEN_AGE_MS + CLOCK_TOLERANCE_SECONDS * 1000 || expiresAt <= afterVerify.ms) {
      throw new AuthError('APPLE_TOKEN_INVALID', 401);
    }

    const outcome = repo.transaction(tx => {
      const challenge = tx.get<{ nonce_digest: string; expires_at: string; consumed_at: string | null }>('SELECT nonce_digest,expires_at,consumed_at FROM auth_challenges WHERE id=?', request.challengeId);
      if (!challenge) return { kind: 'challenge' as const };
      if (challenge.consumed_at) return { kind: 'replay' as const };
      const now = currentTime(clock);
      if (!Number.isFinite(Date.parse(challenge.expires_at)) || Date.parse(challenge.expires_at) <= now.ms || challenge.nonce_digest !== hash(payload.nonce) || payload.exp * 1000 <= now.ms || payload.iat * 1000 > now.ms + CLOCK_TOLERANCE_SECONDS * 1000) return { kind: 'challenge' as const };
      const consumed = tx.run('UPDATE auth_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? AND nonce_digest=?', now.iso, request.challengeId, now.iso, hash(payload.nonce));
      if (consumed.changes !== 1) return { kind: 'replay' as const };

      const existing = tx.get<{ user_id: string; deleted_at: string | null }>(`SELECT identity.user_id,user.deleted_at FROM identities identity
        LEFT JOIN users user ON user.id=identity.user_id WHERE identity.provider='apple' AND identity.subject=?`, payload.sub);
      let ownerId: string;
      if (existing) {
        if (!existing.deleted_at && !tx.get('SELECT 1 FROM users WHERE id=?', existing.user_id)) return { kind: 'account' as const };
        const user = tx.get<{ deleted_at: string | null }>('SELECT deleted_at FROM users WHERE id=?', existing.user_id);
        if (!user || user.deleted_at) return { kind: 'account' as const };
        if (isCompletedUpgrade(tx, existing.user_id)) return { kind: 'upgraded' as const };
        ownerId = existing.user_id;
      } else {
        ownerId = makeId();
        if (!safeId(ownerId)) throw new AuthError('AUTH_UNAVAILABLE', 503);
        tx.run('INSERT INTO users(id,created_at) VALUES(?,?)', ownerId, now.iso);
        tx.run('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES(?,?,?,?,?)', makeId(), ownerId, 'apple', payload.sub, now.iso);
      }
      const session = issueSessionInTransaction(tx, ownerId, now.iso, { id: makeId, token: makeSessionToken });
      return { kind: 'ok' as const, session };
    });
    if (outcome.kind === 'ok') return outcome.session;
    if (outcome.kind === 'replay') throw new AuthError('AUTH_CHALLENGE_REPLAYED', 409);
    if (outcome.kind === 'account') throw new AuthError('AUTH_ACCOUNT_UNAVAILABLE', 401);
    if (outcome.kind === 'upgraded') throw new AuthError('AUTH_UPGRADED_IDENTITY', 409);
    throw new AuthError('AUTH_CHALLENGE_INVALID', 401);
  }

  return Object.freeze({ createChallenge, authenticate });
}
