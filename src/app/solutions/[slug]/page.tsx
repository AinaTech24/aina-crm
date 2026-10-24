import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { SitePage } from "@/components/landing/SitePage";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { SOLUTION_PAGES, solutionBySlug } from "@/lib/landing/solutions";
import { BLOG_POSTS } from "@/lib/landing/blog";
import { breadcrumbLd, faqLd, graph, organizationLd } from "@/lib/landing/jsonld";
import { DEMO_URL } from "@/lib/landing/links";

export const dynamicParams = false;

export function generateStaticParams() {
  return SOLUTION_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = solutionBySlug((await params).slug);
  if (!p) return {};
  const url = `/solutions/${p.slug}`;
  return {
    title: { absolute: p.title },
    description: p.description,
    keywords: p.keywords,
    alternates: { canonical: url },
    openGraph: { type: "website", url, title: p.title, description: p.description, siteName: "AINA CRM", locale: "en_IN" },
    twitter: { card: "summary_large_image", title: p.title, description: p.description },
  };
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = solutionBySlug((await params).slug);
  if (!p) notFound();
  const crumbs: [string, string][] = [["Home", "/"], ["Solutions", "/solutions"], [p.navLabel, `/solutions/${p.slug}`]];
  const others = SOLUTION_PAGES.filter((o) => o.slug !== p.slug);
  const reading = BLOG_POSTS.filter((b) => b.solution === p.slug);

  return (
    <SitePage crumbs={crumbs} jsonLd={graph(organizationLd(), breadcrumbLd(crumbs), faqLd(p.faqs))}>
      <article>
        <header className="max-w-4xl mx-auto px-4 sm:px-6 pt-12 pb-10 lg:pt-16">
          <span className="text-xs font-bold uppercase tracking-widest text-site-crimson">{p.kicker}</span>
          <h1 className="mt-4 font-brand text-4xl sm:text-6xl leading-tight text-site-ink text-balance">{p.h1}</h1>
          {p.intro.map((t) => (
            <p key={t} className="mt-6 text-lg text-site-muted leading-relaxed">{t}</p>
          ))}
          <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center gap-2 rounded-full bg-site-crimson px-7 py-3.5 text-base font-bold text-white hover:bg-site-crimson-deep transition">
            Book a Demo <ArrowRight className="size-5" />
          </a>
        </header>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid md:grid-cols-2 gap-5 pb-16">
          {p.sections.map((s) => (
            <section key={s.h2} className="rounded-3xl bg-site-paper p-7 ring-1 ring-site-sand">
              <h2 className="font-brand text-2xl text-site-ink">{s.h2}</h2>
              <p className="mt-3 text-base text-site-muted leading-relaxed">{s.body}</p>
              {s.bullets && (
                <ul className="mt-4 flex flex-col gap-2">
                  {s.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-site-text">
                      <Check className="size-4 mt-0.5 shrink-0 text-site-mint" /> {b}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-16">
          <h2 className="font-brand text-3xl sm:text-4xl text-site-ink">Frequently asked questions</h2>
          <div className="mt-6">
            <FaqAccordion items={p.faqs} />
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20 grid lg:grid-cols-2 gap-10">
          {reading.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-site-crimson">Related reading</h2>
              <ul className="mt-4 flex flex-col gap-3">
                {reading.map((b) => (
                  <li key={b.slug}>
                    <Link href={`/blog/${b.slug}`} className="font-brand text-xl text-site-ink hover:text-site-crimson">{b.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-site-crimson">More solutions</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {others.map((o) => (
                <li key={o.slug}>
                  <Link href={`/solutions/${o.slug}`} className="font-brand text-xl text-site-ink hover:text-site-crimson">{o.navLabel}</Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </article>
    </SitePage>
  );
}
