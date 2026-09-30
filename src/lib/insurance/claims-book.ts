/**
 * The claims vocabulary — what the Insurance Claims Control Centre means by
 * open, pending with, documents awaited, a query, a stage and an outcome.
 * Defined once here, next to the insurance book (./book.ts), so every section
 * counts a claim the same way.
 *
 * What the CRM RECORDS on a claim (insurance_claims): a status from its own
 * twelve-value picklist, a claim type, a claim mode, four dates (admission,
 * intimation, submission, settlement), the claimed and settled amounts, the
 * claim's RM (its owner), free-text comments and a document list. Status
 * history exists only in audit_log (every save writes the before and after
 * status).
 *
 * What it does NOT record, and so is never shown as a figure: an approval
 * step or approved amount, a claim number, the TPA, the hospital, a
 * rejection reason, a legal / consumer-court stage, a priority, and who a
 * claim is pending with. "Pending with" below is DERIVED from the status and
 * labelled as such everywhere it appears.
 */

import { sql, type SQL } from "drizzle-orm";
import type { BadgeTone } from "@/components/ui/Badge";
import { CLAIM_OPEN, CLAIM_SETTLED, CLAIM_STATUS_LABEL, CLAIM_TYPE_LABEL, inList } from "./book";

export { CLAIM_OPEN, CLAIM_SETTLED, CLAIM_STATUS_LABEL, CLAIM_TYPE_LABEL };

export const CLAIM_CLOSED = ["settled_fully", "settled_partially", "rejected", "withdrawn"] as const;
/** A decision on the claim — the base of the settlement ratio. Withdrawn is the client's choice, not a decision. */
export const CLAIM_DECIDED = ["settled_fully", "settled_partially", "rejected"] as const;
/** The claim file / documents are awaited from the client (the claims summary's "file not received"). */
export const CLAIM_FILE_AWAITED = ["file_awaited"] as const;
/** The insurer has asked for something and the answer is not yet back with them. */
export const CLAIM_QUERY_OPEN = ["query", "add_info_awaited"] as const;

export const CLAIM_MODE_LABEL: Record<string, string> = {
  cashless: "Cashless", reimbursement: "Reimbursement", grievance: "Grievance",
};

/** Status colours (the brief's §59): green done, blue in process, amber needs a follow-up, red rejected, grey waiting / n.a. */
export const CLAIM_STATUS_TONE: Record<string, BadgeTone> = {
  empty: "neutral", claim_intimated: "warning", file_awaited: "warning", file_received: "info", add_info_awaited: "warning",
  query: "warning", query_replied: "info", under_process: "info", settled_fully: "success", settled_partially: "success",
  rejected: "danger", withdrawn: "neutral",
};

/**
 * Pending with — DERIVED from the status. The CRM has no pending-with field,
 * and it cannot tell the insurer from a TPA, a hospital or a surveyor.
 */
export const PENDING_WITH = [
  { key: "client", label: "Client", statuses: ["file_awaited", "add_info_awaited"], hint: "The claim file or additional information is awaited from the client" },
  { key: "team", label: "Claims team", statuses: ["claim_intimated", "file_received", "query"], hint: "To register the claim and ask for documents, submit the file, or answer an insurer query" },
  { key: "insurer", label: "Insurer / TPA", statuses: ["query_replied", "under_process"], hint: "Submitted, or a query answered — the insurer or TPA is processing it" },
  { key: "unset", label: "Status not set", statuses: ["empty"], hint: "No status recorded on the claim" },
] as const;
export type PendingWith = (typeof PENDING_WITH)[number]["key"];
export const PENDING_WITH_LABEL: Record<string, string> = Object.fromEntries(PENDING_WITH.map((p) => [p.key, p.label]));

export function pendingWithSql(statusCol: SQL): SQL {
  return sql`CASE ${sql.join(PENDING_WITH.map((p) => sql`WHEN ${statusCol} IN (${inList(p.statuses)}) THEN ${p.key}`), sql` `)} ELSE NULL END`;
}

/** Claim value bands (the brief's; not configurable — they describe, they do not judge). */
export const CLAIM_VALUE_BANDS = [
  { key: "v1", label: "Below ₹25,000", lo: 0, hi: 25_000 },
  { key: "v2", label: "₹25,000 – ₹50,000", lo: 25_000, hi: 50_000 },
  { key: "v3", label: "₹50,000 – ₹1 Lakh", lo: 50_000, hi: 100_000 },
  { key: "v4", label: "₹1 – ₹5 Lakh", lo: 100_000, hi: 500_000 },
  { key: "v5", label: "₹5 Lakh and above", lo: 500_000, hi: null },
] as const;

/** Ageing buckets on days open (intimation, else the day it was keyed). 90+ is the one that must be seen. */
export const CLAIM_AGE_BUCKETS = [
  { key: "a1", label: "0–7 days", lo: 0, hi: 7 },
  { key: "a2", label: "8–15 days", lo: 8, hi: 15 },
  { key: "a3", label: "16–30 days", lo: 16, hi: 30 },
  { key: "a4", label: "31–60 days", lo: 31, hi: 60 },
  { key: "a5", label: "61–90 days", lo: 61, hi: 90 },
  { key: "a6", label: "90+ days", lo: 91, hi: null },
] as const;
export const ageBucketOf = (days: number | null): string | null =>
  (days == null ? null : CLAIM_AGE_BUCKETS.find((b) => days >= b.lo && (b.hi == null || days <= b.hi))?.key ?? null);

/**
 * The lifecycle in the CRM's own statuses, for the funnel (§5). "Reached"
 * reads the audit trail and the dates the claim carries, because statuses
 * are overwritten: a settled claim was once submitted. There is no approval
 * stage — the picklist goes from under process to settled.
 */
export const CLAIM_FUNNEL = [
  { key: "logged", label: "Intimated and registered", hint: "Every claim keyed in the CRM" },
  { key: "docs", label: "File received", hint: "Reached file received, or anything after it" },
  { key: "submitted", label: "Submitted to insurer", hint: "Has a submission date, or went to query / under process / settled" },
  { key: "assessment", label: "Query or assessment", hint: "Reached query, additional information, query replied or under process" },
  { key: "settled", label: "Settled", hint: "Settled fully or partially" },
] as const;

/** Statuses a claim must have passed through to count as having reached a funnel stage. */
export const REACHED_STATUSES: Record<string, readonly string[]> = {
  docs: ["file_received", "add_info_awaited", "query", "query_replied", "under_process", "settled_fully", "settled_partially"],
  submitted: ["add_info_awaited", "query", "query_replied", "under_process", "settled_fully", "settled_partially"],
  assessment: ["add_info_awaited", "query", "query_replied", "under_process", "settled_fully", "settled_partially"],
  settled: ["settled_fully", "settled_partially"],
};

export const claimStatusLabel = (s: string | null | undefined) => (s ? CLAIM_STATUS_LABEL[s] ?? s : "Status not set");
export const claimTypeLabel = (t: string | null | undefined) => (t ? CLAIM_TYPE_LABEL[t] ?? t : "Type not recorded");
export const claimModeLabel = (m: string | null | undefined) => (m ? CLAIM_MODE_LABEL[m] ?? m : "Mode not recorded");
