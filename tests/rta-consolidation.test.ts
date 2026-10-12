/**
 * Phase 3E — a KFintech R-coded group is a folio correction only when its
 * figures prove it. Shapes follow the 18 verified October groups (16 SINR,
 * 1 FULR reported in 16 lots, 1 NEWR); values are synthetic.
 */
import { describe, expect, it } from "vitest";
import { isKfinReversalCode, proveFolioConsolidation, type ConsolidationRow } from "@/lib/rta/consolidation";

const row = (folio: string, code: string, units: number, amount: number, scheme = "117EQ"): ConsolidationRow => ({ folio, scheme, code, units, amount });

describe("folio-correction proof", () => {
  it("SIP: original, exact negation, equal re-post", () => {
    const p = proveFolioConsolidation([row("A", "SIN", 10.123, 500), row("A", "SINR", -10.123, -500), row("B", "SIN", 10.123, 500)]);
    expect(p).toMatchObject({ proved: true, fromFolio: "A", toFolio: "B", baseCodes: ["SIN"] });
  });

  it("redemption reported lot by lot: the sums decide, not one row", () => {
    const lots = [[3.1, 150.5], [2.2, 99.25], [4.75, 230]] as const;
    const rows = [
      ...lots.map(([u, a]) => row("A", "FUL", u, a)),
      ...lots.map(([u, a]) => row("A", "FULR", -u, -a)),
      row("B", "FUL", 3.1 + 2.2 + 4.75, 150.5 + 99.25 + 230),
    ];
    expect(proveFolioConsolidation(rows).proved).toBe(true);
  });

  it("is refused when any structural fact fails", () => {
    const cases: Array<[string, ConsolidationRow[]]> = [
      ["no re-post", [row("A", "SIN", 10, 500), row("A", "SINR", -10, -500)]],
      ["re-post differs", [row("A", "SIN", 10, 500), row("A", "SINR", -10, -500), row("B", "SIN", 9, 500)]],
      ["negation not exact", [row("A", "SIN", 10, 500), row("A", "SINR", -10, -499.99), row("B", "SIN", 10, 500)]],
      ["two target folios", [row("A", "SIN", 10, 500), row("A", "SINR", -10, -500), row("B", "SIN", 5, 250), row("C", "SIN", 5, 250)]],
      ["two schemes", [row("A", "SIN", 10, 500), row("A", "SINR", -10, -500), row("B", "SIN", 10, 500, "117DB")]],
      ["positive R row", [row("A", "SIN", 10, 500), row("A", "SINR", 10, 500), row("B", "SIN", 10, 500)]],
      ["no original", [row("A", "SINR", -10, -500), row("B", "SIN", 10, 500)]],
      ["different code re-posted", [row("A", "SIN", 10, 500), row("A", "SINR", -10, -500), row("B", "ADD", 10, 500)]],
      ["missing figure", [row("A", "SIN", 10, 500), { ...row("A", "SINR", -10, -500), units: null }, row("B", "SIN", 10, 500)]],
    ];
    for (const [why, rows] of cases) expect(proveFolioConsolidation(rows).proved, why).toBe(false);
  });

  it("knows R codes only on known base codes", () => {
    expect(isKfinReversalCode("SINR")).toBe(true);
    expect(isKfinReversalCode("FULR")).toBe(true);
    expect(isKfinReversalCode("NEWR")).toBe(true);
    expect(isKfinReversalCode("SIN")).toBe(false);
    expect(isKfinReversalCode("XYZR")).toBe(false);
  });
});
