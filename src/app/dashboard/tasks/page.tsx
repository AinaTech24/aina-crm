import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Plus, ListChecks } from "lucide-react";
import Link from "next/link";
import { withTenant } from "@/db/client";
import { tasks, users, investors, leads } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { FilterBar } from "@/components/common/FilterBar";
import { Pager } from "@/components/common/Pager";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { TaskViewSelect } from "./TaskViewSelect";
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
  // Sort + pagination (list only; the kanban shows a wide unpaged slice).
  // Default = newest-created first (recently added on top). Users can switch to
  // due-date or priority via the Sort dropdown.
  const sortKey = sp.sort === "priority" || sp.sort === "due" ? sp.sort : "created";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const PAGE_SIZE = 50;

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

    // Sort: soonest-due first with undated last (the natural "what's next"), or
    // by priority, or newest-created. Default fixed `due_at DESC` floated undated
    // tasks to the top (Postgres NULLS FIRST) which read backwards.
    const orderByExpr =
      sortKey === "priority"
        ? sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end asc, ${tasks.dueAt} asc nulls last, ${tasks.createdAt} desc`
        : sortKey === "created"
        ? sql`${tasks.createdAt} desc`
        : sql`${tasks.dueAt} asc nulls last, ${tasks.createdAt} desc`;

    // Total matching count (for the pager) — same predicate + join (search hits
    // the assignee name, so the join must be present).
    const totalRow = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(where as any);
    const total = Number(totalRow[0]?.c ?? 0);

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
      .orderBy(orderByExpr)
      .limit(isKanban ? 300 : PAGE_SIZE)
      .offset(isKanban ? 0 : (page - 1) * PAGE_SIZE);

    // Stats ribbon — must honour the SAME scope as the list (View tab, created
    // range, search, priority/department/assignee) so switching "Assigned to
    // me" / "Assigned by me" or applying a filter actually moves the numbers.
    // We deliberately do NOT apply the `status` or `due` params here, because
    // the four cards ARE the open / due-today / overdue / SLA breakdown (each
    // FILTER already pins status = 'open').
    const statsConds: any[] = [eq(tasks.tenantId, session.tenantId)];
    if (!canViewAll) statsConds.push(or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId))!);
    if (view === "to_me") statsConds.push(eq(tasks.assigneeId, session.userId));
    else if (view === "by_me") statsConds.push(eq(tasks.createdById, session.userId));
    if (q) statsConds.push(or(ilike(tasks.title, `%${q}%`), ilike(tasks.description, `%${q}%`))!);
    if (priorityFilter.length) statsConds.push(inArray(tasks.priority, priorityFilter as any));
    if (typeFilter.length) statsConds.push(inArray(tasks.type, typeFilter as any));
    if (deptFilter.length) statsConds.push(inArray(tasks.department, deptFilter as any));
    if (assigneeFilter.length) statsConds.push(inArray(tasks.assigneeId, assigneeFilter as any));
    const statsDr = dateRangeCond(sp, "created", "tasks.created_at");
    if (statsDr) statsConds.push(statsDr);

    // No join here, so the bare column names inside the FILTERs (status, due_at,
    // sla_due_at) are unambiguously tasks columns (users also has a `status`).
    const statsRow = await tx
      .select({
        open: sql<number>`count(*) filter (where status = 'open')::int`,
        due_today: sql<number>`count(*) filter (where status = 'open' and due_at::date = current_date)::int`,
        overdue: sql<number>`count(*) filter (where status = 'open' and due_at < now())::int`,
        sla_at_risk: sql<number>`count(*) filter (where status = 'open' and sla_due_at is not null and sla_due_at < now() + interval '24 hours')::int`,
      })
      .from(tasks)
      .where(and(...statsConds) as any);

    const s = (statsRow[0] as any) ?? { open: 0, due_today: 0, overdue: 0, sla_at_risk: 0 };
    // Roster for the "Assignee" filter (so owners can see tasks by RM).
    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name ASC
    `);
    return { rows, stats: s, rms: rmRows.rows as any[], total };
  });

  const rmOptions = (result.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));
  // Keep the active View tab when a stat card is clicked, so the cards and the
  // list it filters stay in the same scope.
  const scopeQS = view === "to_me" ? "&view=to_me" : view === "by_me" ? "&view=by_me" : "";

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

      {/* View switcher — custom dropdown (list / mine / assigned-by-me / kanban) */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">View</span>
        <TaskViewSelect current={view} />
      </div>

      {/* Clickable Interactive Stats Ribbon */}
      <div className="grid grid-cols-4 gap-3">
        <Link href={`/dashboard/tasks?status=open${scopeQS}`} className="block transition-transform hover:scale-[1.01]">
          <Stat label="Open" value={String(result.stats.open)} active={!due && sp.status !== "completed" && sp.status !== "cancelled"} />
        </Link>
        <Link href={`/dashboard/tasks?status=open&due=today${scopeQS}`} className="block transition-transform hover:scale-[1.01]">
          <Stat label="Due today" value={String(result.stats.due_today)} active={due === "today"} />
        </Link>
        <Link href={`/dashboard/tasks?status=open&due=overdue${scopeQS}`} className="block transition-transform hover:scale-[1.01]">
          <Stat label="Overdue" value={String(result.stats.overdue)} tone="rose" active={due === "overdue"} />
        </Link>
        <Link href={`/dashboard/tasks?status=open&due=sla_risk${scopeQS}`} className="block transition-transform hover:scale-[1.01]">
          <Stat label="SLA at risk" value={String(result.stats.sla_at_risk)} tone="amber" active={due === "sla_risk"} />
        </Link>
      </div>

      <FilterBar
        totalCount={result.total}
        filters={[
          { type: "search", key: "q", placeholder: "Search by title or description…" },
          ...(!isKanban
            ? [{
                type: "select" as const,
                key: "sort",
                label: "Sort",
                options: [
                  { value: "created", label: "Newest first" },
                  { value: "due", label: "Due date" },
                  { value: "priority", label: "Priority" },
                ],
              }]
            : []),
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
            // Values MUST match the schema enum, else the filter matches nothing.
            options: [
              { value: "sales", label: "Sales" },
              { value: "operations", label: "Operations" },
              { value: "back_office", label: "Back Office" },
              { value: "compliance", label: "Compliance" },
              { value: "marketing", label: "Marketing" },
              { value: "advisory", label: "Advisory" },
              { value: "support", label: "Support" },
              { value: "leadership", label: "Leadership" },
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
              { id: "done", name: "Completed", params: "status=completed" },
            ]}
          />
        }
      />

      {/* Status-column board, or the interactive list + detail drawer */}
      {isKanban ? (
        <TaskKanban initialRows={result.rows} currentUserId={session.userId} />
      ) : (
        <div>
          <TaskList initialRows={result.rows} currentUserId={session.userId} />
          <Pager page={page} totalPages={Math.ceil(result.total / PAGE_SIZE)} total={result.total} pageSize={PAGE_SIZE} />
        </div>
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
