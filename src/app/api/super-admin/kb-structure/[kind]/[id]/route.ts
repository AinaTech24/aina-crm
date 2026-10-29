import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/super-admin/kb-structure/[category|folder]/[id] — edit
 * DELETE /api/super-admin/kb-structure/[category|folder]/[id] — remove
 *
 * Deleting a category removes its folders; articles are never deleted — they
 * become unfiled (folder_id set null) and can be moved from the article editor.
 * Gated by platform.package.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { kbCategories, kbFolders } from "@/db/schema";
import { KbCategoryPatch, KbFolderPatch } from "@/lib/kb/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string; id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { kind, id } = await params;
    if (kind !== "category" && kind !== "folder") return NextResponse.json({ error: "not found" }, { status: 404 });
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const parse = (kind === "category" ? KbCategoryPatch : KbFolderPatch).safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const d = parse.data as any;
    const patch: any = { updatedAt: new Date() };
    for (const key of ["slug", "name", "description", "sortOrder", "published", ...(kind === "folder" ? ["categoryId"] : [])]) {
      if (d[key] !== undefined) patch[key] = d[key];
    }
    const table = kind === "category" ? kbCategories : kbFolders;
    await withPlatformAdmin(session.userId, async (tx) => {
      await tx.update(table).set(patch).where(eq(table.id, id));
    });
    revalidatePath("/knowledge-base", "layout");
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (String(err?.code) === "23505") {
      return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
    }
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { kind, id } = await params;
    if (kind !== "category" && kind !== "folder") return NextResponse.json({ error: "not found" }, { status: 404 });
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    await withPlatformAdmin(session.userId, async (tx) => {
      const table = kind === "category" ? kbCategories : kbFolders;
      await tx.delete(table).where(eq(table.id, id));
    });
    revalidatePath("/knowledge-base", "layout");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
