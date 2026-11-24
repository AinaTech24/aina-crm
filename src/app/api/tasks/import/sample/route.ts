/** GET /api/tasks/import/sample — the sample Excel sheet for the import (lib/imports/sheet). */
import { sampleResponse } from "@/lib/imports/sheet/http";
import { tasksImport } from "@/lib/imports/sheet/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return sampleResponse(tasksImport);
}
