import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { ExportButton } from "@/components/export/ExportButton";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { XOctagon, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { visibleClientExists, visibleClientSql } from "@/lib/transactions/client-scope";
import { SipRejectionsTable } from "@/components/sip-rejections/SipRejectionsTable";
import { NewSipRejectionButton } from "@/components/sip-rejections/NewSipRejectionButton";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { ModuleTabs, SIP_TABS } from "@/components/common/ModuleTabs";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { readColumnPrefs } from "@/lib/list-columns/server";
import { EXTRA_PREFIX, orderKeys } from "@/lib/list-columns/prefs";
import { SIP_REJ_DEFAULT_COLUMNS, allowedSipRejectionKeys, loadSipRejectionExtra, sipRejectionExtraOptions } from "@/lib/list-columns/sip-rejection-fields";

const SIP_REJ_COLUMNS = [
  { key: "rejected_on", label: "Rejected on", required: true },
  { key: "investor", label: "Investor", required: true },
  { key: "sip", label: "SIP details" },
  { key: "amount", label: "Amount" },
  { key: "reason", label: "Reason" },
  { key: "rm", label: "RM", defaultHidden: true },
  { key: "follow_up", label: "Follow-up" },
  { key: "recovery_date", label: "Recovery date", defaultHidden: true },
  { key: "recovery_status", label: "Recovery status" },
  { key: "auto_recover", label: "Auto-action", required: true },
  { key: "remarks", label: "Remarks" },
];

export const dynamic = "force-dynamic";

export default async function SipRejectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const recoveryFilter = (sp.recovery ?? "").split(",").filter(Boolean);
  const reasonCat = (sp.reason_cat ?? "").trim();
  const overdueOnly = sp.overdue === "1";
  const mtdOnly = sp.mtd === "1";

  const colPrefs = await readColumnPrefs("sip-rejections");
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const extraOptions = sipRejectionExtraOptions((f) => isFieldAllowed(license, "investor", f));
  const extraAllowed = allowedSipRejectionKeys(extraOptions);
  const extraKeys = colPrefs.extra.filter((k) => extraAllowed.has(k));

  const data = await withTenant(session.tenantId, async (tx) => {
    // Each read below runs in its own SAVEPOINT: one that fails (a slow query
    // cut off by the 30 s statement timeout on a firm's large ledger, a bad
    // row) is reported on the page instead of taking the whole page down to
    // "Something went wrong" with only a reference number to show for it.
    const problems: string[] = [];
    let savepointNo = 0;
    async function safely<T, F>(label: string, fallback: F, run: () => Promise<T>): Promise<T | F> {
      const name = sql.raw(`sip_rej_${++savepointNo}`);
      await tx.execute(sql`SAVEPOINT ${name}`);
      try {
        const out = await run();
        await tx.execute(sql`RELEASE SAVEPOINT ${name}`);
        return out;
      } catch (e) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT ${name}`);
        await tx.execute(sql`RELEASE SAVEPOINT ${name}`);
        // drizzle wraps the database's own reason ("canceling statement due to
        // statement timeout") as `cause` under a "Failed query: <sql>" message.
        const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : null;
        const msg = cause ?? (e instanceof Error ? e.message : String(e));
        console.error(`[sip-rejections] ${label} failed for tenant ${session.tenantId}:`, e);
        problems.push(`${label}: ${msg.slice(0, 300)}`);
        return fallback;
      }
    }
    // Viewer scope: a rejection is visible only when its client is. The rows
    // join investors as i; the tiles and the per-RM table test it by EXISTS.
    const filters: any[] = [await visibleClientSql(tx, session, "i")];
    const statScope = await visibleClientExists(tx, session, sql.raw("sip_rejections.investor_id"));
    const byRmScope = await visibleClientExists(tx, session, sql.raw("r.investor_id"));
    if (q) {
      filters.push(
        sql`(i.name ILIKE ${`%${q}%`} OR r.scheme_name ILIKE ${`%${q}%`} OR r.amc_name ILIKE ${`%${q}%`} OR r.folio_number ILIKE ${`%${q}%`} OR r.rejection_reason ILIKE ${`%${q}%`})`
      );
    }
    if (recoveryFilter.length) {
      filters.push(
        sql`r.recovery_status IN (${sql.join(recoveryFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (reasonCat) {
      filters.push(sql`r.reason_category = ${reasonCat}`);
    }
    if (overdueOnly) {
      filters.push(
        sql`((now() - r.status_changed_at) > interval '2 days' AND r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))`
      );
    }
    if (mtdOnly) {
      filters.push(sql`r.rejection_date >= date_trunc('month', now())`);
    }
    const dr = dateRangeCond(sp, "rej", "r.rejection_date");
    if (dr) filters.push(dr);
    // Branch / RM — the branch command centre's "open the exact SIP records".
    // Both follow the CLIENT (its branch, its RM), which is how the dashboard
    // counts rejections. Malformed ids are dropped rather than cast.
    const ids = (v: string | undefined) => (v ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const branchIds = ids(sp.branch);
    const rmIds = ids(sp.rm);
    if (branchIds.length) filters.push(sql`i.branch_id IN (${sql.join(branchIds.map((v) => sql`${v}::uuid`), sql`, `)})`);
    if (rmIds.length) filters.push(sql`i.rm_id IN (${sql.join(rmIds.map((v) => sql`${v}::uuid`), sql`, `)})`);
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const rows = await safely("the rejection list", { rows: [] as Array<Record<string, unknown>> }, () => tx.execute(sql`
      SELECT r.id, r.investor_id, r.rejection_date, r.rejection_amount,
             r.rejection_reason, r.reason_category, r.scheme_name, r.folio_number, r.amc_name,
             r.assigned_rm_id, r.follow_up_date, r.recovery_date,
             r.recovery_status, r.status_changed_at, r.remarks, r.created_at,
             i.name AS investor_name, i.pan AS investor_pan,
             u.name AS rm_name,
             ((now() - r.status_changed_at) > interval '2 days'
               AND r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))
               AS escalation_overdue
      FROM sip_rejections r
      LEFT JOIN investors i ON i.id = r.investor_id
      LEFT JOIN users u ON u.id = r.assigned_rm_id
      ${whereSql}
      ORDER BY r.rejection_date DESC, r.created_at DESC
      LIMIT 200
    `));

    // The fields this person added as columns — only for the rows on screen.
    const extraValues = await safely("the columns you added", {} as Record<string, Record<string, string>>, () =>
      loadSipRejectionExtra(
        tx,
        (rows.rows as Array<{ id: unknown }>).map((x) => String(x.id)),
        extraKeys,
        extraAllowed,
      ),
    );

    const stats = await safely("the summary figures", { rows: [] as Array<Record<string, unknown>> }, () => tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE recovery_status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE recovery_status IN ('client_contacted','bank_issue','mandate_issue','reprocessed'))::int AS in_progress,
        COUNT(*) FILTER (WHERE recovery_status = 'recovered')::int AS recovered,
        COUNT(*) FILTER (WHERE recovery_status = 'not_recoverable')::int AS lost,
        COUNT(*) FILTER (WHERE (now() - status_changed_at) > interval '2 days'
          AND recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))::int AS overdue,
        COUNT(*) FILTER (WHERE rejection_date >= date_trunc('month', now()))::int AS rejected_mtd,
        COALESCE(SUM(CASE WHEN rejection_date >= date_trunc('month', now())
          THEN rejection_amount::numeric ELSE 0 END), 0)::numeric AS rejected_amt_mtd,
        COALESCE(SUM(CASE WHEN recovery_status = 'recovered'
          AND recovery_date >= date_trunc('month', now())
          THEN rejection_amount::numeric ELSE 0 END), 0)::numeric AS recovered_amt_mtd,
        -- Reason mix (open items only — what's actionable right now)
        COUNT(*) FILTER (WHERE reason_category = 'insufficient_balance'
          AND recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))::int AS rc_balance,
        COUNT(*) FILTER (WHERE reason_category = 'mandate_expired'
          AND recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))::int AS rc_mandate,
        COUNT(*) FILTER (WHERE reason_category = 'technical'
          AND recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))::int AS rc_technical,
        -- Aging buckets (open items, by how long since the status last moved)
        COUNT(*) FILTER (WHERE recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue')
          AND (now() - status_changed_at) <= interval '2 days')::int AS age_0_2,
        COUNT(*) FILTER (WHERE recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue')
          AND (now() - status_changed_at) > interval '2 days'
          AND (now() - status_changed_at) <= interval '7 days')::int AS age_3_7,
        COUNT(*) FILTER (WHERE recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue')
          AND (now() - status_changed_at) > interval '7 days')::int AS age_7p
      FROM sip_rejections
      WHERE tenant_id = ${session.tenantId}::uuid
        AND ${statScope}
    `));
    const s = (stats.rows[0] ?? {}) as any;
    const statsFailed = !stats.rows.length;

    // Per-RM accountability — who's sitting on open / overdue recoveries.
    const byRm = await safely("open recoveries by RM", { rows: [] as Array<Record<string, unknown>> }, () => tx.execute(sql`
      SELECT COALESCE(u.name, '— Unassigned —') AS rm_name,
             COUNT(*)::int AS open_count,
             COUNT(*) FILTER (WHERE (now() - r.status_changed_at) > interval '2 days')::int AS overdue_count,
             COALESCE(SUM(r.rejection_amount::numeric), 0)::numeric AS open_amt
      FROM sip_rejections r
      LEFT JOIN users u ON u.id = r.assigned_rm_id
      WHERE r.tenant_id = ${session.tenantId}::uuid
        AND r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue')
        AND ${byRmScope}
      GROUP BY COALESCE(u.name, '— Unassigned —')
      ORDER BY overdue_count DESC, open_count DESC
      LIMIT 12
    `));
    const recoveryRate =
      Number(s.rejected_amt_mtd ?? 0) > 0
        ? (Number(s.recovered_amt_mtd ?? 0) / Number(s.rejected_amt_mtd ?? 0)) * 100
        : 0;

    // An empty page must say WHY. What the registrar's transaction feed (imported in the last
    // 90 days, the window the rows are made from) holds about SIPs tells apart "no SIP in the
    // feed", "SIPs came, none bounced" and "a bounce came but is not linked to a client".
    let feedNote: string | null = null;
    if (!statsFailed && Number(s.total) === 0 && !q) {
      // Only SIP rows are counted, so the (tenant, type) index narrows it: a firm
      // onboarded in the last 90 days has its WHOLE ledger "imported in the last
      // 90 days", and counting every row of it was the slowest read on this page.
      const f = (
        await safely("the note on why the list is empty", { rows: [] as Array<Record<string, unknown>> }, () => tx.execute(sql`
          SELECT COUNT(*)::int AS sip_total,
                 COUNT(*) FILTER (WHERE status IN ('rejected','failed'))::int AS sip_bounced,
                 COUNT(*) FILTER (WHERE status IN ('rejected','failed') AND investor_id IS NULL)::int AS bounced_unlinked,
                 COUNT(*) FILTER (WHERE status = 'cancelled')::int AS sip_cancelled,
                 COUNT(*) FILTER (WHERE reason_code IN ('REVERSAL','REVERSED'))::int AS sip_reversed,
                 COUNT(*) FILTER (WHERE status = 'pending')::int AS sip_pending
            FROM transactions
           WHERE tenant_id = ${session.tenantId}::uuid
             AND type = 'sip'
             AND created_at >= now() - interval '90 days'
        `))
      ).rows[0] as any;
      // The registrar's own status words on those SIP rows (kept in raw_feed_row since 2026-11-24):
      // a bounce worded in a way we do not recognise is stored as processed, and this is where it shows.
      const words = f && Number(f.sip_total ?? 0) > 0 && Number(f.sip_bounced ?? 0) === 0
        ? ((await safely("the registrar's status words", { rows: [] as Array<Record<string, unknown>> }, () => tx.execute(sql`
            SELECT raw_feed_row ->> 'status' AS word, COUNT(*)::int AS n
              FROM transactions
             WHERE tenant_id = ${session.tenantId}::uuid AND type = 'sip'
               AND created_at >= now() - interval '90 days'
               AND COALESCE(raw_feed_row ->> 'status', '') <> ''
             GROUP BY 1 ORDER BY 2 DESC LIMIT 6
          `))).rows as Array<{ word: string; n: number }>)
        : [];
      const wordsNote = words.length
        ? ` The registrar's own status words on them: ${words.map((w) => `"${w.word}" (${Number(w.n).toLocaleString("en-IN")})`).join(", ")}. If one of these means a bounce, tell support the word and it will be added.`
        : "";
      const total = Number(f?.sip_total ?? 0);
      const bounced = Number(f?.sip_bounced ?? 0);
      const unlinked = Number(f?.bounced_unlinked ?? 0);
      const cancelled = Number(f?.sip_cancelled ?? 0);
      const reversed = Number(f?.sip_reversed ?? 0);
      const pending = Number(f?.sip_pending ?? 0);
      const others = [
        cancelled > 0 ? `${cancelled.toLocaleString("en-IN")} cancelled` : "",
        reversed > 0 ? `${reversed.toLocaleString("en-IN")} reversed` : "",
        pending > 0 ? `${pending.toLocaleString("en-IN")} pending` : "",
      ].filter(Boolean);
      const alsoSeen = others.length ? ` (also seen: ${others.join(", ")})` : "";
      feedNote = !f
        ? null
        : total === 0
          ? "No SIP instalment is in the transaction feed imported in the last 90 days. Import the daily transaction feed (RTA File Imports) and bounced SIPs will appear here."
          : bounced === 0
            ? `The transaction feed imported in the last 90 days holds ${total.toLocaleString("en-IN")} SIP instalment${total === 1 ? "" : "s"}, and the registrar marked none of them rejected or failed${alsoSeen}. If your registrar sends bounces in a separate SIP rejection report, import that report; a bounce is added here only when the registrar reports it.${wordsNote}`
            : unlinked > 0
              ? `${bounced.toLocaleString("en-IN")} bounced SIP${bounced === 1 ? "" : "s"} came in the feed, ${unlinked.toLocaleString("en-IN")} of them for a folio whose client is not in the client master. Import the folio master, then they are placed.`
              : `${bounced.toLocaleString("en-IN")} bounced SIP${bounced === 1 ? "" : "s"} came in the feed and are being added; refresh in a minute.`;
    }

    return {
      problems,
      feedNote,
      total: Number(s.total ?? 0),
      pending: Number(s.pending ?? 0),
      inProgress: Number(s.in_progress ?? 0),
      recovered: Number(s.recovered ?? 0),
      lost: Number(s.lost ?? 0),
      overdue: Number(s.overdue ?? 0),
      rejectedMtd: Number(s.rejected_mtd ?? 0),
      rejectedAmtMtd: Number(s.rejected_amt_mtd ?? 0),
      recoveredAmtMtd: Number(s.recovered_amt_mtd ?? 0),
      recoveryRate,
      reasonMix: {
        insufficient_balance: Number(s.rc_balance ?? 0),
        mandate_expired: Number(s.rc_mandate ?? 0),
        technical: Number(s.rc_technical ?? 0),
      },
      aging: { a0_2: Number(s.age_0_2 ?? 0), a3_7: Number(s.age_3_7 ?? 0), a7p: Number(s.age_7p ?? 0) },
      byRm: byRm.rows as any[],
      rows: (rows.rows as Array<{ id: unknown }>).map((x) => ({ ...x, extra: extraValues[String(x.id)] })),
    };
  });

  // The columns in this person's order: the built-in ones, then the fields they
  // added; their saved sequence decides and the date column stays first.
  const colOrder = orderKeys(
    [...SIP_REJ_DEFAULT_COLUMNS, ...extraKeys.map((k) => EXTRA_PREFIX + k)],
    colPrefs.order,
    ["rejected_on"],
  );
  const extraCols = extraKeys.map((k) => ({ key: k, label: extraOptions.find((o) => o.key === k)?.label ?? k }));

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><XOctagon className="size-6 text-muted-foreground" /> SIP Rejections</>} actions={<><div className="flex items-center gap-2">
          <NewSipRejectionButton />
          <ExportButton module="sip-rejections" />
          <Link href="/dashboard/reports/sip_recovery_monthly" className="btn-secondary text-xs">
            Monthly recovery report →
          </Link>
        </div></>} />

      <ModuleTabs tabs={SIP_TABS} />

      {data.problems.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning/5 px-4 py-3 text-sm">
          <div className="font-semibold">Part of this page could not be loaded</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
            {data.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <div className="mt-1 text-xs text-muted-foreground">
            The rest of the page is correct. Refresh to try again; if this stays, send this message to support.
          </div>
        </div>
      )}

      <div className="grid grid-cols-6 gap-3">
        <Stat icon={AlertTriangle} label="Total" value={data.total} />
        <Stat icon={Clock} label="Pending" value={data.pending} tone={data.pending > 0 ? "amber" : "muted"} />
        <Stat icon={Clock} label="In progress" value={data.inProgress} />
        <Stat
          icon={AlertTriangle}
          label="SLA breached (>2d)"
          value={data.overdue}
          tone={data.overdue > 0 ? "rose" : "muted"}
        />
        <Stat icon={CheckCircle2} label="Recovered" value={data.recovered} tone="emerald" />
        <Stat
          label="Recovery rate MTD"
          value={`${data.recoveryRate.toFixed(0)}%`}
          tone={data.recoveryRate >= 60 ? "emerald" : data.recoveryRate >= 30 ? "amber" : "rose"}
        />
      </div>

      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Recovery summary — this month</h3>
          <span className="text-xs text-muted-foreground">
            {data.rejectedMtd} rejections · {formatINR(data.rejectedAmtMtd)} value
          </span>
        </div>
        <div className="h-3 bg-rose-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${Math.min(100, data.recoveryRate)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-emerald-700 font-medium">
            Recovered {formatINR(data.recoveredAmtMtd)}
          </span>
          <span className="text-rose-700">
            Outstanding {formatINR(data.rejectedAmtMtd - data.recoveredAmtMtd)}
          </span>
        </div>
      </div>

      {/* Reason mix · aging · per-RM accountability */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="card-surface p-5">
          <h3 className="font-semibold text-sm mb-3">Why SIPs are bouncing <span className="text-xs font-normal text-muted-foreground">(open)</span></h3>
          <div className="space-y-1.5">
            <ReasonRow label="Mandate expired" hint="Re-register NACH" value={data.reasonMix.mandate_expired} cat="mandate_expired" active={reasonCat} tone="orange" />
            <ReasonRow label="Insufficient balance" hint="Nudge the client" value={data.reasonMix.insufficient_balance} cat="insufficient_balance" active={reasonCat} tone="amber" />
            <ReasonRow label="Technical" hint="Auto-retry next cycle" value={data.reasonMix.technical} cat="technical" active={reasonCat} tone="slate" />
          </div>
          {reasonCat && (
            <Link href="/dashboard/sip-rejections" className="text-2xs text-brand-cyan hover:underline mt-2 inline-block">
              Clear reason filter
            </Link>
          )}
        </div>

        <div className="card-surface p-5">
          <h3 className="font-semibold text-sm mb-3">Recovery aging <span className="text-xs font-normal text-muted-foreground">(open items)</span></h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <AgeBucket label="0–2 days" value={data.aging.a0_2} tone="emerald" />
            <AgeBucket label="3–7 days" value={data.aging.a3_7} tone="amber" />
            <AgeBucket label="> 7 days" value={data.aging.a7p} tone="rose" />
          </div>
          
        </div>

        <div className="card-surface p-5">
          <h3 className="font-semibold text-sm mb-3">Open recoveries by RM</h3>
          {data.byRm.length === 0 ? (
            <p className="text-xs text-muted-foreground">No open recoveries. ✓</p>
          ) : (
            <ul className="space-y-1.5 text-sm max-h-44 overflow-y-auto pr-1">
              {data.byRm.map((r: any) => (
                <li key={r.rm_name} className="flex items-center justify-between gap-2">
                  <span className="truncate">{r.rm_name}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {Number(r.overdue_count) > 0 && (
                      <span className="text-2xs font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">
                        {r.overdue_count} overdue
                      </span>
                    )}
                    <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground min-w-[1.6rem] text-center">
                      {r.open_count}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CompactFilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by investor, scheme, AMC, reason…" },
          {
            type: "multi",
            key: "recovery",
            label: "Recovery status",
            options: [
              { value: "pending", label: "Pending" },
              { value: "client_contacted", label: "Client contacted" },
              { value: "bank_issue", label: "Bank issue" },
              { value: "mandate_issue", label: "Mandate issue" },
              { value: "reprocessed", label: "Reprocessed" },
              { value: "recovered", label: "Recovered" },
              { value: "not_recoverable", label: "Not recoverable" },
            ],
          },
          dateRangeFilter("rej", "Rejected"),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="sip-rejections" columns={SIP_REJ_COLUMNS} extraFields={extraOptions} prefs={colPrefs} pinFirst={["rejected_on"]} />
            <CustomViews
              viewsKey="views:sip-rejections"
              presets={[
                { id: "open", name: "Open (recovery pending)", params: "recovery=pending,client_contacted,bank_issue,mandate_issue" },
                { id: "breached", name: "SLA breached (>2d)", params: "overdue=1" },
                { id: "recovered", name: "Recovered", params: "recovery=recovered" },
                { id: "this-month", name: "Rejected this month", params: "mtd=1" },
              ]}
            />
          </div>
        }
      />

      <SipRejectionsTable rows={data.rows as any} colOrder={colOrder} extraCols={extraCols} emptyNote={data.feedNote} />
    </div>
  );
}

function ReasonRow({
  label,
  hint,
  value,
  cat,
  active,
  tone,
}: {
  label: string;
  hint: string;
  value: number;
  cat: string;
  active: string;
  tone: "orange" | "amber" | "slate";
}) {
  const dot =
    tone === "orange" ? "bg-brand-cyan" : tone === "amber" ? "bg-amber-500" : "bg-slate-400";
  const isActive = active === cat;
  return (
    <Link
      href={`/dashboard/sip-rejections?reason_cat=${cat}`}
      className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${isActive ? "border-brand-cyan bg-brand-cyan-light/40" : "border-transparent hover:bg-secondary/60"
        }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={`size-2 rounded-full shrink-0 ${dot}`} />
        <span className="truncate">{label}</span>
        <span className="text-2xs text-muted-foreground truncate hidden sm:inline">· {hint}</span>
      </span>
      <span className="text-sm font-bold tabular-nums shrink-0">{value}</span>
    </Link>
  );
}

function AgeBucket({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" }) {
  const color =
    tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-rose-600";
  return (
    <div className="rounded-md bg-secondary/40 py-2">
      <div className={`text-xl font-bold tabular-nums ${value > 0 ? color : "text-muted-foreground"}`}>{value}</div>
      <div className="text-2xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  tone?: "rose" | "amber" | "emerald" | "muted";
  icon?: any;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "emerald"
          ? "text-emerald-600"
          : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
