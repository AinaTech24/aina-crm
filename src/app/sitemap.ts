import type { MetadataRoute } from "next";
import { loadKbSlugs } from "@/lib/kb/articles";
import { SITE_URL } from "@/lib/landing/links";
import { SOLUTION_PAGES } from "@/lib/landing/solutions";
import { BLOG_POSTS } from "@/lib/landing/blog";

/**
 * Sitemap for every public, indexable page: the homepage, the /solutions
 * pages, the blog, the legal pages and every published KAIZEN article.
 * Login, sign-up and the app itself are left out on purpose.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The KB lives in the database; a sitemap must still answer if it is unreachable.
  const kb = await loadKbSlugs().catch(() => [] as Awaited<ReturnType<typeof loadKbSlugs>>);
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/solutions`, changeFrequency: "monthly", priority: 0.9 },
    ...SOLUTION_PAGES.map((p) => ({ url: `${SITE_URL}/solutions/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.9 })),
    { url: `${SITE_URL}/blog`, changeFrequency: "weekly", priority: 0.8 },
    ...BLOG_POSTS.map((p) => ({ url: `${SITE_URL}/blog/${p.slug}`, lastModified: p.published, changeFrequency: "monthly" as const, priority: 0.7 })),
    { url: `${SITE_URL}/knowledge-base`, changeFrequency: "weekly", priority: 0.7 },
    ...kb.map((a) => ({
      url: `${SITE_URL}/knowledge-base/${a.slug}`,
      lastModified: a.publishedAt ?? undefined,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/refund`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
