/**
 * Segment materializer.
 *
 * For each dynamic segment, runs the saved AST as a SQL query, diffs against
 * the current `segment_memberships`, and applies inserts/soft-removes.
 * Emits `segment_entry` and `segment_exit` events into the outbox so workflows
 * can react.
 */

import { and, eq, sql } from "drizzle-orm";
import { withTenant, withSystem } from "@/db/client";
import { eventsOutbox, segmentMemberships, segments } from "@/db/schema";
import { compileToSelect } from "@/lib/filter/compiler";

export async function materializeSegment(tenantId: string, segmentId: string): Promise<{
  added: number;
  removed: number;
  total: number;
  elapsedMs: number;
}> {
  const start = Date.now();

  return withTenant(tenantId, async (tx) => {
    const [seg] = await tx.select().from(segments).where(eq(segments.id, segmentId));
    if (!seg) throw new Error(`Segment ${segmentId} not found`);
    if (seg.kind !== "dynamic") {
      throw new Error(`Cannot materialize static segment ${segmentId}`);
    }

    const ast = seg.ast as any;
    if (!ast) {
      return { added: 0, removed: 0, total: 0, elapsedMs: Date.now() - start };
    }

    const { sql: querySql, params } = compileToSelect(ast, seg.subjectType, {
      columns: [`${aliasOf(seg.subjectType)}.id`],
      limit: 100_000,
    });

    // RLS scopes by tenant_id via the session — but for safety add a clause
    const tenantClause = sql.raw(` AND ${aliasOf(seg.subjectType)}.tenant_id = '${tenantId}'`);
    const rawSql = sql`${sql.raw(querySql)} ${tenantClause}`;
    const result = await tx.execute(rawSql as any);
    const newIds = new Set((result.rows as any[]).map((r) => r.id));

    // Current memberships
    const currentRows = await tx
      .select()
      .from(segmentMemberships)
      .where(and(eq(segmentMemberships.segmentId, segmentId), sql`${segmentMemberships.removedAt} IS NULL`));
    const current = new Set(currentRows.map((r) => r.subjectId));

    const added: string[] = [];
    const removed: string[] = [];
    for (const id of newIds) {
      if (!current.has(id)) added.push(id);
    }
    for (const id of current) {
      if (!newIds.has(id)) removed.push(id);
    }

    // Apply changes
    if (added.length) {
      const values = added.map((id) => ({
        segmentId,
        tenantId,
        subjectId: id,
      }));
      // Upsert
      for (const v of values) {
        await tx.execute(
          sql`INSERT INTO segment_memberships (segment_id, tenant_id, subject_id, added_at, removed_at)
              VALUES (${v.segmentId}, ${v.tenantId}, ${v.subjectId}, now(), NULL)
              ON CONFLICT (segment_id, subject_id) DO UPDATE
              SET added_at = EXCLUDED.added_at, removed_at = NULL`
        );
      }
    }
    if (removed.length) {
      await tx.execute(
        sql`UPDATE segment_memberships SET removed_at = now()
            WHERE segment_id = ${segmentId}
              AND subject_id IN (${sql.raw(removed.map((id) => `'${id}'`).join(","))})`
      );
    }

    // Emit events
    for (const id of added) {
      await tx.insert(eventsOutbox).values({
        tenantId,
        kind: `segment_entry.${seg.name}`,
        entityType: seg.subjectType,
        entityId: id,
        after: { segmentId, segmentName: seg.name },
      } as any);
    }
    for (const id of removed) {
      await tx.insert(eventsOutbox).values({
        tenantId,
        kind: `segment_exit.${seg.name}`,
        entityType: seg.subjectType,
        entityId: id,
        before: { segmentId, segmentName: seg.name },
      } as any);
    }

    // Update segment counters
    const elapsed = Date.now() - start;
    await tx
      .update(segments)
      .set({
        memberCount: newIds.size,
        lastMaterializedAt: new Date(),
        lastMaterializationMs: elapsed,
      })
      .where(eq(segments.id, segmentId));

    return { added: added.length, removed: removed.length, total: newIds.size, elapsedMs: elapsed };
  });
}

function aliasOf(subject: string): string {
  return { investor: "inv", lead: "ld", task: "tk", user: "usr" }[subject] ?? subject;
}

export function startSegmentMaterializerWorker() {
  // Default: scan every dynamic segment hourly. Per-segment cron overrides
  // will be supported via the master scheduler later.
  const interval = Number(process.env.SEGMENT_MATERIALIZER_INTERVAL_MS ?? 60_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const rows = await withSystem(async (tx) => {
        return tx.execute(sql`
          SELECT id, tenant_id, last_materialized_at, refresh_cron
          FROM segments
          WHERE kind = 'dynamic' AND materializer_enabled = true
          ORDER BY last_materialized_at NULLS FIRST
          LIMIT 50
        `);
      });
      for (const r of rows.rows as any[]) {
        const last = r.last_materialized_at ? new Date(r.last_materialized_at) : null;
        if (last && Date.now() - last.getTime() < 30 * 60 * 1000) continue; // 30-min floor
        try {
          const out = await materializeSegment(r.tenant_id, r.id);
          console.log(`[seg] materialized ${r.id}: +${out.added} -${out.removed} total=${out.total}`);
        } catch (err) {
          console.error(`[seg] ${r.id} failed:`, (err as Error).message);
        }
      }
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, interval);
  console.log(`[seg] materializer started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
