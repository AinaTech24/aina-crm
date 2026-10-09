import { buildHeaderIndexMap } from "../integrations/cams-feed-parser";
import { parseCsv } from "./csv";

/**
 * Parsers for RTA file types beyond the daily transaction feed.
 *
 * The CAMS / KFintech distributor file formats are not publicly documented;
 * they vary between MFDs and even between months. The parsers below capture
 * the *most common* layout — extend as you onboard more MFDs.
 *
 * Each parser is `(rawText, source) → CanonicalRow[]`. Canonical means
 * "named fields, no source-specific quirks." The processor then writes
 * canonical rows to our normalised tables.
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
  /** The registrar's own status for the registration (KFintech MFSD243 "Status": Live SIP, Terminated…). */
  registrarStatus?: string;
  /** Why it stopped, in the registrar's words (CAMS WBR49 / KFintech MFSD230 REMARKS). */
  registrarRemark?: string;
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
};

// ── Default mapping layouts & aliases ───────────────────────────────────

const DEFAULT_SIP_REJECT_MAP: Record<string, number> = {
  amcName: 0,
  folioNumber: 1,
  pan: 2,
  schemeName: 3,
  rejectionDate: 4,
  amount: 5,
  reasonCode: 6,
  reason: 7,
};

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

const DEFAULT_BROKERAGE_MAP: Record<string, number> = {
  amcCode: 0,
  schemeCode: 1,
  schemeName: 2,
  folioNumber: 3,
  pan: 4,
  brokerageType: 5,
  periodStart: 6,
  periodEnd: 7,
  aumAmount: 8,
  brokerageRate: 9,
  brokerageAmount: 10,
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

const DEFAULT_FOLIO_MST_MAP = {
  pan: 0,
  folioNumber: 1,
  amcCode: 2,
  amcName: 3,
  schemeCode: 4,
  schemeName: 5,
  units: 6,
  openedAt: 7,
  closedAt: 8,
  value: 9
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

const DEFAULT_SIP_BOOK_MAP = {
  pan: 0,
  folioNumber: 1,
  schemeCode: 2,
  schemeName: 3,
  amount: 4,
  frequency: 5,
  sipDate: 6,
  startDate: 7,
  endDate: 8,
  nextInstallmentAt: 9,
  mandateRefNo: 10
};

const SIP_BOOK_ALIASES: Record<string, string[]> = {
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER", "PAN_PEKRN"],
  // KFintech's MFSD230 ("SIP/STP Report") names the folio ACNO and the scheme
  // SCHDESC. With no folio column recognised the header was not detected at
  // all, the positional fallback read column 1 (AGENT, the ARN) as the folio,
  // and every row failed "Folio ARN-… not found" (Attitude Financial, 9 Oct
  // 2026: 879 of 879 rows).
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO", "FOLIOCHK", "ACNO", "AC_NO"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCH_CD"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME", "SCHDESC", "SCH_DESC"],
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
  mandateRefNo: ["MANDATE_ID", "UMRN", "MANDATE_REF", "MANDATE_REF_NO", "MANDATE REF", "UMRN_NO", "ECSNO", "ECS_NO"],
  // A registration report lists cancelled and finished SIPs too. Without the
  // cease date every row imported as 'active', and the SIP book counted SIPs
  // that stopped years ago.
  ceaseDate: ["CEASE_DATE", "CEASED_DATE", "SIP_CEASE_DATE", "CANCEL_DATE", "CANCELLATION_DATE", "TERMINATION_DATE", "TERMINATEDATE", "TERMINATE_DATE"],
  // What the registrar says the registration is, and why it stopped
  // (lib/rta/sip-registrar-status.ts). Optional columns: never required for a
  // row to be read.
  registrarStatus: ["STATUS", "SIP_STATUS", "REG_STATUS", "REGISTRATION_STATUS"],
  registrarRemark: ["REMARKS", "REMARK", "CEASE_REASON", "TERMINATION_REASON"],
  // KFintech MFSD230 calls it TRTYPE (SIP / STP / SWP): the STP and SWP rows
  // stay out of the SIP book, as CAMS's do.
  registrationType: ["AUT_TRNTYP", "AUTO_TRNTYP", "AUTO_TRN_TYPE", "REGISTRATION_TYPE", "TRTYPE", "TR_TYPE"],
  targetScheme: ["TARGET_SCH", "TARGET_SCHEME", "TARGET_SCHEME_CODE", "TO_SCHEME"],
};

const DEFAULT_MANDATE_STATUS_MAP = {
  pan: 0,
  mandateRefNo: 1,
  bankAccountMasked: 2,
  ifsc: 3,
  amountLimit: 4,
  registeredAt: 5,
  expiresAt: 6,
  status: 7
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

const DEFAULT_AUM_STATEMENT_MAP = {
  pan: 0,
  folioNumber: 1,
  schemeCode: 2,
  schemeName: 3,
  units: 4,
  nav: 5,
  aumValue: 6
};

// CAMS's newer report layouts ("…C" files, and the WBR22 "AuM on a specific
// date by Scheme by Investor" of 9 Oct 2026) name the folio FOLIOCHK and the
// PAN PAN_PEKRN. Neither was known here, so the header went undetected, the
// positional fallback read PRODUCT_CODE as the folio, and Attitude Financial
// got 182 clients called "Folio HHRERP", "Folio P3289"… holding Rs 3.95 Cr
// that was each scheme's total, not anyone's holding.
const AUM_STATEMENT_ALIASES: Record<string, string[]> = {
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER", "PAN NUMBER", "PAN_PEKRN"],
  investorName: ["INV_NAME", "INVNAME", "INVESTOR_NAME", "INVESTOR NAME", "INV NAME", "NAME", "HOLDER_NAME", "FIRST_HOLDER"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO", "FOLIOCHK", "ACCOUNT NUMBER", "SCHEME_FOLIO_NUMBER"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCH_CD", "PRODUCT"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME", "FUND DESCRIPTION"],
  units: ["UNITS", "UNIT", "QTY", "QUANTITY", "NO_OF_UNITS", "NO OF UNITS", "UNIT_BAL", "BALANCE_UNITS", "CURRENT_UNITS", "CLOS_BAL"],
  nav: ["NAV", "RATE", "NAV_RATE", "PRICE"],
  aumValue: ["AUM", "VALUE", "VALUATION", "AMOUNT", "CURR_VAL", "CURRENT_VALUE", "AUM_VALUE", "CLOSING_ASSETS", "CLOSING ASSETS", "RUPEE_BAL", "MARKET_VALUE"],
  arn: ["BROK_DLR_CODE", "BROK DLR CODE", "BROKER_CODE", "BROKER CODE", "AGENT_CODE", "AGENT CODE", "ARN", "ARN_CODE", "DISTRIBUTOR_CODE", "BROKER"],
};

// ── SIP rejection report ────────────────────────────────────────────────

const REASON_CODE_MAP: Record<string, string> = {
  "001": "Insufficient funds",
  "002": "Account closed",
  "003": "Mandate inactive / cancelled",
  "004": "Signature mismatch",
  "005": "Mandate amount exceeded",
  "006": "No such account",
  "007": "Frozen account",
  "008": "Other",
};

export function parseSipRejectionReport(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalSipRejection[] {
  const out: CanonicalSipRejection[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;

  const delim = getDelimiter(source, lines[0] ?? "");
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, SIP_REJECT_ALIASES, DEFAULT_SIP_REJECT_MAP);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";
    const reasonCode = val("reasonCode");

    out.push({
      amcName: val("amcName"),
      folioNumber: val("folioNumber"),
      pan: val("pan"),
      schemeName: val("schemeName"),
      rejectionDate: normaliseDate(val("rejectionDate")) ?? today(),
      amount: parseFloat(val("amount") ?? "0") || 0,
      reasonCode,
      reason:
        (reasonCode && REASON_CODE_MAP[reasonCode]) ??
        val("reason") ??
        "Unknown",
    });
  }
  return out;
}

// ── Monthly brokerage statement ─────────────────────────────────────────

export function parseBrokerageStatement(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalBrokerageRow[] {
  const out: CanonicalBrokerageRow[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const delim = getDelimiter(source, lines[0] ?? "");
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, BROKERAGE_ALIASES, DEFAULT_BROKERAGE_MAP);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";

    const typeRaw = val("brokerageType").toUpperCase();
    let brokerageType: CanonicalBrokerageRow["brokerageType"] = "other";
    if (typeRaw.includes("UPFRONT")) brokerageType = "upfront";
    else if (typeRaw.includes("TRAIL")) brokerageType = "trail";
    else if (typeRaw.includes("B30") || typeRaw.includes("B-30")) brokerageType = "b30";

    out.push({
      amcCode: val("amcCode"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      folioNumber: val("folioNumber"),
      pan: val("pan"),
      brokerageType,
      periodStart: normaliseDate(val("periodStart")) ?? today(),
      periodEnd: normaliseDate(val("periodEnd")) ?? today(),
      aumAmount: parseFloat(val("aumAmount") ?? "0") || 0,
      brokerageRate: parseFloat(val("brokerageRate") ?? "0") || 0,
      brokerageAmount: parseFloat(val("brokerageAmount") ?? "0") || 0,
    });
  }
  return out;
}

// ── Folio Master Dump ───────────────────────────────────────────────────

export function parseFolioMasterDump(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalFolioRow[] {
  const out: CanonicalFolioRow[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const delim = getDelimiter(source, lines[0]);
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, FOLIO_MST_ALIASES, DEFAULT_FOLIO_MST_MAP);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";

    out.push({
      pan: val("pan"),
      folioNumber: val("folioNumber"),
      amcCode: val("amcCode"),
      amcName: val("amcName") || val("amcCode"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      units: parseFloat(val("units") ?? "0") || 0,
      openedAt: normaliseDate(val("openedAt")) ?? undefined,
      closedAt: normaliseDate(val("closedAt")) ?? undefined,
      value: parseFloat(val("value") ?? "0") || undefined,
    });
  }
  return out;
}

// ── Active SIP Book ─────────────────────────────────────────────────────

export function parseSipBook(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalSipRow[] {
  const out: CanonicalSipRow[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const delim = getDelimiter(source, lines[0]);
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, SIP_BOOK_ALIASES, DEFAULT_SIP_BOOK_MAP);
  assertKnownLayout(start, lines[0] ?? "", delim, "SIP register");

  // CAMS calls the scheme-name column plainly `SCHEME`, which is too generic to
  // sit in SIP_BOOK_ALIASES: buildHeaderIndexMap takes the FIRST header matching
  // any alias, so a file carrying both `SCHEME` (a code) and `SCHEME_NAME` would
  // pick the wrong one. Resolve it only as a fallback, once the precise aliases
  // have had their chance.
  if (indexMap.schemeName === undefined) {
    const generic = buildHeaderIndexMap(splitLine(lines[0] ?? "", delim), { schemeName: ["SCHEME"] });
    if (generic.schemeName !== undefined) indexMap.schemeName = generic.schemeName;
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    // The optional status columns never decide whether a row is long enough.
    const maxIdx = Math.max(...Object.entries(indexMap).filter(([k]) => !OPTIONAL_SIP_COLUMNS.has(k)).map(([, v]) => v));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";

    // Many CRM-exported active-SIP reports carry only the scheme NAME, no code.
    // Fall back to the name as the code so the SIP row still keys + imports.
    const schemeName = val("schemeName");
    out.push({
      pan: val("pan"),
      folioNumber: val("folioNumber"),
      schemeCode: val("schemeCode") || schemeName,
      schemeName,
      amount: parseFloat(val("amount").replace(/[, ]/g, "")) || 0,
      frequency: normaliseFrequency(val("frequency")),
      sipDate: val("sipDate") || undefined,
      startDate: realDate(val("startDate")),
      endDate: realDate(val("endDate")),
      nextInstallmentAt: normaliseDate(val("nextInstallmentAt")) ?? undefined,
      mandateRefNo: val("mandateRefNo") || undefined,
      ceaseDate: realDate(val("ceaseDate")),
      registrationType: val("registrationType") || undefined,
      targetScheme: val("targetScheme") || undefined,
      registrarStatus: val("registrarStatus") || undefined,
      registrarRemark: val("registrarRemark") || undefined,
    });
  }
  return out;
}

const OPTIONAL_SIP_COLUMNS = new Set(["registrarStatus", "registrarRemark"]);

/**
 * A date that means something. A blank spreadsheet cell comes out as Excel's
 * day zero (1899-12-30 / 1900-01-01), which read as "ended in 1899"; anything
 * before 1950 is that artefact, not a real SIP date.
 */
function realDate(d?: string): string | undefined {
  // CAMS WBR49 writes US dates with a clock — "2/9/2010 12:00 AM" is 9 FEB.
  // The general reader takes d/m first, which misread every such date whose
  // day is 12 or less (cease and end dates included).
  const us = d?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)$/i);
  const iso = us
    ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
    : normaliseDate(d);
  return iso && iso >= "1950-01-01" ? iso : undefined;
}

// ── NACH Mandate Status ─────────────────────────────────────────────────

export function parseMandateStatus(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalMandateRow[] {
  const out: CanonicalMandateRow[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const delim = getDelimiter(source, lines[0]);
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, MANDATE_STATUS_ALIASES, DEFAULT_MANDATE_STATUS_MAP);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";

    out.push({
      pan: val("pan"),
      mandateRefNo: val("mandateRefNo"),
      bankAccountMasked: val("bankAccountMasked") || undefined,
      ifsc: val("ifsc") || undefined,
      amountLimit: parseFloat(val("amountLimit") ?? "0") || undefined,
      registeredAt: normaliseDate(val("registeredAt")) ?? undefined,
      expiresAt: normaliseDate(val("expiresAt")) ?? undefined,
      status: normaliseMandateStatus(val("status")),
    });
  }
  return out;
}

// ── Monthly AUM Statement ───────────────────────────────────────────────

export function parseAumStatement(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalAumRow[] {
  const out: CanonicalAumRow[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const delim = getDelimiter(source, lines[0]);
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, AUM_STATEMENT_ALIASES, DEFAULT_AUM_STATEMENT_MAP);
  assertKnownLayout(start, lines[0] ?? "", delim, "AUM statement");

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";

    out.push({
      pan: val("pan"),
      investorName: val("investorName") || undefined,
      folioNumber: val("folioNumber"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      units: parseFloat(val("units") ?? "0") || 0,
      nav: parseFloat(val("nav") ?? "0") || undefined,
      aumValue: parseFloat(val("aumValue") ?? "0") || 0,
      // Absent from statements that don't name the broker — the merge treats a
      // missing ARN as "unknown slice" rather than inventing one.
      arn: val("arn") || undefined,
    });
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getDelimiter(_source: string, text: string): string {
  // Sniff from the header line, not the source. The upload decoder normalises
  // every spreadsheet AND csv to pipe-delimited text, so KFin uploads are pipe
  // too — keying off `source === "kfintech"` would have mis-split them.
  if (text.includes("|")) return "|";
  if (text.includes("\t")) return "\t";
  return ",";
}

/**
 * Decide whether the first line is a header and build the column map.
 * A real header is detected when alias-matching actually finds a key column
 * (folio / PAN / mandate ref) — far more robust than literal keyword sniffing,
 * which failed on CAMS files that don't print the words "PAN"/"AUM"/"BROKERAGE".
 * Falls back to the positional default map when no header is recognised.
 */
/**
 * A first line made of column NAMES that resolveHeader could not place means a
 * layout this importer does not know. Reading it by position anyway put scheme
 * codes in the folio column and created a client per scheme (Attitude
 * Financial, 9 Oct 2026); and the ARN in the folio column of a KFintech SIP
 * report. Refuse instead, naming the columns, so the file is marked failed and
 * the layout gets added. A file with no header row at all still reads by
 * position.
 */
export class UnknownRtaLayoutError extends Error {}
function assertKnownLayout(start: number, firstLine: string, delim: string, what: string): void {
  if (start !== 0) return;
  const cells = splitLine(firstLine, delim).map((c) => c.trim()).filter(Boolean);
  if (cells.length < 3) return;
  const named = cells.filter((c) => /^[A-Za-z][A-Za-z0-9 _./()&-]*$/.test(c) && !/^\d/.test(c));
  if (named.length / cells.length < 0.8) return;
  throw new UnknownRtaLayoutError(
    `Unrecognised ${what} layout — no folio or PAN column among: ${cells.slice(0, 8).join(", ")}${cells.length > 8 ? ", …" : ""}. Nothing was imported.`
  );
}

function resolveHeader(
  firstLine: string,
  delim: string,
  aliases: Record<string, string[]>,
  fallback: Record<string, number>
): { start: number; indexMap: Record<string, number> } {
  const detected = buildHeaderIndexMap(splitLine(firstLine ?? "", delim), aliases);
  if (
    detected.folioNumber !== undefined ||
    detected.pan !== undefined ||
    detected.mandateRefNo !== undefined
  ) {
    return { start: 1, indexMap: detected };
  }
  return { start: 0, indexMap: fallback };
}

/**
 * Split one delimited line into fields.
 *
 * The comma case delegates to the shared RFC-4180 reader, which treats both `"`
 * and `'` as quotes — CAMS's "CSVWH" mailback wraps every text field in SINGLE
 * quotes, and the hand-rolled splitter this replaced only knew double quotes, so
 * every value arrived with its apostrophes attached (`'AJNPB9093L'`) and matched
 * nothing downstream. Same defect the transaction feed carried; fixed in both so
 * a single-quoted SIP register / brokerage / AUM statement parses too.
 */
function splitLine(line: string, delim: string): string[] {
  if (delim === ",") return parseCsv(line)[0] ?? [];
  return line.split(delim);
}

function normaliseFrequency(freq: string): "monthly" | "quarterly" | "weekly" | "fortnightly" | "yearly" {
  const f = freq.toLowerCase();
  // CAMS WBR49 codes: OM once a month, OW once a week, Q quarterly, OF / FN
  // fortnightly, OY / Y yearly. (D, daily, has no slot and stays monthly.)
  const code = f.trim();
  if (code === "ow" || code === "w") return "weekly";
  if (code === "q" || code === "oq") return "quarterly";
  if (code === "of" || code === "fn") return "fortnightly";
  if (code === "oy" || code === "y") return "yearly";
  if (f.includes("quarter")) return "quarterly";
  if (f.includes("weekly")) return "weekly";
  if (f.includes("fortnight")) return "fortnightly";
  if (f.includes("year")) return "yearly";
  return "monthly";
}

function normaliseMandateStatus(s: string): "pending" | "active" | "expired" | "rejected" | "cancelled" {
  const status = s.toLowerCase();
  if (status.includes("active") || status.includes("approved") || status.includes("success")) return "active";
  if (status.includes("expired")) return "expired";
  if (status.includes("reject") || status.includes("fail")) return "rejected";
  if (status.includes("cancel")) return "cancelled";
  return "pending";
}

const MONTHS_MAP: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function normaliseDate(d?: string): string | null {
  if (!d) return null;
  const s = d.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (dmy) {
    let day = parseInt(dmy[1], 10);
    let mon = parseInt(dmy[2], 10);
    if (mon > 12 && day <= 12) [day, mon] = [mon, day]; // MM/DD feed — swap
    return `${dmy[3]}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  // DD-MON-YYYY (e.g. 31-May-2026, common in CAMS AUM exports).
  const dmon = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{4})/);
  if (dmon) {
    const mm = MONTHS_MAP[dmon[2].toUpperCase()];
    if (mm) return `${dmon[3]}-${mm}-${dmon[1].padStart(2, "0")}`;
  }
  return null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
