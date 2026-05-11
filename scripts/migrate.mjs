#!/usr/bin/env node
// ─── Migration runner ────────────────────────────────────────────────
// Tiny migration runner: applies *.sql files in migrations/ in name
// order, tracks applied filenames in a _migrations table. No
// rollback — forward-only schema changes are the norm here and a
// bad migration can be fixed with a new file.
//
// Usage:
//   node scripts/migrate.mjs          # applies pending migrations
//   node scripts/migrate.mjs --list   # shows applied + pending
//
// Reads DATABASE_URL from .env.local (Vercel-pulled) or the live env.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

// Best-effort load of .env.local without adding a dotenv dep. The CI
// path always has DATABASE_URL injected by Vercel; this code only
// runs when a developer runs `node scripts/migrate.mjs` locally.
function loadDotEnvLocal() {
  try {
    const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const raw = readFileSync(join(repoRoot, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/i.exec(line);
      if (!match) continue;
      const [, key, val] = match;
      if (process.env[key]) continue; // explicit env wins
      // Strip surrounding quotes if present.
      const trimmed = val.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      process.env[key] = trimmed;
    }
  } catch {
    // No .env.local — fine, env may be injected another way.
  }
}

loadDotEnvLocal();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL not set. Run `npx vercel env pull .env.local` first, or " +
      "set DATABASE_URL in your environment.",
  );
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function ensureLedger() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function appliedMigrations() {
  const rows = await sql`SELECT name FROM _migrations ORDER BY name`;
  return new Set(rows.map((r) => r.name));
}

function pendingMigrations(applied) {
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const dir = join(repoRoot, "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files
    .filter((f) => !applied.has(f))
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf8") }));
}

// Strip `-- …` line comments + split on `;` so the Neon HTTP driver
// (which only accepts one statement per prepared call) can run a
// multi-statement migration file. Statements that end up empty after
// trimming are skipped — they're whitespace between real ones.
function splitStatements(body) {
  const noComments = body
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyOne(name, body) {
  // If a migration partially applies (statement N succeeds, N+1
  // fails), fix the SQL and re-run — the IF NOT EXISTS guards in
  // each statement make our migrations idempotent on retry. The
  // ledger row only goes in after every statement succeeds, so a
  // partial apply doesn't mark the file as done.
  console.log(`→ applying ${name}`);
  const statements = splitStatements(body);
  for (const stmt of statements) {
    await sql.query(stmt);
  }
  await sql`INSERT INTO _migrations (name) VALUES (${name})`;
  console.log(`✓ ${name} (${statements.length} statement${statements.length === 1 ? "" : "s"})`);
}

async function main() {
  await ensureLedger();
  const applied = await appliedMigrations();
  const pending = pendingMigrations(applied);

  if (process.argv.includes("--list")) {
    console.log("Applied:");
    for (const name of [...applied].sort()) console.log("  ", name);
    console.log("Pending:");
    for (const m of pending) console.log("  ", m.name);
    return;
  }

  if (pending.length === 0) {
    console.log("No pending migrations.");
    return;
  }
  for (const m of pending) {
    await applyOne(m.name, m.sql);
  }
  console.log(`Applied ${pending.length} migration(s).`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
