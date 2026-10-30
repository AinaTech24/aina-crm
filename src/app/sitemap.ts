import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/landing/links";
import { SOLUTION_PAGES } from "@/lib/landing/solutions";
import { BLOG_POSTS } from "@/lib/landing/blog";

/**
 * Sitemap for every public, indexable page: the homepage, the /solutions
 * pages, the blog and the legal pages (the Knowledge Base is for subscribers only).
 * Login, sign-up and the app itself are left out on purpose.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/solutions`, changeFrequency: "monthly", priority: 0.9 },
    ...SOLUTION_PAGES.map((p) => ({ url: `${SITE_URL}/solutions/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.9 })),
    { url: `${SITE_URL}/blog`, changeFrequency: "weekly", priority: 0.8 },
    ...BLOG_POSTS.map((p) => ({ url: `${SITE_URL}/blog/${p.slug}`, lastModified: p.published, changeFrequency: "monthly" as const, priority: 0.7 })),
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/refund`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
