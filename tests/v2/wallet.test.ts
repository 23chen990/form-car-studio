import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { test } from "node:test";
import { openV2Database } from "../../server/v2/db";
import { WalletRepository, type GrantInput, type WalletTransaction } from "../../server/v2/wallet-repo";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "form-wallet-"));
  const path = join(dir, "wallet.sqlite");
  const db = openV2Database(path);
  const repo = new WalletRepository(db);
  for (const owner of ["owner-a", "owner-b"]) db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run(owner, "2026-01-01T00:00:00Z");
  for (const [id, owner] of [["project-a", "owner-a"], ["project-b", "owner-b"]]) db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run(id, owner, "2026-01-01T00:00:00Z");
  return { db, dir, path, repo };
}

function task(db: ReturnType<typeof openV2Database>, id: string, options: { owner?: string; project?: string; status?: string; units?: number; scope?: string | null } = {}) {
  const owner = options.owner ?? "owner-a";
  const project = options.project ?? (owner === "owner-a" ? "project-a" : "project-b");
  const snapshot = options.scope === null ? null : JSON.stringify({ scope: options.scope ?? "demo" });
  db.prepare("INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,request_snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, owner, project, `submission-${id}`, options.status ?? "queued", options.units ?? 1, snapshot, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
}

function grant(repo: WalletRepository, input: Partial<GrantInput>) {
  const grantInput: GrantInput = { ownerId: "owner-a", kind: "promo", sourceKind: "promo", sourceEventKey: `grant-${Math.random()}`, units: 1, scope: "demo", ...input } as GrantInput;
  return repo.transaction((tx) => repo.grantInTransaction(tx, grantInput));
}

function clean(f: ReturnType<typeof fixture>) {
  f.db.close();
  rmSync(f.dir, { recursive: true, force: true });
}

test("transaction is synchronous, non-nestable, and invalidates escaped contexts", () => {
  const f = fixture();
  try {
    let escaped!: WalletTransaction;
    f.repo.transaction((tx) => { escaped = tx; });
    assert.throws(() => f.repo.transaction(() => f.repo.transaction(() => 1)), /nested|transaction/i);
    if (false) {
      // @ts-expect-error Transaction callbacks must remain synchronous.
      f.repo.transaction(async () => undefined);
    }
    assert.throws(() => f.repo.transaction((async (tx: WalletTransaction) => {
      await Promise.resolve();
      assert.throws(() => tx.run("INSERT INTO users (id,created_at) VALUES ('late','now')"), /active|transaction/i);
    }) as unknown as (tx: WalletTransaction) => unknown), /async|promise/i);
    assert.throws(() => f.repo.reserveTaskInTransaction(escaped, { ownerId: "owner-a", taskId: "none" }), /active|transaction/i);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM users WHERE id='late'").get()?.n, 0);
  } finally { clean(f); }
});

test("async transaction rejection rolls back and late context use does not crash the process", () => {
  const moduleUrl = new URL("../../server/v2/wallet-repo.ts", import.meta.url).href;
  const childSource = `
    import { DatabaseSync } from "node:sqlite";
    import { WalletRepository } from ${JSON.stringify(moduleUrl)};
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE probe (id TEXT PRIMARY KEY)");
    const repo = new WalletRepository(db);
    let escaped;
    try {
      repo.transaction(async tx => {
        escaped = tx;
        await new Promise(resolve => setTimeout(resolve, 0));
        tx.run("INSERT INTO probe VALUES ('late')");
      });
      throw new Error("async callback was accepted");
    } catch (error) {
      if (error.code !== "ASYNC_WALLET_TRANSACTION_FORBIDDEN") throw error;
    }
    if (db.isTransaction) throw new Error("transaction was not rolled back");
    await new Promise(resolve => setTimeout(resolve, 10));
    try { escaped.run("INSERT INTO probe VALUES ('escaped')"); throw new Error("late context was accepted"); }
    catch (error) { if (error.code !== "WALLET_TRANSACTION_REQUIRED") throw error; }
    if (db.prepare("SELECT COUNT(*) AS n FROM probe").get().n !== 0) throw new Error("late write persisted");
    db.close();
    console.log("rollback and late context checks passed");
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childSource], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /rollback and late context checks passed/);
});

test("trusted grants replay exactly once and reject provenance changes", () => {
  const f = fixture();
  try {
    const input = { ownerId: "owner-a", kind: "promo", sourceKind: "promo", sourceEventKey: "campaign:claim-1", units: 3, scope: "demo" } as const satisfies GrantInput;
    const first = grant(f.repo, input);
    const replay = grant(f.repo, input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.lotId, first.lotId);
    assert.throws(() => grant(f.repo, { ...input, units: 4 }), /conflict|source/i);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM credit_lots WHERE owner_id='owner-a'").get()?.n, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ledger_events WHERE event_type='grant'").get()?.n, 1);
    f.db.prepare("DELETE FROM ledger_events WHERE owner_id='owner-a' AND ledger_event_key='grant:campaign:claim-1'").run();
    assert.throws(() => grant(f.repo, input), /ledger/i);
    f.db.prepare("INSERT INTO ledger_events (id,owner_id,ledger_event_key,event_type,units,origin_owner_id,created_at) VALUES (?,?,?,?,?,?,?)")
      .run("corrupt-ledger", "owner-a", "grant:campaign:claim-1", "grant", 3, "owner-a", "2026-01-01T00:00:00Z");
    assert.throws(() => grant(f.repo, input), /ledger/i);
    assert.equal(f.db.prepare("SELECT credit_lot_id FROM ledger_events WHERE id='corrupt-ledger'").get()?.credit_lot_id, null);
  } finally { clean(f); }
});

test("purchased grants require an owned purchase and live scope", () => {
  const f = fixture();
  try {
    f.db.prepare("INSERT INTO purchases (id,owner_id,environment,transaction_id,product_id,created_at) VALUES (?,?,?,?,?,?)").run("purchase-a", "owner-a", "sandbox", "txn-a", "pack", "2026-01-01T00:00:00Z");
    const base = { ownerId: "owner-a", kind: "purchased", sourceKind: "purchase", sourceEventKey: "purchase:txn-a", purchaseId: "purchase-a", units: 5 } as const;
    assert.throws(() => grant(f.repo, { ...base, scope: "demo" }), /purchase|scope|grant/i);
    assert.throws(() => grant(f.repo, { ...base, purchaseId: "purchase-missing", scope: "live" }), /purchase|provenance/i);
    assert.throws(() => grant(f.repo, { ...base, ownerId: "owner-b", scope: "live" }), /purchase|owner/i);
    assert.equal(grant(f.repo, { ...base, scope: "live" }).replayed, false);
  } finally { clean(f); }
});

test("new grants and reservations reject tombstones, while cleanup release remains allowed", () => {
  const f = fixture();
  try {
    grant(f.repo, { sourceEventKey: "seed", units: 2 });
    task(f.db, "task-delete", { scope: "demo" });
    f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-delete" }));
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id='task-delete'").run();
    f.db.prepare("UPDATE projects SET deleted_at='2026-01-02' WHERE id='project-a'").run();
    assert.throws(() => grant(f.repo, { sourceEventKey: "after-delete", projectId: "project-a", units: 1 }), /deleted|tombstone/i);
    assert.throws(() => f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-delete" })), /deleted|tombstone/i);
    f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-delete", outcome: "failed" }));
    task(f.db, "task-no-reserve", { scope: "demo" });
    assert.throws(() => f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-no-reserve" })), /deleted|tombstone/i);
    assert.equal(f.db.prepare("SELECT available_units FROM credit_lots WHERE source_event_key='seed'").get()?.available_units, 2);
    grant(f.repo, { ownerId: "owner-b", sourceEventKey: "seed-owner-b", units: 1 });
    task(f.db, "task-owner-delete", { owner: "owner-b" });
    f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-b", taskId: "task-owner-delete" }));
    f.db.prepare("UPDATE users SET deleted_at='2026-01-03' WHERE id='owner-b'").run();
    assert.throws(() => f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-b", taskId: "task-owner-delete" })), /deleted|tombstone/i);
    f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-b", taskId: "task-owner-delete", outcome: "cancelled" }));
  } finally { clean(f); }
});

test("reserve trusts queued task cost, requires snapshot scope, and uses promo FIFO before paid", () => {
  const f = fixture();
  try {
    f.db.prepare("INSERT INTO purchases (id,owner_id,environment,transaction_id,product_id,created_at) VALUES (?,?,?,?,?,?)").run("purchase-x", "owner-a", "sandbox", "txn-x", "pack", "2020-01-01T00:00:00Z");
    grant(f.repo, { sourceEventKey: "paid-old", kind: "purchased", sourceKind: "purchase", purchaseId: "purchase-x", scope: "live", units: 1 });
    grant(f.repo, { sourceEventKey: "promo-new", units: 1, scope: "live", createdAt: "2026-01-02T00:00:00Z" });
    grant(f.repo, { sourceEventKey: "promo-old", units: 2, scope: "live", createdAt: "2020-01-01T00:00:00Z" });
    task(f.db, "task-cost", { units: 3, scope: "live" });
    f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-cost" }));
    const allocations = f.db.prepare("SELECT lot.source_event_key,allocation.units FROM reservation_allocations allocation JOIN credit_lots lot ON lot.owner_id=allocation.owner_id AND lot.id=allocation.credit_lot_id WHERE allocation.reservation_id=(SELECT id FROM reservations WHERE task_id='task-cost') ORDER BY lot.created_at,lot.id").all() as { source_event_key: string; units: number }[];
    assert.deepEqual(allocations.map((row) => ({ ...row })), [{ source_event_key: "promo-old", units: 2 }, { source_event_key: "promo-new", units: 1 }]);
    f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-cost", outcome: "cancelled" }));
    task(f.db, "task-no-snapshot", { scope: null });
    assert.throws(() => f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-no-snapshot" })), /scope|snapshot/i);
  } finally { clean(f); }
});

test("wallet summary separates available and reserved units without summing ledger rows", () => {
  const f = fixture();
  try {
    grant(f.repo, { sourceEventKey: "summary-grant", units: 3 });
    task(f.db, "summary-task", { units: 1, scope: "demo" });
    f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "summary-task" }));
    assert.deepEqual(f.repo.summary("owner-a", "demo"), {
      scope: "demo", available: { purchased: 0, promo: 2 }, reserved: { purchased: 0, promo: 1 }, spendable: 2, totalReserved: 1,
    });
    f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "summary-task", outcome: "cancelled" }));
    assert.equal(f.repo.summary("owner-a", "demo").spendable, 3);
    assert.equal(f.repo.summary("owner-a", "demo").totalReserved, 0);
  } finally { clean(f); }
});

test("existing reservation replay rejects an explicit changed scope but accepts F03 scope-less rows", () => {
  const f = fixture();
  try {
    grant(f.repo, { sourceEventKey: "scope-replay", units: 1, scope: "demo" });
    task(f.db, "scope-replay-task", { scope: "demo" });
    f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "scope-replay-task" }));
    f.db.prepare("UPDATE tasks SET request_snapshot_json=? WHERE id=?").run(JSON.stringify({ scope: "live" }), "scope-replay-task");
    assert.throws(() => f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "scope-replay-task" })), /scope/i);
    assert.equal(f.db.prepare("SELECT available_units FROM credit_lots WHERE source_event_key='scope-replay'").get()?.available_units, 0);
  } finally { clean(f); }

  const legacy = fixture();
  try {
    legacy.db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,source_kind,source_event_key,revoked_units,scope,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("legacy-lot", "owner-a", "promo", 1, 1, "legacy_import", "legacy-source", 0, "demo", "2020-01-01T00:00:00Z");
    task(legacy.db, "legacy-task", { status: "processing", scope: null });
    legacy.db.prepare("INSERT INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)")
      .run("legacy-reservation", "owner-a", "legacy-task", 1, "reserved", "2020-01-01T00:00:00Z");
    legacy.db.prepare("UPDATE credit_lots SET available_units=0 WHERE id='legacy-lot'").run();
    legacy.db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)")
      .run("owner-a", "legacy-reservation", "legacy-lot", 1);
    const replay = legacy.repo.transaction((tx) => legacy.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "legacy-task" }));
    assert.equal(replay.replayed, true);
    assert.equal(replay.reservationId, "legacy-reservation");
  } finally { clean(legacy); }
});

test("owner-wide unit totals use checked integer addition", () => {
  const f = fixture();
  try {
    grant(f.repo, { sourceEventKey: "max-grant", units: Number.MAX_SAFE_INTEGER });
    assert.throws(() => grant(f.repo, { sourceEventKey: "overflow-grant", units: 1 }), /UNSAFE_WALLET_TOTAL/i);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM credit_lots WHERE owner_id='owner-a'").get()?.n, 1);
  } finally { clean(f); }
});

test("old paid and promo lots do not expire and live credits never fund demo tasks", () => {
  const f = fixture();
  try {
    f.db.prepare("INSERT INTO purchases (id,owner_id,environment,transaction_id,product_id,created_at) VALUES (?,?,?,?,?,?)").run("purchase-old", "owner-a", "production", "txn-old", "pack", "2010-01-01T00:00:00Z");
    grant(f.repo, { kind: "purchased", sourceKind: "purchase", sourceEventKey: "paid-old", purchaseId: "purchase-old", units: 1, scope: "live", createdAt: "2010-01-01T00:00:00Z" });
    grant(f.repo, { sourceEventKey: "promo-old", units: 1, createdAt: "2010-01-01T00:00:00Z" });
    task(f.db, "demo-task", { units: 2, scope: "demo" });
    assert.throws(() => f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "demo-task" })), /insufficient|credits/i);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE task_id='demo-task'").get()?.n, 0);
    f.db.prepare("UPDATE tasks SET status='cancelled' WHERE id='demo-task'").run();
    task(f.db, "demo-old-promo", { scope: "demo" });
    assert.equal(f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "demo-old-promo" })).status, "reserved");
    assert.equal((f.db.prepare("SELECT available_units FROM credit_lots WHERE source_event_key='paid-old'").get() as { available_units: number }).available_units, 1);
    f.db.prepare("INSERT INTO purchases (id,owner_id,environment,transaction_id,product_id,created_at) VALUES (?,?,?,?,?,?)").run("purchase-b", "owner-b", "production", "txn-b", "pack", "2010-01-01T00:00:00Z");
    grant(f.repo, { ownerId: "owner-b", kind: "purchased", sourceKind: "purchase", sourceEventKey: "paid-b", purchaseId: "purchase-b", units: 1, scope: "live", createdAt: "2010-01-01T00:00:00Z" });
    task(f.db, "live-task", { owner: "owner-b", scope: "live" });
    assert.equal(f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-b", taskId: "live-task" })).status, "reserved");
  } finally { clean(f); }
});

test("task settlement is exact replay only and a settled task cannot be released", () => {
  const f = fixture();
  try {
    grant(f.repo, { sourceEventKey: "settle-grant", units: 2 });
    task(f.db, "task-settle", { scope: "demo" });
    f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-settle" }));
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id='task-settle'").run();
    const settled = f.repo.transaction((tx) => {
      tx.run("INSERT INTO versions (id,owner_id,project_id,task_id,recipe_json,created_at) VALUES (?,?,?,?,?,?)", "version-settle", "owner-a", "project-a", "task-settle", "{}", "2026-01-01T00:00:00Z");
      return f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-settle", outcome: "succeeded", resultVersionId: "version-settle" });
    });
    assert.equal(settled.replayed, false);
    assert.equal(f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-settle", outcome: "succeeded", resultVersionId: "version-settle" })).replayed, true);
    f.db.prepare("UPDATE tasks SET user_cost_units=3 WHERE id='task-settle'").run();
    assert.throws(() => f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-settle", outcome: "succeeded", resultVersionId: "version-settle" })), /cost|units/i);
    assert.throws(() => f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-settle", outcome: "failed" })), /terminal|conflict/i);
    assert.equal(f.db.prepare("SELECT status FROM reservations WHERE task_id='task-settle'").get()?.status, "settled");
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ledger_events WHERE task_id='task-settle' AND event_type='settle'").get()?.n, 1);
  } finally { clean(f); }
});

test("release restores only non-revoked units and runs after reservation terminal CAS", () => {
  const f = fixture();
  try {
    grant(f.repo, { sourceEventKey: "release-grant", units: 4 });
    task(f.db, "task-release", { units: 4, scope: "demo" });
    f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-release" }));
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id='task-release'").run();
    f.db.prepare("UPDATE reservation_allocations SET revoked_units=1 WHERE reservation_id=(SELECT id FROM reservations WHERE task_id='task-release')").run();
    f.db.prepare("UPDATE credit_lots SET revoked_units=1 WHERE source_event_key='release-grant'").run();
    const released = f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-release", outcome: "failed" }));
    assert.equal(released.returnedUnits, 3, JSON.stringify(released));
    assert.equal((f.db.prepare("SELECT credit_returned FROM tasks WHERE id='task-release'").get() as { credit_returned: number }).credit_returned, 1);
    const restored = f.db.prepare("SELECT available_units,revoked_units FROM credit_lots WHERE source_event_key='release-grant'").get() as { available_units: number; revoked_units: number };
    assert.equal(restored.available_units, 3);
    assert.equal(restored.revoked_units, 1);
    const replay = f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-release", outcome: "failed" }));
    assert.equal(replay.replayed, true);
    assert.equal(replay.returnedUnits, 3);
    assert.throws(() => f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-release", outcome: "cancelled" })), /terminal|conflict/i);
  } finally { clean(f); }
});

test("fully revoked reservation releases zero and leaves credit_returned clear", () => {
  const f = fixture();
  try {
    grant(f.repo, { sourceEventKey: "revoked-grant", units: 1 });
    task(f.db, "revoked-task", { scope: "demo" });
    f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "revoked-task" }));
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id='revoked-task'").run();
    f.db.prepare("UPDATE reservation_allocations SET revoked_units=1 WHERE reservation_id=(SELECT id FROM reservations WHERE task_id='revoked-task')").run();
    f.db.prepare("UPDATE credit_lots SET revoked_units=1 WHERE source_event_key='revoked-grant'").run();
    const result = f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "revoked-task", outcome: "failed" }));
    assert.equal(result.returnedUnits, 0);
    assert.equal((f.db.prepare("SELECT credit_returned FROM tasks WHERE id='revoked-task'").get() as { credit_returned: number }).credit_returned, 0);
    assert.equal((f.db.prepare("SELECT available_units FROM credit_lots WHERE source_event_key='revoked-grant'").get() as { available_units: number }).available_units, 0);
  } finally { clean(f); }
});

test("queued cancellation releases once and success requires an owned task version", () => {
  const f = fixture();
  try {
    grant(f.repo, { sourceEventKey: "cancel-grant", units: 2 });
    task(f.db, "task-cancel", { scope: "demo" });
    f.repo.transaction((tx) => f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-cancel" }));
    assert.throws(() => f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-cancel", outcome: "succeeded", resultVersionId: "missing" })), /version|state/i);
    assert.equal(f.repo.transaction((tx) => f.repo.finalizeTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-cancel", outcome: "cancelled" })).replayed, false);
    assert.equal(f.db.prepare("SELECT status FROM tasks WHERE id='task-cancel'").get()?.status, "cancelled");
    assert.equal(f.db.prepare("SELECT status FROM reservations WHERE task_id='task-cancel'").get()?.status, "released");
  } finally { clean(f); }
});

test("shared transaction rolls back task, reservation, allocations, and ledger together", () => {
  const f = fixture();
  try {
    grant(f.repo, { sourceEventKey: "rollback-grant", units: 2 });
    assert.throws(() => f.repo.transaction((tx) => {
      tx.run("INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,request_snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?)", "task-rollback", "owner-a", "project-a", "submission-rollback", "queued", 1, '{"scope":"demo"}', "now");
      f.repo.reserveTaskInTransaction(tx, { ownerId: "owner-a", taskId: "task-rollback" });
      throw new Error("abort transaction");
    }), /abort transaction/);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE id='task-rollback'").get()?.n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE task_id='task-rollback'").get()?.n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ledger_events WHERE task_id='task-rollback'").get()?.n, 0);
    assert.equal(f.db.prepare("SELECT available_units FROM credit_lots WHERE source_event_key='rollback-grant'").get()?.available_units, 2);
  } finally { clean(f); }
});

test("two SQLite connections race complete reserve transactions without overdraw", async () => {
  const f = fixture();
  try {
    grant(f.repo, { sourceEventKey: "race-grant", units: 1 });
    const workerSource = `
      const { parentPort, workerData } = require('node:worker_threads');
      let db;
      (async () => {
        const { DatabaseSync } = require('node:sqlite');
        const { WalletRepository } = require(workerData.walletPath);
        db = new DatabaseSync(workerData.path);
        db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        const repo = new WalletRepository(db);
        parentPort.postMessage('ready');
        await new Promise(resolve => parentPort.once('message', message => { if (message === 'go') resolve(message); }));
        parentPort.postMessage('go-received');
        repo.transaction(tx => {
          tx.run('INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,request_snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?)', workerData.taskId, 'owner-a', 'project-a', 'submission-' + workerData.taskId, 'queued', 1, '{"scope":"demo"}', '2026-01-01T00:00:00Z');
          repo.reserveTaskInTransaction(tx, { ownerId: 'owner-a', taskId: workerData.taskId });
        });
        parentPort.postMessage('reserved');
      })().catch(error => parentPort.postMessage('failed:' + (error.code || error.message) + ':' + String(error.stack))).finally(() => { db?.close(); parentPort.close(); });
    `;
    const worker = (taskId: string) => new Worker(workerSource, { eval: true, workerData: {
      path: f.path,
      walletPath: fileURLToPath(new URL("../../server/v2/wallet-repo.ts", import.meta.url)),
      taskId,
    } });
    const workers = [worker("race-a"), worker("race-b")];
    const messages: string[] = [];
    const ready = new Set<Worker>();
    await Promise.all(workers.map((w) => new Promise<void>((resolve, reject) => {
      w.on("message", (message) => {
        messages.push(message);
        if (message === "ready") {
          ready.add(w);
          if (ready.size === workers.length) for (const worker of workers) worker.postMessage("go");
        } else if (message !== "go-received") resolve();
      });
      w.on("error", reject);
      w.on("exit", (code) => { if (code !== 0) reject(new Error(`worker exit ${code}`)); });
    })));
    assert.equal(messages.filter((m) => m === "ready").length, 2);
    assert.equal(messages.filter((m) => m === "go-received").length, 2);
    assert.equal(messages.filter((m) => m === "reserved").length, 1, JSON.stringify(messages));
    assert.equal(messages.filter((m) => m.startsWith("failed:")).length, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE id IN ('race-a','race-b')").get()?.n, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status='reserved'").get()?.n, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ledger_events WHERE event_type='reserve'").get()?.n, 1);
    assert.equal(f.db.prepare("SELECT available_units FROM credit_lots WHERE source_event_key='race-grant'").get()?.available_units, 0);
  } finally { clean(f); }
});
