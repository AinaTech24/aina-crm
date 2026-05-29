import { handleApiError } from "@/lib/api/error-handler";
/**
 * Lead blueprint endpoints.
 *
 *   GET    /api/leads/[id]/blueprint            → { current, allStages, history }
 *   POST   /api/leads/[id]/blueprint/advance    → transition to a target stage
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getStage } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const data = await withTenant(session.tenantId, async (tx) => getStage(tx, session.tenantId, id));
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
