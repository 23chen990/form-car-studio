import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { WalletRepository, type WalletTransaction } from './wallet-repo.js';

export const ACCESS_TTL_MS = 15 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
export const REFRESH_RACE_GRACE_MS = 5_000;
export const RECENT_AUTH_MAX_AGE_MS = 5 * 60_000;

export class SessionError extends Error {
  constructor(readonly code: string, readonly status = 401) { super(code); this.name = 'SessionError'; }
}

export interface SessionPair {
  ownerId: string;
  familyId: string;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}
export interface AccessPrincipal { ownerId: string; sessionId: string; familyId: string; familyCreatedAt: string }
export interface SessionServiceOptions { db: DatabaseSync; clock?: () => Date; id?: () => string; token?: () => string }
export type SessionService = ReturnType<typeof createSessionService>;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').length === 32 && Buffer.from(value, 'base64url').toString('base64url') === value;
const sourceUpgraded = (tx: WalletTransaction, ownerId: string) => !!tx.get("SELECT 1 FROM owner_upgrades WHERE source_owner_id=? AND status='completed' AND completed_at IS NOT NULL", ownerId);
function validTime(clock: () => Date): { iso: string; ms: number } {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new SessionError('SESSION_UNAVAILABLE', 503);
  return { iso: value.toISOString(), ms: value.getTime() };
}
function tokenValue(makeToken: () => string): string {
  const value = makeToken();
  if (!validToken(value)) throw new SessionError('SESSION_UNAVAILABLE', 503);
  return value;
}

/** Called only inside the caller's synchronous write transaction, including Apple identity creation. */
export function issueSessionInTransaction(
  tx: WalletTransaction,
  ownerId: string,
  now: string,
  options: { id?: () => string; token?: () => string; familyId?: string; parentSessionId?: string } = {},
): SessionPair {
  if (!safeId(ownerId) || !Number.isFinite(Date.parse(now))) throw new SessionError('SESSION_UNAVAILABLE', 503);
  const owner = tx.get<{ deleted_at: string | null }>('SELECT deleted_at FROM users WHERE id=?', ownerId);
  if (!owner || owner.deleted_at) throw new SessionError('SESSION_ACCOUNT_UNAVAILABLE', 401);
  if (sourceUpgraded(tx, ownerId)) throw new SessionError('SESSION_UPGRADED', 401);
  const makeId = options.id ?? randomUUID, makeToken = options.token ?? (() => randomBytes(32).toString('base64url'));
  const familyId = options.familyId ?? makeId(), accessToken = tokenValue(makeToken), refreshToken = tokenValue(makeToken);
  const accessId = makeId(), refreshId = makeId(), createdMs = Date.parse(now);
  const accessExpiresAt = new Date(createdMs + ACCESS_TTL_MS).toISOString(), refreshExpiresAt = new Date(createdMs + REFRESH_TTL_MS).toISOString();
  if (options.familyId) {
    const family = tx.get<{ revoked_at: string | null }>('SELECT revoked_at FROM session_families WHERE id=? AND owner_id=?', familyId, ownerId);
    if (!family || family.revoked_at) throw new SessionError('SESSION_REVOKED', 401);
  } else tx.run('INSERT INTO session_families(id,owner_id,created_at) VALUES(?,?,?)', familyId, ownerId, now);
  tx.run(`INSERT INTO v2_sessions(id,owner_id,token_digest,created_at,expires_at,revoked_at,family_id,parent_session_id,token_kind)
    VALUES(?,?,?,?,?,NULL,?,?, 'access')`, accessId, ownerId, hash(accessToken), now, accessExpiresAt, familyId, options.parentSessionId ?? null);
  tx.run(`INSERT INTO v2_sessions(id,owner_id,token_digest,created_at,expires_at,revoked_at,family_id,parent_session_id,token_kind)
    VALUES(?,?,?,?,?,NULL,?,?, 'refresh')`, refreshId, ownerId, hash(refreshToken), now, refreshExpiresAt, familyId, options.parentSessionId ?? null);
  return Object.freeze({ ownerId, familyId, accessToken, accessExpiresAt, refreshToken, refreshExpiresAt });
}

/** Resolve a bearer token only while its session, family and user are currently live. */
export function resolveAccessPrincipal(db: DatabaseSync, token: string, now = new Date()): AccessPrincipal | null {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  if (!validToken(token)) return null;
  const row = db.prepare(`SELECT s.owner_id AS ownerId,s.id AS sessionId,s.family_id AS familyId,f.created_at AS familyCreatedAt,s.expires_at AS expiresAt
    FROM v2_sessions s JOIN session_families f ON f.owner_id=s.owner_id AND f.id=s.family_id
    JOIN users u ON u.id=s.owner_id
    WHERE s.token_digest=? AND s.token_kind='access' AND s.revoked_at IS NULL AND s.expires_at>?
      AND f.revoked_at IS NULL AND u.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM owner_upgrades upgrade WHERE upgrade.source_owner_id=s.owner_id AND upgrade.status='completed' AND upgrade.completed_at IS NOT NULL)`)
    .get(hash(token), now.toISOString()) as (AccessPrincipal & { expiresAt: string }) | undefined;
  if (!row) return null;
  const expiry = Date.parse(row.expiresAt);
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== row.expiresAt || expiry <= now.getTime()) return null;
  return { ownerId: row.ownerId, sessionId: row.sessionId, familyId: row.familyId, familyCreatedAt: row.familyCreatedAt };
}

export function isRecentAuthentication(principal: Pick<AccessPrincipal, 'familyCreatedAt'>, now = new Date(), maxAgeMs = RECENT_AUTH_MAX_AGE_MS): boolean {
  const created = Date.parse(principal.familyCreatedAt), current = now.getTime();
  return Number.isFinite(created) && Number.isFinite(current) && Number.isSafeInteger(maxAgeMs) && maxAgeMs >= 0 && current >= created && current - created <= maxAgeMs;
}

/** Recheck recent authentication and account state inside the sensitive operation's transaction. */
export function assertRecentAuthenticationInTransaction(tx: WalletTransaction, ownerId: string, familyId: string, now: string, maxAgeMs = RECENT_AUTH_MAX_AGE_MS): void {
  const family = tx.get<{ created_at: string; revoked_at: string | null; deleted_at: string | null }>(`SELECT f.created_at,f.revoked_at,u.deleted_at FROM session_families f
    JOIN users u ON u.id=f.owner_id WHERE f.owner_id=? AND f.id=?`, ownerId, familyId);
  if (!family || family.revoked_at || family.deleted_at || sourceUpgraded(tx, ownerId)) throw new SessionError('SESSION_REVOKED', 401);
  if (!isRecentAuthentication({ familyCreatedAt: family.created_at }, new Date(now), maxAgeMs)) throw new SessionError('SESSION_RECENT_AUTH_REQUIRED', 403);
}

export function revokeSessionFamilyInTransaction(tx: WalletTransaction, ownerId: string, familyId: string, revokedAt: string): boolean {
  if (!safeId(ownerId) || !safeId(familyId) || !Number.isFinite(Date.parse(revokedAt))) throw new SessionError('SESSION_UNAVAILABLE', 503);
  const result = tx.run('UPDATE session_families SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=? AND id=?', revokedAt, ownerId, familyId);
  if (result.changes !== 1) return false;
  tx.run('UPDATE v2_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=? AND family_id=?', revokedAt, ownerId, familyId);
  return true;
}

/** F22/F26 use this in their own transaction; source identities remain as provenance, sessions do not. */
export function revokeOwnerSessionsInTransaction(tx: WalletTransaction, ownerId: string, revokedAt: string): number {
  if (!safeId(ownerId) || !Number.isFinite(Date.parse(revokedAt))) throw new SessionError('SESSION_UNAVAILABLE', 503);
  const changed = tx.run('UPDATE session_families SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=?', revokedAt, ownerId).changes;
  tx.run('UPDATE v2_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=?', revokedAt, ownerId);
  return typeof changed === 'bigint' ? Number(changed) : changed;
}

export function createSessionService(options: SessionServiceOptions) {
  const { db } = options, repo = new WalletRepository(db), clock = options.clock ?? (() => new Date());
  const makeId = options.id ?? randomUUID, makeToken = options.token ?? (() => randomBytes(32).toString('base64url'));

  function issue(ownerId: string): SessionPair {
    const time = validTime(clock);
    return repo.transaction(tx => issueSessionInTransaction(tx, ownerId, time.iso, { id: makeId, token: makeToken }));
  }

  function resolveAccess(token: string): AccessPrincipal | null { return resolveAccessPrincipal(db, token, clock()); }

  async function refresh(rawToken: string): Promise<SessionPair> {
    if (!validToken(rawToken)) throw new SessionError('SESSION_INVALID', 401);
    const time = validTime(clock), digest = hash(rawToken);
    const result = repo.transaction(tx => {
      const row = tx.get<{ id: string; owner_id: string; family_id: string; token_kind: string; expires_at: string; revoked_at: string | null; family_created_at: string; family_revoked_at: string | null; deleted_at: string | null }>(`SELECT s.id,s.owner_id,s.family_id,s.token_kind,s.expires_at,s.revoked_at,
        f.created_at AS family_created_at,f.revoked_at AS family_revoked_at,u.deleted_at
        FROM v2_sessions s JOIN session_families f ON f.owner_id=s.owner_id AND f.id=s.family_id
        JOIN users u ON u.id=s.owner_id WHERE s.token_digest=?`, digest);
      if (!row || row.token_kind !== 'refresh') return { kind: 'invalid' as const };
      if (row.deleted_at || sourceUpgraded(tx, row.owner_id)) return { kind: 'upgraded' as const };
      if (row.family_revoked_at) return { kind: 'revoked' as const };
      if (row.revoked_at) {
        const revokedAt = Date.parse(row.revoked_at), elapsed = time.ms - revokedAt;
        if (Number.isFinite(revokedAt) && elapsed >= 0 && elapsed <= REFRESH_RACE_GRACE_MS) return { kind: 'race' as const };
        revokeSessionFamilyInTransaction(tx, row.owner_id, row.family_id, time.iso);
        return { kind: 'reuse' as const };
      }
      const expiry = Date.parse(row.expires_at);
      if (!Number.isFinite(expiry) || expiry <= time.ms) return { kind: 'expired' as const };
      const revoked = tx.run(`UPDATE v2_sessions SET revoked_at=? WHERE id=? AND owner_id=? AND token_kind='refresh' AND revoked_at IS NULL AND expires_at>?`, time.iso, row.id, row.owner_id, time.iso);
      if (revoked.changes !== 1) return { kind: 'race' as const };
      tx.run("UPDATE v2_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=? AND family_id=? AND token_kind='access'", time.iso, row.owner_id, row.family_id);
      const pair = issueSessionInTransaction(tx, row.owner_id, time.iso, { id: makeId, token: makeToken, familyId: row.family_id, parentSessionId: row.id });
      return { kind: 'ok' as const, pair };
    });
    if (result.kind === 'ok') return result.pair;
    if (result.kind === 'race') throw new SessionError('SESSION_REFRESH_RACE', 409);
    if (result.kind === 'reuse') throw new SessionError('SESSION_REUSE_DETECTED', 401);
    if (result.kind === 'upgraded') throw new SessionError('SESSION_UPGRADED', 401);
    if (result.kind === 'revoked') throw new SessionError('SESSION_REVOKED', 401);
    if (result.kind === 'expired') throw new SessionError('SESSION_EXPIRED', 401);
    throw new SessionError('SESSION_INVALID', 401);
  }

  function logout(accessToken: string): void {
    if (!validToken(accessToken)) throw new SessionError('SESSION_INVALID', 401);
    const time = validTime(clock), digest = hash(accessToken);
    const result = repo.transaction(tx => {
      const row = tx.get<{ owner_id: string; family_id: string; token_kind: string }>(`SELECT owner_id,family_id,token_kind FROM v2_sessions
        WHERE token_digest=? AND token_kind='access' AND revoked_at IS NULL`, digest);
      if (!row || sourceUpgraded(tx, row.owner_id)) return false;
      return revokeSessionFamilyInTransaction(tx, row.owner_id, row.family_id, time.iso);
    });
    if (!result) throw new SessionError('SESSION_INVALID', 401);
  }

  return Object.freeze({ issue, refresh, resolveAccess, logout });
}
