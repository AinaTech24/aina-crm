/**
 * The regulatory rules the role dashboards count and colour by — pinned so a
 * refactor can't quietly change what "one more failure cancels this SIP",
 * "13th-month persistency" or "ARN expiring" means.
 */

import { describe, expect, it } from "vitest";
import { failuresInRow, sebiCancelLimit, sipCancelRisk } from "@/lib/sips/cancel-limit";
import { addMonths, persistency, persistencyWindow, type PersistencyPolicy } from "@/lib/insurance/persistency";
import { daysUntil, dscState, expiryBucket, expiryTone, fyStartYearOf } from "@/lib/compliance/credential-deadlines";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe("SEBI SIP auto-cancellation", () => {
  it("allows 3 failures for monthly-or-shorter SIPs and 2 for quarterly and longer", () => {
    for (const f of ["monthly", "weekly", "fortnightly", "daily", null, undefined, "", "unknown"]) expect(sebiCancelLimit(f)).toBe(3);
    for (const f of ["quarterly", "half_yearly", "Half-Yearly", "yearly", "annual", "semi_annual"]) expect(sebiCancelLimit(f)).toBe(2);
  });

  it("counts failures back from the newest attempt until a success", () => {
    expect(failuresInRow([])).toBe(0);
    expect(failuresInRow(["debited", "failed", "failed"])).toBe(0);
    expect(failuresInRow(["failed", "failed", "debited", "failed"])).toBe(2);
    expect(failuresInRow(["failed", "failed", "failed"])).toBe(3);
  });

  it("is critical when the next failure cancels the SIP", () => {
    expect(sipCancelRisk("monthly", 0).level).toBe("none");
    expect(sipCancelRisk("monthly", 1)).toMatchObject({ level: "attention", remaining: 2 });
    expect(sipCancelRisk("monthly", 2)).toMatchObject({ level: "critical", remaining: 1 });
    expect(sipCancelRisk("monthly", 3)).toMatchObject({ level: "critical", remaining: 0 });
    expect(sipCancelRisk("quarterly", 1)).toMatchObject({ level: "critical", remaining: 1 });
  });
});

describe("insurance persistency cohorts", () => {
  it("measured at 30 June 2025, 13th month covers policies issued Jul 2023 – Jun 2024", () => {
    const w = persistencyWindow(d("2025-06-30"), 13);
    expect([iso(w.from), iso(w.to)]).toEqual(["2023-07-01", "2024-06-30"]);
  });

  it("each later month moves the window back a year", () => {
    const w25 = persistencyWindow(d("2025-06-30"), 25);
    expect([iso(w25.from), iso(w25.to)]).toEqual(["2022-07-01", "2023-06-30"]);
    const w61 = persistencyWindow(d("2025-06-30"), 61);
    expect([iso(w61.from), iso(w61.to)]).toEqual(["2019-07-01", "2020-06-30"]);
  });

  it("clamps month ends", () => {
    expect(iso(addMonths(d("2024-01-31"), 1))).toBe("2024-02-29");
    expect(iso(addMonths(d("2024-03-31"), -1))).toBe("2024-02-29");
  });

  it("counts a policy lapsed after its Nth-month premium as persisting", () => {
    const base = { annualPremium: 10_000 };
    const policies: PersistencyPolicy[] = [
      ...Array.from({ length: 8 }, () => ({ ...base, issuedOn: d("2024-01-15"), lapsedOn: null })),
      // lapsed before its 13th-month premium (due 2025-01-15): did not persist
      { ...base, issuedOn: d("2024-01-15"), lapsedOn: d("2024-09-01") },
      // lapsed after it: persisted to month 13
      { ...base, annualPremium: 30_000, issuedOn: d("2024-01-15"), lapsedOn: d("2025-03-01") },
      // outside the cohort window
      { ...base, issuedOn: d("2024-08-01"), lapsedOn: null },
    ];
    const r = persistency(d("2025-06-30"), 13, policies);
    expect(r.cohortCount).toBe(10);
    expect(r.persistedCount).toBe(9);
    expect(r.byCount).toBeCloseTo(90);
    expect(r.byPremium).toBeCloseTo((110_000 / 120_000) * 100);
  });

  it("shows no figure for a small cohort or too many undated lapses", () => {
    const one = [{ issuedOn: d("2024-01-15"), annualPremium: 1, lapsedOn: null }];
    expect(persistency(d("2025-06-30"), 13, one).byCount).toBeNull();

    const many: PersistencyPolicy[] = [
      ...Array.from({ length: 10 }, () => ({ issuedOn: d("2024-01-15"), annualPremium: 1, lapsedOn: null })),
      ...Array.from({ length: 3 }, () => ({ issuedOn: d("2024-01-15"), annualPremium: 1, lapsedOn: null, lapseUndated: true })),
    ];
    const r = persistency(d("2025-06-30"), 13, many);
    expect(r.undated).toBe(3);
    expect(r.byCount).toBeNull();
  });
});

describe("credential deadlines", () => {
  const today = d("2026-09-29");
  it("buckets by days left; an expiry today is still valid", () => {
    expect(expiryBucket(null, today)).toBe("not_recorded");
    expect(expiryBucket(d("2026-09-28"), today)).toBe("expired");
    expect(expiryBucket(d("2026-09-29"), today)).toBe("d30");
    expect(expiryBucket(d("2026-10-29"), today)).toBe("d30");
    expect(expiryBucket(d("2026-10-30"), today)).toBe("d90");
    expect(expiryBucket(d("2027-03-28"), today)).toBe("d180");
    expect(expiryBucket(d("2027-06-01"), today)).toBe("later");
    expect(daysUntil(d("2026-10-29"), today)).toBe(30);
  });

  it("is red only once expired", () => {
    expect(expiryTone("expired")).toBe("red");
    expect(expiryTone("d30")).toBe("amber");
    expect(expiryTone("d90")).toBe("neutral");
    expect(expiryTone("not_recorded")).toBe("neutral");
  });

  it("tracks the self-declaration through due, withheld and forfeited", () => {
    expect(dscState(2026, d("2026-05-10"), today)).toBe("filed");
    expect(dscState(2026, null, d("2026-06-30"))).toBe("due");
    expect(dscState(2026, null, d("2026-07-01"))).toBe("withheld");
    expect(dscState(2026, null, d("2026-09-30"))).toBe("withheld");
    expect(dscState(2026, null, d("2026-10-01"))).toBe("forfeited");
  });

  it("uses the April–March financial year", () => {
    expect(fyStartYearOf(d("2026-03-31"))).toBe(2025);
    expect(fyStartYearOf(d("2026-04-01"))).toBe(2026);
  });
});
