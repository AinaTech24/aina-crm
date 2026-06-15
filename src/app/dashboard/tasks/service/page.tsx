/**
 * Daily Service Tracker (DST) — the operational view of multi-step service work.
 *
 * Lists the user's active tasks that have sub-tasks, grouped by status, each
 * showing sub-task progress + the next action date (read-only; edit in the task
 * drawer). Owners can review any team member's board.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { Headphones, ArrowLeft, CalendarClock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { loadServiceTasks, type ServiceTask } from "@/lib/service-tracker";
import { subTaskStatus, type TaskChecklistItem } from "@/db/schema";
import { DailyTrackerWho } from "@/components/tasks/DailyTrackerWho";

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { dot: string; text: string }> = {
  not_started: { dot: "bg-slate-300", text: "text-slate-500" },
  in_progress: { dot: "bg-sky-500", text: "text-sky-700" },
  completed: { dot: "bg-emerald-500", text: "text-emerald-700" },
  assigned_to_other: { dot: "bg-violet-500", text: "text-violet-700" },
};
const GROUPS: { key: "open" | "in_progress" | "blocked"; label: string; tone: string }[] = [
  { key: "open", label: "Not started", tone: "text-slate-600" },
  { key: "in_progress", label: "In progress", tone: "text-sky-700" },
  { key: "blocked", label: "Blocked", tone: "text-rose-700" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default async function ServiceTrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const isOwner = can(session.roles, "dashboard.view.owner", session.permissions);
  const targetUser = isOwner && sp.user ? sp.user : session.userId;
  const isSelf = targetUser === session.userId;

  const { tasks, name, members } = await withTenant(session.tenantId, async (tx) => {
    const tasks = await loadServiceTasks(tx as any, session.tenantId, targetUser);
    const nameRow = await tx.execute(sql`SELECT name FROM users WHERE id = ${targetUser}::uuid LIMIT 1`);
    const name = ((nameRow.rows[0] as any)?.name as string) ?? "—";
    let members: { id: string; name: string }[] = [];
    if (isOwner) {
      const r = await tx.execute(
        sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name ASC`
      );
      members = (r.rows as { id: string; name: string }[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" }));
    }
    return { tasks, name, members };
  });

  const totalSub = tasks.reduce((n, t) => n + t.total, 0);
  const doneSub = tasks.reduce((n, t) => n + t.done, 0);

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard/tasks" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="size-3" /> Tasks
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Headphones className="size-6 text-brand-cyan" /> Daily Service Tracker
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isSelf ? "Your" : `${name}'s`} active service work · {tasks.length} task{tasks.length === 1 ? "" : "s"} ·{" "}
            {doneSub}/{totalSub} sub-tasks done
          </p>
        </div>
        {isOwner && members.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Viewing</span>
            <DailyTrackerWho members={members} current={isSelf ? "" : targetUser} />
          </div>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <Headphones className="size-9 text-muted-foreground/40 mx-auto mb-3" />
          <div className="font-semibold">No multi-step service tasks open</div>
          <p className="text-sm text-muted-foreground mt-1">
            Tasks with sub-tasks show up here. Add sub-tasks to a task from its detail drawer to track it service-desk style.
          </p>
        </div>
      ) : (
        GROUPS.map((g) => {
          const group = tasks.filter((t) => t.status === g.key);
          if (!group.length) return null;
          return (
            <section key={g.key} className="space-y-2">
              <h2 className={`text-sm font-bold uppercase tracking-wide ${g.tone}`}>
                {g.label} <span className="text-muted-foreground font-medium">· {group.length}</span>
              </h2>
              <div className="space-y-3">
                {group.map((t) => (
                  <ServiceCard key={t.id} task={t} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function ServiceCard({ task }: { task: ServiceTask }) {
  const pct = task.total > 0 ? Math.round((task.done / task.total) * 100) : 0;
  return (
    <div className="card-surface p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/dashboard/tasks?task=${task.id}`} className="font-semibold text-sm hover:underline">
            {task.title}
          </Link>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            {task.for && <span>{task.for}</span>}
            {task.nextActionDate && (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <CalendarClock className="size-3" /> Next: {fmtDate(task.nextActionDate)}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold tabular-nums">{task.done}/{task.total}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">done</div>
        </div>
      </div>

      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <ul className="space-y-1.5">
        {task.subtasks.map((s: TaskChecklistItem) => {
          const st = subTaskStatus(s);
          const meta = STATUS_META[st];
          return (
            <li key={s.id} className="flex items-center gap-2 text-xs">
              <span className={`inline-flex items-center gap-1.5 shrink-0 ${meta.text}`}>
                <span className={`size-2 rounded-full ${meta.dot}`} />
              </span>
              <span className={`flex-1 ${st === "completed" ? "line-through text-muted-foreground" : ""}`}>{s.text}</span>
              {s.actionDate && <span className="text-[11px] text-muted-foreground shrink-0">{fmtDate(s.actionDate)}</span>}
              {s.remark && <span className="text-[11px] text-muted-foreground italic shrink-0 max-w-[10rem] truncate">“{s.remark}”</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
