import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/landing/links";

/**
 * robots.txt — index the public website (home, /solutions, /blog, KAIZEN,
 * legal pages); keep the app, the API and every tokenised client link (risk
 * profile, feedback, proposals, forms…) out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard/", "/super-admin/", "/api/", "/portal/", "/onboarding/", "/preview",
          "/login", "/signup", "/forgot-password", "/reset-password", "/accept-invite",
          "/r/", "/f/", "/d/", "/p/", "/lc/", "/lf/", "/fd/", "/feedback/", "/complaint/", "/service-request/", "/induction/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
