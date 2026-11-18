/**
 * POST /api/billing/change — change the package (users, cycle, declared AUM)
 * from the next renewal (lib/billing/change.ts). Nothing is charged now.
 * Owner-only (settings.billing).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadPricingSettings } from "@/lib/billing/pricing-settings";
import { scheduleChange } from "@/lib/billing/change";
import { CheckoutError } from "@/lib/billing/checkout";

export const dynamic = "force-dynamic";

const Body = z.object({
  cycle: z.enum(["monthly", "half_yearly", "yearly"]),
  users: z.number().int().min(1).max(10000),
  aumCrore: z.number().min(0).max(1_000_000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Choose a package and users." }, { status: 400 });
    const s = await loadPricingSettings();
    if (parsed.data.users < s.minUsers || parsed.data.users > s.maxUsers) {
      return NextResponse.json({ error: `Users must be from ${s.minUsers} to ${s.maxUsers}.` }, { status: 400 });
    }
    try {
      const r = await scheduleChange(session.tenantId, parsed.data, s, session.userId);
      return NextResponse.json({ ok: true, effectiveFrom: r.effectiveFrom, repriced: r.review?.status === "reviewed" });
    } catch (err) {
      if (err instanceof CheckoutError) return NextResponse.json({ error: err.message, code: err.code ?? null }, { status: err.status });
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
