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

const FolderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
);
const DocIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
);

type BoxFolder = { id: string; slug: string; name: string; count: number; articles: HelpArticleRef[] };

/** A category as one box: its folders in two columns, each listing its first guides and a "View all". */
export function CategoryBox({ name, description, href, folders, preview = 3 }: { name: string; description?: string | null; href: string; folders: BoxFolder[]; preview?: number }) {
  const total = folders.reduce((n, f) => n + f.count, 0);
  return (
    <section className="kb-box">
      <header className="kb-box-h">
        <FolderIcon />
        <div>
          <h2><Link href={href}>{name}</Link> <small>({total})</small></h2>
          {description && <p>{description}</p>}
        </div>
      </header>
      <div className="kb-box-g">
        {folders.map((f) => (
          <div key={f.id} className="kb-box-f">
            <h3>
              <FolderIcon />
              <Link href={`/knowledge-base/folder/${f.slug}`}>{f.name}</Link> <small>({f.count})</small>
            </h3>
            <ul>
              {f.articles.slice(0, preview).map((a) => (
                <li key={a.id}>
                  <DocIcon />
                  <Link href={`/knowledge-base/${a.slug}`}>{a.title}</Link>
                </li>
              ))}
            </ul>
            {f.count > preview && <Link className="all" href={`/knowledge-base/folder/${f.slug}`}>View all {f.count}</Link>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Guides as rows: title and description, no preview image. */
export function GuideRows({ articles }: { articles: HelpArticleRef[] }) {
  return (
    <ul className="kb-list" style={{ marginTop: 0 }}>
      {articles.map((a) => (
        <li key={a.id}>
          <Link href={`/knowledge-base/${a.slug}`}>
            <b>{a.title}</b>
            {a.hook && <span>{a.hook}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
