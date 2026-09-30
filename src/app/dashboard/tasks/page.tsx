import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Plus, ListChecks } from "lucide-react";
import Link from "next/link";
import { withTenant } from "@/db/client";
import { tasks, users, investors, leads } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { Pager } from "@/components/common/Pager";
import { dateRangeCond } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { TaskViewSelect } from "./TaskViewSelect";
import { TaskList } from "./TaskList";
import { TaskKanban } from "./TaskKanban";
import { buttonClass } from "@/components/ui/button-class";
import { overdueTaskSql, staffWhere } from "@/lib/metrics";

export const dynamic = "force-dynamic";

// Aliased users join to resolve the task creator's name ("assigned by").
const taskCreator = alias(users, "task_creator");

/** Statuses that are still somebody's work. */
const OPEN_STATUSES = ["open", "in_progress", "blocked"] as const;
type Tab = "" | "overdue" | "today" | "upcoming" | "completed";

// Day boundaries in India time. The database runs in UTC, so a bare
// current_date turns over at 05:30 IST and a task due at 9am shows as
// "tomorrow" for the first five and a half hours of the day.
const IST_TODAY = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const DUE_DAY = sql`(${tasks.dueAt} AT TIME ZONE 'Asia/Kolkata')::date`;

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
  // branch — the dashboard's tasks link for a branch: tasks assigned to someone
  // in it (tasks are a staff fact — lib/metrics staffWhere).
  const branchFilter = (sp.branch ?? "").split(",").filter(Boolean);
  const tagsFilter = (sp.tags ?? "").split(",").filter(Boolean);
  const flagFilter = (sp.flag ?? "").split(",").filter(Boolean);
  // Due filter — CSV multi-select: today | overdue | sla_risk
  const dueFilter = (sp.due ?? "").split(",").filter(Boolean);
  const approval = sp.approval ?? ""; // '' | 'pending' | 'mine' (awaiting sign-off)
  // Quick tab — WHEN: overdue (past its due time), today (due later today),
  // upcoming (due after today), completed. No tab = everything still open.
  const tab: Tab = (["overdue", "today", "upcoming", "completed"] as const).includes(sp.tab as any)
    ? (sp.tab as Tab)
    : "";
  // Scope and layout are independent axes, so a kanban can be scoped to "my
  // tasks" too. They used to share `?view=`, which made kanban a fourth tab and
  // therefore mutually exclusive with the scope tabs.
  //   ?view=   "" (all) | "to_me" (assigned to me) | "by_me" (I assigned)
  //   ?layout= "" (list) | "kanban"
  // Legacy `?view=kanban` links (bookmarks, saved views) still work: they map
  // to the all-tasks scope on the board layout.
  const rawView = sp.view ?? "";
  const legacyKanban = rawView === "kanban";
  const view = legacyKanban ? "" : rawView;
  const layout = legacyKanban || sp.layout === "kanban" ? "kanban" : "list";
  const isKanban = layout === "kanban";
  // Sort + pagination (list only; the kanban shows a wide unpaged slice).
  // Sort key carries its own direction (asc/desc) so the dropdown can offer both
  // without a separate dir param. Default = overdue first, then soonest due:
  // the order the work has to be done in. (It was newest-created first, which
  // put this morning's automation reminders above a task three days late.)
  const SORTS = ["smart", "created", "created_asc", "due", "due_desc", "priority", "title_asc", "title_desc"] as const;
  const sortKey: (typeof SORTS)[number] = SORTS.includes((sp.sort ?? "") as any)
    ? (sp.sort as (typeof SORTS)[number])
    : "smart";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const PAGE_SIZE = 50;

  // Users with task.view.all see the whole firm; everyone else (RM, team
  // member) sees only what they're assigned to or created — matching the
  // matrix (and the subtitle promise).
  const canViewAll = can(session.roles, "task.view.all", session.permissions);

  const result = await withTenant(session.tenantId, async (tx) => {
    // Tenant predicate is mandatory under the superuser/RLS-bypass model.
    // Trashed (soft-deleted) tasks never appear in any list — only in Trash.
    const conds: any[] = [eq(tasks.tenantId, session.tenantId), isNull(tasks.deletedAt)];
    if (!canViewAll) {
      conds.push(or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId))!);
    }

    // View-tab scope: tasks assigned TO me, or tasks I assigned (created).
    if (view === "to_me") conds.push(eq(tasks.assigneeId, session.userId));
    else if (view === "by_me") conds.push(eq(tasks.createdById, session.userId));

    // Status and the quick tabs apply to the LIST only — the KANBAN's columns
    // ARE the status dimension, so it must show every status (otherwise a
    // lingering status=open from a stat-card click collapses the board to one
    // column). The tab conditions are kept apart so the Overdue count can be
    // taken over everything else the user has filtered by.
    const tabConds: any[] = [];
    if (!isKanban) {
      if (tab === "completed") tabConds.push(eq(tasks.status, "completed"));
      // Overdue — the dashboard's overdue-tasks count and the sidebar badge:
      // not deleted, still to do, due before now (lib/metrics overdueTaskSql).
      else if (tab === "overdue") tabConds.push(overdueTaskSql("tasks"));
      else if (tab) tabConds.push(inArray(tasks.status, [...OPEN_STATUSES]));
      if (tab === "today") tabConds.push(sql`${tasks.dueAt} >= now() AND ${DUE_DAY} = ${IST_TODAY}`);
      if (tab === "upcoming") tabConds.push(sql`${DUE_DAY} > ${IST_TODAY}`);
      if (statusFilter.length) {
        conds.push(inArray(tasks.status, statusFilter as any));
      } else if (!tab && !approval) {
        // Default: everything still open — in progress and blocked included,
        // they are work too (this used to mean status = 'open' only). Not when
        // filtering by approval, where pending tasks are usually in progress.
        conds.push(inArray(tasks.status, [...OPEN_STATUSES]));
      }
    }
    // Awaiting sign-off. 'pending' = any; 'mine' = ones this user approves.
    if (approval === "pending") conds.push(eq(tasks.approvalStatus, "pending"));
    else if (approval === "mine") {
      conds.push(eq(tasks.approvalStatus, "pending"));
      if (!canViewAll) conds.push(eq(tasks.createdById, session.userId));
    }

    if (q) {
      conds.push(or(ilike(tasks.title, `%${q}%`), ilike(tasks.description, `%${q}%`), ilike(users.name, `%${q}%`))!);
    }
    if (priorityFilter.length) conds.push(inArray(tasks.priority, priorityFilter as any));
    if (typeFilter.length) conds.push(inArray(tasks.type, typeFilter as any));
    if (deptFilter.length) conds.push(inArray(tasks.department, deptFilter as any));
    // assignee — user ids, comma-separated (the dashboard's RM filter).
    if (assigneeFilter.length) conds.push(inArray(tasks.assigneeId, assigneeFilter as any));
    if (branchFilter.length) {
      conds.push(staffWhere({ tenantId: session.tenantId, branchIds: branchFilter }, sql`${tasks.assigneeId}`));
    }
    if (tagsFilter.length) conds.push(sql`tasks.tags ?| ${tagsFilter}::text[]`);
    if (flagFilter.includes("requires_approval")) conds.push(eq(tasks.requiresApproval, true));
    if (flagFilter.includes("recurring")) conds.push(sql`tasks.recurrence is not null`);
    if (flagFilter.includes("has_attachments"))
      conds.push(sql`EXISTS (SELECT 1 FROM task_attachments a WHERE a.task_id = tasks.id AND a.deleted_at IS NULL)`);
    const dueDr = dateRangeCond(sp, "due", "tasks.due_at");
    if (dueDr) conds.push(dueDr);

    // Due filter — multi-select, OR'd together (today / overdue / SLA at risk).
    if (dueFilter.length) {
      const dueConds: any[] = [];
      if (dueFilter.includes("today")) dueConds.push(sql`due_at::date = current_date`);
      if (dueFilter.includes("overdue")) dueConds.push(sql`due_at < now()`);
      if (dueFilter.includes("sla_risk")) dueConds.push(sql`sla_due_at IS NOT NULL AND sla_due_at < now() + interval '24 hours'`);
      if (dueConds.length) conds.push(dueConds.length === 1 ? dueConds[0] : or(...dueConds)!);
    }
    const dr = dateRangeCond(sp, "created", "tasks.created_at");
    if (dr) conds.push(dr);

    // Overdue (n) on its tab: every other filter the user set, tab aside.
    const overdueRow = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(...conds, overdueTaskSql("tasks")) as any);
    const overdueCount = Number(overdueRow[0]?.c ?? 0);

    conds.push(...tabConds);
    const where = conds.length ? and(...conds) : undefined;

    // Sort: soonest-due first with undated last (the natural "what's next"), or
    // by priority, or newest-created. Default fixed `due_at DESC` floated undated
    // tasks to the top (Postgres NULLS FIRST) which read backwards.
    const orderByExpr =
      sortKey === "smart"
        ? tab === "completed"
          ? sql`${tasks.completedAt} desc nulls last, ${tasks.updatedAt} desc` // most recently finished first
          : sql`case when ${tasks.dueAt} < now() and ${tasks.status} in ('open','in_progress','blocked') then 0 else 1 end asc, ${tasks.dueAt} asc nulls last, ${tasks.createdAt} desc`
        : sortKey === "priority"
        ? sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end asc, ${tasks.dueAt} asc nulls last, ${tasks.createdAt} desc`
        : sortKey === "created"
        ? sql`${tasks.createdAt} desc`
        : sortKey === "created_asc"
        ? sql`${tasks.createdAt} asc`
        : sortKey === "due_desc"
        ? sql`${tasks.dueAt} desc nulls last, ${tasks.createdAt} desc`
        : sortKey === "title_asc"
        ? sql`lower(${tasks.title}) asc`
        : sortKey === "title_desc"
        ? sql`lower(${tasks.title}) desc`
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
        createdBy: taskCreator.name,
        // The record the task is about: the explicit related_* link, else the
        // older subject_type / subject_id pair that workflows still write.
        investorId: investors.id,
        investorName: investors.name,
        investorAvatarUrl: investors.avatarUrl,
        leadId: leads.id,
        leadName: leads.name,
        leadAvatarUrl: leads.avatarUrl,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(taskCreator, eq(taskCreator.id, tasks.createdById))
      .leftJoin(
        investors,
        eq(investors.id, sql`coalesce(${tasks.relatedInvestorId}, case when ${tasks.subjectType} = 'investor' then ${tasks.subjectId} end)`)
      )
      .leftJoin(
        leads,
        eq(leads.id, sql`coalesce(${tasks.relatedLeadId}, case when ${tasks.subjectType} = 'lead' then ${tasks.subjectId} end)`)
      )
      .where(where as any)
      .orderBy(orderByExpr)
      .limit(isKanban ? 300 : PAGE_SIZE)
      .offset(isKanban ? 0 : (page - 1) * PAGE_SIZE);

    // Roster for the "Assignee" filter (so owners can see tasks by RM).
    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name ASC
    `);
    // Distinct tags in use — powers the Tags filter dropdown.
    const tagRows = await tx.execute(sql`
      SELECT DISTINCT jsonb_array_elements_text(tags) AS tag
      FROM tasks
      WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL
        AND tags IS NOT NULL AND jsonb_typeof(tags) = 'array'
      ORDER BY tag ASC
      LIMIT 100
    `);
    return { rows, rms: rmRows.rows as any[], total, tags: tagRows.rows as any[], overdueCount };
  });

  const rmOptions = (result.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));
  const tagOptions = (result.tags ?? []).map((t: any) => ({ value: String(t.tag), label: String(t.tag) }));

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeaderCard
        title={<><ListChecks className="size-6 text-muted-foreground" /> Tasks</>}
        subtitle={<>Everything your team has to do — assigned, due-dated and tracked to done.</>}
        actions={
          <Link href="/dashboard/tasks/new" className={buttonClass("primary")}>
            <Plus className="size-4" /> New task
          </Link>
        }
      />

      {/* When (quick tabs) · whose (dropdown) · how (List / Board). */}
      <TaskViewSelect current={view} layout={layout} tab={tab} overdueCount={result.overdueCount} />

      {/* Search + filter + sort + view — rendered inside the table header (list)
          or above the board (kanban). */}
      {(() => {
        const toolbar = (
      <CompactFilterBar
        bare
        searchPlaceholder="Search by title or description…"
        sort={
          !isKanban
            ? {
                key: "sort",
                options: [
                  { value: "smart", label: "Overdue first, then due date" },
                  { value: "created", label: "Newest first" },
                  { value: "created_asc", label: "Oldest first" },
                  { value: "title_asc", label: "Title A–Z" },
                  { value: "title_desc", label: "Title Z–A" },
                  { value: "due", label: "Due date — soonest" },
                  { value: "due_desc", label: "Due date — latest" },
                  { value: "priority", label: "Priority — high first" },
                ],
              }
            : undefined
        }
        filters={[
          // Status is hidden on the kanban — the columns already ARE the statuses.
          ...(!isKanban
            ? [{
                type: "multi" as const,
                key: "status",
                label: "Status",
                options: [
                  { value: "open", label: "Open" },
                  { value: "in_progress", label: "In progress" },
                  { value: "blocked", label: "Blocked" },
                  { value: "completed", label: "Completed" },
                  { value: "cancelled", label: "Cancelled" },
                ],
              }]
            : []),
          {
            type: "multi" as const,
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
            type: "multi" as const,
            key: "due",
            label: "Due",
            options: [
              { value: "today", label: "Due today" },
              { value: "overdue", label: "Overdue" },
              { value: "sla_risk", label: "SLA at risk" },
            ],
          },
          {
            type: "multi" as const,
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
          {
            type: "multi" as const,
            key: "flag",
            label: "Flags",
            options: [
              { value: "requires_approval", label: "Requires approval" },
              { value: "recurring", label: "Recurring" },
              { value: "has_attachments", label: "Has attachments" },
            ],
          },
          ...(tagOptions.length ? [{ type: "multi" as const, key: "tags", label: "Tags", options: tagOptions }] : []),
          { type: "date_range" as const, key: "created", label: "Created date" },
          { type: "date_range" as const, key: "due", label: "Due date" },
        ]}
        rightSlot={
          <CustomViews
            compact
            viewsKey="views:tasks"
            presets={[
              { id: "open", name: "Open tasks", params: "status=open" },
              { id: "urgent", name: "Urgent / High", params: "status=open&priority=urgent,high" },
              { id: "approval", name: "Awaiting my approval", params: "approval=mine" },
              { id: "done", name: "Completed", params: "status=completed" },
            ]}
          />
        }
      />
        );
        return isKanban ? (
          <>
            <div className="card-surface p-2.5">{toolbar}</div>
            <TaskKanban initialRows={result.rows} currentUserId={session.userId} canManageAll={canViewAll} />
          </>
        ) : (
          <div>
            <TaskList initialRows={result.rows} currentUserId={session.userId} canManageAll={canViewAll} initialOpenTaskId={sp.task} total={result.total} toolbar={toolbar} />
            <Pager page={page} totalPages={Math.ceil(result.total / PAGE_SIZE)} total={result.total} pageSize={PAGE_SIZE} />
          </div>
        );
      })()}
    </div>
  );
}
