/**
 * Tasks — the Excel import (2026-11-24). The columns are specs/tasks.ts; this is what
 * is Tasks' own: how a row becomes a task, and what is saved.
 *
 * A task made by hand (POST /api/tasks) notifies its assignee, one by one. An import
 * of hundreds would ping each person hundreds of times, so each assignee gets ONE
 * notification with a count. Tasks emit no workflow events at all (see that route),
 * so nothing else fires.
 */
import { v4 as uuid } from "uuid";
import { tasks } from "@/db/schema";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { createNotification } from "@/lib/notifications/create";
import { SLA_HOURS_BY_PRIORITY } from "@/lib/tasks/recurrence";
import { loadClients, loadLeads, loadUsers, type ClientLookup, type LeadLookup, type UserLookup } from "./lookups";
import type { ImportModule, Problem } from "./run";
import { tasksSpec, TASK_DEPARTMENTS, TASK_PRIORITIES, TASK_RECURRENCES, TASK_STATUSES, TASK_TYPE_OPTIONS } from "./specs/tasks";
import { dayToUtcMidnight, istInstant, parseBool, parseDay, parseDayTime, parseEnum, parseInteger, parseList } from "./values";

type Prep = { users: UserLookup; clients: ClientLookup; leads: LeadLookup };
type Item = {
  title: string; description: string | null; type: string; department: string | null; priority: string; status: string;
  assigneeId: string; assigneeDepartment: string | null; entryDate: string | null; dueAt: Date | null; slaDueAt: Date;
  remindAt: Date | null; investorId: string | null; leadId: string | null; remarks: string | null; tags: string[];
  estimateMinutes: number | null; recurrence: string | null; recurrenceUntil: string | null; requiresApproval: boolean;
  actionPoints: string[]; closedAt: Date | null;
};

export const tasksImport: ImportModule<Prep, Item> = {
  spec: tasksSpec,

  authorize(session) {
    // Importing a book of work is a manager action, like importing leads: it can assign to anyone.
    requireCap(session.roles, "task.edit.all", session.permissions);
  },

  async prepare(tx, session, rows) {
    return {
      users: await loadUsers(tx, session.tenantId),
      clients: await loadClients(tx, session, rows.map((r) => ({ pan: r.get("clientPan"), name: r.get("clientName") }))),
      leads: await loadLeads(tx, session, rows.map((r) => ({ mobile: r.get("leadMobile"), name: r.get("leadName") }))),
    };
  },

  parse(row, prep, session) {
    const title = row.get("title");
    if (title.length < 2) row.fail("title", title ? "Too short — at least 2 characters" : "Required");
    else if (title.length > 300) row.fail("title", "Too long — 300 characters at most");

    const description = row.get("description");
    if (description.length > 20000) row.fail("description", "Too long — 20,000 characters at most");
    const remarks = row.get("remarks");
    if (remarks.length > 1000) row.fail("remarks", "Too long — 1,000 characters at most");

    const choice = (key: string, options: Array<{ value: string; label: string }>, fallback: string | null) => {
      const raw = row.get(key);
      if (!raw) return fallback;
      const p = parseEnum(raw, options);
      if (p.ok) return p.value;
      row.fail(key, p.error);
      return fallback;
    };
    const type = choice("type", TASK_TYPE_OPTIONS, "follow_up") as string;
    const department = choice("department", TASK_DEPARTMENTS, null);
    const priority = choice("priority", TASK_PRIORITIES, "normal") as string;
    const status = choice("status", TASK_STATUSES, "open") as string;
    const recurrence = choice("recurrence", TASK_RECURRENCES, null);

    // Assigned To: blank = the person importing.
    let assigneeId = session.userId;
    let assigneeDepartment: string | null = prep.users.all.find((u) => u.id === session.userId)?.department ?? null;
    if (row.get("assignee")) {
      const f = prep.users.find(row.get("assignee"));
      if (f.ok) { assigneeId = f.value.id; assigneeDepartment = f.value.department; } else row.fail("assignee", f.error);
    }

    const day = (key: string): string | null => {
      const raw = row.get(key);
      if (!raw) return null;
      const p = parseDay(raw);
      if (p.ok) return p.value;
      row.fail(key, p.error);
      return null;
    };
    /** A date alone is stored the way the task screen stores a picked date; with a time it is India time. */
    const when = (key: string, bareTime?: string): Date | null => {
      const raw = row.get(key);
      if (!raw) return null;
      const p = parseDayTime(raw);
      if (!p.ok) { row.fail(key, p.error); return null; }
      if (p.value.time) return istInstant(p.value.day, p.value.time);
      return bareTime ? istInstant(p.value.day, bareTime) : dayToUtcMidnight(p.value.day);
    };
    const entryDate = day("entryDate");
    const dueAt = when("dueAt");
    const remindAt = when("remindAt", "10:00");
    const slaGiven = when("slaDueAt");
    const recurrenceUntil = day("recurrenceUntil");
    if (recurrenceUntil && !recurrence) row.fail("recurrenceUntil", "Fill Repeats as well, or clear this");
    const closedDay = day("closedDate");
    const closedAt = closedDay ? dayToUtcMidnight(closedDay) : null;
    if (closedAt && status !== "completed") row.fail("closedDate", "Only for a Completed task — set Status to Completed or clear this");

    let estimateMinutes: number | null = null;
    if (row.get("estimateMinutes")) {
      const p = parseInteger(row.get("estimateMinutes"), 0, 100000);
      if (p.ok) estimateMinutes = p.value; else row.fail("estimateMinutes", p.error);
    }
    let requiresApproval = false;
    if (row.get("requiresApproval")) {
      const p = parseBool(row.get("requiresApproval"));
      if (p.ok) requiresApproval = p.value; else row.fail("requiresApproval", p.error);
    }

    const tags = parseList(row.get("tags"), 30);
    if (tags.some((t) => t.length > 40)) row.fail("tags", "A tag is at most 40 characters");
    const actionPoints = parseList(row.get("actionPoints"), 100);
    if (actionPoints.some((a) => a.length > 500)) row.fail("actionPoints", "An action point is at most 500 characters");

    let investorId: string | null = null;
    const c = prep.clients.find({ pan: row.get("clientPan"), name: row.get("clientName") });
    if (c.ok) investorId = c.value?.id ?? null;
    else row.fail(row.get("clientPan") ? "clientPan" : "clientName", c.error);

    let leadId: string | null = null;
    const l = prep.leads.find({ mobile: row.get("leadMobile"), name: row.get("leadName") });
    if (l.ok) leadId = l.value?.id ?? null;
    else row.fail(row.get("leadMobile") ? "leadMobile" : "leadName", l.error);

    if (row.failed) return null;
    return {
      title, description: description || null, type, department, priority, status, assigneeId, assigneeDepartment,
      entryDate, dueAt, slaDueAt: slaGiven ?? new Date(Date.now() + (SLA_HOURS_BY_PRIORITY[priority] ?? 72) * 3_600_000),
      remindAt, investorId, leadId, remarks: remarks || null, tags, estimateMinutes, recurrence, recurrenceUntil,
      requiresApproval, actionPoints, closedAt,
    };
  },

  async commit(tx: Tx, session: SessionUser, items) {
    const failed: Problem[] = [];
    const perAssignee = new Map<string, number>();
    let saved = 0;
    for (const { n, item: t } of items) {
      const id = uuid();
      const done = t.status === "completed";
      try {
        // A savepoint per row: one the database refuses does not undo the others.
        await tx.transaction(async (sp) => {
          await sp.insert(tasks).values({
            id,
            tenantId: session.tenantId,
            subjectType: t.investorId ? "investor" : t.leadId ? "lead" : "internal",
            subjectId: t.investorId ?? t.leadId ?? null,
            relatedInvestorId: t.investorId,
            relatedLeadId: t.leadId,
            department: t.department ?? t.assigneeDepartment ?? null,
            type: t.type,
            title: t.title,
            description: t.description ?? undefined,
            remarks: t.remarks ?? undefined,
            priority: t.priority,
            status: t.status,
            assigneeId: t.assigneeId,
            createdById: session.userId,
            entryDate: t.entryDate, // null → the database sets today (India)
            dueAt: t.dueAt,
            slaDueAt: t.slaDueAt,
            recurrence: t.recurrence,
            recurrenceUntil: t.recurrenceUntil,
            recurrenceParentId: t.recurrence ? id : null,
            requiresApproval: t.requiresApproval,
            remindAt: t.remindAt,
            estimateMinutes: t.estimateMinutes,
            // A Closed Date is kept as typed: the closed-date trigger only fills it when blank (migration 0254).
            ...(done && t.closedAt ? { completedAt: t.closedAt } : {}),
            ...(t.tags.length ? { tags: t.tags } : {}),
            meta: t.actionPoints.length
              ? {
                  checklist: t.actionPoints.map((text) => ({
                    id: uuid().slice(0, 8), text, done,
                    ...(done ? { status: "completed" as const } : {}),
                  })),
                }
              : undefined,
          } as never);
        });
        saved++;
        if (t.assigneeId !== session.userId) perAssignee.set(t.assigneeId, (perAssignee.get(t.assigneeId) ?? 0) + 1);
      } catch (e) {
        failed.push({ row: n, column: "—", message: `Could not be saved: ${(e as Error).message?.slice(0, 160) ?? "database error"}` });
      }
    }
    for (const [userId, count] of perAssignee) {
      await createNotification(tx, {
        tenantId: session.tenantId,
        userId,
        kind: "task.assigned",
        title: `${count} task${count === 1 ? "" : "s"} assigned to you`,
        body: `${session.name ?? "A teammate"} imported ${count === 1 ? "a task" : `${count} tasks`} and assigned ${count === 1 ? "it" : "them"} to you`,
        linkUrl: "/dashboard/tasks?view=assigned_to_me",
        severity: "info",
        meta: { imported: count, assigned_by: session.userId },
      });
    }
    return { saved, failed };
  },
};
