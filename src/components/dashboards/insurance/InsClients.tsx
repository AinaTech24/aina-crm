/**
 * §20 new insurance clients · §22 / §40 MF and
 * insurance relationship coverage · §29 policy counts · §30 premium bands ·
 * §41 concentration.
 */

import { Coins, Link2, Network, PieChart, Sparkles, Tally5 } from "lucide-react";
import type { Coverage, NewClients } from "@/lib/dashboard/insurance/clients";
import { sourceLabel } from "@/lib/dashboard/insurance/clients";
import { Section, Stat, StatGrid, Table, Num } from "@/components/dashboards/my/Shared";
import { formatCount, formatMoney } from "@/lib/format";
import { BarRow, pctOf } from "./parts";

export function NewClientsPanel({ cur, fy, target, targetNote, hrefs, periodLabel, lockedLine }: {
  cur: NewClients; fy: NewClients; target: number | null;
  /** Why `target` is null: not set, or a filtered view that the firm target does not describe. */
  targetNote: string;
  hrefs: Record<string, string>; periodLabel: string;
  /** The dashboard's own line filter — the other line's count was filtered out, not zero. */
  lockedLine?: "personal" | "commercial" | null;
}) {
  const out = "Filtered out — the dashboard is showing one line only.";
  // "Business source" sat beside this card; the firm removed it (2026-10-01).
  return (
      <Section title="New insurance clients" subtitle={`Clients whose first policy was booked in ${periodLabel}.`} icon={<Sparkles className="size-4" />} className="min-w-0"
        note="A new insurance client is one whose first issued policy — across all their policies — falls in the period. Line and client type are those of that first policy.">
        <StatGrid cols={4}>
          <Stat label={periodLabel} value={cur.total} href={hrefs.newClients} />
          <Stat label="FY to date" value={fy.total} href={hrefs.newClients} />
          <Stat label="FY target" value={target} unavailable={targetNote} />
          <Stat label="Achievement" value={target && target > 0 ? fy.total / target : null} format="percent" unavailable={targetNote} />
        </StatGrid>
        <div className="mt-3">
          <StatGrid cols={4}>
            <Stat label="Personal Lines" value={lockedLine === "commercial" ? null : cur.personal} unavailable={out} />
            <Stat label="Commercial Lines" value={lockedLine === "personal" ? null : cur.commercial} unavailable={out} />
            <Stat label="Individual" value={cur.individual} />
            <Stat label="Corporate" value={cur.corporate} />
          </StatGrid>
        </div>
      </Section>
  );
}

export function CoveragePanel({ c, hrefs }: { c: Coverage; hrefs: Record<string, string> }) {
  const share = (n: number) => pctOf(n, c.mfClients);
  return (
    <Section title="MF and insurance relationship" subtitle="How the mutual-fund book and the insurance book overlap — a coverage view, not advice."
      icon={<Link2 className="size-4" />}
      note="“No insurance record in CRM” means no policy is keyed for the client — not that the client needs insurance. Nothing here is a product recommendation. The client-category filter applies.">
      <StatGrid cols={5}>
        <Stat label="MF clients with an insurance record" value={c.mfWithInsurance} hint={`${share(c.mfWithInsurance)} of MF clients`} href={hrefs.clients} />
        <Stat label="MF clients — no insurance record in CRM" value={c.mfNoInsurance} hint={`${share(c.mfNoInsurance)} of MF clients`} href={hrefs.gapClients} />
        <Stat label="Insurance-only clients" value={c.insuranceOnly} hint="A policy, no MF holding" href={hrefs.insOnly} />
        <Stat label="A/B MF clients — renewal in 60 days" value={c.abMfRenewalSoon} tone={c.abMfRenewalSoon > 0 ? "warn" : "neutral"} href={hrefs.renewals} />
        <Stat label="MF clients" value={c.mfClients} href={hrefs.clients} />
      </StatGrid>
      <h3 className="mb-1.5 mt-4 text-2xs font-semibold text-muted-foreground">Coverage by insurance category (MF clients)</h3>
      <StatGrid cols={4}>
        <Stat label="MF + life record" value={c.mfLife} hint={share(c.mfLife)} />
        <Stat label="MF + health record" value={c.mfHealth} hint={share(c.mfHealth)} />
        <Stat label="MF + general record" value={c.mfGeneral} hint={share(c.mfGeneral)} />
        <Stat label="MF + two or more categories" value={c.mfMultiple} hint={share(c.mfMultiple)} />
      </StatGrid>
    </Section>
  );
}

export type CountsView = { newN: number; renN: number; total: number; cancelled: number; pastGrace: number; pending: number };

export function PolicyCountPanel({ v, hrefs, periodLabel }: { v: CountsView; hrefs: Record<string, string>; periodLabel: string }) {
  return (
    <Section title="Policy count" subtitle={`${periodLabel}.`} icon={<Tally5 className="size-4" />}
      note="Past grace = in force but more than the grace period past the renewal date and not marked lapsed — expired in practice. Pending issuance is as it stands now.">
      <StatGrid cols={6}>
        <Stat label="New policies" value={v.newN} href={hrefs.bookedNew} />
        <Stat label="Renewed policies" value={v.renN} tone={v.renN > 0 ? "good" : "neutral"} href={hrefs.bookedRenewal} />
        <Stat label="Total policies" value={v.total} href={hrefs.booked} />
        <Stat label="Cancelled / lost" value={v.cancelled} tone={v.cancelled > 0 ? "bad" : "neutral"} href={hrefs.lostTable} />
        <Stat label="Past grace, not renewed" value={v.pastGrace} tone={v.pastGrace > 0 ? "bad" : "neutral"} href={hrefs["bucket:overdue"]} />
        <Stat label="Pending issuance" value={v.pending} tone={v.pending > 0 ? "warn" : "neutral"} href={hrefs.pending} />
      </StatGrid>
    </Section>
  );
}

export function BandsPanel({ rows, periodLabel, hrefs }: { rows: Array<{ key: string; label: string; policies: number; premium: number }>; periodLabel: string; hrefs: Record<string, string> }) {
  const max = Math.max(0, ...rows.map((r) => r.premium));
  return (
    <Section title="Premium bands" subtitle={`${periodLabel} — business by the size of each policy's annual premium.`} icon={<Coins className="size-4" />}
      note="For segmentation only. A premium band says nothing about how important a client is.">
      {rows.map((r) => (
        <BarRow key={r.key} label={r.label} value={r.premium} max={max} href={hrefs[`band:${r.key}`]}
          right={<>{formatMoney(r.premium)} · {formatCount(r.policies)} pol</>} />
      ))}
    </Section>
  );
}

export type Concentration = { title: string; rows: Array<{ label: string; premium: number }>; total: number };

export function ConcentrationPanel({ blocks }: { blocks: Concentration[] }) {
  return (
    <Section title="Business concentration" subtitle="Where the premium comes from — descriptive only." icon={<PieChart className="size-4" />}
      note="Shares of the period's premium. No risk conclusion is drawn from concentration.">
      <div className="grid gap-5 md:grid-cols-2">
        {blocks.map((b) => (
          <div key={b.title} className="min-w-0">
            <h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">{b.title}</h3>
            {b.rows.length === 0 ? <p className="text-xs text-muted-foreground">Nothing in this period.</p> : (
              <Table rows={b.rows.length} empty="" head={<><th scope="col">Name</th><th scope="col" className="text-right">Premium</th><th scope="col" className="text-right">Share</th></>}>
                {b.rows.map((r) => (
                  <tr key={r.label}>
                    <td className="py-2 text-xs"><div className="w-40 truncate" title={r.label}>{r.label}</div></td>
                    <Num>{formatMoney(r.premium)}</Num>
                    <Num>{pctOf(r.premium, b.total)}</Num>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
