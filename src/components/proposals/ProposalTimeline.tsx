/**
 * A proposal's life as a timeline: drafted → sent → opened → decided →
 * executed. Shown on the proposal page and on the client's / lead's journey
 * page, so the RM sees what the client did without opening the Proposals
 * module.
 *
 * Server component, no state: everything comes from the proposal row.
 */

import { formatDate } from "@/lib/format";
import { proposalValue } from "@/lib/proposals/items";

type Row = {
  status: string;
  preparedAt?: Date | string | null;
  createdAt?: Date | string | null;
  sentAt?: Date | string | null;
  viewedAt?: Date | string | null;
  lastViewedAt?: Date | string | null;
  viewCount?: number | null;
  acceptedAt?: Date | string | null;
  acceptedItems?: number[] | null;
  rejectedAt?: Date | string | null;
  rejectionReason?: string | null;
  changeRequestNote?: string | null;
  changeRequestedAt?: Date | string | null;
  executedAt?: Date | string | null;
  executedAmount?: string | number | null;
  validUntil?: Date | string | null;
  version?: number | null;
  recipientName?: string | null;
  products?: unknown;
};

type Step = { state: "done" | "now" | "todo" | "warn" | "bad"; title: string; detail?: string; when?: string };

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
    when: formatDate(p.preparedAt ?? p.createdAt ?? null),
  });

  if (!p.sentAt) {
    steps.push({ state: p.status === "draft" || p.status === "ready" ? "now" : "todo", title: "Not sent yet" });
    return steps;
  }
  steps.push({
    state: "done",
    title: "Sent",
    detail: p.validUntil ? `valid until ${formatDate(p.validUntil)}` : undefined,
    when: formatDate(p.sentAt),
  });

  if (p.viewedAt) {
    const n = p.viewCount ?? 1;
    steps.push({
      state: "done",
      title: `Opened by ${first}`,
      detail: n > 1 ? `${n} visits · last ${formatDate(p.lastViewedAt ?? p.viewedAt)}` : undefined,
      when: formatDate(p.viewedAt),
    });
  } else if (p.status === "sent") {
    steps.push({ state: "todo", title: "Not opened yet" });
  }

  const taken = Array.isArray(p.acceptedItems) ? p.acceptedItems.length : null;
  switch (p.status) {
    case "accepted":
    case "executed":
      steps.push({ state: "done", title: items.length > 1 ? `Accepted all ${items.length}` : "Accepted", when: formatDate(p.acceptedAt ?? null) });
      break;
    case "partially_approved":
      steps.push({
        state: "done",
        title: `Accepted ${taken ?? "some"} of ${items.length}`,
        detail: "the rest stays open for a later conversation",
        when: formatDate(p.acceptedAt ?? null),
      });
      break;
    case "changes_requested":
      steps.push({ state: "warn", title: `${first} asked for changes`, detail: p.changeRequestNote ? `“${p.changeRequestNote}”` : undefined, when: formatDate(p.changeRequestedAt ?? null) });
      break;
    case "rejected":
      steps.push({ state: "bad", title: "Declined", detail: p.rejectionReason ?? undefined, when: formatDate(p.rejectedAt ?? null) });
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
        when: formatDate(p.executedAt),
      });
    } else {
      steps.push({ state: "todo", title: "Not executed yet", detail: "matched automatically from the RTA feed" });
    }
  }
  return steps;
}

const DOT: Record<Step["state"], string> = {
  done: "bg-success border-success",
  now: "bg-background border-primary ring-4 ring-primary/15",
  todo: "bg-background border-border",
  warn: "bg-warning border-warning",
  bad: "bg-destructive border-destructive",
};

export function ProposalTimeline({ proposal }: { proposal: Row }) {
  const steps = proposalSteps(proposal);
  // Named classes only — arbitrary Tailwind values fail silently in this repo.
  return (
    <ol className="relative">
      {steps.map((s, i) => (
        <li key={i} className="relative flex items-start gap-3 pb-3 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden className="absolute left-2 -translate-x-1/2 top-5 bottom-0 w-0.5 bg-border" />}
          <span aria-hidden className={`relative z-10 mt-0.5 size-4 shrink-0 rounded-full border-2 ${DOT[s.state]}`} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{s.title}</div>
            {s.detail && <div className="text-2xs text-muted-foreground break-words">{s.detail}</div>}
          </div>
          {s.when && s.when !== "—" && <div className="text-2xs text-muted-foreground whitespace-nowrap shrink-0">{s.when}</div>}
        </li>
      ))}
    </ol>
  );
}
