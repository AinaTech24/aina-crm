/**
 * Phase 3D — dated, per-registrar AUM and the two valuations of a position.
 * Synthetic statements only.
 */
import { describe, expect, it } from "vitest";
import { scopeView, type HoldingStatement } from "@/lib/rta/holdings-snapshot";
import { aumCoverageNote, firmAumHeadline, registrarAumCards, valuePosition, type FolioEvidence } from "@/lib/rta/aum-view";
import { statementCoverage } from "@/lib/finance/statement-coverage";

const AS_OF = "2026-10-08";
const kfin: HoldingStatement = {
  id: "kf", rta: "kfintech", arn: "ARN-1", asOf: "2026-10-07", fullBook: true,
  positions: [
    { amcCode: "117", folioNumber: "9001", schemeCode: "117EQ", units: 100, value: 10000 },
    { amcCode: "117", folioNumber: "9002", schemeCode: "117EQ", units: 0, value: 0 },
    { amcCode: "128", folioNumber: "9003", schemeCode: "128DB", units: 50, value: 5000 },
  ],
};
const cams: HoldingStatement = {
  id: "ca", rta: "cams", arn: "ARN-1", asOf: "2026-10-06", fullBook: true,
  positions: [{ amcCode: "B", folioNumber: "8001", schemeCode: "B12", units: 10, value: 2500 }],
};
const ev = (o: Partial<FolioEvidence>): FolioEvidence => ({ rta: "kfintech", amcCode: "117", folioNumber: "9001", seenOn: "2026-10-05", source: "MFSD201", ...o });
const required = [{ rta: "kfintech", arn: "ARN-1" }, { rta: "cams", arn: "ARN-1" }];

describe("registrar AUM cards", () => {
  it("each registrar × ARN carries its own value, date, age, full-book flag and zero positions", () => {
    const cards = registrarAumCards(scopeView([kfin, cams]), [], AS_OF);
    const k = cards.find((c) => c.rta === "kfintech")!;
    expect(k).toMatchObject({ sourceValue: 15000, asOf: "2026-10-07", ageDays: 1, stale: false, fullBook: true, positions: 3, zeroPositions: 1, amcs: 2 });
    expect(k.label).toMatch(/KFintech · ARN-1 · as of 2026-10-07 \(full book\)/);
  });

  it("a folio other files prove the firm holds, missing from a full-book statement, is a coverage gap", () => {
    const cards = registrarAumCards(scopeView([kfin]), [ev({}), ev({ folioNumber: "9999", source: "MFSD211" }), ev({ folioNumber: "9998", seenOn: "2026-10-08" })], AS_OF);
    // 9001 is listed; 9999 is a gap; 9998 was seen AFTER the statement's date, so it cannot count against it.
    expect(cards[0].coverageGaps).toEqual({ count: 1, sources: { MFSD211: 1 } });
  });

  it("evidence from the other registrar, or another ARN, is not held against a statement", () => {
    const cards = registrarAumCards(scopeView([kfin]), [ev({ rta: "cams", folioNumber: "1" }), ev({ arn: "ARN-2", folioNumber: "2" })], AS_OF);
    expect(cards[0].coverageGaps.count).toBe(0);
  });
});

describe("statements of different dates", () => {
  it("a card built from two partial statements of different dates shows the range, is as stale as its oldest part, and withholds the total", () => {
    const may: HoldingStatement = { ...cams, id: "may", asOf: "2026-05-18", fullBook: false };
    const oct: HoldingStatement = { ...cams, id: "oct", asOf: "2026-10-08", fullBook: false, positions: [{ amcCode: "IF", folioNumber: "8100", schemeCode: "IF1", units: 1, value: 100 }] };
    const [c] = registrarAumCards(scopeView([may, oct]), [], AS_OF);
    expect(c).toMatchObject({ asOf: "2026-10-08", oldestAsOf: "2026-05-18", mixedDates: true, stale: true, ageDays: 143 });
    expect(c.label).toMatch(/2026-05-18 – 2026-10-08 \(mixed dates\)/);
    const h = firmAumHeadline([c], [{ rta: "cams", arn: "ARN-1" }]);
    expect(h.value).toBeNull();
    expect(h.reasons.join(" | ")).toMatch(/combines statements of different dates \(2026-05-18 → 2026-10-08\)/);
  });
});

describe("firm-wide AUM headline", () => {
  it("prints a figure only when every scope is full-book, fresh, gap-free and valued", () => {
    const ok = firmAumHeadline(registrarAumCards(scopeView([kfin, cams]), [], AS_OF), required);
    expect(ok).toEqual({ value: 17500, asOfDates: ["2026-10-06", "2026-10-07"], reasons: [] });
  });

  it("a missing registrar, a partial or stale statement, a gap or an unvalued position each withhold it, with the reason", () => {
    expect(firmAumHeadline(registrarAumCards(scopeView([kfin]), [], AS_OF), required)).toMatchObject({ value: null, reasons: ["no statement for cams/ARN-1"] });
    const partial = firmAumHeadline(registrarAumCards(scopeView([kfin, { ...cams, fullBook: false }]), [], AS_OF), required);
    expect(partial.reasons).toEqual(["cams/ARN-1: only a partial statement"]);
    const stale = firmAumHeadline(registrarAumCards(scopeView([kfin, { ...cams, asOf: "2026-09-01" }]), [], AS_OF), required);
    expect(stale.value).toBeNull();
    expect(stale.reasons[0]).toMatch(/dated 2026-09-01 \(37 days old\) is stale/);
    const gap = firmAumHeadline(registrarAumCards(scopeView([kfin, cams]), [ev({ folioNumber: "9999" })], AS_OF), required);
    expect(gap.reasons).toEqual(["kfintech/ARN-1: 1 folio(s) other files show are missing from the statement"]);
    const unvalued = firmAumHeadline(registrarAumCards(scopeView([kfin, { ...cams, positions: [{ ...cams.positions[0], value: null }] }]), [], AS_OF), required);
    expect(unvalued.reasons).toEqual(["cams/ARN-1: 1 position(s) carry no value"]);
  });
});

describe("one position, two valuations", () => {
  const source = { value: 1000, nav: 10, asOf: "2026-10-07", statementId: "kf" };
  it("keeps the registrar's value and the live valuation side by side, each with its date", () => {
    const v = valuePosition({ units: 100, source }, { nav: 10.5, navDate: "2026-10-08" });
    expect(v.source).toEqual(source);
    expect(v.live).toEqual({ value: 1050, nav: 10.5, navDate: "2026-10-08" });
    expect(v.shown).toEqual({ kind: "live", value: 1050, caption: "at NAV of 2026-10-08" });
  });

  it("a live NAV older than the registrar's statement does not replace it", () => {
    const v = valuePosition({ units: 100, source }, { nav: 9, navDate: "2026-10-01" });
    expect(v.live).toBeNull();
    expect(v.shown).toEqual({ kind: "source", value: 1000, caption: "registrar value as of 2026-10-07" });
  });

  it("no value and no NAV is shown as unknown, never as zero; a nil balance is zero and still a position", () => {
    expect(valuePosition({ units: 5, source: { ...source, value: null } }, null).shown).toEqual({ kind: "none", value: null, caption: "no value stated and no NAV" });
    expect(valuePosition({ units: 0, source: { ...source, value: 0 } }, null)).toMatchObject({ units: 0, shown: { value: 0, caption: "nil balance" } });
  });
});

// ── Phase 3F: the freshness lines on the AUM tile and the client portfolio ──

describe("coverage notes (Phase 3F)", () => {
  const card = (o: Record<string, unknown>) => ({
    rta: "kfintech", arn: "ARN-1", sourceValue: 1, asOf: "2026-10-08", oldestAsOf: "2026-10-08", mixedDates: false, ageDays: 0, stale: false, fullBook: true,
    positions: 1, zeroPositions: 0, unvalued: 0, amcs: 1, coverageGaps: { count: 0, sources: {} }, label: "", ...o,
  }) as any;
  it("quiet when nothing is known; plain when every registrar is full-book and fresh", () => {
    expect(aumCoverageNote([])).toBeNull();
    expect(aumCoverageNote([card({})])).toEqual({ text: "Registrar statements: KFintech 2026-10-08", warn: false });
  });
  it("names a stale, partial, mixed-date CAMS statement and warns", () => {
    const n = aumCoverageNote([card({}), card({ rta: "cams", asOf: "2026-10-08", oldestAsOf: "2026-05-18", mixedDates: true, ageDays: 143, stale: true, fullBook: false, coverageGaps: { count: 3, sources: {} } })]);
    expect(n).toEqual({ text: "Registrar statements: CAMS 2026-05-18–2026-10-08 (partial, mixed dates, 143 days old, 3 folios not listed) · KFintech 2026-10-08", warn: true });
  });
  it("client portfolio: one date, different dates, stale and uncovered holdings; closed holdings ignored", () => {
    const h = (asOf: string | null, units = 1) => ({ netUnits: units, currentValue: units ? 10 : 0, registrar: asOf ? { asOf, report: "X" } : null });
    expect(statementCoverage([h(null)], "2026-10-08")).toBeNull();
    expect(statementCoverage([h("2026-10-08"), h("2026-10-08")], "2026-10-08")).toEqual({ text: "Registrar statement dated 2026-10-08", warn: false });
    expect(statementCoverage([h("2026-05-18"), h("2026-10-08"), h(null), h("2020-01-01", 0)], "2026-10-08")).toEqual({
      text: "Registrar statements dated 2026-05-18 – 2026-10-08 (different dates) · the oldest is 143 days old · 1 holding not on any statement", warn: true,
    });
  });
});
