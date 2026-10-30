/**
 * Every /knowledge-base page wears the new landing page's theme: its fonts, colours,
 * floating pill navbar and footer. (kb.css is scoped to .kb-site — see the note there.)
 */

import { notFound } from "next/navigation";
import "./kb.css";
import { canReadKnowledgeBase } from "@/lib/kb/access";
import { KbNav } from "@/components/kb/KbNav";
import { KbFooter } from "@/components/kb/KbFooter";

// Gated per request (session cookie), so no page under here is statically cached.
export default async function KnowledgeBaseLayout({ children }: { children: React.ReactNode }) {
  if (!(await canReadKnowledgeBase())) notFound();
  return (
    <div className="kb-site">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap"
      />
      <KbNav />
      {children}
      <KbFooter />
    </div>
  );
}
