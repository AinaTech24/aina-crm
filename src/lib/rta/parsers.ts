import { buildHeaderIndexMap, RtaLayoutError } from "../integrations/cams-feed-parser";
import { parseCsv } from "./csv";
import { readDate, readNumber, detectDateOrder, type DateOrder } from "./values";

/**
 * Parsers for RTA file types beyond the daily transaction feed.
 *
 * The CAMS / KFintech distributor file formats are not publicly documented;
 * the aliases below are the column spellings this importer has met. Each
 * parser maps columns by HEADER (searching the first few lines, past any title
 * rows), reads every value strictly (lib/rta/values.ts) and returns
 * `{ rows, rejects, notes }`:
 *   - a row whose mandatory value is blank or unreadable is a REJECT with its
 *     reason — never a 0, never today's date;
 *   - a file whose header is not recognised, or lacks a required column,
 *     throws RtaLayoutError and imports nothing. (They used to fall back to a
 *     fixed column order and import whatever sat there.)
 */

export type CanonicalSipRejection = {
  pan: string;
  folioNumber: string;
  amcName: string;
  schemeName: string;
  rejectionDate: string; // YYYY-MM-DD
  amount: number;
  reason: string;        // human-readable reason
  reasonCode?: string;
  /** 1-based line in the decoded file, for error messages. */
  line: number;
};

export type CanonicalBrokerageRow = {
  pan: string;
  folioNumber: string;
  amcCode: string;
  schemeCode: string;
  schemeName: string;
  brokerageType: "upfront" | "trail" | "b30" | "other";
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  aumAmount: number;
  brokerageRate: number;
  brokerageAmount: number;
  /** 1-based line in the decoded file, for error messages. */
  line: number;
};

export type CanonicalFolioRow = {
  pan: string;
  folioNumber: string;
  amcCode: string;
  amcName: string;
  schemeCode: string;
  schemeName: string;
  units: number;
  openedAt?: string; // YYYY-MM-DD
  closedAt?: string; // YYYY-MM-DD
  value?: number;
  /** 1-based line in the decoded file, for error messages. */
  line: number;
};

export type CanonicalSipRow = {
  pan: string;
  folioNumber: string;
  schemeCode: string;
  schemeName: string;
  amount: number;
  frequency: "monthly" | "quarterly" | "weekly" | "fortnightly" | "yearly";
  sipDate?: string;
  startDate?: string;
  endDate?: string;
  nextInstallmentAt?: string;
  mandateRefNo?: string;
  /** The day the registration was cancelled (CAMS CEASE_DATE). */
  ceaseDate?: string;
  /** The registrar's registration type (CAMS AUT_TRNTYP): SIP, STP, SWP… */
  registrationType?: string;
  /** The scheme money is transferred INTO — only an STP has one (CAMS TARGET_SCH). */
  targetScheme?: string;
  /** 1-based line in the decoded file, for error messages. */
  line: number;
};

export type CanonicalMandateRow = {
  pan: string;
  mandateRefNo: string;
  bankAccountMasked?: string;
  ifsc?: string;
  amountLimit?: number;
  registeredAt?: string;
  expiresAt?: string;
  status: "pending" | "active" | "expired" | "rejected" | "cancelled";
  /** 1-based line in the decoded file, for error messages. */
  line: number;
};

export type CanonicalAumRow = {
  pan: string;
  /** First holder's name when the report carries it (CAMS WBR22 has INV_NAME
   *  but no PAN) — used to name a client stood up from this file alone. */
  investorName?: string;
  folioNumber: string;
  schemeCode: string;
  schemeName: string;
  units: number;
  nav?: number;
  aumValue: number;
  /**
   * ARN this row's slice was transacted under (BROK_DLR_CODE on CAMS WBR22,
   * Agent Code on KFintech). A firm with several ARNs gets one statement per
   * broker code, and one folio's holding in a scheme can be split across them —
   * so the merge has to key on it, or the second statement overwrites the first.
   */
  arn?: string;
  /** 1-based line in the decoded file, for error messages. */
  line: number;
};

// ── Default mapping layouts & aliases ───────────────────────────────────

const SIP_REJECT_ALIASES: Record<string, string[]> = {
  amcName: ["AMC", "AMC_NAME", "AMC NAME", "FMIM_CODE", "MUTUAL_FUND", "AMC_CD", "AMC_DESC"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO"],
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER", "PAN NUMBER"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME"],
  rejectionDate: ["REJECT_DATE", "REJECTION_DATE", "REJ_DATE", "REJECT DATE", "REJECTION DATE", "DATE", "REJ_DT", "ORDER DATE", "ORDER_DATE"],
  amount: ["AMOUNT", "AMT", "TXN_AMT", "TXN_AMOUNT", "TRANS_AMT", "SIP_AMOUNT", "INSTALLMENT AMT", "INSTALLMENT_AMT", "INSTALLMENT AMOUNT", "INSTALLMENT_AMOUNT"],
  reasonCode: ["REASON_CODE", "REJ_CODE", "REJECT_CODE", "REASON CODE", "REJ CODE", "REJ_REASON", "REJ REASON", "FAIL_CODE"],
  reason: ["REASON", "REASON_DESC", "REASON DESCRIPTION", "REMARK", "REMARKS", "REJ_DESC", "REJECT_DESC", "REJECTION_REASON", "ORDER REMARK", "ORDER_REMARK", "ORDER STATUS", "ORDER_STATUS"],
};

const BROKERAGE_ALIASES: Record<string, string[]> = {
  amcCode: ["AMC", "AMC_CODE", "AMCCOD", "AMC_CD", "FUND", "FUND CODE"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCHEME"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME", "FUND DESCRIPTION"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO", "ACCOUNT NUMBER", "ACCOUNT NO"],
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER"],
  brokerageType: ["TYPE", "BROKERAGE_TYPE", "COMMISSION_TYPE", "BROK_TYPE", "COMM_TYPE", "BROKERAGE HEAD", "BRKAGE_TYPE", "FEE TYPE", "BRKAGE TYPE"],
  periodStart: ["PERIOD_START", "START_DATE", "FROM_DATE", "FROM DATE", "PERIOD START", "START DATE", "BRKAGE_FROM", "BRKAGE FROM"],
  periodEnd: ["PERIOD_END", "END_DATE", "TO_DATE", "TO DATE", "PERIOD END", "END DATE", "PROC_DATE", "PROCESS DATE"],
  aumAmount: ["AUM", "AVG_AUM", "AVERAGE_AUM", "AUM_AMOUNT", "AVG AUM", "AVERAGE AUM", "AVERAGE ASSETS", "DAILY PRODUCT", "PLOT_AMOUNT", "AMOUNT (IN RS.)"],
  brokerageRate: ["RATE", "BROKERAGE_RATE", "COMMISSION_RATE", "BROK_RATE", "COMM_RATE", "BRKAGE_RATE", "PERCENTAGE (%)", "PERCENTAGE", "BRKAGE RATE"],
  brokerageAmount: ["BROKERAGE_AMOUNT", "COMMISSION_AMOUNT", "BROK_AMOUNT", "COMM_AMOUNT", "BRKAGE_AMT", "BROKERAGE (IN RS.)", "BROKERAGE IN RS", "BRKAGE AMT", "BRKAGE_AMOUNT"],
};

const FOLIO_MST_ALIASES: Record<string, string[]> = {
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER", "PAN NUMBER"],
  investorName: ["INV_NAME", "INVNAME", "INVESTOR_NAME", "INVESTOR NAME", "INV NAME", "NAME", "HOLDER_NAME", "FIRST_HOLDER"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO", "FOLIOCHK", "ACCOUNT NUMBER", "ACCOUNT NO"],
  amcCode: ["AMC", "AMC_CODE", "AMCCOD", "AMC_CD", "FUND", "FUND CODE"],
  amcName: ["AMC_NAME", "AMC NAME", "FMIM_CODE", "MUTUAL_FUND", "AMC_DESC"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCH_CD", "PRODUCT"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME", "FUND DESCRIPTION", "FUND_DESCRIPTION", "SCH_DESC"],
  units: ["UNITS", "UNIT", "QTY", "QUANTITY", "NO_OF_UNITS", "NO OF UNITS", "UNIT_BAL", "BALANCE_UNITS", "CURRENT_UNITS", "CLOS_BAL", "CLOSING_BALANCE", "CLOSE_BAL", "CLOS BAL"],
  openedAt: ["OPEN_DATE", "OPENDT", "OPENED_AT", "CREATION_DATE", "OPEN DATE", "OPEN_DT"],
  closedAt: ["CLOSE_DATE", "CLOSEDT", "CLOSED_AT", "CLOSE DATE", "CLOSE_DT"],
  value: ["AUM", "VALUE", "VALUATION", "AMOUNT", "CURR_VAL", "CURRENT_VALUE", "RUPEE_BAL", "RUPEE BAL", "CLOSING_ASSETS", "MARKET_VALUE", "AMOUNT_BAL"],
};

const SIP_BOOK_ALIASES: Record<string, string[]> = {
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCH_CD"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME"],
  // AUTO_AMOUNT / PERIODICITY / PERIOD_DAY are the CAMS WBR49 ("Systematic
  // Registration") spellings. Without them the header lookup found nothing and
  // — because resolveHeader returns ONLY what it detected, never merged with the
  // positional fallback — `cols[undefined]` yielded "" for every row, so
  // `parseFloat("") || 0` wrote 8,140 SIPs at amount 0 with no error anywhere.
  // CAMS also ships this report with every header cut to TEN characters
  // (dBase-style): AUTO_AMOUN, PERIODICIT. Without those spellings a
  // 1,001-row CAMS book on Nimesh C Shah Financial Services imported every SIP
  // at Rs 0 (6 Oct 2026).
  amount: ["AMOUNT", "AMT", "TXN_AMT", "TXN_AMOUNT", "TRANS_AMT", "SIP_AMOUNT", "INSTALLMENT_AMOUNT", "AUTO_AMOUNT", "AUTO_AMT", "AUTO_AMOUN"],
  frequency: ["FREQUENCY", "FREQ", "SIP_FREQ", "SIP_FREQUENCY", "PERIODICITY", "PERIODICIT"],
  sipDate: ["SIP_DATE", "DATE", "SIP_DAY", "DAY", "PERIOD_DAY"],
  startDate: ["START_DATE", "SIP_START_DATE", "FROM_DATE", "FROM DATE", "START DATE"],
  endDate: ["END_DATE", "SIP_END_DATE", "TO_DATE", "TO DATE", "END DATE"],
  nextInstallmentAt: ["NEXT_DEBIT_DATE", "NEXT_INSTALLMENT_DATE", "NEXT_DUE_DATE", "NEXT_DATE", "NEXT_DEBIT", "NEXT_DT"],
  mandateRefNo: ["MANDATE_ID", "UMRN", "MANDATE_REF", "MANDATE_REF_NO", "MANDATE REF", "UMRN_NO"],
  // A registration report lists cancelled and finished SIPs too. Without the
  // cease date every row imported as 'active', and the SIP book counted SIPs
  // that stopped years ago.
  ceaseDate: ["CEASE_DATE", "CEASED_DATE", "SIP_CEASE_DATE", "CANCEL_DATE", "CANCELLATION_DATE", "TERMINATION_DATE"],
  registrationType: ["AUT_TRNTYP", "AUTO_TRNTYP", "AUTO_TRN_TYPE", "REGISTRATION_TYPE"],
  targetScheme: ["TARGET_SCH", "TARGET_SCHEME", "TARGET_SCHEME_CODE", "TO_SCHEME"],
};

const MANDATE_STATUS_ALIASES: Record<string, string[]> = {
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER"],
  mandateRefNo: ["MANDATE_ID", "UMRN", "MANDATE_REF", "MANDATE_REF_NO", "MANDATE REF", "UMRN_NO", "REF_NO", "REF_NUM"],
  bankAccountMasked: ["BANK_AC_NO", "ACCOUNT_NO", "ACCT_NO", "BANK_ACC", "ACC_NO", "ACCOUNT NO", "BANK_ACCOUNT"],
  ifsc: ["IFSC", "IFSC_CODE", "IFSC CODE", "IFS_CODE"],
  amountLimit: ["LIMIT", "AMOUNT_LIMIT", "MANDATE_AMOUNT", "MAX_AMOUNT", "AMOUNT", "LIMIT_AMT"],
  registeredAt: ["REG_DATE", "REGISTERED_AT", "REG_DT", "REG DATE", "APPROVE_DATE"],
  expiresAt: ["EXP_DATE", "EXPIRES_AT", "EXP_DT", "EXP DATE", "END_DATE"],
  status: ["STATUS", "MANDATE_STATUS", "APPROVAL_STATUS", "STATUS_DESC"],
};

const AUM_STATEMENT_ALIASES: Record<string, string[]> = {
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER", "PAN NUMBER"],
  investorName: ["INV_NAME", "INVNAME", "INVESTOR_NAME", "INVESTOR NAME", "INV NAME", "NAME", "HOLDER_NAME", "FIRST_HOLDER"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO", "ACCOUNT NUMBER", "SCHEME_FOLIO_NUMBER"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCH_CD", "PRODUCT"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME", "FUND DESCRIPTION"],
  units: ["UNITS", "UNIT", "QTY", "QUANTITY", "NO_OF_UNITS", "NO OF UNITS", "UNIT_BAL", "BALANCE_UNITS", "CURRENT_UNITS", "CLOS_BAL"],
  nav: ["NAV", "RATE", "NAV_RATE", "PRICE"],
  aumValue: ["AUM", "VALUE", "VALUATION", "AMOUNT", "CURR_VAL", "CURRENT_VALUE", "AUM_VALUE", "CLOSING_ASSETS", "CLOSING ASSETS", "RUPEE_BAL", "MARKET_VALUE"],
  arn: ["BROK_DLR_CODE", "BROK DLR CODE", "BROKER_CODE", "BROKER CODE", "AGENT_CODE", "AGENT CODE", "ARN", "ARN_CODE", "DISTRIBUTOR_CODE", "BROKER"],
};

// ── Shared reading machinery ────────────────────────────────────────────

/** A row a parser would not turn into a record, and why (1-based file line). */
export type ParseReject = { line: number; reason: string };
export type Parsed<T> = { rows: T[]; rejects: ParseReject[]; notes: string[] };

/** How far into the file to look for the header (title rows sit above it). */
const HEADER_SCAN_LINES = 10;

type Layout = {
  lines: string[];
  delim: string;
  headerAt: number;
  header: string[];
  indexMap: Record<string, number>;
};

/**
 * Find the header and map its columns. Throws RtaLayoutError when no line in
 * the first few carries a key column, or a required column is missing — the
 * parsers no longer fall back to fixed column positions, which imported
 * whatever happened to sit in columns 0..N (header row included) of any file
 * they did not recognise.
 *
 * `required` lists alternatives: each inner array is satisfied by ANY of its
 * fields being present.
 */
function readLayout(
  text: string,
  report: string,
  aliases: Record<string, string[]>,
  keyFields: string[],
  required: Array<{ any: string[]; label: string }>
): Layout {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < Math.min(HEADER_SCAN_LINES, lines.length); i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    const delim = getDelimiter(line);
    const header = splitLine(line, delim);
    const indexMap = buildHeaderIndexMap(header, aliases);
    if (!keyFields.some((f) => indexMap[f] !== undefined)) continue;
    const missing = required.filter((r) => !r.any.some((f) => indexMap[f] !== undefined)).map((r) => r.label);
    if (missing.length) {
      throw new RtaLayoutError(
        `This ${report} is missing required column(s): ${missing.join(", ")}. Nothing was imported. ` +
          `Header read: ${header.map((h) => h.trim()).slice(0, 40).join(", ").slice(0, 400)}`
      );
    }
    return { lines, delim, headerAt: i, header, indexMap };
  }
  const first = (lines.find((l) => l.trim()) ?? "").slice(0, 200);
  throw new RtaLayoutError(
    `Unrecognised ${report} layout — no header row with a ${keyFields.join(" / ")} column in the first ${HEADER_SCAN_LINES} lines. ` +
      `Nothing was imported (files are no longer read by fixed column positions). First line: ${first}`
  );
}

/** Iterate data lines after the header, with a value reader per row. */
function* dataRows(layout: Layout): Generator<{ line: number; val: (field: string) => string; short: boolean }> {
  const maxIdx = Math.max(0, ...Object.values(layout.indexMap));
  for (let i = layout.headerAt + 1; i < layout.lines.length; i++) {
    const raw = layout.lines[i];
    if (!raw || !raw.trim()) continue;
    const cols = splitLine(raw.trim(), layout.delim);
    const val = (field: string) => {
      const idx = layout.indexMap[field];
      return idx === undefined ? "" : (cols[idx] ?? "").trim();
    };
    yield { line: i + 1, val, short: cols.length <= maxIdx };
  }
}

/** File-level date order from every value of the given date fields. */
function dateOrderOf(layout: Layout, fields: string[]): DateOrder | "conflict" {
  const samples: string[] = [];
  for (const { val } of dataRows(layout)) {
    for (const f of fields) {
      const v = val(f);
      if (v) samples.push(v);
    }
    if (samples.length > 5000) break;
  }
  return detectDateOrder(samples);
}

class RowError extends Error {}

/** Mandatory number: blank or unreadable rejects the row. */
function needNumber(val: (f: string) => string, field: string, label: string): number {
  const r = readNumber(val(field));
  if (!r.ok) throw new RowError(`${label} ${r.reason}`);
  if (r.value === null) throw new RowError(`${label} is blank`);
  return r.value;
}

/** Optional number: blank → undefined, unreadable rejects the row. */
function optNumber(val: (f: string) => string, field: string, label: string): number | undefined {
  const r = readNumber(val(field));
  if (!r.ok) throw new RowError(`${label} ${r.reason}`);
  return r.value === null ? undefined : r.value;
}

/** Date under the file's order; a mixed-order file accepts only self-evident dates. */
function dateValue(raw: string, order: DateOrder | "conflict", label: string): string | undefined {
  if (!raw) return undefined;
  let use: DateOrder = order === "conflict" ? "dmy" : order;
  if (order === "conflict") {
    const m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}/);
    if (m) {
      if (+m[1] > 12) use = "dmy";
      else if (+m[2] > 12) use = "mdy";
      else throw new RowError(`${label} "${raw}" is ambiguous — this file writes dates both day-first and month-first`);
    }
  }
  const r = readDate(raw, use);
  if (!r.ok) throw new RowError(`${label} ${r.reason}`);
  return r.value ?? undefined;
}

function needDate(raw: string, order: DateOrder | "conflict", label: string): string {
  const d = dateValue(raw, order, label);
  if (!d) throw new RowError(`${label} is blank — a missing date is never replaced with today`);
  return d;
}

/** Run one row's reader; a RowError becomes a reject, anything else propagates. */
function collect<T>(out: Parsed<T>, line: number, read: () => T | null) {
  try {
    const row = read();
    if (row) out.rows.push(row);
  } catch (e) {
    if (e instanceof RowError) out.rejects.push({ line, reason: e.message });
    else throw e;
  }
}

// ── SIP rejection report ────────────────────────────────────────────────

/**
 * The registrar's reason text is used as written. (An earlier table here gave
 * codes 001–008 fixed meanings — "Insufficient funds", "Account closed" … —
 * that no registrar document in this codebase supports; a code with no text
 * now says so instead of being given an invented meaning.)
 */
export function parseSipRejectionReport(text: string, _source: "cams" | "kfintech" | string): Parsed<CanonicalSipRejection> {
  const out: Parsed<CanonicalSipRejection> = { rows: [], rejects: [], notes: [] };
  if (!text.trim()) return out;
  const layout = readLayout(text, "SIP rejection report", SIP_REJECT_ALIASES, ["folioNumber", "pan"], [
    { any: ["folioNumber", "pan"], label: "folio number or PAN" },
    { any: ["rejectionDate"], label: "rejection date" },
    { any: ["amount"], label: "amount" },
  ]);
  const order = dateOrderOf(layout, ["rejectionDate"]);
  for (const { line, val, short } of dataRows(layout)) {
    if (short) { out.rejects.push({ line, reason: "row is shorter than the header — truncated or mis-delimited" }); continue; }
    collect(out, line, () => {
      if (!val("folioNumber") && !val("pan")) throw new RowError("row carries no folio number or PAN");
      const reasonCode = val("reasonCode");
      const reasonText = val("reason");
      return {
        amcName: val("amcName"),
        folioNumber: val("folioNumber"),
        pan: val("pan"),
        schemeName: val("schemeName"),
        rejectionDate: needDate(val("rejectionDate"), order, "rejection date"),
        amount: needNumber(val, "amount", "amount"),
        reasonCode,
        reason: reasonText || (reasonCode ? `Reason code ${reasonCode} (no description in the file)` : "No reason given in the file"),
        line,
      };
    });
  }
  return out;
}

// ── Monthly brokerage statement ─────────────────────────────────────────

export function parseBrokerageStatement(text: string, _source: "cams" | "kfintech" | string): Parsed<CanonicalBrokerageRow> {
  const out: Parsed<CanonicalBrokerageRow> = { rows: [], rejects: [], notes: [] };
  if (!text.trim()) return out;
  const layout = readLayout(text, "brokerage statement", BROKERAGE_ALIASES, ["folioNumber", "pan", "schemeCode", "amcCode"], [
    { any: ["brokerageAmount"], label: "brokerage amount" },
    { any: ["periodStart"], label: "period start date" },
    { any: ["periodEnd"], label: "period end date" },
  ]);
  const order = dateOrderOf(layout, ["periodStart", "periodEnd"]);
  for (const { line, val, short } of dataRows(layout)) {
    if (short) { out.rejects.push({ line, reason: "row is shorter than the header — truncated or mis-delimited" }); continue; }
    collect(out, line, () => {
      const typeRaw = val("brokerageType").toUpperCase();
      let brokerageType: CanonicalBrokerageRow["brokerageType"] = "other";
      if (typeRaw.includes("UPFRONT")) brokerageType = "upfront";
      else if (typeRaw.includes("TRAIL")) brokerageType = "trail";
      else if (typeRaw.includes("B30") || typeRaw.includes("B-30")) brokerageType = "b30";
      return {
        amcCode: val("amcCode"),
        schemeCode: val("schemeCode"),
        schemeName: val("schemeName"),
        folioNumber: val("folioNumber"),
        pan: val("pan"),
        brokerageType,
        periodStart: needDate(val("periodStart"), order, "period start"),
        periodEnd: needDate(val("periodEnd"), order, "period end"),
        aumAmount: optNumber(val, "aumAmount", "AUM") ?? 0,
        brokerageRate: optNumber(val, "brokerageRate", "rate") ?? 0,
        brokerageAmount: needNumber(val, "brokerageAmount", "brokerage amount"),
        line,
      };
    });
  }
  return out;
}

// ── Folio Master Dump ───────────────────────────────────────────────────

export function parseFolioMasterDump(text: string, _source: "cams" | "kfintech" | string): Parsed<CanonicalFolioRow> {
  const out: Parsed<CanonicalFolioRow> = { rows: [], rejects: [], notes: [] };
  if (!text.trim()) return out;
  const layout = readLayout(text, "folio master", FOLIO_MST_ALIASES, ["folioNumber", "pan"], [
    { any: ["folioNumber"], label: "folio number" },
    { any: ["pan"], label: "PAN" },
    { any: ["amcCode"], label: "AMC code" },
    { any: ["schemeCode"], label: "scheme code" },
    { any: ["units"], label: "units" },
  ]);
  const order = dateOrderOf(layout, ["openedAt", "closedAt"]);
  for (const { line, val, short } of dataRows(layout)) {
    if (short) { out.rejects.push({ line, reason: "row is shorter than the header — truncated or mis-delimited" }); continue; }
    collect(out, line, () => ({
      pan: val("pan"),
      folioNumber: val("folioNumber"),
      amcCode: val("amcCode"),
      amcName: val("amcName") || val("amcCode"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      units: needNumber(val, "units", "units"),
      openedAt: dateValue(val("openedAt"), order, "open date"),
      closedAt: dateValue(val("closedAt"), order, "close date"),
      value: optNumber(val, "value", "value"),
      line,
    }));
  }
  return out;
}

// ── Active SIP Book ─────────────────────────────────────────────────────

export function parseSipBook(text: string, _source: "cams" | "kfintech" | string): Parsed<CanonicalSipRow> {
  const out: Parsed<CanonicalSipRow> = { rows: [], rejects: [], notes: [] };
  if (!text.trim()) return out;
  const layout = readLayout(text, "SIP register", SIP_BOOK_ALIASES, ["folioNumber", "pan"], [
    { any: ["folioNumber"], label: "folio number" },
    { any: ["amount"], label: "instalment amount" },
  ]);

  // CAMS calls the scheme-name column plainly `SCHEME`, which is too generic to
  // sit in SIP_BOOK_ALIASES: buildHeaderIndexMap takes the FIRST header matching
  // any alias, so a file carrying both `SCHEME` (a code) and `SCHEME_NAME` would
  // pick the wrong one. Resolve it only as a fallback, once the precise aliases
  // have had their chance.
  if (layout.indexMap.schemeName === undefined) {
    const generic = buildHeaderIndexMap(layout.header, { schemeName: ["SCHEME"] });
    if (generic.schemeName !== undefined) layout.indexMap.schemeName = generic.schemeName;
  }
  if (layout.indexMap.schemeCode === undefined && layout.indexMap.schemeName === undefined) {
    throw new RtaLayoutError(`This SIP register has no scheme code or scheme name column. Nothing was imported. Header read: ${layout.header.join(", ").slice(0, 400)}`);
  }
  const hasFrequency = layout.indexMap.frequency !== undefined;
  if (!hasFrequency) {
    out.notes.push("This SIP register has no frequency column, so every SIP in it was read as monthly.");
  }
  const order = dateOrderOf(layout, ["startDate", "endDate", "nextInstallmentAt", "ceaseDate"]);

  for (const { line, val, short } of dataRows(layout)) {
    if (short) { out.rejects.push({ line, reason: "row is shorter than the header — truncated or mis-delimited" }); continue; }
    collect(out, line, () => {
      // Many CRM-exported active-SIP reports carry only the scheme NAME, no code.
      // Fall back to the name as the code so the SIP row still keys + imports.
      const schemeName = val("schemeName");
      const frequency = hasFrequency ? readFrequency(val("frequency")) : "monthly";
      return {
        pan: val("pan"),
        folioNumber: val("folioNumber"),
        schemeCode: val("schemeCode") || schemeName,
        schemeName,
        amount: needNumber(val, "amount", "instalment amount"),
        frequency,
        sipDate: val("sipDate") || undefined,
        startDate: sipDate(val("startDate"), order, "start date"),
        endDate: sipDate(val("endDate"), order, "end date"),
        nextInstallmentAt: dateValue(val("nextInstallmentAt"), order, "next instalment date"),
        mandateRefNo: val("mandateRefNo") || undefined,
        ceaseDate: sipDate(val("ceaseDate"), order, "cease date"),
        registrationType: val("registrationType") || undefined,
        targetScheme: val("targetScheme") || undefined,
        line,
      };
    });
  }
  return out;
}

/**
 * A SIP register date. Two documented quirks of CAMS WBR49:
 *   - it writes US dates with a clock — "2/9/2010 12:00 AM" is 9 FEB — so a
 *     date carrying an AM/PM clock is read month-first;
 *   - a blank spreadsheet cell comes out as Excel's day zero (1899/1900), which
 *     is not a SIP date; anything before 1950 is treated as blank.
 */
function sipDate(raw: string, order: DateOrder | "conflict", label: string): string | undefined {
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)$/i);
  const iso = us ? dateValue(`${us[1]}/${us[2]}/${us[3]}`, "mdy", label) : dateValue(raw, order, label);
  return iso && iso >= "1950-01-01" ? iso : undefined;
}

/**
 * CAMS WBR49 frequency codes, as this importer documents them from real files:
 * OM once a month, OW once a week, Q / OQ quarterly, OF / FN fortnightly,
 * OY / Y yearly — plus the plain words. Anything else (including D, daily,
 * which the SIP book has no slot for) rejects the row rather than being read
 * as monthly.
 */
function readFrequency(raw: string): CanonicalSipRow["frequency"] {
  const f = raw.trim().toLowerCase();
  if (f === "om" || f === "m" || f.includes("month")) return "monthly";
  if (f === "ow" || f === "w" || f.includes("weekly")) return "weekly";
  if (f === "q" || f === "oq" || f.includes("quarter")) return "quarterly";
  if (f === "of" || f === "fn" || f.includes("fortnight")) return "fortnightly";
  if (f === "oy" || f === "y" || f.includes("year") || f.includes("annual")) return "yearly";
  throw new RowError(f ? `frequency "${raw.trim()}" is not one this importer reads — not assumed monthly` : "frequency is blank");
}

// ── NACH Mandate Status ─────────────────────────────────────────────────

export function parseMandateStatus(text: string, _source: "cams" | "kfintech" | string): Parsed<CanonicalMandateRow> {
  const out: Parsed<CanonicalMandateRow> = { rows: [], rejects: [], notes: [] };
  if (!text.trim()) return out;
  const layout = readLayout(text, "mandate status report", MANDATE_STATUS_ALIASES, ["mandateRefNo", "pan"], [
    { any: ["mandateRefNo"], label: "mandate reference / UMRN" },
    { any: ["pan"], label: "PAN" },
    { any: ["status"], label: "status" },
  ]);
  const order = dateOrderOf(layout, ["registeredAt", "expiresAt"]);
  for (const { line, val, short } of dataRows(layout)) {
    if (short) { out.rejects.push({ line, reason: "row is shorter than the header — truncated or mis-delimited" }); continue; }
    collect(out, line, () => ({
      pan: val("pan"),
      mandateRefNo: val("mandateRefNo"),
      bankAccountMasked: val("bankAccountMasked") || undefined,
      ifsc: val("ifsc") || undefined,
      amountLimit: optNumber(val, "amountLimit", "amount limit"),
      registeredAt: dateValue(val("registeredAt"), order, "registration date"),
      expiresAt: dateValue(val("expiresAt"), order, "expiry date"),
      status: readMandateStatus(val("status")),
      line,
    }));
  }
  return out;
}

/**
 * Mandate status by WHOLE phrase, not substring: "Inactive" used to contain
 * "active" and "Not Approved" to contain "approved", so both read as active.
 * A status this importer does not know rejects the row.
 */
function readMandateStatus(raw: string): CanonicalMandateRow["status"] {
  const s = raw.trim().toUpperCase().replace(/[\s_-]+/g, " ");
  if (["ACTIVE", "APPROVED", "SUCCESS", "SUCCESSFUL", "REGISTERED"].includes(s)) return "active";
  if (["EXPIRED"].includes(s)) return "expired";
  if (["REJECTED", "REJECT", "FAILED", "FAILURE", "NOT APPROVED"].includes(s)) return "rejected";
  if (["CANCELLED", "CANCELED", "CANCEL"].includes(s)) return "cancelled";
  if (["PENDING", "SUBMITTED", "UNDER PROCESS", "IN PROCESS", "INITIATED"].includes(s)) return "pending";
  throw new RowError(s ? `mandate status "${raw.trim()}" is not one this importer reads` : "mandate status is blank");
}

// ── Monthly AUM Statement ───────────────────────────────────────────────

export function parseAumStatement(text: string, _source: "cams" | "kfintech" | string): Parsed<CanonicalAumRow> {
  const out: Parsed<CanonicalAumRow> = { rows: [], rejects: [], notes: [] };
  if (!text.trim()) return out;
  const layout = readLayout(text, "AUM statement", AUM_STATEMENT_ALIASES, ["folioNumber", "pan"], [
    { any: ["folioNumber"], label: "folio number" },
    { any: ["schemeCode"], label: "scheme code" },
    { any: ["units"], label: "units" },
    { any: ["aumValue", "nav"], label: "value or NAV" },
  ]);
  for (const { line, val, short } of dataRows(layout)) {
    if (short) { out.rejects.push({ line, reason: "row is shorter than the header — truncated or mis-delimited" }); continue; }
    collect(out, line, () => {
      const units = needNumber(val, "units", "units");
      const nav = optNumber(val, "nav", "NAV");
      const value = optNumber(val, "aumValue", "value");
      if (value === undefined && nav === undefined) throw new RowError("row has neither a value nor a NAV");
      if (units < 0 || (value ?? 0) < 0) throw new RowError("negative units or value in a holdings statement — not applied");
      return {
        pan: val("pan"),
        investorName: val("investorName") || undefined,
        folioNumber: val("folioNumber"),
        schemeCode: val("schemeCode"),
        schemeName: val("schemeName"),
        units,
        nav,
        aumValue: value ?? Math.round(units * (nav ?? 0) * 100) / 100,
        // Absent from statements that don't name the broker — the merge treats a
        // missing ARN as "unknown slice" rather than inventing one.
        arn: val("arn") || undefined,
        line,
      };
    });
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getDelimiter(text: string): string {
  // Sniff from the header line, not the source. The upload decoder normalises
  // every spreadsheet AND csv to pipe-delimited text, so KFin uploads are pipe
  // too — keying off `source === "kfintech"` would have mis-split them.
  if (text.includes("|")) return "|";
  if (text.includes("\t")) return "\t";
  return ",";
}

/**
 * Split one delimited line into fields.
 *
 * The comma case delegates to the shared RFC-4180 reader, which treats both `"`
 * and `'` as quotes — CAMS's "CSVWH" mailback wraps every text field in SINGLE
 * quotes, and the hand-rolled splitter this replaced only knew double quotes, so
 * every value arrived with its apostrophes attached and matched nothing
 * downstream.
 */
function splitLine(line: string, delim: string): string[] {
  if (delim === ",") return parseCsv(line)[0] ?? [];
  return line.split(delim);
}
