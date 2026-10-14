#!/usr/bin/env node
/**
 * CI guard: reject NEW duplicate migration number prefixes.
 *
 * The migrate runner (scripts/migrate-all.ts) applies files by lexicographic
 * filename, so two files sharing a numeric prefix have a non-deterministic
 * apply order on a fresh DB. We can't safely renumber ALREADY-APPLIED history
 * (it would change the applied-checksum ledger and re-run them), so the
 * historical collisions are grandfathered in BASELINE below. Any collision on a
 * prefix NOT in the baseline fails CI — preventing new ambiguity from creeping in.
 *
 * When you intentionally accept a new collision (you shouldn't — just bump the
 * number), add its prefix to BASELINE.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "drizzle", "migrations");

// Prefixes that already collide in committed history (frozen — do not grow).
// The 0131–0161 block was collisions that predate the checker's baseline and
// only surfaced once those migrations were tracked in git; every pair touches
// unrelated tables, so their fresh-DB apply order is immaterial.
// "0001" is deliberately NOT here any more. It was the one collision whose apply
// order actually mattered: 0001_rls_policies.sql sorts before 0001_sleepy_joseph.sql
// ("r" < "s"), so on a FRESH database RLS was applied to tables the schema
// migration had not created yet and `npm run migrate:all` died on the first file.
// That is why CI's "Migrate · RLS coverage" job could never build a database from
// scratch. Renamed to 0001a_rls_policies.sql so it sorts after the schema, which
// is what its own header always said it required. Safe to re-run on an existing
// database: every policy is DROP POLICY IF EXISTS before CREATE POLICY, the
// functions are CREATE OR REPLACE, and all 59 tables in its array were verified
// present in production before the rename.
const BASELINE = new Set([
  "0036", "0037", "0040", "0045", "0047", "0051", "0052", "0053",
  "0054", "0055", "0056", "0057", "0058", "0060", "0061", "0062", "0063",
  "0072", "0073", "0074",
  "0131", "0137", "0144", "0145", "0147", "0148", "0149", "0150", "0151",
  "0160", "0161",
  // 0195_ddq_compliance_registers + 0195_product_coherence. Both are already
  // applied in production, so renumbering either would re-run it against a live
  // database. They touch unrelated tables, so their fresh-DB apply order is
  // immaterial — same rationale as the 0131–0161 block above.
  "0195",
  // 0233_client_type_details (main, 2026-10-12 — auto-deployed, so applied in
  // production) + 0233_rta_staging (the RTA release, locked in
  // checksums.lock.json and its reviewed ledger digest). Renaming either would
  // re-run an applied file or break the release's lock. One adds a column to
  // investors, the other creates the rta_staging_* tables: their fresh-DB order
  // (client_type_details first) is immaterial.
  "0233",
  // 0234_minor_risk_from_guardian (main, 2026-10-13, deployed) + 0234_folio_holders
  // (the RTA release, locked). Same reasoning as 0233: neither can be renamed.
  // One adds triggers and an index on investors, the other creates
  // folio_holders and two nullable investors columns: independent, so the
  // fresh order (folio_holders first) and the upgrade order (minor_risk first,
  // as production applied it) build the same schema — verified.
  "0234",
]);

const files = fs.readdirSync(DIR).filter((f) => /^\d+_.*\.sql$/.test(f));
const byPrefix = new Map();
for (const f of files) {
  const prefix = f.match(/^(\d+)_/)[1];
  (byPrefix.get(prefix) ?? byPrefix.set(prefix, []).get(prefix)).push(f);
}

const newDups = [];
for (const [prefix, group] of byPrefix) {
  if (group.length > 1 && !BASELINE.has(prefix)) newDups.push({ prefix, group });
}

if (newDups.length) {
  console.error("✗ New duplicate migration number prefix(es) found — bump to a unique number:");
  for (const { prefix, group } of newDups) {
    console.error(`  ${prefix}: ${group.join(", ")}`);
  }
  process.exit(1);
}

console.log(`✓ No new duplicate migration prefixes (${files.length} migrations, ${BASELINE.size} grandfathered collisions).`);
