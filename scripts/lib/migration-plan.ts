/**
 * What the migration runner may do, decided from facts only (pure, tested in
 * tests/migration-plan.test.ts). scripts/migrate-all.ts gathers the facts —
 * files on disk, the `_applied_migrations` ledger, the `_migration_runs`
 * attempt log, the reviewed acknowledgements — and obeys the plan.
 *
 * Immutability (Phase 3H): once a file is recorded as applied, its name and
 * checksum are its identity. Any difference BLOCKS — the runner applies
 * nothing and exits non-zero — unless that exact (ledger checksum, file
 * checksum) pair is acknowledged in drizzle/migrations/drift-acknowledged.json,
 * a file that goes through code review. A correction is a NEW migration.
 */
import { createHash } from "node:crypto";

export function migrationChecksum(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export type MigrationFile = { filename: string; checksum: string; noTransaction: boolean };
export type LedgerRow = { filename: string; checksum: string };
/** `_migration_runs`: one row per attempt; status 'started' until it ends. */
export type RunRow = { filename: string; checksum: string; status: "started" | "failed" | "done"; noTransaction: boolean };
export type DriftAck = { filename: string; ledgerChecksum: string; fileChecksum: string; reason: string; approvedBy: string };

export type MigrationPlan = {
  pending: string[];
  drift: Array<{ filename: string; ledgerChecksum: string; fileChecksum: string; acknowledged: boolean }>;
  /** Recorded as applied, but no file of that name on disk (renamed / deleted). */
  missingFiles: string[];
  /** A no-transaction file whose last attempt did not finish: some statements may have run. */
  partial: Array<{ filename: string; resumable: boolean }>;
  /** A transactional file whose last attempt failed or was interrupted: rolled back, safe to retry. */
  rolledBack: string[];
  blockers: string[];
};

export function planMigrations(input: {
  files: MigrationFile[];
  ledger: LedgerRow[];
  runs?: RunRow[];
  acks?: DriftAck[];
  /** Files the operator explicitly allows to resume after a partial attempt. */
  resume?: string[];
}): MigrationPlan {
  const byName = new Map(input.files.map((f) => [f.filename, f]));
  const applied = new Map(input.ledger.map((r) => [r.filename, r.checksum]));
  const acks = input.acks ?? [];
  const resume = new Set(input.resume ?? []);
  const blockers: string[] = [];

  const drift: MigrationPlan["drift"] = [];
  for (const [filename, ledgerChecksum] of applied) {
    const f = byName.get(filename);
    if (!f || f.checksum === ledgerChecksum) continue;
    const acknowledged = acks.some((a) => a.filename === filename && a.ledgerChecksum === ledgerChecksum && a.fileChecksum === f.checksum
      && (a.reason ?? "").trim().length >= 10 && (a.approvedBy ?? "").trim().length > 0);
    drift.push({ filename, ledgerChecksum, fileChecksum: f.checksum, acknowledged });
    if (!acknowledged) blockers.push(`${filename} was applied with checksum ${ledgerChecksum} but the file is now ${f.checksum} — an applied migration may not change; write a new migration`);
  }

  const missingFiles = [...applied.keys()].filter((n) => !byName.has(n)).sort();
  for (const n of missingFiles) blockers.push(`${n} is recorded as applied but no such file exists — an applied migration may not be renamed or removed`);

  // The LAST attempt per file decides.
  const lastRun = new Map<string, RunRow>();
  for (const r of input.runs ?? []) lastRun.set(r.filename, r);
  const partial: MigrationPlan["partial"] = [];
  const rolledBack: string[] = [];
  for (const [filename, r] of lastRun) {
    if (applied.has(filename) || r.status === "done") continue;
    if (r.noTransaction) {
      const resumable = resume.has(filename);
      partial.push({ filename, resumable });
      if (!resumable) blockers.push(`${filename} (no-transaction) was partly applied by an attempt that did not finish — inspect the database, then re-run with --resume ${filename}`);
    } else {
      rolledBack.push(filename);
    }
  }

  const pending = input.files.filter((f) => !applied.has(f.filename)).map((f) => f.filename).sort();
  return { pending, drift, missingFiles, partial, rolledBack, blockers };
}
