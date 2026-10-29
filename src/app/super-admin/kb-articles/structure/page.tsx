import Link from "next/link";
import { asc } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { kbCategories, kbFolders, kbArticles } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { KbStructureManager } from "@/components/super-admin/KbStructureManager";

export const dynamic = "force-dynamic";

export default async function KbStructurePage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.package.manage");
  const { cats, folders, arts } = await withPlatformAdmin(session.userId, async (tx) => ({
    cats: await tx.select().from(kbCategories).orderBy(asc(kbCategories.sortOrder), asc(kbCategories.name)),
    folders: await tx.select().from(kbFolders).orderBy(asc(kbFolders.sortOrder), asc(kbFolders.name)),
    arts: await tx.select({ folderId: kbArticles.folderId }).from(kbArticles),
  }));
  const counts: Record<string, number> = {};
  for (const a of arts) if (a.folderId) counts[a.folderId] = (counts[a.folderId] ?? 0) + 1;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/super-admin/kb-articles" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="page-title">Knowledge Base — categories & folders</h1>
          <p className="text-muted-foreground text-sm">
            A category holds folders; a folder holds articles. Visitors see them in this order, lowest number first.
          </p>
        </div>
      </div>
      <KbStructureManager
        categories={cats.map((c) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description, sortOrder: c.sortOrder, published: c.published }))}
        folders={folders.map((f) => ({ id: f.id, categoryId: f.categoryId, slug: f.slug, name: f.name, description: f.description, sortOrder: f.sortOrder, published: f.published, articleCount: counts[f.id] ?? 0 }))}
      />
    </div>
  );
}
