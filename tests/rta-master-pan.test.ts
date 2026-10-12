/**
 * E10 (parser part) — a PAN cell that is not a valid PAN is NO PAN.
 *
 * The CAMS and KFintech master parsers took any non-empty text as the PAN, so
 * placeholder text could become a client key and merge unrelated folios into
 * one client. SYNTHETIC rows; the column names are the ones the parsers match
 * on, nothing more.
 */
import { describe, expect, it } from "vitest";
import { parseRtaRows } from "@/lib/rta";
import { FAKE_PAN, FAKE_PAN_2 } from "./rta-fixtures";

const KFIN_MASTER_HEADER = ["Product Code", "Fund", "Folio", "Investor Name", "PAN Number", "GuardPanNo"];
const KFIN_HOLDINGS_HEADER = ["Product Code", "Fund", "Folio Number", "Investor Name", "PAN", "Balance", "NAV", "AUM"];
const CAMS_HEADER = ["foliochk", "inv_name", "pan_no", "guard_pan", "sch_name", "product", "amc_code", "clos_bal", "rupee_bal"];

// Values that are PAN-SHAPED but invalid (4th letter is not a holder type) must
// not be echoed either.
const BAD_SHAPED = "ABCDE1234F";

describe("KFintech MFSD211", () => {
  const parsed = parseRtaRows([
    KFIN_MASTER_HEADER,
    ["P1", "F1", "9999999/91", "Synthetic One", FAKE_PAN.toLowerCase(), ""],
    ["P1", "F1", "9999999/92", "Synthetic Two", "NA", BAD_SHAPED],
    ["P1", "F1", "9999999/93", "Synthetic Three", "PANEXEMPT", FAKE_PAN_2],
    ["P1", "F1", "9999999/94", "Synthetic Four", BAD_SHAPED, ""],
    ["P1", "F1", "9999999/95", "Synthetic Five", "", ""],
  ]);
  const byFolio = Object.fromEntries(parsed.folios.map((f) => [f.folioNumber, f.investor]));

  it("keeps a valid PAN (upper-cased) and drops invalid ones to null", () => {
    expect(byFolio["9999999/91"].pan).toBe(FAKE_PAN);
    expect(byFolio["9999999/92"].pan).toBeNull();
    expect(byFolio["9999999/93"].pan).toBeNull();
    expect(byFolio["9999999/94"].pan).toBeNull();
    expect(byFolio["9999999/95"].pan).toBeNull();
  });
  it("validates the guardian PAN the same way", () => {
    expect(byFolio["9999999/92"].guardianPan).toBeNull();
    expect(byFolio["9999999/93"].guardianPan).toBe(FAKE_PAN_2);
  });
  it("counts invalid values as missing PAN and warns with counts only", () => {
    expect(parsed.missingPan).toBe(4);
    expect(parsed.warnings).toEqual([
      "3 folios carried a PAN value that is not a valid PAN — treated as no PAN.",
      "1 folio carried a guardian PAN that is not a valid PAN — treated as no guardian PAN.",
    ]);
    expect(parsed.warnings.join(" ")).not.toContain(BAD_SHAPED);
    expect(parsed.warnings.join(" ")).not.toContain("PANEXEMPT");
  });
});

describe("KFintech MFSD203 holdings", () => {
  it("drops an invalid PAN and warns", () => {
    const parsed = parseRtaRows([
      KFIN_HOLDINGS_HEADER,
      ["P1", "F1", "9999999/91", "Synthetic One", "XXXXXXXXXX", "10", "100", "1000"],
      ["P1", "F1", "9999999/92", "Synthetic Two", FAKE_PAN, "10", "100", "1000"],
    ]);
    expect(parsed.kind).toBe("holdings");
    expect(parsed.folios.map((f) => f.investor.pan)).toEqual([null, FAKE_PAN]);
    expect(parsed.warnings).toEqual(["1 folio carried a PAN value that is not a valid PAN — treated as no PAN."]);
  });
});

describe("CAMS statement", () => {
  it("drops invalid PAN / guardian PAN and warns", () => {
    const parsed = parseRtaRows([
      CAMS_HEADER,
      ["9999999/91", "Synthetic One", "N.A.", "", "Synthetic Equity Fund", "S1", "S", "10", "1000"],
      ["9999999/92", "Synthetic Two", FAKE_PAN, "0", "Synthetic Equity Fund", "S1", "S", "10", "1000"],
      ["9999999/93", "Synthetic Minor", "", FAKE_PAN_2, "Synthetic Equity Fund", "S1", "S", "10", "1000"],
    ]);
    expect(parsed.source).toBe("cams");
    const pans = parsed.folios.map((f) => [f.investor.pan, f.investor.guardianPan]);
    expect(pans).toEqual([
      [null, null],
      [FAKE_PAN, null],
      [null, FAKE_PAN_2],
    ]);
    expect(parsed.missingPan).toBe(2);
    expect(parsed.warnings).toEqual([
      "1 folio carried a PAN value that is not a valid PAN — treated as no PAN.",
      "1 folio carried a guardian PAN that is not a valid PAN — treated as no guardian PAN.",
    ]);
  });
});

describe("unrecognised file", () => {
  it("never echoes a PAN from the first row in its warning", () => {
    const parsed = parseRtaRows([["9999999/91", FAKE_PAN, "x", "y"]]);
    expect(parsed.source).toBe("unknown");
    expect(parsed.warnings[0]).not.toContain(FAKE_PAN);
  });
});
