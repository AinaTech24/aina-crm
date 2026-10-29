import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadFolderBySlug } from "@/lib/kb/help";
import { GuideRows, KbHero } from "@/components/kb/KbBits";

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
  const r = await loadFolderBySlug(slug);
  if (!r) notFound();
  const { category, folder } = r;

  return (
    <>
      <KbHero
        title={folder.name}
        lead={folder.description}
        crumbs={[
          { label: "Knowledge Base", href: "/knowledge-base" },
          { label: category.name, href: `/knowledge-base/category/${category.slug}` },
          { label: folder.name },
        ]}
      />
      <main className="kb-w kb-main">
        <GuideRows articles={folder.articles} />
      </main>
    </>
  );
}
