import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { loadCategoryBySlug } from "@/lib/kb/help";
import { PublicShell } from "@/components/kb/PublicShell";
import { FolderBlock, HelpBanner } from "@/components/kb/HelpBits";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await loadCategoryBySlug(slug);
  if (!c) return { title: "Not found | Aina CRM" };
  return {
    title: `${c.name} — Knowledge Base | Aina CRM`,
    description: c.description || `Guides for ${c.name} in Aina CRM.`,
    alternates: { canonical: `/knowledge-base/category/${c.slug}` },
  };
}

export default async function KbCategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession().catch(() => null);
  const c = await loadCategoryBySlug(slug);
  if (!c) notFound();

  return (
    <PublicShell signedIn={!!session}>
      <HelpBanner
        title={c.name}
        subtitle={c.description}
        crumbs={[{ label: "Home", href: "/" }, { label: "Knowledge base", href: "/knowledge-base" }, { label: c.name }]}
      />
      <section className="max-w-6xl mx-auto px-6 pt-8">
        <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden grid md:grid-cols-2 [&>*]:border-border/60 [&>*:not(:first-child)]:border-t md:[&>*:nth-child(2)]:border-t-0 md:[&>*:nth-child(odd)]:border-r">
          {c.folders.map((f) => (
            <FolderBlock key={f.id} folder={f} limit={5} />
          ))}
        </div>
      </section>
    </PublicShell>
  );
}
