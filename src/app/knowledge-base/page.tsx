/**
 * PUBLIC Knowledge Base home, in the new landing page theme, with two tabs:
 *   Knowledge Base — step-by-step guides with screenshots (categories → folders → guides)
 *   KAIZEN         — real situations from an MFD practice and how the CRM handles each
 * Everything is free to read. Structure and content are managed by the AINA super admin.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { loadHelpTree } from "@/lib/kb/help";
import { loadKbCards } from "@/lib/kb/articles";
import { CategoryBox, KbHero, KbTabs } from "@/components/kb/KbBits";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Knowledge Base | Aina CRM for Mutual Fund Distributors",
  description:
    "Step-by-step guides with screenshots for every part of Aina CRM, and KAIZEN: real situations from an MFD practice and how the CRM handles each one.",
  alternates: { canonical: "/knowledge-base" },
};

export default async function KnowledgeBasePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const kaizenTab = tab === "kaizen";
  const [tree, kaizen] = await Promise.all([loadHelpTree(), loadKbCards("KAIZEN")]);
  // KAIZEN stories have their own tab, so they are not repeated in the guides.
  const guides = tree.filter((c) => c.slug.toLowerCase() !== "kaizen");

  return (
    <>
      <KbHero
        title={kaizenTab ? "KAIZEN — one improvement at a time" : "How to do everything in Aina CRM"}
        lead={
          kaizenTab
            ? "Real situations from an Indian MFD's practice — a missed SIP, a dormant client, an audit query — and exactly how Aina CRM handles each one."
            : "Step-by-step guides with screenshots for every part of Aina CRM. Find your module, follow the steps."
        }
      >
        <KbTabs current={kaizenTab ? "kaizen" : "guides"} />
      </KbHero>

      <main className="kb-w kb-main">
        {kaizenTab ? (
          kaizen.length === 0 ? (
            <div className="kb-empty">The first KAIZEN entry is on its way.</div>
          ) : (
            <div className="kb-grid">
              {kaizen.map((c) => (
                <Link key={c.slug} href={`/knowledge-base/${c.slug}`} className="kb-card">
                  <div className="kb-card-b" style={{ paddingTop: 24 }}>
                    <span className="kb-tag">
                      {c.series}
                      {c.episodeNo != null ? ` #${c.episodeNo}` : ""}
                      {c.readMinutes ? ` · ${c.readMinutes} min` : ""}
                    </span>
                    <h3>{c.title}</h3>
                    {c.hook && <p>{c.hook}</p>}
                    {c.questions.length > 0 && (
                      <ul className="kb-qs">
                        {c.questions.slice(0, 3).map((q, i) => <li key={i}>{q}</li>)}
                      </ul>
                    )}
                    <span className="more">Read the walkthrough →</span>
                  </div>
                </Link>
              ))}
            </div>
          )
        ) : guides.length === 0 ? (
          <div className="kb-empty">The guides are on their way. Check back shortly.</div>
        ) : (
          guides.map((c) => (
            <CategoryBox key={c.id} name={c.name} description={c.description} href={`/knowledge-base/category/${c.slug}`} folders={c.folders} />
          ))
        )}
      </main>
    </>
  );
}
