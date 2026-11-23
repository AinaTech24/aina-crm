/**
 * The statement's Holdings table: a long scheme name used to be cut at a fixed width and ran into the
 * right-aligned Units figure (Ahpal, 2026-11-23). Names now wrap inside the room left of the widest Units
 * figure, never past it.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { renderValuationStatementPdf, wrapName } from "@/lib/finance/valuation-pdf";

async function font() {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
}

describe("wrapName", () => {
  it("keeps a short name on one line", async () => {
    const f = await font();
    expect(wrapName("HDFC Small Cap Fund", f, 9, 236, 2)).toEqual(["HDFC Small Cap Fund"]);
  });

  it("wraps a long name onto two lines, each inside the width, losing no words", async () => {
    const f = await font();
    const name = "ICICI Prudential Ultra Short to Short Term Fund - Growth Option Regular";
    const lines = wrapName(name, f, 9, 200, 2);
    expect(lines.length).toBe(2);
    for (const l of lines) expect(f.widthOfTextAtSize(l, 9)).toBeLessThanOrEqual(200);
    expect(lines.join(" ")).toBe(name);
  });

  it("cuts the last line with '...' when even two lines are not enough, and never exceeds the width", async () => {
    const f = await font();
    const lines = wrapName("A Really Long Scheme Name That Goes On And On And On And On Through A Third Line Of Text Fund", f, 9, 150, 2);
    expect(lines.length).toBe(2);
    expect(lines[1].endsWith("...")).toBe(true);
    for (const l of lines) expect(f.widthOfTextAtSize(l, 9)).toBeLessThanOrEqual(150);
  });

  it("cuts one unbroken word wider than a line", async () => {
    const f = await font();
    const lines = wrapName("X".repeat(200), f, 9, 100, 2);
    expect(lines.length).toBe(1);
    expect(f.widthOfTextAtSize(lines[0], 9)).toBeLessThanOrEqual(100);
  });

  it("an empty name is one empty line", async () => {
    expect(await wrapName("", await font(), 9, 100, 2)).toEqual([""]);
  });
});

describe("renderValuationStatementPdf", () => {
  it("renders long names and very large unit counts, and paginates a long list", async () => {
    const h = (i: number) => ({
      schemeName: `Scheme ${i} - A Rather Long Fund Name Regular Plan Growth Option Direct Style`,
      schemeCode: String(i), netUnits: i % 2 ? 1000000.123 : 12.5, latestNav: 50, currentValue: 625 + i, priced: true,
    });
    const v = {
      holdings: Array.from({ length: 60 }, (_, i) => h(i)), currentValue: 1, pricedInvested: null, gain: null, absoluteReturn: null, xirr: null,
      asOf: "2026-11-20", unpricedSchemes: 0, dataQuality: { pricedHoldings: 60, openHoldings: 60, unknownCostHoldings: 0, undatedPrices: 0, closedPositions: 0 },
    } as never;
    const buf = await renderValuationStatementPdf({
      valuation: v, investor: { name: "A Client", pan: "ABCDE1234F" }, brand: { legalName: "Firm", arn: "1" }, generatedAt: "2026-11-23T10:00:00Z",
    });
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
