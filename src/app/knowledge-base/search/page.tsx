import Link from "next/link";
import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { searchHelp } from "@/lib/kb/help";
import { PublicShell } from "@/components/kb/PublicShell";
import { HelpBanner } from "@/components/kb/HelpBits";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search — Knowledge Base | Aina CRM",
  robots: { index: false, follow: true },
};

export default async function KbSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const session = await getSession().catch(() => null);
  const results = await searchHelp(q);

  return (
    <PublicShell signedIn={!!session}>
      <HelpBanner
        title={q.trim() ? `Results for “${q.trim().slice(0, 80)}”` : "Search"}
        q={q}
        crumbs={[{ label: "Home", href: "/" }, { label: "Knowledge base", href: "/knowledge-base" }, { label: "Search" }]}
      />
      <section className="max-w-4xl mx-auto px-6 pt-8">
        {results.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {q.trim().length < 2 ? "Type at least two letters to search." : "No articles match that. Try fewer or different words."}
          </div>
        ) : (
          <ul className="rounded-xl border border-border/60 bg-card shadow-sm divide-y divide-border/60">
            {results.map((a) => (
              <li key={a.id}>
                <Link href={`/knowledge-base/${a.slug}`} className="flex items-start gap-3 px-5 py-4 hover:bg-secondary/40">
                  <FileText className="size-5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block font-semibold text-primary">{a.title}</span>
                    {a.hook && <span className="block text-sm text-muted-foreground mt-0.5">{a.hook}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PublicShell>
  );
}
