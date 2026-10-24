/**
 * My Operations Manual — the SOPs that apply to ME (The E-Myth Revisited:
 * the manual is the position's, and each holder reads their part).
 *
 * Open to every signed-in member of staff. Shows the positions you hold
 * (purpose and results), then every live SOP that reaches you:
 *   - linked to one of your positions;
 *   - linked to a process one of your positions owns (practice_process_settings,
 *     else the process's default owner);
 *   - linked to a task type or template you have open tasks of;
 *   - required for one of your roles (sops.required_roles).
 * Each has "I have read this" (POST /api/sops/:id/acknowledge, the current
 * version). Managers (canViewPractice) also see Coverage: the task and
 * service-request types of the last 90 days that no SOP covers yet.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { BookOpen } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { PracticeNav } from "@/components/practice/PracticeNav";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { InlineEmpty } from "@/components/common/EmptyState";
import { SopMarkdown } from "@/components/practice/HowWeDoThisMarkdown";
import { ManualAckButton } from "@/components/practice/ManualAckButton";
import { canViewPractice } from "@/lib/practice/access";
import { PRACTICE_PROCESSES } from "@/lib/practice/catalog";
import {
  linkTargetLabel, linkedSopsFor, loadLinkLabelNames, processesOwnedBy, srTypeLabel, taskTypeLabel,
  templateIdFromMeta, type SopTarget,
} from "@/lib/practice/sop-links";

export const dynamic = "force-dynamic";

type ManualSop = {
  sopId: string;
  title: string;
  category: string | null;
  versionId: string;
  versionNumber: string;
  markdown: string;
  reasons: string[];
  acknowledgedAt: string | null;
};

export default async function MyOperationsManualPage() {
  const session = await requireSession();
  const isManager = canViewPractice(session);
  const tid = session.tenantId;

  const data = await withTenant(tid, async (tx) => {
    const positions = (await tx.execute(sql`
      SELECT p.id, p.key, p.title, p.purpose, p.results
        FROM practice_position_holders h
        JOIN practice_positions p ON p.id = h.position_id AND p.tenant_id = h.tenant_id
       WHERE h.tenant_id = ${tid}::uuid AND h.user_id = ${session.userId}::uuid
       ORDER BY p.sort, p.title
    `)).rows as Array<{ id: string; key: string; title: string; purpose: string | null; results: string[] | null }>;

    const ownedProcesses = await processesOwnedBy(tx, tid, positions);

    const openTasks = (await tx.execute(sql`
      SELECT type, meta FROM tasks
       WHERE tenant_id = ${tid}::uuid AND assignee_id = ${session.userId}::uuid
         AND status IN ('open', 'in_progress', 'blocked') AND deleted_at IS NULL
    `)).rows as Array<{ type: string; meta: unknown }>;

    const targets: SopTarget[] = [
      ...positions.map((p) => ({ kind: "position" as const, key: p.id })),
      ...ownedProcesses.map((k) => ({ kind: "process" as const, key: k })),
      ...[...new Set(openTasks.map((t) => t.type))].map((k) => ({ kind: "task_type" as const, key: k })),
      ...[...new Set(openTasks.map((t) => templateIdFromMeta(t.meta)).filter((x): x is string => !!x))].map((k) => ({
        kind: "task_template" as const,
        key: k,
      })),
    ];
    const linked = await linkedSopsFor(tx, tid, targets);
    const names = await loadLinkLabelNames(tx, tid);

    const byRole = session.roles.length
      ? ((await tx.execute(sql`
          SELECT s.id AS sop_id, s.title, s.category, v.id AS version_id, v.version_number,
                 COALESCE(v.body->>'markdown', '') AS markdown, s.required_roles
            FROM sops s
            JOIN sop_versions v ON v.id = s.current_version_id AND v.tenant_id = s.tenant_id
           WHERE s.tenant_id = ${tid}::uuid AND s.deleted_at IS NULL
             AND s.required_roles && ARRAY[${sql.join(session.roles.map((r) => sql`${r}`), sql`, `)}]::text[]
        `)).rows as Array<{
          sop_id: string; title: string; category: string | null; version_id: string;
          version_number: number | string; markdown: string | null; required_roles: string[] | null;
        }>)
      : [];

    const sops = new Map<string, ManualSop>();
    for (const s of linked) {
      sops.set(s.sopId, {
        sopId: s.sopId,
        title: s.title,
        category: s.category,
        versionId: s.versionId,
        versionNumber: s.versionNumber,
        markdown: s.markdown,
        reasons: s.matched.map((m) => linkTargetLabel(m.kind, m.key, names)),
        acknowledgedAt: null,
      });
    }
    for (const r of byRole) {
      const mine = ((r.required_roles ?? []) as string[]).filter((x) => session.roles.includes(x));
      const reason = `Required for your role${mine.length > 1 ? "s" : ""}: ${mine.join(", ")}`;
      const existing = sops.get(r.sop_id);
      if (existing) existing.reasons.push(reason);
      else {
        sops.set(r.sop_id, {
          sopId: r.sop_id,
          title: r.title,
          category: r.category ?? null,
          versionId: r.version_id,
          versionNumber: String(r.version_number),
          markdown: r.markdown ?? "",
          reasons: [reason],
          acknowledgedAt: null,
        });
      }
    }

    const versionIds = [...sops.values()].map((s) => s.versionId);
    if (versionIds.length) {
      const acks = (await tx.execute(sql`
        SELECT sop_version_id, acknowledged_at FROM sop_acknowledgements
         WHERE tenant_id = ${tid}::uuid AND user_id = ${session.userId}::uuid
           AND sop_version_id IN (${sql.join(versionIds.map((v) => sql`${v}::uuid`), sql`, `)})
      `)).rows as Array<{ sop_version_id: string; acknowledged_at: string | Date }>;
      const at = new Map(acks.map((a) => [a.sop_version_id, new Date(a.acknowledged_at).toISOString()]));
      for (const s of sops.values()) s.acknowledgedAt = at.get(s.versionId) ?? null;
    }

    // ── Coverage (managers) ──
    let coverage: { taskTypes: Array<{ key: string; n: number }>; srTypes: Array<{ key: string; n: number }> } | null = null;
    if (isManager) {
      const live = (await tx.execute(sql`
        SELECT DISTINCT l.target_kind, l.target_key
          FROM sop_links l
          JOIN sops s ON s.id = l.sop_id AND s.tenant_id = l.tenant_id
         WHERE l.tenant_id = ${tid}::uuid AND s.deleted_at IS NULL AND s.current_version_id IS NOT NULL
           AND l.target_kind IN ('task_type', 'sr_type', 'process')
      `)).rows as Array<{ target_kind: string; target_key: string }>;
      const coveredTask = new Set<string>();
      const coveredSr = new Set<string>();
      for (const l of live) {
        if (l.target_kind === "task_type") coveredTask.add(l.target_key);
        else if (l.target_kind === "sr_type") coveredSr.add(l.target_key);
        else {
          const p = PRACTICE_PROCESSES.find((x) => x.key === l.target_key);
          for (const t of p?.taskTypes ?? []) coveredTask.add(t);
          for (const t of p?.srTypes ?? []) coveredSr.add(t);
          if (l.target_key === "complaints") coveredSr.add("complaint");
        }
      }
      const taskCounts = (await tx.execute(sql`
        SELECT type AS key, count(*)::int AS n FROM tasks
         WHERE tenant_id = ${tid}::uuid AND deleted_at IS NULL AND created_at >= now() - interval '90 days'
         GROUP BY type ORDER BY n DESC, type
      `)).rows as Array<{ key: string; n: number }>;
      const srCounts = (await tx.execute(sql`
        SELECT type AS key, count(*)::int AS n FROM service_requests
         WHERE tenant_id = ${tid}::uuid AND created_at >= now() - interval '90 days'
         GROUP BY type ORDER BY n DESC, type
      `)).rows as Array<{ key: string; n: number }>;
      coverage = {
        taskTypes: taskCounts.filter((r) => r.key && !coveredTask.has(r.key)),
        srTypes: srCounts.filter((r) => r.key && !coveredSr.has(r.key)),
      };
    }

    return { positions, sops: [...sops.values()], coverage, srNames: names.srTypes };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  // Unread first, then by title.
  const sops = data.sops.sort(
    (a, b) => Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt) || a.title.localeCompare(b.title)
  );
  const unread = sops.filter((s) => !s.acknowledgedAt).length;

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeaderCard
        title="My Operations Manual"
        subtitle="How we do the work your positions answer for — read each one, then say so."
        breadcrumb={isManager ? [{ label: "Practice", href: "/dashboard/practice" }, { label: "My operations manual" }] : [{ label: "My operations manual" }]}
      />
      {isManager && <PracticeNav active="manual" />}

      <Card>
        <CardHeader title="Your positions" subtitle="The jobs you fill in this firm, and what each one answers for." />
        <CardBody>
          {data.positions.length === 0 ? (
            <InlineEmpty message="You do not hold a position yet. The owner assigns positions under Practice → Positions." />
          ) : (
            <ul className="space-y-3">
              {data.positions.map((p) => (
                <li key={p.id} className="rounded-md bg-secondary/70 p-3">
                  <p className="font-semibold">{p.title}</p>
                  {p.purpose && <p className="text-sm text-muted-foreground mt-0.5">{p.purpose}</p>}
                  {(p.results ?? []).length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-sm space-y-0.5">
                      {(p.results ?? []).map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="SOPs that apply to you"
          subtitle={
            sops.length
              ? unread
                ? `${unread} of ${sops.length} still to read.`
                : `All ${sops.length} read.`
              : undefined
          }
          action={
            <Link href="/dashboard/sops" className="text-sm text-primary hover:underline">
              Whole manual
            </Link>
          }
        />
        <CardBody>
          {sops.length === 0 ? (
            <InlineEmpty
              icon={BookOpen}
              message="No SOP is attached to your positions, processes or open work yet."
              action={{ href: "/dashboard/sops", label: "Browse the operations manual" }}
            />
          ) : (
            <ul className="space-y-3">
              {sops.map((s) => (
                <li key={s.sopId} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/dashboard/sops/${s.sopId}`} className="font-semibold hover:underline">
                        {s.title}
                      </Link>
                      <span className="ml-2 text-2xs text-muted-foreground">v{s.versionNumber}</span>
                      {s.category && <Badge className="ml-2">{s.category}</Badge>}
                      <p className="mt-1 text-xs text-muted-foreground">{s.reasons.join(" · ")}</p>
                    </div>
                    <ManualAckButton sopId={s.sopId} acknowledgedAt={s.acknowledgedAt} />
                  </div>
                  {s.markdown.trim() && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-primary min-h-6">Read it here</summary>
                      <div className="mt-2">
                        <SopMarkdown markdown={s.markdown} />
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {data.coverage && (
        <Card>
          <CardHeader
            title="Coverage"
            subtitle="Work the firm did in the last 90 days that no SOP says how to do, most frequent first."
          />
          <CardBody className="grid gap-6 md:grid-cols-2">
            <CoverageList
              title="Task types"
              rows={data.coverage.taskTypes.map((r) => ({ label: taskTypeLabel(r.key), n: r.n }))}
              empty="Every task type of the last 90 days has an SOP."
            />
            <CoverageList
              title="Service request types"
              rows={data.coverage.srTypes.map((r) => ({ label: srTypeLabel(r.key, data.srNames), n: r.n }))}
              empty="Every service request type of the last 90 days has an SOP."
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function CoverageList({ title, rows, empty }: { title: string; rows: Array<{ label: string; n: number }>; empty: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {rows.length === 0 ? (
        <InlineEmpty message={empty} />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.label} className="flex min-h-10 items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0">
                {r.label} <span className="text-muted-foreground">· {r.n}</span>
              </span>
              <Link href="/dashboard/sops/new" className="text-xs text-primary hover:underline shrink-0">
                Write an SOP for this
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
