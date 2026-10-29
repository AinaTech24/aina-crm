import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { brandFont } from "@/lib/landing/font";
import { DEMO_URL } from "@/lib/landing/links";
import { SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { WhatsAppWidget } from "@/components/landing/WhatsAppWidget";

/** Page shell for the public site's inner pages: brand font, header, breadcrumb, footer. */
export function SitePage({ crumbs, jsonLd, children }: { crumbs?: [string, string][]; jsonLd?: object; children: React.ReactNode }) {
  return (
    <main className={`${brandFont.variable} min-h-screen flex flex-col bg-site-cream text-site-text overflow-x-clip`}>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
      <SiteHeader />
      {crumbs && crumbs.length > 1 && (
        <nav aria-label="Breadcrumb" className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-6">
          <ol className="flex flex-wrap items-center gap-1 text-xs font-semibold text-site-muted">
            {crumbs.map(([label, href], i) => (
              <li key={href} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5" />}
                {i < crumbs.length - 1 ? (
                  <Link href={href} className="hover:text-site-crimson">{label}</Link>
                ) : (
                  <span aria-current="page" className="text-site-text">{label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex-1">{children}</div>
      <section className="px-4 sm:px-6 pb-6">
        <div className="max-w-7xl mx-auto rounded-3xl bg-site-ink px-6 py-14 text-center">
          <h2 className="font-brand text-3xl sm:text-4xl text-white text-balance">
            See how AINA CRM fits <em className="text-site-rose">your</em> MFD business.
          </h2>
          <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center gap-2 rounded-full bg-site-crimson px-8 py-4 text-base font-bold text-white hover:bg-site-crimson-deep transition">
            Request a CRM Demo <ArrowRight className="size-5" />
          </a>
        </div>
      </section>
      <SiteFooter />
      <WhatsAppWidget />
    </main>
  );
}
