/**
 * GET /api/integrations/fp/status — non-secret connection status + a summary of
 * FP-sourced records, for the Settings UI.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { getFpState } from "@/lib/fp/credentials";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  const { state, lastSync, txCount } = await withTenant(session.tenantId, async (tx) => {
    const state = await getFpState(tx, session.tenantId);
    const last = await tx.execute(sql`
      SELECT status, parsed_at, rows_imported, remarks
      FROM rta_file_imports
      WHERE source = 'fintech_primitives'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const cnt = await tx.execute(sql`SELECT count(*)::int AS n FROM transactions WHERE dedup_key LIKE 'fp:%'`);
    return {
      state,
      lastSync: (last.rows?.[0] as any) ?? null,
      txCount: Number((cnt.rows?.[0] as any)?.n ?? 0),
    };
  });
  // Omit baseUrl from the response so the upstream host is never exposed client-side.
  const { baseUrl: _omit, ...safeState } = state;
  return NextResponse.json({ ...safeState, lastSync, txCount });
}
