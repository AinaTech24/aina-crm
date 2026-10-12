#!/usr/bin/env node
/**
 * CI guard (Phase 3H): committed migrations are immutable.
 *
 * drizzle/migrations/checksums.lock.json records the checksum of every
 * migration file (same algorithm as scripts/lib/migration-plan.ts). This fails
 * when a locked file's content changes, when a locked file disappears or is
 * renamed, or when a new file is not yet locked.
 *
 *   node scripts/check-migration-lock.mjs          verify (CI)
 *   node scripts/check-migration-lock.mjs --add    lock NEW files only — never
 *                                                  rewrites an existing entry
 *
 * A database that already applied a file is guarded separately by the runner
 * (migrate:all blocks on a ledger checksum mismatch). This catches the edit
 * before it reaches any database.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DIR = path.join(process.cwd(), "drizzle", "migrations");
const LOCK = path.join(DIR, "checksums.lock.json");
const ADD = process.argv.includes("--add");

const sum = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const lock = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, "utf8")) : {};

const changed = [];
const unlocked = [];
for (const f of files) {
  const cs = sum(fs.readFileSync(path.join(DIR, f), "utf8"));
  if (!(f in lock)) unlocked.push([f, cs]);
  else if (lock[f] !== cs) changed.push(`${f} (locked ${lock[f]}, now ${cs})`);
}
const missing = Object.keys(lock).filter((f) => !files.includes(f));

if (ADD) {
  if (changed.length || missing.length) {
    console.error("✗ --add refuses while a locked migration is changed or missing:");
    for (const c of [...changed, ...missing]) console.error(`    ${c}`);
    process.exit(1);
  }
  for (const [f, cs] of unlocked) lock[f] = cs;
  const sorted = Object.fromEntries(Object.keys(lock).sort().map((k) => [k, lock[k]]));
  fs.writeFileSync(LOCK, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`✓ locked ${unlocked.length} new migration(s); ${Object.keys(sorted).length} in the lock.`);
  process.exit(0);
}

let failed = false;
if (changed.length) {
  failed = true;
  console.error("✗ A committed migration changed. Applied migrations are immutable — revert it and write a NEW migration:");
  for (const c of changed) console.error(`    ~ ${c}`);
}
if (missing.length) {
  failed = true;
  console.error("✗ A locked migration was removed or renamed:");
  for (const m of missing) console.error(`    - ${m}`);
}
if (unlocked.length) {
  failed = true;
  console.error("✗ New migration(s) not in checksums.lock.json — run `node scripts/check-migration-lock.mjs --add` and commit the lock:");
  for (const [f] of unlocked) console.error(`    + ${f}`);
}
if (failed) process.exit(1);
console.log(`✓ ${files.length} migrations match checksums.lock.json.`);
