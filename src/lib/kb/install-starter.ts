/**
 * Installs the starter help-centre guides (lib/kb/starter-guides.ts) for the
 * super admin: one category, a folder per area, and a DRAFT article per module
 * process. Idempotent — a category / folder / article that already exists (by
 * slug) is left exactly as it is, so a guide the admin edited is never
 * overwritten and one they deleted comes back only when they install again.
 */

import { eq, sql } from "drizzle-orm";
import { kbArticles, kbCategories, kbFolders } from "@/db/schema";
import { GUIDES, STARTER_CATEGORY, STARTER_FOLDERS } from "@/lib/kb/starter-guides";

export type InstallResult = { categoryCreated: boolean; foldersCreated: number; guidesCreated: number; guidesSkipped: number };

export async function installStarterGuides(tx: any): Promise<InstallResult> {
  const lc = (c: any) => sql`lower(${c})`;

  let [cat] = await tx.select().from(kbCategories).where(eq(lc(kbCategories.slug), STARTER_CATEGORY.slug)).limit(1);
  const categoryCreated = !cat;
  if (!cat) {
    [cat] = await tx
      .insert(kbCategories)
      .values({ slug: STARTER_CATEGORY.slug, name: STARTER_CATEGORY.name, description: STARTER_CATEGORY.description, sortOrder: 0, published: true })
      .returning();
  }

  const folderId = new Map<string, string>();
  let foldersCreated = 0;
  for (const [i, f] of STARTER_FOLDERS.entries()) {
    let [row] = await tx.select().from(kbFolders).where(eq(lc(kbFolders.slug), f.slug)).limit(1);
    if (!row) {
      [row] = await tx
        .insert(kbFolders)
        .values({ categoryId: cat.id, slug: f.slug, name: f.name, description: f.description, sortOrder: i, published: true })
        .returning();
      foldersCreated++;
    }
    folderId.set(f.slug, row.id);
  }

  let guidesCreated = 0;
  let guidesSkipped = 0;
  for (const [i, g] of GUIDES.entries()) {
    const [exists] = await tx.select({ id: kbArticles.id }).from(kbArticles).where(eq(lc(kbArticles.slug), g.slug)).limit(1);
    if (exists) {
      guidesSkipped++;
      continue;
    }
    await tx.insert(kbArticles).values({
      series: "Guide",
      folderId: folderId.get(g.folder) ?? null,
      slug: g.slug,
      title: g.title,
      hook: g.hook,
      solutionMd: g.body,
      readMinutes: g.minutes,
      published: false,
      sortOrder: i,
    });
    guidesCreated++;
  }
  return { categoryCreated, foldersCreated, guidesCreated, guidesSkipped };
}
