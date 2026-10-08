/**
 * Phase 3H — migration immutability: what the runner may do, from facts only.
 */
import { describe, expect, it } from "vitest";
import { migrationChecksum, planMigrations } from "../scripts/lib/migration-plan";

const f = (filename: string, checksum: string, noTransaction = false) => ({ filename, checksum, noTransaction });

describe("planMigrations", () => {
  it("applies only files not in the ledger, in order", () => {
    const p = planMigrations({ files: [f("0002_b.sql", "b"), f("0001_a.sql", "a"), f("0003_c.sql", "c")], ledger: [{ filename: "0001_a.sql", checksum: "a" }] });
    expect(p.pending).toEqual(["0002_b.sql", "0003_c.sql"]);
    expect(p.blockers).toEqual([]);
  });

  it("an applied file whose content changed BLOCKS (no warning-only path)", () => {
    const p = planMigrations({ files: [f("0001_a.sql", "new")], ledger: [{ filename: "0001_a.sql", checksum: "old" }] });
    expect(p.blockers).toHaveLength(1);
    expect(p.blockers[0]).toMatch(/may not change; write a new migration/);
    expect(p.drift).toEqual([{ filename: "0001_a.sql", ledgerChecksum: "old", fileChecksum: "new", acknowledged: false }]);
  });

  it("only an exact, reasoned, approved acknowledgement lets known drift through", () => {
    const base = { files: [f("0001_a.sql", "new")], ledger: [{ filename: "0001_a.sql", checksum: "old" }] };
    const ok = { filename: "0001_a.sql", ledgerChecksum: "old", fileChecksum: "new", reason: "comment-only edit, reviewed", approvedBy: "owner" };
    expect(planMigrations({ ...base, acks: [ok] }).blockers).toEqual([]);
    expect(planMigrations({ ...base, acks: [{ ...ok, fileChecksum: "other" }] }).blockers).toHaveLength(1); // a later edit is not covered
    expect(planMigrations({ ...base, acks: [{ ...ok, reason: "ok" }] }).blockers).toHaveLength(1);
    expect(planMigrations({ ...base, acks: [{ ...ok, approvedBy: " " }] }).blockers).toHaveLength(1);
  });

  it("an applied file that was renamed or deleted BLOCKS", () => {
    const p = planMigrations({ files: [f("0002_renamed.sql", "a")], ledger: [{ filename: "0002_a.sql", checksum: "a" }] });
    expect(p.missingFiles).toEqual(["0002_a.sql"]);
    expect(p.blockers[0]).toMatch(/renamed or removed/);
    expect(p.pending).toEqual(["0002_renamed.sql"]);
  });

  it("a no-transaction file whose attempt did not finish is PARTIAL and blocks until --resume", () => {
    const facts = { files: [f("0005_idx.sql", "x", true)], ledger: [], runs: [{ filename: "0005_idx.sql", checksum: "x", status: "started" as const, noTransaction: true }] };
    const p = planMigrations(facts);
    expect(p.partial).toEqual([{ filename: "0005_idx.sql", resumable: false }]);
    expect(p.blockers[0]).toMatch(/--resume 0005_idx.sql/);
    const r = planMigrations({ ...facts, resume: ["0005_idx.sql"] });
    expect(r.blockers).toEqual([]);
    expect(r.pending).toEqual(["0005_idx.sql"]);
  });

  it("a transactional file that failed was rolled back: pending again, not a blocker", () => {
    const p = planMigrations({ files: [f("0006_t.sql", "t")], ledger: [], runs: [{ filename: "0006_t.sql", checksum: "t", status: "failed", noTransaction: false }] });
    expect(p.rolledBack).toEqual(["0006_t.sql"]);
    expect(p.blockers).toEqual([]);
    expect(p.pending).toEqual(["0006_t.sql"]);
  });

  it("the last attempt decides; a finished one clears an earlier failure", () => {
    const p = planMigrations({ files: [f("0005_idx.sql", "x", true)], ledger: [{ filename: "0005_idx.sql", checksum: "x" }], runs: [
      { filename: "0005_idx.sql", checksum: "x", status: "failed", noTransaction: true },
      { filename: "0005_idx.sql", checksum: "x", status: "done", noTransaction: true },
    ] });
    expect(p.partial).toEqual([]);
    expect(p.blockers).toEqual([]);
  });

  it("checksum is the runner's (sha256, 16 hex)", () => {
    expect(migrationChecksum("SELECT 1;")).toMatch(/^[0-9a-f]{16}$/);
    expect(migrationChecksum("SELECT 1;")).not.toBe(migrationChecksum("SELECT 1; "));
  });
});
