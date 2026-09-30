/**
 * GET  /api/dashboards   → the dashboards this user may see, grouped (lib/dashboards/platform.ts)
 * POST /api/dashboards   → create a dashboard { name, description?, layout, filterConfig? }
 *
 * Anyone may create a dashboard; it starts as "Only me". Sharing is a separate
 * step with its own rules (PUT /api/dashboards/[id]/shares).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { createDashboard, listDashboards, viewerFacts } from "@/lib/dashboards/platform";
import { sanitizeLayoutItems } from "@/lib/dashboards/system/catalog";
import { sanitizeFilterConfig } from "@/lib/dashboards/system/filters";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const data = await withTenant(session.tenantId, async (tx) => listDashboards(tx, await viewerFacts(tx, session)));
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  layout: z.array(z.unknown()).max(40),
  filterConfig: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Give the dashboard a name" }, { status: 400 });
    const layout = sanitizeLayoutItems(parsed.data.layout);
    if (!layout.length) return NextResponse.json({ error: "Add at least one widget" }, { status: 400 });
    const id = await withTenant(session.tenantId, (tx) =>
      createDashboard(tx, session, {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        layout,
        filterConfig: sanitizeFilterConfig(parsed.data.filterConfig),
      }),
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
