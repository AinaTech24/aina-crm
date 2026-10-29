/**
 * PUBLIC help-centre article: breadcrumb, title, the instructions with their
 * screenshots in place, and a sidebar (print, articles in this folder, more to
 * read). Older KAIZEN stories keep their "situation" and "questions" sections.
 *
 * FULLY PUBLIC — nothing here needs a login. A non-blocking CTA at the end
 * offers the trial.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, HelpCircle } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { loadArticle } from "@/lib/kb/articles";
import { loadArticleContext } from "@/lib/kb/help";
import { PublicShell } from "@/components/kb/PublicShell";
import { HelpBanner } from "@/components/kb/HelpBits";
import { KbMarkdown, inlineShotNumbers } from "@/components/kb/KbMarkdown";
import { PrintButton } from "@/components/kb/PrintButton";
import { formatDate } from "@/lib/format";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = await loadArticle(slug);
  if (!a) return { title: "Not found | Aina CRM" };
  const t = a.seoTitle || `${a.title} | Aina CRM Knowledge Base`;
  const d = a.seoDescription || a.hook || `How to: ${a.title} — step by step in Aina CRM.`;
  return {
    title: t,
    description: d,
    alternates: { canonical: `/knowledge-base/${a.slug}` },
    openGraph: { title: t, description: d, type: "article" },
  };
}

export default async function KbArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession().catch(() => null);
  const signedIn = !!session;
  const a = await loadArticle(slug);
  if (!a) notFound();

  const { category, folder, inFolder, related } = await loadArticleContext(a.id, a.folderId);
  // Screenshots the author did not place in the text still show, after it.
  const placed = inlineShotNumbers(`${a.scenarioMd}\n${a.solutionMd}`);
  const unplaced = a.screenshots.filter((s) => !placed.has(s.index + 1));
  const shotRefs = a.screenshots.map((s) => ({ caption: s.caption, alt: s.alt }));
  const isStory = !!a.scenarioMd.trim() || a.questions.length > 0;

  const crumbs = [
    { label: "Home", href: "/" },
    { label: "Knowledge base", href: "/knowledge-base" },
    ...(category ? [{ label: category.name, href: `/knowledge-base/category/${category.slug}` }] : []),
    ...(folder ? [{ label: folder.name, href: `/knowledge-base/folder/${folder.slug}` }] : []),
  ];

  return (
    <PublicShell signedIn={signedIn}>
      <HelpBanner
        title={a.title}
        crumbs={crumbs}
        subtitle={`Last updated ${formatDate(new Date(a.updatedAt))}${a.readMinutes ? ` · ${a.readMinutes} min read` : ""}`}
      />

      <div className="max-w-6xl mx-auto px-6 pt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] print:block">
        <article className="min-w-0 rounded-xl border border-border/60 bg-card shadow-sm p-6 sm:p-9 print:border-0 print:shadow-none print:p-0">
          {a.hook && <p className="text-base font-medium text-foreground/90 leading-relaxed">{a.hook}</p>}

          {isStory && (
            <>
              {a.scenarioMd.trim() && (
                <section className="mt-6">
                  <h2 className="text-xl font-bold text-foreground">The situation</h2>
                  <KbMarkdown text={a.scenarioMd} articleId={a.id} shots={shotRefs} />
                </section>
              )}
              {a.questions.length > 0 && (
                <section className="mt-6 rounded-lg border border-border/60 bg-secondary/20 p-5">
                  <h2 className="text-base font-bold text-foreground">The questions this raises</h2>
                  <ul className="mt-3 space-y-2">
                    {a.questions.map((q, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[15px] text-foreground/90">
                        <HelpCircle className="size-4 text-primary mt-1 shrink-0" />
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {a.solutionMd.trim() && <h2 className="mt-8 text-xl font-bold text-foreground">How Aina CRM handles it</h2>}
            </>
          )}

          <KbMarkdown text={a.solutionMd} articleId={a.id} shots={shotRefs} />

          {unplaced.map((s) => (
            <figure key={s.index} className="my-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/kb/image/${a.id}?i=${s.index}`}
                alt={s.alt || s.caption || `${a.title} — screenshot ${s.index + 1}`}
                className="w-full h-auto rounded-md border border-border/60 bg-white"
                loading="lazy"
              />
              {s.caption && <figcaption className="mt-1.5 text-xs text-muted-foreground">{s.caption}</figcaption>}
            </figure>
          ))}

          <div className="mt-10 rounded-xl border border-primary/25 bg-primary/[0.03] p-6 text-center print:hidden">
            <div className="font-bold text-foreground">Want this running on your own book?</div>
            <p className="text-sm text-muted-foreground mt-1">
              {signedIn ? "Open the module and try it with your own clients." : "Start a free trial and set it up with your own data — no card required."}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              {signedIn ? (
                <Link href="/dashboard" className="btn-primary text-sm font-semibold">
                  Open my dashboard <ArrowRight className="size-4" />
                </Link>
              ) : (
                <>
                  <Link href="/signup" className="btn-primary text-sm font-semibold">
                    Start free trial <ArrowRight className="size-4" />
                  </Link>
                  <Link href="/login" className="btn-secondary text-sm font-semibold">Log in</Link>
                </>
              )}
            </div>
          </div>
        </article>

        <aside className="space-y-6 text-sm print:hidden">
          <PrintButton />
          {folder && inFolder.length > 0 && (
            <div>
              <h2 className="font-bold text-foreground">Articles in this folder</h2>
              <ul className="mt-2 space-y-2">
                {inFolder.map((x) => (
                  <li key={x.id}>
                    <Link
                      href={`/knowledge-base/${x.slug}`}
                      className={x.id === a.id ? "font-semibold text-foreground" : "text-primary hover:underline"}
                    >
                      {x.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {related.length > 0 && (
            <div>
              <h2 className="font-bold text-foreground">You may like to read</h2>
              <ul className="mt-2 space-y-2">
                {related.map((x) => (
                  <li key={x.id}>
                    <Link href={`/knowledge-base/${x.slug}`} className="text-primary hover:underline">{x.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </PublicShell>
  );
}
