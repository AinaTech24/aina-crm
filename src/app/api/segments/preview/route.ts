import { handleApiError } from "@/lib/api/error-handler";
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
import { compileToSelect, bindCompiled } from "@/lib/filter/compiler";

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
      const { sql: previewSql, params: previewParams } = compileToSelect(astParse.data, subject, {
        limit: 10,
        columns: ["id", "name"], // safe default for the listed subjects
      });
      const { sql: countSql, params: countParams } = compileToSelect(astParse.data, subject, {
        count: true,
      });

      // bindCompiled re-binds $1, $2, … through Drizzle's tagged template so
      // every value is sent as a real bind parameter. The previous code did
      // sql.raw(text) and dropped the params, which was unsafe.
      const [countResult, sampleResult] = await Promise.all([
        tx.execute(bindCompiled(countSql, countParams) as any),
        tx.execute(bindCompiled(previewSql, previewParams) as any),
      ]);

      return {
        count: Number((countResult.rows[0] as any)?.count ?? 0),
        sample: sampleResult.rows,
      };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
