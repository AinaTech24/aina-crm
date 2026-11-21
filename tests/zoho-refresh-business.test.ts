import { describe, expect, it } from "vitest";
import { oldFingerprint, plannedFingerprint, zohoLineNotes, zohoSchemeName } from "@/lib/imports/zoho/refresh-business";
import type { PlannedLine } from "@/lib/imports/zoho/business";

const planned = (over: Partial<PlannedLine> = {}): PlannedLine => ({
  schemeName: "HDFC Mid Cap Fund - Growth Plan",
  txnType: "redemption",
  typeLabel: null,
  amount: 420173,
  assetClass: "equity",
  fromSchemeName: null,
  fromAssetClass: null,
  frequency: null,
  sipDate: null,
  notes: null,
  rtaNotApplicable: null,
  sourceType: "Equity",
  sourceKind: "Redemption",
  ...over,
});

const old = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  entry_id: "e1",
  scheme_code: null,
  scheme_name: "HDFC Mid Cap Fund - Growth Plan",
  amc_name: null,
  asset_category: null,
  asset_class: "equity",
  txn_type: "redemption",
  type_label: null,
  source_type: "Equity",
  source_kind: "Redemption",
  amount: "420173.00",
  notes: null,
  folio_no: null,
  from_scheme_code: null,
  from_scheme_name: null,
  from_asset_class: null,
  ...over,
});

describe("Zoho business refresh — change detection", () => {
  it("reads the Zoho name a mapped line keeps in its notes", () => {
    const mapped = { scheme_name: "HDFC MID CAP FUND - REGULAR PLAN - GROWTH", notes: "Zoho: HDFC Mid Cap Fund - Growth Plan · All units" };
    expect(zohoSchemeName(mapped)).toBe("HDFC Mid Cap Fund - Growth Plan");
    expect(zohoLineNotes(mapped.notes)).toBe("All units");
    expect(zohoSchemeName({ scheme_name: "X", notes: null })).toBe("X");
  });

  it("an unchanged line, mapped to the Scheme Master or not, is unchanged", () => {
    expect(oldFingerprint([old()])).toBe(plannedFingerprint([planned()]));
    const mapped = old({ scheme_code: "123", scheme_name: "HDFC MID CAP FUND - REGULAR PLAN - GROWTH", notes: "Zoho: HDFC Mid Cap Fund - Growth Plan" });
    expect(oldFingerprint([mapped])).toBe(plannedFingerprint([planned()]));
  });

  it("an amount typed in later is a change", () => {
    expect(oldFingerprint([old({ amount: "0.00" })])).not.toBe(plannedFingerprint([planned()]));
  });

  it("a line added in Zoho is a change", () => {
    expect(oldFingerprint([old()])).not.toBe(plannedFingerprint([planned(), planned({ amount: 5000 })]));
  });
});
