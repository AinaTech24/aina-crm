/** GET /api/service-requests/import/sample — the sample Excel sheet for the import (lib/imports/sheet). */
import { sampleResponse } from "@/lib/imports/sheet/http";
import { serviceRequestsImport } from "@/lib/imports/sheet/service-requests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return sampleResponse(serviceRequestsImport);
}
