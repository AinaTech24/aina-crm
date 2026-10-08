/**
 * CAMS / KFintech transaction reverse-feed parser.
 *
 * The "reverse feed" is the transaction mailback an MFD receives from CAMS and
 * KFintech (CAMS WBR2 family, KFintech MFSD201 / MFSD307). The upload decoder
 * normalises every file to pipe-delimited text; this module finds the header,
 * maps columns by alias, and turns each row into a CanonicalTransaction — or
 * into a REJECT with a reason. lib/rta/process.ts writes the accepted rows.
 *
 * What this parser refuses to guess (RTA Phase 2, Oct 2026):
 *   - A file with no recognisable header, or without the columns a transaction
 *     needs, is refused as a whole (RtaLayoutError). It used to fall back to
 *     fixed column positions and import whatever happened to sit there.
 *   - A file with no registrar transaction-number column is refused. Rows used
 *     to be keyed "<rta>_<line number>", so line N of the next file overwrote
 *     line N of this one.
 *   - A row whose transaction type, direction, status, amount, units or date
 *     cannot be read with certainty is rejected with its reason, never filled
 *     with a default (lumpsum / inflow / successful / 0 / today).
 *   - Reversals, rejections and cancellations are rejected, not booked: their
 *     effect on the original transaction is not established for these files.
 */

import { parseCsv } from "@/lib/rta/csv";
import { readDate, readNumber, detectDateOrder, type DateOrder } from "@/lib/rta/values";

export type CanonicalTransaction = {
  /** The registrar's own transaction number — never synthesised. */
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
  /** Always positive; the direction carries the sign. */
  amount: number;
  /** As the registrar wrote it (a redemption may carry negative units). */
  units: number;
  nav: number | null;
  orderDate: string; // YYYY-MM-DD
  settlementDate?: string;
  status: "successful" | "rejected" | "failed" | "pending";
  reasonCode?: string;
  reasonDescription?: string;
  /** 1-based line in the decoded file, for error messages. */
  line: number;
};

/** A row the parser would not turn into a transaction, and why. */
export type FeedReject = { line: number; reason: string };

export type FeedParse = {
  rows: CanonicalTransaction[];
  rejects: FeedReject[];
  /** Data lines seen (excluding header and blank lines). */
  dataLines: number;
};

/** The file as a whole cannot be read safely; nothing in it is imported. */
export class RtaLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RtaLayoutError";
  }
}

type TxType = CanonicalTransaction["type"];

/** Transaction-type words that name exactly one of our types. */
const CAMS_TRANSACTION_TYPES: Record<string, TxType> = {
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

/** Words that mark a row as undoing, refusing or cancelling a transaction. */
const REVERSAL_RE = /REVERS|\bREV\b|REJECT|CANCEL/;

export type Classification =
  | { kind: "ok"; type: TxType }
  | { kind: "reversal"; reason: string }
  | { kind: "unknown"; reason: string };

/**
 * Classify a row from the raw type code (CAMS `trxntype` such as P234ES / R1 /
 * TICOB, KFin `Transaction Head`), the description ("Systematic Investment",
 * "Redemption" …) and the sub-type (SIN / FUL / ADD).
 *
 * Only what the row SAYS is used. The rules are plain-English descriptions,
 * SEBI's IDCW wording, the word-codes in CAMS_TRANSACTION_TYPES, and the code
 * tokens this importer already documents from real files (TICOB / TOCOB, the
 * SIN / FUL / ADD / NEW sub-types, R<n>). There is no default: the old
 * "starts with P → purchase" and "anything else → lumpsum" rules are gone, and
 * an unrecognised row is returned as `unknown` for the import to reject.
 */
export function classifyTransaction(
  typeRaw: string,
  descRaw = "",
  subRaw = "",
  opts: { statusRejected?: boolean } = {}
): Classification {
  const code = (typeRaw ?? "").toUpperCase().trim();
  const blob = [code, (descRaw ?? "").toUpperCase().trim(), (subRaw ?? "").toUpperCase().trim()]
    .filter(Boolean)
    .join(" ");
  const shown = [typeRaw, descRaw, subRaw].map((s) => (s ?? "").trim()).filter(Boolean).join(" / ") || "(blank)";

  // A row the status column already marks rejected / failed is stored as that
  // (it never counts as holdings), so its "rejection" wording is expected; a
  // reversal or cancellation is held back either way.
  const reversal = opts.statusRejected ? /REVERS|\bREV\b|CANCEL/ : REVERSAL_RE;
  if (reversal.test(blob)) {
    return { kind: "reversal", reason: `transaction "${shown}" is a reversal / rejection / cancellation — not applied (its effect on the original transaction is not verified for this file)` };
  }
  if (CAMS_TRANSACTION_TYPES[code]) return { kind: "ok", type: CAMS_TRANSACTION_TYPES[code] };

  // Classify on the wording WITHOUT the rejection words, so "SIP Rejection"
  // on a rejected row still reads as a SIP.
  const words = opts.statusRejected ? blob.replace(/REJECT\w*/g, " ") : blob;
  const t = ((): TxType | null => {
    if (/\bSWP\b|SYSTEMATIC WITHDRAW/.test(words)) return "swp";
    if (/\bSTP\b|SYSTEMATIC TRANSFER/.test(words)) return "stp";
    if (/SWITCH|\bTICOB\b|\bTOCOB\b|\bSWI\b|\bSWO\b/.test(words)) return "switch";
    if (/(?:DIV|IDCW).*(?:REINV|\bRIN\b)/.test(words)) return "dividend_reinvest";
    if (/(?:DIV|IDCW).*(?:PAYOUT|PAID)/.test(words)) return "dividend_payout";
    if (/REDEM|REPURCH|\bFUL\b|\bRED\b|^R\d+\b/.test(words)) return "redemption";
    if (/\bSIP\b|SYSTEMATIC INVEST|INSTAL|\bSIN\b/.test(words)) return "sip";
    if (/PURCH|SUBSCR|\bADD\b|\bNEW\b/.test(words)) return "lumpsum";
    return null;
  })();
  if (t) return { kind: "ok", type: t };
  return { kind: "unknown", reason: `transaction type "${shown}" is not one this importer recognises — row held back, not guessed` };
}

/**
 * The old one-word API, kept for callers that only need a type. Throws on a
 * row the classifier will not name; use classifyTransaction to get the reason.
 */
export function classifyTransactionType(typeRaw: string, descRaw = "", subRaw = ""): TxType {
  const c = classifyTransaction(typeRaw, descRaw, subRaw);
  if (c.kind !== "ok") throw new Error(c.reason);
  return c.type;
}

/**
 * Which way the money moved, or null when the row does not say.
 *
 * Both legs of a switch / STP collapse to one type, so the leg is read from
 * the raw code and description (TOCOB / SWO / "SWITCH OUT" vs TICOB / SWI /
 * "SWITCH IN"). A switch or STP row that names no leg used to default to
 * inflow — a coin flip that also moved units in valuation. It now returns null
 * and the row is rejected.
 */
export function directionFor(
  ourType: TxType,
  typeRaw: string,
  descRaw = "",
  subRaw = ""
): "inflow" | "outflow" | null {
  const blob = `${(typeRaw ?? "").toUpperCase()} ${(descRaw ?? "").toUpperCase()} ${(subRaw ?? "").toUpperCase()}`;
  const out = /\bTOCOB\b|\bSWO\b|SWITCH[\s_-]*OUT|STP[\s_-]*OUT|TRANSFER[\s_-]*OUT|\bOUT\b/.test(blob);
  const inn = /\bTICOB\b|\bSWI\b|SWITCH[\s_-]*IN\b|STP[\s_-]*IN\b|TRANSFER[\s_-]*IN\b|\bIN\b/.test(blob);

  if (ourType === "switch" || ourType === "stp") {
    if (out && !inn) return "outflow";
    if (inn && !out) return "inflow";
    return null;
  }
  if (ourType === "redemption" || ourType === "swp" || ourType === "dividend_payout") return "outflow";
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
  // Not plain `SCHEME`: in KFintech's MFSD307 that column is the 2-letter
  // scheme code ("EQ", "FM"), and as an alias it beat `FUNDDESC` whenever it came
  // first — 80k transactions were stored named "EQ". It is a fallback below.
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME", "FUND DESCRIPTION", "FUND_DESCRIPTION", "FUNDDESC"],
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


/** How far into the file to look for the header (registrar title rows sit above it). */
const HEADER_SCAN_LINES = 10;

/** Columns a transaction cannot be built without. */
const REQUIRED: Array<{ field: string; label: string }> = [
  { field: "folioNumber", label: "folio number" },
  { field: "orderDate", label: "transaction date" },
  { field: "amount", label: "amount" },
  { field: "units", label: "units" },
  { field: "externalRef", label: "registrar transaction number" },
];

const STATUS_OK = ["ALLOTTED", "SUCCESS", "SUCCESSFUL", "Y", "YES", "PROCESSED", "CONFIRMED"];
const STATUS_REJECTED = ["REJECTED", "AUTO REJECTED", "REJECT"];
const STATUS_FAILED = ["FAILED", "FAILURE", "BOUNCE", "BOUNCED"];
const STATUS_PENDING = ["PENDING", "N", "INITIATED", "AWAITED"];

/**
 * A row's status. A file with no status column is a ledger of posted
 * transactions, so its rows are successful; so is a blank cell in one. Any
 * other value this importer does not know — REVERSED, CANCELLED, a bare
 * letter — is not assumed to be a success.
 */
function readStatus(raw: string, hasColumn: boolean): { status: CanonicalTransaction["status"] } | { reason: string } {
  const u = (raw ?? "").toUpperCase().trim();
  if (!hasColumn || !u) return { status: "successful" };
  if (STATUS_OK.includes(u)) return { status: "successful" };
  if (STATUS_REJECTED.includes(u)) return { status: "rejected" };
  if (STATUS_FAILED.includes(u)) return { status: "failed" };
  if (STATUS_PENDING.includes(u)) return { status: "pending" };
  if (/REVERS|CANCEL/.test(u)) return { reason: `status "${raw.trim()}" — a reversal / cancellation is not applied (its effect is not verified for this file)` };
  return { reason: `status "${raw.trim()}" is not one this importer recognises — row held back, not assumed successful` };
}

/**
 * Parse a decoded transaction feed (pipe / comma / tab delimited).
 *
 * Throws RtaLayoutError when the file as a whole cannot be read safely (no
 * header, a required column missing). Otherwise returns the rows it could read
 * with certainty plus a reason for every row it would not import.
 */
export function parseReverseFeed(text: string): FeedParse {
  const lines = text.split(/\r?\n/);
  const firstNonBlank = lines.find((l) => l.trim() !== "") ?? "";
  if (!firstNonBlank) return { rows: [], rejects: [], dataLines: 0 };

  // The delimiter is read from the HEADER line: a title row above it ("TRANSACTION
  // REPORT") has none to detect.
  let delim = detectDelimiter(firstNonBlank);
  const splitWith = (d: string, line: string) => (d === "," ? parseCsvRow(line) : line.split(d));
  const split = (line: string) => splitWith(delim, line);

  let headerAt = -1;
  for (let i = 0; i < Math.min(HEADER_SCAN_LINES, lines.length); i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    // A header names a folio/PAN column and a scheme column — by the same
    // aliases the columns are then mapped with (the keyword sniff alone missed
    // spellings such as SCH_CODE that the alias table already knew).
    const d = detectDelimiter(line);
    const m = buildHeaderIndexMap(splitWith(d, line));
    const byAlias = (m.folioNumber !== undefined || m.pan !== undefined) && (m.schemeCode !== undefined || m.schemeName !== undefined);
    if (byAlias || looksLikeFeedHeader(line)) {
      headerAt = i;
      delim = d;
      break;
    }
  }
  if (headerAt < 0) {
    const shown = split(firstNonBlank).slice(0, 8).map((c) => c.trim()).join(", ");
    throw new RtaLayoutError(
      `Unrecognised transaction-feed layout — no header row with a folio/PAN column and a scheme column in the first ${HEADER_SCAN_LINES} lines. ` +
        `The file was not imported (it is no longer read by fixed column positions). First line: ${shown.slice(0, 200)}`
    );
  }

  const header = split(lines[headerAt]);
  const indexMap = buildHeaderIndexMap(header);
  // A file whose only scheme column is `SCHEME` (some CAMS layouts put the
  // name there) still gets a name — but only once the precise aliases failed.
  if (indexMap.schemeName === undefined) {
    const generic = buildHeaderIndexMap(header, { schemeName: ["SCHEME"] });
    if (generic.schemeName !== undefined && generic.schemeName !== indexMap.schemeCode) indexMap.schemeName = generic.schemeName;
  }

  const missing = REQUIRED.filter((r) => indexMap[r.field] === undefined).map((r) => r.label);
  if (indexMap.schemeCode === undefined && indexMap.schemeName === undefined) missing.push("scheme code or name");
  if (indexMap.type === undefined && indexMap.typeDesc === undefined) missing.push("transaction type or description");
  if (missing.length) {
    const why = missing.includes("registrar transaction number")
      ? " Without the registrar's transaction number a row cannot be told apart from a row in another file, so nothing is imported rather than risk overwriting existing transactions."
      : "";
    throw new RtaLayoutError(
      `This transaction feed is missing required column(s): ${missing.join(", ")}.${why} ` +
        `Header read: ${header.map((h) => h.trim()).slice(0, 40).join(", ").slice(0, 400)}`
    );
  }

  const maxIdx = Math.max(0, ...Object.values(indexMap));
  const dataStart = headerAt + 1;

  // Decide D/M vs M/D once for the file. A file that shows BOTH shapes cannot
  // be read either way, so only its self-evident dates (a part above 12) are
  // accepted and every ambiguous one is rejected.
  const samples: string[] = [];
  for (let i = dataStart; i < lines.length && samples.length < 5000; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const v = split(line)[indexMap.orderDate];
    if (v) samples.push(v.trim());
  }
  const order = detectDateOrder(samples);

  // A transaction number repeated WITHIN one file is not proof of one
  // transaction or of several: registrars can report one economic transaction
  // in parts, or reuse a number across legs. Until a real file shows which
  // (see the Phase 2B investigation), every row of such a group is held back
  // — never collapsed into one, never stored twice.
  const refLines = new Map<string, number[]>();
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const ref = (split(line)[indexMap.externalRef] ?? "").trim();
    if (ref) refLines.set(ref, [...(refLines.get(ref) ?? []), i + 1]);
  }

  const rows: CanonicalTransaction[] = [];
  const rejects: FeedReject[] = [];
  let dataLines = 0;

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    dataLines++;
    const lineNo = i + 1;
    const cols = split(line);
    if (cols.length <= maxIdx) {
      rejects.push({ line: lineNo, reason: `row has ${cols.length} columns; the header has ${header.length} — row is truncated or mis-delimited` });
      continue;
    }
    const val = (field: string) => (indexMap[field] === undefined ? "" : (cols[indexMap[field]] ?? "").trim());
    const reject = (reason: string) => rejects.push({ line: lineNo, reason });

    const folioNumber = val("folioNumber");
    if (!folioNumber) { reject("row carries no folio number — a transaction cannot be attached without one"); continue; }
    const externalRef = val("externalRef");
    if (!externalRef) { reject("row carries no registrar transaction number — it cannot be identified safely"); continue; }
    const group = refLines.get(externalRef) ?? [];
    if (group.length > 1) {
      const shown = group.slice(0, 6).join(", ") + (group.length > 6 ? ", …" : "");
      reject(
        `transaction number ${externalRef} appears ${group.length} times in this file (lines ${shown}) — whether that is one transaction reported in parts or several transactions is not established, so the whole group is held back (nothing merged, nothing overwritten)`
      );
      continue;
    }

    const st = readStatus(val("status"), indexMap.status !== undefined);
    if ("reason" in st) { reject(st.reason); continue; }
    const statusRejected = st.status === "rejected" || st.status === "failed";

    const cls = classifyTransaction(val("type"), val("typeDesc"), val("typeSub"), { statusRejected });
    if (cls.kind !== "ok") { reject(cls.reason); continue; }
    const direction = directionFor(cls.type, val("type"), val("typeDesc"), val("typeSub"));
    if (!direction) { reject(`${cls.type === "stp" ? "STP" : "switch"} row does not say whether it is the IN or the OUT leg — not guessed`); continue; }

    const date = readOrderDate(val("orderDate"), order);
    if (!date.ok) { reject(`transaction date ${date.reason}`); continue; }

    const amount = readNumber(val("amount"));
    if (!amount.ok) { reject(`amount ${amount.reason}`); continue; }
    if (amount.value === null) { reject("amount is blank"); continue; }
    const units = readNumber(val("units"));
    if (!units.ok) { reject(`units ${units.reason}`); continue; }
    // A dividend PAYOUT moves money, not units, so its units cell may be empty.
    if (units.value === null && cls.type !== "dividend_payout") { reject("units are blank"); continue; }
    const nav = readNumber(val("nav"));
    if (!nav.ok) { reject(`NAV ${nav.reason}`); continue; }

    // A negative figure on a money-in row is what a reversal looks like in
    // some layouts; it is not assumed to be one. On a money-out row a negative
    // amount or units is the same outflow written with a sign.
    const unitsValue = units.value ?? 0;
    if (direction === "inflow" && (amount.value < 0 || unitsValue < 0)) {
      reject(`negative ${amount.value < 0 ? "amount" : "units"} on a ${cls.type} (money-in) row — could be a reversal; not applied`);
      continue;
    }

    rows.push({
      externalRef,
      pan: val("pan"),
      folioNumber,
      investorName: val("investorName") || undefined,
      amcCode: val("amcCode"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      type: cls.type,
      direction,
      amount: Math.abs(amount.value),
      units: unitsValue,
      nav: nav.value,
      orderDate: date.value,
      status: st.status,
      reasonCode: val("reasonCode") || undefined,
      line: lineNo,
    });
  }
  return { rows, rejects, dataLines };
}

/** The order date under the file's order; a mixed-order file accepts only self-evident dates. */
function readOrderDate(raw: string, order: DateOrder | "conflict"): { ok: true; value: string } | { ok: false; reason: string } {
  if (!raw) return { ok: false, reason: "is blank" };
  let use: DateOrder = order === "conflict" ? "dmy" : order;
  if (order === "conflict") {
    const m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}/);
    if (m) {
      if (+m[1] > 12) use = "dmy";
      else if (+m[2] > 12) use = "mdy";
      else return { ok: false, reason: `"${raw}" is ambiguous — this file writes dates both day-first and month-first` };
    }
  }
  const r = readDate(raw, use);
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.value === null) return { ok: false, reason: "is blank" };
  return { ok: true, value: r.value };
}

/** CAMS distributor feed. */
export function parseCamsFeed(text: string): FeedParse {
  return parseReverseFeed(text);
}

/** KFintech distributor feed — same unified path (delimiter auto-detected). */
export function parseKfintechFeed(text: string): FeedParse {
  return parseReverseFeed(text);
}

/**
 * Split one comma-delimited feed line into fields.
 *
 * Delegates to the shared RFC-4180 reader, which treats BOTH `"` and `'` as
 * quote characters. CAMS's "CSVWH" mailback format wraps every text field in
 * SINGLE quotes:
 *   'AMC_CODE','FOLIO_NO','PRODCODE','SCHEME',…
 *   'X','1234567/89','X01','Example Scheme - Growth',…
 * The local splitter this replaced only understood double quotes, so every
 * value kept its apostrophes. `parseCsv` opens a quote only at field start, so
 * an apostrophe inside an unquoted name (O'Brien) stays literal.
 */
function parseCsvRow(line: string): string[] {
  return parseCsv(line)[0] ?? [];
}
