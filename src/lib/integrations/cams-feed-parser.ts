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

export type CanonicalTransaction = {
  externalRef: string;
  pan: string;
  folioNumber: string;
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

const KFIN_TRANSACTION_TYPES = CAMS_TRANSACTION_TYPES;

/**
 * Parse a CAMS distributor feed (pipe-delimited).
 * Spec subset — real file has 40+ fields; we extract the ones we need.
 */
export function parseCamsFeed(text: string): CanonicalTransaction[] {
  const rows: CanonicalTransaction[] = [];
  const lines = text.split(/\r?\n/);
  // Header detection: first line, contains "PAN" + "Folio"
  let dataStart = 0;
  if (lines[0]?.toUpperCase().includes("PAN") && lines[0]?.toUpperCase().includes("FOLIO")) {
    dataStart = 1;
  }
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split("|");
    if (cols.length < 14) continue;

    // Representative CAMS field layout (varies slightly per RTA):
    // 0:AMCName 1:FolioNo 2:PAN 3:InvestorName 4:SchemeCode 5:SchemeName
    // 6:TrType 7:TrDate 8:Amount 9:Units 10:NAV 11:OrderRef 12:Status 13:ReasonCode
    const trType = cols[6]?.toUpperCase();
    const ourType = CAMS_TRANSACTION_TYPES[trType] ?? "lumpsum";
    const amount = parseFloat(cols[8] ?? "0");
    const direction: "inflow" | "outflow" =
      ourType === "redemption" || ourType === "swp" || ourType === "dividend_payout" || ourType === "stp"
        ? "outflow"
        : "inflow";

    rows.push({
      externalRef: cols[11] ?? `cams_${i}`,
      pan: cols[2] ?? "",
      folioNumber: cols[1] ?? "",
      amcCode: cols[0] ?? "",
      schemeCode: cols[4] ?? "",
      schemeName: cols[5] ?? "",
      type: ourType,
      direction,
      amount,
      units: parseFloat(cols[9] ?? "0"),
      nav: parseFloat(cols[10] ?? "0"),
      orderDate: normalizeDate(cols[7]),
      status:
        cols[12]?.toUpperCase() === "ALLOTTED" || cols[12]?.toUpperCase() === "SUCCESS"
          ? "successful"
          : cols[12]?.toUpperCase() === "REJECTED"
          ? "rejected"
          : cols[12]?.toUpperCase() === "FAILED"
          ? "failed"
          : "pending",
      reasonCode: cols[13] || undefined,
    });
  }
  return rows;
}

/**
 * KFintech feed — comma-delimited with similar shape. Subset implementation.
 */
export function parseKfintechFeed(text: string): CanonicalTransaction[] {
  // For brevity we reuse the CAMS shape with CSV parsing.
  const rows: CanonicalTransaction[] = [];
  const lines = text.split(/\r?\n/);
  let dataStart = 0;
  if (lines[0]?.toUpperCase().includes("PAN")) dataStart = 1;
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvRow(line);
    if (cols.length < 14) continue;
    const trType = cols[6]?.toUpperCase() ?? "";
    const ourType = KFIN_TRANSACTION_TYPES[trType] ?? "lumpsum";
    rows.push({
      externalRef: cols[11] ?? `kfin_${i}`,
      pan: cols[2] ?? "",
      folioNumber: cols[1] ?? "",
      amcCode: cols[0] ?? "",
      schemeCode: cols[4] ?? "",
      schemeName: cols[5] ?? "",
      type: ourType,
      direction:
        ourType === "redemption" || ourType === "swp" || ourType === "dividend_payout" || ourType === "stp"
          ? "outflow"
          : "inflow",
      amount: parseFloat(cols[8] ?? "0"),
      units: parseFloat(cols[9] ?? "0"),
      nav: parseFloat(cols[10] ?? "0"),
      orderDate: normalizeDate(cols[7]),
      status: (cols[12] ?? "").toUpperCase() === "SUCCESS" ? "successful" : "pending",
      reasonCode: cols[13] || undefined,
    });
  }
  return rows;
}

function normalizeDate(d: string | undefined): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  // CAMS feed uses DD-MM-YYYY or DD/MM/YYYY
  const m = d.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return d;
}

function parseCsvRow(line: string): string[] {
  // Minimal CSV with quote support.
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
