import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Clock } from "lucide-react";
import { SitePage } from "@/components/landing/SitePage";
import { BLOG_POSTS, formatPostDate } from "@/lib/landing/blog";
import { breadcrumbLd, graph, organizationLd } from "@/lib/landing/jsonld";
import { SITE_URL } from "@/lib/landing/links";

export const metadata: Metadata = {
  title: { absolute: "Blog for Mutual Fund Distributors | DDQ, SIP, CRM & Practice Management — AINA CRM" },
  description:
    "Practical guides for Mutual Fund Distributors in India: AMFI DDQ preparation, reducing SIP bounces, CAMS & KFintech data, client reviews and moving from Excel to a CRM.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndex() {
  const posts = [...BLOG_POSTS].sort((a, b) => b.published.localeCompare(a.published));
  return (
    <SitePage
      crumbs={[["Home", "/"], ["Blog", "/blog"]]}
      jsonLd={graph(
        organizationLd(),
        breadcrumbLd([["Home", "/"], ["Blog", "/blog"]]),
        {
          "@type": "Blog",
          name: "AINA CRM Blog",
          url: `${SITE_URL}/blog`,
          blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${SITE_URL}/blog/${p.slug}`, datePublished: p.published })),
        },
      )}
    >
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
        <span className="text-xs font-bold uppercase tracking-widest text-site-crimson">Blog</span>
        <h1 className="mt-4 font-brand text-4xl sm:text-6xl leading-tight text-site-ink text-balance max-w-3xl">
          Practical guides for <em className="text-site-crimson">Mutual Fund Distributors.</em>
        </h1>
        <p className="mt-5 text-lg text-site-muted max-w-2xl">Compliance, SIPs, client servicing and running your practice — one question answered at a time.</p>
        <ul className="mt-14 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {posts.map((p) => (
            <li key={p.slug}>
              <Link href={`/blog/${p.slug}`} className="group flex h-full flex-col rounded-3xl bg-site-paper p-7 ring-1 ring-site-sand hover:shadow-xl transition">
                <span className="text-xs font-bold uppercase tracking-widest text-site-crimson">{p.category}</span>
                <h2 className="mt-3 font-brand text-xl leading-snug text-site-ink">{p.title}</h2>
                <p className="mt-3 text-sm text-site-muted leading-relaxed line-clamp-3">{p.description}</p>
                <span className="mt-auto pt-5 flex items-center justify-between text-xs font-semibold text-site-muted">
                  <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" /> {p.readMins} min read · {formatPostDate(p.published)}</span>
                  <ArrowRight className="size-4 text-site-crimson group-hover:translate-x-0.5 transition" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </SitePage>
  );
}
