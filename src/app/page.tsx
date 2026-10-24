import Link from "next/link";
import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import {
  ArrowRight, ArrowDown, Phone, ShieldCheck, Lock, Fingerprint, ScrollText, Check, Upload, Clock,
  ListChecks, Scale, type LucideIcon,
} from "lucide-react";
import { loadLandingPlans } from "@/lib/landing/packages";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { MobileNav } from "@/components/landing/MobileNav";
import { LivePricingCards } from "@/components/landing/LivePricingCards";
import { RoleDashboards } from "@/components/landing/RoleDashboards";
import { LivePractice } from "@/components/landing/LivePractice";
import { BeforeAfter } from "@/components/landing/BeforeAfter";
import { COMMUNITY_URL, DEMO_URL } from "@/lib/landing/links";

// Re-render at most once a minute so admin-managed pricing cards go live without
// a rebuild. Admin saves also fire an on-demand revalidatePath("/") for instant
// reflection (see /api/super-admin/landing-packages); this is the safety net.
export const revalidate = 60;

/** The site's display face — a warm serif against the logo's crimson and teal. */
const brandFont = Fraunces({ subsets: ["latin"], variable: "--font-brand", style: ["normal", "italic"], display: "swap" });

/* SEO — written around what Indian MFDs actually type into Google. */
export const metadata: Metadata = {
  title: "Aina CRM for Mutual Fund Distributors | MFD CRM Software for Compliance, Client Servicing & Growth",
  description:
    "Aina CRM is the CRM built only for India's Mutual Fund Distributors: CAMS & KFintech imports matched to the right client, every follow-up a task, business checked against the RTA, six role dashboards and compliance on every WhatsApp, email and SMS.",
  keywords: [
    "CRM for Mutual Fund Distributors",
    "MFD CRM software",
    "Mutual Fund Distributor CRM",
    "CRM for MFD",
    "DDQ compliance for MFD",
    "SIP rejection tracking software",
    "CAMS KFintech import software",
    "MFD business automation",
    "mutual fund distributor software",
    "MFD practice management system",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "Aina CRM — Every client. Every SIP. Handled.",
    description: "The CRM built only for mutual fund distributors. Nothing slips, audits stay ready, and your numbers match the RTA.",
    siteName: "Aina CRM",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aina CRM — Every client. Every SIP. Handled.",
    description: "The CRM built only for mutual fund distributors. Nothing slips, audits stay ready, and your numbers match the RTA.",
  },
};

/* FAQ content doubles as the FAQPage rich-snippet source — keep both in sync. */
const FAQS = [
  {
    q: "Do I have to type my clients in again?",
    a: "No. We import your CAMS and KFintech history — folios, transactions and SIPs — and match every row to the right client by PAN, so nobody is duplicated and families link as they load.",
  },
  {
    q: "Can each RM see only their own clients?",
    a: "Yes, if you want it. Access is set per person — the whole firm, a branch, a team or only their own book — and every dashboard, list and export follows it.",
  },
  {
    q: "How does it help with DDQ and audits?",
    a: "Every WhatsApp, email and SMS passes an 11-rule compliance check before it leaves. Consent, OTP-confirmed risk profiles, complaints and an audit trail of every change are recorded as you work.",
  },
  {
    q: "How do my business numbers stay honest?",
    a: "Operations books business the day it happens; the CAMS / KFintech feed confirms it days later. Aina links the two line by line and flags anything rejected, mismatched or missing.",
  },
  {
    q: "Does Aina place mutual fund transactions?",
    a: "No. Aina is a practice-management, analytics and communication platform. You transact on your usual platforms; Aina follows each one through to the RTA.",
  },
];

/** Structured data for Google rich results (Software + Organization + FAQ). */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Aina CRM",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "CRM and practice operating system for Indian Mutual Fund Distributors (MFDs): CAMS/KFintech imports matched by PAN, families with one RM, opportunity journeys to RTA confirmation, six role dashboards, AMFI/SEBI-aware messaging, service requests, insurance and FD tracking, calculators and AI.",
      offers: { "@type": "AggregateOffer", priceCurrency: "INR", lowPrice: "9999", highPrice: "14999", offerCount: "3", priceValidUntil: "2026-12-31" },
      featureList: [
        "CAMS & KFintech import with PAN-based client matching and family linking",
        "Booked business reconciled line by line against the RTA feed",
        "Opportunity journey from first call to RTA data check",
        "Six role dashboards: Owner, Branch Head, RM, Operations, Insurance, Claims",
        "11-rule AMFI/SEBI compliance gate on WhatsApp, email and SMS",
        "Login-free client links: risk profile, feedback, service request, complaint",
        "Insurance, claims and fixed deposit tracking",
        "Role-based access with row-level data isolation per firm",
      ],
    },
    {
      "@type": "Organization",
      name: "Aina Tech Services LLP",
      description: "Maker of Aina CRM — the practice-management and automation platform for Mutual Fund Distributors in India.",
      brand: "Aina CRM",
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ],
};

export default async function Home() {
  // Pricing cards are admin-managed (Super Admin → Landing packages), with a
  // hardcoded fallback so the public page never breaks.
  const plans = await loadLandingPlans();
  return (
    <main className={`${brandFont.variable} min-h-screen flex flex-col bg-site-cream text-site-text relative overflow-x-clip`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* ───────────────────────── Nav ───────────────────────── */}
      <header className="sticky top-0 z-50 bg-site-cream/85 backdrop-blur-xl border-b border-site-sand/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <Link href="/" className="inline-flex items-center hover:opacity-90 transition-opacity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aina-logo.png" alt="Aina CRM — mutual fund software for distributors" className="h-9 w-auto object-contain shrink-0" />
          </Link>
          <nav className="hidden lg:flex items-center gap-8 text-sm font-semibold text-site-muted">
            {NAV.map(([label, href]) =>
              href.startsWith("#") ? (
                <a key={href} href={href} className="hover:text-site-crimson transition-colors">{label}</a>
              ) : (
                <Link key={href} href={href} className="hover:text-site-crimson transition-colors">{label}</Link>
              )
            )}
          </nav>
          <div className="hidden lg:flex items-center gap-2">
            <Link href="/login" className="rounded-full px-4 py-2 text-sm font-semibold text-site-text hover:bg-site-sand/60 transition">
              Log in
            </Link>
            <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-site-crimson px-5 py-2.5 text-sm font-bold text-white hover:bg-site-crimson-deep transition">
              Book a demo <ArrowRight className="size-4" />
            </a>
          </div>
          <MobileNav links={NAV} demoUrl={DEMO_URL} />
        </div>
      </header>

      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 size-96 rounded-full bg-site-crimson/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute top-40 -right-40 size-96 rounded-full bg-site-ink/10 blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-20 lg:pt-20 lg:pb-28 grid lg:grid-cols-12 gap-14 lg:gap-10 items-center">
          <div className="lg:col-span-7">
            <span className="inline-flex items-center gap-2 rounded-full bg-site-paper px-3.5 py-1.5 text-xs font-bold text-site-text ring-1 ring-site-sand">
              <span className="size-1.5 rounded-full bg-site-crimson" /> Built only for India&apos;s mutual fund distributors
            </span>
            <h1 className="mt-7 font-brand text-5xl sm:text-6xl xl:text-7xl leading-none tracking-tight text-site-ink text-balance">
              Every client.<br />Every SIP.<br />
              <em className="text-site-crimson">Handled.</em>
            </h1>
            <p className="mt-7 max-w-xl text-lg sm:text-xl text-site-muted leading-relaxed">
              One calm place for your clients, families, business, team and compliance — so you can spend the day with people, not spreadsheets.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3">
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full bg-site-crimson px-8 py-4 text-base font-bold text-white shadow-lg shadow-site-crimson/25 hover:bg-site-crimson-deep transition">
                Book a demo <ArrowRight className="size-5" />
              </a>
              <a href="#promises" className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-4 text-base font-bold text-site-ink hover:bg-site-sand/60 transition">
                See what changes <ArrowDown className="size-5" />
              </a>
            </div>
            <dl className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-xl">
              {HERO_FACTS.map(([n, l]) => (
                <div key={l}>
                  <dt className="sr-only">{l}</dt>
                  <dd className="font-brand text-3xl text-site-ink">{n}</dd>
                  <dd className="mt-1 text-xs font-semibold text-site-muted leading-snug">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="lg:col-span-5 flex justify-center lg:justify-end">
            <LivePractice />
          </div>
        </div>
      </section>

      {/* ───────────────────── Marquee ───────────────────── */}
      <section aria-label="What Aina handles" className="bg-site-ink py-5 overflow-hidden">
        <div className="flex w-max animate-marquee motion-reduce:animate-none">
          {[0, 1].map((k) => (
            <ul key={k} aria-hidden={k === 1} className="flex shrink-0 items-center">
              {MARQUEE.map((w) => (
                <li key={w} className="flex items-center gap-8 pr-8 font-brand text-xl sm:text-2xl text-white/85 whitespace-nowrap">
                  {w} <span className="size-1.5 rounded-full bg-site-crimson" />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </section>

      {/* ───────────────────── Three promises ───────────────────── */}
      <section id="promises" className="py-24 lg:py-32 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <Heading kicker="Day one" title={<>Three things <em className="text-site-crimson">change</em> the day you switch on.</>} />
          <div className="mt-14 grid lg:grid-cols-3 gap-5">
            <PromiseCard icon={ListChecks} title="Nothing slips." line="Every promise becomes a task with an owner and a date. Overdue ones climb to someone who can fix them.">
              <div className="rounded-2xl bg-site-paper p-4 ring-1 ring-site-sand">
                <div className="text-xs font-bold text-site-text">Follow up · Riya&apos;s bounced SIP</div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-2xs font-bold">
                  <span className="rounded-full bg-site-cream px-2.5 py-1 text-site-muted">Due today</span>
                  <ArrowRight className="size-3 text-site-muted" />
                  <span className="rounded-full bg-site-crimson/10 px-2.5 py-1 text-site-crimson">2 days overdue</span>
                  <ArrowRight className="size-3 text-site-muted" />
                  <span className="rounded-full bg-site-ink px-2.5 py-1 text-white">Branch head told</span>
                </div>
              </div>
            </PromiseCard>
            <PromiseCard icon={ShieldCheck} title="Audit-ready. Always." line="Every message is checked before it leaves, and every change is on record — the DDQ stops being a fire drill.">
              <div className="rounded-2xl bg-site-paper p-4 ring-1 ring-site-sand flex items-center gap-4">
                <div className="relative size-16 shrink-0">
                  <svg viewBox="0 0 36 36" className="size-16 -rotate-90" aria-hidden>
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e7ddcf" strokeWidth="3.5" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#2a9d78" strokeWidth="3.5" strokeDasharray="97.4 97.4" strokeLinecap="round" />
                  </svg>
                  <span className="absolute inset-0 grid place-items-center text-2xs font-extrabold text-site-mint">11/11</span>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {["ARN / EUIN", "Disclaimer", "Consent", "Opt-out"].map((t) => (
                    <li key={t} className="inline-flex items-center gap-1 rounded-full bg-site-mint/10 px-2 py-0.5 text-2xs font-bold text-site-mint">
                      <Check className="size-3" /> {t}
                    </li>
                  ))}
                </ul>
              </div>
            </PromiseCard>
            <PromiseCard icon={Scale} title="Numbers match the RTA." line="Business your team books is checked line by line against CAMS & KFintech — targets and incentives rest on facts.">
              <div className="rounded-2xl bg-site-paper p-4 ring-1 ring-site-sand">
                <MatchBar label="Booked" value="₹2.10 Cr" width="w-full" tone="bg-site-ink" />
                <MatchBar label="RTA confirmed" value="₹2.06 Cr" width="w-11/12" tone="bg-site-mint" />
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-site-crimson/10 px-2.5 py-1 text-2xs font-bold text-site-crimson">
                  1 line rejected · flagged
                </div>
              </div>
            </PromiseCard>
          </div>
        </div>
      </section>

      {/* ───────────────────── Role dashboards ───────────────────── */}
      <section id="dashboards" className="relative bg-site-ink text-white py-24 lg:py-32 scroll-mt-16 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-site-ink-3 blur-3xl" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <Heading dark kicker="Six role dashboards" title={<>One CRM. <em className="text-site-rose">Six ways</em> to see it.</>} />
          <RoleDashboards />
        </div>
      </section>

      {/* ───────────────────── Before / after ───────────────────── */}
      <section className="py-24 lg:py-32">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <Heading kicker="Flip the switch" title={<>Same day. <em className="text-site-crimson">Different</em> practice.</>} />
          <BeforeAfter />
        </div>
      </section>

      {/* ───────────────────── Everything else + trust ───────────────────── */}
      <section id="features" className="bg-site-paper py-24 lg:py-28 scroll-mt-16 border-y border-site-sand">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-16">
          <div>
            <Heading left kicker="And the rest" title="Everything else your firm runs on." />
            <ul className="mt-8 flex flex-wrap gap-2">
              {EVERYTHING.map((t) => (
                <li key={t} className="rounded-full bg-site-cream px-4 py-2 text-sm font-semibold text-site-text ring-1 ring-site-sand">{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <Heading left kicker="Compliance & trust" title={<>Compliance isn&apos;t a setting. <em className="text-site-crimson">There&apos;s no bypass.</em></>} />
            <ul className="mt-8 grid sm:grid-cols-2 gap-x-6 gap-y-7">
              {TRUST.map((t) => (
                <li key={t.title} className="flex gap-3">
                  <span className="size-10 shrink-0 rounded-2xl bg-site-ink text-white grid place-items-center">
                    <t.icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-site-text">{t.title}</h3>
                    <p className="mt-1 text-sm text-site-muted leading-snug">{t.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ───────────────────────── Pricing ───────────────────────── */}
      <section id="pricing" className="py-24 lg:py-32 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <Heading kicker="Founding member pricing" title={<>Flat pricing. <em className="text-site-crimson">No AUM fees.</em></>} />
          <LivePricingCards initial={plans} />
          <p className="mt-10 flex items-center justify-center gap-2 text-center text-sm text-site-muted">
            <Upload className="size-4 shrink-0 text-site-crimson" />
            <span><span className="font-bold text-site-text">RTA data import</span> (one-time): ₹10,000 individual ARN · ₹20,000 corporate ARN</span>
          </p>
          <p className="mt-3 text-center text-2xs text-site-muted max-w-xl mx-auto">
            Billed annually, minimum 3 users. Setup is a one-time, per-firm fee. Training, customisation &amp; marketing services are quoted separately. Taxes as applicable.
          </p>
        </div>
      </section>

      {/* ───────────────────────── FAQ ───────────────────────── */}
      <section id="faq" className="pb-24 lg:pb-32 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4">
            <Heading left kicker="FAQ" title="Questions MFDs ask us." />
            <p className="mt-4 text-sm text-site-muted">
              Something else?{" "}
              <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-site-crimson hover:underline">
                Ask the MFD community
              </a>
              .
            </p>
          </div>
          <div className="lg:col-span-8">
            <FaqAccordion items={FAQS} />
          </div>
        </div>
      </section>

      {/* ───────────── Testimonials — real, attributable quotes only ─────────────
          Renders only when TESTIMONIALS has entries; never fabricated. */}
      {TESTIMONIALS.length > 0 && (
        <section className="pb-24 max-w-6xl mx-auto px-4 sm:px-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className="rounded-3xl bg-site-paper p-7 ring-1 ring-site-sand">
              <blockquote className="font-brand text-xl leading-snug text-site-ink">“{t.quote}”</blockquote>
              <figcaption className="mt-5 text-sm">
                <span className="font-bold">{t.name}</span>
                <span className="text-site-muted"> · {t.detail}</span>
              </figcaption>
            </figure>
          ))}
        </section>
      )}

      {/* ───────────────────────── Final CTA ───────────────────────── */}
      <section className="px-4 sm:px-6 pb-6">
        <div className="relative max-w-7xl mx-auto overflow-hidden rounded-3xl bg-site-ink px-6 py-20 sm:py-24 text-center">
          <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 -translate-x-1/2 size-96 rounded-full bg-site-ink-3 blur-3xl" />
          <div className="relative">
            <h2 className="font-brand text-4xl sm:text-6xl leading-tight text-white text-balance">
              See <em className="text-site-rose">your</em> practice on Aina.
            </h2>
            <p className="mt-5 text-lg text-white/65 inline-flex items-center gap-2">
              <Clock className="size-5" /> 30 minutes. Your clients, your questions.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full bg-site-crimson px-8 py-4 text-base font-bold text-white hover:bg-site-crimson-deep transition">
                Book a demo <ArrowRight className="size-5" />
              </a>
              <a href="tel:+918200770942" className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-8 py-4 text-base font-bold text-white ring-1 ring-white/20 hover:bg-white/15 transition">
                <Phone className="size-5" /> +91 82007 70942
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── Footer ───────────────────────── */}
      <footer className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aina-logo.png" alt="Aina CRM" className="h-9 w-auto object-contain self-start" />
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-site-muted">
            {FOOTER.map(([label, href]) =>
              /^https?:/.test(href) ? (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="hover:text-site-crimson transition-colors">{label}</a>
              ) : (
                <Link key={label} href={href} className="hover:text-site-crimson transition-colors">{label}</Link>
              )
            )}
          </nav>
        </div>
        <div className="mt-8 pt-6 border-t border-site-sand flex flex-col lg:flex-row justify-between gap-4 text-2xs text-site-muted leading-relaxed">
          <span>
            © {new Date().getFullYear()}{" "}
            <a href="https://ainatech.in" target="_blank" rel="noopener noreferrer" className="font-semibold text-site-text hover:text-site-crimson">
              Aina Tech Services LLP
            </a>
            . All rights reserved.
          </span>
          <span className="max-w-2xl lg:text-right">
            Mutual fund investments are subject to market risks. Read all scheme-related documents carefully. Aina CRM provides
            practice-management, analytics and communication tools for distributors and does not execute mutual fund transactions.
          </span>
        </div>
      </footer>
    </main>
  );
}

/* ───────────────────────── Static data ───────────────────────── */

const NAV: [string, string][] = [
  ["What changes", "#promises"],
  ["Dashboards", "#dashboards"],
  ["Features", "#features"],
  ["Pricing", "#pricing"],
  ["KAIZEN", "/knowledge-base"],
  ["FAQ", "#faq"],
];

const HERO_FACTS: [string, string][] = [
  ["6", "role dashboards"],
  ["11", "compliance checks per message"],
  ["40+", "ready automations"],
  ["60+", "client calculators"],
];

const MARQUEE = [
  "CAMS & KFintech", "SIPs", "Families", "Opportunities", "Insurance", "Fixed deposits", "WhatsApp",
  "Email", "Service requests", "Reviews", "Compliance", "Targets",
];

const EVERYTHING = [
  "Client 360", "Family mapping", "KYC from the KRA", "Leads", "Opportunities", "Proposals", "Risk profiles",
  "SIP rejections", "Business entries", "Brokerage", "Service requests", "Complaints", "Meetings", "Tasks",
  "Insurance & claims", "Fixed deposits", "Campaigns", "Email designer", "Health check", "60+ calculators", "AI assistant",
];

const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: ShieldCheck, title: "11-rule message check", body: "ARN, disclaimers, return claims, consent and opt-out — before anything sends." },
  { icon: Fingerprint, title: "Consent per channel", body: "An opt-out always blocks. Marketing needs a recorded yes." },
  { icon: Lock, title: "Walled at the database", body: "Each firm's data is isolated on every query, not just hidden on screen." },
  { icon: ScrollText, title: "Every change on record", body: "Edits, sends and decisions written to an audit trail." },
];

const FOOTER: [string, string][] = [
  ["Pricing", "#pricing"],
  ["KAIZEN", "/knowledge-base"],
  ["Community", COMMUNITY_URL],
  ["Log in", "/login"],
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Refunds", "/refund"],
];

/** Real, attributable client quotes only — leave empty until you have them. */
const TESTIMONIALS: { quote: string; name: string; detail: string }[] = [];

/* ───────────────────────── Helper components ───────────────────────── */

function Heading({ kicker, title, dark, left }: { kicker: string; title: React.ReactNode; dark?: boolean; left?: boolean }) {
  return (
    <div className={left ? "" : "text-center max-w-3xl mx-auto"}>
      <span className={`text-xs font-bold uppercase tracking-widest ${dark ? "text-site-rose" : "text-site-crimson"}`}>{kicker}</span>
      <h2 className={`mt-4 font-brand text-4xl sm:text-5xl leading-tight tracking-tight text-balance ${dark ? "text-white" : "text-site-ink"}`}>
        {title}
      </h2>
    </div>
  );
}

function PromiseCard({ icon: Icon, title, line, children }: { icon: LucideIcon; title: string; line: string; children: React.ReactNode }) {
  return (
    <article className="group rounded-3xl bg-site-sand/40 p-6 sm:p-7 flex flex-col gap-6 hover:bg-site-sand/60 transition-colors">
      <span className="size-12 rounded-2xl bg-site-ink text-white grid place-items-center group-hover:bg-site-crimson transition-colors">
        <Icon className="size-6" />
      </span>
      <div>
        <h3 className="font-brand text-3xl text-site-ink">{title}</h3>
        <p className="mt-3 text-base text-site-muted leading-relaxed">{line}</p>
      </div>
      <div className="mt-auto">{children}</div>
    </article>
  );
}

function MatchBar({ label, value, width, tone }: { label: string; value: string; width: string; tone: string }) {
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-2xs font-bold">
        <span className="text-site-muted">{label}</span>
        <span className="text-site-text tabular-nums">{value}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-site-cream">
        <div className={`h-2 rounded-full ${tone} ${width}`} />
      </div>
    </div>
  );
}
