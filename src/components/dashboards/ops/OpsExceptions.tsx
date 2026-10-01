/**
 * Exception sections of the Operations page: rejected transactions (§15),
 * documentation (§13), pending-with and external dependencies (§14, §32),
 * high-value pending (§16), service requests and their ageing (§23–24), and
 * data quality, client master data, unassigned and no-update records
 * (§28–31).
 *
 * "Pending with" separates the team's own delay from waiting on someone else
 * (§14) — a request with the client, the bank or the platform is not an
 * operations delay, and the page says so.
 */

import Link from "next/link";
import {
  Ban, Building, Database, Download, FileWarning, Gem, HelpCircle, Inbox, Scale, TimerOff,
} from "lucide-react";
import { Num, Section, Stat, StatGrid, Table, Unavailable } from "../my/Shared";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/button-class";
import { formatCount, formatMoney } from "@/lib/format";
import { fmtIstDateTime, fmtIstDay, fmtIstShort, inPeriod } from "@/lib/dashboard/ops/fmt";
import type {
  DocDesk, ExternalGroup, HighValueRow, MasterGap, PendingRow, QualityCard, QueryDesk, RejectedDesk, StaleRow, Unassigned,
} from "@/lib/dashboard/ops/exceptions";
import { cn } from "@/lib/utils";

function ExportButton({ kind, query, label }: { kind: string; query: string; label: string }) {
  return (
    <DownloadButton url={`/api/ops/export?kind=${kind}&${query}`} filename={`operations-${kind}.csv`}
      className={buttonClass("secondary", "sm")} ariaLabel={`Export ${label} as CSV`}>
      <Download className="size-3.5" aria-hidden /> Export
    </DownloadButton>
  );
}

/* ───────────────────────────── §15 ───────────────────────────── */

export function RejectedPanel({ d, periodLabel, exportQuery }: { d: RejectedDesk | null; periodLabel: string; exportQuery: string }) {
  return (
    <Section
      title="Rejected transactions"
      subtitle={`Rejected or failed on the RTA / exchange feed ${inPeriod(periodLabel)}.`}
      icon={<Ban className="size-4" />}
      action={d && d.total > 0 ? <ExportButton kind="rejected" query={exportQuery} label="rejected transactions" /> : undefined}
      note="Resolution is tracked for SIP instalments through the rejection register; the CRM has no resolution field for other rejected transactions."
    >
      {!d ? <Unavailable>Feed transactions are outside your own-work view.</Unavailable> : (
        <>
          <StatGrid cols={6}>
            <Stat label="Total rejected" value={d.total} tone={d.total ? "bad" : "neutral"} hint={d.total ? formatMoney(d.value) : undefined} />
            <Stat label="Purchase" value={d.purchase} tone={d.purchase ? "bad" : "neutral"} />
            <Stat label="SIP" value={d.sip} tone={d.sip ? "bad" : "neutral"} />
            <Stat label="Redemption" value={d.redemption} tone={d.redemption ? "bad" : "neutral"} />
            <Stat label="Other" value={d.other} />
            <Stat label="Reason missing" value={d.reasonMissing} tone={d.reasonMissing ? "warn" : "neutral"} hint="an exception to fix" />
          </StatGrid>
          <div className="mt-4">
            <Table rows={d.rows.length} empty={`Nothing rejected on the feed ${inPeriod(periodLabel)}.`} head={<>
              <th scope="col">Client · RM · branch</th>
              <th scope="col">Transaction</th>
              <th scope="col" className="text-right">Amount</th>
              <th scope="col">Rejection reason</th>
              <th scope="col">Date</th>
              <th scope="col">Resolution</th>
              <th scope="col">Assigned to</th>
            </>}>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5">
                    <Link href={`/dashboard/investors/${r.investorId}`} className="text-xs font-medium hover:text-primary hover:underline">{r.client}</Link>
                    <div className="text-2xs text-muted-foreground">{[r.rm ?? "No RM", r.branch ?? "No branch"].join(" · ")}</div>
                  </td>
                  <td className="py-2.5 text-xs">{r.type}{r.scheme && <div className="text-2xs text-muted-foreground">{r.scheme}</div>}</td>
                  <Num>{r.amount != null ? formatMoney(r.amount) : "—"}</Num>
                  <td className="py-2.5 text-xs">{r.reason ?? <span className="font-medium text-warning-foreground">Reason missing</span>}</td>
                  <td className="whitespace-nowrap py-2.5 text-xs">{fmtIstDay(r.date)}</td>
                  <td className="py-2.5 text-xs">{r.resolution ?? <span className="text-muted-foreground">Not tracked</span>}</td>
                  <td className="py-2.5 text-xs">{r.assignedTo ?? <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </Table>
            {d.more > 0 && <p className="mt-2 text-center text-2xs text-muted-foreground">{d.more} more — export for the full list.</p>}
          </div>
        </>
      )}
    </Section>
  );
}

/* ───────────────────────────── §13 ───────────────────────────── */

export function DocsPanel({ d, exportQuery, hrefs }: { d: DocDesk; exportQuery: string; hrefs: Record<string, string> }) {
  return (
    <Section
      title="Documentation control"
      icon={<FileWarning className="size-4" />}
      action={d.pending > 0 ? <ExportButton kind="docs" query={exportQuery} label="documents pending" /> : undefined}
      note="The CRM tracks documents as document-collection requests; it has no per-document status, so 'incomplete' and 'status missing' cannot be counted."
    >
      <StatGrid cols={5}>
        <Stat label="Documents pending" value={d.pending} href={hrefs.docs} />
        <Stat label="Received today" value={d.receivedToday} tone={d.receivedToday ? "good" : "neutral"} hint="requests completed today" />
        <Stat label="Beyond SLA" value={d.beyondSla} tone={d.beyondSla ? "bad" : "neutral"} href={hrefs.docsBreached} />
        <Stat label="Incomplete" display="Not tracked" hint="no document status field" />
        <Stat label="Status missing" display="Not tracked" hint="no document status field" />
      </StatGrid>
      <div className="mt-4">
        <Table rows={d.rows.length} empty="No document pending." head={<>
          <th scope="col">Client</th>
          <th scope="col">Required document</th>
          <th scope="col">Requested</th>
          <th scope="col">Pending with</th>
          <th scope="col" className="text-right">Ageing</th>
          <th scope="col">Assigned to</th>
        </>}>
          {d.rows.map((r) => (
            <tr key={r.id} className={cn(r.breached && "bg-destructive/5")}>
              <td className="py-2.5 text-xs">
                {r.investorId ? <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:text-primary hover:underline">{r.client}</Link>
                  : <span className="text-muted-foreground">{r.client ?? "No client linked"}</span>}
              </td>
              <td className="py-2.5 text-xs"><Link href={`/dashboard/tasks?task=${r.id}`} className="hover:text-primary hover:underline">{r.document}</Link></td>
              <td className="whitespace-nowrap py-2.5 text-xs">{fmtIstDay(r.requested)}</td>
              <td className="py-2.5 text-xs">{r.pendingFrom ?? "—"}</td>
              <Num tone={r.breached ? "bad" : "neutral"}>{r.ageDays} d</Num>
              <td className="py-2.5 text-xs">{r.assignee ?? <span className="text-warning-foreground">Not assigned</span>}</td>
            </tr>
          ))}
        </Table>
      </div>
    </Section>
  );
}

/* ───────────────────────────── §14 · §32 ───────────────────────────── */

export function PendingWithPanel({ rows }: { rows: PendingRow[] }) {
  return (
    <Section
      title="Pending with"
      icon={<Scale className="size-4" />}
      note="Derived from who holds each record — the CRM has no single pending-with field. External waits are not an operations delay."
    >
      <Table rows={rows.length} empty="Nothing is pending." head={<>
        <th scope="col">Pending with</th>
        <th scope="col" className="text-right">No.</th>
        <th scope="col" className="text-right">Value ₹</th>
        <th scope="col" className="text-right">Avg ageing</th>
        <th scope="col">From</th>
      </>}>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="py-2.5 text-xs font-medium">
              {r.label}
              {r.external && <span className="ml-1.5 chip bg-secondary text-secondary-foreground">external</span>}
            </td>
            <Num tone={r.key === "unassigned" && r.count ? "warn" : "neutral"}>{formatCount(r.count)}</Num>
            <Num>{r.value != null && r.count ? formatMoney(r.value) : <span className="text-muted-foreground">—</span>}</Num>
            <Num>{r.avgAgeDays != null && r.count ? `${r.avgAgeDays.toFixed(1)} d` : "—"}</Num>
            <td className="py-2.5 text-2xs text-muted-foreground">{r.source}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

export function ExternalPanel({ d }: { d: { groups: ExternalGroup[]; platforms: Array<{ name: string; count: number; amount: number }> } }) {
  return (
    <Section
      title="External dependencies"
      icon={<Building className="size-4" />}
      note="Platform waits are feed transactions still pending or submitted; bank waits are SIP bounces with a bank or mandate issue."
    >
      {d.groups.length === 0 ? <Unavailable>External dependencies are outside your own-work view.</Unavailable> : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {d.groups.map((g) => (
            <div key={g.key} className="rounded-lg bg-secondary/70 p-3">
              <div className="text-xs font-semibold text-foreground">{g.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{formatCount(g.count)}</div>
              <div className="mt-1 space-y-0.5 text-2xs text-muted-foreground">
                {g.amount != null && g.count > 0 && <div>{formatMoney(g.amount)}</div>}
                {g.avgAgeDays != null && g.count > 0 && <div>Average {g.avgAgeDays.toFixed(1)} days</div>}
                {g.oldest && <div>Oldest: {g.oldest.label} ({g.oldest.days} d)</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {d.platforms.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-2xs">
          {d.platforms.map((p) => (
            <span key={p.name} className="chip bg-secondary text-secondary-foreground">{p.name}: {formatCount(p.count)} · {formatMoney(p.amount)}</span>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ───────────────────────────── §16 ───────────────────────────── */

export function HighValuePanel({ rows, threshold, presets, customAction, customHidden }: {
  rows: HighValueRow[]; threshold: number;
  presets: Array<{ value: number; label: string; href: string }>;
  customAction: string; customHidden: Array<[string, string]>;
}) {
  return (
    <Section
      title="High-value pending"
      subtitle={`Open requests, platform-pending transactions and SIP bounces of ${formatMoney(threshold)} or more.`}
      icon={<Gem className="size-4" />}
      note="Only records that carry an amount can qualify — a request with no value recorded is never assumed small or large."
    >
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Threshold</span>
        {presets.map((p) => (
          <Link key={p.value} href={p.href} aria-current={p.value === threshold ? "true" : undefined}
                className={cn("chip", p.value === threshold ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent")}>
            {p.label}
          </Link>
        ))}
        <form action={customAction} method="get" className="flex items-center gap-1">
          {customHidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label htmlFor="ops-hv" className="sr-only">Custom threshold in rupees</label>
          <input id="ops-hv" name="hv" inputMode="numeric" placeholder="Custom ₹" className="input-base h-7 w-28 text-xs" />
          <button type="submit" className={buttonClass("secondary", "sm")}>Apply</button>
        </form>
      </div>
      <Table rows={rows.length} empty={`Nothing pending at ${formatMoney(threshold)} or more.`} head={<>
        <th scope="col">Client · RM</th>
        <th scope="col">Transaction</th>
        <th scope="col" className="text-right">Amount</th>
        <th scope="col">Entered</th>
        <th scope="col" className="text-right">Ageing</th>
        <th scope="col">Status</th>
        <th scope="col">Pending with</th>
      </>}>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="py-2.5 text-xs">
              {r.investorId ? <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:text-primary hover:underline">{r.client}</Link>
                : <span className="text-muted-foreground">{r.client ?? "No client linked"}</span>}
              <div className="text-2xs text-muted-foreground">{r.rm ?? "No RM"}</div>
            </td>
            <td className="py-2.5 text-xs"><Link href={r.href} className="hover:text-primary hover:underline">{r.what}</Link>
              <div className="text-2xs text-muted-foreground">{r.source}</div></td>
            <Num className="font-semibold">{formatMoney(r.amount)}</Num>
            <td className="whitespace-nowrap py-2.5 text-xs">{fmtIstDay(r.entered)}</td>
            <Num>{r.ageDays != null ? `${r.ageDays} d` : "—"}</Num>
            <td className="py-2.5 text-xs">{r.status}</td>
            <td className="py-2.5 text-xs">{r.pendingWith}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

/* ───────────────────────────── §23–24 ───────────────────────────── */

export function QueriesPanel({ d, periodLabel, exportQuery }: { d: QueryDesk; periodLabel: string; exportQuery: string }) {
  return (
    <Section
      title="Service requests"
      icon={<HelpCircle className="size-4" />}
      action={
        <span className="flex items-center gap-2">
          {d.open > 0 && <ExportButton kind="queries" query={exportQuery} label="service request ageing" />}
          <Link href="/dashboard/service-requests" className="inline-flex min-h-6 items-center text-xs font-medium text-primary hover:underline">All service requests ↗</Link>
        </span>
      }
      note={`SLA is the resolution time the CRM sets by request type. Average resolution covers service requests resolved ${inPeriod(periodLabel)}.`}
    >
      <StatGrid cols={6}>
        <Stat label="Received today" value={d.receivedToday} />
        <Stat label="Open" value={d.open} href="/dashboard/service-requests" />
        <Stat label="Solved today" value={d.solvedToday} tone={d.solvedToday ? "good" : "neutral"} />
        <Stat label="Overdue" value={d.overdue} tone={d.overdue ? "bad" : "neutral"} href="/dashboard/service-requests?breached=1" />
        <Stat label="Average resolution" display={d.avgResolutionDays == null ? "—" : `${d.avgResolutionDays.toFixed(1)} d`} />
        <Stat label="Oldest open" display={d.oldestDays == null ? "—" : `${d.oldestDays} d`} tone={d.oldestDays != null && d.oldestDays > 15 ? "warn" : "neutral"} />
      </StatGrid>
      <div className="mt-4">
        <Table rows={d.rows.length} empty="No open service request." head={<>
          <th scope="col">Client · RM</th>
          <th scope="col">Request type</th>
          <th scope="col">Created</th>
          <th scope="col">Assigned to</th>
          <th scope="col" className="text-right">Ageing</th>
          <th scope="col">Status</th>
          <th scope="col">SLA</th>
          <th scope="col">Remarks</th>
        </>}>
          {d.rows.map((r) => (
            <tr key={r.id} className={cn(r.breached && "bg-destructive/5")}>
              <td className="py-2.5 text-xs">
                <Link href={`/dashboard/service-requests/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.client ?? r.ticket ?? "Service request"}</Link>
                <div className="text-2xs text-muted-foreground">{r.ticket ? `${r.ticket} · ` : ""}{r.rm ?? "No RM"}</div>
              </td>
              <td className="py-2.5 text-xs">{r.type}</td>
              <td className="whitespace-nowrap py-2.5 text-xs">{fmtIstDay(r.created)}</td>
              <td className="py-2.5 text-xs">{r.assignee ?? <span className="text-warning-foreground">Not assigned</span>}</td>
              <Num tone={r.breached ? "bad" : "neutral"}>{r.ageDays} d</Num>
              <td className="py-2.5 text-xs">{r.status}</td>
              <td className="py-2.5 text-xs">
                {r.slaDue ? <><span className="whitespace-nowrap tabular-nums">{fmtIstShort(r.slaDue)}</span> {r.breached && <Badge raw tone="danger">Breached</Badge>}</> : <span className="text-muted-foreground">No SLA</span>}
              </td>
              <td className="max-w-56 py-2.5 text-2xs text-muted-foreground"><span className="line-clamp-2">{r.remarks ?? "No remark"}</span></td>
            </tr>
          ))}
        </Table>
      </div>
      <h3 className="mb-2 mt-5 text-xs font-semibold text-foreground">Service request ageing</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {d.ageing.map((b) => (
          <div key={b.key} className={cn("rounded-lg border p-2.5", b.key === "q16" && b.count ? "border-destructive/30 bg-destructive/5" : "border-transparent bg-secondary/70")}>
            <div className="text-2xs text-muted-foreground">{b.label}</div>
            <div className={cn("text-lg font-semibold tabular-nums", b.key === "q16" && b.count ? "text-destructive" : "text-foreground")}>{formatCount(b.count)}</div>
            {b.count > 0 && <div className="text-2xs text-muted-foreground">{b.topType ?? "—"}{b.owner ? ` · ${b.owner}` : " · not assigned"}</div>}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ───────────────────────────── §28–31 ───────────────────────────── */

export function QualityPanel({ cards, master }: { cards: QualityCard[]; master: { clients: number; gaps: MasterGap[] } | null }) {
  return (
    <Section
      title="Data quality control"
      icon={<Database className="size-4" />}
      note="Only fields the CRM itself requires or records are checked. Profession, company and family mapping are listed for clean-up but are optional, so they are not counted as required."
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => {
          const body = (
            <>
              <div className={cn("text-xl font-semibold tabular-nums", c.count ? "text-warning-foreground" : "text-foreground")}>
                {c.count == null ? <span className="text-muted-foreground" title="Outside your own-work view">—</span> : formatCount(c.count)}
              </div>
              <div className="mt-1 text-2xs font-medium text-foreground">{c.label}</div>
              <div className="text-2xs leading-snug text-muted-foreground">{c.note}</div>
            </>
          );
          return c.href
            ? <Link key={c.key} href={c.href} className="rounded-lg border border-transparent bg-secondary/70 p-3 transition-colors hover:border-primary/25 hover:bg-accent">{body}</Link>
            : <div key={c.key} className="rounded-lg border border-transparent bg-secondary/70 p-3">{body}</div>;
        })}
      </div>
      {master && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-semibold text-foreground">
            Client master data — {formatCount(master.clients)} clients
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {master.gaps.map((g) => (
              <Link key={g.key} href={g.href} className="rounded-lg border border-transparent bg-secondary/70 px-3 py-2 transition-colors hover:border-primary/25 hover:bg-accent">
                <div className={cn("text-base font-semibold tabular-nums", g.count && g.required ? "text-warning-foreground" : "text-foreground")}>{formatCount(g.count)}</div>
                <div className="text-2xs text-muted-foreground">{g.label}{g.required ? "" : " · optional"}</div>
                <div className="text-2xs font-medium text-primary">View records</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

export function UnassignedPanel({ u, hrefs }: { u: Unassigned; hrefs: Record<string, string> }) {
  return (
    <Section title="Unassigned records" icon={<Inbox className="size-4" />}>
      <StatGrid cols={5}>
        <Stat label="Transactions" value={u.transactions} tone={u.transactions ? "warn" : "neutral"} href={hrefs.unassigned} />
        <Stat label="Tasks" value={u.tasks} tone={u.tasks ? "warn" : "neutral"} href={hrefs.unassigned} />
        <Stat label="Service requests" value={u.queries} tone={u.queries ? "warn" : "neutral"} href="/dashboard/service-requests" />
        <Stat label="Documentation" value={u.documentation} tone={u.documentation ? "warn" : "neutral"} href={hrefs.unassigned} />
        <Stat label="SIP rejections" value={u.sipRejections} tone={u.sipRejections ? "warn" : "neutral"} href="/dashboard/sip-rejections" hint="no RM assigned" />
      </StatGrid>
    </Section>
  );
}

export function NoUpdatePanel({ d, days, presets, customAction, customHidden }: {
  d: { rows: StaleRow[]; total: number }; days: number;
  presets: Array<{ value: number; href: string }>; customAction: string; customHidden: Array<[string, string]>;
}) {
  return (
    <Section
      title="No update"
      subtitle={d.total ? `${formatCount(d.total)} open records untouched for ${days}+ day${days === 1 ? "" : "s"}.` : `Nothing untouched for ${days}+ day${days === 1 ? "" : "s"}.`}
      icon={<TimerOff className="size-4" />}
      note="An update is any edit or remark on the record."
    >
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Untouched for</span>
        {presets.map((p) => (
          <Link key={p.value} href={p.href} aria-current={p.value === days ? "true" : undefined}
                className={cn("chip", p.value === days ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent")}>
            {p.value} day{p.value === 1 ? "" : "s"}
          </Link>
        ))}
        <form action={customAction} method="get" className="flex items-center gap-1">
          {customHidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label htmlFor="ops-nu" className="sr-only">Custom number of days</label>
          <input id="ops-nu" name="nu" inputMode="numeric" placeholder="Days" className="input-base h-7 w-16 text-xs" />
          <button type="submit" className={buttonClass("secondary", "sm")}>Apply</button>
        </form>
      </div>
      <Table rows={d.rows.length} empty="Nothing matches." head={<>
        <th scope="col">Record</th>
        <th scope="col">Client</th>
        <th scope="col">Owner</th>
        <th scope="col">Status</th>
        <th scope="col">Last updated</th>
        <th scope="col" className="text-right">Days without update</th>
      </>}>
        {d.rows.map((r) => (
          <tr key={r.key}>
            <td className="py-2.5 text-xs"><Link href={r.href} className="font-medium hover:text-primary hover:underline">{r.record}</Link></td>
            <td className="py-2.5 text-xs">{r.client ?? <span className="text-muted-foreground">—</span>}</td>
            <td className="py-2.5 text-xs">{r.owner ?? <span className="text-warning-foreground">Not assigned</span>}</td>
            <td className="py-2.5 text-xs">{r.status}</td>
            <td className="whitespace-nowrap py-2.5 text-xs">{fmtIstDateTime(r.lastUpdated)}</td>
            <Num tone={r.days > 7 ? "bad" : "warn"}>{r.days}</Num>
          </tr>
        ))}
      </Table>
    </Section>
  );
}
