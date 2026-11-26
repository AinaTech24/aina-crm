/**
 * GET /api/visitors/import/sample            — the sample Excel sheet
 * GET /api/visitors/import/sample?format=csv — the same columns as a CSV file
 * 404 for a firm without the Visitor Register.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { sampleResponse } from "@/lib/imports/sheet/http";
import { visitorsImport } from "@/lib/imports/sheet/visitors";
import { buildSampleCsv, sampleFileName } from "@/lib/imports/sheet/write";
import { assertVisitorRegister } from "@/lib/visitors/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertVisitorRegister(session);
    if (req.nextUrl.searchParams.get("format") !== "csv") return await sampleResponse(visitorsImport);
    visitorsImport.authorize(session);
    return new NextResponse(new Uint8Array(buildSampleCsv(visitorsImport.spec)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${sampleFileName(visitorsImport.spec, "csv")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
