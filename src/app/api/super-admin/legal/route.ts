/** Aina Admin → Legal documents: list versions; POST { kind } starts a draft of the next version. */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { createDraft, listLegalDocs } from "@/lib/legal/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    return NextResponse.json({ docs: await listLegalDocs() });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const b = ((await req.json().catch(() => null)) ?? {}) as { kind?: string };
    if (b.kind !== "terms" && b.kind !== "nda") return NextResponse.json({ error: "kind must be terms or nda" }, { status: 400 });
    return NextResponse.json({ ok: true, id: await createDraft(b.kind, session.userId) });
  } catch (err) {
    return handleApiError(err);
  }
}
