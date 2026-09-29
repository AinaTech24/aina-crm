/**
 * Automations → Run history (was the Automation Monitor / Control Tower at
 * /dashboard/workflows/runs).
 *
 * Leads with what people mean by "my automations ran": RULE runs, in a window
 * that defaults to 30 days and is said in words. The older workflow-engine
 * runs (workflow_runs) only appear when there were some — on most books there
 * are none, and a big "0 runs" beside "Fired 22" was the confusion.
 *
 * Plain words throughout: the event outbox is "record changes waiting to be
 * processed", a clean one is "All systems normal".
 *
 * ?window=1|7|30  ?rule=<id>  ?status=failed  ?page=N
 */
import Link from "next/link";
import { sql } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, Inbox, Send, Timer, XCircle, Zap } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { getAutomationHealth, canViewMonitor } from "@/lib/automation/control-tower";
import { RetryButton } from "@/components/automation/RetryButton";
import { RefreshButton } from "@/components/automation/RefreshButton";
import { Pager } from "@/components/common/Pager";
import { buttonClass } from "@/components/ui/button-class";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { v: 1, label: "24 hours", short: "24h" },
  { v: 7, label: "7 days", short: "7 days" },
  { v: 30, label: "30 days", short: "30 days" },
];
const PAGE_SIZE = 50;

const RESULT: Record<string, { label: string; tone: string }> = {
  succeeded: { label: "Done", tone: "bg-secondary text-foreground border-border" },
  partial: { label: "Partly done", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  failed: { label: "Failed", tone: "bg-rose-50 text-rose-700 border-rose-200" },
  skipped: { label: "Skipped", tone: "bg-secondary text-muted-foreground border-border" },
};

const RUN_STATUS_TONE: Record<string, string> = {
  completed: "bg-secondary text-foreground border-border",
  running: "bg-secondary text-foreground border-border",
  queued: "bg-secondary text-foreground border-border",
  paused: "bg-amber-50 text-amber-800 border-amber-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subjectHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  if (type === "investor" || type === "investors") return `/dashboard/investors/${id}`;
  if (type === "lead" || type === "leads") return `/dashboard/leads/${id}`;
  return null;
}

export default async function AutomationRunHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  if (!canViewMonitor(session.roles, session.permissions)) {
    return (
      <div className="max-w-2xl card-surface p-8 text-center text-sm text-muted-foreground">
        Run history is visible to owners, compliance and operations.
      </div>
    );
  }

  const sp = await searchParams;
  const windowDays = [1, 7, 30].includes(Number(sp.window)) ? Number(sp.window) : 30;
  const windowText = WINDOWS.find((w) => w.v === windowDays)!.label;
  const ruleFilter = sp.rule && UUID.test(sp.rule) ? sp.rule : "";
  const failedOnly = sp.status === "failed";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const ctx = { userId: session.userId, branchId: session.branchId, roles: session.roles };

  const { health, runs, total, ruleOptions } = await withTenant(
    session.tenantId,
    async (tx) => {
      const health = await getAutomationHealth(tx as any, session.tenantId, windowDays);
      const where = sql`e.tenant_id = ${session.tenantId}::uuid
        AND e.executed_at >= now() - make_interval(days => ${windowDays}::int)
        ${ruleFilter ? sql`AND e.rule_id = ${ruleFilter}::uuid` : sql``}
        ${failedOnly ? sql`AND e.status IN ('failed', 'partial')` : sql``}`;
      const totalRow = (await tx.execute(sql`SELECT count(*)::int AS c FROM workflow_rule_executions e WHERE ${where}`)).rows[0] as
        | { c?: number }
        | undefined;
      const rows = (await tx.execute(sql`
        SELECT e.id, e.rule_id, COALESCE(r.name, 'Deleted automation') AS rule_name, e.status, e.triggered_by,
               e.subject_type, e.subject_id, e.executed_at,
               COALESCE(
                 e.error,
                 (SELECT string_agg((elem->>'type') || ': ' || COALESCE(elem->>'error', elem->>'detail', 'failed'), '; ')
                    FROM jsonb_array_elements(COALESCE(e.instant_outcomes, '[]'::jsonb)) elem
                   WHERE elem->>'status' = 'failed')
               ) AS reason
          FROM workflow_rule_executions e
          LEFT JOIN workflow_rules r ON r.id = e.rule_id AND r.tenant_id = e.tenant_id
         WHERE ${where}
         ORDER BY e.executed_at DESC
         LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
      `)).rows as Array<{
        id: string;
        rule_id: string;
        rule_name: string;
        status: string;
        triggered_by: string;
        subject_type: string | null;
        subject_id: string | null;
        executed_at: string;
        reason: string | null;
      }>;
      const ruleOptions = (await tx.execute(sql`
        SELECT id, name FROM workflow_rules WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name ASC
      `)).rows as Array<{ id: string; name: string }>;
      return { health, runs: rows, total: Number(totalRow?.c ?? 0), ruleOptions };
    },
    ctx
  );

  const filterRule = ruleOptions.find((r) => r.id === ruleFilter);
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | number | undefined> = {
      window: windowDays === 30 ? undefined : windowDays,
      rule: ruleFilter || undefined,
      status: failedOnly ? "failed" : undefined,
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return `/dashboard/automations/history${s ? `?${s}` : ""}`;
  };
  const legacyRuns = health.runs.total > 0 || health.runs.inFlight > 0;
  const outboxClear = health.outbox.pending === 0 && health.outbox.stuck === 0;

  return (
    <div className="space-y-6">
      {/* Window, said in words */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          Showing the <span className="font-medium text-foreground">last {windowText}</span>.
        </p>
        <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <Link
              key={w.v}
              href={qs({ window: w.v === 30 ? undefined : w.v, page: undefined })}
              aria-current={windowDays === w.v ? "true" : undefined}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                windowDays === w.v ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {w.short}
            </Link>
          ))}
        </div>
        <div className="ml-auto">
          <RefreshButton />
        </div>
      </div>

      {/* Summary tiles — neutral unless something needs attention */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <Tile
          icon={Zap}
          label="Rule runs"
          value={health.rules.total}
          sub={health.rules.failed > 0 ? `${health.rules.failed} failed or partly done` : "none failed"}
          tone={health.rules.failed > 0 ? "rose" : undefined}
        />
        <Tile icon={Send} label="Messages sent" value={health.impact.messagesSent} sub={`${health.comms.skipped} skipped`} />
        <Tile
          icon={Send}
          label="Messages waiting to send"
          value={health.comms.queued}
          sub={health.comms.queued > 0 ? "queued, not sent yet" : "nothing queued"}
        />
        <Tile
          icon={Timer}
          label="Scheduled actions"
          value={health.scheduledJobs.pending}
          sub={health.scheduledJobs.overdue > 0 ? `${health.scheduledJobs.overdue} overdue by over an hour` : "waiting for their time"}
          tone={health.scheduledJobs.overdue > 0 ? "amber" : undefined}
        />
        <Tile
          icon={Inbox}
          label="Waiting to be processed"
          value={health.outbox.pending}
          sub={health.outbox.stuck > 0 ? `${health.outbox.stuck} stuck over an hour` : "All systems normal"}
          tone={health.outbox.stuck > 0 ? "rose" : undefined}
        />
      </div>

      {/* Rule runs — the list the Rules tab's Failures links open */}
      <section aria-labelledby="rule-runs" className="card-surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <h2 id="rule-runs" className="font-semibold text-sm">
            Rule runs{" "}
            <span className="font-normal text-muted-foreground">
              · {total.toLocaleString("en-IN")} {failedOnly ? "failed or partly done" : "in total"}
              {filterRule ? ` for “${filterRule.name}”` : ""}
            </span>
          </h2>
          <form method="get" className="ml-auto flex flex-wrap items-center gap-2">
            {windowDays !== 30 && <input type="hidden" name="window" value={windowDays} />}
            <label htmlFor="run-rule" className="sr-only">Automation</label>
            <select id="run-rule" name="rule" defaultValue={ruleFilter} className="input-base h-8 text-xs max-w-64">
              <option value="">All automations</option>
              {ruleOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <label htmlFor="run-status" className="sr-only">Result</label>
            <select id="run-status" name="status" defaultValue={failedOnly ? "failed" : ""} className="input-base h-8 text-xs">
              <option value="">Every result</option>
              <option value="failed">Failures only</option>
            </select>
            <button type="submit" className={buttonClass("secondary", "sm")}>Show</button>
          </form>
        </div>
        {runs.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {failedOnly ? "No failed runs in this window." : "No rule runs in this window."}
          </p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">When</th>
                    <th className="text-left py-2 font-medium">Automation</th>
                    <th className="text-left py-2 font-medium">Record</th>
                    <th className="text-left py-2 font-medium">Result</th>
                    <th className="text-left py-2 pr-4 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const res = RESULT[r.status] ?? { label: r.status, tone: "bg-secondary text-foreground border-border" };
                    const href = subjectHref(r.subject_type, r.subject_id);
                    const raw = (r.subject_type ?? "record").replace(/_/g, " ").replace(/s$/, "");
                    const kind = raw === "investor" ? "client" : raw;
                    return (
                      <tr key={r.id} className="border-b last:border-0 align-top">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(r.executed_at, "dateTime")}</td>
                        <td className="py-2.5 pr-3">
                          <Link href={`/dashboard/workflows/rules/${r.rule_id}`} className="font-medium hover:underline">
                            {r.rule_name}
                          </Link>
                          {r.triggered_by !== "event" && (
                            <span className="ml-1.5 text-2xs text-muted-foreground">({r.triggered_by === "schedule" ? "scheduled" : r.triggered_by})</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-xs capitalize">
                          {href ? <Link href={href} className="hover:underline">Open {kind}</Link> : <span className="text-muted-foreground">{kind}</span>}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={`inline-block text-2xs px-2 py-0.5 rounded-full border ${res.tone}`}>{res.label}</span>
                        </td>
                        <td className="py-2.5 pr-4 text-xs !whitespace-normal max-w-md">
                          {r.reason ? <span className="text-rose-700">{r.reason}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 pb-3">
              <Pager page={page} totalPages={Math.ceil(total / PAGE_SIZE)} total={total} pageSize={PAGE_SIZE} />
            </div>
          </>
        )}
      </section>

      {/* Scheduled actions — pending/failed/overdue, with re-queue */}
      <section aria-labelledby="sched" className="card-surface overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 id="sched" className="font-semibold text-sm flex items-center gap-2">
            <Timer className="size-4 text-muted-foreground" aria-hidden /> Scheduled actions
          </h2>
          <div className="flex items-center gap-3">
            {health.scheduledJobs.overdue > 0 && (
              <span className="text-xs text-rose-700 font-medium">{health.scheduledJobs.overdue} overdue by over an hour</span>
            )}
            {health.scheduledJobs.failed > 0 && (
              <RetryButton endpoint="/api/workflow-rules/scheduled-jobs/retry-all" label={`Retry all (${health.scheduledJobs.failed})`} doneLabel="Re-queued all" title="Try every failed scheduled action again" />
            )}
          </div>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">Actions set to run later (e.g. “send 3 days after”), right now.</p>
          <div className="flex flex-wrap gap-5">
            <MiniStat label="Waiting" value={health.scheduledJobs.pending} tone={health.scheduledJobs.overdue > 0 ? "amber" : undefined} />
            <MiniStat label="Running" value={health.scheduledJobs.running} />
            <MiniStat label="Failed" value={health.scheduledJobs.failed} tone={health.scheduledJobs.failed > 0 ? "rose" : undefined} />
            <MiniStat label="Cancelled" value={health.scheduledJobs.cancelled} />
          </div>
          {health.scheduledJobs.recentFailed.length > 0 && (
            <ul className="space-y-1.5 border-t pt-3">
              {health.scheduledJobs.recentFailed.map((j) => (
                <li key={j.id} className="text-xs border-b last:border-0 pb-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium capitalize">{j.actionType.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground"> · {j.attempts} attempt{j.attempts === 1 ? "" : "s"}</span>
                    <div className="text-rose-700 truncate" title={j.lastError ?? ""}>{j.lastError ?? "failed"}</div>
                  </div>
                  <RetryButton endpoint={`/api/workflow-rules/scheduled-jobs/${j.id}/retry`} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Record changes waiting for the automations (the event outbox) */}
        <section aria-labelledby="waiting" className="card-surface p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 id="waiting" className="font-semibold text-sm flex items-center gap-2">
              <Inbox className="size-4 text-muted-foreground" aria-hidden /> Waiting to be processed
            </h2>
            {health.outbox.recentErrors.length > 0 && (
              <RetryButton endpoint="/api/automation/outbox/retry-all" label="Retry all" doneLabel="Re-queued all" title="Try every stuck change again" />
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            New and changed records (a lead added, a SIP rejected…) queue here until your automations pick them up.
          </p>
          <div className="flex gap-4 mb-3">
            <MiniStat label="Waiting" value={health.outbox.pending} tone={health.outbox.pending > 0 ? "amber" : undefined} />
            <MiniStat label="Stuck over 1 hour" value={health.outbox.stuck} tone={health.outbox.stuck > 0 ? "rose" : undefined} />
          </div>
          {health.outbox.recentErrors.length === 0 ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5" aria-hidden /> {outboxClear ? "All systems normal." : "Nothing is failing; the queue is moving."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {health.outbox.recentErrors.map((e) => (
                <li key={e.id} className="text-xs border-b last:border-0 pb-1.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{e.kind.replace(/[._]/g, " ")}</span>{" "}
                    <span className="text-muted-foreground">· {e.attempts} attempt{e.attempts === 1 ? "" : "s"}</span>
                    <div className="text-rose-700 truncate" title={e.lastError}>{e.lastError}</div>
                  </div>
                  <RetryButton endpoint={`/api/automation/outbox/${e.id}/retry`} title="Try this change again" />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Message delivery */}
        <section aria-labelledby="delivery" className="card-surface p-4">
          <h2 id="delivery" className="font-semibold text-sm flex items-center gap-2 mb-3">
            <Send className="size-4 text-muted-foreground" aria-hidden /> Message delivery
          </h2>
          <div className="flex flex-wrap gap-4 mb-3">
            <MiniStat label="Delivered" value={health.comms.delivered} />
            <MiniStat label="Waiting to send" value={health.comms.queued} />
            <MiniStat label="Skipped" value={health.comms.skipped} tone={health.comms.skipped > 0 ? "amber" : undefined} />
            <MiniStat label="Failed" value={health.comms.failed} tone={health.comms.failed > 0 ? "rose" : undefined} />
          </div>
          {health.comms.recentFailed.length === 0 ? (
            <p className="text-xs text-muted-foreground">No failed or bounced messages in this window.</p>
          ) : (
            <ul className="space-y-1.5">
              {health.comms.recentFailed.map((c) => (
                <li key={c.id} className="text-xs border-b last:border-0 pb-1.5 flex items-center justify-between gap-2">
                  <span className="capitalize font-medium">{c.channel}</span>
                  <span className="text-rose-700 truncate flex-1 text-right" title={c.reason ?? ""}>{c.reason ?? "failed"}</span>
                  <span className="text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(c.at, "dateTime")}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/dashboard/communications" className="inline-block mt-3 text-xs font-medium text-foreground hover:underline">
            Open communications →
          </Link>
        </section>
      </div>

      {/* The older workflow engine — only when it actually ran something */}
      {legacyRuns && (
        <section aria-labelledby="legacy" className="card-surface overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 id="legacy" className="font-semibold text-sm flex items-center gap-2">
              <AlertTriangle className="size-4 text-muted-foreground" aria-hidden /> Workflow runs (canvas workflows)
            </h2>
            <span className="text-xs text-muted-foreground">
              {health.runs.total} run{health.runs.total === 1 ? "" : "s"} · {health.runs.inFlight} in progress
            </span>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(health.runs.byStatus).map(([status, count]) => (
                <span key={status} className={`text-xs px-2.5 py-1 rounded-full border tabular-nums ${RUN_STATUS_TONE[status] ?? "bg-muted"}`}>
                  {status} · {count}
                </span>
              ))}
            </div>
            {health.recentFailedRuns.length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 font-medium">Workflow</th>
                    <th className="text-left py-2 font-medium">Error</th>
                    <th className="text-left py-2 font-medium">When</th>
                    <th className="py-2"><span className="sr-only">Retry</span></th>
                  </tr>
                </thead>
                <tbody>
                  {health.recentFailedRuns.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 align-top">
                      <td className="py-2.5 font-medium">
                        <Link href={`/dashboard/workflows/runs/${r.id}`} className="hover:underline flex items-center gap-1">
                          <XCircle className="size-3.5 text-rose-600" aria-hidden /> {r.workflowName}
                        </Link>
                      </td>
                      <td className="py-2.5 text-xs text-rose-700 max-w-[280px] truncate" title={r.error ?? ""}>{r.error ?? "—"}</td>
                      <td className="py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(r.at, "dateTime")}</td>
                      <td className="py-2.5 text-right"><RetryButton endpoint={`/api/workflows/runs/${r.id}/retry`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: number; sub?: string; tone?: "rose" | "amber" }) {
  const valCls = tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${valCls}`}>{value.toLocaleString("en-IN")}</div>
      {sub && <div className="text-2xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "rose" | "amber" }) {
  const cls = tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-foreground";
  return (
    <div>
      <div className={`text-xl font-bold tabular-nums ${cls}`}>{value.toLocaleString("en-IN")}</div>
      <div className="text-2xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
