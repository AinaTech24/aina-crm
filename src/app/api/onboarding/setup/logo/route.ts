/** POST /api/onboarding/setup/logo — setup step 2: the firm's logo (PNG / JPG / WebP, 2 MB). Owner-only. */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { LOGO_MAX_BYTES, saveLogo } from "@/lib/onboarding/wizard";
import { wizardActor } from "@/lib/onboarding/actor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > LOGO_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "The logo must be 2 MB or smaller." }, { status: 413 });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Choose an image." }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const firm = await withTenant(session.tenantId, async (tx) =>
      ((await tx.execute(sql`SELECT display_name FROM tenants WHERE id = ${session.tenantId}::uuid`)).rows[0] as { display_name: string } | undefined)?.display_name ?? "firm"
    );
    const r = await saveLogo(wizardActor(session, req), buf, firm);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, url: r.url });
  } catch (err) {
    return handleApiError(err);
  }
}
