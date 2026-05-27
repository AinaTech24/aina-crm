import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";
import { withTenant } from "@/db/client";
import { tasks, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";

const priorityColors: Record<string, string> = {
  urgent: "bg-rose-50 text-rose-700",
  high: "bg-amber-50 text-amber-700",
  normal: "bg-blue-50 text-blue-700",
  low: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const priorityFilter = (sp.priority ?? "").split(",").filter(Boolean);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);
  const deptFilter = (sp.department ?? "").split(",").filter(Boolean);

  const result = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [];
    // Default to status=open if none specified
    if (statusFilter.length) {
      conds.push(inArray(tasks.status, statusFilter as any));
    } else {
      conds.push(eq(tasks.status, "open"));
    }
    if (q) {
      conds.push(or(ilike(tasks.title, `%${q}%`), ilike(tasks.description, `%${q}%`))!);
    }
    if (priorityFilter.length) conds.push(inArray(tasks.priority, priorityFilter as any));
    if (typeFilter.length) conds.push(inArray(tasks.type, typeFilter as any));
    if (deptFilter.length) conds.push(inArray(tasks.department, deptFilter as any));
    const where = conds.length ? and(...conds) : undefined;

    const rows = await tx
      .select({ task: tasks, assignee: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(where as any)
      .orderBy(desc(tasks.dueAt))
      .limit(100);

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open')::int AS open,
        COUNT(*) FILTER (WHERE status = 'open' AND due_at::date = current_date)::int AS due_today,
        COUNT(*) FILTER (WHERE status = 'open' AND due_at < now())::int AS overdue,
        COUNT(*) FILTER (WHERE status = 'open' AND sla_due_at IS NOT NULL AND sla_due_at < now() + interval '24 hours')::int AS sla_at_risk
      FROM tasks
    `);
    const s = (stats.rows[0] as any) ?? { open: 0, due_today: 0, overdue: 0, sla_at_risk: 0 };
    return { rows, stats: s };
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground text-sm">
            Most tasks are created by workflows. RMs see only what's assigned to them.
          </p>
        </div>
        <Link
          href="/dashboard/tasks/new"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> New task
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Open" value={String(result.stats.open)} />
        <Stat label="Due today" value={String(result.stats.due_today)} />
        <Stat label="Overdue" value={String(result.stats.overdue)} tone="rose" />
        <Stat label="SLA at risk" value={String(result.stats.sla_at_risk)} tone="amber" />
      </div>

      <FilterBar
        totalCount={result.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by title or description…" },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "open", label: "Open" },
              { value: "in_progress", label: "In progress" },
              { value: "done", label: "Done" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
          {
            type: "multi",
            key: "priority",
            label: "Priority",
            options: [
              { value: "urgent", label: "Urgent" },
              { value: "high", label: "High" },
              { value: "normal", label: "Normal" },
              { value: "low", label: "Low" },
            ],
          },
          {
            type: "multi",
            key: "department",
            label: "Department",
            options: [
              { value: "sales", label: "Sales" },
              { value: "back_office", label: "Back Office" },
              { value: "compliance", label: "Compliance" },
              { value: "marketing", label: "Marketing" },
              { value: "service", label: "Service" },
              { value: "operations", label: "Operations" },
              { value: "rm", label: "Relationship Mgmt" },
              { value: "admin", label: "Admin" },
              { value: "other", label: "Other" },
            ],
          },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:tasks"
            presets={[
              { id: "open", name: "Open tasks", params: "status=open" },
              { id: "urgent", name: "Urgent / High", params: "status=open&priority=urgent,high" },
              { id: "done", name: "Completed", params: "status=done" },
            ]}
          />
        }
      />

      <div className="border rounded-lg bg-card">
        {result.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No open tasks. Workflows will create tasks here automatically when SIPs fail, reviews come due, etc.
          </div>
        ) : (
          <ul className="divide-y">
            {result.rows.map(({ task: t, assignee }) => (
              <li key={t.id} className="px-4 py-3 flex items-center gap-3 hover:bg-accent/40">
                <input type="checkbox" className="size-4 rounded" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{t.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                    <span className="font-mono">{t.type}</span>
                    {t.workflowRunId && <span>· via workflow</span>}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColors[t.priority] ?? ""}`}>
                  {t.priority}
                </span>
                {t.dueAt && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatRelative(t.dueAt)}
                  </span>
                )}
                {assignee && <span className="text-xs">{assignee}</span>}
                <RowActions
                  deleteUrl={`/api/tasks/${t.id}`}
                  itemLabel="task"
                  itemName={t.title}
                  verb="Cancel"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "rose" | "amber" }) {
  const color =
    tone === "rose" && value !== "0"
      ? "text-rose-600"
      : tone === "amber" && value !== "0"
      ? "text-amber-600"
      : "text-foreground";
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
