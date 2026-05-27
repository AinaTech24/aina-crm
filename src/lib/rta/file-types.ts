/**
 * RTA file-type catalog.
 *
 * Every file type the platform ingests from CAMS / KFintech / MFU / BSE / NSE
 * is defined here, with:
 *   - human label + short description (for the upload UI)
 *   - upload cadence (drives "next expected" + "late by" warnings)
 *   - which downstream tables it populates
 *   - which source(s) emit it
 *   - which acronyms (CAMS-WBR, KFin-DLY etc.) it is commonly known by
 *
 * Single source of truth. The dashboard tiles, the upload dialog dropdown,
 * the parser registry, and the help glossary all import from here so we
 * never drift.
 */
import type { RtaFileKind, RtaSource } from "@/db/schema/rta_imports";

export type Cadence =
  | { every: "daily"; businessDaysOnly: boolean }
  | { every: "weekly"; dayOfWeek: number /* 1=Mon ... 7=Sun */ }
  | { every: "monthly"; dayOfMonth: number /* e.g. 10 for brokerage by 10th */ }
  | { every: "quarterly" }
  | { every: "adhoc" };

export type RtaFileTypeDef = {
  kind: RtaFileKind;
  label: string;
  short: string;            // 1-sentence summary shown on tiles
  long: string;             // full explanation for the help panel
  sources: RtaSource[];     // who emits this file
  acronyms: string[];       // industry shorthand
  cadence: Cadence;
  /** What tables get populated when this file is imported. */
  populates: Array<
    | "transactions"
    | "sip_rejections"
    | "folios"
    | "investors"
    | "sips"
    | "commission_statements"
    | "commission_rows"
    | "aum_snapshots"
    | "corporate_actions"
  >;
  /** Grace window before we mark a tenant "late" on this file. */
  graceDays: number;
  /** Higher = more important; drives sort order on the dashboard. */
  priority: number;
};

export const RTA_FILE_TYPES: RtaFileTypeDef[] = [
  // ────────────────────────────────────────────────────── Daily ──
  {
    kind: "daily_transaction_feed",
    label: "Daily transaction feed",
    short: "Every purchase, redemption, switch, SIP, STP & SWP that processed yesterday.",
    long: "The T+1 reverse feed. Pipe-delimited (CAMS) or CSV (KFintech). Drives folio NAV refresh, AUM, and the SIP rejection module. Without this the dashboard numbers won't move.",
    sources: ["cams", "kfintech"],
    acronyms: ["WB feed", "Distributor feed", "T+1 file"],
    cadence: { every: "daily", businessDaysOnly: true },
    populates: ["transactions", "folios", "sips"],
    graceDays: 1,
    priority: 100,
  },
  {
    kind: "sip_rejection_report",
    label: "SIP rejection report",
    short: "Bank NACH bounces & SIP failures from the previous business day.",
    long: "Per-investor SIP failures with reason code (insufficient balance, mandate inactive, signature mismatch, account closed). Drives the SIP rejection module + recovery workflow.",
    sources: ["cams", "kfintech"],
    acronyms: ["SIP-RJ", "NACH bounce"],
    cadence: { every: "daily", businessDaysOnly: true },
    populates: ["sip_rejections", "transactions"],
    graceDays: 1,
    priority: 95,
  },
  {
    kind: "nach_mandate_status",
    label: "NACH mandate status",
    short: "New mandate registrations and cancellations.",
    long: "Tracks which investor mandates went live, expired, or were cancelled. Used to validate SIP eligibility before the next debit cycle.",
    sources: ["cams", "kfintech"],
    acronyms: ["UMRN status", "OTM status"],
    cadence: { every: "daily", businessDaysOnly: true },
    populates: ["sips"],
    graceDays: 2,
    priority: 70,
  },
  {
    kind: "redemption_report",
    label: "Redemption report",
    short: "All redemptions / partial-redemptions processed on the previous business day.",
    long: "Detail of every investor who pulled money out. Drives liquidity-trend dashboards + alerts the RM to call high-value redemptions.",
    sources: ["cams", "kfintech"],
    acronyms: ["RED-DLY"],
    cadence: { every: "daily", businessDaysOnly: true },
    populates: ["transactions"],
    graceDays: 1,
    priority: 80,
  },
  // ──────────────────────────────────────────────────── Weekly ──
  {
    kind: "wbr_weekly_business",
    label: "Weekly Business Report",
    short: "Net business summary for the previous week, broken down by AMC.",
    long: "Sales + redemptions + net flow per AMC, plus distributor-level commission accrual. Sent every Monday for the prior Mon-Fri.",
    sources: ["cams", "kfintech"],
    acronyms: ["WBR"],
    cadence: { every: "weekly", dayOfWeek: 1 },
    populates: ["aum_snapshots"],
    graceDays: 2,
    priority: 60,
  },
  // ─────────────────────────────────────────────────── Monthly ──
  {
    kind: "monthly_brokerage",
    label: "Monthly brokerage statement",
    short: "Commission earned across every AMC for the previous month.",
    long: "The most important monthly file. Drives the commission reconciliation engine — three-way matches AMC-stated commission vs system-computed vs bank credit. Usually arrives between the 5th and the 10th.",
    sources: ["cams", "kfintech"],
    acronyms: ["Brokerage Stmt", "BR-MTH"],
    cadence: { every: "monthly", dayOfMonth: 10 },
    populates: ["commission_statements", "commission_rows"],
    graceDays: 5,
    priority: 90,
  },
  {
    kind: "monthly_aum_statement",
    label: "Monthly AUM statement",
    short: "End-of-month AUM snapshot per AMC and per investor.",
    long: "Used to compute monthly trail commission and to reconcile AUM displayed on the Owner Cockpit. Comes from CAMS by the 5th, KFintech by the 7th.",
    sources: ["cams", "kfintech"],
    acronyms: ["AUM-MTH"],
    cadence: { every: "monthly", dayOfMonth: 7 },
    populates: ["aum_snapshots"],
    graceDays: 3,
    priority: 85,
  },
  {
    kind: "monthly_sip_book",
    label: "Active SIP book",
    short: "All live SIPs as of month-end with next-debit-date and remaining instalments.",
    long: "Audit-grade source of truth for active SIP count. Reconciles the SIP tracker against the registrar's view.",
    sources: ["cams", "kfintech"],
    acronyms: ["SIP-Reg"],
    cadence: { every: "monthly", dayOfMonth: 5 },
    populates: ["sips"],
    graceDays: 3,
    priority: 65,
  },
  // ───────────────────────────────────────────────── Quarterly ──
  {
    kind: "folio_master_dump",
    label: "Folio master dump",
    short: "Full investor + folio register refresh.",
    long: "Quarterly reconciliation file with every folio, holder, nominee and bank mandate on record. Used to detect investor data drift.",
    sources: ["cams", "kfintech"],
    acronyms: ["FOL-MST"],
    cadence: { every: "quarterly" },
    populates: ["folios", "investors"],
    graceDays: 7,
    priority: 40,
  },
  // ──────────────────────────────────────────────────── Ad-hoc ──
  {
    kind: "corporate_actions",
    label: "Corporate actions",
    short: "Dividends, bonus units, splits, scheme mergers.",
    long: "Triggered by AMC events. Each row affects investor holdings and tax slip generation.",
    sources: ["cams", "kfintech"],
    acronyms: ["CA"],
    cadence: { every: "adhoc" },
    populates: ["transactions", "corporate_actions"],
    graceDays: 30,
    priority: 30,
  },
  {
    kind: "cas_holdings",
    label: "Consolidated Account Statement",
    short: "Investor-level holdings statement (the CAS the AMC mails investors).",
    long: "Optional. Some MFDs ingest the CAS PDF/email to verify the platform's view matches what the investor sees.",
    sources: ["cams", "kfintech", "mfu"],
    acronyms: ["CAS"],
    cadence: { every: "adhoc" },
    populates: ["folios"],
    graceDays: 30,
    priority: 20,
  },
];

/** Quick lookup map. */
export const RTA_FILE_TYPE_BY_KIND: Record<RtaFileKind, RtaFileTypeDef> =
  Object.fromEntries(RTA_FILE_TYPES.map((t) => [t.kind, t])) as any;

// ───────────────────────────────────────────────── Cadence helpers ──

/**
 * When is this file *next* expected to land, given a `lastPeriodEnd` (the
 * end date of the most recent successfully-imported file of this kind)?
 * Returns null if cadence is ad-hoc (no schedule).
 */
export function nextExpectedDate(
  cadence: Cadence,
  lastPeriodEnd: Date | null,
  now: Date = new Date()
): Date | null {
  if (cadence.every === "adhoc") return null;

  // If we've never received a file, the next expected is the next valid
  // slot from today.
  const base = lastPeriodEnd ?? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

  if (cadence.every === "daily") {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    if (cadence.businessDaysOnly) {
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    }
    return d;
  }
  if (cadence.every === "weekly") {
    const d = new Date(base);
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (cadence.every === "monthly") {
    const d = new Date(base);
    d.setMonth(d.getMonth() + 1);
    d.setDate(cadence.dayOfMonth);
    return d;
  }
  if (cadence.every === "quarterly") {
    const d = new Date(base);
    d.setMonth(d.getMonth() + 3);
    return d;
  }
  return null;
}

/** Days late this file is vs its expected arrival. Negative = upcoming. */
export function daysLate(
  cadence: Cadence,
  lastPeriodEnd: Date | null,
  graceDays: number,
  now: Date = new Date()
): number {
  const exp = nextExpectedDate(cadence, lastPeriodEnd, now);
  if (!exp) return 0;
  const ms = now.getTime() - exp.getTime();
  const days = Math.floor(ms / 86400000);
  return Math.max(0, days - graceDays);
}

/** Human-readable cadence label. */
export function cadenceLabel(c: Cadence): string {
  switch (c.every) {
    case "daily":
      return c.businessDaysOnly ? "Every business day" : "Daily";
    case "weekly":
      return `Weekly (${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][c.dayOfWeek - 1]})`;
    case "monthly":
      return `Monthly (by the ${c.dayOfMonth}${suffix(c.dayOfMonth)})`;
    case "quarterly":
      return "Quarterly";
    case "adhoc":
      return "Ad-hoc";
  }
}

function suffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
