import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { loadFolderBySlug } from "@/lib/kb/help";
import { PublicShell } from "@/components/kb/PublicShell";
import { HelpBanner } from "@/components/kb/HelpBits";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await loadFolderBySlug(slug);
  if (!r) return { title: "Not found | Aina CRM" };
  return {
    title: `${r.folder.name} — ${r.category.name} | Aina CRM Knowledge Base`,
    description: r.folder.description || `${r.folder.name} guides for Aina CRM.`,
    alternates: { canonical: `/knowledge-base/folder/${r.folder.slug}` },
  };
}

export default async function KbFolderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession().catch(() => null);
  const r = await loadFolderBySlug(slug);
  if (!r) notFound();
  const { category, folder } = r;

  return (
    <PublicShell signedIn={!!session}>
      <HelpBanner
        title={folder.name}
        subtitle={folder.description}
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Knowledge base", href: "/knowledge-base" },
          { label: category.name, href: `/knowledge-base/category/${category.slug}` },
          { label: folder.name },
        ]}
      />
      <section className="max-w-4xl mx-auto px-6 pt-8">
        <ul className="rounded-xl border border-border/60 bg-card shadow-sm divide-y divide-border/60">
          {folder.articles.map((a) => (
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
      </section>
    </PublicShell>
  );
}
