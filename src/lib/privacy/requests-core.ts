/**
 * The rules of a DPDP rights request, with no database — so they can be tested
 * on their own. The register itself is lib/privacy/requests.ts.
 *
 * Deadline: the DPDP Rules, 2025 let a firm publish its own response period,
 * up to 90 days. The notice (lib/privacy/notice.ts) promises 90, so `due_at`
 * is received + 90 days, and the assignee's task falls due 15 days earlier so
 * the escalation ladder fires while there is still time.
 *
 * Erasure is not deletion on demand. The Prevention of Money Laundering
 * (Maintenance of Records) Rules make a firm keep a client's identity and
 * transaction records for five years after the relationship ends, and DPDP
 * s.8(7) yields to a law that requires retention. So `retentionVerdict`
 * decides what an erasure request can do today.
 */

export const REQUEST_TYPES = {
  access: "Access — a summary of their data",
  correction: "Correction or update",
  erasure: "Erasure",
  withdraw_consent: "Withdraw consent",
  nomination: "Nominate someone",
  grievance: "Grievance",
} as const;
export type RequestType = keyof typeof REQUEST_TYPES;

export const REQUEST_CHANNELS = {
  email: "Email",
  phone: "Phone call",
  in_person: "In person",
  letter: "Letter",
  website: "Website / form",
  whatsapp: "WhatsApp",
} as const;
export type RequestChannel = keyof typeof REQUEST_CHANNELS;

export const RESPONSE_DAYS = 90;
export const TASK_LEAD_DAYS = 15;
/** PMLA: records kept for five years after the relationship ends. */
export const RETENTION_YEARS = 5;

const DAY = 24 * 60 * 60 * 1000;

export function dueAtFor(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + RESPONSE_DAYS * DAY);
}

export function taskDueFor(dueAt: Date, now: Date = new Date()): Date {
  const t = new Date(dueAt.getTime() - TASK_LEAD_DAYS * DAY);
  return t < now ? now : t;
}

/** "PR-2026-0007" — the firm's next number in the year. */
export function requestReference(year: number, seq: number): string {
  return `PR-${year}-${String(seq).padStart(4, "0")}`;
}

/** Whole days until the deadline (negative = overdue), India time. */
export function daysLeft(dueAt: Date, now: Date = new Date()): number {
  const ist = (d: Date) => Math.floor((d.getTime() + 5.5 * 3600 * 1000) / DAY);
  return ist(dueAt) - ist(now);
}

export type ClientFacts = {
  /** A folio with a value or an active SIP (lib/investors/holds-money.ts). */
  holdsMoney: boolean;
  /** Any folio or transaction ever recorded for them. */
  hasFinancialRecords: boolean;
  status: string | null;
  exitedAt: Date | null;
};

export type RetentionVerdict =
  | { kind: "erase" }
  | { kind: "blocked"; reason: string }
  | { kind: "retain"; until: Date; reason: string };

/**
 * What an erasure request can do for a CLIENT today. A lead never has
 * regulated records, so a lead is always erasable.
 */
export function retentionVerdict(c: ClientFacts, now: Date = new Date()): RetentionVerdict {
  if (c.holdsMoney) {
    return {
      kind: "blocked",
      reason: "They still hold money with the registrar (a folio with a value or an active SIP). The investments must be redeemed or moved before their data can be erased.",
    };
  }
  if (!c.hasFinancialRecords) return { kind: "erase" };
  const ended = c.status === "closed" || c.status === "exited";
  if (!ended || !c.exitedAt) {
    return {
      kind: "blocked",
      reason: "They are still a client. Mark them as exited first; their records are then kept for five years after the relationship ends, as the Prevention of Money Laundering Act requires.",
    };
  }
  const until = new Date(c.exitedAt);
  until.setFullYear(until.getFullYear() + RETENTION_YEARS);
  if (until > now) {
    return {
      kind: "retain",
      until,
      reason: `Their KYC and transaction records must be kept until ${until.toISOString().slice(0, 10)} — five years after the relationship ended (Prevention of Money Laundering Act). Marketing to them is stopped now; erase the rest after that date.`,
    };
  }
  return { kind: "erase" };
}

/**
 * Every personal field on a lead, blanked for an erasure. The row stays, so
 * pipeline counts and the source report do not change, but nothing on it
 * identifies the person. tests/privacy-requests.test.ts checks this covers
 * every text column the leads table has that can hold personal data.
 */
export const LEAD_ERASE_PATCH: Record<string, string | null | object> = {
  name: "Erased lead",
  email: null,
  emailNormalized: null,
  phone: null,
  phoneNormalized: null,
  pan: null,
  city: null,
  pincode: null,
  avatarUrl: null,
  utmParams: null,
  profile: {},
  customFields: null,
  altPhone: null,
  altEmail: null,
  referredByName: null,
  followUpNotes: null,
  notes: null,
  tags: [],
  kycData: null,
};
