/**
 * The four registrar reports the staging pipeline reads, and how each row of
 * them normalizes. Every layout below was verified against a real mailback on
 * 2026-10-08 (headers in tests/rta-real-layouts.ts); a file whose header does
 * not carry a layout's required columns is not read as that layout — there is
 * no positional fallback and no "closest match".
 *
 *   KFintech MFSD201  transactions   identity  kfin.v1:<Fund>:<Transaction Number>
 *   CAMS R2           transactions   identity  cams.v1:<amc_code>:<trxnno>
 *   CAMS R9           holdings       (folio, scheme) as of rep_date
 *   KFintech MFSD211  investor/folio master
 *
 * What a staged row keeps (minimized on purpose): folio, AMC, scheme, ISIN,
 * dates, the financial figures, the transaction codes and wording, and PAN
 * TOKENS (pan-token.ts) — never a PAN, a name, an address, a phone number, an
 * email, a bank account or a nominee. The source file itself (in storage,
 * referenced by the batch) remains the record of everything else.
 */
import { readDate, readNumber, detectDateOrder, type DateOrder } from "../values";
import { rejectionReasonText } from "../values";
export { rejectionReasonText };
/** ******1234 — the last four characters of a PAN, for display; null when there is none. */
export const panMask = (pan: string | null | undefined) => (pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? "******" + pan.slice(-4) : null);
import { classifyCams, classifyKfintech, nonFinancial, type BusinessClass } from "./classify";
import { keyedDigest, panToken } from "./pan-token";
import { deriveHolder, type DerivedHolder, type HolderFacts } from "../owner";
import type { SourceRow } from "./source";

export type RecordKind = "transaction" | "holding" | "master" | "registration";

export type LayoutId =
  | "kfintech.mfsd201" | "cams.r2" | "cams.r9" | "kfintech.mfsd211"
  | "cams.wbr4" | "cams.wbr10" | "cams.wbr49" | "kfintech.mfsd203" | "kfintech.mfsd230" | "kfintech.mfsd243";

export type Decimal = { text: string; num: number; dp: number };

export type ValidationIssue = { field: string; reason: string };

export type LotFacts = {
  registrarLotId: string | null;
  purchaseTxnNo: string | null;
  purchaseDate: string | null;
  purchaseUnits: Decimal | null;
  purchaseAmount: Decimal | null;
};

/** One normalized source row, in memory. `pan` / `guardianPan` never leave this object. */
export type NormRow = {
  rowNo: number;
  rowHash: string;
  recordKind: RecordKind;
  valid: boolean;
  issues: ValidationIssue[];
  /** The source text of the figures and dates, for the source-vs-normalized checks. */
  src: Record<string, string>;
  registrarTxnNo: string | null;
  economicKey: string | null;
  amcCode: string | null;
  folioNumber: string | null;
  schemeCode: string | null;
  isin: string | null;
  tradeDate: string | null;
  asOfDate: string | null;
  units: Decimal | null;
  amount: Decimal | null;
  nav: Decimal | null;
  price: Decimal | null;
  loadAmount: Decimal | null;
  stt: Decimal | null;
  stampDuty: Decimal | null;
  holdingValue: Decimal | null;
  cls: BusinessClass | null;
  lot: LotFacts | null;
  /** Keyed digest of the columns that must be identical on every row of one registrar transaction (they include the PAN, so never kept in clear). */
  invariants: string | null;
  panToken: string | null;
  guardianPanToken: string | null;
  pan: string | null;
  guardianPan: string | null;
  /** What the row says about its holders (in memory only — PANs never persisted). */
  holder: HolderFacts | null;
  /** Owner type, owner PAN, guardian and joint holders as derived from `holder`. */
  owner: DerivedHolder | null;
  attrs: Record<string, unknown>;
};

export type Layout = {
  id: LayoutId;
  rta: "cams" | "kfintech";
  reportCode: string;
  recordKind: RecordKind;
  identityScheme: string | null;
  /** Header names that must all be present (exact, case-insensitive, trimmed). */
  required: string[];
};

export const LAYOUTS: Layout[] = [
  {
    id: "kfintech.mfsd201", rta: "kfintech", reportCode: "MFSD201", recordKind: "transaction", identityScheme: "kfin.v1",
    required: ["Fund", "Folio Number", "Product Code", "Transaction Number", "Transaction Date", "Transaction Head", "Transaction Type", "Transaction Description", "Units", "Amount", "Nav", "Transaction ID", "Purchase Transaction No"],
  },
  {
    id: "cams.r2", rta: "cams", reportCode: "R2", recordKind: "transaction", identityScheme: "cams.v1",
    required: ["amc_code", "folio_no", "prodcode", "trxnno", "traddate", "units", "amount", "purprice", "trxn_type_flag", "trxn_nature", "siptrxnno"],
  },
  {
    // R9 and WBR4 share the holdings columns; R9 is told apart by the master
    // fields only it carries (mobile, bank, date of birth — verified headers).
    id: "cams.r9", rta: "cams", reportCode: "R9", recordKind: "holding", identityScheme: null,
    required: ["foliochk", "product", "amc_code", "rep_date", "clos_bal", "rupee_bal", "pan_no", "mobile_no", "bank_name", "inv_dob"],
  },
  {
    id: "cams.wbr4", rta: "cams", reportCode: "WBR4", recordKind: "holding", identityScheme: null,
    required: ["foliochk", "product", "amc_code", "rep_date", "clos_bal", "rupee_bal", "pan_no"],
  },
  {
    // WBR10: the WBR2-family transaction report in a short layout. Same
    // registrar transaction number as R2, so the same identity scheme — a
    // transaction reported by both is one transaction.
    id: "cams.wbr10", rta: "cams", reportCode: "WBR10", recordKind: "transaction", identityScheme: "cams.v1",
    required: ["amc_code", "folio_chk", "sch_code", "trxntype", "trxnno", "traddate", "units", "amount", "trxn_sign"],
  },
  {
    id: "cams.wbr49", rta: "cams", reportCode: "WBR49", recordKind: "registration", identityScheme: null,
    required: ["product", "folio_no", "aut_trntyp", "auto_trno", "auto_amount", "from_date", "to_date", "cease_date", "periodicity", "amc_code", "reg_date"],
  },
  {
    id: "kfintech.mfsd203", rta: "kfintech", reportCode: "MFSD203", recordKind: "holding", identityScheme: null,
    required: ["Fund", "Folio Number", "Product Code", "Balance", "NAV", "AUM", "Report Date"],
  },
  {
    id: "kfintech.mfsd243", rta: "kfintech", reportCode: "MFSD243", recordKind: "registration", identityScheme: null,
    required: ["Folio", "Fund Code", "Product Code", "RegistrationDate", "Start Date", "End Date", "Amount", "Frequency", "Trtype", "Status", "TerminateDate", "RegSlno"],
  },
  {
    id: "kfintech.mfsd230", rta: "kfintech", reportCode: "MFSD230", recordKind: "registration", identityScheme: null,
    required: ["Prodcode", "Fund", "Acno", "TrType", "Freq", "STARTDATE", "ENDDATE", "PAIDINST", "AMOUNT", "RegDate"],
  },
  {
    id: "kfintech.mfsd211", rta: "kfintech", reportCode: "MFSD211", recordKind: "master", identityScheme: null,
    required: ["Fund", "Folio", "Product Code", "PAN Number", "Report Date", "GuardPanNo"],
  },
];

const HEADER_SCAN = 10;
const normHeader = (s: string) => (s ?? "").trim().toLowerCase();

/** The layout and header line of a file, or null when no verified layout fits. */
export function identifyLayout(lines: string[][]): { layout: Layout; headerIndex: number } | null {
  for (let i = 0; i < Math.min(lines.length, HEADER_SCAN); i++) {
    const have = new Set(lines[i].map(normHeader));
    for (const layout of LAYOUTS) {
      if (layout.required.every((r) => have.has(normHeader(r)))) return { layout, headerIndex: i };
    }
  }
  return null;
}

// ── Value readers ──────────────────────────────────────────────────────────

/**
 * A decimal exactly as reported: `text` is the source digits with grouping
 * removed (no float round-trip), `dp` how many decimals the registrar wrote —
 * the precision the reconciliation tolerances are derived from.
 */
export function readDecimal(raw: string | null | undefined): { ok: true; value: Decimal | null } | { ok: false; reason: string } {
  const r = readNumber(raw);
  if (!r.ok) return r;
  if (r.value === null) return { ok: true, value: null };
  let s = (raw ?? "").trim();
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1).trim(); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[,\s]/g, "");
  if (/e/i.test(s)) {
    // A spreadsheet cell can surface as 1e-7: keep the float's own digits.
    const n = r.value;
    const fixed = n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
    return { ok: true, value: { text: fixed, num: n, dp: (fixed.split(".")[1] ?? "").length } };
  }
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return { ok: false, reason: `"${(raw ?? "").trim()}" is not a number` };
  const text = (neg && Number(s) !== 0 ? "-" : "") + (s.startsWith(".") ? "0" + s : s.replace(/\.$/, ""));
  const num = Number(text);
  if (Math.abs(num - r.value) > 1e-9 * Math.max(1, Math.abs(num))) return { ok: false, reason: `"${(raw ?? "").trim()}" reads two ways` };
  return { ok: true, value: { text, num, dp: (text.split(".")[1] ?? "").length } };
}

/** A date read for a holder fact (date of birth): ISO or null, never "today". */
function readIso(raw: string): string | null {
  const r = readDate(raw);
  return r.ok && r.value ? r.value : null;
}

type Cells = (name: string) => string;

function cellsOf(header: string[], row: SourceRow): Cells {
  const idx = new Map<string, number>();
  header.forEach((h, i) => { const k = normHeader(h); if (!idx.has(k)) idx.set(k, i); });
  return (name) => {
    const i = idx.get(normHeader(name));
    return i === undefined ? "" : String(row.cells[i] ?? "").trim();
  };
}

class RowBuilder {
  issues: ValidationIssue[] = [];
  src: Record<string, string> = {};
  constructor(private c: Cells, private dateOrder: DateOrder | "conflict") {}
  text(name: string): string | null {
    const v = this.c(name);
    return v === "" ? null : v;
  }
  num(field: string, name: string, required = false): Decimal | null {
    const raw = this.c(name);
    this.src[field] = raw;
    const r = readDecimal(raw);
    if (!r.ok) { this.issues.push({ field, reason: r.reason }); return null; }
    if (r.value === null && required) this.issues.push({ field, reason: `${name} is blank` });
    return r.value;
  }
  date(field: string, name: string, required = false): string | null {
    const raw = this.c(name);
    this.src[field] = raw;
    if (this.dateOrder === "conflict" && /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(raw)) {
      this.issues.push({ field, reason: `${name} — this file mixes day-first and month-first dates, so "${raw}" cannot be read safely` });
      return null;
    }
    const r = readDate(raw, this.dateOrder === "conflict" ? "dmy" : this.dateOrder);
    if (!r.ok) { this.issues.push({ field, reason: r.reason }); return null; }
    if (r.value === null && required) this.issues.push({ field, reason: `${name} is blank` });
    return r.value;
  }
  need(field: string, name: string): string | null {
    const v = this.text(name);
    if (!v) this.issues.push({ field, reason: `${name} is blank` });
    return v;
  }
}

/** The file's date order, decided once from every date column it carries. */
function fileDateOrder(header: string[], rows: SourceRow[], columns: string[]): DateOrder | "conflict" {
  const samples: string[] = [];
  for (const row of rows) {
    const c = cellsOf(header, row);
    for (const col of columns) samples.push(c(col));
  }
  return detectDateOrder(samples);
}

const blankNorm = (): Omit<NormRow, "rowNo" | "rowHash" | "recordKind" | "valid" | "issues" | "src"> => ({
  registrarTxnNo: null, economicKey: null, amcCode: null, folioNumber: null, schemeCode: null, isin: null,
  tradeDate: null, asOfDate: null, units: null, amount: null, nav: null, price: null, loadAmount: null,
  stt: null, stampDuty: null, holdingValue: null, cls: null, lot: null, invariants: null,
  panToken: null, guardianPanToken: null, pan: null, guardianPan: null, holder: null, owner: null, attrs: {},
});

const MFSD201_INVARIANTS = [
  "Fund", "Folio Number", "Product Code", "Scheme Code", "Transaction Number", "Transaction Date", "Process Date",
  "Transaction Head", "Transaction Description", "Transaction Type", "Transaction Sub", "Transaction Flag", "Nav",
  "Nav Date", "Load Percentage", "Ihno", "Branch Transaction No", "Inward Number", "PAN1", "Agent Code", "ISIN", "EUIN",
];
/** Where each registration report keeps each fact (verified headers, 2026-10-08). */
const REGISTRATION_COLS: Record<"cams.wbr49" | "kfintech.mfsd243" | "kfintech.mfsd230", {
  amc: string; folio: string; scheme: string; id: string | null; amount: string; start: string; end: string; reg: string;
  kind: string; freq: string; status: string | null; cease: string | null; terminate: string | null; pauseFrom: string | null; pauseTo: string | null;
  target: string[]; installments: string | null; paid: string | null; pan: string | null;
}> = {
  "cams.wbr49": { amc: "amc_code", folio: "folio_no", scheme: "product", id: "auto_trno", amount: "auto_amount", start: "from_date", end: "to_date", reg: "reg_date", kind: "aut_trntyp", freq: "periodicity", status: null, cease: "cease_date", terminate: null, pauseFrom: "pause_from_date", pauseTo: "pause_to_date", target: ["target_scheme_code"], installments: null, paid: null, pan: "pan" },
  "kfintech.mfsd243": { amc: "Fund Code", folio: "Folio", scheme: "Product Code", id: "RegSlno", amount: "Amount", start: "Start Date", end: "End Date", reg: "RegistrationDate", kind: "Trtype", freq: "Frequency", status: "Status", cease: null, terminate: "TerminateDate", pauseFrom: null, pauseTo: null, target: ["ToProductCode"], installments: "No Of Installments", paid: null, pan: "PAN" },
  // MFSD230 carries no registration id and no status (verified): its rows can be
  // described but not keyed or given a lifecycle state.
  "kfintech.mfsd230": { amc: "Fund", folio: "Acno", scheme: "Prodcode", id: null, amount: "AMOUNT", start: "STARTDATE", end: "ENDDATE", reg: "RegDate", kind: "TrType", freq: "Freq", status: null, cease: null, terminate: null, pauseFrom: null, pauseTo: null, target: ["STPInScheme", "StpInPlan"], installments: "INSTALNO", paid: "PAIDINST", pan: null },
};

const R2_INVARIANTS = ["amc_code", "folio_no", "prodcode", "trxnno", "traddate", "postdate", "trxntype", "trxn_type_flag", "trxn_nature", "purprice", "pan", "brokcode"];

/** Normalize every data row of a file of the given layout. Pure apart from the keyed digests. */
export function normalizeRows(tenantId: string, layout: Layout, header: string[], rows: SourceRow[]): NormRow[] {
  const dateCols: Record<LayoutId, string[]> = {
    "kfintech.mfsd201": ["Transaction Date", "Purchase Date"],
    "cams.r2": ["traddate"],
    "cams.r9": ["rep_date"],
    "kfintech.mfsd211": ["Report Date"],
    "cams.wbr4": ["rep_date"],
    "cams.wbr10": ["traddate"],
    "cams.wbr49": ["from_date", "to_date", "reg_date"],
    "kfintech.mfsd203": ["Report Date", "Transaction Date"],
    "kfintech.mfsd243": ["RegistrationDate", "Start Date", "End Date"],
    "kfintech.mfsd230": ["STARTDATE", "ENDDATE", "RegDate"],
  };
  const order = fileDateOrder(header, rows, dateCols[layout.id]);
  const out = rows.map((row) => {
    const c = cellsOf(header, row);
    const b = new RowBuilder(c, order);
    const n = blankNorm();
    const rowHash = keyedDigest(tenantId, "row", JSON.stringify(row.cells.map((x) => String(x ?? "").trim())));
    const inv = (cols: string[]) => keyedDigest(tenantId, "invariants", cols.map((col) => c(col)).join("\u001f"));

    switch (layout.id) {
      case "kfintech.mfsd201": {
        n.amcCode = b.need("amc", "Fund");
        n.folioNumber = b.need("folio", "Folio Number");
        n.schemeCode = b.need("scheme", "Product Code");
        n.isin = b.text("ISIN");
        n.registrarTxnNo = b.need("txnNo", "Transaction Number");
        n.tradeDate = b.date("tradeDate", "Transaction Date", true);
        n.units = b.num("units", "Units", true);
        n.amount = b.num("amount", "Amount", true);
        n.nav = b.num("nav", "Nav");
        n.price = b.num("price", "Price");
        n.loadAmount = b.num("load", "Load Amount");
        n.stt = b.num("stt", "STT");
        n.stampDuty = b.num("stampDuty", "Stamp Duty Charges");
        n.pan = c("PAN1") || null;
        n.guardianPan = c("GuardPanNo") || null;
        n.holder = { statusText: c("Status"), rowPan: n.pan, rowPanRole: "owner", guardianPan: n.guardianPan, jointPans: [c("PAN2"), c("PAN3")] };
        // The remark is kept as corroboration only; a folio correction is proved from the group's figures.
        const consolidation = /consolidat/i.test(c("Remarks"));
        n.cls = classifyKfintech({ typeCode: c("Transaction Type"), head: c("Transaction Head"), description: c("Transaction Description"), status: c("Transaction Status"), rejOriginalNo: c("RejTrnoOrgNo"), units: n.units?.num ?? null, amount: n.amount?.num ?? null });
        const lotId = b.text("Transaction ID");
        const purchaseNo = b.text("Purchase Transaction No");
        if ((lotId || purchaseNo) && c("Transaction Head").toUpperCase() === "R") {
          n.lot = {
            registrarLotId: lotId,
            purchaseTxnNo: purchaseNo,
            purchaseDate: b.date("purchaseDate", "Purchase Date"),
            purchaseUnits: b.num("purchaseUnits", "Purchase Units"),
            purchaseAmount: b.num("purchaseAmount", "Purchase Amount"),
          };
        }
        n.invariants = inv(MFSD201_INVARIANTS);
        n.attrs = {
          typeCode: c("Transaction Type"), head: c("Transaction Head"), description: c("Transaction Description"),
          sub: c("Transaction Sub"), flag: c("Transaction Flag"), status: c("Transaction Status"),
          loadPct: c("Load Percentage"), processDate: c("Process Date"), navDate: c("Nav Date"),
          toProductCode: c("ToProductCode") || undefined, hasSipRegistration: c("sipregslno") !== "",
          // The registration this instalment belongs to (= MFSD243 RegSlno, verified 8/9).
          sipRegistrationId: c("sipregslno") && c("sipregslno") !== "0" ? c("sipregslno") : undefined,
          schemeName: c("Fund Description") || undefined,
          rejectionLinksOriginal: c("RejTrnoOrgNo") !== "",
          consolidationRemark: consolidation || undefined,
          // STP legs of one instruction share the switch reference (and date).
          switchRef: c("Switch_Ref. No.") || undefined,
          eventCategory: n.cls.category,
          // The registrar's reason for a failed instalment, minimised: digits
          // (account / cheque / folio numbers) and PANs never stored.
          rejectionReason: n.cls.exception === "instalment_rejected" ? rejectionReasonText(c("Remarks")) : undefined,
        };
        break;
      }
      case "cams.r2": {
        n.amcCode = b.need("amc", "amc_code");
        n.folioNumber = b.need("folio", "folio_no");
        n.schemeCode = b.need("scheme", "prodcode");
        n.registrarTxnNo = b.need("txnNo", "trxnno");
        n.tradeDate = b.date("tradeDate", "traddate", true);
        n.units = b.num("units", "units", true);
        n.amount = b.num("amount", "amount", true);
        n.nav = b.num("nav", "purprice");
        n.stt = b.num("stt", "stt");
        n.stampDuty = b.num("stampDuty", "stamp_duty");
        n.loadAmount = b.num("load", "load");
        n.pan = c("pan") || null;
        // R2's `pan` is the GUARDIAN's on a minor row (verified 22/22).
        n.holder = { statusText: c("tax_status"), rowPan: n.pan, rowPanRole: "owner_or_guardian" };
        n.cls = classifyCams({
          flag: c("trxn_type_flag"), nature: c("trxn_nature"), typeCode: c("trxntype"), sipTrxnNo: c("siptrxnno"),
          status: c("trxnstat"), reversalCode: c("reversal_code"), originalTrxnNo: c("original_trxnno"),
        });
        n.invariants = inv(R2_INVARIANTS);
        n.attrs = {
          typeCode: c("trxntype"), flag: c("trxn_type_flag"), nature: c("trxn_nature").slice(0, 160), sub: c("trxnsubtyp"),
          status: c("trxnstat"), swflag: c("swflag"), hasSipRegistration: c("siptrxnno") !== "",
          // R2's own systematic reference; its link to WBR49 auto_trno is not evidenced.
          sipRef: c("siptrxnno") || undefined,
          schemeName: c("scheme") || undefined,
          hasSysRegnDate: c("sys_regn_date") !== "", targetSourceScheme: c("targ_src_scheme") || undefined,
          postDate: c("postdate"),
          eventCategory: n.cls.category,
        };
        break;
      }
      case "cams.r9": {
        n.amcCode = b.need("amc", "amc_code");
        n.folioNumber = b.need("folio", "foliochk");
        n.schemeCode = b.need("scheme", "product");
        n.asOfDate = b.date("asOfDate", "rep_date", true);
        n.units = b.num("units", "clos_bal", true);
        n.holdingValue = b.num("value", "rupee_bal");
        n.pan = c("pan_no") || null;
        n.guardianPan = c("guard_pan") || null;
        n.holder = { statusText: c("tax_status"), rowPan: n.pan, rowPanRole: "owner", guardianPan: n.guardianPan, jointPans: [c("joint1_pan"), c("joint2_pan")], dob: readIso(c("inv_dob")), asOf: n.asOfDate };
        n.attrs = { taxStatus: c("tax_status") || undefined, holdingNature: c("holding_nature") || undefined };
        break;
      }
      case "cams.wbr4": {
        n.amcCode = b.need("amc", "amc_code");
        n.folioNumber = b.need("folio", "foliochk");
        n.schemeCode = b.need("scheme", "product");
        n.asOfDate = b.date("asOfDate", "rep_date", true);
        n.units = b.num("units", "clos_bal", true);
        n.holdingValue = b.num("value", "rupee_bal");
        n.pan = c("pan_no") || null;
        n.guardianPan = c("guard_pan") || null;
        n.holder = { statusText: c("tax_status"), rowPan: n.pan, rowPanRole: "owner", guardianPan: n.guardianPan, jointPans: [c("joint1_pan"), c("joint2_pan")], asOf: n.asOfDate };
        n.attrs = { taxStatus: c("tax_status") || undefined, holdingNature: c("holding_nature") || undefined };
        break;
      }
      case "kfintech.mfsd203": {
        n.amcCode = b.need("amc", "Fund");
        n.folioNumber = b.need("folio", "Folio Number");
        n.schemeCode = b.need("scheme", "Product Code");
        n.isin = b.text("SchemeISIN");
        n.asOfDate = b.date("asOfDate", "Report Date", true);
        n.units = b.num("units", "Balance", true);
        n.nav = b.num("nav", "NAV");
        n.holdingValue = b.num("value", "AUM");
        n.pan = c("PAN") || null;
        // No holder-status column: the owner type comes from the folio's master, or the PAN's holder letter.
        n.holder = { statusText: null, rowPan: n.pan, rowPanRole: "owner" };
        n.attrs = {
          pledgedUnits: c("Pledged") || undefined, lastTransactionDate: c("Transaction Date") || undefined,
          holdMode: c("Hold Mode") || undefined, dividendOption: c("Dividend Option") || undefined, toDate: c("To Date") || undefined,
        };
        break;
      }
      case "cams.wbr10": {
        n.amcCode = b.need("amc", "amc_code");
        n.folioNumber = b.need("folio", "folio_chk");
        // CAMS prodcode = amc_code + scheme code (R2 1,334/1,334, R9 1,237/1,237;
        // WBR4 product = amc_code + WBR10 sch_code on every shared folio).
        const sch = b.need("scheme", "sch_code");
        n.schemeCode = n.amcCode && sch ? `${n.amcCode}${sch}` : null;
        n.registrarTxnNo = b.need("txnNo", "trxnno");
        n.tradeDate = b.date("tradeDate", "traddate", true);
        const nonFin = c("trxn_sign").toUpperCase() === "N";
        n.units = b.num("units", "units", !nonFin);
        n.amount = b.num("amount", "amount", !nonFin);
        n.nav = b.num("nav", "purprice");
        n.stt = b.num("stt", "stt");
        n.stampDuty = b.num("stampDuty", "stamp_duty");
        // No trxn_type_flag, trxn_nature or siptrxnno in this layout: the trxntype
        // code alone (PMF1S, P1FCS, …) is not a verified classification.
        n.cls = nonFin ? nonFinancial(c("trxntype")) : classifyCams({ flag: "", nature: "", typeCode: c("trxntype"), sipTrxnNo: "", status: c("trxnstat") });
        n.invariants = inv(["amc_code", "folio_chk", "sch_code", "trxnno", "traddate", "postdate", "trxntype", "purprice", "brokcode"]);
        n.holder = { statusText: c("tax_status"), rowPan: null, rowPanRole: "owner_or_guardian" };
        n.attrs = { typeCode: c("trxntype"), sign: c("trxn_sign"), status: c("trxnstat"), sub: c("trxnsubtyp"), postDate: c("postdate") };
        break;
      }
      case "cams.wbr49":
      case "kfintech.mfsd243":
      case "kfintech.mfsd230": {
        const L = REGISTRATION_COLS[layout.id];
        n.amcCode = b.need("amc", L.amc);
        n.folioNumber = b.need("folio", L.folio);
        n.schemeCode = b.need("scheme", L.scheme);
        n.registrarTxnNo = L.id ? b.text(L.id) : null; // the registration's own id
        n.amount = b.num("amount", L.amount, true);
        n.tradeDate = b.date("startDate", L.start, true);
        const end = b.date("endDate", L.end);
        const reg = b.date("regDate", L.reg);
        const cease = L.cease ? b.date("ceaseDate", L.cease) : null;
        const pauseFrom = L.pauseFrom ? b.date("pauseFrom", L.pauseFrom) : null;
        const pauseTo = L.pauseTo ? b.date("pauseTo", L.pauseTo) : null;
        const terminate = L.terminate ? b.date("terminateDate", L.terminate) : null;
        n.pan = L.pan ? c(L.pan) || null : null;
        // Whose PAN a registration report prints for a minor is not evidenced: read it as owner-or-guardian.
        n.holder = { statusText: null, rowPan: n.pan, rowPanRole: "owner_or_guardian" };
        n.attrs = {
          kind: c(L.kind), frequency: c(L.freq), startDate: n.tradeDate ?? undefined, endDate: end ?? undefined, registrationDate: reg ?? undefined,
          registrarStatus: L.status ? c(L.status) || undefined : undefined,
          ceaseDate: cease ?? undefined, terminateDate: terminate ?? undefined, pauseFrom: pauseFrom ?? undefined, pauseTo: pauseTo ?? undefined,
          target: L.target.map((t) => c(t)).filter(Boolean).join("-") || undefined,
          installments: L.installments ? c(L.installments) || undefined : undefined,
          paidInstallments: L.paid ? c(L.paid) || undefined : undefined,
          hasRegistrationId: !!n.registrarTxnNo,
        };
        break;
      }
      case "kfintech.mfsd211": {
        n.amcCode = b.need("amc", "Fund");
        n.folioNumber = b.need("folio", "Folio");
        n.schemeCode = b.text("Product Code");
        n.asOfDate = b.date("asOfDate", "Report Date");
        n.pan = c("PAN Number") || null;
        n.guardianPan = c("GuardPanNo") || null;
        n.holder = { statusText: c("StatusDesc"), rowPan: n.pan, rowPanRole: "owner", guardianPan: n.guardianPan, jointPans: [c("PAN2"), c("PAN3")], dob: readIso(c("Date of Birth")), asOf: n.asOfDate };
        n.attrs = { taxStatus: c("Tax Status") || undefined, statusDesc: c("StatusDesc") || undefined, holdingMode: c("Mode of Holding Description") || undefined };
        break;
      }
    }

    if (n.registrarTxnNo && n.amcCode && layout.identityScheme) {
      n.economicKey = `${layout.identityScheme}:${n.amcCode}:${n.registrarTxnNo}`;
    }
    // The staged PAN token is the LEGAL OWNER's own PAN — never a guardian's or
    // Karta's that happened to sit in the row's PAN column.
    n.owner = n.holder ? deriveHolder(n.holder) : null;
    n.panToken = panToken(tenantId, n.owner ? n.owner.ownerPan : n.pan);
    n.guardianPanToken = panToken(tenantId, n.owner ? n.owner.guardianPan : n.guardianPan);
    if (n.owner) {
      n.attrs.holder = {
        ownerType: n.owner.ownerType, ownerTypeSource: n.owner.ownerTypeSource, sourcePanRole: n.owner.sourcePanRole,
        jointHolderTokens: n.owner.jointPans.map((p) => panToken(tenantId, p)), flags: n.owner.flags.length ? n.owner.flags : undefined,
        // Display masks only (last four characters) — the PAN itself is never kept.
        jointHolderMasks: n.owner.jointPans.map((p) => panMask(p)),
        guardianMask: panMask(n.owner.guardianPan),
        ownerMask: panMask(n.owner.ownerPan),
      };
    }
    for (const k of Object.keys(n.attrs)) if (n.attrs[k] === undefined) delete n.attrs[k];

    return { ...n, rowNo: row.rowNo, rowHash, recordKind: layout.recordKind, valid: b.issues.length === 0, issues: b.issues, src: b.src };
  });
  liftToColumnPrecision(out);
  return out;
}

const DECIMAL_FIELDS = ["units", "amount", "nav", "price", "loadAmount", "stt", "stampDuty", "holdingValue"] as const;

/**
 * A registrar drops trailing zeros: in the verified MFSD201 the same NAV column
 * prints 2, 3 or 4 decimals ("328.1" is 328.1000). The precision a figure is
 * known to is therefore the COLUMN's — the most decimals any row of the file
 * printed in it — not the digits one cell happens to show. Only `dp` (which
 * drives the reconciliation tolerances) is lifted; the stored text is never
 * changed.
 */
export function liftToColumnPrecision(rows: NormRow[]): void {
  for (const f of DECIMAL_FIELDS) {
    let dp = 0;
    for (const r of rows) dp = Math.max(dp, r[f]?.dp ?? 0);
    for (const r of rows) { const d = r[f]; if (d && d.dp < dp) r[f] = { ...d, dp }; }
  }
}
