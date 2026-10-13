import Link from "next/link";
import type { Metadata } from "next";
import {
  ShieldCheck, TrendingUp, Brain, BarChart3, Lock, ArrowRight, Calculator, Clock, Star, Check,
  MessageSquare, Zap, Upload, Rocket, Users2, Building2, User, CalendarDays, Repeat, Target,
  Sparkles, Layers, FileText, type LucideIcon,
} from "lucide-react";
import { loadLandingPlans } from "@/lib/landing/packages";
import { CountUp } from "@/components/landing/CountUp";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { MobileNav } from "@/components/landing/MobileNav";
import { LivePricingCards } from "@/components/landing/LivePricingCards";

// Re-render at most once a minute so admin-managed pricing cards go live without
// a rebuild. Admin saves also fire an on-demand revalidatePath("/") for instant
// reflection (see /api/super-admin/landing-packages); this is the safety net.
export const revalidate = 60;

/** WhatsApp community — primary "Join Our Community" CTA across the page. */
const COMMUNITY_URL = "https://chat.whatsapp.com/C6ttmFYUtxHA7GYna5YGcN";

/* ─────────────────────────────────────────────────────────────────────────
   SEO — written around what Indian MFDs actually type into Google:
   "mutual fund software for distributors", "MFD CRM India", "CAMS KFintech
   import software", "SIP tracking software", "mutual fund distributor app",
   "AMFI compliant WhatsApp", "trail commission reconciliation".
   ───────────────────────────────────────────────────────────────────────── */
export const metadata: Metadata = {
  title: "Aina CRM for Mutual Fund Distributors | MFD CRM Software for Compliance, Client Servicing & Growth",
  description:
    "Aina CRM is a complete CRM and practice operating system for Mutual Fund Distributors. Manage DDQ compliance, client data, SIP rejections, review meetings, lead tracking, team tasks, MIS reports, marketing, automation and AI-powered business growth from one platform.",
  keywords: [
    "CRM for Mutual Fund Distributors",
    "MFD CRM software",
    "Mutual Fund Distributor CRM",
    "CRM for MFD",
    "DDQ compliance for MFD",
    "SIP rejection tracking software",
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
      "A complete CRM for MFDs: DDQ compliance, client data, SIP-rejection follow-ups, review meetings, team tasks, MIS, marketing and AI — one structured platform.",
    siteName: "Aina CRM",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aina CRM — Practice Operating System for MFDs",
    description:
      "Run your MFD practice with more control, less manual work: compliance, client data, servicing, reporting, marketing and AI in one platform.",
  },
};

/* FAQ content doubles as the FAQPage rich-snippet source — keep both in sync. */
const FAQS = [
  {
    q: "What is Aina CRM?",
    a: "A CRM and practice operating system built only for Mutual Fund Distributors — client data, compliance, reviews, service requests, team tasks, reporting and marketing in one platform.",
  },
  {
    q: "Who is Aina CRM for?",
    a: "Individual ARN holders, growing firms with RM or ops teams, and larger MFD practices. If you run on Excel, memory and WhatsApp today, it replaces all three.",
  },
  {
    q: "How does Aina CRM help with DDQ compliance?",
    a: "DDQ files, checklists, complaint registers, consent and risk-profile records stay organised continuously — so an audit is a download, not a scramble.",
  },
  {
    q: "Can it reduce missed follow-ups?",
    a: "Yes. Reviews, service requests, SIP rejections and lead follow-ups sit in one tracked queue with reminders and escalations, so fewer things slip.",
  },
  {
    q: "Does it support marketing and lead generation?",
    a: "Yes — content calendar, WhatsApp and email creatives, landing pages and lead capture, with a compliance check on every creative before it goes out.",
  },
  {
    q: "Does Aina CRM include AI?",
    a: "Yes. Ask-your-data queries, email drafting, meeting summaries, lead qualification and campaign ideas — practical AI for daily practice management.",
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
        "Mutual fund software for Indian distributors (MFDs): CAMS/KFintech auto-import, live AUM & family XIRR, SIP bounce recovery on WhatsApp, AMFI/SEBI-compliant messaging, 60+ financial calculators, branded reports and MIS.",
      offers: { "@type": "AggregateOffer", priceCurrency: "INR", lowPrice: "9999", highPrice: "14999", offerCount: "3", priceValidUntil: "2026-12-31" },
      featureList: [
        "Dynamic CAMS & KFintech file import with 3-way reconciliation",
        "Live AUM, portfolio valuation and family XIRR from daily AMFI NAVs",
        "SIP tracking with instant bounce alerts and WhatsApp recovery",
        "11-rule AMFI/SEBI compliance gate on WhatsApp, email and SMS",
        "60+ client-ready financial calculators with branded PDF output",
        "AI churn radar, cross-sell finder and tax-harvesting suggestions",
        "Trail & commission reconciliation, practice P&L and MIS reports",
        "Role-based multi-user access with row-level data isolation",
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
          <nav className="hidden md:flex items-center gap-7 text-sm font-semibold text-muted-foreground">
            <a href="#features" className="hover:text-primary transition-colors">Features</a>
            <a href="#calculators" className="hover:text-primary transition-colors">Calculators</a>
            <a href="#how-it-works" className="hover:text-primary transition-colors">How It Works</a>
            <a href="#pricing" className="hover:text-primary transition-colors">Pricing</a>
            <Link href="/knowledge-base" className="hover:text-primary transition-colors">KAIZEN</Link>
            <a href="#faq" className="hover:text-primary transition-colors">FAQ</a>
          </nav>
          <div className="hidden md:flex items-center gap-3">
            <Link href="/login" className="text-sm font-semibold px-4 py-2 rounded-lg hover:bg-secondary text-foreground/80 hover:text-foreground transition-all">
              Log in
            </Link>
            <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm font-semibold shadow-glow-navy">
              Join Community <ArrowRight className="size-4" />
            </a>
          </div>
          <MobileNav communityUrl={COMMUNITY_URL} />
        </div>
      </header>

      {/* ───────────────────────── Hero ─────────────────────────
          One line of promise, one line of scope, two buttons — the product
          mock on the right does the explaining. */}
      <section className="relative pt-10 pb-16 lg:pt-16 lg:pb-24 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          <div className="lg:col-span-6 flex flex-col items-start text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 mb-6">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              Built only for Indian MFDs
            </span>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight text-foreground text-balance">
              Run your MFD practice on{" "}
              <span className="text-primary">one system</span>.
            </h1>

            <p className="mt-5 text-lg text-muted-foreground">
              Clients · Compliance · SIPs · Reports
            </p>

            <div className="mt-8 flex flex-wrap gap-3 w-full sm:w-auto">
              <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="btn-primary text-base px-7 py-3 w-full sm:w-auto justify-center">
                Join Our Community <ArrowRight className="size-5" />
              </a>
              <Link href="/signup" className="btn-secondary text-base px-7 py-3 w-full sm:w-auto justify-center">
                Start free trial
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap gap-2.5">
              <TrustChip icon={ShieldCheck} tone="text-emerald-600" label="AMFI & SEBI-aware" />
              <TrustChip icon={Lock} tone="text-primary" label="DPDP-ready" />
              <TrustChip icon={Clock} tone="text-amber-600" label="Live in a day" />
            </div>
          </div>

          {/* Product mock */}
          <div className="lg:col-span-6 w-full flex justify-center lg:justify-end">
            <div className="relative w-full max-w-md">
            <div className="glass-card rounded-2xl w-full p-5 relative border border-border/50 shadow-2xl flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="pulse-dot" />
                  <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">Your practice, live</span>
                </div>
                <span className="text-2xs font-semibold bg-emerald-500/10 text-emerald-700 px-2 py-0.5 rounded-full">NAVs synced</span>
              </div>

              <div>
                <span className="text-xs text-muted-foreground font-medium">AUM</span>
                <div className="text-4xl font-extrabold tabular-nums tracking-tight text-foreground">₹4.28 Cr</div>
                <div className="flex items-center gap-1 text-xs text-emerald-600 font-semibold mt-0.5">
                  <TrendingUp className="size-3.5" /> 16.4% family XIRR
                </div>
              </div>

              <div className="h-20 w-full">
                <svg viewBox="0 0 400 100" className="w-full h-full overflow-visible" aria-hidden>
                  <defs>
                    <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0,90 C50,85 70,60 100,65 C130,70 160,40 190,45 C220,50 250,25 280,30 C310,35 340,10 400,5 L400,100 L0,100 Z" fill="url(#hero-area)" />
                  <path d="M0,90 C50,85 70,60 100,65 C130,70 160,40 190,45 C220,50 250,25 280,30 C310,35 340,10 400,5" fill="none" stroke="hsl(var(--primary))" strokeWidth="3.5" strokeLinecap="round" />
                  <circle cx="400" cy="5" r="5" fill="hsl(var(--primary))" />
                </svg>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <MockStat icon={Repeat} tone="text-primary" value="1,240" label="Live SIPs" />
                <MockStat icon={Brain} tone="text-rose-500" value="3" label="At risk" />
                <MockStat icon={ShieldCheck} tone="text-emerald-600" value="100%" label="Compliant" />
              </div>

              <div className="rounded-xl bg-secondary/60 p-3 flex items-center gap-2.5">
                <span className="text-2xs font-bold rounded-full bg-rose-500/10 text-rose-600 px-2 py-0.5">SIP bounced</span>
                <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-2xs font-bold rounded-full bg-emerald-500/10 text-emerald-700 px-2 py-0.5 inline-flex items-center gap-1">
                  <MessageSquare className="size-3" /> WhatsApp sent
                </span>
              </div>
            </div>
            <div className="hidden lg:flex absolute -left-10 -bottom-7 z-30 items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-2.5 shadow-xl">
              <span className="size-8 rounded-full bg-emerald-500/10 grid place-items-center">
                <FileText className="size-4 text-emerald-600" />
              </span>
              <div className="leading-tight">
                <div className="text-2xs font-bold text-foreground">Family review ready</div>
                <div className="text-2xs text-muted-foreground">Branded PDF</div>
              </div>
            </div>

            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────── Numbers ───────────────────── */}
      <section className="border-y border-border/40 bg-secondary/20 relative z-10 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-2 md:grid-cols-4 gap-y-8 md:divide-x md:divide-border/50">
          <Stat value={60} suffix="+" label="Calculators" />
          <Stat value={13900} suffix="+" label="Schemes valued daily" />
          <Stat value={40} suffix="+" label="Automations" />
          <Stat value={11} label="Compliance checks" />
        </div>
      </section>

      {/* ───────────────────── Features (bento) ─────────────────────
          A name and a picture per area — no paragraphs. */}
      <section id="features" className="py-20 lg:py-24 relative z-10 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <SectionTitle eyebrow="Features" title="Everything your firm runs on" />

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile icon={ShieldCheck} tone="bg-emerald-500/10 text-emerald-600" title="DDQ & compliance" wide>
              <div className="flex items-center gap-4">
                <div className="relative size-16 shrink-0">
                  <svg viewBox="0 0 36 36" className="size-16 -rotate-90" aria-hidden>
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="hsl(var(--border))" strokeWidth="3.5" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#059669" strokeWidth="3.5" strokeDasharray="97.4 97.4" strokeLinecap="round" />
                  </svg>
                  <span className="absolute inset-0 grid place-items-center text-xs font-extrabold text-emerald-700">100%</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {["ARN / EUIN", "Disclaimer", "Consent", "Opt-out", "Risk profile"].map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-700 text-2xs font-semibold px-2 py-0.5">
                      <Check className="size-3" /> {t}
                    </span>
                  ))}
                </div>
              </div>
            </Tile>

            <Tile icon={Repeat} tone="bg-rose-500/10 text-rose-500" title="SIP bounce recovery">
              <div className="flex flex-col gap-1.5">
                <span className="self-start text-2xs font-bold rounded-full bg-rose-500/10 text-rose-600 px-2 py-0.5">Mandate failed</span>
                <span className="self-start text-2xs font-bold rounded-full bg-emerald-500/10 text-emerald-700 px-2 py-0.5">Reminder sent ✓</span>
              </div>
            </Tile>

            <Tile icon={Users2} tone="bg-primary/10 text-primary" title="Family portfolios">
              <div className="flex items-center justify-between">
                <div className="flex -space-x-2">
                  {["RS", "PS", "AS", "KS"].map((n, i) => (
                    <span key={n} className={`size-7 rounded-full grid place-items-center text-2xs font-bold text-white ring-2 ring-card ${AVATAR_BG[i]}`}>{n}</span>
                  ))}
                </div>
                <span className="text-sm font-extrabold tabular-nums text-foreground">₹1.8 Cr</span>
              </div>
            </Tile>

            <Tile icon={CalendarDays} tone="bg-amber-500/10 text-amber-600" title="Reviews & meetings">
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 14 }).map((_, i) => (
                  <span key={i} className={`h-3 rounded-sm ${[2, 5, 9, 12].includes(i) ? "bg-amber-500" : "bg-secondary"}`} />
                ))}
              </div>
            </Tile>

            <Tile icon={BarChart3} tone="bg-primary/10 text-primary" title="MIS reports">
              <div className="flex items-end gap-1.5 h-12">
                {[35, 55, 45, 70, 60, 85, 100].map((h, i) => (
                  <span key={i} className="flex-1 rounded-t bg-primary/70" style={{ height: `${h}%` }} />
                ))}
              </div>
            </Tile>

            <Tile icon={Sparkles} tone="bg-violet-500/10 text-violet-600" title="AI assistant" wide>
              <div className="flex flex-col gap-1.5">
                <span className="self-end max-w-xs rounded-2xl rounded-br-sm bg-secondary px-3 py-1.5 text-xs text-foreground">
                  Who needs a review this month?
                </span>
                <span className="self-start max-w-xs rounded-2xl rounded-bl-sm bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-700">
                  12 clients · 3 overdue
                </span>
              </div>
            </Tile>

            <Tile icon={Target} tone="bg-primary/10 text-primary" title="Leads & opportunities">
              <div className="flex flex-col gap-1">
                {[100, 72, 48, 30].map((w, i) => (
                  <span key={i} className="h-2.5 rounded-full bg-primary/60" style={{ width: `${w}%` }} />
                ))}
              </div>
            </Tile>

            <Tile icon={MessageSquare} tone="bg-emerald-500/10 text-emerald-600" title="WhatsApp & email">
              <div className="flex flex-col gap-1.5">
                <span className="self-start rounded-2xl rounded-bl-sm bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-800">Happy birthday, Riya! 🎉</span>
                <span className="self-start text-2xs font-semibold text-muted-foreground">✓✓ Read</span>
              </div>
            </Tile>

            <Tile icon={Layers} tone="bg-amber-500/10 text-amber-600" title="Every product">
              <div className="flex flex-wrap gap-1.5">
                {["Mutual funds", "Insurance", "Fixed deposits", "NPS", "PMS / AIF", "Bonds"].map((t) => (
                  <span key={t} className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-2xs font-semibold text-foreground/80">{t}</span>
                ))}
              </div>
            </Tile>

            <Tile icon={Upload} tone="bg-primary/10 text-primary" title="CAMS & KFintech import">
              <div className="flex flex-col items-start gap-1.5 text-2xs font-semibold">
                <span className="rounded-lg border border-border/70 bg-background px-2.5 py-1.5">RTA files</span>
                <ArrowRight className="size-3.5 text-muted-foreground rotate-90 ml-3" />
                <span className="rounded-lg bg-primary/10 text-primary px-2.5 py-1.5">Folios · SIPs · Families</span>
              </div>
            </Tile>
          </div>
        </div>
      </section>

      {/* ───────────────────── Calculators ───────────────────── */}
      <section id="calculators" className="py-20 lg:py-24 bg-secondary/20 border-y border-border/40 relative z-10 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div>
            <div className="text-6xl sm:text-7xl font-extrabold tracking-tight text-primary tabular-nums">60+</div>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground text-balance">
              Calculators clients remember
            </h2>
            <div className="mt-5 flex flex-wrap gap-2">
              <TrustChip icon={FileText} tone="text-primary" label="Branded PDF" />
              <TrustChip icon={MessageSquare} tone="text-emerald-600" label="Share on WhatsApp" />
              <TrustChip icon={ShieldCheck} tone="text-amber-600" label="Disclaimer built in" />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl bg-card border border-border/60 shadow-lg p-5">
              <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                <Calculator className="size-4 text-primary" /> SIP planner
              </div>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">₹25,000 / month · 20 years</div>
                  <div className="text-3xl font-extrabold tabular-nums text-foreground mt-1">₹2.3 Cr</div>
                </div>
                <div className="flex items-end gap-1 h-14">
                  {[12, 18, 26, 36, 50, 68, 92].map((h, i) => (
                    <span key={i} className="w-3 rounded-t bg-primary/70" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <p className="mt-3 text-2xs text-muted-foreground">Illustration only. Mutual fund investments are subject to market risks.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {["Step-up SIP", "Goal planner", "Retirement", "Insurance IRR", "Tax regime", "Capital gains"].map((n) => (
                <span key={n} className="rounded-xl border border-border/60 bg-background px-3 py-2.5 text-xs font-semibold text-foreground/85 inline-flex items-center gap-1.5">
                  <Calculator className="size-3.5 text-primary shrink-0" /> {n}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────── How it works ───────────────────── */}
      <section id="how-it-works" className="py-20 lg:py-24 relative z-10 scroll-mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <SectionTitle eyebrow="How it works" title="Live in a day" />
          <ol className="mt-14 grid md:grid-cols-3 gap-10 md:gap-6 relative">
            <span aria-hidden className="hidden md:block absolute top-8 border-t-2 border-dashed border-border" style={{ left: "17%", right: "17%" }} />
            {[
              { icon: Upload, title: "Upload RTA files" },
              { icon: Zap, title: "Switch on automations" },
              { icon: Rocket, title: "Grow your AUM" },
            ].map((s, i) => (
              <li key={s.title} className="relative flex flex-col items-center text-center gap-4">
                <span className="relative size-16 rounded-2xl bg-primary text-primary-foreground grid place-items-center shadow-lg">
                  <s.icon className="size-7" />
                  <span className="absolute -top-2 -right-2 size-6 rounded-full bg-card border border-border text-2xs font-extrabold text-foreground grid place-items-center">
                    {i + 1}
                  </span>
                </span>
                <h3 className="font-bold text-base text-foreground">{s.title}</h3>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ───────────────────── Why Aina ───────────────────── */}
      <section className="pb-20 lg:pb-24 relative z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {WHY_AINA.map((w) => (
            <div key={w.title} title={w.body} className="rounded-2xl border border-border/50 bg-secondary/30 p-5 flex flex-col items-start gap-3">
              <span className="size-10 rounded-xl grid place-items-center bg-primary/10 text-primary">
                <w.icon className="size-5" />
              </span>
              <h3 className="font-bold text-sm text-foreground">{w.title}</h3>
            </div>
          ))}
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
            <TrustChip icon={ShieldCheck} tone="text-emerald-600" label="Compliance gate" />
            <TrustChip icon={MessageSquare} tone="text-primary" label="Your own WhatsApp & email" />
            <TrustChip icon={Zap} tone="text-amber-600" label="Free updates" />
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
                <div className="flex gap-0.5 text-amber-500">
                  {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="size-4 fill-current" />)}
                </div>
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
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white text-balance">
            Ready to run a system-driven practice?
          </h2>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-white text-foreground hover:bg-white/90 px-7 py-3 text-base font-bold transition-all shadow-md inline-flex items-center gap-2">
              Join the Community <ArrowRight className="size-5" />
            </a>
            <Link href="/signup" className="rounded-xl border border-white/30 bg-white/10 text-white hover:bg-white/15 px-7 py-3 text-base font-bold transition-all">
              Start free trial
            </Link>
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
            </div>
            <FooterCol title="Product" links={[["Features", "#features"], ["Calculators", "#calculators"], ["How it works", "#how-it-works"], ["KAIZEN", "/knowledge-base"]]} />
            <FooterCol title="Get started" links={[["Pricing", "#pricing"], ["Start free trial", "/signup"], ["Log in", "/login"]]} />
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

const AVATAR_BG = ["bg-primary", "bg-emerald-600", "bg-amber-500", "bg-violet-600"];

/** Honest differentiators (real product facts). The title is all that shows;
 *  the sentence is the card's hover title. */
const WHY_AINA = [
  {
    icon: ShieldCheck,
    title: "Compliance built in",
    body: "Every WhatsApp, email and SMS passes an 11-rule AMFI/SEBI gate — ARN/EUIN, disclaimers, consent and opt-out.",
  },
  {
    icon: MessageSquare,
    title: "Your WhatsApp, your cost",
    body: "Connect your own WhatsApp, SMS and email — no per-message markup from us.",
  },
  {
    icon: Lock,
    title: "Your data stays yours",
    body: "Row-level isolation (DPDP-ready), 2FA, backups — each RM sees only their own book.",
  },
  {
    icon: Users2,
    title: "Built with ARN holders",
    body: "Designed around the real MFD day — RTA imports, family reviews, SIP recovery.",
  },
];

/** Real, attributable client quotes only — leave empty until you have them. */
const TESTIMONIALS: { quote: string; name: string; detail: string }[] = [];

/* ───────────────────────── Helper components ───────────────────────── */

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center max-w-2xl mx-auto">
      <span className="text-2xs font-bold uppercase tracking-widest text-primary">{eyebrow}</span>
      <h2 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground text-balance">{title}</h2>
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

function MockStat({ icon: Icon, tone, value, label }: { icon: LucideIcon; tone: string; value: string; label: string }) {
  return (
    <div className="rounded-xl bg-secondary/60 p-2.5">
      <Icon className={`size-4 ${tone}`} />
      <div className="mt-2 text-base font-extrabold tabular-nums text-foreground leading-none">{value}</div>
      <div className="mt-1 text-2xs text-muted-foreground font-medium">{label}</div>
    </div>
  );
}

function Tile({
  icon: Icon,
  tone,
  title,
  wide,
  children,
}: {
  icon: LucideIcon;
  tone: string;
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className={`group rounded-2xl border border-border/60 bg-card p-5 flex flex-col gap-5 hover:shadow-lg hover:-translate-y-0.5 transition-all ${wide ? "sm:col-span-2" : ""}`}>
      <div className="flex items-center gap-3">
        <span className={`size-10 rounded-xl grid place-items-center shrink-0 ${tone}`}>
          <Icon className="size-5" />
        </span>
        <h3 className="font-bold text-sm text-foreground">{title}</h3>
      </div>
      <div className="mt-auto">{children}</div>
    </article>
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
    <div className="text-center flex flex-col items-center justify-center">
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
            <Link href={href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
