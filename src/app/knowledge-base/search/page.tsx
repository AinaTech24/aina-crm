import Link from "next/link";
import type { Metadata } from "next";
import { searchHelp } from "@/lib/kb/help";
import { KbHero } from "@/components/kb/KbBits";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search — Knowledge Base | Aina CRM",
  robots: { index: false, follow: true },
};

export default async function KbSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const results = await searchHelp(q);
  const term = q.trim().slice(0, 80);

  return (
    <>
      <KbHero
        title={term ? `Results for “${term}”` : "Search the guides"}
        q={q}
        crumbs={[{ label: "Knowledge Base", href: "/knowledge-base" }, { label: "Search" }]}
      />
      <main className="kb-w kb-main">
        {results.length === 0 ? (
          <div className="kb-empty">
            {term.length < 2 ? "Type at least two letters to search." : "No guides match that. Try fewer or different words."}
          </div>
        ) : (
          <ul className="kb-list" style={{ marginTop: 0 }}>
            {results.map((a) => (
              <li key={a.id}>
                <Link href={`/knowledge-base/${a.slug}`}>
                  <b>{a.title}</b>
                  {a.hook && <span>{a.hook}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
