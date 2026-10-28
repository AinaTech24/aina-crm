/**
 * The values an email about ONE record of a client's carries — a rejected SIP, a
 * switch / STP / SWP — worked out from that record itself.
 *
 * Why not leave it to the template: a template's {{transaction.*}} fields fill
 * from the client's MOST RECENT transaction, which is not the record the RM is
 * looking at the moment a newer one has landed. Passed as the send's variables
 * these values win over that auto-fill, so the email says what the row says.
 * Pure; the route in /api/investors/[id]/record-email does the loading.
 */

export const SIP_REJECTION_TEMPLATE = "sip_rejection";
export const SWITCH_TEMPLATE = "switch_stp_swp";

/** Transaction types the switch email is for. */
export const SWITCH_TYPES = ["switch", "stp", "swp"] as const;
const TYPE_LABEL: Record<string, string> = { switch: "Switch", stp: "STP", swp: "SWP" };

const REASON_BY_CATEGORY: Record<string, string> = {
  insufficient_balance: "Insufficient balance in the bank account on the debit date",
  mandate_expired: "The bank mandate (NACH) for this SIP has expired",
  technical: "A technical issue at the bank or the fund house",
};

/**
 * A value the record does not have is sent as a dash, never as an empty string:
 * dispatch() treats a blank caller variable as "not supplied" and fills it from
 * the client's latest transaction — so a blank folio would print some OTHER
 * record's folio in this email.
 */
export const NOT_RECORDED = "—";
const filled = (v: unknown): string => (v == null || String(v).trim() === "" ? NOT_RECORDED : String(v).trim());

const inr = (v: unknown): string => {
  if (v == null || String(v).trim() === "") return NOT_RECORDED;
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : NOT_RECORDED;
};

/** "2026-10-27" → "27 Oct 2026". A value that is not a date comes back as it was. */
export function emailDate(d: unknown): string {
  if (!d) return NOT_RECORDED;
  const s = String(d).slice(0, 10);
  const dd = new Date(`${s}T00:00:00`);
  return Number.isNaN(dd.getTime()) ? String(d) : dd.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export type SipRejectionRecord = {
  rejectionDate: string | null;
  rejectionAmount: string | number | null;
  rejectionReason: string | null;
  reasonCategory: string | null;
  schemeName: string | null;
  folioNumber: string | null;
  amcName: string | null;
};

export function sipRejectionEmail(r: SipRejectionRecord): { templateKey: string; variables: Record<string, string> } {
  const reason = (r.rejectionReason ?? "").trim() || REASON_BY_CATEGORY[r.reasonCategory ?? ""] || "The bank did not honour the debit";
  return {
    templateKey: SIP_REJECTION_TEMPLATE,
    variables: {
      "transaction.scheme_name": filled(r.schemeName),
      "transaction.amount": inr(r.rejectionAmount),
      "transaction.folio_number": filled(r.folioNumber),
      "transaction.rejection_reason": reason,
      "transaction.reason": reason,
      "transaction.amc_name": filled(r.amcName),
      "transaction.transaction_date": emailDate(r.rejectionDate),
    },
  };
}

/** Statuses for which a switch has happened — the only ones a confirmation may be sent for. */
export const DONE_STATUSES = ["processed", "successful"] as const;

/** A SIP rejection still being worked — the only ones the client should be told about. */
export const OPEN_SIP_STATUSES = ["pending", "client_contacted", "bank_issue", "mandate_issue"] as const;

export type SwitchRecord = {
  type: string;
  status?: string | null;
  amount: string | number | null;
  schemeName: string | null;
  folioNumber: string | null;
  amcName: string | null;
  orderDate: string | null;
};

/**
 * Null when the transaction is not a switch, STP or SWP. The email says "your
 * transaction is confirmed", so a pending, rejected or cancelled one is refused
 * (a record with no status at all is treated as not done).
 */
export function switchEmail(t: SwitchRecord): { templateKey: string; variables: Record<string, string> } | null {
  if (!(SWITCH_TYPES as readonly string[]).includes(t.type)) return null;
  if (!(DONE_STATUSES as readonly string[]).includes(String(t.status ?? ""))) return null;
  return {
    templateKey: SWITCH_TEMPLATE,
    variables: {
      "transaction.scheme_name": filled(t.schemeName),
      "transaction.type": TYPE_LABEL[t.type] ?? t.type,
      "transaction.amount": inr(t.amount),
      "transaction.folio_number": filled(t.folioNumber),
      "transaction.amc_name": filled(t.amcName),
      "transaction.transaction_date": emailDate(t.orderDate),
    },
  };
}
