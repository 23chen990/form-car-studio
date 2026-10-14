import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { applyRefundReconciliation, previewRefundReconciliation } from '../server/v2/refunds.ts';
import { WalletRepository } from '../server/v2/wallet-repo.ts';

const MAX_ITEMS = 25;

export function parseReconciliationArgs(argv) {
  const options = { database: undefined, limit: 10, apply: false, cursor: undefined };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--database') options.database = argv[++index];
    else if (token === '--limit') options.limit = Number(argv[++index]);
    else if (token === '--cursor') {
      const cursor = argv[++index];
      if (!cursor || cursor.startsWith('--')) throw new Error('RECONCILIATION_CURSOR_INVALID');
      options.cursor = cursor;
    }
    else if (token === '--apply') options.apply = true;
    else if (token === '--role' || token === '--admin') throw new Error('APPLY_REQUIRES_TRUSTED_AUTHORIZER: CLI role flags are not authorization');
    else throw new Error(`INVALID_ARGUMENT: ${token}`);
  }
  if (typeof options.database !== 'string' || options.database.length < 1) throw new Error('DATABASE_PATH_REQUIRED: provide an existing database path');
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > MAX_ITEMS) throw new Error('RECONCILIATION_LIMIT_INVALID');
  if (options.cursor !== undefined && (typeof options.cursor !== 'string' || options.cursor.length < 1 || options.cursor.length > 2048)) throw new Error('RECONCILIATION_CURSOR_INVALID');
  return options;
}

/** Dependencies are injected only by a trusted operator host; argv cannot supply authorization. */
export function runReconciliationCli(argv, dependencies = {}) {
  const options = parseReconciliationArgs(argv);
  if (options.apply && typeof dependencies.authorize !== 'function') throw new Error('APPLY_REQUIRES_TRUSTED_AUTHORIZER');
  if (!statSync(options.database).isFile()) throw new Error('DATABASE_FILE_REQUIRED: provide an existing database file');
  const db = new DatabaseSync(options.database, options.apply ? {} : { readOnly: true });
  try {
    const result = options.apply
      ? applyRefundReconciliation(db, new WalletRepository(db), { limit: options.limit, cursor: options.cursor, authorize: dependencies.authorize, clock: dependencies.clock, id: dependencies.id })
      : previewRefundReconciliation(db, { limit: options.limit, cursor: options.cursor });
    return { mode: options.apply ? 'apply' : 'dry-run', applied: options.apply, result };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(runReconciliationCli(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'RECONCILIATION_FAILED'}\n`);
    process.exitCode = 1;
  }
}
