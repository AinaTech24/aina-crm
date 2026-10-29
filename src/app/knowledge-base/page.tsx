/**
 * PUBLIC Knowledge Base home — the help centre. Categories as cards, each with
 * its folders and their first articles. Everything is free to read; no login.
 * Structure and content are managed by the AINA super admin
 * (/super-admin/kb-articles).
 */

import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, Layers } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { loadHelpTree } from "@/lib/kb/help";
import { PublicShell } from "@/components/kb/PublicShell";
import { FolderBlock, HelpBanner } from "@/components/kb/HelpBits";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Knowledge Base | Aina CRM for Mutual Fund Distributors",
  description:
    "Step-by-step guides with screenshots for every part of Aina CRM — clients, SIPs, leads, tasks, reports, compliance and more.",
  alternates: { canonical: "/knowledge-base" },
};

export default async function KnowledgeBasePage() {
  const session = await getSession().catch(() => null);
  const tree = await loadHelpTree();

  return (
    <PublicShell signedIn={!!session}>
      <HelpBanner
        title="Knowledge base"
        crumbs={[{ label: "Home", href: "/" }]}
        subtitle="Step-by-step guides with screenshots for every part of Aina CRM."
      />

      <section className="max-w-6xl mx-auto px-6 -mt-0 pt-8 space-y-6">
        {tree.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <BookOpen className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-3 font-semibold">The guides are on their way.</div>
            <p className="text-sm text-muted-foreground mt-1">
              Check back shortly — or{" "}
              <Link href="/signup" className="text-primary font-semibold hover:underline">start a free trial</Link>{" "}
              and explore the product now.
            </p>
          </div>
        ) : (
          tree.map((c) => (
            <div key={c.id} className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
                <Layers className="size-6 text-muted-foreground" />
                <Link href={`/knowledge-base/category/${c.slug}`} className="text-lg font-bold hover:text-primary">
                  {c.name} <span className="text-muted-foreground">({c.count})</span>
                </Link>
              </div>
              <div className="grid md:grid-cols-2 [&>*]:border-border/60 [&>*:not(:first-child)]:border-t md:[&>*:nth-child(2)]:border-t-0 md:[&>*:nth-child(odd)]:border-r">
                {c.folders.map((f) => (
                  <FolderBlock key={f.id} folder={f} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </PublicShell>
  );
}
