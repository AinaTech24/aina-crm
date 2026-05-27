/**
 * Segments collection.
 *
 *   GET  /api/segments    — list segments in tenant
 *   POST /api/segments    — create new segment (static or dynamic)
 *
 * Dynamic segments are materialized on the schedule via the segment_materializer
 * worker. Static segments are populated once on save.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { segments, segmentMemberships } from "@/db/schema";
import { FilterASTSchema } from "@/lib/filter/ast";
import { compileToSelect } from "@/lib/filter/compiler";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  kind: z.enum(["static", "dynamic"]),
  subjectType: z.enum(["investor", "lead", "task", "folio"]),
  ast: FilterASTSchema,
  refreshCron: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx.select().from(segments).orderBy(desc(segments.updatedAt));
    });
    return NextResponse.json({ segments: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    // Pre-compile to validate the AST against the catalog before saving.
    try {
      compileToSelect(body.ast, body.subjectType, { limit: 1 });
    } catch (err: any) {
      return NextResponse.json({ error: `AST does not compile: ${err.message}` }, { status: 400 });
    }

    const segId = uuid();
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(segments).values({
        id: segId,
        tenantId: session.tenantId,
        name: body.name,
        description: body.description,
        kind: body.kind,
        subjectType: body.subjectType,
        ast: body.ast,
        refreshCron: body.kind === "dynamic" ? (body.refreshCron ?? "0 * * * *") : null,
      } as any);

      // Static: materialize once immediately. Dynamic: leave to worker.
      if (body.kind === "static") {
        const { sql: querySql } = compileToSelect(body.ast, body.subjectType, {});
        const matches = await tx.execute(sql.raw(querySql) as any);
        for (const row of matches.rows as Array<{ id: string }>) {
          await tx.insert(segmentMemberships).values({
            segmentId: segId,
            tenantId: session.tenantId,
            subjectId: row.id,
          } as any);
        }
        await tx
          .update(segments)
          .set({ memberCount: matches.rows.length, lastMaterializedAt: new Date() } as any)
          .where(eq(segments.id, segId));
      }
    });

    return NextResponse.json({ id: segId }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
