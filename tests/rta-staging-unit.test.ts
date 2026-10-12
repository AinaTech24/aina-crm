/**
 * RTA staging (Phase 3B) — the pure parts: classification, layouts, grouping,
 * tolerances, keyed tokens and the feature flag. No database.
 *
 * Layouts are the REAL headers of the four verified mailbacks
 * (tests/rta-real-layouts.ts); every value is synthetic.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { classifyCams, classifyKfintech, CLASS_META, postable } from "@/lib/rta/staging/classify";
import { identifyLayout, normalizeRows, readDecimal, rejectionReasonText, LAYOUTS, type NormRow } from "@/lib/rta/staging/layouts";
import { groupTransactions, lotArithmetic, sumReported } from "@/lib/rta/staging/group";
import { panToken, keyedDigest, PanTokenKeyMissingError } from "@/lib/rta/staging/pan-token";
import { rtaPipelineMode } from "@/lib/rta/staging/config";
import { MFSD201_HEADER, MFSD211_HEADER, R2_HEADER, R9_HEADER, P } from "./rta-real-layouts";

const T = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

beforeAll(() => {
  process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

// ── Fixture rows in the real column order ───────────────────────────────────
const row = (header: string[], v: Record<string, string>) => {
  for (const k of Object.keys(v)) if (!header.includes(k)) throw new Error(`not a column: ${k}`);
  return header.map((h) => v[h] ?? "");
};
const kfinTxn = (v: Record<string, string>) => row(MFSD201_HEADER, {
  "Fund": "117", "Folio Number": "91000001", "Product Code": "117EQGR", "Scheme Code": "EQ", "Transaction Head": "R",
  "Transaction Description": "Redemption", "Transaction Type": "RED", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Process Date": "15/4/2026", "Nav Date": "15/4/2026", "Nav": "50.0000", "Load Percentage": "1", "PAN1": P.adult,
  "Transaction Number": "7001", ...v,
});
/** One lot: units × NAV 50 − 1% load = amount, all exact at the printed precision. */
const lot = (txn: string, lotId: string, units: string, extra: Record<string, string> = {}) => {
  const u = Number(units), gross = u * 50, load = Math.round(gross * 0.01 * 100) / 100;
  return kfinTxn({
    "Transaction Number": txn, "Transaction ID": lotId, "Purchase Transaction No": `P${lotId}`, "Purchase Date": "2/1/2025",
    "Purchase Units": units, "Purchase Amount": (u * 40).toFixed(2), "Units": units, "Price": "49.5000",
    "Load Amount": load.toFixed(2), "Amount": (gross - load).toFixed(2), ...extra,
  });
};
const norm201 = (rows: string[][]) => normalizeRows(T, LAYOUTS.find((l) => l.id === "kfintech.mfsd201")!, MFSD201_HEADER, rows.map((cells, i) => ({ rowNo: i + 1, cells })));

describe("Phase 3B-A — CAMS classification (R2)", () => {
  const sys = { nature: "Systematic - To Flexi Cap Fund-Growth-NSE - Instalment No - 3", sipTrxnNo: "SIP123", typeCode: "SO1", status: "Y" };

  it("a systematic switch (description AND registration reference) is an STP — the 82/82 pattern of the real file", () => {
    expect(classifyCams({ ...sys, flag: "Partial Switch Out" })).toMatchObject({ rtaClass: "stp_out", confidence: "verified", direction: "outflow" });
    expect(classifyCams({ ...sys, flag: "Switch In", nature: "Systematic - From Liquid Fund - Instalment No - 3/12" })).toMatchObject({ rtaClass: "stp_in", direction: "inflow" });
  });

  it("an ordinary switch (no systematic marker) stays a switch — the STP rule is not generalised", () => {
    const c = classifyCams({ flag: "Switch In", nature: "Switch In - From Liquid Fund", sipTrxnNo: "", typeCode: "SI1", status: "Y" });
    expect(c).toMatchObject({ rtaClass: "switch_in", confidence: "inferred", direction: "inflow" });
    expect(c.exception).toBeUndefined();
    expect(classifyCams({ flag: "Partial Switch Out", nature: "Switch Out", sipTrxnNo: "", typeCode: "SO1", status: "Y" }).rtaClass).toBe("switch_out");
  });

  it("a switch with only ONE of the two markers is held — switch or STP cannot be decided", () => {
    const onlyNature = classifyCams({ flag: "Switch In", nature: "Systematic - From X", sipTrxnNo: "", typeCode: "SI1", status: "Y" });
    const onlyRef = classifyCams({ flag: "Partial Switch Out", nature: "To X", sipTrxnNo: "S1", typeCode: "SO1", status: "Y" });
    for (const c of [onlyNature, onlyRef]) expect(c).toMatchObject({ rtaClass: "unknown", exception: "switch_stp_ambiguous" });
  });

  it("internal transfers are not external cash flows; purchases and redemptions are", () => {
    for (const k of ["switch_in", "switch_out", "stp_in", "stp_out"] as const) expect(CLASS_META[k].cashFlow).toBe("internal");
    for (const k of ["purchase", "sip_investment", "redemption", "swp_withdrawal"] as const) expect(CLASS_META[k].cashFlow).toBe("external");
    expect(CLASS_META.stp_in.legacyType).toBe("stp");
    expect(CLASS_META.switch_out.legacyType).toBe("switch");
  });

  it("purchase vs SIP vs redemption vs SWP from the real flags", () => {
    const c = (flag: string, nature: string) => classifyCams({ flag, nature, sipTrxnNo: "", typeCode: "P1", status: "Y" }).rtaClass;
    expect(c("Additional Purchase Systematic", "Systematic-NSE - Instalment No - 4/60")).toBe("sip_investment");
    expect(c("Fresh Purchase", "Fresh Purchase")).toBe("purchase");
    expect(c("Additional Purchase", "Systematic - Instalment 3/12 Physical")).toBe("sip_investment");
    expect(c("Full Redemption", "Redemption")).toBe("redemption");
    expect(c("Partial Redemption", "Systematic Systematic withdrawal - Instalment 2/12")).toBe("swp_withdrawal");
  });

  it("a systematic redemption instalment without 'withdrawal' is a redemption, flagged inferred SWP — not posted as SWP", () => {
    const c = classifyCams({ flag: "Partial Redemption", nature: "Systematic - NEFT PAYOUT-NSE - Instalment No - 3", sipTrxnNo: "", typeCode: "R5", status: "Y" });
    expect(c).toMatchObject({ rtaClass: "redemption", confidence: "inferred", notes: { inferredSwp: true } });
    expect(postable(c)).toBe(true);
  });

  it("reversal, cancellation, rejection, IDCW, unknown and a non-processed status are held with a reason", () => {
    const base = { nature: "", sipTrxnNo: "", typeCode: "X", status: "Y" };
    expect(classifyCams({ ...base, flag: "Additional Purchase", reversalCode: "R" }).exception).toBe("reversal_unlinked");
    expect(classifyCams({ ...base, flag: "Additional Purchase", originalTrxnNo: "123" }).rtaClass).toBe("reversal");
    expect(classifyCams({ ...base, flag: "Purchase Cancellation" }).exception).toBe("cancellation_unlinked");
    expect(classifyCams({ ...base, flag: "Purchase Rejection" }).exception).toBe("pre_rejection_unlinked");
    expect(classifyCams({ ...base, flag: "IDCW Reinvestment" })).toMatchObject({ rtaClass: "idcw_reinvest", exception: "class_unverified_idcw" });
    expect(classifyCams({ ...base, flag: "Dividend Payout" })).toMatchObject({ rtaClass: "idcw_payout", exception: "class_unverified_idcw" });
    expect(classifyCams({ ...base, flag: "Something New" }).exception).toBe("unknown_transaction_code");
    expect(classifyCams({ ...base, flag: "Fresh Purchase", status: "N" }).exception).toBe("registrar_status_not_processed");
    for (const c of [classifyCams({ ...base, flag: "Something New" }), classifyCams({ ...base, flag: "IDCW Reinvestment" })]) expect(postable(c)).toBe(false);
  });
});

describe("Phase 3B-A — KFintech classification (MFSD201)", () => {
  const k = (typeCode: string, head: string, description = "", rejOriginalNo = "") => classifyKfintech({ typeCode, head, description, status: "Y", rejOriginalNo });
  it("the verified code table", () => {
    expect(k("SIN", "P").rtaClass).toBe("sip_investment");
    expect(k("ADD", "P").rtaClass).toBe("purchase");
    expect(k("NEW", "P").rtaClass).toBe("purchase");
    expect(k("FUL", "R").rtaClass).toBe("redemption");
    expect(k("RED", "R").rtaClass).toBe("redemption");
    expect(k("SWD", "R").rtaClass).toBe("swp_withdrawal");
    expect(k("STPA", "P", "S T P In")).toMatchObject({ rtaClass: "stp_in", direction: "inflow" });
    expect(k("STPO", "R", "S T P Out")).toMatchObject({ rtaClass: "stp_out", direction: "outflow" });
  });
  it("pre-rejections (SIND / STPAD / STPOD) are held, linked or not", () => {
    for (const code of ["SIND", "STPAD", "STPOD"]) expect(k(code, "P", "Pre rejection")).toMatchObject({ rtaClass: "rejection", exception: "pre_rejection_unlinked" });
    expect(k("SIND", "P", "", "999").reason).toMatch(/not implemented/);
  });
  it("a pre-rejection in the verified shape (no original, no units, an amount) is a failed instalment, not a transaction (Phase 3D)", () => {
    const f = (typeCode: string, o: { units?: number; amount?: number; rejOriginalNo?: string } = {}) =>
      classifyKfintech({ typeCode, head: "P", description: "Pre rejection", status: "Y", units: 0, amount: 1000, ...o });
    expect(f("SIND")).toMatchObject({ rtaClass: "rejection", exception: "instalment_rejected", notes: { rejectionOf: "sip", genuineRejection: true } });
    expect(f("STPAD").notes?.rejectionOf).toBe("stp_in");
    expect(f("STPOD").notes?.rejectionOf).toBe("stp_out");
    expect(f("SIND").reason).toMatch(/does not stop the registration/);
    // Outside the verified shape it stays held as before.
    expect(f("SIND", { rejOriginalNo: "999" }).exception).toBe("pre_rejection_unlinked");
    expect(f("SIND", { units: 10 }).exception).toBe("pre_rejection_unlinked");
    expect(f("SIND", { amount: 0 }).exception).toBe("pre_rejection_unlinked");
  });
  it("a failed instalment keeps the registrar's reason without digits or PANs", () => {
    expect(rejectionReasonText("Primary KYC Invalid(KYC Modification not Done) ABCPD1234E acct 123456")).toBe("Primary KYC Invalid(KYC Modification not Done) <pan> acct #");
    expect(rejectionReasonText("  ")).toBeUndefined();
  });
  it("a code with the wrong Transaction Head, or an unknown code, is held", () => {
    expect(k("SIN", "R").exception).toBe("head_code_conflict");
    expect(k("XYZ", "P", "Something").exception).toBe("unknown_transaction_code");
    expect(k("ADD", "P", "Purchase Reversal").exception).toBe("reversal_unlinked");
  });
});

describe("Phase 3B — the four real layouts (test 1)", () => {
  it.each([
    ["kfintech.mfsd201", MFSD201_HEADER],
    ["cams.r2", R2_HEADER],
    ["cams.r9", R9_HEADER],
    ["kfintech.mfsd211", MFSD211_HEADER],
  ] as const)("%s is identified from its real header, also below title rows", (id, header) => {
    expect(identifyLayout([header])?.layout.id).toBe(id);
    expect(identifyLayout([["Report title"], ["Date: 18/05/2026"], header])).toMatchObject({ headerIndex: 2, layout: { id } });
  });
  it("a header missing one required column is not read as that layout", () => {
    expect(identifyLayout([MFSD201_HEADER.filter((h) => h !== "Transaction Number")])).toBeNull();
    expect(identifyLayout([R2_HEADER.filter((h) => h !== "trxnno")])).toBeNull();
  });
});

describe("Phase 3B — values are carried exactly", () => {
  it("readDecimal keeps the printed digits and precision", () => {
    expect(readDecimal("1,23,456.7800")).toEqual({ ok: true, value: { text: "123456.7800", num: 123456.78, dp: 4 } });
    expect(readDecimal("(12.5)")).toEqual({ ok: true, value: { text: "-12.5", num: -12.5, dp: 1 } });
    expect(readDecimal("")).toEqual({ ok: true, value: null });
    expect(readDecimal("12abc").ok).toBe(false);
    expect(readDecimal("0")).toEqual({ ok: true, value: { text: "0", num: 0, dp: 0 } });
  });
  it("sums are exact decimal sums, not float sums", () => {
    const d = (t: string) => (readDecimal(t) as any).value;
    expect(sumReported([d("0.1"), d("0.2"), null])).toBe("0.3");
    expect(sumReported([d("1.10"), d("2.205")])).toBe("3.305");
    expect(sumReported([d("4950.00"), d("990.00")])).toBe("5940.00");
    expect(sumReported([null, null])).toBeNull();
  });
  it("a row whose mandatory value cannot be read is invalid with a reason — never 0 / today", () => {
    const [r] = norm201([lot("7001", "L1", "100.000", { "Amount": "abc", "Transaction Date": "" })]);
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.field).sort()).toEqual(["amount", "tradeDate"]);
    expect(r.amount).toBeNull();
    expect(r.tradeDate).toBeNull();
  });
  it("staged rows carry PAN tokens, never the PAN", () => {
    const [r] = norm201([lot("7001", "L1", "100.000")]);
    expect(r.panToken).toMatch(/^pt1:/);
    // pan / guardianPan / holder / owner are in-memory only (never persisted); everything else must be PAN-free.
    expect(JSON.stringify({ ...r, pan: null, guardianPan: null, holder: null, owner: null })).not.toContain(P.adult);
    expect(r.attrs.holder).toMatchObject({ ownerType: "individual", sourcePanRole: "owner" });
  });
});

describe("Phase 3B — KFintech redemption grouping", () => {
  it("lots under one transaction number form ONE economic redemption with summed figures (tests 2–3)", () => {
    const rows = norm201([lot("7001", "L1", "100.000"), lot("7001", "L2", "20.000"), lot("7001", "L3", "5.500", { STT: "1.25" })]);
    const [g] = groupTransactions(T, rows, "kfintech");
    expect(g).toMatchObject({ status: "complete", multiLot: true, rtaClass: "redemption", reportedUnits: "125.500", reportedStt: "1.25", lots: expect.any(Array) });
    expect(g.lots).toHaveLength(3);
    expect(g.reportedAmount).toBe("6212.25"); // 4950 + 990 + 272.25
    expect(g.reportedExitLoad).toBe("62.75");
    expect(g.reportedAmount).toMatch(/^\d+\.\d{2}$/);
    expect(g.derivedGrossAmount).toBe("6275");
    expect(Number(g.arithmeticDelta)).toBeCloseTo(0, 9);
  });

  it("identical-looking genuine lots stay two lots, two source rows (test 5)", () => {
    const rows = norm201([lot("7002", "L9", "10.000"), lot("7002", "L9", "10.000")]);
    expect(rows[0].rowHash).toBe(rows[1].rowHash); // byte-identical rows …
    const [g] = groupTransactions(T, rows, "kfintech");
    expect(g.status).toBe("complete");
    expect(g.lots.map((l) => [l.rowNo, l.lotPart])).toEqual([[1, 1], [2, 2]]); // … kept apart by their position
    expect(g.reportedUnits).toBe("20.000");
  });

  it("repeated references outside a KFintech redemption are held, never merged (test 4)", () => {
    const sip = (amt: string) => kfinTxn({ "Transaction Number": "8001", "Transaction Head": "P", "Transaction Type": "SIN", "Transaction Description": "Systematic Investment", "Units": "10.000", "Amount": amt, "Load Amount": "", "Load Percentage": "" });
    const [g] = groupTransactions(T, norm201([sip("500.00"), sip("500.00")]), "kfintech");
    expect(g).toMatchObject({ status: "quarantined", exception: "repeated_reference_unverified" });
  });

  it("one unreadable lot holds the whole group — nothing posts partially (test 10)", () => {
    const rows = norm201([lot("7003", "L1", "100.000"), lot("7003", "L2", "20.000", { "Units": "x" })]);
    const [g] = groupTransactions(T, rows, "kfintech");
    expect(g).toMatchObject({ status: "quarantined", exception: "group_row_invalid", rowNos: [1, 2] });
  });

  it("rows disagreeing on a group invariant, or STT on two rows, are held", () => {
    const a = groupTransactions(T, norm201([lot("7004", "L1", "1.000"), lot("7004", "L2", "1.000", { "Nav Date": "16/4/2026" })]), "kfintech")[0];
    expect(a.exception).toBe("group_invariants_differ");
    const b = groupTransactions(T, norm201([lot("7005", "L1", "1.000", { STT: "0.01" }), lot("7005", "L2", "1.000", { STT: "0.01" })]), "kfintech")[0];
    expect(b.exception).toBe("group_stt_multiple");
  });

  it("a lot outside its printed-precision tolerance is a discrepancy: held, nothing adjusted (test 15)", () => {
    const off = lot("7006", "L2", "20.000");
    const amountCol = MFSD201_HEADER.indexOf("Amount");
    off[amountCol] = "990.50"; // tolerance here is 0.036 (3-dp units at NAV 50); 0.50 is outside it
    const [g] = groupTransactions(T, norm201([lot("7006", "L1", "100.000"), off]), "kfintech");
    expect(g).toMatchObject({ status: "quarantined", exception: "lot_arithmetic" });
    expect(g.reportedAmount).toBe("5940.50"); // the reported figure, untouched
    expect(g.lots[1].arithmeticOk).toBe(false);
  });

  it("precision is the column's: a NAV printed '50.1' in a column that elsewhere prints 4 decimals is known to 4", () => {
    const rows = norm201([lot("7009", "L1", "1.000"), lot("7009", "L2", "1.000", { "Nav": "50.1" })]);
    expect(rows[1].nav).toEqual({ text: "50.1", num: 50.1, dp: 4 });
  });

  it("the tolerance is the propagated half-unit of the printed digits", () => {
    const d = (t: string) => (readDecimal(t) as any).value;
    const a = lotArithmetic({ units: d("10.123"), nav: d("12.3456"), loadAmount: d("1.25"), amount: d("123.72") })!;
    // ½·0.01 (amount) + ½·0.01 (load) + ½·0.001·12.3456 (units) + ½·0.0001·10.123 (nav)
    expect(a.tolerance).toBeCloseTo(0.005 + 0.005 + 0.0061728 + 0.00050615, 6);
    expect(Math.abs(a.delta)).toBeLessThanOrEqual(a.tolerance);
  });

  it("each lot keeps its own purchase reference and figures", () => {
    const [g] = groupTransactions(T, norm201([lot("7007", "L1", "3.000"), lot("7007", "L2", "4.000")]), "kfintech");
    expect(g.lots.map((l) => [l.registrarLotId, l.purchaseTxnNo, l.units, l.amount, l.purchaseDate])).toEqual([
      ["L1", "PL1", "3.000", "148.50", "2025-01-02"],
      ["L2", "PL2", "4.000", "198.00", "2025-01-02"],
    ]);
  });

  it("a source row number is never part of the economic identity", () => {
    const a = groupTransactions(T, norm201([lot("7008", "L1", "1.000"), lot("7008", "L2", "2.000")]), "kfintech")[0];
    const b = groupTransactions(T, norm201([lot("7008", "L2", "2.000"), lot("7008", "L1", "1.000")]), "kfintech")[0];
    expect(a.identityKey).toBe("kfin.v1:117:7008");
    expect([a.identityKey, a.invariantHash, a.lotSignature]).toEqual([b.identityKey, b.invariantHash, b.lotSignature]);
  });

  it("CAMS repeated transaction numbers are held (no multi-row CAMS layout has been verified)", () => {
    const r2 = (amt: string) => row(R2_HEADER, { amc_code: "H", folio_no: "1/1", prodcode: "HX", trxnno: "555", traddate: "2026-05-02", units: "1.0000", amount: amt, purprice: "10.0000", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase", trxnstat: "Y", pan: P.adult });
    const rows = normalizeRows(T, LAYOUTS.find((l) => l.id === "cams.r2")!, R2_HEADER, [r2("10.00"), r2("10.00")].map((cells, i) => ({ rowNo: i + 1, cells })));
    expect(groupTransactions(T, rows, "cams")[0].exception).toBe("repeated_reference_unverified");
  });
});

describe("Phase 3B — keyed PAN tokens", () => {
  it("are keyed, tenant-separated, version-prefixed and not a plain hash", async () => {
    const { createHash } = await import("node:crypto");
    const t1 = panToken(T, P.adult)!;
    expect(t1).toMatch(/^pt1:[A-Za-z0-9_-]{43}$/);
    expect(panToken(T, P.adult.toLowerCase())).toBe(t1);
    expect(panToken(T2, P.adult)).not.toBe(t1);
    expect(t1).not.toContain(createHash("sha256").update(P.adult).digest("base64url"));
    expect(panToken(T, "NOT A PAN")).toBeNull();
    expect(keyedDigest(T, "row", "x")).not.toBe(keyedDigest(T2, "row", "x"));
  });
  it("refuse to run without a key — there is no development fallback", () => {
    const saved = { e: process.env.ENCRYPTION_KEY, r: process.env.RTA_STAGING_TOKEN_KEY };
    delete process.env.ENCRYPTION_KEY;
    delete process.env.RTA_STAGING_TOKEN_KEY;
    try {
      expect(() => panToken(T, P.adult)).toThrow(PanTokenKeyMissingError);
    } finally {
      process.env.ENCRYPTION_KEY = saved.e;
      if (saved.r) process.env.RTA_STAGING_TOKEN_KEY = saved.r;
    }
  });
  it("a dedicated RTA_STAGING_TOKEN_KEY gives different tokens from the derived key", () => {
    const before = panToken(T, P.adult);
    process.env.RTA_STAGING_TOKEN_KEY = "f".repeat(64);
    try {
      expect(panToken(T, P.adult)).not.toBe(before);
    } finally {
      delete process.env.RTA_STAGING_TOKEN_KEY;
    }
  });
});

describe("Phase 3B — RTA_PIPELINE_MODE", () => {
  it("off by default; shadow when asked; ON is refused and runs the existing importer only", () => {
    expect(rtaPipelineMode(T, {} as NodeJS.ProcessEnv)).toEqual({ mode: "off", refused: undefined });
    expect(rtaPipelineMode(T, { RTA_PIPELINE_MODE: "shadow" } as unknown as NodeJS.ProcessEnv).mode).toBe("shadow");
    const on = rtaPipelineMode(T, { RTA_PIPELINE_MODE: "on" } as unknown as NodeJS.ProcessEnv);
    expect(on.mode).toBe("off");
    expect(on.refused).toMatch(/reserved/);
    expect(rtaPipelineMode(T, { RTA_PIPELINE_MODE: "yes" } as unknown as NodeJS.ProcessEnv)).toMatchObject({ mode: "off", refused: expect.stringMatching(/not a mode/) });
  });
  it("a tenant allow-list limits shadow to the firms named", () => {
    const env = { RTA_PIPELINE_MODE: "shadow", RTA_PIPELINE_TENANTS: `${T2}` } as unknown as NodeJS.ProcessEnv;
    expect(rtaPipelineMode(T, env).mode).toBe("off");
    expect(rtaPipelineMode(T2, env).mode).toBe("shadow");
  });
});

// Type-only use so the import is not flagged unused when a block is skipped.
export type _N = NormRow;

// ── Phase 3C: the second set of real layouts ────────────────────────────────
import { MFSD203_HEADER, MFSD230_HEADER, MFSD243_HEADER, MFSD211_V2_HEADER, WBR4_HEADER, WBR10_HEADER, WBR49_HEADER } from "./rta-real-layouts";

describe("Phase 3C — the newer real layouts", () => {
  it.each([
    ["kfintech.mfsd203", MFSD203_HEADER], ["kfintech.mfsd230", MFSD230_HEADER], ["kfintech.mfsd243", MFSD243_HEADER],
    ["kfintech.mfsd211", MFSD211_V2_HEADER], ["cams.wbr4", WBR4_HEADER], ["cams.wbr10", WBR10_HEADER], ["cams.wbr49", WBR49_HEADER],
  ] as const)("%s is identified from its real header", (id, header) => {
    expect(identifyLayout([header])?.layout.id).toBe(id);
  });

  it("R9 is not mistaken for WBR4 and vice versa (R9 carries mobile, bank and date of birth)", () => {
    expect(identifyLayout([R9_HEADER])?.layout.id).toBe("cams.r9");
    expect(identifyLayout([WBR4_HEADER])?.layout.id).toBe("cams.wbr4");
  });

  const layoutOf = (id: string) => LAYOUTS.find((l) => l.id === id)!;
  const norm = (id: string, header: string[], rows: Record<string, string>[]) =>
    normalizeRows(T, layoutOf(id), header, rows.map((v, i) => ({ rowNo: i + 1, cells: row(header, v) })));

  it("MFSD203: units, NAV and AUM as reported; a zero position stays a zero position", () => {
    const [a, z] = norm("kfintech.mfsd203", MFSD203_HEADER, [
      { "Fund": "117", "Folio Number": "1", "Product Code": "117X", "Balance": "10.500", "NAV": "12.3456", "AUM": "129.63", "Report Date": "08/10/2026", "PAN": P.adult },
      { "Fund": "117", "Folio Number": "2", "Product Code": "117X", "Balance": "0.000", "NAV": "12.3456", "AUM": "0.00", "Report Date": "08/10/2026", "PAN": P.adult },
    ]);
    expect([a.units?.text, a.nav?.text, a.holdingValue?.text, a.asOfDate]).toEqual(["10.500", "12.3456", "129.63", "2026-10-08"]);
    expect(z.units).toEqual({ text: "0.000", num: 0, dp: 3 });
  });

  // Folio correction is proved from the figures, the remark is not needed and not enough (Phase 3E).
  const consol = (o: { repostUnits?: string; noRepost?: boolean; remark?: string; rUnits?: string } = {}) => norm201([
    kfinTxn({ "Transaction Number": "9100", "Transaction Head": "P", "Transaction Type": "SIN", "Transaction Description": "Systematic Investment", "Units": "10.000", "Amount": "500.00", "Remarks": o.remark ?? "", "Load Percentage": "" }),
    kfinTxn({ "Transaction Number": "9100", "Transaction Head": "R", "Transaction Type": "SINR", "Transaction Description": "SIP Rejection", "Units": o.rUnits ?? "-10.000", "Amount": "-500.00", "Remarks": o.remark ?? "", "Load Percentage": "" }),
    ...(o.noRepost ? [] : [kfinTxn({ "Transaction Number": "9100", "Transaction Head": "P", "Transaction Type": "SIN", "Transaction Description": "Systematic Investment", "Units": o.repostUnits ?? "10.000", "Amount": "500.00", "Folio Number": "91000077", "Remarks": "", "Load Percentage": "" })]),
  ]);

  it("MFSD201 original + exact negation + equal re-post in one other folio is a folio correction (proved from figures, no remark needed)", () => {
    const rows = consol();
    expect(rows.map((r) => r.cls?.exception ?? null)).toEqual([null, "rejection_semantics_unverified", null]);
    const [g] = groupTransactions(T, rows, "kfintech");
    expect(g).toMatchObject({ status: "quarantined", exception: "folio_consolidation" });
    expect(g.reason).toMatch(/not a rejection and not a new transaction/);
    expect(rows.every((r) => r.attrs.eventCategory === "folio_correction")).toBe(true);
  });

  it("an R-coded group that the figures do not prove stays an unverified rejection, whatever the remark says", () => {
    for (const o of [{ noRepost: true }, { repostUnits: "9.000" }, { rUnits: "-9.000" }]) {
      const rows = consol({ ...o, remark: "Trxn triggered now due to consolidation of folios" });
      const [g] = groupTransactions(T, rows, "kfintech");
      expect(g.exception).not.toBe("folio_consolidation");
      expect(rows[1].attrs.eventCategory).toBe("failed_sip_instalment");
      expect(String(rows[1].attrs.consolidationProof)).not.toBe("proved");
    }
  });

  it("an R-suffixed rejection code outside a consolidation is a rejection, held until its meaning is evidenced", () => {
    const c = classifyKfintech({ typeCode: "SINR", head: "P", description: "SIP Rejection", status: "Y" });
    expect(c).toMatchObject({ rtaClass: "rejection", exception: "rejection_semantics_unverified", category: "failed_sip_instalment" });
    expect(classifyKfintech({ typeCode: "FULR", head: "P", description: "", status: "Y" }).category).toBe("redemption_rejection");
    expect(classifyKfintech({ typeCode: "NEWR", head: "R", description: "", status: "Y" }).category).toBe("purchase_rejection");
    expect(postable(c)).toBe(false);
  });

  it("WBR10: a non-financial event is not a transaction; a purchase without trxn_type_flag is held", () => {
    const rows = norm("cams.wbr10", WBR10_HEADER, [
      { amc_code: "IF", folio_chk: "1", sch_code: "MAFRG", trxntype: "NOM", trxnno: "1", traddate: "05/10/2026", units: "", amount: "", trxn_sign: "N", tax_status: "Individual" },
      { amc_code: "IF", folio_chk: "1", sch_code: "MAFRG", trxntype: "PMF1S", trxnno: "2", traddate: "05/10/2026", units: "417.254", amount: "4999.75", trxn_sign: "+", trxnstat: "Y", tax_status: "Individual" },
    ]);
    expect(rows[0]).toMatchObject({ valid: true, cls: { exception: "non_financial_event" } });
    expect(rows[1]).toMatchObject({ valid: true, schemeCode: "IFMAFRG", cls: { exception: "unknown_transaction_code" } });
  });

  it("registrations: WBR49 cease / pause dates read; a blank date stays blank; MFSD230 has no id or status", () => {
    const [w] = norm("cams.wbr49", WBR49_HEADER, [{ product: "IFIFCRG", folio_no: "1", aut_trntyp: "P", auto_trno: "406894", auto_amount: "1500", from_date: "06/10/2026", to_date: "05/10/2056", cease_date: "", periodicity: "OM", amc_code: "IF", reg_date: "02/10/2026", pause_from_date: "", pause_to_date: "" }]);
    expect([w.registrarTxnNo, w.tradeDate, w.attrs.ceaseDate, w.attrs.endDate]).toEqual(["406894", "2026-10-06", undefined, "2056-10-05"]);
    const [k] = norm("kfintech.mfsd243", MFSD243_HEADER, [{ "Folio": "1", "Fund Code": "117", "Product Code": "117X", "RegistrationDate": "01/10/2026", "Start Date": "10/11/2026", "End Date": "09/10/2056", "Amount": "2500", "Frequency": "Monthly", "Trtype": "SIP", "Status": "Live SIP", "TerminateDate": "", "RegSlno": "202610011026298" }]);
    expect([k.registrarTxnNo, k.attrs.registrarStatus, k.attrs.terminateDate]).toEqual(["202610011026298", "Live SIP", undefined]);
    const [m] = norm("kfintech.mfsd230", MFSD230_HEADER, [{ "Prodcode": "117X", "Fund": "117", "Acno": "1", "TrType": "SIP", "Freq": "Monthly", "STARTDATE": "07/10/2026", "ENDDATE": "06/09/2056", "PAIDINST": "1", "AMOUNT": "2500.00", "RegDate": "07/09/2026" }]);
    expect([m.registrarTxnNo, m.attrs.registrarStatus, m.attrs.hasRegistrationId]).toEqual([null, undefined, false]);
  });

  it("a CAMS minor row's PAN is staged as the guardian's token, never the owner's", () => {
    const [r] = normalizeRows(T, layoutOf("cams.r2"), R2_HEADER, [{ rowNo: 1, cells: row(R2_HEADER, { amc_code: "H", folio_no: "1/1", prodcode: "HX", trxnno: "1", traddate: "2026-05-02", units: "1.0000", amount: "10.00", purprice: "10.0000", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase", trxnstat: "Y", pan: P.guardian, tax_status: "On Behalf Of Minor" }) }]);
    expect(r.panToken).toBeNull();
    expect(r.guardianPanToken).toBe(panToken(T, P.guardian));
    expect(r.attrs.holder).toMatchObject({ ownerType: "minor", sourcePanRole: "guardian" });
  });
});

describe("Phase 3C — every holder-bearing layout states its holders", () => {
  it.each([
    ["cams.r9", R9_HEADER, { foliochk: "1", product: "XS", amc_code: "X", rep_date: "2026-05-18", clos_bal: "1", rupee_bal: "1", pan_no: "", guard_pan: P.guardian, tax_status: "On Behalf Of Minor", inv_dob: "2015-01-01" }],
    ["cams.wbr4", WBR4_HEADER, { foliochk: "1", product: "XS", amc_code: "X", rep_date: "2026-10-08", clos_bal: "1", rupee_bal: "1", pan_no: P.adult, tax_status: "Individual" }],
    ["kfintech.mfsd211", MFSD211_HEADER, { Fund: "1", Folio: "1", "Product Code": "1X", "PAN Number": "", GuardPanNo: P.guardian, StatusDesc: "MINOR", "Report Date": "18/05/2026" }],
  ] as const)("%s", (id, header, values) => {
    const [r] = normalizeRows(T, LAYOUTS.find((l) => l.id === id)!, header as string[], [{ rowNo: 1, cells: row(header as string[], values as Record<string, string>) }]);
    expect(r.owner).not.toBeNull();
    expect(r.attrs.holder).toBeTruthy();
  });
});
