/**
 * §28 New-client onboarding and §29 client source analysis.
 *
 * Onboarding shows where each new client of this FY stands — and where they
 * are STUCK (the first step not yet done). Source analysis uses only the lead
 * sources that actually occur in the CRM; a client keyed in directly, with no
 * originating lead, is "Not recorded" rather than guessed into a bucket.
 */

import Link from "next/link";
import { Check, Minus, Signpost, Workflow } from "lucide-react";
import type { Onboarding, SourceRow } from "@/lib/dashboard/my/desk";
import { humanStatus } from "@/lib/dashboard/my/desk";
import { CategoryTag, Num, Section, Table, Unavailable } from "@/components/dashboards/my/Shared";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const Tick = ({ on }: { on: boolean }) =>
  on ? <Check className="size-3.5 text-success" aria-label="Done" /> : <Minus className="size-3.5 text-muted-foreground" aria-label="Not yet" />;

export function OnboardingPipeline({ data, fyLabel }: { data: Onboarding; fyLabel: string }) {
  const top = Math.max(1, data.cohort);
  return (
    <Section
      title="New client onboarding"
      subtitle={`The ${formatCount(data.cohort)} client${data.cohort === 1 ? "" : "s"} added in ${fyLabel}, step by step — and where each is stuck.`}
      icon={<Workflow className="size-4" />}
      note="A client counts as stuck at the first step not yet done. A proposal is not required before a first transaction, so a client who has already transacted is never shown stuck at Proposal. KYC & data complete means a validated KYC plus PAN, date of birth, mobile and email."
    >
      {data.cohort === 0 ? (
        <Unavailable>No client has been added to your book in {fyLabel} yet.</Unavailable>
      ) : (
        <>
          <ol className="grid gap-2 sm:grid-cols-7">
            {data.steps.map((s) => (
              <li key={s.key} className="rounded-lg border border-border p-2.5">
                <div className="text-2xs font-medium text-foreground">{s.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{formatCount(s.done)}</div>
                <div className="mt-1 h-1 rounded-full bg-secondary" aria-hidden>
                  <span className="block h-full rounded-full bg-primary/60" style={{ width: `${(s.done / top) * 100}%` }} />
                </div>
                <div className={cn("mt-1 text-2xs", s.stuck > 0 ? "font-medium text-warning-foreground" : "text-muted-foreground")}>
                  {s.key === "lead" ? "came from a lead" : s.stuck > 0 ? `${s.stuck} stuck here` : "none stuck"}
                </div>
              </li>
            ))}
          </ol>
          <h3 className="mb-2 mt-4 text-2xs font-semibold text-muted-foreground">New clients this month</h3>
          <Table
            rows={data.thisMonth.length}
            empty="No client has been added this month."
            head={
              <>
                <th scope="col">Client</th>
                <th scope="col">Category</th>
                <th scope="col">Source</th>
                <th scope="col">Added</th>
                <th scope="col" className="text-center">KYC &amp; data</th>
                <th scope="col" className="text-center">Risk profile</th>
                <th scope="col" className="text-center">First transaction</th>
                <th scope="col">Next step</th>
              </>
            }
          >
            {data.thisMonth.map((c) => (
              <tr key={c.id}>
                <td className="py-2.5"><Link href={`/dashboard/investors/${c.id}`} className="font-medium hover:text-primary hover:underline">{c.name}</Link></td>
                <td className="py-2.5"><CategoryTag value={c.category} /></td>
                <td className="py-2.5 text-xs">{c.source ? humanStatus(c.source) : <span className="text-muted-foreground">Not recorded</span>}</td>
                <td className="whitespace-nowrap py-2.5 text-xs">{formatDate(c.created)}</td>
                <td className="py-2.5"><span className="flex justify-center"><Tick on={c.kyc} /></span></td>
                <td className="py-2.5"><span className="flex justify-center"><Tick on={c.risk} /></span></td>
                <td className="py-2.5"><span className="flex justify-center"><Tick on={c.transacted} /></span></td>
                <td className={cn("py-2.5 text-xs font-medium", c.nextStep === "Onboarded" ? "text-success" : "text-foreground")}>{c.nextStep}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Section>
  );
}

export function SourceAnalysis({ rows, periodLabel }: { rows: SourceRow[]; periodLabel: string }) {
  const peak = Math.max(1, ...rows.map((r) => r.business));
  return (
    <Section
      title="Where my relationships came from"
      subtitle={`Leads, new clients and business in ${periodLabel}, by the source recorded on the lead.`}
      icon={<Signpost className="size-4" />}
      note="Only source values that occur in the CRM are listed. Business is gross investment in the period (purchases and SIP instalments, from the RTA feed) by clients converted from a lead of that source. Clients added directly have no lead and show as Not recorded."
    >
      <Table
        rows={rows.length}
        empty={`No lead or new client recorded in ${periodLabel}.`}
        head={
          <>
            <th scope="col">Source</th>
            <th scope="col" className="text-right">Leads</th>
            <th scope="col" className="text-right">New clients</th>
            <th scope="col" className="text-right">Business</th>
            <th scope="col" className="w-32" />
          </>
        }
      >
        {rows.map((r) => (
          <tr key={r.source}>
            <td className={cn("py-2.5 text-xs font-medium", r.source === "__none__" && "text-muted-foreground")}>
              {r.source === "__none__" ? "Not recorded" : humanStatus(r.source)}
            </td>
            <Num>{formatCount(r.leads)}</Num>
            <Num>{formatCount(r.newClients)}</Num>
            <Num>{r.business ? formatMoney(r.business) : <span className="text-muted-foreground">—</span>}</Num>
            <td className="py-2.5">
              <span className="block h-1.5 w-full rounded-full bg-secondary" aria-hidden>
                <span className="block h-full rounded-full bg-primary/60" style={{ width: `${(Math.max(0, r.business) / peak) * 100}%` }} />
              </span>
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}
