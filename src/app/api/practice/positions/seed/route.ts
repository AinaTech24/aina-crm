import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/practice/positions/seed — start from the standard MFD positions.
 * Idempotent: adds the missing default positions, suggests holders for the
 * ones with none, and gives unconfigured core processes their default owner.
 */

import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { seedDefaultPositions } from "@/lib/practice/positions";
import { relinkStarterPositions } from "@/lib/practice/install-starter-manual";
import { gateManage, tenantOpts } from "../_gate";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    gateManage(session);
    await assertActiveLicense(session.tenantId, session.roles);
    const result = await withTenant(session.tenantId, async (tx) => {
      const seeded = await seedDefaultPositions(tx, session.tenantId);
      // Starter SOPs installed before the positions existed get their position
      // links now (install-starter-manual skips links to missing positions).
      await relinkStarterPositions(tx, session.tenantId);
      return seeded;
    }, tenantOpts(session));
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
