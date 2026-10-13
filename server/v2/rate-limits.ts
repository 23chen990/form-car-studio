import type { WalletTransaction } from './wallet-repo.js';

export type WindowSource = 'accepted' | 'attempted';
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function windowStart(now: Date, windowMs: number): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 31 * 24 * 60 * 60 * 1000) throw new Error('INVALID_RATE_WINDOW');
  const start = now.getTime() - windowMs;
  if (!Number.isSafeInteger(start)) throw new Error('INVALID_RATE_WINDOW');
  return new Date(start).toISOString();
}

/** Counts durable reservations or every attempted upstream call in the rolling window. */
export function countWindow(tx: WalletTransaction, source: WindowSource, since: string, ownerId?: string): number {
  if (source !== 'accepted' && source !== 'attempted' || typeof since !== 'string' || !Number.isFinite(Date.parse(since)) || ownerId !== undefined && !safeId(ownerId)) throw new Error('INVALID_RATE_QUERY');
  const table = source === 'accepted' ? 'supplier_exposures' : 'supplier_attempts';
  const column = source === 'accepted' ? 'created_at' : 'started_at';
  const row = tx.get<{ count: number }>(`SELECT count(*) AS count FROM ${table} WHERE ${column}>=?${ownerId === undefined ? '' : ' AND owner_id=?'}`,
    ...(ownerId === undefined ? [since] : [since, ownerId]));
  if (!row || !Number.isSafeInteger(row.count) || row.count < 0) throw new Error('RATE_COUNT_UNAVAILABLE');
  return row.count;
}
