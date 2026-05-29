import Link from "next/link";
import { desc, and, eq, gte, sql } from "drizzle-orm";
import { ClipboardCheck, Bot, User, Workflow, Webhook, AlertCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";

const actorIcons = { user: User, system: Bot, workflow: Workflow, webhook: Webhook };

export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; days?: string; cursor?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const days = Number(sp.days ?? "7");
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const cursor = sp.cursor;

  const result = await withTenant(session.tenantId, async (tx) => {
    const conditions = [gte(auditLog.at, fromDate)];
    if (sp.action) conditions.push(eq(auditLog.action, sp.action));
    if (sp.actor) conditions.push(eq(auditLog.actorType, sp.actor as any));

    if (cursor) {
      const [cursorMs, cursorId] = cursor.split(":");
      if (cursorMs && cursorId) {
        conditions.push(
          sql`(${auditLog.at}, ${auditLog.id}) < (${new Date(Number(cursorMs)).toISOString()}::timestamp, ${cursorId}::uuid)`
        );
      }
    }

    const rows = await tx
      .select({ log: auditLog, userName: users.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(...conditions))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(51);

    const hasMore = rows.length > 50;
    const displayRows = hasMore ? rows.slice(0, 50) : rows;
    const lastRow = displayRows[displayRows.length - 1];
    const nextCursor = lastRow ? `${lastRow.log.at.getTime()}:${lastRow.log.id}` : "";

    // PII access count for the period
    const piiCount = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
      WHERE at >= ${fromDate}
        AND pii_accessed IS NOT NULL
    `);
    const piiAccessed = Number((piiCount.rows[0] as any)?.c ?? 0);

    return { displayRows, hasMore, nextCursor, piiAccessed };
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground text-sm">
          Append-only trail of every consequential action. PII access events are highlighted for DPDP compliance.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Total events (window)" value={String(result.displayRows.length)} />
        <Stat label="PII access events" value={String(result.piiAccessed)} />
        <Stat label="Window" value={`${days} days`} />
        <Stat label="Retention" value="7 years" />
      </div>

      <form className="border rounded-lg bg-card">
        <div className="border-b p-3 flex gap-2">
          <select
            name="actor"
            defaultValue={sp.actor ?? ""}
            className="text-sm border rounded-md px-2 bg-background"
          >
            <option value="">All actors</option>
            <option value="user">User</option>
            <option value="system">System</option>
            <option value="workflow">Workflow</option>
            <option value="webhook">Webhook</option>
          </select>
          <select
            name="days"
            defaultValue={String(days)}
            className="text-sm border rounded-md px-2 bg-background"
          >
            <option value="1">Last 24h</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
          <input
            name="action"
            defaultValue={sp.action ?? ""}
            placeholder="action filter, e.g. investor.view"
            className="text-sm border rounded-md px-2 py-1 bg-background flex-1 max-w-xs"
          />
          <button className="rounded-md border px-3 text-sm">Apply</button>
        </div>

        {result.displayRows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No audit events in this window.
          </div>
        ) : (
          <>
            <ul className="divide-y text-sm font-mono">
              {result.displayRows.map((r) => {
                const Icon = actorIcons[r.log.actorType as keyof typeof actorIcons] ?? User;
                const piiAccess = !!(r.log.piiAccessed && Object.keys(r.log.piiAccessed as any).length > 0);
                return (
                  <li key={r.log.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-accent/40">
                    <Icon className="size-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs text-muted-foreground tabular-nums w-32 flex-shrink-0">
                      {formatRelative(r.log.at)}
                    </span>
                    <span className="text-xs w-32 truncate flex-shrink-0">
                      {r.userName ?? r.log.actorType}
                    </span>
                    <span className="text-xs flex-1 truncate">
                      <span className="font-semibold">{r.log.action}</span>
                      {r.log.entityType && (
                        <span className="text-muted-foreground"> · {r.log.entityType}:{r.log.entityId?.slice(0, 8)}</span>
                      )}
                      {r.log.reason && <span className="text-muted-foreground"> · "{r.log.reason}"</span>}
                    </span>
                    {piiAccess && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 flex items-center gap-1 flex-shrink-0">
                        <AlertCircle className="size-3" /> PII
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {result.hasMore && (
              <div className="p-4 border-t flex justify-end">
                <Link
                  href={`/dashboard/audit-log?days=${days}&actor=${sp.actor ?? ""}&action=${sp.action ?? ""}&cursor=${result.nextCursor}`}
                  className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
                >
                  Next Page →
                </Link>
              </div>
            )}
          </>
        )}
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
