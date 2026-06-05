/**
 * PATCH /api/me/profile — update your own basic profile (name, phone).
 *
 * Self-service for every role. Deliberately limited to harmless fields — a
 * user can NOT change their own roles, email, targets, department, or reporting
 * manager here (those stay owner-controlled in the Employees admin).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { users } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  // Profile photo URL. Only a relative app path (/api/upload-local/…) or an
  // http(s) URL is accepted — never a javascript:/data: URL — so it's safe to
  // render in an <img src>.
  avatarUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === "" || v.startsWith("/") || /^https?:\/\//i.test(v), "invalid url")
    .optional()
    .or(z.literal("")),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone || null;
    if (parsed.data.avatarUrl !== undefined) patch.avatarUrl = parsed.data.avatarUrl || null;

    await withTenant(session.tenantId, async (tx) => {
      await tx.update(users).set(patch).where(eq(users.id, session.userId));
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
