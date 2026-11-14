/*
 * PORTED from the web CRM: src/components/proposals/ProposalTimeline.tsx
 * (`proposalSteps`, the pure part). Same steps and wording; dates use the
 * app's fmtDate, and a proposal cancelled from the list (rejected with the
 * reason "deleted") reads "Cancelled" rather than "Declined · deleted".
 */

import { fmtDate } from "../../../lib/format";
import { proposalValue } from "./items";

type Row = {
  status: string;
  preparedAt?: string | null;
  createdAt?: string | null;
  sentAt?: string | null;
  viewedAt?: string | null;
  lastViewedAt?: string | null;
  viewCount?: number | null;
  acceptedAt?: string | null;
  acceptedItems?: number[] | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  changeRequestNote?: string | null;
  changeRequestedAt?: string | null;
  executedAt?: string | null;
  executedAmount?: string | number | null;
  validUntil?: string | null;
  version?: number | null;
  recipientName?: string | null;
  products?: unknown;
};

export type Step = { state: "done" | "now" | "todo" | "warn" | "bad"; title: string; detail?: string; when?: string };

/** The stage the proposal sits at for an SLA of this many days. */
const DECISION_SLA_DAYS = 3;

export function proposalSteps(p: Row): Step[] {
  const first = String(p.recipientName ?? "").split(" ")[0] || "The client";
  const items = Array.isArray(p.products) ? (p.products as any[]) : [];
  const steps: Step[] = [];

  steps.push({
    state: "done",
    title: `Drafted${(p.version ?? 1) > 1 ? ` (version ${p.version})` : ""}`,
    detail: items.length ? `${items.length} recommendation${items.length === 1 ? "" : "s"}` : undefined,
    when: fmtDate(p.preparedAt ?? p.createdAt ?? null),
  });

  if (!p.sentAt) {
    if (p.status === "rejected") {
      steps.push(p.rejectionReason === "deleted"
        ? { state: "bad", title: "Cancelled", when: fmtDate(p.rejectedAt ?? null) }
        : { state: "bad", title: "Declined", detail: p.rejectionReason ?? undefined, when: fmtDate(p.rejectedAt ?? null) });
      return steps;
    }
    steps.push({ state: p.status === "draft" || p.status === "ready" ? "now" : "todo", title: "Not sent yet" });
    return steps;
  }
  steps.push({
    state: "done",
    title: "Sent",
    detail: p.validUntil ? `valid until ${fmtDate(p.validUntil)}` : undefined,
    when: fmtDate(p.sentAt),
  });

  if (p.viewedAt) {
    const n = p.viewCount ?? 1;
    steps.push({
      state: "done",
      title: `Opened by ${first}`,
      detail: n > 1 ? `${n} visits · last ${fmtDate(p.lastViewedAt ?? p.viewedAt)}` : undefined,
      when: fmtDate(p.viewedAt),
    });
  } else if (p.status === "sent") {
    steps.push({ state: "todo", title: "Not opened yet" });
  }

  const taken = Array.isArray(p.acceptedItems) ? p.acceptedItems.length : null;
  switch (p.status) {
    case "accepted":
    case "executed":
      steps.push({ state: "done", title: items.length > 1 ? `Accepted all ${items.length}` : "Accepted", when: fmtDate(p.acceptedAt ?? null) });
      break;
    case "partially_approved":
      steps.push({
        state: "done",
        title: `Accepted ${taken ?? "some"} of ${items.length}`,
        detail: "the rest stays open for a later conversation",
        when: fmtDate(p.acceptedAt ?? null),
      });
      break;
    case "changes_requested":
      steps.push({ state: "warn", title: `${first} asked for changes`, detail: p.changeRequestNote ? `“${p.changeRequestNote}”` : undefined, when: fmtDate(p.changeRequestedAt ?? null) });
      break;
    case "rejected":
      steps.push(p.rejectionReason === "deleted"
        ? { state: "bad", title: "Cancelled", when: fmtDate(p.rejectedAt ?? null) }
        : { state: "bad", title: "Declined", detail: p.rejectionReason ?? undefined, when: fmtDate(p.rejectedAt ?? null) });
      break;
    case "superseded":
      steps.push({ state: "todo", title: `Replaced by version ${(p.version ?? 1) + 1}` });
      break;
    case "expired":
      steps.push({ state: "bad", title: "Expired without a decision" });
      break;
    default: {
      const days = Math.max(0, Math.floor((Date.now() - new Date(p.sentAt as any).getTime()) / 864e5));
      steps.push({
        state: days > DECISION_SLA_DAYS ? "warn" : "now",
        title: `Waiting for ${first}'s decision`,
        detail: days > DECISION_SLA_DAYS ? `${days} days — past the ${DECISION_SLA_DAYS}-day follow-up` : `day ${days + 1} of ${DECISION_SLA_DAYS}`,
      });
    }
  }

  if (["accepted", "partially_approved", "executed"].includes(p.status)) {
    if (p.executedAt) {
      const invested = Number(p.executedAmount ?? 0);
      const proposed = proposalValue(
        Array.isArray(p.acceptedItems) ? items.filter((_, i) => p.acceptedItems!.includes(i)) : items
      );
      steps.push({
        state: "done",
        title: "Executed",
        detail: proposed > 0 ? `₹${Math.round(invested).toLocaleString("en-IN")} invested of ₹${Math.round(proposed).toLocaleString("en-IN")} proposed (first year)` : undefined,
        when: fmtDate(p.executedAt),
      });
    } else {
      steps.push({ state: "todo", title: "Not executed yet", detail: "matched automatically from the RTA feed" });
    }
  }
  return steps;
}
