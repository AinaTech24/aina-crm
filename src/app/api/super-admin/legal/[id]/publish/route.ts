/** Aina Admin → Legal documents: publish a draft. It is frozen from then on, and firms accept it at their next sign-in. */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { publishDraft } from "@/lib/legal/admin";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    await publishDraft((await params).id, session.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
