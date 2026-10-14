#!/usr/bin/env node
/**
 * CI guard for the DB job: with a database, a test admin and Redis provided,
 * NO test may be skipped — a skipped security or posting test would read as
 * green while never having run. The one exception is the EMERGENCY drill,
 * which halts every firm in the database and so runs alone in its own step
 * (`npm run test:emergency`).
 *
 *   node scripts/ci/assert-no-db-skips.mjs <vitest json report>
 */
import fs from "node:fs";

const RUNS_ALONE = new Set(["tests/rta-emergency-drill-db.test.ts"]);
const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error(`✗ vitest JSON report not found: ${file ?? "(none given)"}`);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(file, "utf8"));
let passed = 0, failed = 0, skipped = 0, allowed = 0;
const offenders = [];
for (const f of report.testResults ?? []) {
  const rel = String(f.name).replace(/^.*?(tests\/)/, "$1");
  for (const t of f.assertionResults ?? []) {
    if (t.status === "passed") passed++;
    else if (t.status === "failed") failed++;
    else {
      skipped++;
      if (RUNS_ALONE.has(rel)) allowed++;
      else offenders.push(`${rel} › ${t.fullName}`);
    }
  }
}
console.log(`[db-tests] passed ${passed} · failed ${failed} · skipped ${skipped} (${allowed} run alone in their own step)`);
if (offenders.length) {
  console.error(`✗ ${offenders.length} test(s) skipped although the database, test admin and Redis are provided:`);
  for (const o of offenders) console.error(`    ${o}`);
  process.exit(1);
}
if (failed) process.exit(1);
console.log("✓ no DB-backed test was skipped");
