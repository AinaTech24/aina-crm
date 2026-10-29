import { asc } from "drizzle-orm";
import { kbCategories, kbFolders } from "@/db/schema";

export type KbFolderOption = { id: string; label: string };

/** Every folder as "Category › Folder", for the article editor's picker. */
export async function loadFolderOptions(tx: any): Promise<KbFolderOption[]> {
  const cats = await tx.select().from(kbCategories).orderBy(asc(kbCategories.sortOrder), asc(kbCategories.name));
  const folders = await tx.select().from(kbFolders).orderBy(asc(kbFolders.sortOrder), asc(kbFolders.name));
  return cats.flatMap((c: any) =>
    folders.filter((f: any) => f.categoryId === c.id).map((f: any) => ({ id: f.id, label: `${c.name} › ${f.name}` }))
  );
}
