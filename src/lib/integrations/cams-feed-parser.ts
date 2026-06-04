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
export const HEADER_ALIASES: Record<string, string[]> = {
  amcCode: ["AMC", "AMC_CODE", "AMCCOD", "AMC_NAME", "AMC NAME", "FMIM_CODE", "AMC_CD"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO"],
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCH_CD"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME"],
  type: ["TR_TYPE", "TXN_TYPE", "TRANS_TYPE", "TRTYPE", "TXNTYPE", "TRANSTYPE", "TYPE", "TRANS_DESC", "TRANS DESCRIPTION", "TXN_DESC_CAMS"],
  orderDate: ["TR_DATE", "TXN_DATE", "TRANS_DATE", "TRDATE", "TXNDATE", "TRANSDATE", "DATE", "POST_DATE", "POST DATE", "TXN_DT"],
  amount: ["AMOUNT", "AMT", "TXN_AMT", "TXN_AMOUNT", "TRANS_AMT", "PURCHASE_AMOUNT", "RED_AMOUNT"],
  units: ["UNITS", "UNIT", "QTY", "QUANTITY", "NO_OF_UNITS", "NO OF UNITS"],
  nav: ["NAV", "RATE", "NAV_PUR", "NAV_RATE", "PUR_NAV", "ALLOT_NAV", "ALLOTNAV"],
  externalRef: ["ORDER_REF", "REF_NO", "REF NO", "TXN_ID", "TXN ID", "TXN_REF", "TXN REF", "REF_NUM", "REF NUM"],
  status: ["STATUS", "TR_STATUS", "TXN_STATUS", "STATUS_DESC", "STATUS DESC"],
  reasonCode: ["REASON_CODE", "REJ_CODE", "REJECT_CODE", "REASON CODE", "REJ CODE", "REJ_REASON", "REJ REASON"],
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

/**
 * Parse a CAMS distributor feed (pipe-delimited).
 * Spec subset — real file has 40+ fields; we extract the ones we need.
 */
export function parseCamsFeed(text: string): CanonicalTransaction[] {
  const rows: CanonicalTransaction[] = [];
  const lines = text.split(/\r?\n/);
  let dataStart = 0;
  let indexMap = DEFAULT_CAMS_MAP;

  // Header detection: first line, contains "PAN" + "Folio"
  if (lines[0]?.toUpperCase().includes("PAN") && (lines[0]?.toUpperCase().includes("FOLIO") || lines[0]?.toUpperCase().includes("CLIENT"))) {
    dataStart = 1;
    const headerCols = lines[0].split("|");
    indexMap = { ...DEFAULT_CAMS_MAP, ...buildHeaderIndexMap(headerCols) };
  }

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split("|");
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field]]?.trim() ?? "";

    const trType = val("type").toUpperCase();
    const ourType = CAMS_TRANSACTION_TYPES[trType] ?? "lumpsum";
    const amount = parseFloat(val("amount") ?? "0") || 0;
    const direction: "inflow" | "outflow" =
      ourType === "redemption" || ourType === "swp" || ourType === "dividend_payout" || ourType === "stp"
        ? "outflow"
        : "inflow";

    rows.push({
      externalRef: val("externalRef") || `cams_${i}`,
      pan: val("pan"),
      folioNumber: val("folioNumber"),
      amcCode: val("amcCode"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      type: ourType,
      direction,
      amount,
      units: parseFloat(val("units") ?? "0") || 0,
      nav: parseFloat(val("nav") ?? "0") || 0,
      orderDate: normalizeDate(val("orderDate")),
      status:
        val("status").toUpperCase() === "ALLOTTED" || val("status").toUpperCase() === "SUCCESS"
          ? "successful"
          : val("status").toUpperCase() === "REJECTED"
          ? "rejected"
          : val("status").toUpperCase() === "FAILED"
          ? "failed"
          : "pending",
      reasonCode: val("reasonCode") || undefined,
    });
  }
  return rows;
}

/**
 * KFintech feed — comma-delimited with similar shape. Subset implementation.
 */
export function parseKfintechFeed(text: string): CanonicalTransaction[] {
  const rows: CanonicalTransaction[] = [];
  const lines = text.split(/\r?\n/);
  let dataStart = 0;
  let indexMap = DEFAULT_CAMS_MAP;

  if (lines[0]?.toUpperCase().includes("PAN") && (lines[0]?.toUpperCase().includes("FOLIO") || lines[0]?.toUpperCase().includes("CLIENT"))) {
    dataStart = 1;
    const headerCols = parseCsvRow(lines[0]);
    indexMap = { ...DEFAULT_CAMS_MAP, ...buildHeaderIndexMap(headerCols) };
  }

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvRow(line);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field]]?.trim() ?? "";

    const trType = val("type").toUpperCase();
    const ourType = KFIN_TRANSACTION_TYPES[trType] ?? "lumpsum";

    rows.push({
      externalRef: val("externalRef") || `kfin_${i}`,
      pan: val("pan"),
      folioNumber: val("folioNumber"),
      amcCode: val("amcCode"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      type: ourType,
      direction:
        ourType === "redemption" || ourType === "swp" || ourType === "dividend_payout" || ourType === "stp"
          ? "outflow"
          : "inflow",
      amount: parseFloat(val("amount") ?? "0") || 0,
      units: parseFloat(val("units") ?? "0") || 0,
      nav: parseFloat(val("nav") ?? "0") || 0,
      orderDate: normalizeDate(val("orderDate")),
      status:
        val("status").toUpperCase() === "SUCCESS" || val("status").toUpperCase() === "ALLOTTED"
          ? "successful"
          : val("status").toUpperCase() === "REJECTED"
          ? "rejected"
          : val("status").toUpperCase() === "FAILED"
          ? "failed"
          : "pending",
      reasonCode: val("reasonCode") || undefined,
    });
  }
  return rows;
}

function normalizeDate(d: string | undefined): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  const m = d.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return d;
}

function parseCsvRow(line: string): string[] {
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
