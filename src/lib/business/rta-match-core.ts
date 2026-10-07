/**
 * Booked business vs the RTA — the pure half, with no database, so the rules
 * are tested (tests/business-rta-match.test.ts) and lib/business/rta-match.ts
 * only loads and saves.
 *
 * A business entry line is what the team BOOKED the day Operations did the
 * work; the registrar's feed (CAMS / KFintech) says, days later, what actually
 * happened. For each line we look for the RTA transaction that settled it,
 * using only what both sides reliably carry:
 *
 *   - the same client;
 *   - the same kind of transaction: a lumpsum is settled by a purchase, a SIP
 *     by its first instalment, a redemption by a redemption, a SIP stop by the
 *     RTA's stop record;
 *   - the same scheme, compared by name — the feed carries the registrar's
 *     product codes, not AMFI's (lib/proposals/execution.ts schemeMatches);
 *     for a switch or STP either the target or the source scheme;
 *   - the same folio, when both sides name one;
 *   - a trade date from the day before the booking to SEARCH_DAYS after it;
 *   - and, where the line has an amount, an amount within a small tolerance:
 *     stamp duty (0.005%) and rounding on a purchase, exit load on a redemption.
 *
 * A transaction settles at most one line, and a processed record beats a
 * rejected one: a failed payment retried the next day is still business.
 *
 * Outcomes:
 *   confirmed       processed, amount agrees
 *   mismatch        processed, a different amount (Operations checks it)
 *   rejected        only rejected / failed records — or, for a SIP, a bounced
 *                   first debit of the same amount
 *   pending         nothing yet, or a record still in flight at the RTA
 *   not_found       nothing, although the imported ledger reaches past the
 *                   firm's wait — no data is never "not found"
 *   not_applicable  a product or line the RTA never reports (PMS, AIF, SIF,
 *                   bonds …; a SIP top-up, which has no record of its own)
 */

import { schemeMatches } from "@/lib/proposals/execution";

export type RtaLineStatus = "pending" | "confirmed" | "mismatch" | "rejected" | "not_found" | "not_applicable";

/** How far after the business date a settling record is looked for. */
export const SEARCH_DAYS = 60;

/** The RTA transaction types that can settle each kind of booked line. */
export const RTA_TYPES_FOR_LINE: Readonly<Record<string, readonly string[]>> = {
  lumpsum: ["purchase", "lumpsum", "additional_purchase"],
  additional_purchase: ["purchase", "lumpsum", "additional_purchase"],
  sip: ["sip"],
  sip_stop: ["sip_stop", "sip_pause"],
  switch: ["switch"],
  stp: ["stp"],
  swp: ["swp"],
  redemption: ["redemption"],
};

/** Lines whose RTA record can take a month to appear wait longer (rtaSipNotFoundDays). */
const LONG_WAIT = new Set(["sip", "sip_stop"]);
const REDEEMS = new Set(["redemption", "swp"]);
const PROCESSED = new Set(["processed", "successful"]);
const REJECTED = new Set(["rejected", "failed", "cancelled"]);

export type MatchLine = {
  id: string;
  investorId: string | null;
  productType: string;
  /** YYYY-MM-DD */
  businessDate: string;
  txnType: string;
  schemeName: string;
  fromSchemeName: string | null;
  folioNo: string | null;
  /** 0 when the line was keyed in units. */
  amount: number;
};

export type MatchTxn = {
  id: string;
  investorId: string;
  type: string;
  status: string;
  /** YYYY-MM-DD — the trade date the ledger counts business on. */
  orderDate: string;
  amount: number | null;
  schemeName: string | null;
  folioNumber: string | null;
  reason: string | null;
};

/** A bounced SIP debit (sip_rejections). */
export type MatchBounce = {
  investorId: string;
  schemeName: string | null;
  folioNumber: string | null;
  /** YYYY-MM-DD */
  rejectionDate: string;
  amount: number;
  reason: string | null;
};

export type MatchSettings = {
  /** YYYY-MM-DD, India. */
  today: string;
  /** The last trade date the imported ledger reaches, or null with no ledger. */
  ledgerLast: string | null;
  notFoundDays: number;
  sipNotFoundDays: number;
  /** Transactions already settling OTHER lines — never used twice. */
  taken?: Iterable<string>;
};

export type LineOutcome = {
  lineId: string;
  status: RtaLineStatus;
  /** The date the outcome counts on: trade date, rejection date, or the day the wait ran out. */
  statusAt: string | null;
  rtaAmount: number | null;
  note: string | null;
  /** The transaction now linked to the line (none for not_found / not_applicable / a bounce). */
  txnIds: string[];
};

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dayDistance = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

const normFolio = (f: string) => f.replace(/[^0-9a-z]/gi, "").toLowerCase();
const foliosClash = (a: string | null, b: string | null) => !!a && !!b && normFolio(a) !== normFolio(b);

const rupees = (n: number | null) =>
  n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Does the RTA amount agree with the booked one? Nothing to compare (a line
 * keyed in units, a feed row without an amount) agrees.
 */
export function amountAgrees(booked: number, rta: number | null, lineType: string): boolean {
  if (!(booked > 0) || rta == null) return true;
  const share = REDEEMS.has(lineType) ? 0.02 : 0.01;
  return Math.abs(rta - booked) <= Math.max(10, booked * share);
}

/** The closest record: an agreeing amount first, then the nearest trade date. */
function best<T extends { amount: number | null }>(xs: T[], line: MatchLine, dateOf: (x: T) => string): T {
  return [...xs].sort((a, b) => {
    const aa = amountAgrees(line.amount, a.amount, line.txnType) ? 0 : 1;
    const bb = amountAgrees(line.amount, b.amount, line.txnType) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return dayDistance(dateOf(a), line.businessDate) - dayDistance(dateOf(b), line.businessDate);
  })[0];
}

/** Decide every line. Older bookings claim records first. */
export function settleLines(lines: MatchLine[], txns: MatchTxn[], bounces: MatchBounce[], s: MatchSettings): LineOutcome[] {
  const taken = new Set<string>(s.taken ?? []);
  const ordered = [...lines].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id));
  return ordered.map((line) => settleOne(line, txns, bounces, taken, s));
}

function settleOne(line: MatchLine, txns: MatchTxn[], bounces: MatchBounce[], taken: Set<string>, s: MatchSettings): LineOutcome {
  const none = { lineId: line.id, rtaAmount: null, txnIds: [] as string[] };
  if (line.productType !== "mutual_fund") {
    return { ...none, status: "not_applicable", statusAt: null, note: "Not a mutual fund — the RTA does not report it." };
  }
  const types = RTA_TYPES_FOR_LINE[line.txnType];
  if (!types) {
    return {
      ...none, status: "not_applicable", statusAt: null,
      note: line.txnType === "sip_topup"
        ? "The RTA has no separate record of a SIP top-up."
        : "The RTA has no record of this kind of line.",
    };
  }
  if (!line.investorId) return waiting(line, s, "No client is linked to this entry, so it cannot be matched.");

  const from = addDays(line.businessDate, -1);
  const to = addDays(line.businessDate, SEARCH_DAYS);
  const switchLike = line.txnType === "switch" || line.txnType === "stp";
  const candidates = txns.filter((t) =>
    !taken.has(t.id)
    && t.investorId === line.investorId
    && types.includes(t.type)
    && t.orderDate >= from && t.orderDate <= to
    && !foliosClash(line.folioNo, t.folioNumber)
    && (schemeMatches(line.schemeName, t.schemeName)
      || (switchLike && !!line.fromSchemeName && schemeMatches(line.fromSchemeName, t.schemeName))));

  const processed = candidates.filter((t) => PROCESSED.has(t.status));
  if (processed.length) {
    const t = best(processed, line, (x) => x.orderDate);
    taken.add(t.id);
    const agrees = amountAgrees(line.amount, t.amount, line.txnType);
    return {
      lineId: line.id, txnIds: [t.id], rtaAmount: t.amount, statusAt: t.orderDate,
      status: agrees ? "confirmed" : "mismatch",
      note: agrees ? null : `The RTA processed ${rupees(t.amount)} against ${rupees(line.amount)} booked.`,
    };
  }

  const inFlight = candidates.filter((t) => !PROCESSED.has(t.status) && !REJECTED.has(t.status));
  if (inFlight.length) {
    const t = best(inFlight, line, (x) => x.orderDate);
    taken.add(t.id);
    return { lineId: line.id, txnIds: [t.id], rtaAmount: t.amount, statusAt: null, status: "pending", note: "At the RTA, not processed yet." };
  }

  const rejected = candidates.filter((t) => REJECTED.has(t.status));
  if (rejected.length) {
    const t = best(rejected, line, (x) => x.orderDate);
    taken.add(t.id);
    return {
      lineId: line.id, txnIds: [t.id], rtaAmount: t.amount, statusAt: t.orderDate, status: "rejected",
      note: t.reason ? `Rejected by the RTA: ${t.reason}` : "Rejected by the RTA.",
    };
  }

  if (line.txnType === "sip") {
    // A bounced first debit rejects a booked SIP. The amount must agree, so an
    // older SIP in the same scheme bouncing that month is not mistaken for it.
    const bounced = bounces.filter((b) =>
      b.investorId === line.investorId
      && b.rejectionDate >= from && b.rejectionDate <= to
      && !foliosClash(line.folioNo, b.folioNumber)
      && schemeMatches(line.schemeName, b.schemeName)
      && amountAgrees(line.amount, b.amount, line.txnType));
    if (bounced.length) {
      const b = best(bounced, line, (x) => x.rejectionDate);
      return {
        ...none, rtaAmount: b.amount, statusAt: b.rejectionDate, status: "rejected",
        note: b.reason ? `First SIP debit bounced: ${b.reason}` : "First SIP debit bounced.",
      };
    }
  }

  return waiting(line, s, null);
}

/** Nothing yet. Missing only once the wait is over AND the ledger reaches past it. */
function waiting(line: MatchLine, s: MatchSettings, note: string | null): LineOutcome {
  const wait = LONG_WAIT.has(line.txnType) ? s.sipNotFoundDays : s.notFoundDays;
  const due = addDays(line.businessDate, wait);
  const none = { lineId: line.id, rtaAmount: null, txnIds: [] as string[] };
  if (s.today > due && !!s.ledgerLast && s.ledgerLast >= due) {
    return { ...none, status: "not_found", statusAt: due, note: note ?? `No RTA record ${wait} days after the business date.` };
  }
  return { ...none, status: "pending", statusAt: null, note };
}
