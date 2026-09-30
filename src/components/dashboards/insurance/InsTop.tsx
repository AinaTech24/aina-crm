/**
 * §46 today's priorities · §45 needs Insurance Head attention · §50 quick
 * actions + §51 search.
 */

import Link from "next/link";
import {
  AlarmClock, ClipboardPlus, FilePlus2, FileWarning, ListTodo, Plus, ShieldPlus, Siren, UserPlus, CalendarPlus, RefreshCcw,
} from "lucide-react";
import type { AttentionCard } from "@/lib/dashboard/insurance/attention";
import { formatCount, formatMoney } from "@/lib/format";
import { buttonClass } from "@/components/ui/button-class";
import { cn } from "@/lib/utils";
import { MoreMenu } from "@/components/common/MoreMenu";

export type Priority = { key: string; label: string; count: number; amount: number | null; href: string; tone: "bad" | "warn" };

export function PrioritiesPanel({ items, dateLabel }: { items: Priority[]; dateLabel: string }) {
  const live = items.filter((i) => i.count > 0);
  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Today's priorities">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
        <h2 className="section-title flex items-center gap-2"><AlarmClock className="size-4 text-muted-foreground" /> Today&apos;s priorities</h2>
        <span className="text-2xs text-muted-foreground">{dateLabel}</span>
      </div>
      {live.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing needs the Insurance Head this morning: no renewal due today or overdue, no delayed issuance, no claim past SLA.</p>
      ) : (
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {live.map((p, i) => (
            <li key={p.key}>
              <Link href={p.href} className={cn("flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent",
                p.tone === "bad" ? "border-destructive/40" : "border-warning/50")}>
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  p.tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning-foreground")}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-foreground">{p.label}</span>
                  <span className="block text-2xs text-muted-foreground">
                    {formatCount(p.count)}{p.amount != null && p.amount > 0 ? ` · ${formatMoney(p.amount)}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AttentionPanel({ cards }: { cards: AttentionCard[] }) {
  const live = cards.filter((c) => c.count > 0);
  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Needs attention">
      <div className="mb-4 border-b border-border/60 pb-3">
        <h2 className="section-title flex items-center gap-2"><Siren className="size-4 text-muted-foreground" /> Needs attention</h2>
        {live.length === 0 && <p className="section-subtitle mt-1">Nothing is waiting on management.</p>}
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.key} href={c.href} title={c.definition}
            className={cn("block rounded-lg border p-3 transition-colors hover:bg-accent",
              c.count === 0 ? "border-border bg-card" : c.tone === "bad" ? "border-destructive/40 bg-destructive/5" : "border-warning/50 bg-warning/5")}>
            <div className="text-xs font-medium text-foreground">{c.label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={cn("text-xl font-semibold tabular-nums", c.count === 0 ? "text-muted-foreground" : c.tone === "bad" ? "text-destructive" : "text-warning-foreground")}>
                {formatCount(c.count)}
              </span>
              {c.amount != null && c.count > 0 && <span className="text-xs tabular-nums text-muted-foreground">{formatMoney(c.amount)}</span>}
            </div>
            {c.count > 0 && (c.oldestDays != null || c.owner) && (
              <div className="mt-1 text-2xs text-muted-foreground">
                {[c.oldestDays != null ? `Oldest ${c.oldestDays} d` : null, c.owner ? `Most with ${c.owner}` : null].filter(Boolean).join(" · ")}
              </div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function InsQuickActions({ can, hrefs }: {
  can: { lead: boolean; meeting: boolean; proposal: boolean; policy: boolean; task: boolean; claims: boolean };
  hrefs: Record<string, string>;
}) {
  const actions = [
    can.lead && { label: "Add insurance lead", href: "/dashboard/leads/new", icon: UserPlus, primary: false },
    can.meeting && { label: "Add meeting", href: "/dashboard/review-meetings/new", icon: CalendarPlus },
    can.proposal && { label: "Create proposal", href: "/dashboard/proposals/new", icon: FilePlus2 },
    can.policy && { label: "Add policy", href: "/dashboard/insurance/new", icon: ShieldPlus, primary: true },
    can.policy && { label: "Record renewal", href: "/dashboard/insurance/renewals", icon: RefreshCcw },
    can.task && { label: "Add follow-up", href: "/dashboard/tasks/new", icon: ClipboardPlus },
    { label: "Renewals due", href: hrefs.renewalsDue, icon: AlarmClock },
    { label: "Lost business", href: hrefs.lost, icon: FileWarning },
    { label: "Pending policies", href: hrefs.pending, icon: ListTodo },
    can.claims && { label: "Claims", href: "/dashboard/insurance-claims", icon: Siren },
  ].filter(Boolean) as Array<{ label: string; href: string; icon: typeof Plus; primary?: boolean }>;
  // Two buttons and "More". Ten same-weight buttons beside a search box was the
  // busiest block on the page. Policies and clients are found from the top-bar
  // search (Ctrl K); claims and proposals from their own lists, both in "More".
  const ON_BAR = new Set(["Add policy", "Record renewal"]);
  const bar = actions.filter((a) => ON_BAR.has(a.label));
  const more = actions.filter((a) => !ON_BAR.has(a.label));
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick actions">
      {bar.map((a) => (
        <Link key={a.label} href={a.href} className={buttonClass(a.primary ? "primary" : "secondary", "md")}>
          <a.icon className="size-4" aria-hidden /> {a.label}
        </Link>
      ))}
      <MoreMenu text="More" label="More actions" items={more.map((a) => ({ href: a.href, label: a.label }))} />
    </div>
  );
}
