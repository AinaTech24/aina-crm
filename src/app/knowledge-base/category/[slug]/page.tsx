import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { loadCategoryBySlug } from "@/lib/kb/help";
import { GuideCard, KbHero } from "@/components/kb/KbBits";

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
  const c = await loadCategoryBySlug(slug);
  if (!c) notFound();

  return (
    <>
      <KbHero
        title={c.name}
        lead={c.description}
        crumbs={[{ label: "Knowledge Base", href: "/knowledge-base" }, { label: c.name }]}
      />
      <main className="kb-w kb-main">
        {c.folders.map((f) => (
          <div key={f.id} className="kb-folder" style={{ marginTop: 0, marginBottom: 44 }}>
            <h3>
              <Link href={`/knowledge-base/folder/${f.slug}`}>{f.name}</Link>
              <small>{f.count} {f.count === 1 ? "guide" : "guides"}</small>
            </h3>
            <div className="kb-grid">
              {f.articles.map((a) => <GuideCard key={a.id} a={a} />)}
            </div>
          </div>
        ))}
      </main>
    </>
  );
}
