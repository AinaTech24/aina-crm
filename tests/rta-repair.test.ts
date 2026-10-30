/**
 * The one-off repair of transactions stored before the 29 Oct 2026 import
 * fixes (scripts/repair-rta-transactions.ts): which folio a damaged row is
 * re-pointed to, and which purchase a stored reversal cancels.
 */
import { describe, expect, it } from "vitest";
import { chooseFolioFor, matchReversals, type FolioRef, type RepairTxn } from "@/lib/rta/repair";

describe("chooseFolioFor — the row's own folio", () => {
  const f = (id: string, folioNumber: string, amcCode: string, investorId: string | null): FolioRef => ({ id, folioNumber, amcCode, investorId });

  it("one folio with that number: it, whatever its AMC spelling", () => {
    expect(chooseFolioFor({ folioNumber: "123/45", amcCode: "118", investorId: "a" }, [f("x", "12345", "RMF", "a")])).toBe("x");
  });
  it("several: the row's AMC, then the row's client", () => {
    const c = [f("x", "123", "P", "a"), f("y", "123", "H", "b")];
    expect(chooseFolioFor({ folioNumber: "123", amcCode: "H", investorId: "a" }, c)).toBe("y");
    expect(chooseFolioFor({ folioNumber: "123", amcCode: "Z", investorId: "b" }, c)).toBe("y");
  });
  it("still unclear, or no such folio: left alone", () => {
    const c = [f("x", "123", "P", "a"), f("y", "123", "H", "a")];
    expect(chooseFolioFor({ folioNumber: "123", amcCode: "Z", investorId: "a" }, c)).toBeNull();
    expect(chooseFolioFor({ folioNumber: "999", amcCode: "P", investorId: "a" }, c)).toBeNull();
  });
});

describe("matchReversals — the purchase a reversal cancels", () => {
  const t = (id: string, date: string, units = 10, amount = 500, key = "F1|S1|sip"): RepairTxn => ({ id, key, date, units, amount });

  it("pairs with the latest matching purchase on or before it, within 120 days", () => {
    const m = matchReversals([t("r", "2026-08-05")], [t("o1", "2026-07-05"), t("o2", "2026-08-01"), t("o3", "2026-08-10")]);
    expect(m.get("r")).toBe("o2");
  });
  it("never cancels one purchase twice, nor a later one", () => {
    const m = matchReversals([t("r1", "2026-08-05"), t("r2", "2026-08-06")], [t("o1", "2026-08-01"), t("o9", "2026-08-20")]);
    expect(m.get("r1")).toBe("o1");
    expect(m.has("r2")).toBe(false);
  });
  it("needs the same folio/scheme/type, units and amount, and the window", () => {
    expect(matchReversals([t("r", "2026-08-05")], [t("o", "2026-08-01", 10.5)]).size).toBe(0);
    expect(matchReversals([t("r", "2026-08-05")], [t("o", "2026-08-01", 10, 520)]).size).toBe(0);
    expect(matchReversals([t("r", "2026-08-05")], [t("o", "2026-08-01", 10, 500, "F2|S1|sip")]).size).toBe(0);
    expect(matchReversals([t("r", "2026-08-05")], [t("o", "2026-03-01")]).size).toBe(0);
    expect(matchReversals([t("r", "2026-08-05")], [t("o", "2026-08-01", 10.0004, 500.6)]).get("r")).toBe("o");
  });
});
