/**
 * CAMS / KFintech reverse-feed parser.
 *
 * The "reverse feed" is a daily flat file each MFD receives from CAMS +
 * KFintech containing every transaction across the AMCs they service.
 * Format: pipe-delimited (CAMS) or comma-delimited (KFintech), with ~30
 * fields per row including PAN, folio, scheme, transaction type, amount,
 * units, NAV, date, reason code for failures.
 *
 * This module parses one batch and emits canonical events to events_outbox.
 * The reconciliation engine (workers/reconciler.ts — TBD) then three-way
 * matches against (a) our CRM-recorded transaction and (b) the exchange
 * order status to flag drift.
 *
 * Real-world wiring:
 *   - Receive feed via SFTP or email attachment (per-tenant credentials in
 *     compliance vault)
 *   - Decompress (.zip / .gz) and pipe through parseCamsFeed / parseKfintechFeed
 *   - For each canonical row, upsert transaction (idempotency key = order_id),
 *     emit 'transaction.created.<type>' or 'transaction.failed.<reason>' events
 */

import { z } from "zod";
import { parseCsv } from "@/lib/rta/csv";

export type CanonicalTransaction = {
  externalRef: string;
  pan: string;
  folioNumber: string;
  /** First holder's name, when the feed carries it. Used to name an investor
   *  created from the feed itself when the folio master has not arrived. */
  investorName?: string;
  amcCode: string;
  schemeCode: string;
  schemeName: string;
  type: "lumpsum" | "sip" | "stp" | "swp" | "redemption" | "switch" | "dividend_payout" | "dividend_reinvest";
  direction: "inflow" | "outflow";
  amount: number;
  units: number;
  nav: number;
  orderDate: string; // YYYY-MM-DD
  settlementDate?: string;
  status: "successful" | "rejected" | "failed" | "pending";
  reasonCode?: string;
  reasonDescription?: string;
};

const CAMS_TRANSACTION_TYPES: Record<string, CanonicalTransaction["type"]> = {
  PURCHASE: "lumpsum",
  ADDPURCH: "lumpsum",
  SIP: "sip",
  SIP_INSTL: "sip",
  REDEMPTION: "redemption",
  STPOUT: "stp",
  SWPOUT: "swp",
  DIVPAYOUT: "dividend_payout",
  DIVREINVEST: "dividend_reinvest",
};

/**
 * Classify a transaction from the raw type code (CAMS `trxntype` like P234ES /
 * R1 / TICOB, KFin `Transaction Head` P/R/S) PLUS the human description
 * (`Transaction Description` = "Systematic Investment" / "Redemption" / …) and
 * the sub-type (SIN/FUL/ADD). Real feeds use dozens of internal codes, so we
 * classify by keyword + leading letter rather than an exhaustive table.
 */
export function classifyTransactionType(
  typeRaw: string,
  descRaw = "",
  subRaw = ""
): CanonicalTransaction["type"] {
  const code = (typeRaw ?? "").toUpperCase().trim();
  const blob = `${code} ${(descRaw ?? "").toUpperCase()} ${(subRaw ?? "").toUpperCase()}`;
  if (CAMS_TRANSACTION_TYPES[code]) return CAMS_TRANSACTION_TYPES[code];
  if (/\bSWP\b|SYSTEMATIC WITHDRAW/.test(blob)) return "swp";
  if (/\bSTP\b|SYSTEMATIC TRANSFER/.test(blob)) return "stp";
  if (/SWITCH|TICOB|TOCOB|\bSWI\b|\bSWO\b|\bSW\b/.test(blob)) return "switch";
  if (/DIV.*(REINV|RIN)|REINVEST/.test(blob)) return "dividend_reinvest";
  if (/DIV.*(PAYOUT|PAID)|DIVIDEND/.test(blob)) return "dividend_payout";
  if (/REDEM|REPURCH|\bFUL\b|\bRED\b|^R\d|^R$/.test(blob)) return "redemption";
  if (/SIP|SYSTEMATIC|INSTAL|\bSIN\b/.test(blob)) return "sip";
  if (/PURCH|SUBSCR|\bADD\b|\bNEW\b|^P/.test(blob)) return "lumpsum";
  return "lumpsum";
}

/**
 * Which way the money moved.
 *
 * `classifyTransactionType` deliberately collapses both legs of a switch into
 * one type — TICOB (switch IN) and TOCOB (switch OUT) are both "switch", and
 * likewise for STP. Deriving direction from that collapsed type therefore made
 * EVERY switch and STP an inflow, so money leaving a scheme was counted as new
 * money entering the book. Measured on VSN Financial Services: 1,666 switch
 * rows, every one of them an inflow, none an outflow — Rs 39.56 Cr of movement
 * booked as fresh investment, which is why Total Investment sat above AUM.
 *
 * So read the raw registrar code, which still distinguishes the legs, and fall
 * back to the collapsed type only when it says nothing either way.
 */
export function directionFor(
  ourType: CanonicalTransaction["type"],
  typeRaw: string,
  descRaw = "",
  subRaw = ""
): "inflow" | "outflow" {
  const blob = `${(typeRaw ?? "").toUpperCase()} ${(descRaw ?? "").toUpperCase()} ${(subRaw ?? "").toUpperCase()}`;

  // Explicit out-leg markers. TOCOB = "transfer out of common order book";
  // SWO / "SWITCH OUT" / "STP OUT" are the plain-language equivalents.
  if (/\bTOCOB\b|\bSWO\b|SWITCH[\s_-]*OUT|STP[\s_-]*OUT|TRANSFER[\s_-]*OUT|\bOUT\b/.test(blob)) return "outflow";
  // Explicit in-leg markers.
  if (/\bTICOB\b|\bSWI\b|SWITCH[\s_-]*IN|STP[\s_-]*IN|TRANSFER[\s_-]*IN|\bIN\b/.test(blob)) return "inflow";

  // Unambiguous by type alone.
  if (ourType === "redemption" || ourType === "swp" || ourType === "dividend_payout") return "outflow";

  // A switch or STP leg we cannot identify keeps the historical reading. Not
  // because it is right — it is a coin flip — but because `direction` also
  // drives unit netting in valuation (inflow adds units, outflow subtracts), so
  // flipping it on a guess would move holdings as well as the investment total,
  // in a direction nothing here has verified. The money-in figure is corrected
  // where it is actually computed instead: GROSS_TYPES in lib/metrics/business.ts
  // excludes switches and STPs from gross investment outright, since neither is
  // ever new money whichever leg it is.
  return "inflow";
}

/** Detect the delimiter of a decoded feed line (decoder emits pipe). */
export function detectDelimiter(line: string): "|" | "\t" | "," {
  const pipes = (line.match(/\|/g) ?? []).length;
  const tabs = (line.match(/\t/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  if (pipes >= commas && pipes >= tabs && pipes > 0) return "|";
  if (tabs >= commas && tabs > 0) return "\t";
  return ",";
}

/** A feed header row carries a folio and/or PAN column plus a scheme column. */
function looksLikeFeedHeader(line: string): boolean {
  const u = line.toUpperCase();
  // `ACNO` covers KFintech's dBASE `TD_ACNO` (the folio) — `\bPAN\b` does NOT
  // match its `PAN1` column, so without ACNO a DBF header is only recognised by
  // the incidental `CLIENTID` field.
  const hasKey = /\bFOLIO\b|FOLIO_NO|FOLIONO|FOLIO NUMBER|ACCOUNT NUMBER|FOLIOCHK|ACNO|\bPAN\b|CLIENT/.test(u);
  const hasScheme = /SCHEME|PRODUCT|FUND|PRODCODE/.test(u);
  return hasKey && hasScheme;
}

/**
 * Parse a CAMS distributor feed (pipe-delimited).
 * Spec subset — real file has 40+ fields; we extract the ones we need.
 */
/**
 * Column aliases per canonical field.
 *
 * The `TD_*` / `FMCODE` / `FUNDDESC` names are KFintech's legacy **dBASE** field
 * names, used in the `.dbf` payload of MFSD307 ("Investor transactions feed").
 * Some mailback subscriptions deliver that DBF instead of a headed CSV; without
 * these aliases NOTHING matched, `parseReverseFeed` fell back to the positional
 * DEFAULT_CAMS_MAP, and column 1/2 were read as folio/PAN — which in a DBF are
 * `TD_FUND` (the 3-digit AMC code) and `TD_ACNO` (the real folio). Every row then
 * failed folio lookup with "not in client master" and the file imported 0 rows.
 * Seen in production for VSN Financial Services (19 files, 369 rows lost).
 *
 * NOTE: matching is exact-after-normalisation (non-alphanumerics stripped), and
 * `buildHeaderIndexMap` scans the HEADER in order, so an earlier column wins.
 * That is deliberate here: `TRNSTAT` (col 11, the txn status) must beat `STATUS`
 * (col 59, which holds the investor category "INDIVIDUAL"), and `PAN1` is the
 * primary holder while `PAN2`/`PAN3` are joint holders we must NOT pick up.
 */
export const HEADER_ALIASES: Record<string, string[]> = {
  amcCode: ["AMC", "AMC_CODE", "AMCCOD", "AMC_NAME", "AMC NAME", "FMIM_CODE", "AMC_CD", "FUND", "FUND CODE", "TD_FUND"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO", "FOLIO NUMBER", "ACCOUNT NUMBER", "ACCOUNT NO", "FOLIOCHK", "ACNO", "TD_ACNO"],
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER", "PAN NUMBER", "PAN1"],
  // KFintech dBASE calls it INVNAME; CAMS feeds vary. Needed so a transaction
  // that arrives before its folio master can still name the investor.
  investorName: ["INVNAME", "INV_NAME", "INVESTOR NAME", "INVESTOR_NAME", "FIRST HOLDER", "FIRST_HOLDER", "HOLDER NAME", "HOLDER_NAME", "INVESTORNAME", "BENEFICIARY NAME"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCH_CD", "PRODUCT", "SCHEME", "FMCODE"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME", "FUND DESCRIPTION", "FUND_DESCRIPTION", "SCHEME", "FUNDDESC"],
  type: ["TR_TYPE", "TXN_TYPE", "TRANS_TYPE", "TRTYPE", "TXNTYPE", "TRANSTYPE", "TYPE", "TRANSACTION TYPE", "TRANSACTION HEAD", "TRANSACTION_HEAD", "TRXN_TYPE", "TD_TRTYPE"],
  typeDesc: ["TRANS_DESC", "TRANS DESCRIPTION", "TRANSACTION DESCRIPTION", "TRANSACTION_DESCRIPTION", "TXN_DESC_CAMS", "TRXN_NATURE", "TRDESC"],
  typeSub: ["TRANSACTION SUB", "TRANSACTION_SUB", "TRXNSUBTYP", "SUB_TYPE", "TRANSACTION_TYPE"],
  orderDate: ["TR_DATE", "TXN_DATE", "TRANS_DATE", "TRDATE", "TXNDATE", "TRANSDATE", "DATE", "POST_DATE", "POST DATE", "TXN_DT", "TRANSACTION DATE", "TRADDATE", "TRAD DATE", "TRADE DATE", "TRADE_DATE_TIME", "TD_TRDT"],
  amount: ["AMOUNT", "AMT", "TXN_AMT", "TXN_AMOUNT", "TRANS_AMT", "PURCHASE_AMOUNT", "RED_AMOUNT", "PLOT_AMOUNT", "AMOUNT (IN RS.)", "AMOUNT IN RS", "NET_AMOUNT", "GROSS AMOUNT", "TD_AMT"],
  units: ["UNITS", "UNIT", "QTY", "QUANTITY", "NO_OF_UNITS", "NO OF UNITS", "PLOT_UNITS", "TD_UNITS"],
  nav: ["NAV", "RATE", "NAV_PUR", "NAV_RATE", "PUR_NAV", "ALLOT_NAV", "ALLOTNAV", "PRICE", "PURPRICE", "TD_NAV"],
  externalRef: ["ORDER_REF", "REF_NO", "REF NO", "TXN_ID", "TXN ID", "TXN_REF", "TXN REF", "REF_NUM", "REF NUM", "TRANSACTION NUMBER", "TRANSACTION ID", "TRXNNO", "TRXN_NO", "TRANSACTION_ID", "TRANSACTION_NUMBER", "UNQNO"],
  status: ["STATUS", "TR_STATUS", "TXN_STATUS", "STATUS_DESC", "STATUS DESC", "TRANSACTION STATUS", "TRXNSTAT", "ORDER STATUS", "TRNSTAT"],
  reasonCode: ["REASON_CODE", "REJ_CODE", "REJECT_CODE", "REASON CODE", "REJ CODE", "REJ_REASON", "REJ REASON", "ORDER REMARK", "REMARKS", "NCTREMARKS"],
};

export const DEFAULT_CAMS_MAP: Record<string, number> = {
  amcCode: 0,
  folioNumber: 1,
  pan: 2,
  schemeCode: 4,
  schemeName: 5,
  type: 6,
  orderDate: 7,
  amount: 8,
  units: 9,
  nav: 10,
  externalRef: 11,
  status: 12,
  reasonCode: 13,
};

export function buildHeaderIndexMap(headerRow: string[], aliases = HEADER_ALIASES): Record<string, number> {
  const map: Record<string, number> = {};
  const normalizedHeaders = headerRow.map(h => h.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""));

  for (const [field, aliasList] of Object.entries(aliases)) {
    const aliasSet = new Set(aliasList.map(a => a.toUpperCase().replace(/[^A-Z0-9]/g, "")));
    const idx = normalizedHeaders.findIndex(h => aliasSet.has(h));
    if (idx !== -1) {
      map[field] = idx;
    }
  }
  return map;
}

function normaliseFeedStatus(s: string): CanonicalTransaction["status"] {
  const u = (s ?? "").toUpperCase().trim();
  if (["ALLOTTED", "SUCCESS", "SUCCESSFUL", "Y", "YES", "PROCESSED", "CONFIRMED"].includes(u)) return "successful";
  if (["REJECTED", "AUTO REJECTED", "REJECT"].includes(u)) return "rejected";
  if (["FAILED", "FAILURE", "BOUNCE", "BOUNCED"].includes(u)) return "failed";
  if (["PENDING", "N", "INITIATED", "AWAITED"].includes(u)) return "pending";
  return "successful"; // a posted reverse-feed row is, by definition, processed
}

/**
 * Unified reverse-feed parser. The decoder normalises every upload (CAMS xls,
 * KFin csv/xlsx, etc.) to pipe-delimited text, so we auto-detect the delimiter
 * (pipe / comma / tab), find the header row, build a column map from the
 * (greatly expanded) alias table, and classify each row by code + description.
 * PAN may be absent (folio-keyed feeds) — the processor resolves by folio then.
 */
export function parseReverseFeed(text: string, refPrefix = "feed"): CanonicalTransaction[] {
  const rows: CanonicalTransaction[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return rows;

  const delim = detectDelimiter(lines.find((l) => l.trim() !== "") ?? "");
  const split = (line: string) => (delim === "," ? parseCsvRow(line) : line.split(delim));

  let dataStart = 0;
  let indexMap: Record<string, number> = DEFAULT_CAMS_MAP;
  if (looksLikeFeedHeader(lines[0] ?? "")) {
    dataStart = 1;
    indexMap = buildHeaderIndexMap(split(lines[0]));
    // If alias matching found nothing useful, fall back to positional defaults.
    if (indexMap.folioNumber === undefined && indexMap.pan === undefined) {
      indexMap = { ...DEFAULT_CAMS_MAP, ...indexMap };
    }
  }
  const maxIdx = Math.max(0, ...Object.values(indexMap));

  // Decide D/M vs M/D ONCE for the whole file (see detectDateOrder). Bounded to
  // the first slice of data rows so a 100k-row feed doesn't pay for a second
  // full split — a handful of rows with a day > 12 settles it, and a file that
  // never disambiguates keeps the D/M/Y default either way.
  const dateIdx = indexMap.orderDate;
  let dateOrder: DateOrder = "dmy";
  if (dateIdx !== undefined) {
    const samples: string[] = [];
    for (let i = dataStart; i < lines.length && samples.length < 5000; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      const cols = split(line);
      const v = cols[dateIdx];
      if (v) samples.push(v.trim());
    }
    dateOrder = detectDateOrder(samples);
  }

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = split(line);
    if (cols.length <= maxIdx) continue;
    const val = (field: string) =>
      indexMap[field] === undefined ? "" : (cols[indexMap[field]] ?? "").trim();

    const ourType = classifyTransactionType(val("type"), val("typeDesc"), val("typeSub"));
    const direction = directionFor(ourType, val("type"), val("typeDesc"), val("typeSub"));

    const folioNumber = val("folioNumber");
    const pan = val("pan");
    if (!folioNumber && !pan) continue; // unusable row

    rows.push({
      externalRef: val("externalRef") || `${refPrefix}_${i}`,
      pan,
      folioNumber,
      investorName: val("investorName") || undefined,
      amcCode: val("amcCode"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      type: ourType,
      direction,
      amount: Math.abs(parseFloat(val("amount").replace(/[, ]/g, "")) || 0),
      units: parseFloat(val("units").replace(/[, ]/g, "")) || 0,
      nav: parseFloat(val("nav").replace(/[, ]/g, "")) || 0,
      orderDate: normalizeDate(val("orderDate"), dateOrder),
      status: normaliseFeedStatus(val("status")),
      reasonCode: val("reasonCode") || undefined,
    });
  }
  return rows;
}

/** CAMS distributor feed — kept for the existing call sites. */
export function parseCamsFeed(text: string): CanonicalTransaction[] {
  return parseReverseFeed(text, "cams");
}

/** KFintech distributor feed — same unified path (delimiter auto-detected). */
export function parseKfintechFeed(text: string): CanonicalTransaction[] {
  return parseReverseFeed(text, "kfin");
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/**
 * Which way round a file writes numeric dates.
 *
 * Indian RTA feeds are D/M/Y by default, but CAMS's "CSVWH" mailback emits
 * US-style M/D/Y — and the two are indistinguishable row by row whenever both
 * components are <= 12. Deciding per ROW (the old behaviour) got the
 * unambiguous rows right and silently shifted the ambiguous ones by months: a
 * real WBR2 sample parsed 112/232 rows correctly and misdated the other 120.
 * A file is written one way throughout, so decide ONCE from the whole column and
 * apply it uniformly.
 */
export type DateOrder = "dmy" | "mdy";

/**
 * Infer the date order from a file's date column. A component > 12 can only be
 * a day, so it pins the layout; if nothing in the sample disambiguates we keep
 * the Indian D/M/Y default. Bounded — a few hundred rows settle it in practice.
 */
export function detectDateOrder(samples: Iterable<string | undefined>): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const raw of samples) {
    const m = (raw ?? "").trim().match(/^(\d{1,2})[-/](\d{1,2})[-/]\d{4}/);
    if (!m) continue;
    if (+m[1] > 12) dayFirst++;
    if (+m[2] > 12) monthFirst++;
  }
  return monthFirst > dayFirst ? "mdy" : "dmy";
}

function normalizeDate(d: string | undefined, order: DateOrder = "dmy"): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  const s = d.trim();
  // ISO (decoder already emits this for spreadsheet date cells).
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Bare YYYYMMDD — how a dBASE `D` field reads when it reaches us as raw text
  // rather than a parsed date cell (KFintech MFSD307 `TD_TRDT`).
  const ymd = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd && +ymd[2] >= 1 && +ymd[2] <= 12 && +ymd[3] >= 1 && +ymd[3] <= 31) {
    return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  }
  // DD-MM-YYYY / DD/MM/YYYY, or MM/DD/YYYY when `order` says so (with optional
  // time after). The file-level `order` decides; the per-row guard below only
  // salvages a row that contradicts it (an impossible month can only be a day),
  // so one malformed row can't drag the rest of the file with it.
  const dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (dmy) {
    const a = parseInt(dmy[1], 10);
    const b = parseInt(dmy[2], 10);
    let day = order === "mdy" ? b : a;
    let mon = order === "mdy" ? a : b;
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];
    return `${dmy[3]}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  // DD-MON-YYYY (e.g. 31-May-2026).
  const dmon = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{4})/);
  if (dmon) {
    const mm = MONTHS[dmon[2].toUpperCase()];
    if (mm) return `${dmon[3]}-${mm}-${dmon[1].padStart(2, "0")}`;
  }
  return s;
}

/**
 * Split one comma-delimited feed line into fields.
 *
 * Delegates to the shared RFC-4180 reader, which treats BOTH `"` and `'` as
 * quote characters. CAMS's "CSVWH" mailback format wraps every text field in
 * SINGLE quotes:
 *   'AMC_CODE','FOLIO_NO','PRODCODE','SCHEME',…
 *   'H','5904386/12','H02','HDFC Flexi Cap Fund - Regular Plan - Growth',…
 * The local splitter this replaced only understood double quotes, so every
 * value kept its apostrophes: pan `'AJNPB9093L'` matched no investor, and
 * order_date `'6/10/2011  12:00:00 AM'` failed its `::date` cast — which aborts
 * the surrounding Postgres transaction and takes the whole import down with it.
 * The header still mapped correctly (header normalisation strips
 * non-alphanumerics), so the file looked like it parsed while every row was
 * unusable — the worst failure shape to diagnose from the outside.
 *
 * `parseCsv` opens a quote only at field start, so an apostrophe inside an
 * unquoted name (O'Brien) stays literal.
 */
function parseCsvRow(line: string): string[] {
  return parseCsv(line)[0] ?? [];
}
