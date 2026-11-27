/**
 * GET /api/couriers/import/sample            — the sample Excel sheet
 * GET /api/couriers/import/sample?format=csv — the same columns as a CSV file
 * 404 for a firm without Couriers.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { sampleResponse } from "@/lib/imports/sheet/http";
import { couriersImport } from "@/lib/imports/sheet/couriers";
import { buildSampleCsv, sampleFileName } from "@/lib/imports/sheet/write";
import { assertCouriers } from "@/lib/couriers/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertCouriers(session);
    if (req.nextUrl.searchParams.get("format") !== "csv") return await sampleResponse(couriersImport);
    couriersImport.authorize(session);
    return new NextResponse(new Uint8Array(buildSampleCsv(couriersImport.spec)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${sampleFileName(couriersImport.spec, "csv")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
