import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Plus, ListChecks } from "lucide-react";
import Link from "next/link";
import { withTenant } from "@/db/client";
import { tasks, users, investors, leads } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { FilterBar } from "@/components/common/FilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { TaskList } from "./TaskList";
import { TaskKanban } from "./TaskKanban";
import { WorkSwitcher } from "@/components/layout/WorkSwitcher";

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
  const assigneeFilter = (sp.assignee ?? "").split(",").filter(Boolean);
  const due = sp.due; // 'today' | 'overdue' | 'sla_risk'
  // View tabs: "" (all) | "to_me" (assigned to me) | "by_me" (I assigned) | "kanban".
  const view = sp.view ?? "";
  const isKanban = view === "kanban";

  // Users with task.view.all see the whole firm; everyone else (RM, team
  // member) sees only what they're assigned to or created — matching the
  // matrix (and the subtitle promise).
  const canViewAll = can(session.roles, "task.view.all", session.permissions);

  const result = await withTenant(session.tenantId, async (tx) => {
    // Tenant predicate is mandatory under the superuser/RLS-bypass model.
    const conds: any[] = [eq(tasks.tenantId, session.tenantId)];
    if (!canViewAll) {
      conds.push(or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId))!);
    }

    // View-tab scope: tasks assigned TO me, or tasks I assigned (created).
    if (view === "to_me") conds.push(eq(tasks.assigneeId, session.userId));
    else if (view === "by_me") conds.push(eq(tasks.createdById, session.userId));

    // Status: an explicit filter always wins. Otherwise default the LIST to open
    // tasks, but the KANBAN shows every status so each column populates.
    if (statusFilter.length) {
      conds.push(inArray(tasks.status, statusFilter as any));
    } else if (!isKanban) {
      conds.push(eq(tasks.status, "open"));
    }
    
    if (q) {
      conds.push(or(ilike(tasks.title, `%${q}%`), ilike(tasks.description, `%${q}%`), ilike(users.name, `%${q}%`))!);
    }
    if (priorityFilter.length) conds.push(inArray(tasks.priority, priorityFilter as any));
    if (typeFilter.length) conds.push(inArray(tasks.type, typeFilter as any));
    if (deptFilter.length) conds.push(inArray(tasks.department, deptFilter as any));
    if (assigneeFilter.length) conds.push(inArray(tasks.assigneeId, assigneeFilter as any));
    
    // Apply stats ribbon parameters
    if (due === "today") {
      conds.push(sql`due_at::date = current_date`);
    } else if (due === "overdue") {
      conds.push(sql`due_at < now()`);
    } else if (due === "sla_risk") {
      conds.push(sql`sla_due_at IS NOT NULL AND sla_due_at < now() + interval '24 hours'`);
    }
    const dr = dateRangeCond(sp, "created", "tasks.created_at");
    if (dr) conds.push(dr);

    const where = conds.length ? and(...conds) : undefined;

    // Join related entity profiles (Client/Investor and Lead)
    const rows = await tx
      .select({
        task: tasks,
        assignee: users.name,
        investorName: investors.name,
        leadName: leads.name,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(investors, eq(investors.id, tasks.relatedInvestorId))
      .leftJoin(leads, eq(leads.id, tasks.relatedLeadId))
      .where(where as any)
      .orderBy(desc(tasks.dueAt))
      .limit(isKanban ? 300 : 100);

    const viewScope = canViewAll
      ? sql``
      : sql` AND (assignee_id = ${session.userId}::uuid OR created_by_id = ${session.userId}::uuid)`;
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open')::int AS open,
        COUNT(*) FILTER (WHERE status = 'open' AND due_at::date = current_date)::int AS due_today,
        COUNT(*) FILTER (WHERE status = 'open' AND due_at < now())::int AS overdue,
        COUNT(*) FILTER (WHERE status = 'open' AND sla_due_at IS NOT NULL AND sla_due_at < now() + interval '24 hours')::int AS sla_at_risk
      FROM tasks
      WHERE tenant_id = ${session.tenantId}::uuid${viewScope}
    `);
    
    const s = (stats.rows[0] as any) ?? { open: 0, due_today: 0, overdue: 0, sla_at_risk: 0 };
    // Roster for the "Assignee" filter (so owners can see tasks by RM).
    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name ASC
    `);
    return { rows, stats: s, rms: rmRows.rows as any[] };
  });

  const rmOptions = (result.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ListChecks className="size-6 text-brand-cyan" /> Tasks
          </h1>
          <p className="text-muted-foreground text-sm">
            Most tasks are created by workflows. RMs see only what's assigned to them.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <WorkSwitcher current="/dashboard/tasks" />
          <Link
            href="/dashboard/tasks/new"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> New task
          </Link>
        </div>
      </div>

      {/* View tabs — list / mine / assigned-by-me / kanban board */}
      <div className="flex items-center gap-1 border-b border-border -mb-2 overflow-x-auto">
        {[
          { key: "", label: "All tasks" },
          { key: "to_me", label: "Assigned to me" },
          { key: "by_me", label: "Assigned by me" },
          { key: "kanban", label: "Kanban board" },
        ].map((t) => {
          const active = view === t.key;
          return (
            <Link
              key={t.key || "all"}
              href={t.key ? `/dashboard/tasks?view=${t.key}` : "/dashboard/tasks"}
              className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {/* Clickable Interactive Stats Ribbon */}
      <div className="grid grid-cols-4 gap-3">
        <Link href="/dashboard/tasks?status=open" className="block transition-transform hover:scale-[1.01]">
          <Stat label="Open" value={String(result.stats.open)} active={!due && sp.status !== "done" && sp.status !== "cancelled"} />
        </Link>
        <Link href="/dashboard/tasks?status=open&due=today" className="block transition-transform hover:scale-[1.01]">
          <Stat label="Due today" value={String(result.stats.due_today)} active={due === "today"} />
        </Link>
        <Link href="/dashboard/tasks?status=open&due=overdue" className="block transition-transform hover:scale-[1.01]">
          <Stat label="Overdue" value={String(result.stats.overdue)} tone="rose" active={due === "overdue"} />
        </Link>
        <Link href="/dashboard/tasks?status=open&due=sla_risk" className="block transition-transform hover:scale-[1.01]">
          <Stat label="SLA at risk" value={String(result.stats.sla_at_risk)} tone="amber" active={due === "sla_risk"} />
        </Link>
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
              { value: "blocked", label: "Blocked" },
              { value: "completed", label: "Completed" },
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
          ...(canViewAll && rmOptions.length
            ? [{ type: "multi" as const, key: "assignee", label: "Assignee", options: rmOptions }]
            : []),
          dateRangeFilter("created", "Created"),
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

      {/* Status-column board, or the interactive list + detail drawer */}
      {isKanban ? (
        <TaskKanban initialRows={result.rows} currentUserId={session.userId} />
      ) : (
        <TaskList initialRows={result.rows} currentUserId={session.userId} />
      )}
    </div>
  );
}

function Stat({ label, value, tone, active }: { label: string; value: string; tone?: "rose" | "amber"; active?: boolean }) {
  const color =
    tone === "rose" && value !== "0"
      ? "text-rose-600 font-bold"
      : tone === "amber" && value !== "0"
      ? "text-amber-600 font-bold"
      : "text-foreground";
  return (
    <div className={`border rounded-lg p-4 bg-card transition-all ${
      active 
        ? "border-primary bg-slate-50 ring-1 ring-primary/45 shadow-sm" 
        : "hover:border-slate-300 bg-white"
    }`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
