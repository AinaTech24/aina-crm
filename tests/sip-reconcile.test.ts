/**
 * The SIP book's check against the registrar (2026-11-25, Akshar): the SQL runs against the real schema, and the
 * notes name a refused register, a missing register and SIPs debited but not in the book.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { reconciliationNotes, SIP_REGISTER_NAME_RE, type SipReconciliation } from "@/lib/metrics/sip-reconcile";

const base: SipReconciliation = {
  registers: [
    { source: "cams", lastImportedAt: "2026-11-20T10:00:00Z", lastPeriodEnd: "2026-11-20", refused: 0 },
    { source: "kfintech", lastImportedAt: null, lastPeriodEnd: null, refused: 2 },
  ],
  debited: { sips: 900, amount: 33_000_000 },
  debitedNotInBook: { sips: 120, amount: 6_000_000 },
  inBookNotDebited: { sips: 0, amount: 0 },
};

describe("why the SIP book differs from the registrar", () => {
  it("names a refused register, a register never imported and SIPs debited but not in the book", () => {
    const notes = reconciliationNotes(base, "2026-11-25");
    expect(notes.join("\n")).toMatch(/2 KFintech SIP register files were refused/);
    expect(notes.join("\n")).toMatch(/No KFintech SIP register \(MFSD243\) has ever been imported/);
    expect(notes.join("\n")).toMatch(/120 SIPs debited .* low by about ₹60.00 L/);
  });

  it("says nothing when the book agrees", () => {
    const ok: SipReconciliation = { ...base, registers: [{ ...base.registers[0] }], debitedNotInBook: { sips: 0, amount: 0 } };
    expect(reconciliationNotes(ok, "2026-11-25")).toEqual([]);
  });

  it("flags a stale register", () => {
    const old: SipReconciliation = { ...base, registers: [{ source: "cams", lastImportedAt: "2026-09-01", lastPeriodEnd: null, refused: 0 }], debitedNotInBook: { sips: 0, amount: 0 } };
    expect(reconciliationNotes(old, "2026-11-25")[0]).toMatch(/85 days ago/);
  });

  it("recognises register file names", () => {
    expect(SIP_REGISTER_NAME_RE.test("MFSD243_WBTRN123.zip")).toBe(true);
    expect(SIP_REGISTER_NAME_RE.test("CHB_232184868R49.csv")).toBe(true);
    expect(SIP_REGISTER_NAME_RE.test("MFSD307_WBTRN18484580.zip")).toBe(false);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("the reconciliation query", () => {
  it("runs against the real schema", async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    const { withSystem } = await import("@/db/client");
    const { loadSipReconciliation } = await import("@/lib/metrics/sip-reconcile");
    const r = await withSystem((tx) => loadSipReconciliation(tx, randomUUID()));
    expect(r.registers).toHaveLength(2);
    expect(r.debited.sips).toBe(0);
  });
});
