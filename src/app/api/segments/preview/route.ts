/**
 * POST /api/segments/preview
 * Body: { subject: 'investor'|'lead'|'task'|'folio', ast: FilterAST }
 *
 * Live count + sample (10 rows) for the filter builder. Compiles the AST to
 * SQL via the same compiler segments use, so what you see is what the
 * materializer will save.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { FilterASTSchema } from "@/lib/filter/ast";
import { compileToSelect } from "@/lib/filter/compiler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json().catch(() => ({}));

    const astParse = FilterASTSchema.safeParse(body.ast);
    if (!astParse.success) {
      return NextResponse.json({ error: "invalid ast", issues: astParse.error.issues }, { status: 400 });
    }
    const subject: string = body.subject ?? "investor";

    const result = await withTenant(session.tenantId, async (tx) => {
      const { sql: previewSql, params } = compileToSelect(astParse.data, subject, {
        limit: 10,
        columns: ["id", "name"], // safe default for the listed subjects
      });
      const { sql: countSql } = compileToSelect(astParse.data, subject, { count: true });

      const [countResult, sampleResult] = await Promise.all([
        tx.execute(sql.raw(countSql) as any),
        tx.execute(sql.raw(previewSql) as any),
      ]);

      return {
        count: Number((countResult.rows[0] as any)?.count ?? 0),
        sample: sampleResult.rows,
      };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
