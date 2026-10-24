import Link from "next/link";
import { ArrowRight, MapPin, Mail, Phone, MessageCircle } from "lucide-react";
import { MobileNav } from "@/components/landing/MobileNav";
import { COMMUNITY_URL, CONTACT, DEMO_URL } from "@/lib/landing/links";
import { SOLUTION_PAGES } from "@/lib/landing/solutions";

/**
 * The public site's header and footer, shared by the homepage and the
 * /solutions pages so every page carries the same navigation and the same
 * internal links (search engines follow them; visitors use them).
 */

export const SITE_NAV: [string, string][] = [
  ["Features", "/#features"],
  ["Why AINA", "/#why"],
  ["Solutions", "/solutions"],
  ["Blog", "/blog"],
  ["FAQ", "/#faq"],
  ["Contact", "/#contact"],
];

export function SiteHeader({ nav = SITE_NAV }: { nav?: [string, string][] }) {
  return (
    <header className="sticky top-0 z-50 bg-site-cream/85 backdrop-blur-xl border-b border-site-sand/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Link href="/" className="inline-flex items-center hover:opacity-90 transition-opacity" aria-label="AINA CRM home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aina-logo.png" alt="AINA CRM — CRM software for mutual fund distributors" width={148} height={62} className="h-9 w-auto object-contain shrink-0" />
        </Link>
        <nav aria-label="Main" className="hidden lg:flex items-center gap-8 text-sm font-semibold text-site-muted">
          {nav.map(([label, href]) => (
            <Link key={href} href={href} className="hover:text-site-crimson transition-colors">{label}</Link>
          ))}
        </nav>
        <div className="hidden lg:flex items-center gap-2">
          <Link href="/login" className="rounded-full px-4 py-2 text-sm font-semibold text-site-text hover:bg-site-sand/60 transition">
            Log in
          </Link>
          <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-site-crimson px-5 py-2.5 text-sm font-bold text-white hover:bg-site-crimson-deep transition">
            Book a Demo <ArrowRight className="size-4" />
          </a>
        </div>
        <MobileNav links={nav} demoUrl={DEMO_URL} />
      </div>
    </header>
  );
}

const FOOTER_LINKS: [string, string][] = [
  ["Book a Demo", DEMO_URL],
  ["Community", COMMUNITY_URL],
  ["Blog", "/blog"],
  ["KAIZEN knowledge base", "/knowledge-base"],
  ["Log in", "/login"],
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Refunds", "/refund"],
];

export function SiteFooter() {
  return (
    <footer className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-12">
      <div className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aina-logo.png" alt="AINA CRM" width={148} height={62} className="h-9 w-auto object-contain" />
          <p className="mt-3 font-brand text-lg text-site-ink">AINA CRM — A smarter way to manage your MFD business.</p>
          <p className="mt-2 text-sm text-site-muted max-w-sm">
            CRM software for Mutual Fund Distributors in India: leads, clients, SIPs, reviews, tasks and business tracking in one place.
          </p>
        </div>
        <nav aria-label="Solutions" className="lg:col-span-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-site-text">Solutions</h2>
          <ul className="mt-4 flex flex-col gap-2.5 text-sm">
            {SOLUTION_PAGES.map((p) => (
              <li key={p.slug}>
                <Link href={`/solutions/${p.slug}`} className="text-site-muted hover:text-site-crimson transition-colors">{p.navLabel}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Company" className="lg:col-span-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-site-text">AINA CRM</h2>
          <ul className="mt-4 flex flex-col gap-2.5 text-sm">
            {FOOTER_LINKS.map(([label, href]) => (
              <li key={label}>
                {/^https?:/.test(href) ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-site-muted hover:text-site-crimson transition-colors">{label}</a>
                ) : (
                  <Link href={href} className="text-site-muted hover:text-site-crimson transition-colors">{label}</Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="lg:col-span-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-site-text">Reach us</h2>
          <ContactList className="mt-4" />
        </div>
      </div>
      <div className="mt-10 pt-6 border-t border-site-sand flex flex-col lg:flex-row justify-between gap-4 text-2xs text-site-muted leading-relaxed">
        <span>
          © {new Date().getFullYear()} · Developed by{" "}
          <a href="https://ainatech.in" target="_blank" rel="noopener noreferrer" className="font-semibold text-site-text hover:text-site-crimson">
            Aina Tech Services LLP
          </a>
        </span>
        <span className="max-w-2xl lg:text-right">
          Mutual fund investments are subject to market risks. Read all scheme-related documents carefully. AINA CRM provides
          practice-management, analytics and communication tools for distributors and does not execute mutual fund transactions.
        </span>
      </div>
    </footer>
  );
}

/** Address, email, phone and WhatsApp — the footer's "Reach us" and the homepage contact section. */
export function ContactList({ className = "", dark }: { className?: string; dark?: boolean }) {
  const text = dark ? "text-white/80 hover:text-white" : "text-site-muted hover:text-site-crimson";
  const icon = dark ? "text-site-rose" : "text-site-crimson";
  return (
    <address className={`not-italic flex flex-col gap-3.5 text-sm ${className}`}>
      <span className={`flex gap-2.5 ${dark ? "text-white/80" : "text-site-muted"}`}>
        <MapPin className={`size-4 mt-0.5 shrink-0 ${icon}`} />
        <span>
          {CONTACT.company},<br />
          {CONTACT.street}, {CONTACT.city}, {CONTACT.region} {CONTACT.postalCode}
        </span>
      </span>
      <a href={`mailto:${CONTACT.email}`} className={`flex items-center gap-2.5 transition-colors ${text}`}>
        <Mail className={`size-4 shrink-0 ${icon}`} /> {CONTACT.email}
      </a>
      <a href={`tel:${CONTACT.phone}`} className={`flex items-center gap-2.5 transition-colors ${text}`}>
        <Phone className={`size-4 shrink-0 ${icon}`} /> {CONTACT.phoneDisplay}
      </a>
      <a href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2.5 font-semibold transition-colors ${text}`}>
        <MessageCircle className={`size-4 shrink-0 ${icon}`} /> Chat on WhatsApp
      </a>
    </address>
  );
}
