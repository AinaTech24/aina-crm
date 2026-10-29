/**
 * PUBLIC help-centre article, in the new landing page theme: breadcrumb, title and description,
 * then the steps with their screenshots in place, and a sidebar (print, guides in this folder,
 * more to read). Older KAIZEN stories keep their "situation" and "questions" sections.
 * Fully public — no login.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadArticle } from "@/lib/kb/articles";
import { loadArticleContext } from "@/lib/kb/help";
import { KbHero } from "@/components/kb/KbBits";
import { KbMarkdown } from "@/components/kb/KbMarkdown";
import { PrintButton } from "@/components/kb/PrintButton";
import { inlineShotNumbers, shotUrl } from "@/lib/kb/shots";
import { formatDate } from "@/lib/format";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = await loadArticle(slug);
  if (!a) return { title: "Not found | Aina CRM" };
  const t = a.seoTitle || `${a.title} | Aina CRM Knowledge Base`;
  const d = a.seoDescription || a.hook || `How to: ${a.title} — step by step in Aina CRM.`;
  const first = a.screenshots[0]?.storageKey;
  return {
    title: t,
    description: d,
    alternates: { canonical: `/knowledge-base/${a.slug}` },
    openGraph: { title: t, description: d, type: "article", ...(first?.startsWith("/") ? { images: [first] } : {}) },
  };
}

export default async function KbArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await loadArticle(slug);
  if (!a) notFound();

  const { category, folder, inFolder, related } = await loadArticleContext(a.id, a.folderId);
  // Screenshots the author did not place in the text still show, after it.
  const placed = inlineShotNumbers(`${a.scenarioMd}\n${a.solutionMd}`);
  const unplaced = a.screenshots.filter((s) => !placed.has(s.index + 1));
  const shotRefs = a.screenshots.map((s) => ({ storageKey: s.storageKey, caption: s.caption, alt: s.alt }));
  const isStory = !!a.scenarioMd.trim() || a.questions.length > 0;

  const crumbs = [
    { label: "Knowledge Base", href: "/knowledge-base" },
    ...(category ? [{ label: category.name, href: `/knowledge-base/category/${category.slug}` }] : []),
    ...(folder ? [{ label: folder.name, href: `/knowledge-base/folder/${folder.slug}` }] : []),
  ];

  return (
    <>
      <KbHero
        title={a.title}
        eyebrow={`${category?.name ?? "Knowledge Base"} · updated ${formatDate(new Date(a.updatedAt))}${a.readMinutes ? ` · ${a.readMinutes} min read` : ""}`}
        lead={a.hook}
        crumbs={crumbs}
        search={false}
      />

      <div className="kb-w kb-main">
        <div className="kb-art">
          <article>
            {isStory && (
              <>
                {a.scenarioMd.trim() && (
                  <>
                    <h2 style={{ fontSize: "1.6rem", marginBottom: 12 }}>The situation</h2>
                    <KbMarkdown text={a.scenarioMd} articleId={a.id} shots={shotRefs} />
                  </>
                )}
                {a.questions.length > 0 && (
                  <div style={{ margin: "28px 0", padding: "22px 26px", background: "var(--soft)", borderRadius: 20, border: "1.5px solid var(--edge)" }}>
                    <h3 style={{ fontSize: "1.1rem" }}>The questions this raises</h3>
                    <ul className="kb-qs" style={{ marginTop: 12 }}>
                      {a.questions.map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                  </div>
                )}
                {a.solutionMd.trim() && <h2 style={{ fontSize: "1.6rem", margin: "32px 0 12px" }}>How Aina CRM handles it</h2>}
              </>
            )}

            <KbMarkdown text={a.solutionMd} articleId={a.id} shots={shotRefs} />

            {unplaced.length > 0 && (
              <div className="kb-prose">
                {unplaced.map((s) => (
                  <figure key={s.index}>
                    <a href={shotUrl(a.id, s.index, s.storageKey)} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={shotUrl(a.id, s.index, s.storageKey)} alt={s.alt || s.caption || `${a.title} — screenshot ${s.index + 1}`} loading="lazy" />
                    </a>
                    {s.caption && <figcaption>{s.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            )}

            <div className="kb-cta">
              <h3>Want this running on your own book?</h3>
              <p>See Aina CRM with your own clients — book a short demo and we will set it up with you.</p>
              <a
                className="btn p"
                href="https://wa.me/918200770942?text=Hi%2C%20I'd%20like%20a%20demo%20of%20Aina%20CRM%20for%20my%20MFD%20practice."
                target="_blank"
                rel="noopener noreferrer"
              >
                Book a Demo →
              </a>
            </div>
          </article>

          <aside className="kb-aside">
            <PrintButton />
            {folder && inFolder.length > 0 && (
              <>
                <h4>Guides in this folder</h4>
                <ul>
                  {inFolder.map((x) => (
                    <li key={x.id}>
                      <Link href={`/knowledge-base/${x.slug}`} className={x.id === a.id ? "cur" : undefined}>{x.title}</Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {related.length > 0 && (
              <>
                <h4>You may like to read</h4>
                <ul>
                  {related.map((x) => (
                    <li key={x.id}><Link href={`/knowledge-base/${x.slug}`}>{x.title}</Link></li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
