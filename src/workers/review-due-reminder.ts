/**
 * Client review-due reminder.
 *
 * A review cadence (monthly / quarterly / every 100 days / yearly) only helps if
 * something actually prompts the RM when the date arrives. investors.next_review_at
 * was driving a dashboard badge but raised no task, so a due review could pass
 * unnoticed.
 *
 * This raises ONE task per client per review cycle, assigned to that client's RM
 * (falling back to the firm's owner/compliance user). Cadence-agnostic: it reads
 * next_review_at, so it works for the presets and for any custom day count.
 *
 * Idempotent — the task carries a marker keyed on the client + the review date,
 * so re-running never duplicates, and the NEXT cycle gets its own task because
 * the date changes.
 */

import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant } from "@/db/client";
import { tasks } from "@/db/schema";

/** How many days ahead of the due date to raise the task. */
const LEAD_DAYS = 7;

export async function runReviewDueReminder(): Promise<number> {
  let created = 0;

  const tenantIds = await withSystem(async (tx) => {
    const r = await tx.execute(
      sql`SELECT id FROM tenants WHERE status IN ('active','trial') AND deleted_at IS NULL`
    );
    return (r.rows as any[]).map((x) => x.id as string);
  });

  for (const tenantId of tenantIds) {
    try {
      await withTenant(tenantId, async (tx) => {
        // Clients whose review falls due within the lead window (or is overdue).
        const due = await tx.execute(sql`
          SELECT i.id, i.name, i.rm_id, i.next_review_at::date AS due_on
            FROM investors i
           WHERE i.tenant_id = ${tenantId}::uuid
             AND i.deleted_at IS NULL
             AND i.status = 'active'
             AND i.merged_into_id IS NULL
             AND i.next_review_at IS NOT NULL
             AND i.next_review_at::date <= (current_date + make_interval(days => ${LEAD_DAYS}))
           LIMIT 500`);
        if (!due.rows.length) return;

        // Fallback assignee when the client has no RM.
        const fb = await tx.execute(sql`
          SELECT id FROM users
           WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
             AND ('owner' = ANY(roles) OR 'compliance' = ANY(roles))
           ORDER BY ('owner' = ANY(roles)) DESC LIMIT 1`);
        const fallbackId = (fb.rows[0] as any)?.id as string | undefined;

        for (const row of due.rows as any[]) {
          const assigneeId = (row.rm_id as string) ?? fallbackId;
          if (!assigneeId) continue;

          // One task per client per review date.
          const marker = `[review-due:${row.id}:${row.due_on}]`;
          const exists = await tx.execute(sql`
            SELECT 1 FROM tasks
             WHERE tenant_id = ${tenantId}::uuid
               AND COALESCE(remarks,'') LIKE ${`${marker}%`}
             LIMIT 1`);
          if (exists.rows.length) continue;

          await tx.insert(tasks).values({
            id: uuid(),
            tenantId,
            subjectType: "investor",
            subjectId: row.id,
            relatedInvestorId: row.id,
            assigneeId,
            createdById: assigneeId,
            title: `Portfolio review due — ${row.name}`,
            status: "open",
            priority: "normal",
            dueAt: new Date(`${row.due_on}T12:00:00`),
            remarks:
              `${marker}\nThe client's review cadence falls due on ${row.due_on}. ` +
              `Book the review, then log it on the client so the next one is scheduled automatically.`,
          } as any);
          created++;
        }
      });
    } catch (err) {
      console.error(`[review-due] tenant ${tenantId} failed:`, (err as Error)?.message);
    }
  }

  if (created) console.log(`[review-due] raised ${created} review task(s).`);
  return created;
}
