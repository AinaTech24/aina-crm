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

  // Detect delimiter: CAMS pipes, KFintech commas.
  const delim = source === "kfintech" ? "," : "|";

  // Header detection — skip the first row if it contains "PAN" + "Reject"
  let start = 0;
  if (
    lines[0]?.toUpperCase().includes("PAN") &&
    (lines[0].toUpperCase().includes("REJECT") || lines[0].toUpperCase().includes("FAIL"))
  ) {
    start = 1;
  }

  // Expected column order (typical CAMS SIP-RJ layout):
  // 0:AMC 1:Folio 2:PAN 3:Scheme 4:RejectDate 5:Amount 6:ReasonCode 7:ReasonDesc
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(delim);
    if (cols.length < 6) continue;

    const reasonCode = cols[6]?.trim();
    out.push({
      amcName: cols[0]?.trim() ?? "",
      folioNumber: cols[1]?.trim() ?? "",
      pan: cols[2]?.trim() ?? "",
      schemeName: cols[3]?.trim() ?? "",
      rejectionDate: normaliseDate(cols[4]) ?? today(),
      amount: parseFloat(cols[5] ?? "0") || 0,
      reasonCode,
      reason:
        (reasonCode && REASON_CODE_MAP[reasonCode]) ??
        cols[7]?.trim() ??
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

  // Header detection: row contains "Brokerage" or "Commission"
  let start = 0;
  if (
    lines[0]?.toUpperCase().includes("BROKERAGE") ||
    lines[0]?.toUpperCase().includes("COMMISSION")
  ) {
    start = 1;
  }

  // Expected: 0:AMCCode 1:SchemeCode 2:SchemeName 3:Folio 4:PAN
  //           5:Type 6:PeriodStart 7:PeriodEnd 8:AUM 9:Rate 10:Amount
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(delim);
    if (cols.length < 11) continue;

    const typeRaw = (cols[5] ?? "").toUpperCase();
    let brokerageType: CanonicalBrokerageRow["brokerageType"] = "other";
    if (typeRaw.includes("UPFRONT")) brokerageType = "upfront";
    else if (typeRaw.includes("TRAIL")) brokerageType = "trail";
    else if (typeRaw.includes("B30") || typeRaw.includes("B-30")) brokerageType = "b30";

    out.push({
      amcCode: cols[0]?.trim() ?? "",
      schemeCode: cols[1]?.trim() ?? "",
      schemeName: cols[2]?.trim() ?? "",
      folioNumber: cols[3]?.trim() ?? "",
      pan: cols[4]?.trim() ?? "",
      brokerageType,
      periodStart: normaliseDate(cols[6]) ?? today(),
      periodEnd: normaliseDate(cols[7]) ?? today(),
      aumAmount: parseFloat(cols[8] ?? "0") || 0,
      brokerageRate: parseFloat(cols[9] ?? "0") || 0,
      brokerageAmount: parseFloat(cols[10] ?? "0") || 0,
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
