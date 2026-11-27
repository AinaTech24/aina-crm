/**
 * POST /api/couriers/import?mode=check|import — the Excel / CSV import (lib/imports/sheet).
 * check reads and checks the file and saves nothing; import saves the rows that passed.
 * 404 for a firm without Couriers.
 */
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { importResponse } from "@/lib/imports/sheet/http";
import { couriersImport } from "@/lib/imports/sheet/couriers";
import { assertCouriers, COURIER_WRITE_CAPS } from "@/lib/couriers/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    await assertCouriers(session);
    requireAny(session.roles, COURIER_WRITE_CAPS, session.permissions);
    return await importResponse(req, session, couriersImport);
  } catch (err) {
    return handleApiError(err);
  }
}
