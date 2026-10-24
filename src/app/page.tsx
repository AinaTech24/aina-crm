import Link from "next/link";
import type { Metadata } from "next";
import {
  ShieldCheck, ArrowRight, Check, X, MessageSquare, Zap, Upload, Users2, Building2, User,
  Lock, Target, Sparkles, FileText, ListChecks, Scale, Link2, LayoutDashboard,
  Network, Briefcase, Inbox, Umbrella, PiggyBank, KeyRound, ScrollText, Fingerprint,
  ChevronRight, BadgeCheck, CalendarDays, Repeat, Phone, type LucideIcon,
} from "lucide-react";
import { loadLandingPlans } from "@/lib/landing/packages";
import { CountUp } from "@/components/landing/CountUp";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { MobileNav } from "@/components/landing/MobileNav";
import { LivePricingCards } from "@/components/landing/LivePricingCards";
import { RoleDashboards } from "@/components/landing/RoleDashboards";
import { COMMUNITY_URL, DEMO_URL } from "@/lib/landing/links";

// Re-render at most once a minute so admin-managed pricing cards go live without
// a rebuild. Admin saves also fire an on-demand revalidatePath("/") for instant
// reflection (see /api/super-admin/landing-packages); this is the safety net.
export const revalidate = 60;

/* ─────────────────────────────────────────────────────────────────────────
   SEO — written around what Indian MFDs actually type into Google:
   "mutual fund software for distributors", "MFD CRM India", "CAMS KFintech
   import software", "SIP tracking software", "mutual fund distributor app",
   "AMFI compliant WhatsApp", "trail commission reconciliation".
   ───────────────────────────────────────────────────────────────────────── */
export const metadata: Metadata = {
  title: "Aina CRM for Mutual Fund Distributors | MFD CRM Software for Compliance, Client Servicing & Growth",
  description:
    "Aina CRM is the practice operating system for Mutual Fund Distributors: CAMS & KFintech imports matched to the right client, families with one RM, opportunities from first call to RTA-confirmed, six role dashboards, compliance-checked WhatsApp & email, service requests, insurance, FDs and AI — one platform.",
  keywords: [
    "CRM for Mutual Fund Distributors",
    "MFD CRM software",
    "Mutual Fund Distributor CRM",
    "CRM for MFD",
    "DDQ compliance for MFD",
    "SIP rejection tracking software",
    "CAMS KFintech import software",
    "client servicing CRM for MFD",
    "MFD business automation",
    "mutual fund distributor software",
    "MFD practice management system",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "Aina CRM — Practice Operating System for Mutual Fund Distributors",
    description:
      "Nothing slips, audits are a download, and your numbers agree with the RTA. One system for clients, families, business, servicing, compliance and your team.",
    siteName: "Aina CRM",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aina CRM — Practice Operating System for MFDs",
    description:
      "One system for your MFD practice: clean client book, every follow-up a task, booked business checked against CAMS & KFintech, compliance on every message.",
  },
};

/* FAQ content doubles as the FAQPage rich-snippet source — keep both in sync. */
const FAQS = [
  {
    q: "What is Aina CRM?",
    a: "A CRM and practice operating system built only for Mutual Fund Distributors — client and family records, business and RTA data, opportunities, service requests, compliance, team dashboards, communication and automation in one platform.",
  },
  {
    q: "Do I have to type my clients in again?",
    a: "No. We import your CAMS and KFintech history — folios, holdings, transactions and SIPs. Each registrar row is matched to the right client by PAN, so a client you already have never gets a duplicate, and families are linked as they load.",
  },
  {
    q: "Can each RM see only their own clients?",
    a: "Yes, if you want it. Access is set per person: the whole firm, one branch, a team, or only their own book. Dashboards, lists, exports and search all follow the same rule.",
  },
  {
    q: "How does Aina CRM help with DDQ and audits?",
    a: "Every WhatsApp, email and SMS passes an 11-rule compliance check before it leaves. Consent, risk profiles (confirmed by the client's own OTP), complaints with their SLA, and an audit trail of every change are kept as you work — so an audit is a download, not a scramble.",
  },
  {
    q: "How are business figures kept honest?",
    a: "Operations books the business the day it happens; the CAMS / KFintech feed confirms it days later. Aina links the two line by line and flags anything rejected, mismatched or not found, so your targets and incentives rest on numbers that agree with the registrar.",
  },
  {
    q: "Does Aina CRM execute mutual fund transactions?",
    a: "No. Aina is a practice-management, analytics and communication platform for distributors. Transactions are placed on your usual platforms; Aina tracks them through to the RTA.",
  },
  {
    q: "Does it include AI and calculators?",
    a: "Yes — an assistant that answers questions about your own book, drafts emails and summarises meetings, plus 60+ client-ready calculators with branded PDFs.",
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
        "Practice operating system for Indian Mutual Fund Distributors (MFDs): CAMS/KFintech imports matched by PAN, family mapping with one RM, opportunity journeys to RTA confirmation, six role dashboards, AMFI/SEBI-aware messaging, service requests, insurance and FD tracking, calculators and AI.",
      offers: { "@type": "AggregateOffer", priceCurrency: "INR", lowPrice: "9999", highPrice: "14999", offerCount: "3", priceValidUntil: "2026-12-31" },
      featureList: [
        "CAMS & KFintech import with PAN-based client matching and family linking",
        "Booked business reconciled line by line against the RTA feed",
        "Opportunity journey from first call to RTA data check, with gates",
        "Six role dashboards: Owner, Branch Head, RM, Operations, Insurance, Claims",
        "11-rule AMFI/SEBI compliance gate on WhatsApp, email and SMS",
        "Login-free client links: risk profile, feedback, service request, complaint",
        "Insurance, claims and fixed deposit tracking with renewal and maturity reminders",
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
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

export default async function Home() {
  // Pricing cards are admin-managed (Super Admin → Landing packages), with a
  // hardcoded fallback so the public page never breaks.
  const plans = await loadLandingPlans();
  return (
    <main className="min-h-screen flex flex-col bg-background relative overflow-x-clip">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* ───────────────────────── Nav ───────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <Link href="/" className="inline-flex items-center hover:opacity-90 transition-opacity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aina-logo.png" alt="Aina CRM — mutual fund software for distributors" className="h-8 w-auto object-contain shrink-0" />
          </Link>
          <nav className="hidden lg:flex items-center gap-7 text-sm font-semibold text-muted-foreground">
            {NAV.map(([label, href]) =>
              href.startsWith("#") ? (
                <a key={href} href={href} className="hover:text-primary transition-colors">{label}</a>
              ) : (
                <Link key={href} href={href} className="hover:text-primary transition-colors">{label}</Link>
              )
            )}
          </nav>
          <div className="hidden lg:flex items-center gap-3">
            <Link href="/login" className="text-sm font-semibold px-4 py-2 rounded-lg hover:bg-secondary text-foreground/80 hover:text-foreground transition-all">
              Log in
            </Link>
            <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm font-semibold shadow-glow-navy">
              Book a demo <ArrowRight className="size-4" />
            </a>
          </div>
          <MobileNav links={NAV} demoUrl={DEMO_URL} />
        </div>
      </header>

      {/* ───────────────────────── Hero ─────────────────────────
          The promise in outcomes, then the product as it actually looks: the
          Owner Dashboard's headline tiles and its "needs attention" list. */}
      <section className="relative pt-10 pb-16 lg:pt-16 lg:pb-24 z-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent"
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          <div className="lg:col-span-6 flex flex-col items-start text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/5 px-3.5 py-1.5 text-xs font-semibold text-success mb-6">
              <span className="size-2 rounded-full bg-success animate-pulse" />
              Built only for Indian Mutual Fund Distributors
            </span>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight text-foreground text-balance">
              Every client, every SIP, every follow-up — <span className="text-primary">on one system</span>.
            </h1>

            <p className="mt-5 text-lg text-muted-foreground max-w-xl">
              Aina CRM runs your MFD practice end to end: a clean client book from CAMS &amp; KFintech, business that
              agrees with the registrar, every promise turned into a task, and compliance on every message.
            </p>

            <div className="mt-8 flex flex-wrap gap-3 w-full sm:w-auto">
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="btn-primary text-base px-7 py-3 w-full sm:w-auto justify-center">
                Book a demo <ArrowRight className="size-5" />
              </a>
              <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary text-base px-7 py-3 w-full sm:w-auto justify-center">
                Join the MFD community
              </a>
            </div>

            <div className="mt-10 flex flex-wrap gap-2.5">
              <TrustChip icon={ShieldCheck} tone="text-success" label="AMFI & SEBI-aware" />
              <TrustChip icon={Lock} tone="text-primary" label="Your data isolated" />
              <TrustChip icon={Upload} tone="text-warning" label="CAMS & KFintech ready" />
            </div>
          </div>

          <div className="lg:col-span-6 w-full flex justify-center lg:justify-end">
            <HeroDashboard />
          </div>
        </div>
      </section>

      {/* ───────────────────── Numbers ───────────────────── */}
      <section className="border-y border-border/40 bg-secondary/20 relative z-10 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-2 md:grid-cols-5 gap-y-8 md:divide-x md:divide-border/50">
          <Stat value={6} label="Role dashboards" />
          <Stat value={11} label="Compliance checks" />
          <Stat value={40} suffix="+" label="Ready automations" />
          <Stat value={13900} suffix="+" label="Schemes valued daily" />
          <Stat value={60} suffix="+" label="Client calculators" />
        </div>
      </section>

      {/* ───────────────────── The value ─────────────────────
          Outcomes first, each backed by what the product actually does. */}
      <section id="value" className="py-20 lg:py-24 relative z-10 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionTitle
            eyebrow="What you get"
            title="Six things your practice gains on day one"
            lead="Not a list of screens — the outcomes your clients, your team and your auditor will notice."
          />
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {VALUES.map((v) => (
              <article key={v.title} className="rounded-2xl border border-border/60 bg-card p-6 flex flex-col gap-4 hover:shadow-lg hover:-translate-y-0.5 transition-all">
                <span className={`size-11 rounded-xl grid place-items-center ${v.tone}`}>
                  <v.icon className="size-5" />
                </span>
                <div>
                  <h3 className="text-lg font-extrabold tracking-tight text-foreground">{v.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{v.body}</p>
                </div>
                <ul className="mt-auto flex flex-col gap-1.5 border-t border-border/50 pt-4">
                  {v.proof.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-xs text-foreground/80">
                      <Check className="size-3.5 mt-0.5 shrink-0 text-success" /> {p}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────── The journey ─────────────────────
          The opportunity blueprint, as the CRM runs it. */}
      <section id="journey" className="py-20 lg:py-24 bg-secondary/20 border-y border-border/40 relative z-10 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionTitle
            eyebrow="From first call to RTA-confirmed"
            title="Every sale follows the same safe path"
            lead="An existing client asking for a new SIP, insurance or an FD becomes an opportunity on their record — never a duplicate lead. Each step has an owner, a follow-up date and, where it matters, a gate."
          />

          <ol className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {JOURNEY.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-border/60 bg-card p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="size-7 rounded-full bg-primary text-primary-foreground text-xs font-extrabold grid place-items-center">{i + 1}</span>
                  {s.gate && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning px-2 py-0.5 text-2xs font-bold">
                      <Lock className="size-3" /> Gate
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-bold text-foreground">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-snug">{s.body}</p>
              </li>
            ))}
          </ol>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            Insurance and FDs take their own branch (proposal form → underwriting → issued, or executed). A client who
            wants it <span className="font-semibold text-foreground">later</span> is parked, not lost — and a lost one
            keeps its reason.
          </p>

          <div className="mt-8 grid md:grid-cols-3 gap-4">
            <JourneyNote icon={BadgeCheck} title="Steps already done are skipped" body="KYC verified, UCC on record, a mandate that covers the SIP — the journey passes them and notes why." />
            <JourneyNote icon={CalendarDays} title="“After Diwali” is a real answer" body="Park it with a revisit date. One reminder reaches the RM ahead of time; overdue ones reach the branch head." />
            <JourneyNote icon={Target} title="Cross-sell you can measure" body="Products per client counted from what records prove — AUM, in-force policies, live FDs." />
          </div>
        </div>
      </section>

      {/* ───────────────────── Role dashboards ───────────────────── */}
      <section id="dashboards" className="py-20 lg:py-24 relative z-10 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionTitle
            eyebrow="Six role dashboards"
            title="Everyone opens to their own work"
            lead="Seeing a dashboard never widens what it counts: each person's figures follow their access — the firm, a branch, their team or only themselves."
          />
          <RoleDashboards />
        </div>
      </section>

      {/* ───────────────────── Modules ───────────────────── */}
      <section id="features" className="py-20 lg:py-24 bg-secondary/20 border-y border-border/40 relative z-10 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionTitle eyebrow="Everything in one place" title="What the platform covers" />
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {MODULES.map((m) => (
              <article key={m.title} className="rounded-2xl border border-border/60 bg-card p-5 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className={`size-10 rounded-xl grid place-items-center shrink-0 ${m.tone}`}>
                    <m.icon className="size-5" />
                  </span>
                  <h3 className="font-bold text-sm text-foreground">{m.title}</h3>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {m.items.map((it) => (
                    <li key={it} className="flex items-start gap-1.5 text-xs text-foreground/80">
                      <ChevronRight className="size-3.5 mt-0.5 shrink-0 text-primary" /> {it}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────── Before / after ───────────────────── */}
      <section className="py-20 lg:py-24 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <SectionTitle eyebrow="The difference" title="From Excel, memory and WhatsApp — to a system" />
          <div className="mt-12 rounded-2xl border border-border/60 bg-card overflow-hidden">
            <div className="hidden sm:grid grid-cols-12 bg-secondary/60 px-5 py-3 text-2xs font-bold uppercase tracking-wider text-muted-foreground">
              <span className="col-span-3">Moment</span>
              <span className="col-span-4">Without a system</span>
              <span className="col-span-5">With Aina CRM</span>
            </div>
            <ul className="divide-y divide-border/60">
              {COMPARE.map((c) => (
                <li key={c.moment} className="grid sm:grid-cols-12 gap-2 sm:gap-0 px-5 py-4 items-start">
                  <span className="sm:col-span-3 text-sm font-bold text-foreground">{c.moment}</span>
                  <span className="sm:col-span-4 flex items-start gap-2 text-sm text-muted-foreground sm:pr-4">
                    <X className="size-4 mt-0.5 shrink-0 text-destructive" /> {c.before}
                  </span>
                  <span className="sm:col-span-5 flex items-start gap-2 text-sm text-foreground/90">
                    <Check className="size-4 mt-0.5 shrink-0 text-success" /> {c.after}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ───────────────────── Trust & compliance ───────────────────── */}
      <section id="trust" className="py-20 lg:py-24 relative z-10 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="rounded-3xl bg-foreground text-background px-6 py-12 sm:p-12 lg:p-14 grid lg:grid-cols-12 gap-10">
            <div className="lg:col-span-5">
              <span className="text-2xs font-bold uppercase tracking-widest text-background/60">Compliance &amp; trust</span>
              <h2 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-balance">
                Compliance is not a setting. There is no bypass.
              </h2>
              <p className="mt-4 text-sm text-background/70 leading-relaxed">
                Every outbound message goes through the same gate, every change is recorded, and each firm&apos;s data is
                walled off at the database — not just hidden in the screen.
              </p>
            </div>
            <ul className="lg:col-span-7 grid sm:grid-cols-2 gap-4">
              {TRUST.map((t) => (
                <li key={t.title} className="rounded-2xl bg-background/5 border border-background/10 p-4">
                  <t.icon className="size-5 text-background/80" />
                  <h3 className="mt-3 text-sm font-bold">{t.title}</h3>
                  <p className="mt-1 text-xs text-background/65 leading-relaxed">{t.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ───────────────────── How it works ───────────────────── */}
      <section id="how-it-works" className="py-20 lg:py-24 relative z-10 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionTitle eyebrow="Getting started" title="We set it up with you" />
          <ol className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6 relative">
            <span aria-hidden className="hidden lg:block absolute top-8 border-t-2 border-dashed border-border" style={{ left: "12%", right: "12%" }} />
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative flex flex-col items-center text-center gap-3">
                <span className="relative size-16 rounded-2xl bg-primary text-primary-foreground grid place-items-center shadow-lg">
                  <s.icon className="size-7" />
                  <span className="absolute -top-2 -right-2 size-6 rounded-full bg-card border border-border text-2xs font-extrabold text-foreground grid place-items-center">
                    {i + 1}
                  </span>
                </span>
                <h3 className="font-bold text-base text-foreground">{s.title}</h3>
                <p className="text-sm text-muted-foreground max-w-xs">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ───────────────────────── Pricing ───────────────────────── */}
      <section id="pricing" className="py-20 lg:py-24 bg-secondary/20 border-y border-border/40 relative z-10 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionTitle eyebrow="Founding member pricing" title="Flat pricing. No AUM fees." />

          <LivePricingCards initial={plans} />

          {/* RTA data-import add-on */}
          <div
            className="mt-8 rounded-2xl border border-primary/25 bg-card px-5 py-5 sm:px-6 max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6"
            title="We import your full history from CAMS & KFintech RTA files — folios, holdings, transactions and capital gains."
          >
            <div className="flex items-center gap-3 sm:flex-1">
              <span className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                <Upload className="size-5" />
              </span>
              <div>
                <h3 className="font-extrabold text-base text-foreground leading-tight">RTA data import</h3>
                <p className="text-2xs text-muted-foreground font-semibold mt-0.5">One-time add-on</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:w-80">
              <PriceChip icon={User} label="Individual ARN" price="₹10,000" />
              <PriceChip icon={Building2} label="Corporate ARN" price="₹20,000" />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
            <TrustChip icon={Lock} tone="text-primary" label="Data isolation" />
            <TrustChip icon={ShieldCheck} tone="text-success" label="Compliance gate" />
            <TrustChip icon={MessageSquare} tone="text-primary" label="Your own WhatsApp & email" />
            <TrustChip icon={Zap} tone="text-warning" label="Free updates" />
          </div>

          <p className="text-center text-2xs text-muted-foreground mt-6 max-w-xl mx-auto">
            * Billed annually, minimum 3 users. Setup is a one-time, per-firm fee. Training, customisation &amp; marketing services are quoted separately. Taxes as applicable.
          </p>
        </div>
      </section>

      {/* ───────────────────────── FAQ ───────────────────────── */}
      <section id="faq" className="py-20 lg:py-24 relative z-10 scroll-mt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <SectionTitle eyebrow="FAQ" title="Questions MFDs ask" />
          <div className="mt-10">
            <FaqAccordion items={FAQS} />
          </div>
        </div>
      </section>

      {/* ───────────── Testimonials — real, attributable quotes only ─────────────
          Renders only when TESTIMONIALS has entries; never fabricated. */}
      {TESTIMONIALS.length > 0 && (
        <section className="pb-20 relative z-10 max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TESTIMONIALS.map((t) => (
              <figure key={t.name} className="rounded-2xl border border-border/50 bg-card p-6 flex flex-col gap-4">
                <blockquote className="text-sm text-foreground/85 leading-relaxed flex-grow">“{t.quote}”</blockquote>
                <figcaption className="text-xs">
                  <span className="font-bold text-foreground">{t.name}</span>
                  <span className="text-muted-foreground"> · {t.detail}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* ───────────────────────── Final CTA ───────────────────────── */}
      <section className="pb-20 max-w-6xl mx-auto px-4 sm:px-6 relative z-10 w-full">
        <div className="rounded-3xl bg-primary px-6 py-12 sm:p-14 text-center shadow-2xl">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-primary-foreground text-balance">
            See your own practice on Aina CRM
          </h2>
          <p className="mt-3 text-primary-foreground/80 max-w-xl mx-auto">
            A 30-minute walkthrough on WhatsApp or a call — your questions, your workflow.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-card text-foreground hover:bg-card/90 px-7 py-3 text-base font-bold transition-all shadow-md inline-flex items-center gap-2">
              Book a demo <ArrowRight className="size-5" />
            </a>
            <a href="tel:+918200770942" className="rounded-xl border border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/15 px-7 py-3 text-base font-bold transition-all inline-flex items-center gap-2">
              <Phone className="size-5" /> Call us
            </a>
          </div>
        </div>
      </section>

      {/* ───────────────────────── Footer ───────────────────────── */}
      <footer className="border-t border-border/40 bg-secondary/20 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-10">
            <div className="col-span-2 lg:col-span-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/aina-logo.png" alt="Aina CRM" className="h-9 w-auto object-contain shrink-0" />
              <p className="mt-4 text-sm text-muted-foreground max-w-xs">
                The practice operating system for Mutual Fund Distributors.
              </p>
            </div>
            <FooterCol title="Product" links={[["What you get", "#value"], ["Opportunity journey", "#journey"], ["Role dashboards", "#dashboards"], ["Features", "#features"], ["KAIZEN", "/knowledge-base"]]} />
            <FooterCol title="Get started" links={[["Pricing", "#pricing"], ["Book a demo", DEMO_URL], ["Join the community", COMMUNITY_URL], ["Log in", "/login"]]} />
            <FooterCol title="Legal" links={[["Privacy", "/privacy"], ["Terms", "/terms"], ["Refunds", "/refund"], ["FAQ", "#faq"]]} />
          </div>

          <div className="mt-12 pt-6 border-t border-border/40 flex flex-col lg:flex-row justify-between gap-4 text-2xs text-muted-foreground leading-relaxed">
            <span>
              © {new Date().getFullYear()}{" "}
              <a href="https://ainatech.in" target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground/70 hover:text-primary transition-colors">
                Aina Tech Services LLP
              </a>
              . All rights reserved.
            </span>
            <span className="max-w-2xl lg:text-right">
              Disclaimer: Mutual fund investments are subject to market risks. Read all scheme-related
              documents carefully. Aina CRM provides practice-management, analytics and communication
              tools for distributors and does not execute mutual fund transactions.
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ───────────────────────── Static data ───────────────────────── */

const NAV: [string, string][] = [
  ["What you get", "#value"],
  ["Journey", "#journey"],
  ["Dashboards", "#dashboards"],
  ["Features", "#features"],
  ["Pricing", "#pricing"],
  ["KAIZEN", "/knowledge-base"],
  ["FAQ", "#faq"],
];

/** The outcomes. Every proof line is something the product does today. */
const VALUES: { icon: LucideIcon; tone: string; title: string; body: string; proof: string[] }[] = [
  {
    icon: ListChecks,
    tone: "bg-primary/10 text-primary",
    title: "Nothing falls through",
    body: "Every promise becomes a task with an owner and a due date — and the overdue ones climb to the person who can fix them.",
    proof: [
      "Opportunity follow-ups and revisit reminders",
      "Meeting action items become tasks on save",
      "SIP rejections and RTA checks open their own follow-up",
    ],
  },
  {
    icon: ShieldCheck,
    tone: "bg-success/10 text-success",
    title: "Audit-ready, every day",
    body: "The records a DDQ asks for are kept as you work, not assembled the week before the audit.",
    proof: [
      "11-rule check on every WhatsApp, email and SMS",
      "Risk profile confirmed by the client's own OTP",
      "Complaint register with its 21-day SLA, full audit trail",
    ],
  },
  {
    icon: Scale,
    tone: "bg-warning/10 text-warning",
    title: "Numbers that agree with the RTA",
    body: "Business booked by operations is checked line by line against the CAMS and KFintech feed — so targets and incentives rest on facts.",
    proof: [
      "Each line marked confirmed, mismatch, rejected or not found",
      "Targets count booked business, incentives what the RTA processed",
      "A rejected SIP never silently inflates a past month",
    ],
  },
  {
    icon: Users2,
    tone: "bg-brand-violet/10 text-brand-violet",
    title: "A clean client book",
    body: "One record per person, the right fields for each type of investor, and families that move together.",
    proof: [
      "RTA rows matched by PAN — no duplicate clients",
      "A family has one RM; change it once, everyone follows",
      "Individual, Minor, HUF, NRI, Company, Trust — each with its own fields",
    ],
  },
  {
    icon: Link2,
    tone: "bg-primary/10 text-primary",
    title: "Clients served without a login",
    body: "Send a link; the client does the rest on their phone, and the answer lands on their record.",
    proof: [
      "Risk profile questionnaire and feedback (NPS) links",
      "Service request form with an SR number for every request",
      "A complaint form for your own website",
    ],
  },
  {
    icon: LayoutDashboard,
    tone: "bg-success/10 text-success",
    title: "Every role sees its own work",
    body: "Owner, branch head, RM, operations, insurance and claims each open to the dashboard built for their day.",
    proof: [
      "Access by firm, branch, team or own book",
      "Each card opens onto the exact rows it counts",
      "A missing figure says “—”, never a misleading ₹0",
    ],
  },
];

const JOURNEY: { title: string; body: string; gate?: boolean }[] = [
  { title: "Identified & discussed", body: "The interest is logged on the client's record with a first follow-up date." },
  { title: "Suitability", body: "Mutual funds need a client-confirmed risk profile from the last 12 months.", gate: true },
  { title: "Proposal approved", body: "Shared with the client; the journey moves on only when they approve.", gate: true },
  { title: "KYC · UCC · mandate", body: "Checked against the records; steps already satisfied are passed.", gate: true },
  { title: "Transaction placed", body: "Recorded against the opportunity it answers." },
  { title: "Approve or reject", body: "A reviewer approves, or rejects with a reason and a fix task." },
  { title: "RTA data check", body: "A task to confirm the transaction against CAMS / KFintech.", gate: true },
  { title: "Won", body: "Cross-sell updated, a client-won task created, the RM credited." },
];

const MODULES: { icon: LucideIcon; tone: string; title: string; items: string[] }[] = [
  {
    icon: Users2,
    tone: "bg-primary/10 text-primary",
    title: "Clients & families",
    items: ["Client 360 summary on every record", "Family mapping with one RM", "KYC status from the KRA", "Exited clients kept, return automatically", "Folio transfer and client merge"],
  },
  {
    icon: Upload,
    tone: "bg-warning/10 text-warning",
    title: "RTA & business",
    items: ["CAMS & KFintech import", "Live AUM from daily NAVs", "SIP book and SIP rejections", "Business entries checked against the RTA", "Brokerage statements"],
  },
  {
    icon: Target,
    tone: "bg-success/10 text-success",
    title: "Growth",
    items: ["Leads board with SOP stages", "Opportunities and cross-sell", "Proposals the client approves", "FY targets with phasing", "Lead capture forms"],
  },
  {
    icon: Inbox,
    tone: "bg-brand-violet/10 text-brand-violet",
    title: "Servicing",
    items: ["Service requests with SLA clocks", "Complaints, routed to compliance", "Review meetings and attendees", "Review schedules per family", "Tasks with reminders and escalation"],
  },
  {
    icon: MessageSquare,
    tone: "bg-success/10 text-success",
    title: "Communication",
    items: ["WhatsApp, email and SMS", "Sent from your own mailbox", "Email designer: your logo, the RM's signature", "40+ ready automations", "Campaigns and segments"],
  },
  {
    icon: Umbrella,
    tone: "bg-primary/10 text-primary",
    title: "Insurance & claims",
    items: ["Policy register, life and general", "Renewals due and retention", "Claims desk with document checklist", "Insurance targets by line"],
  },
  {
    icon: PiggyBank,
    tone: "bg-warning/10 text-warning",
    title: "Fixed deposits & more",
    items: ["FDs with maturity maths", "Maturity reminders 15 days ahead", "Renewals linked to the original", "NPS, PMS, AIF and bonds bookings"],
  },
  {
    icon: Sparkles,
    tone: "bg-brand-violet/10 text-brand-violet",
    title: "Planning & AI",
    items: ["Financial health check filled from the CRM", "Risk profile vs suitability", "60+ calculators with branded PDFs", "AI assistant on your own book"],
  },
];

const COMPARE = [
  { moment: "A client says “call me after Diwali”", before: "Remembered by one RM, maybe.", after: "Parked with a revisit date; a reminder reaches the RM a week before." },
  { moment: "A SIP bounces", before: "Found weeks later in a statement.", after: "Flagged from the RTA feed with a follow-up task on the client." },
  { moment: "RTA files are loaded", before: "Duplicate clients, broken families.", after: "Matched by PAN; history follows the folio to the right client." },
  { moment: "Month-end business review", before: "Each RM's own spreadsheet.", after: "Booked business, already checked against CAMS and KFintech." },
  { moment: "A client needs a risk profile", before: "Paper form, signatures, scanning.", after: "A login-free link; the client confirms with their own OTP." },
  { moment: "The DDQ audit", before: "A week of searching inboxes.", after: "Consent, compliance checks and the audit trail — already recorded." },
];

const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: ShieldCheck, title: "11-rule message gate", body: "ARN / EUIN, disclaimers, guaranteed-return language, consent and opt-out — checked before anything is sent." },
  { icon: Fingerprint, title: "Consent per channel", body: "Opt-outs always block; marketing needs a recorded consent. Every send keeps its snapshot." },
  { icon: Lock, title: "Firm-level data isolation", body: "Row-level security in the database keeps each firm's data apart on every query." },
  { icon: Network, title: "Per-person access", body: "Whole firm, a branch, a team or only their own clients — set for each user." },
  { icon: KeyRound, title: "Secrets stay secret", body: "Integration keys are encrypted and write-only; sign-in supports two-factor authentication." },
  { icon: ScrollText, title: "Every change on record", body: "Client edits, RM reassignments, sends and decisions are written to an audit trail." },
];

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Upload, title: "Bring your data", body: "We import your CAMS & KFintech history and match it to clients and families." },
  { icon: Users2, title: "Set up your team", body: "Branches, roles and exactly what each person may see and do." },
  { icon: Repeat, title: "Switch on automations", body: "Connect your WhatsApp and email; turn on the reminders you want." },
  { icon: Briefcase, title: "Run the practice", body: "Everyone works from their dashboard; you watch the whole firm." },
];

/** Real, attributable client quotes only — leave empty until you have them. */
const TESTIMONIALS: { quote: string; name: string; detail: string }[] = [];

/* ───────────────────────── Helper components ───────────────────────── */

/** The Owner Dashboard as it looks in the CRM — headline tiles, then what
 *  needs attention. Sample figures, labelled as such. */
function HeroDashboard() {
  return (
    <div className="relative w-full max-w-lg sm:mt-16 sm:mb-14 lg:my-0">
      <div className="rounded-2xl w-full border border-border/60 bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-secondary/70 px-2.5 py-1.5 text-xs font-bold text-foreground">
            <LayoutDashboard className="size-3.5 text-primary" /> Owner Dashboard ▾
          </span>
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="hidden sm:inline rounded-full bg-secondary/70 px-2.5 py-1 text-2xs font-semibold text-foreground/80">This FY</span>
            <span className="text-2xs font-semibold text-muted-foreground">Sample data</span>
          </div>
        </div>

        <div className="p-4 grid grid-cols-2 gap-2.5">
          <HeroTile label="AUM" value="₹48.6 Cr" note="Balance today" />
          <HeroTile label="SIP book" value="₹38.2 L" note="Per month · balance today" />
          <HeroTile label="Net business" value="₹2.1 Cr" note="Booked · RTA-checked" />
          <HeroTile label="New clients" value="42 / 60" note="vs FY target" />
        </div>

        <div className="px-4 pb-4">
          <div className="rounded-xl border border-border/60">
            <div className="px-3 py-2 text-2xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60">
              Needs attention
            </div>
            <ul className="divide-y divide-border/60">
              <HeroRow icon={Repeat} label="SIP rejections to follow up" count="6" alarm />
              <HeroRow icon={ListChecks} label="Follow-ups overdue" count="3" alarm />
              <HeroRow icon={CalendarDays} label="Reviews due this week" count="14" />
              <HeroRow icon={Scale} label="RTA checks pending" count="2" />
            </ul>
          </div>
        </div>
      </div>

      <div className="hidden sm:flex absolute -left-8 -bottom-14 items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-2.5 shadow-xl">
        <span className="size-8 rounded-full bg-success/10 grid place-items-center">
          <ShieldCheck className="size-4 text-success" />
        </span>
        <div className="leading-tight">
          <div className="text-2xs font-bold text-foreground">Compliance check passed</div>
          <div className="text-2xs text-muted-foreground">WhatsApp · 11 of 11 rules</div>
        </div>
      </div>
      <div className="hidden sm:flex absolute right-6 -top-16 items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-2.5 shadow-xl">
        <span className="size-8 rounded-full bg-primary/10 grid place-items-center">
          <FileText className="size-4 text-primary" />
        </span>
        <div className="leading-tight">
          <div className="text-2xs font-bold text-foreground">Risk profile confirmed</div>
          <div className="text-2xs text-muted-foreground">by the client&apos;s OTP</div>
        </div>
      </div>
    </div>
  );
}

function HeroTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl bg-secondary/70 p-3">
      <div className="text-2xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-extrabold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-2xs text-muted-foreground">{note}</div>
    </div>
  );
}

function HeroRow({ icon: Icon, label, count, alarm }: { icon: LucideIcon; label: string; count: string; alarm?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="inline-flex items-center gap-2 text-xs text-foreground/85">
        <Icon className="size-3.5 text-muted-foreground" /> {label}
      </span>
      <span className={`min-w-7 rounded-full px-2 py-0.5 text-center text-2xs font-extrabold tabular-nums ${alarm ? "bg-destructive/10 text-destructive" : "bg-secondary text-foreground/80"}`}>
        {count}
      </span>
    </li>
  );
}

function JourneyNote({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-5 flex gap-3">
      <span className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
        <Icon className="size-4" />
      </span>
      <div>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className="text-center max-w-3xl mx-auto">
      <span className="text-2xs font-bold uppercase tracking-widest text-primary">{eyebrow}</span>
      <h2 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground text-balance">{title}</h2>
      {lead && <p className="mt-4 text-base text-muted-foreground text-balance">{lead}</p>}
    </div>
  );
}

function TrustChip({ icon: Icon, tone, label }: { icon: LucideIcon; tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80">
      <Icon className={`size-3.5 ${tone}`} /> {label}
    </span>
  );
}

function PriceChip({ icon: Icon, label, price }: { icon: LucideIcon; label: string; price: string }) {
  return (
    <div className="rounded-xl bg-secondary/50 px-3 py-2.5 text-center">
      <div className="inline-flex items-center gap-1 text-2xs font-bold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5 text-primary" /> {label}
      </div>
      <div className="mt-0.5 text-xl font-extrabold text-foreground tabular-nums">{price}</div>
    </div>
  );
}

function Stat({ value, suffix, label }: { value: number; suffix?: string; label: string }) {
  return (
    <div className="text-center flex flex-col items-center justify-center px-2">
      <div className="text-3xl sm:text-4xl font-extrabold tracking-tight text-primary tabular-nums">
        <CountUp value={value} suffix={suffix} />
      </div>
      <div className="text-xs text-muted-foreground font-semibold mt-1.5">{label}</div>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/70">{title}</h4>
      <ul className="mt-4 flex flex-col gap-2.5">
        {links.map(([label, href]) => (
          <li key={label}>
            {/^https?:/.test(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                {label}
              </a>
            ) : (
              <Link href={href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                {label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
