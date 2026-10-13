#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { formatMigrationResult, migrateLegacyDatabase } from "../server/v2/migrate.ts";

const usage = "Usage: node --import tsx tools/migrate-form.mjs --input <legacy.sqlite> [--backup <backup.sqlite>] [--apply --output <isolated-v2.sqlite>] [--fail-after before-commit]";
const values = new Set(["--input", "--backup", "--output", "--fail-after"]);

function exitUsage(message) {
  if (message) console.error(message);
  console.error(usage);
  process.exit(2);
}

function parse(args) {
  const parsed = { apply: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help") return { help: true };
    if (argument === "--apply") { parsed.apply = true; continue; }
    if (!values.has(argument) || index + 1 === args.length || args[index + 1].startsWith("--")) exitUsage(`Invalid argument: ${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = args[++index];
  }
  return parsed;
}

const parsed = parse(process.argv.slice(2));
if (parsed.help) {
  console.log(usage);
  process.exit(0);
}
if (!parsed.input || !existsSync(resolve(parsed.input))) exitUsage("--input must name an existing database");
if (parsed.apply && !parsed.output) exitUsage("--apply requires --output");
if (parsed.failAfter && parsed.failAfter !== "before-commit") exitUsage("--fail-after only accepts before-commit");
try {
  console.log(formatMigrationResult(migrateLegacyDatabase({ inputPath: parsed.input, backupPath: parsed.backup, outputPath: parsed.output, apply: parsed.apply, failAfter: parsed.failAfter })));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
