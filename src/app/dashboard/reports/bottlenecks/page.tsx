import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Bottlenecks (CEO review S10, 2026-10-24) — where work waits.
 *
 * Per journey stage: how long a case typically waits there (median and 90th
 * percentile of the stays that finished in the period), how many sit there
 * now and the longest current wait. Pick a stage to split it by branch and
 * by person; the cases stuck longest link to their record. Then tasks: how
 * long each type takes from creation to done, and how often it is late.
 *
 * Loaders in lib/reports/bottlenecks.ts, maths in bottlenecks-core.ts. What
 * the viewer sees follows the dashboards' rule: firm, branch, team or own.
 */

import Link from "next/link";
import { Hourglass } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { resolveDataAccess } from "@/lib/dashboards/team";
import { accessLabel } from "@/lib/dashboards/system/access";
import { humanise } from "@/lib/format";
import { InlineEmpty } from "@/components/common/EmptyState";
import { JOURNEYS, loadStays, loadTaskTurnaround, type JourneyKey } from "@/lib/reports/bottlenecks";
import { formatWait, groupStats, slowestStage, stageStats, stuckLongest, type GroupStat } from "@/lib/reports/bottlenecks-core";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const WINDOWS: Record<string, { label: string; days: number }> = {
  "30": { label: "30 days", days: 30 },
  "90": { label: "90 days", days: 90 },
  "180": { label: "6 months", days: 180 },
  "365": { label: "12 months", days: 365 },
};
const BASE = "/dashboard/reports/bottlenecks";

type SP = { w?: string; j?: string; stage?: string };

function href(sp: SP, patch: Partial<SP>) {
  const next = { ...sp, ...patch };
  const q = new URLSearchParams();
  if (next.w && next.w !== "90") q.set("w", next.w);
  if (next.j && next.j !== "leads") q.set("j", next.j);
  if (next.stage) q.set("stage", next.stage);
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

export default async function BottlenecksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await requireSession();
  await assertActiveLicense(session.tenantId, session.roles);

  const wKey = sp.w && WINDOWS[sp.w] ? sp.w : "90";
  const journey: JourneyKey = sp.j === "opportunities" ? "opportunities" : "leads";
  const now = new Date();
  const from = new Date(now.getTime() - WINDOWS[wKey].days * 86_400_000);

  const data = await withTenant(session.tenantId, async (tx) => {
    const access = await resolveDataAccess(tx, session);
    const branchName = access.kind === "branch"
      ? ((await tx.execute(sql`SELECT name FROM branches WHERE id = ${access.branchId}::uuid AND tenant_id = ${session.tenantId}::uuid`)).rows[0] as { name: string } | undefined)?.name
      : null;
    const stays = await loadStays(tx, session.tenantId, access, journey, from);
    const tasks = await loadTaskTurnaround(tx, session.tenantId, access, from);
    return { access, branchName, stays, tasks };
  });

  const stages = stageStats(data.stays, from, now);
  const picked = stages.find((s) => s.key === sp.stage) ?? slowestStage(stages);
  const inStage = picked ? data.stays.filter((s) => s.stageKey === picked.key) : [];
  const byBranch = groupStats(inStage, "branch", from, now);
  const byPerson = groupStats(inStage, "person", from, now);
  const stuck = stuckLongest(data.stays, now);
  const slowest = slowestStage(stages);

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeaderCard
        title={<><Hourglass className="size-6 text-muted-foreground" /> Bottlenecks</>}
        breadcrumb={[{ label: "Reports", href: "/dashboard/reports" }, { label: "Bottlenecks" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <nav className="dash-seg" aria-label="Journey">
              {(Object.keys(JOURNEYS) as JourneyKey[]).map((k) => (
                <Link key={k} href={href(sp, { j: k, stage: undefined })} aria-current={k === journey ? "page" : undefined}>
                  {JOURNEYS[k].label}
                </Link>
              ))}
            </nav>
            <nav className="dash-seg" aria-label="Period">
              {Object.entries(WINDOWS).map(([k, w]) => (
                <Link key={k} href={href(sp, { w: k })} aria-current={k === wKey ? "page" : undefined}>{w.label}</Link>
              ))}
            </nav>
          </div>
        }
      />
      <p className="text-sm text-muted-foreground">Showing: {accessLabel(data.access, data.branchName)}</p>

      <Section title={`${JOURNEYS[journey].label} — time in each stage`}>
        {stages.length === 0 ? (
          <InlineEmpty message="No stage history in this period." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Stage</th>
                  <th className="text-right">Passed through</th>
                  <th className="text-right">Typical wait</th>
                  <th className="text-right">Slowest 10% wait over</th>
                  <th className="text-right">Over SLA</th>
                  <th className="text-right">In it now</th>
                  <th className="text-right">Waiting longest</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => {
                  const slow = slowest?.key === s.key;
                  const breached = s.slaDays != null && s.medianDays != null && s.medianDays > s.slaDays;
                  return (
                    <tr key={s.key} className={picked?.key === s.key ? "bg-secondary/70" : undefined}>
                      <td>
                        <Link href={href(sp, { stage: s.key })} className="font-medium hover:underline">{s.name}</Link>
                        {slow && <span className="ml-2 chip text-2xs">Slowest</span>}
                      </td>
                      <td className="text-right tabular-nums">{s.done || "—"}</td>
                      <td className={`text-right tabular-nums ${breached ? "text-warning font-medium" : ""}`}>{formatWait(s.medianDays)}</td>
                      <td className="text-right tabular-nums">{formatWait(s.p90Days)}</td>
                      <td className="text-right tabular-nums">
                        {s.slaDays == null ? <span className="text-muted-foreground">No SLA</span> : s.overSla ? `${s.overSla} of ${s.done}` : "—"}
                      </td>
                      <td className="text-right tabular-nums">{s.open || "—"}</td>
                      <td className="text-right tabular-nums">{formatWait(s.oldestOpenDays)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {picked && (
        <div className="grid gap-6 lg:grid-cols-2">
          {byBranch.length > 1 && <GroupTable title={`${picked.name} — by branch`} rows={byBranch} label="Branch" />}
          <GroupTable title={`${picked.name} — by person`} rows={byPerson} label="Person" />
        </div>
      )}

      <Section title="Stuck longest">
        {stuck.length === 0 ? (
          <InlineEmpty message="Nothing is waiting in a stage right now." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Case</th>
                  <th className="text-left">Stage</th>
                  <th className="text-left">Owner</th>
                  <th className="text-left">Branch</th>
                  <th className="text-right">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {stuck.map((s) => (
                  <tr key={`${s.subjectId}:${s.stageKey}`}>
                    <td><Link href={JOURNEYS[journey].href(s.subjectId)} className="hover:underline">{s.subjectName ?? "—"}</Link></td>
                    <td>{s.stageName}</td>
                    <td>{s.personName ?? "Unassigned"}</td>
                    <td>{s.branchName ?? "—"}</td>
                    <td className={`text-right tabular-nums ${s.slaDays != null && s.waitingDays > s.slaDays ? "text-destructive font-medium" : ""}`}>{formatWait(s.waitingDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Tasks — time to finish by type">
        {data.tasks.length === 0 ? (
          <InlineEmpty message="No tasks in this period." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Task type</th>
                  <th className="text-right">Finished</th>
                  <th className="text-right">Typical time</th>
                  <th className="text-right">Slowest 10% over</th>
                  <th className="text-right">Finished late</th>
                  <th className="text-right">Open now</th>
                  <th className="text-right">Overdue now</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t) => (
                  <tr key={t.type}>
                    <td>{humanise(t.type)}</td>
                    <td className="text-right tabular-nums">{t.done || "—"}</td>
                    <td className="text-right tabular-nums">{formatWait(t.medianDays)}</td>
                    <td className="text-right tabular-nums">{formatWait(t.p90Days)}</td>
                    <td className="text-right tabular-nums">{t.withDue ? `${Math.round((t.late / t.withDue) * 100)}%` : "—"}</td>
                    <td className="text-right tabular-nums">{t.open || "—"}</td>
                    <td className={`text-right tabular-nums ${t.overdue ? "text-destructive font-medium" : ""}`}>{t.overdue || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function GroupTable({ title, rows, label }: { title: string; rows: GroupStat[]; label: string }) {
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <InlineEmpty message="Nothing in this stage in this period." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">{label}</th>
                <th className="text-right">Passed</th>
                <th className="text-right">Typical wait</th>
                <th className="text-right">In it now</th>
                <th className="text-right">Longest</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id ?? "none"}>
                  <td>{g.name}</td>
                  <td className="text-right tabular-nums">{g.done || "—"}</td>
                  <td className="text-right tabular-nums">{formatWait(g.medianDays)}</td>
                  <td className="text-right tabular-nums">{g.open || "—"}</td>
                  <td className="text-right tabular-nums">{formatWait(g.oldestOpenDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-5">
      <h2 className="section-title">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}
