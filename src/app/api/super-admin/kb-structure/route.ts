import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/super-admin/kb-structure — every category and folder (published or not)
 * POST /api/super-admin/kb-structure — create one: { kind: "category" | "folder", ... }
 * Gated by platform.package.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { kbCategories, kbFolders } from "@/db/schema";
import { KbCategoryBody, KbFolderBody } from "@/lib/kb/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const out = await withPlatformAdmin(session.userId, async (tx) => ({
      categories: await tx.select().from(kbCategories).orderBy(asc(kbCategories.sortOrder), asc(kbCategories.name)),
      folders: await tx.select().from(kbFolders).orderBy(asc(kbFolders.sortOrder), asc(kbFolders.name)),
    }));
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const raw = await req.json().catch(() => ({}));
    const kind = raw?.kind;
    if (kind !== "category" && kind !== "folder") {
      return NextResponse.json({ error: "kind must be category or folder" }, { status: 400 });
    }
    const parse = (kind === "category" ? KbCategoryBody : KbFolderBody).safeParse(raw);
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const d = parse.data as any;
    const row = await withPlatformAdmin(session.userId, async (tx) => {
      const table = kind === "category" ? kbCategories : kbFolders;
      const [r] = await tx
        .insert(table)
        .values({
          ...(kind === "folder" ? { categoryId: d.categoryId } : {}),
          slug: d.slug,
          name: d.name,
          description: d.description ?? null,
          sortOrder: d.sortOrder ?? 0,
          published: d.published ?? true,
        } as any)
        .returning({ id: table.id });
      return r;
    });
    revalidatePath("/knowledge-base");
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (err: any) {
    if (String(err?.code) === "23505") {
      return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
    }
    return handleApiError(err);
  }
}
