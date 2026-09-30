/**
 * §3 claims requiring attention · §39 escalation levels · §40 management
 * escalation centre. Each card opens the worklist focused on its claims.
 */

import Link from "next/link";
import { AlertTriangle, Siren } from "lucide-react";
import type { AttentionCard, levels } from "@/lib/dashboard/claims/analysis";
import type { WorklistFocus } from "@/lib/dashboard/claims/params";
import { Section } from "@/components/dashboards/my/Shared";
import { formatCount, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Names } from "./parts";

function ownerLine(owners: Array<string | null>, n: Names): string | null {
  // Nothing to add when every claim lacks an owner — "Claims without an owner" already says so.
  if (!owners.length || owners.every((o) => o === null)) return null;
  const name = (id: string | null) => (id ? n.user[id] ?? "Former user" : "Owner missing");
  return owners.length === 1 ? name(owners[0]) : `${name(owners[0])} and ${owners.length - 1} other${owners.length === 2 ? "" : "s"}`;
}

export function CardGrid({ cards, names, focusHref }: { cards: AttentionCard[]; names: Names; focusHref: (k: WorklistFocus) => string }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {cards.map((c) => (
        <Link key={`${c.key}-${c.label}`} href={focusHref(c.key)} title={c.hint}
          className={cn("block rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent",
            c.tone === "bad" ? "border-destructive/40 bg-destructive/5" : c.tone === "warn" ? "border-warning/50 bg-warning/5" : "border-border bg-card")}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-foreground">{c.label}</span>
            <span className={cn("text-xl font-semibold tabular-nums", c.tone === "bad" ? "text-destructive" : c.tone === "warn" ? "text-warning-foreground" : "text-foreground")}>{formatCount(c.n)}</span>
          </div>
          <div className="mt-1 space-y-0.5 text-2xs text-muted-foreground">
            {c.amount != null && <div>{formatMoney(c.amount)} claimed</div>}
            {c.n > 0 && c.oldest != null && <div>Oldest {formatCount(c.oldest)} days open</div>}
            {c.n > 0 && ownerLine(c.owners, names) && <div>Owner: {ownerLine(c.owners, names)}</div>}
            {c.n === 0 && <div>None today.</div>}
            {c.hint && c.n > 0 && <div>{c.hint}</div>}
          </div>
        </Link>
      ))}
    </div>
  );
}

export function AttentionPanel({ cards, names, focusHref, lv, t }: {
  cards: AttentionCard[]; names: Names; focusHref: (k: WorklistFocus) => string; lv: ReturnType<typeof levels>;
  t: { sla: number; warn: number; escalate: number };
}) {
  const lvl = (n: number) => lv.find((x) => x.level === n)!;
  return (
    <Section title="Claims requiring attention" subtitle="What needs someone today." icon={<AlertTriangle className="size-4" />}
      note="Approved-but-unpaid claims are not shown: the CRM has no approval step. Insurer and TPA queries are one card — the claim does not record which it is.">
      <CardGrid cards={cards} names={names} focusHref={focusHref} />
      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3" aria-label="Escalation levels">
        {[
          { n: 1, label: "Attention", rule: `SLA falls due within ${t.warn} days, or the follow-up is due today`, key: "approaching" as const, tone: "warn" },
          { n: 2, label: "Overdue", rule: `Past the ${t.sla}-day SLA, or the follow-up date has passed`, key: "sla" as const, tone: "bad" },
          { n: 3, label: "Escalation", rule: `Past SLA by more than ${t.escalate} days, or high value and past SLA`, key: "escalated" as const, tone: "bad" },
        ].map((x) => (
          <Link key={x.n} href={focusHref(x.key)} className={cn("block rounded-lg border px-3 py-2.5 hover:bg-accent", x.tone === "bad" ? "border-destructive/40" : "border-warning/50")}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-foreground">Level {x.n} · {x.label}</span>
              <span className={cn("text-lg font-semibold tabular-nums", lvl(x.n).n ? (x.tone === "bad" ? "text-destructive" : "text-warning-foreground") : "text-foreground")}>{formatCount(lvl(x.n).n)}</span>
            </div>
            <div className="text-2xs text-muted-foreground">{formatMoney(lvl(x.n).amount)} · {x.rule}</div>
          </Link>
        ))}
      </div>
    </Section>
  );
}

export function EscalationCentre({ cards, names, focusHref }: { cards: AttentionCard[]; names: Names; focusHref: (k: WorklistFocus) => string }) {
  return (
    <Section title="Management escalation centre" subtitle="Claims a manager has to step into." icon={<Siren className="size-4" />}
      note="Thresholds are the firm's own, set at Settings → Dashboard thresholds. The CRM has no approval step, so approved-but-unsettled claims cannot be listed.">
      <CardGrid cards={cards} names={names} focusHref={focusHref} />
    </Section>
  );
}
