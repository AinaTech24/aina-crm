import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/super-admin/kb-structure/starter — install the starter module
 * guides as DRAFTS (see lib/kb/install-starter.ts). Safe to repeat.
 * Gated by platform.package.manage.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { installStarterGuides } from "@/lib/kb/install-starter";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const result = await withPlatformAdmin(session.userId, (tx) => installStarterGuides(tx));
    revalidatePath("/knowledge-base", "layout");
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
