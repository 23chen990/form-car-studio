#!/usr/bin/env node
import { migrateLegacyDatabase, formatMigrationResult } from "../server/v2/migrate.ts";

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const inputPath = value("--input");
if (!inputPath || args.includes("--help")) {
  console.error("Usage: node --import tsx tools/migrate-form.mjs --input <legacy.sqlite> [--backup <backup.sqlite>] [--apply --output <isolated-v2.sqlite>] [--fail-after before-commit]");
  process.exit(inputPath ? 0 : 2);
}
try {
  const result = migrateLegacyDatabase({
    inputPath,
    backupPath: value("--backup"),
    outputPath: value("--output"),
    apply: args.includes("--apply"),
    failAfter: value("--fail-after"),
  });
  console.log(formatMigrationResult(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
