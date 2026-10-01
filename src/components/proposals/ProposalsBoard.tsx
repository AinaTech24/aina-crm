/**
 * Proposals as a pipeline: Draft → Sent → Viewed → Accepted → Executed.
 *
 * A card turns red when the client has had it longer than the Proposal Sent
 * stage's follow-up window without deciding — the list a manager actually
 * needs. Columns total in rupees as well as counts, so "how much of what we
 * propose gets invested" is visible at a glance. Rupee values are first-year
 * values (a year of SIPs plus one-time money: lib/proposals/items
 * proposalValue), the same figure the timeline and reports use.
 *
 * Server component; no client state.
 */

import Link from "next/link";
import { proposalValue, itemKindLabel } from "@/lib/proposals/items";

export type BoardRow = {
  id: string;
  proposal_number: string;
  version: number | null;
  recipient_name: string;
  status: string;
  products: any[] | null;
  sent_at: string | Date | null;
  viewed_at: string | Date | null;
  accepted_items: number[] | null;
  executed_amount: string | number | null;
  prepared_by: string | null;
};

/** The Proposal Sent stage's follow-up window (blueprint SLA). */
const DECISION_SLA_DAYS = 3;

const COLUMNS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "draft", label: "Draft", statuses: ["draft", "ready"] },
  { key: "sent", label: "Sent", statuses: ["sent", "changes_requested"] },
  { key: "viewed", label: "Viewed", statuses: ["viewed"] },
  { key: "accepted", label: "Accepted", statuses: ["accepted", "partially_approved"] },
  { key: "executed", label: "Executed", statuses: ["executed"] },
];

const lakhs = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Value of what the client took (accepted lines), else of the whole proposal. */
function valueOf(r: BoardRow): number {
  const items = Array.isArray(r.products) ? r.products : [];
  const taken = Array.isArray(r.accepted_items) ? items.filter((_, i) => r.accepted_items!.includes(i)) : items;
  return proposalValue(taken);
}

function ageDays(d: string | Date | null): number | null {
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5));
}

export function boardTotals(rows: BoardRow[]): { count: number; proposed: number; executed: number } {
  let proposed = 0, executed = 0, count = 0;
  for (const r of rows) {
    if (r.status === "draft" || r.status === "ready") continue;
    count++;
    proposed += valueOf(r);
    executed += Number(r.executed_amount ?? 0);
  }
  return { count, proposed, executed };
}

export function ProposalsBoard({ rows }: { rows: BoardRow[] }) {
  return (
    <div className="overflow-x-auto pb-1">
      <div className="grid grid-cols-5 gap-3 min-w-max xl:min-w-0">
        {COLUMNS.map((c) => {
          const items = rows.filter((r) => c.statuses.includes(r.status));
          const total = items.reduce((s, r) => s + (c.key === "executed" ? Number(r.executed_amount ?? 0) : valueOf(r)), 0);
          return (
            <section key={c.key} className="rounded-xl bg-secondary/60 p-2.5 space-y-2 w-56 xl:w-auto" aria-label={`${c.label} proposals`}>
              <header className="flex items-baseline justify-between px-1">
                <h3 className="text-xs font-semibold">{c.label}</h3>
                <span className="text-2xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {items.length}
                  {total > 0 ? ` · ${lakhs(total)}` : ""}
                </span>
              </header>
              {items.length === 0 && <p className="text-2xs text-muted-foreground px-1 py-3">None.</p>}
              {items.map((r) => (
                <Card key={r.id} r={r} column={c.key} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Card({ r, column }: { r: BoardRow; column: string }) {
  const items = Array.isArray(r.products) ? r.products : [];
  const kinds = [...new Set(items.map((i) => itemKindLabel(i)))].slice(0, 2).join(" + ") || "—";
  const value = valueOf(r);
  const waiting = column === "sent" || column === "viewed";
  const age = waiting ? ageDays(r.sent_at) : null;
  const late = waiting && r.status !== "changes_requested" && age != null && age > DECISION_SLA_DAYS;

  let right: React.ReactNode = null;
  if (r.status === "changes_requested") right = <span className="text-warning font-medium">changes asked</span>;
  else if (waiting && age != null)
    right = <span className={late ? "text-destructive font-medium" : undefined}>{late && column === "sent" ? `${age} d, not opened` : `${age} d`}</span>;
  else if (r.status === "partially_approved") right = <span>{(r.accepted_items ?? []).length} of {items.length}</span>;
  else if (column === "executed") {
    const proposed = value;
    const invested = Number(r.executed_amount ?? 0);
    right = proposed > 0 ? <span>{Math.round((invested / proposed) * 100)}%</span> : null;
  }

  return (
    <Link
      href={`/dashboard/proposals/${r.id}`}
      className={`block rounded-lg border bg-card p-2.5 text-xs hover:shadow-sm transition-shadow ${late ? "border-l-4 border-l-destructive" : "border-border"}`}
    >
      <div className="font-semibold text-sm truncate">{r.recipient_name}</div>
      <div className="flex items-center justify-between gap-2 text-muted-foreground mt-0.5 tabular-nums">
        <span className="truncate">
          {column === "executed"
            ? `${lakhs(Number(r.executed_amount ?? 0))} of ${lakhs(value)}`
            : `${kinds}${value > 0 ? ` · ${lakhs(value)}` : ""}`}
        </span>
        <span className="shrink-0">{right}</span>
      </div>
      <div className="text-2xs text-muted-foreground mt-1 truncate">
        {r.proposal_number}
        {(r.version ?? 1) > 1 ? ` · v${r.version}` : ""}
        {r.prepared_by ? ` · ${r.prepared_by}` : ""}
      </div>
    </Link>
  );
}
