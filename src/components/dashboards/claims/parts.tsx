/**
 * Pieces every Claims Control Centre section shares. A plain module (no
 * "use client") so server sections render them; the claim link inside is
 * its own client module.
 *
 * `ClaimList` is the one claim table on the page. Sections differ only in
 * which columns they show, so each passes a column list rather than
 * hand-rolling a table — the worklist, ageing, documents, queries, cashless,
 * rejected, high-value and stale lists all print a claim the same way.
 */

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { GROUP_LABEL } from "@/lib/insurance/book";
import { CLAIM_STATUS_TONE, PENDING_WITH, claimModeLabel, claimStatusLabel, claimTypeLabel } from "@/lib/insurance/claims-book";
import type { ClaimRec } from "@/lib/dashboard/claims/set";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ClaimLink } from "./ClaimLink";

/**
 * Dates in India time, always (formatDate prints IST whatever the server's
 * zone). A claim's status times are instants: printed in a UTC server process
 * they would slip a day before 05:30, and server and browser could disagree
 * while hydrating.
 */
export const dayOf = (v: string | Date | null | undefined) => formatDate(v, "date");
export const timeOf = (v: string | Date | null | undefined) => formatDate(v, "dateTime");

/** Names by id — plain objects so they cross into client components. */
export type Names = { user: Record<string, string>; branch: Record<string, string> };

export const Muted = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span className="text-muted-foreground" title={title}>{children}</span>
);

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={CLAIM_STATUS_TONE[status] ?? "neutral"}>{claimStatusLabel(status)}</Badge>;
}

export function SlaText({ c }: { c: ClaimRec }) {
  if (!c.isOpen || !c.sla) return <Muted>—</Muted>;
  if (c.sla === "breached") return <span className="font-medium text-destructive" title={`SLA fell due ${dayOf(c.slaDue)}`}>Breached {c.breachDays} d</span>;
  if (c.sla === "approaching") return <span className="font-medium text-warning-foreground" title={`SLA due ${dayOf(c.slaDue)}`}>{c.slaLeft === 0 ? "Due today" : `Due in ${c.slaLeft} d`}</span>;
  return <span className="text-muted-foreground" title="Within SLA">{dayOf(c.slaDue)}</span>;
}

export const LEVEL_LABEL = { 3: "Escalation", 2: "Overdue", 1: "Attention" } as const;
export function LevelBadge({ level }: { level: 0 | 1 | 2 | 3 }) {
  if (!level) return null;
  return <Badge tone={level === 1 ? "warning" : "danger"}>{LEVEL_LABEL[level]}</Badge>;
}

export function AgeText({ c }: { c: ClaimRec }) {
  if (c.ageDays == null) return <Muted>—</Muted>;
  const tone = (c.ageDays ?? 0) > 90 ? "font-semibold text-destructive" : c.sla === "breached" ? "text-destructive" : c.sla === "approaching" ? "text-warning-foreground" : "";
  return <span className={cn("tabular-nums", tone)} title={c.openedOnKeyed ? "No intimation date — counted from the day the claim was keyed" : undefined}>{formatCount(c.ageDays)} d</span>;
}

export const amountOf = (c: ClaimRec): ReactNode => (c.claimedMissing ? <Muted title="No claimed amount on the claim">Not recorded</Muted> : formatMoney(c.claimed));
export const ownerOf = (c: ClaimRec, n: Names): ReactNode =>
  (c.ownerId ? n.user[c.ownerId] ?? "Former user" : <span className="text-warning-foreground">Owner missing</span>);
export const productOf = (c: ClaimRec) => (c.policyId ? GROUP_LABEL[c.group] ?? "Type not recognised" : "No policy linked");

export function NextActionText({ c, n }: { c: ClaimRec; n: Names }) {
  if (!c.isOpen) return <Muted>—</Muted>;
  if (!c.nextAction) return <span className="text-warning-foreground">No next action</span>;
  const who = c.nextAction.assigneeId ? n.user[c.nextAction.assigneeId] ?? "Former user" : "Unassigned";
  return (
    <span className="block">
      <span className="block max-w-56 truncate" title={c.nextAction.title}>{c.nextAction.title}</span>
      <span className={cn("text-2xs", c.actionState === "overdue" ? "text-destructive" : c.actionState === "today" ? "text-warning-foreground" : "text-muted-foreground")}>
        {c.nextAction.due ? `${c.actionState === "overdue" ? "Overdue · " : c.actionState === "today" ? "Today · " : ""}${dayOf(c.nextAction.due)}` : "No date"} · {who}
      </span>
    </span>
  );
}

export type Col =
  | "client" | "clientClaim" | "claim" | "insurer" | "amount" | "settled" | "diff" | "status" | "pendingWith" | "owner" | "rm" | "branch"
  | "age" | "inStatus" | "sla" | "next" | "updated" | "contact" | "missing" | "remarks" | "closed" | "submitted" | "policy" | "mode"
  | "query" | "since" | "opened";

const HEAD: Record<Col, { label: string; right?: boolean }> = {
  client: { label: "Client" }, clientClaim: { label: "Client · claim" }, claim: { label: "Claim" }, insurer: { label: "Insurer" }, amount: { label: "Claim amount", right: true },
  settled: { label: "Settled", right: true }, diff: { label: "Difference", right: true }, status: { label: "Status" },
  pendingWith: { label: "Pending with" }, owner: { label: "Owner" }, rm: { label: "RM" }, branch: { label: "Branch" },
  age: { label: "Ageing", right: true }, inStatus: { label: "In status", right: true }, sla: { label: "SLA" }, next: { label: "Next action" },
  updated: { label: "Last update" }, contact: { label: "Last client update" }, missing: { label: "Documents missing" },
  remarks: { label: "Remarks" }, closed: { label: "Closed on" }, submitted: { label: "Submitted" }, policy: { label: "Policy number" },
  mode: { label: "Mode" }, query: { label: "Query" }, since: { label: "Since" }, opened: { label: "Claim date" },
};

function cell(col: Col, c: ClaimRec, n: Names): ReactNode {
  switch (col) {
    case "client": return <ClaimLink id={c.id}>{c.client}</ClaimLink>;
    case "clientClaim": return (
      <span className="block">
        <ClaimLink id={c.id}>{c.client}</ClaimLink>
        <span className="block text-2xs font-normal text-muted-foreground">{productOf(c)} · {claimTypeLabel(c.type)}</span>
      </span>
    );
    case "claim": return <span>{productOf(c)} <Muted>· {claimTypeLabel(c.type)}</Muted></span>;
    case "insurer": return c.insurer ?? <Muted>Not recorded</Muted>;
    case "amount": return amountOf(c);
    case "settled": return c.settled > 0 ? formatMoney(c.settled) : <Muted title="No settled amount on the claim">Not recorded</Muted>;
    case "diff": return c.claimedMissing || c.settled <= 0 ? <Muted>—</Muted> : formatMoney(c.claimed - c.settled);
    case "status": return <StatusBadge status={c.status} />;
    case "pendingWith": {
      const p = PENDING_WITH.find((x) => x.key === c.pendingWith);
      return p ? <span title={`${p.hint} (from the status)`}>{p.label}</span> : <Muted>—</Muted>;
    }
    case "owner": return ownerOf(c, n);
    case "rm": return c.clientRmId ? n.user[c.clientRmId] ?? "Former user" : <Muted>{c.investorId ? "No RM" : "No client linked"}</Muted>;
    case "branch": return c.branchId ? n.branch[c.branchId] ?? "Branch" : <Muted>No branch</Muted>;
    case "age": return <AgeText c={c} />;
    case "inStatus": return <span className="tabular-nums" title={`In this status since ${dayOf(c.statusSince)}`}>{formatCount(c.daysInStatus)} d</span>;
    case "sla": return <SlaText c={c} />;
    case "next": return <NextActionText c={c} n={n} />;
    case "updated": return <span>{dayOf(c.updatedAt)} <Muted>· {c.daysSinceUpdate} d</Muted></span>;
    case "contact": return c.daysSinceContact == null
      ? <span className="text-warning-foreground">None since intimation</span>
      : <span>{dayOf(c.lastContact)} <Muted>· {c.daysSinceContact} d</Muted></span>;
    case "missing": return c.docsMissing.length === 0
      ? <Muted>All on file</Muted>
      : <span className="block max-w-64 truncate" title={c.docsMissing.join(", ")}>{c.docsMissing.length} missing: {c.docsMissing.slice(0, 2).join(", ")}{c.docsMissing.length > 2 ? "…" : ""}</span>;
    case "remarks": return c.comments ? <span className="block max-w-48 truncate" title={c.comments}>{c.comments}</span> : <Muted>No remarks</Muted>;
    case "closed": return c.closedOn
      ? <span title={c.closedOnSource === "edit" ? "The CRM has no closing date for this claim — this is its last edit" : undefined}>{dayOf(c.closedOn)}{c.closedOnSource === "edit" ? " *" : ""}</span>
      : <Muted>—</Muted>;
    case "submitted": return c.submissionDate ? dayOf(c.submissionDate) : <Muted>Not recorded</Muted>;
    case "policy": return c.policyNumber ?? <Muted>No policy number</Muted>;
    case "mode": return claimModeLabel(c.mode);
    case "query": return c.status === "query" ? "Insurer query to answer" : c.status === "add_info_awaited" ? "Information awaited from the client" : claimStatusLabel(c.status);
    case "since": return dayOf(c.statusSince);
    case "opened": return dayOf(c.openedOn);
  }
}

export function ClaimList({ rows, cols, names, empty, limit = 12, more }: {
  rows: ClaimRec[]; cols: Col[]; names: Names; empty: string; limit?: number;
  /** Shown under the table when rows were cut, e.g. a link to the focused worklist. */
  more?: ReactNode;
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  }
  const shown = rows.slice(0, limit);
  return (
    <div className="min-w-0">
      {/* overflow-x only: .table-scroll's height cap would hide the rows below it. */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>{cols.map((c) => <th key={c} scope="col" className={cn("whitespace-nowrap px-2", HEAD[c].right && "text-right")}>{HEAD[c].label}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                {cols.map((c) => (
                  <td key={c} className={cn("px-2 py-2.5 text-xs", HEAD[c].right && "whitespace-nowrap text-right tabular-nums", (c === "client" || c === "clientClaim") && "font-medium")}>{cell(c, r, names)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <p className="mt-2 text-center text-2xs text-muted-foreground">{formatCount(rows.length - limit)} more. {more}</p>
      )}
    </div>
  );
}

/** A count and an amount, never blended: "3 · ₹46,500". */
export const countAmount = (n: number, amount: number | null) => (amount == null ? formatCount(n) : `${formatCount(n)} · ${formatMoney(amount)}`);
