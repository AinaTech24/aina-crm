/**
 * §12–13 new-business pipeline and ageing · §26 corporate pipeline · §27
 * industry · §31–32 policy issuance. Summary only: detailed processing is the
 * policy register and the Leads page.
 */

import { Building, Factory, FileClock, GitBranch, Hourglass } from "lucide-react";
import type { IndustryRow } from "@/lib/dashboard/insurance/clients";
import type { Issuance, Pipeline } from "@/lib/dashboard/insurance/pipeline";
import { LEAD_STAGE_LABEL } from "@/lib/dashboard/insurance/pipeline";
import { POLICY_STATUS_LABEL, policyTypeLabel } from "@/lib/insurance/book";
import { Num, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "@/components/dashboards/my/Shared";
import { Badge } from "@/components/ui/Badge";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import { ClientLink } from "./InsClientDrawer";

const potential = (v: number | null) => (v == null ? <span className="text-muted-foreground" title="No expected amount keyed on the lead">—</span> : formatMoney(v));

export function PipelinePanel({ p, names }: { p: Pipeline; names: Map<string, string> }) {
  const top = Math.max(1, ...p.stages.map((s) => s.count));
  return (
    <Section title="New business pipeline" subtitle={`${formatCount(p.open.count)} open insurance lead${p.open.count === 1 ? "" : "s"}${p.open.potential != null ? ` · ${formatMoney(p.open.potential)} potential premium` : ""}, by the CRM's insurance stages.`}
      icon={<GitBranch className="size-4" />}
      note="Stages are the CRM's insurance pipeline. Days in stage is known where the lead workflow stamped the stage; otherwise it is the lead's age. Corporate leads count as Commercial Lines, all others as Personal. Meeting, payment and client confirmation are not separate stages in the CRM.">
      <div className="space-y-1.5">
        {p.stages.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 truncate sm:w-36">{s.label}</span>
            <span className="h-5 min-w-0 flex-1 overflow-hidden rounded bg-secondary">
              {s.count > 0 && (
                <span className={`flex h-full items-center rounded px-1.5 text-2xs font-semibold text-primary-foreground ${s.key === "issued" ? "bg-success" : s.key === "lost" ? "bg-destructive/70" : "bg-primary/70"}`}
                  style={{ width: `${Math.max(6, (s.count / top) * 100)}%` }}>{formatCount(s.count)}</span>
              )}
            </span>
            <span className="hidden w-24 shrink-0 text-right tabular-nums text-muted-foreground sm:block">{potential(s.potential)}</span>
            <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">{s.avgDays != null && s.count ? `${s.avgDays} d avg` : ""}</span>
            <span className="hidden w-24 shrink-0 text-right text-2xs text-muted-foreground md:block">{s.count ? `P ${s.personal} · C ${s.commercial}` : ""}</span>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <h3 className="mb-2 text-2xs font-semibold text-muted-foreground">Pipeline ageing</h3>
        <StatGrid cols={5}>
          {p.ageing.map((a) => (
            <Stat key={a.key} label={a.label} value={a.count} tone={a.key === "a5" && a.count > 0 ? "bad" : a.key === "a4" && a.count > 0 ? "warn" : "neutral"}
              hint={a.potential != null ? formatMoney(a.potential) : "No potential keyed"} />
          ))}
        </StatGrid>
      </div>
      <div className="mt-4">
        <Table rows={p.rows.length} empty="No open insurance lead." head={<>
          <th scope="col">Client / lead</th>
          <th scope="col">Product interest</th>
          <th scope="col" className="text-right">Premium</th>
          <th scope="col">Stage</th>
          <th scope="col" className="text-right">Days</th>
          <th scope="col">Owner</th>
          <th scope="col">Next action</th>
        </>}>
          {p.rows.map((r) => (
            <tr key={r.id}>
              <td className="py-2.5 text-xs font-medium">
                <a href={`/dashboard/leads/${r.id}`} className="hover:text-primary hover:underline">{r.name}</a>
                {r.corporate && <span className="ml-1.5"><Badge raw>Corporate</Badge></span>}
              </td>
              <td className="py-2.5 text-xs text-muted-foreground">{r.product ?? "Not recorded"}</td>
              <Num>{potential(r.potential)}</Num>
              <td className="py-2.5 text-xs">{LEAD_STAGE_LABEL[r.stage] ?? r.stage}</td>
              <Num tone={r.days > 30 ? "bad" : r.days > 15 ? "warn" : "neutral"}>
                <span title={r.daysBasis === "stage" ? "Days in this stage" : "Days since the lead was created — the stage date is not recorded"}>{r.days}{r.daysBasis === "age" ? "*" : ""}</span>
              </Num>
              <td className="py-2.5 text-xs">{r.ownerId ? names.get(r.ownerId) ?? "—" : <span className="text-warning-foreground">Owner missing</span>}</td>
              <td className="py-2.5 text-xs">{r.nextAction ? formatDate(r.nextAction) : <span className="text-muted-foreground">Not updated</span>}</td>
            </tr>
          ))}
        </Table>
        {p.more > 0 && <p className="mt-2 text-center text-2xs text-muted-foreground">{p.more} more open leads on the pipeline board. * = days since created.</p>}
      </div>
    </Section>
  );
}

export function CorporatePanel({ p, names, industry }: { p: Pipeline; names: Map<string, string>; industry: IndustryRow[] }) {
  const c = p.corporate;
  const count = (k: string) => c.stages.find((s) => s.key === k)?.count ?? 0;
  const recorded = industry.filter((r) => r.industry);
  return (
    <div className="grid gap-6 2xl:grid-cols-2">
      <Section title="Corporate insurance pipeline" subtitle="Commercial Lines opportunities with corporate prospects." className="min-w-0"
        icon={<Building className="size-4" />}
        note="Corporate leads are leads whose type is Corporate. Negotiation is not a stage in the CRM; quotation covers quoted and proposal.">
        <StatGrid cols={6}>
          <Stat label="Corporate leads" value={c.stages.reduce((a, s) => a + s.count, 0)} />
          <Stat label="Meetings held (FY)" value={c.meetings} />
          <Stat label="Quotation shared" value={count("quoted") + count("proposal")} />
          <Stat label="Underwriting" value={count("underwriting")} />
          <Stat label="Policy issued" value={count("issued")} tone={count("issued") > 0 ? "good" : "neutral"} />
          <Stat label="Lost" value={count("lost")} tone={count("lost") > 0 ? "bad" : "neutral"} />
        </StatGrid>
        <div className="mt-4">
          <Table rows={c.rows.length} empty="No open corporate insurance lead." head={<>
            <th scope="col">Corporate</th>
            <th scope="col">Industry</th>
            <th scope="col">Product</th>
            <th scope="col" className="text-right">Potential premium</th>
            <th scope="col">Stage</th>
            <th scope="col">Owner</th>
            <th scope="col">Next action</th>
          </>}>
            {c.rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2.5 text-xs font-medium"><a href={`/dashboard/leads/${r.id}`} className="hover:text-primary hover:underline">{r.name}</a></td>
                <td className="py-2.5 text-xs text-muted-foreground">{r.occupation ?? "Not recorded"}</td>
                <td className="py-2.5 text-xs text-muted-foreground">{r.product ?? "Not recorded"}</td>
                <Num>{potential(r.potential)}</Num>
                <td className="py-2.5 text-xs">{LEAD_STAGE_LABEL[r.stage] ?? r.stage}</td>
                <td className="py-2.5 text-xs">{r.ownerId ? names.get(r.ownerId) ?? "—" : <span className="text-warning-foreground">Owner missing</span>}</td>
                <td className="py-2.5 text-xs">{r.nextAction ? formatDate(r.nextAction) : <span className="text-muted-foreground">Not updated</span>}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Section>
      <Section title="Industry-wise commercial business" subtitle="The in-force book of corporate clients, by their recorded nature of business." className="min-w-0"
        icon={<Factory className="size-4" />}
        note="Industry is the corporate client's “Nature of business” as keyed on KYC — grouped exactly as recorded, never mapped to an industry list.">
        {recorded.length === 0 ? (
          <Unavailable>No corporate insurance client has a nature of business recorded, so there is nothing to group by industry.</Unavailable>
        ) : (
          <Table rows={industry.length} empty="" head={<>
            <th scope="col">Industry (as recorded)</th>
            <th scope="col" className="text-right">Clients</th>
            <th scope="col" className="text-right">Premium in force</th>
            <th scope="col" className="text-right">Policies</th>
          </>}>
            {industry.map((r) => (
              <tr key={r.industry ?? "none"}>
                <td className="py-2.5 text-xs font-medium">{r.industry ?? <span className="text-muted-foreground">Not recorded</span>}</td>
                <Num>{formatCount(r.clients)}</Num>
                <Num>{formatMoney(r.premium)}</Num>
                <Num>{formatCount(r.policies)}</Num>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

export function IssuancePanel({ d, issued, cancelledBeforeIssue, names, hrefs, slaDays, highPremium }: {
  d: Issuance; issued: { count: number; premium: number }; cancelledBeforeIssue: { count: number; premium: number };
  names: Map<string, string>; hrefs: Record<string, string>; slaDays: number; highPremium: number;
}) {
  return (
    <Section title="Policy issuance"
      icon={<FileClock className="size-4" />} action={<SectionLink href={hrefs.pending}>Open pending policies</SectionLink>}
      note={`The CRM records proposed, in underwriting, issued and cancelled. Documents pending, payment pending and insurer rejection are not recorded on a policy. Delayed = waiting more than ${slaDays} days (Settings → Dashboard thresholds); high premium = ${formatMoney(highPremium)} or more.`}>
      <StatGrid cols={5}>
        <Stat label="Proposal received" value={d.proposed.count} hint={formatMoney(d.proposed.premium)} href={hrefs.proposed} />
        <Stat label="Underwriting / processing" value={d.underwriting.count} hint={formatMoney(d.underwriting.premium)} href={hrefs.underwriting} />
        <Stat label="Issued (period)" value={issued.count} hint={formatMoney(issued.premium)} tone={issued.count > 0 ? "good" : "neutral"} href={hrefs.booked} />
        <Stat label="Cancelled before issue" value={cancelledBeforeIssue.count} hint={formatMoney(cancelledBeforeIssue.premium)} tone={cancelledBeforeIssue.count > 0 ? "bad" : "neutral"} href={hrefs.lost} />
        <Stat label="Delayed past SLA" value={d.breached} tone={d.breached > 0 ? "bad" : "neutral"} href={hrefs.pending} />
      </StatGrid>
      <div className="mt-4">
        <Table rows={d.rows.length} empty="No policy is waiting to be issued." head={<>
          <th scope="col">Client</th>
          <th scope="col">Policy type</th>
          <th scope="col" className="text-right">Premium</th>
          <th scope="col">Insurer</th>
          <th scope="col">Stage</th>
          <th scope="col">Owner · keyed by</th>
          <th scope="col" className="text-right">Ageing</th>
        </>}>
          {d.rows.map((r) => (
            <tr key={r.policyId} className={r.slaBreached ? "bg-destructive/5" : undefined}>
              <td className="py-2.5 text-xs font-medium"><ClientLink id={r.investorId} name={r.client} /></td>
              <td className="py-2.5 text-xs">{policyTypeLabel(r.policyType)}</td>
              <Num className={r.highPremium ? "font-semibold" : undefined}>{formatMoney(r.premium)}</Num>
              <td className="py-2.5 text-xs">{r.insurer ?? <span className="text-muted-foreground">Not recorded</span>}</td>
              <td className="py-2.5 text-xs"><a href={`/dashboard/insurance/${r.policyId}`} className="hover:text-primary hover:underline">{POLICY_STATUS_LABEL[r.status] ?? r.status}</a></td>
              <td className="py-2.5 text-xs">
                {r.ownerId ? names.get(r.ownerId) ?? "—" : <span className="text-warning-foreground">Owner missing</span>}
                {r.opsId && <div className="text-2xs text-muted-foreground">keyed by {names.get(r.opsId) ?? "—"}</div>}
              </td>
              <Num tone={r.slaBreached ? "bad" : "neutral"}>{r.ageDays} d{r.highPremium ? <Hourglass className="ml-1 inline size-3 text-warning-foreground" aria-label="High premium" /> : null}</Num>
            </tr>
          ))}
        </Table>
        {d.more > 0 && <p className="mt-2 text-center text-2xs text-muted-foreground">{d.more} more in the policy register.</p>}
      </div>
    </Section>
  );
}
