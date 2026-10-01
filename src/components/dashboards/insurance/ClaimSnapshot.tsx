"use client";

/**
 * §33 — the claims executive snapshot with a Personal / Commercial switch.
 * Management KPIs only; the processing view is the claims register.
 */

import Link from "next/link";
import { useState } from "react";
import { HeartPulse } from "lucide-react";
import type { ClaimSnapshot } from "@/lib/dashboard/insurance/claims";
import { formatCount, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ClaimSnapshotPanel({ s, periodLabel, slaDays, hrefs, lockedLine }: {
  s: ClaimSnapshot; periodLabel: string; slaDays: number; hrefs: Record<string, string>;
  /** The dashboard's own line filter — the claims are already that line only. */
  lockedLine?: "personal" | "commercial" | null;
}) {
  const [picked, setLine] = useState<"all" | "personal" | "commercial">("all");
  const line = lockedLine ? "all" : picked;
  const f = s[line];
  const tiles: Array<{ label: string; value: string; tone?: "bad" | "warn" | "good"; hint?: string; href: string }> = [
    { label: `Claims logged (${periodLabel})`, value: formatCount(f.logged), hint: formatMoney(f.loggedAmount), href: hrefs.claims },
    { label: `Claims settled (${periodLabel})`, value: formatCount(f.settled), hint: formatMoney(f.settledAmount), tone: f.settled ? "good" : undefined, href: hrefs.settled },
    { label: "Claims pending", value: formatCount(f.pending), tone: f.pending ? "warn" : undefined, href: hrefs.open },
    { label: "Files not received", value: formatCount(f.fnr), tone: f.fnr ? "bad" : undefined, href: hrefs.fnr },
    { label: "Claim amount (logged)", value: formatMoney(f.loggedAmount), href: hrefs.claims },
    { label: "Settled amount", value: formatMoney(f.settledAmount), href: hrefs.settled },
    { label: "Outstanding (claimed, unpaid)", value: formatMoney(f.outstanding), hint: `${formatCount(f.open)} open`, href: hrefs.open },
    { label: `Past SLA (${slaDays} days)`, value: formatCount(f.pastSla), tone: f.pastSla ? "bad" : undefined, href: hrefs.escalations },
  ];
  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Claims executive snapshot">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h2 className="section-title flex items-center gap-2"><HeartPulse className="size-4 text-muted-foreground" /> Claims snapshot</h2>
          <p className="section-subtitle mt-1">Management figures only. <Link href={hrefs.claimsDashboard} className="font-medium text-primary hover:underline">Open the claims dashboard</Link></p>
        </div>
        {!lockedLine && <div className="dash-seg" role="group" aria-label="Line">
          {([["all", "All"], ["personal", "Personal"], ["commercial", "Commercial"]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={line === k} onClick={() => setLine(k)}
              className={cn("inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-medium", line === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {l}
            </button>
          ))}
        </div>}
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="dash-tile">
            <div className={cn("text-xl font-semibold tabular-nums leading-tight",
              t.tone === "bad" ? "text-destructive" : t.tone === "warn" ? "text-warning-foreground" : t.tone === "good" ? "text-success" : "text-foreground")}>{t.value}</div>
            <div className="mt-1 text-2xs font-medium leading-snug text-foreground">{t.label}</div>
            {t.hint && <div className="text-2xs text-muted-foreground">{t.hint}</div>}
          </Link>
        ))}
      </div>
      <p className="mt-4 text-2xs text-muted-foreground">
        Outstanding is claimed less settled on open claims — the CRM keeps no approved amount. A claim takes its line from its policy.
      </p>
    </section>
  );
}
