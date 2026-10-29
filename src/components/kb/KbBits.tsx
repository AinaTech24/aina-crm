/** Shared pieces of the Knowledge Base pages (new landing theme; styles in app/knowledge-base/kb.css). */

import Link from "next/link";
import type { HelpArticleRef } from "@/lib/kb/help";

export type Crumb = { label: string; href?: string };

export function KbHero({
  title,
  eyebrow = "Knowledge Base",
  lead,
  crumbs,
  q,
  search = true,
  children,
}: {
  title: string;
  eyebrow?: string;
  lead?: string | null;
  crumbs?: Crumb[];
  q?: string;
  search?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <header className="kb-hero">
      <div className="kb-w">
        {crumbs && crumbs.length > 0 && (
          <nav className="kb-crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 && <span className="sep">›</span>}
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="kb-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {lead && <p className="kb-lead">{lead}</p>}
        <div className="kb-row">
          {search && (
            <form className="kb-search" action="/knowledge-base/search" method="get" role="search">
              <input name="q" defaultValue={q} placeholder="Search the guides…" aria-label="Search the knowledge base" />
              <button type="submit">Search</button>
            </form>
          )}
          {children}
        </div>
      </div>
    </header>
  );
}

export function KbTabs({ current }: { current: "guides" | "kaizen" }) {
  return (
    <div className="kb-tabs" role="tablist" aria-label="Knowledge Base sections">
      <Link href="/knowledge-base" role="tab" aria-selected={current === "guides"} className={current === "guides" ? "cur" : undefined}>
        Knowledge Base
      </Link>
      <Link href="/knowledge-base?tab=kaizen" role="tab" aria-selected={current === "kaizen"} className={current === "kaizen" ? "cur" : undefined}>
        KAIZEN
      </Link>
    </div>
  );
}

/** A guide as a card: its first screenshot, the title and the description. */
export function GuideCard({ a }: { a: HelpArticleRef }) {
  return (
    <Link href={`/knowledge-base/${a.slug}`} className="kb-card">
      <div className="kb-thumb">
        {a.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.thumb} alt="" loading="lazy" />
        ) : (
          <span>Guide</span>
        )}
      </div>
      <div className="kb-card-b">
        <h3>{a.title}</h3>
        {a.hook && <p>{a.hook}</p>}
        <span className="more">Read the guide →</span>
      </div>
    </Link>
  );
}
