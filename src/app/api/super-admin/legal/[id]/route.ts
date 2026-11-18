/** Aina Admin → Legal documents: edit (PATCH) or discard (DELETE) a DRAFT. Published versions are frozen. */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { deleteDraft, updateDraft } from "@/lib/legal/admin";

export const dynamic = "force-dynamic";

const Body = z.object({ title: z.string().trim().min(3).max(200), body: z.string().max(200_000), reviewNote: z.string().trim().max(300).nullable().optional() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Title and text are required." }, { status: 400 });
    await updateDraft((await params).id, { title: parsed.data.title, body: parsed.data.body, reviewNote: parsed.data.reviewNote || null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    await deleteDraft((await params).id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
