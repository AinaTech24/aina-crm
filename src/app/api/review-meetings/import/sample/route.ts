/** GET /api/review-meetings/import/sample — the sample Excel sheet for the import (lib/imports/sheet). */
import { sampleResponse } from "@/lib/imports/sheet/http";
import { meetingsImport } from "@/lib/imports/sheet/meetings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return sampleResponse(meetingsImport);
}
