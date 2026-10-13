import type { DatabaseSync } from 'node:sqlite';
import { WalletRepository } from './wallet-repo.js';

export const UNCERTAIN_RECONCILIATION_MS = 30_000;
export interface RecoveryOptions { db: DatabaseSync; clock?: () => Date }
type InterruptedRow = { id: string; owner_id: string; updated_at: string | null; created_at: string };

function timestamp(clock: () => Date): { iso: string; millis: number } {
  const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('RECOVERY_CLOCK_UNAVAILABLE');
  return { iso: value.toISOString(), millis: value.getTime() };
}

/** Startup reconciliation only. It never asks a provider to repeat or query an unknown request. */
export function createRecoveryService(options: RecoveryOptions) {
  const clock = options.clock ?? (() => new Date()), wallet = new WalletRepository(options.db, { clock: () => timestamp(clock).iso });

  function markInterrupted(): { uncertain: number } {
    return wallet.transaction(tx => {
      const now = timestamp(clock).iso;
      const rows = tx.all<InterruptedRow>("SELECT id,owner_id,updated_at,created_at FROM tasks WHERE status='processing'");
      let uncertain = 0;
      for (const row of rows) {
        const task = tx.run("UPDATE tasks SET status='uncertain',updated_at=? WHERE owner_id=? AND id=? AND status='processing'", now, row.owner_id, row.id);
        if (task.changes !== 1) continue;
        tx.run("UPDATE supplier_attempts SET status='uncertain',ended_at=COALESCE(ended_at,?) WHERE owner_id=? AND task_id=? AND status='started'", now, row.owner_id, row.id);
        // A processing task without an attempt still retains any accepted exposure conservatively.
        tx.run("UPDATE supplier_exposures SET status='uncertain',updated_at=? WHERE owner_id=? AND task_id=? AND status IN ('reserved','started')", now, row.owner_id, row.id);
        uncertain++;
      }
      return { uncertain };
    });
  }

  function reconcileExpired(): { failed: number } {
    const current = timestamp(clock), cutoffMillis = current.millis - UNCERTAIN_RECONCILIATION_MS;
    if (!Number.isFinite(cutoffMillis)) throw new Error('RECOVERY_CLOCK_UNAVAILABLE');
    const cutoff = new Date(cutoffMillis).toISOString();
    return wallet.transaction(tx => {
      const rows = tx.all<InterruptedRow>("SELECT id,owner_id,updated_at,created_at FROM tasks WHERE status='uncertain' AND COALESCE(updated_at,created_at)<=?", cutoff);
      let failed = 0;
      for (const row of rows) {
        const currentRow = tx.get<{ status: string }>('SELECT status FROM tasks WHERE owner_id=? AND id=?', row.owner_id, row.id);
        if (currentRow?.status !== 'uncertain') continue;
        wallet.finalizeTaskInTransaction(tx, { ownerId: row.owner_id, taskId: row.id, outcome: 'failed' });
        tx.run("UPDATE tasks SET safe_error_code='RECOVERY_TIMEOUT' WHERE owner_id=? AND id=? AND status='failed'", row.owner_id, row.id);
        // Unknown and partial costs remain as the original maximum exposure after user refund.
        failed++;
      }
      return { failed };
    });
  }

  return Object.freeze({ markInterrupted, reconcileExpired });
}
