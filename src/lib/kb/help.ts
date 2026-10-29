/**
 * Help-centre loaders for the PUBLIC Knowledge Base: category → folder → article.
 *
 * Only published categories / folders / articles are ever returned. An article
 * whose folder (or category) is unpublished is hidden from the tree but still
 * reachable by its own link — the same as an unfiled article.
 */

import { and, asc, eq, ilike, or } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { kbArticles, kbCategories, kbFolders } from "@/db/schema";
import { shotUrl } from "@/lib/kb/shots";

/** `thumb` is the article's first screenshot (the card picture), or null when it has none. */
export type HelpArticleRef = { id: string; slug: string; title: string; hook: string | null; thumb: string | null };

const thumbOf = (id: string, shots: unknown): string | null => {
  const first = Array.isArray(shots) ? (shots[0] as { storageKey?: string } | undefined) : undefined;
  return first?.storageKey ? shotUrl(id, 0, first.storageKey) : null;
};
export type HelpFolder = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  count: number;
  articles: HelpArticleRef[];
};
export type HelpCategory = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  count: number;
  folders: HelpFolder[];
};

type ArticleRow = HelpArticleRef & { folderId: string | null; sortOrder: number; episodeNo: number | null };

const byOrder = (a: ArticleRow, b: ArticleRow) =>
  a.sortOrder - b.sortOrder ||
  (a.episodeNo ?? 1e9) - (b.episodeNo ?? 1e9) ||
  a.title.localeCompare(b.title);

/** The whole published tree. Empty folders and empty categories are left out. */
export async function loadHelpTree(): Promise<HelpCategory[]> {
  try {
    const { cats, folders, arts } = await withSystem(async (tx) => ({
      cats: await tx
        .select()
        .from(kbCategories)
        .where(eq(kbCategories.published, true))
        .orderBy(asc(kbCategories.sortOrder), asc(kbCategories.name)),
      folders: await tx
        .select()
        .from(kbFolders)
        .where(eq(kbFolders.published, true))
        .orderBy(asc(kbFolders.sortOrder), asc(kbFolders.name)),
      arts: await tx
        .select({
          id: kbArticles.id,
          slug: kbArticles.slug,
          title: kbArticles.title,
          hook: kbArticles.hook,
          folderId: kbArticles.folderId,
          sortOrder: kbArticles.sortOrder,
          episodeNo: kbArticles.episodeNo,
          screenshots: kbArticles.screenshots,
        })
        .from(kbArticles)
        .where(eq(kbArticles.published, true))
        .limit(3000),
    }));
    const sorted: ArticleRow[] = arts
      .map((a) => ({ id: a.id, slug: a.slug, title: a.title, hook: a.hook, folderId: a.folderId, sortOrder: a.sortOrder, episodeNo: a.episodeNo, thumb: thumbOf(a.id, a.screenshots) }))
      .sort(byOrder);
    return cats
      .map((c) => {
        const fs: HelpFolder[] = folders
          .filter((f) => f.categoryId === c.id)
          .map((f) => {
            const articles = sorted.filter((a) => a.folderId === f.id);
            return { id: f.id, slug: f.slug, name: f.name, description: f.description, count: articles.length, articles };
          })
          .filter((f) => f.count > 0);
        return {
          id: c.id,
          slug: c.slug,
          name: c.name,
          description: c.description,
          count: fs.reduce((n, f) => n + f.count, 0),
          folders: fs,
        };
      })
      .filter((c) => c.count > 0);
  } catch {
    return [];
  }
}

export async function loadCategoryBySlug(slug: string): Promise<HelpCategory | null> {
  const tree = await loadHelpTree();
  return tree.find((c) => c.slug.toLowerCase() === slug.toLowerCase()) ?? null;
}

export async function loadFolderBySlug(
  slug: string
): Promise<{ category: HelpCategory; folder: HelpFolder } | null> {
  const tree = await loadHelpTree();
  for (const category of tree) {
    const folder = category.folders.find((f) => f.slug.toLowerCase() === slug.toLowerCase());
    if (folder) return { category, folder };
  }
  return null;
}

/** Where an article sits, plus its folder-mates and a few from the same category. */
export async function loadArticleContext(articleId: string, folderId: string | null) {
  const tree = await loadHelpTree();
  let category: HelpCategory | null = null;
  let folder: HelpFolder | null = null;
  if (folderId) {
    for (const c of tree) {
      const f = c.folders.find((x) => x.id === folderId);
      if (f) {
        category = c;
        folder = f;
        break;
      }
    }
  }
  const inFolder = folder ? folder.articles : [];
  const pool = category
    ? category.folders.flatMap((f) => f.articles).filter((a) => !inFolder.some((x) => x.id === a.id))
    : tree.flatMap((c) => c.folders.flatMap((f) => f.articles));
  const related = pool.filter((a) => a.id !== articleId).slice(0, 5);
  return { category, folder, inFolder, related };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Title / intro / body search over published articles. */
export async function searchHelp(q: string): Promise<HelpArticleRef[]> {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const like = `%${escapeLike(term)}%`;
  try {
    const rows = await withSystem(async (tx) =>
      tx
        .select({ id: kbArticles.id, slug: kbArticles.slug, title: kbArticles.title, hook: kbArticles.hook, screenshots: kbArticles.screenshots })
        .from(kbArticles)
        .where(
          and(
            eq(kbArticles.published, true),
            or(
              ilike(kbArticles.title, like),
              ilike(kbArticles.hook, like),
              ilike(kbArticles.scenarioMd, like),
              ilike(kbArticles.solutionMd, like)
            )
          )
        )
        .orderBy(asc(kbArticles.sortOrder), asc(kbArticles.title))
        .limit(50)
    );
    return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, hook: r.hook, thumb: thumbOf(r.id, r.screenshots) }));
  } catch {
    return [];
  }
}
