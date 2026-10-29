import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Clock } from "lucide-react";
import { SitePage } from "@/components/landing/SitePage";
import { BLOG_POSTS, formatPostDate, postBySlug } from "@/lib/landing/blog";
import { solutionBySlug } from "@/lib/landing/solutions";
import { ORG_ID, breadcrumbLd, graph, organizationLd } from "@/lib/landing/jsonld";
import { SITE_URL } from "@/lib/landing/links";

export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = postBySlug((await params).slug);
  if (!p) return {};
  const url = `/blog/${p.slug}`;
  return {
    // Brand only when it still fits in what Google shows (~60 characters).
    title: { absolute: p.title.length <= 48 ? `${p.title} | AINA CRM` : p.title },
    description: p.description,
    keywords: p.keywords,
    alternates: { canonical: url },
    openGraph: { type: "article", url, title: p.title, description: p.description, siteName: "AINA CRM", locale: "en_IN", publishedTime: p.published },
    twitter: { card: "summary_large_image", title: p.title, description: p.description },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = postBySlug((await params).slug);
  if (!p) notFound();
  const solution = solutionBySlug(p.solution);
  const crumbs: [string, string][] = [["Home", "/"], ["Blog", "/blog"], [p.title, `/blog/${p.slug}`]];
  const more = BLOG_POSTS.filter((b) => b.slug !== p.slug).slice(0, 3);

  return (
    <SitePage
      crumbs={crumbs}
      jsonLd={graph(organizationLd(), breadcrumbLd(crumbs), {
        "@type": "BlogPosting",
        headline: p.title,
        description: p.description,
        datePublished: p.published,
        dateModified: p.published,
        inLanguage: "en-IN",
        keywords: p.keywords.join(", "),
        mainEntityOfPage: `${SITE_URL}/blog/${p.slug}`,
        author: { "@id": ORG_ID },
        publisher: { "@id": ORG_ID },
        image: `${SITE_URL}/opengraph-image`,
      })}
    >
      <article className="max-w-3xl mx-auto px-4 sm:px-6 pt-12 pb-16 lg:pt-16">
        <span className="text-xs font-bold uppercase tracking-widest text-site-crimson">{p.category}</span>
        <h1 className="mt-4 font-brand text-4xl sm:text-5xl leading-tight text-site-ink text-balance">{p.title}</h1>
        <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-site-muted">
          <Clock className="size-4" /> {p.readMins} min read · <time dateTime={p.published}>{formatPostDate(p.published)}</time> · AINA CRM team
        </p>
        <p className="mt-8 text-lg text-site-text leading-relaxed">{p.intro}</p>

        {p.sections.map((s) => (
          <section key={s.h2} className="mt-10">
            <h2 className="font-brand text-2xl sm:text-3xl text-site-ink">{s.h2}</h2>
            {s.paras.map((t) => (
              <p key={t} className="mt-4 text-base sm:text-lg text-site-muted leading-relaxed">{t}</p>
            ))}
            {s.bullets && (
              <ul className="mt-4 flex flex-col gap-2.5">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-base text-site-text">
                    <Check className="size-5 mt-0.5 shrink-0 text-site-mint" /> {b}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {solution && (
          <aside className="mt-12 rounded-3xl bg-site-paper p-7 ring-1 ring-site-sand">
            <span className="text-xs font-bold uppercase tracking-widest text-site-crimson">Related solution</span>
            <Link href={`/solutions/${solution.slug}`} className="mt-2 flex items-center justify-between gap-4 font-brand text-2xl text-site-ink hover:text-site-crimson">
              {solution.navLabel} <ArrowRight className="size-5 shrink-0" />
            </Link>
          </aside>
        )}
      </article>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
        <h2 className="text-xs font-bold uppercase tracking-widest text-site-crimson">More from the blog</h2>
        <ul className="mt-5 grid md:grid-cols-3 gap-5">
          {more.map((b) => (
            <li key={b.slug}>
              <Link href={`/blog/${b.slug}`} className="block h-full rounded-3xl bg-site-paper p-6 ring-1 ring-site-sand hover:shadow-lg transition">
                <span className="text-2xs font-bold uppercase tracking-widest text-site-crimson">{b.category}</span>
                <h3 className="mt-2 font-brand text-lg leading-snug text-site-ink">{b.title}</h3>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </SitePage>
  );
}
