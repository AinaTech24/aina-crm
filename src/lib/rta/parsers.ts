import { buildHeaderIndexMap } from "../integrations/cams-feed-parser";

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
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME"],
  rejectionDate: ["REJECT_DATE", "REJECTION_DATE", "REJ_DATE", "REJECT DATE", "REJECTION DATE", "DATE", "REJ_DT"],
  amount: ["AMOUNT", "AMT", "TXN_AMT", "TXN_AMOUNT", "TRANS_AMT", "SIP_AMOUNT"],
  reasonCode: ["REASON_CODE", "REJ_CODE", "REJECT_CODE", "REASON CODE", "REJ CODE", "REJ_REASON", "REJ REASON", "FAIL_CODE"],
  reason: ["REASON", "REASON_DESC", "REASON DESCRIPTION", "REMARK", "REMARKS", "REJ_DESC", "REJECT_DESC", "REJECTION_REASON"],
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
  amcCode: ["AMC", "AMC_CODE", "AMCCOD", "AMC_CD"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO"],
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER"],
  brokerageType: ["TYPE", "BROKERAGE_TYPE", "COMMISSION_TYPE", "BROK_TYPE", "COMM_TYPE"],
  periodStart: ["PERIOD_START", "START_DATE", "FROM_DATE", "FROM DATE", "PERIOD START", "START DATE"],
  periodEnd: ["PERIOD_END", "END_DATE", "TO_DATE", "TO DATE", "PERIOD END", "END DATE"],
  aumAmount: ["AUM", "AVG_AUM", "AVERAGE_AUM", "AUM_AMOUNT", "AVG AUM", "AVERAGE AUM"],
  brokerageRate: ["RATE", "BROKERAGE_RATE", "COMMISSION_RATE", "BROK_RATE", "COMM_RATE"],
  brokerageAmount: ["AMOUNT", "BROKERAGE_AMOUNT", "COMMISSION_AMOUNT", "BROK_AMOUNT", "COMM_AMOUNT", "NET_AMOUNT"],
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

  const delim = source === "kfintech" ? "," : "|";

  let start = 0;
  let indexMap = DEFAULT_SIP_REJECT_MAP;

  const firstLineUpper = lines[0]?.toUpperCase() ?? "";
  if (
    firstLineUpper.includes("PAN") &&
    (firstLineUpper.includes("REJECT") || firstLineUpper.includes("FAIL") || firstLineUpper.includes("FOLIO"))
  ) {
    start = 1;
    const headerCols = lines[0].split(delim);
    indexMap = { ...DEFAULT_SIP_REJECT_MAP, ...buildHeaderIndexMap(headerCols, SIP_REJECT_ALIASES) };
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field]]?.trim() ?? "";
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
  const delim = source === "kfintech" ? "," : "|";

  let start = 0;
  let indexMap = DEFAULT_BROKERAGE_MAP;

  const firstLineUpper = lines[0]?.toUpperCase() ?? "";
  if (
    firstLineUpper.includes("BROKERAGE") ||
    firstLineUpper.includes("COMMISSION") ||
    (firstLineUpper.includes("PAN") && firstLineUpper.includes("FOLIO"))
  ) {
    start = 1;
    const headerCols = lines[0].split(delim);
    indexMap = { ...DEFAULT_BROKERAGE_MAP, ...buildHeaderIndexMap(headerCols, BROKERAGE_ALIASES) };
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field]]?.trim() ?? "";

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

// ── Helpers ─────────────────────────────────────────────────────────────

function normaliseDate(d?: string): string | null {
  if (!d) return null;
  const s = d.trim();
  const dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
