import Link from "next/link";
import type { Metadata } from "next";
import {
  ShieldCheck, TrendingUp, Brain, GitBranch,
  MessageSquare, BarChart3, Lock, ArrowRight, Check, Calculator,
  Clock, Star,
  ShieldAlert, Zap, CheckCircle2, ChevronRight, Upload, Cog, Rocket,
  Users2,
} from "lucide-react";
import { CountUp } from "@/components/landing/CountUp";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { MobileNav } from "@/components/landing/MobileNav";

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
    a: "Aina CRM is a CRM and practice operating system designed specially for Mutual Fund Distributors. It helps manage client data, compliance readiness, review meetings, service requests, team tasks, reporting, marketing and business automation — all from one structured platform.",
  },
  {
    q: "Is Aina CRM only for large MFD firms?",
    a: "No. Aina CRM is useful for individual MFDs, growing firms and larger teams. It helps bring structure and scalability at every stage of growth.",
  },
  {
    q: "How does Aina CRM help with DDQ compliance?",
    a: "Aina CRM helps organize DDQ files, compliance checklists, complaint registers, client consent records, risk-profile records, document folders and internal SOPs — so compliance preparation becomes systematic instead of a last-minute scramble.",
  },
  {
    q: "Can Aina CRM help reduce missed follow-ups?",
    a: "Yes. Aina CRM tracks review meetings, service requests, SIP rejections, lead follow-ups, client tasks and team responsibilities in one place, with reminders and escalations so fewer things slip.",
  },
  {
    q: "Does Aina CRM support marketing and lead generation?",
    a: "Yes. Aina CRM supports content calendars, investor-education posts, WhatsApp creatives, email newsletters, landing pages, event promotions and lead-capture systems — with a compliance check on every creative.",
  },
  {
    q: "Can Aina CRM help with team performance tracking?",
    a: "Yes. Aina CRM tracks RM-wise tasks, pending activities, lead follow-ups, service requests and business reports, giving the owner clear visibility into team accountability.",
  },
  {
    q: "Does Aina CRM include AI support?",
    a: "Yes. Aina CRM includes AI-focused capabilities such as CRM query assistance, email-draft support, meeting summaries, lead qualification, campaign ideas and client-review summaries.",
  },
  {
    q: "Why should MFDs use Aina CRM?",
    a: "To reduce manual work, improve client servicing, strengthen compliance readiness, organize client data, track team performance and scale the practice with stronger systems — instead of running everything on memory, Excel and WhatsApp.",
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

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col bg-background relative overflow-x-clip">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* ───────────────────────── Nav ───────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/75 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="inline-flex items-center hover:opacity-90 transition-opacity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aina-logo.png" alt="Aina CRM — mutual fund software for distributors" className="h-8 w-auto object-contain shrink-0" />
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm font-semibold text-muted-foreground">
            <a href="#features" className="hover:text-primary transition-colors">Features</a>
            <a href="#calculators" className="hover:text-primary transition-colors">Calculators</a>
            <a href="#how-it-works" className="hover:text-primary transition-colors">How It Works</a>
            <a href="#pricing" className="hover:text-primary transition-colors">Pricing</a>
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

      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative pt-4 pb-20 lg:pt-8 lg:pb-28 z-10">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Copy */}
          <div className="lg:col-span-7 flex flex-col items-start text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-6">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              Built only for Indian MFDs · AMFI & SEBI-aware · DPDP-ready data isolation
            </span>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.6rem] font-extrabold tracking-tight leading-[1.08] text-foreground">
              Run your MFD practice with{" "}
              <span className="text-primary">more control, less manual work</span>.
            </h1>

            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl">
              Aina CRM is a complete CRM and practice operating system for Mutual Fund Distributors —
              manage clients, compliance, team tasks, reviews, SIP follow-ups, marketing, reports and
              growth from one structured platform. Built for MFDs who want to scale systematically.
            </p>

            {/* "No more" proof bullets */}
            <ul className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm font-medium text-foreground/85">
              {[
                "No more scattered Excel & WhatsApp",
                "No more missed reviews or follow-ups",
                "No more last-minute DDQ stress",
                "No more running the firm on memory",
                "Clean client data, one source of truth",
                "Compliance, MIS & AI in one place",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-4 w-full sm:w-auto">
              <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="btn-primary text-base px-7 py-3 w-full sm:w-auto justify-center">
                Join Our Community <ArrowRight className="size-5" />
              </a>
              <Link href="/signup" className="btn-secondary text-base px-7 py-3 w-full sm:w-auto justify-center">
                Start free trial
              </Link>
            </div>

            <div className="mt-9 pt-7 border-t border-border/60 w-full">
              <div className="flex flex-wrap items-center gap-x-7 gap-y-3 text-xs font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-600" /> AMFI &amp; SEBI-aware by design
                </span>
                <span className="inline-flex items-center gap-2">
                  <Lock className="size-4 text-primary" /> Row-level data isolation (DPDP-ready)
                </span>
                <span className="inline-flex items-center gap-2">
                  <Users2 className="size-4 text-brand-navy" /> Built alongside working ARN holders
                </span>
                <span className="inline-flex items-center gap-2">
                  <Clock className="size-4 text-amber-600" /> Most firms live within a day
                </span>
              </div>
            </div>
          </div>

          {/* Live dashboard mock */}
          <div className="lg:col-span-5 relative w-full flex justify-center">
            {/* Floating proof toast — depth + story */}
            <div className="hidden lg:flex absolute -left-8 -bottom-5 z-20 items-center gap-2.5 rounded-xl border border-border/60 bg-card/95 backdrop-blur px-3.5 py-2.5 shadow-xl animate-fade-in">
              <span className="size-8 rounded-full bg-emerald-500/10 grid place-items-center">
                <CheckCircle2 className="size-4 text-emerald-600" />
              </span>
              <div className="leading-tight">
                <div className="text-[11px] font-bold text-foreground">Sharma family review ready</div>
                <div className="text-[10px] text-muted-foreground">Branded PDF · 16.9% family XIRR</div>
              </div>
            </div>

            <div className="glass-card rounded-2xl w-full max-w-[460px] p-5 relative border border-white/20 shadow-2xl flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <span className="pulse-dot" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Your practice, live</span>
                </div>
                <span className="text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                  AMFI NAVs synced
                </span>
              </div>

              <div>
                <span className="text-xs text-muted-foreground font-medium">Assets Under Management</span>
                <div className="text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight mt-1 text-foreground">
                  ₹4,28,16,500
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
                  <TrendingUp className="size-3.5" />
                  <span>▲ ₹58.4L unrealised gain · 16.42% family XIRR</span>
                </div>
              </div>

              <div className="h-20 w-full mt-1 relative">
                <svg viewBox="0 0 400 100" className="w-full h-full overflow-visible" aria-hidden>
                  <defs>
                    <linearGradient id="gradient-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(31, 61, 59)" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="rgb(31, 61, 59)" stopOpacity="0.0" />
                    </linearGradient>
                    <linearGradient id="gradient-line" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="hsl(var(--brand-navy))" />
                      <stop offset="50%" stopColor="hsl(var(--primary))" />
                      <stop offset="100%" stopColor="hsl(var(--primary))" />
                    </linearGradient>
                  </defs>
                  <line x1="0" y1="20" x2="400" y2="20" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
                  <line x1="0" y1="50" x2="400" y2="50" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
                  <line x1="0" y1="80" x2="400" y2="80" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
                  <path d="M0,90 C50,85 70,60 100,65 C130,70 160,40 190,45 C220,50 250,25 280,30 C310,35 340,10 400,5 L400,100 L0,100 Z" fill="url(#gradient-area)" />
                  <path d="M0,90 C50,85 70,60 100,65 C130,70 160,40 190,45 C220,50 250,25 280,30 C310,35 340,10 400,5" fill="none" stroke="url(#gradient-line)" strokeWidth="3.5" strokeLinecap="round" />
                  <circle cx="400" cy="5" r="5" fill="hsl(var(--primary))" />
                  <circle cx="400" cy="5" r="10" fill="none" stroke="hsl(var(--primary))" strokeOpacity="0.4" strokeWidth="2" />
                </svg>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-1">
                <div className="rounded-xl border border-border/50 bg-secondary/35 p-3 flex flex-col justify-between hover-glow-cyan transition-all">
                  <div className="flex justify-between items-center">
                    <Brain className="size-4.5 text-rose-500 shrink-0" />
                    <span className="pulse-warning-dot" />
                  </div>
                  <div className="mt-3">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Churn Radar</span>
                    <span className="text-xs font-bold text-foreground mt-0.5 block leading-tight">3 at-risk clients</span>
                    <span className="text-[9px] text-muted-foreground block mt-0.5">Retention scripts ready</span>
                  </div>
                </div>
                <div className="rounded-xl border border-border/50 bg-secondary/35 p-3 flex flex-col justify-between hover-glow-cyan transition-all">
                  <div className="flex justify-between items-center">
                    <ShieldCheck className="size-4.5 text-emerald-600 shrink-0" />
                    <span className="size-2 rounded-full bg-emerald-500" />
                  </div>
                  <div className="mt-3">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Compliance Gate</span>
                    <span className="text-xs font-bold text-foreground mt-0.5 block leading-tight">100% compliant</span>
                    <span className="text-[9px] text-muted-foreground block mt-0.5">ARN on every message</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-brand-navy-light/70 dark:bg-brand-navy/15 border border-brand-navy/15 p-3 flex items-start gap-2.5">
                <ShieldAlert className="size-4.5 text-brand-navy shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-brand-navy-deep dark:text-foreground uppercase tracking-wider">SIP bounce caught</span>
                    <span className="text-[8px] bg-brand-navy text-white px-1.5 py-0.5 rounded font-bold uppercase">Auto-recovery</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                    Mandate failed for <strong className="text-foreground">Sharma family</strong> — compliant WhatsApp reminder already queued.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────── Stats strip ───────────────────── */}
      <section className="border-y border-border/40 bg-secondary/20 relative z-10 py-12">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-8">
            Purpose-built for the Indian MFD practice
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-y-8 md:divide-x md:divide-border/50">
            <Stat value={60} suffix="+" label="Client-ready financial calculators" />
            <Stat value={13900} suffix="+" label="AMFI schemes valued daily" />
            <Stat value={40} suffix="+" label="Ready-made automation recipes" />
            <Stat value={11} suffix=" rules" label="Compliance checks on every send" />
          </div>
        </div>
      </section>

      {/* ───────────────────── Core features ───────────────────── */}
      <section id="features" className="py-20 bg-secondary/15 border-y border-border/40 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="chip bg-brand-navy-light text-primary">Your whole practice, one system</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
              The practice operating system for Mutual Fund Distributors
            </h2>
            <p className="mt-3 text-muted-foreground">
              From compliance and client data to servicing, reporting, marketing and AI — Aina CRM replaces
              the scattered Excel-and-WhatsApp setup with one structured system your whole team runs on.
            </p>
          </div>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {CORE_FEATURES.map((f, i) => (
              <article key={f.title} className="group glass-card hover-glow-cyan rounded-xl p-6 border border-border/40 hover:shadow-lg transition-all flex flex-col justify-between relative overflow-hidden">
                <span className="absolute top-3 right-4 text-3xl font-black tabular-nums text-foreground/[0.06] group-hover:text-primary/15 transition-colors select-none">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <div className={`size-11 rounded-lg grid place-items-center ${f.bg} shrink-0`}>
                    <f.icon className={`size-5.5 ${f.fg}`} />
                  </div>
                  <h3 className="font-bold mt-4 text-[15px] text-foreground flex items-center gap-2">
                    {f.title}
                    {f.badge && (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${f.badgeBg} ${f.badgeFg}`}>{f.badge}</span>
                    )}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{f.benefit}</p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/30 flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                  <span>Impact: <strong className="text-foreground">{f.impact}</strong></span>
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────── Calculators spotlight ───────────────────── */}
      <section id="calculators" className="py-20 lg:py-28 max-w-7xl mx-auto px-6 relative z-10">
        <Spotlight
          eyebrow="60+ financial calculators for MFDs"
          title="Win the meeting with calculators clients remember"
          body="SIP, step-up, goal, retirement, SWP/STP, insurance-IRR vs mutual funds, capital gains with CII indexation, old-vs-new tax regime, FIRE number and more — every illustration prints as a branded PDF with the client's name, saves as a scenario, and shares to WhatsApp or email in one click."
          points={[
            "Scheme returns prefill live — illustrations grounded in real funds",
            "Save scenarios per client and reload them at the next review",
            "Branded PDF with your logo, ARN and the market-risk disclaimer built in",
          ]}
          accent="from-amber-500/10 to-amber-500/2"
        >
          <div className="w-full grid grid-cols-2 gap-2.5">
            {[
              ["SIP 360° Planner", "₹25k/mo → ₹2.3 Cr in 20y"],
              ["Step-Up SIP", "10%/yr step-up = 2.5× corpus"],
              ["Insurance IRR", "That plan is really 5.36%"],
              ["Capital Gains Tax", "LTCG with CII indexation"],
              ["Old vs New Regime", "Save ₹89,700 this year"],
              ["FIRE Number", "Financially free at 50"],
            ].map(([name, hook]) => (
              <div key={name} className="rounded-xl border border-border/50 bg-background/80 dark:bg-card p-3 shadow-sm">
                <div className="flex items-center gap-1.5">
                  <Calculator className="size-3.5 text-primary shrink-0" />
                  <span className="text-[11px] font-bold text-foreground leading-tight">{name}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{hook}</p>
              </div>
            ))}
          </div>
        </Spotlight>
      </section>

      {/* ───────────────────── How it works ───────────────────── */}
      <section id="how-it-works" className="py-20 lg:py-28 bg-secondary/15 border-y border-border/40 relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="chip bg-brand-navy-light text-primary">Live in a day, not a quarter</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">How your firm moves to Aina</h2>
            <p className="mt-3 text-muted-foreground text-sm">
              No migration project, no consultants. Your RTA exports are the migration.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Upload,
                step: "1",
                title: "Drop your CAMS / KFintech files",
                body: "Export clients, folios and transactions from your RTA back office and drop them in. Dynamic header-mapping reads them even when columns move — your AUM, SIP book and families appear ready-to-use.",
              },
              {
                icon: Cog,
                step: "2",
                title: "Switch on the automations",
                body: "Pick from 40+ ready recipes: SIP-bounce recovery, birthday wishes, review reminders, KYC document collection, mandate-expiry alerts. Every send passes the compliance gate automatically.",
              },
              {
                icon: Rocket,
                step: "3",
                title: "Spend your day growing AUM",
                body: "Your morning starts with a what-to-do-next list: at-risk clients, hot leads, due reviews. Calculators, proposals and branded reports close the conversation — the back office runs itself.",
              },
            ].map((s) => (
              <div key={s.step} className="glass-card rounded-xl p-6 flex flex-col gap-3 border border-border/50 hover-glow-cyan transition-all">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-primary/15 text-primary font-extrabold text-sm flex items-center justify-center border border-primary/30">{s.step}</div>
                  <s.icon className="size-5 text-primary" />
                </div>
                <h3 className="font-bold text-[15px] text-foreground">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── Pricing ───────────────────────── */}
      <section id="pricing" className="py-20 lg:py-28 relative z-10 max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto">
          <span className="chip bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
            Founding member pricing
          </span>
          <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Flat, honest pricing — your bill doesn&apos;t grow with your AUM
          </h2>
          <p className="mt-3 text-muted-foreground">
            A one-time setup gets your firm fully live, then a flat per-user yearly fee — from ₹9,999.
            No per-client charges. No AUM-linked fees. No surprises.
          </p>
        </div>

        <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch max-w-6xl mx-auto">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`glass-card rounded-2xl p-6 sm:p-8 flex flex-col relative border ${
                p.featured
                  ? "border-primary/40 bg-primary/[0.03] shadow-xl md:-translate-y-2 ring-1 ring-primary/30"
                  : "border-border/60"
              }`}
            >
              {p.featured && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-primary text-white text-[10px] uppercase font-bold tracking-widest px-3 py-1 rounded-full shadow-md">
                  Recommended
                </span>
              )}
              <h3 className="font-extrabold text-xl text-foreground">{p.name}</h3>
              <p className="text-xs text-muted-foreground mt-2 min-h-[30px] leading-relaxed">{p.for}</p>

              <div className="mt-4 pt-4 border-t border-border/40">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-extrabold text-foreground">{p.price}</span>
                  <span className="text-sm text-muted-foreground font-semibold">{p.unit}</span>
                </div>
                <div className="mt-1.5 text-sm text-muted-foreground font-medium">
                  + <span className="font-bold text-foreground">{p.setup}</span> one-time setup (per firm)
                </div>
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-secondary/70 border border-border/50 px-2 py-1 text-[11px] font-semibold text-muted-foreground tabular-nums">
                  <Users2 className="size-3" /> {p.seats}
                </div>
              </div>

              {p.inherits && <p className="mt-5 text-sm font-bold text-foreground">{p.inherits}</p>}
              <ul className="mt-5 flex flex-col gap-2.5 flex-grow">
                {p.items.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-xs text-muted-foreground font-medium">
                    <Check className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link href="/signup" className={`mt-8 w-full ${p.featured ? "btn-primary" : "btn-secondary"} font-bold py-3 text-center justify-center shadow-md`}>
                {p.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-border/50 bg-secondary/20 px-6 py-5 max-w-4xl mx-auto">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground text-center mb-3.5">
            Every plan includes
          </div>
          <div className="flex flex-wrap justify-center gap-x-7 gap-y-2.5 text-xs font-semibold text-foreground/80">
            <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5 text-primary" /> Row-level data isolation</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-600" /> AMFI/SEBI compliance gate</span>
            <span className="inline-flex items-center gap-1.5"><MessageSquare className="size-3.5 text-brand-navy" /> Your own WhatsApp / email accounts — no per-message markup</span>
            <span className="inline-flex items-center gap-1.5"><Zap className="size-3.5 text-amber-600" /> Free product updates</span>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6 max-w-xl mx-auto">
          * Billed annually, minimum 3 users. Setup is a one-time, per-firm fee. Training, customisation &amp; marketing services are quoted separately. Taxes as applicable.
        </p>
      </section>

      {/* ───────────────────────── FAQ ───────────────────────── */}
      <section id="faq" className="py-20 lg:py-28 bg-secondary/10 border-t border-border/40 relative z-10">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="chip bg-brand-navy-light text-primary">Questions MFDs ask us</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
              Mutual fund distributor software — FAQs
            </h2>
            <p className="mt-3 text-muted-foreground">
              Straight answers on data import, SIP tracking, WhatsApp compliance, calculators, security and pricing.
            </p>
          </div>

          <FaqAccordion items={FAQS} />
        </div>
      </section>

      {/* ───────────────────── Who is it for ───────────────────── */}
      <section className="py-16 lg:py-20 relative z-10 max-w-5xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto">
          <span className="chip bg-brand-navy-light text-primary">Who it&apos;s for</span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
            Built for MFDs at every stage of growth
          </h2>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm font-medium text-foreground/85">
          {[
            "Individual Mutual Fund Distributors",
            "Growing MFD firms with RM or ops teams",
            "ARN holders managing large client bases",
            "MFDs struggling with DDQ & compliance readiness",
            "Anyone still running on Excel & WhatsApp",
            "MFDs who want better servicing, reports & team visibility",
          ].map((t) => (
            <div key={t} className="flex items-start gap-2.5">
              <CheckCircle2 className="size-4 text-emerald-600 mt-0.5 shrink-0" />
              {t}
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────────── Why MFDs choose Aina ───────────────────── */}
      <section className="py-16 lg:py-20 bg-secondary/15 border-y border-border/40 relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="chip bg-brand-navy-light text-primary">Why MFDs choose Aina</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
              Not a generic CRM bent to fit — built for the MFD practice
            </h2>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {WHY_AINA.map((w) => (
              <div key={w.title} className="glass-card rounded-xl p-6 border border-border/40 flex flex-col gap-3">
                <div className="size-11 rounded-lg grid place-items-center bg-primary/10 text-primary shrink-0">
                  <w.icon className="size-5.5" />
                </div>
                <h3 className="font-bold text-[15px] text-foreground">{w.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{w.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────── Testimonials (real quotes only) ─────────────────────
          Renders only when TESTIMONIALS has entries — we never ship fabricated
          social proof. Populate the array with real, attributable MFD quotes. */}
      {TESTIMONIALS.length > 0 && (
        <section className="py-16 lg:py-20 relative z-10 max-w-6xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="chip bg-brand-navy-light text-primary">What MFDs say</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
              Trusted by distributors who run on Aina
            </h2>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <figure key={t.name} className="glass-card rounded-xl p-6 border border-border/40 flex flex-col gap-4">
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
      <section className="py-20 max-w-6xl mx-auto px-6 relative z-10">
        <div className="rounded-2xl bg-primary p-8 sm:p-14 text-center relative overflow-hidden shadow-2xl">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Ready to build a more system-driven MFD practice?
          </h2>
          <p className="mt-4 text-white/80 text-base max-w-xl mx-auto leading-relaxed">
            Stop running your practice on memory, Excel and WhatsApp. Bring automation, compliance
            readiness, marketing, reporting and AI into one platform — and scale systematically.
          </p>
          <div className="mt-8 flex flex-wrap gap-4 justify-center">
            <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-white text-brand-navy-deep hover:bg-white/90 px-8 py-3 text-base font-bold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-md inline-flex items-center gap-2">
              Join the Aina CRM Community <ArrowRight className="size-5" />
            </a>
            <Link href="/signup" className="rounded-xl border border-white/20 bg-white/5 text-white hover:bg-white/10 px-8 py-3 text-base font-bold transition-all shadow-sm">
              Start free trial
            </Link>
          </div>
          <div className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-semibold text-white/70">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5" /> Built only for Indian MFDs</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5" /> Your RTA exports are the migration</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5" /> Live within a day</span>
          </div>
        </div>
      </section>

      {/* ───────────────────────── Footer ───────────────────────── */}
      <footer className="border-t border-border/40 bg-secondary/20 relative z-10">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/aina-logo.png" alt="Aina CRM" className="h-9 w-auto object-contain shrink-0" />
              <p className="text-xs text-muted-foreground mt-4 leading-relaxed max-w-xs">
                Aina CRM is mutual fund software for distributors in India — client CRM, CAMS/KFintech
                import, SIP &amp; AUM tracking, AMFI-compliant WhatsApp, 60+ financial calculators,
                reports and MIS for ARN holders. Built by Aina Tech Services LLP.
              </p>
            </div>
            <FooterCol title="For MFDs" links={[["Feature tour", "#features"], ["Financial calculators", "#calculators"], ["How it works", "#how-it-works"], ["Pricing", "#pricing"]]} />
            <FooterCol title="Get started" links={[["Pricing plans", "#pricing"], ["Start free trial", "/signup"], ["Log in", "/login"]]} />
            <FooterCol title="Trust & compliance" links={[["AMFI/SEBI compliance gate", "#features"], ["Data security (DPDP)", "#faq"], ["FAQs", "#faq"]]} />
          </div>

          <div className="mt-14 pt-8 border-t border-border/40 flex flex-col lg:flex-row justify-between gap-4 text-[11px] text-muted-foreground leading-relaxed">
            <span>
              © {new Date().getFullYear()}{" "}
              <a
                href="https://ainatech.in"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-foreground/70 hover:text-primary transition-colors"
              >
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

const CORE_FEATURES = [
  {
    icon: ShieldCheck,
    title: "Compliance & DDQ readiness",
    benefit: "DDQ files, complaint register, client consent & risk records, ARN/EUIN/NISM validity, KYD docs and marketing approvals — organised continuously, not the night before an audit.",
    bg: "bg-emerald-500/10",
    fg: "text-emerald-600 dark:text-emerald-400",
    impact: "Audit-ready, not last-minute",
  },
  {
    icon: Users2,
    title: "Client data management",
    benefit: "Clean masters with de-dup and family mapping, missing PAN / nominee / KYC reports, and AUM / SIP / goal segmentation — plus dormant, inactive-SIP and redemption-prone lists.",
    bg: "bg-brand-navy-light/70",
    fg: "text-primary",
    impact: "One clean source of truth",
  },
  {
    icon: GitBranch,
    title: "CRM & business process",
    benefit: "Leads → onboarding → KYC → mandate → SIP / lumpsum / redemption → reviews, with RM-wise tasks, branch reporting and complete client communication history.",
    bg: "bg-brand-navy-light/70",
    fg: "text-brand-navy",
    impact: "Nothing slips the cracks",
  },
  {
    icon: Zap,
    title: "Operations automation",
    benefit: "Daily transaction import, SIP-rejection follow-ups, mandate & renewal trackers, review and meeting reminders, WhatsApp & email automation, plus daily/weekly MIS — on autopilot.",
    bg: "bg-amber-500/10",
    fg: "text-amber-600 dark:text-amber-400",
    impact: "Less manual chasing",
  },
  {
    icon: MessageSquare,
    title: "Client servicing & retention",
    benefit: "Review calendar, portfolio & goal reviews, reactivation and redemption-prevention campaigns, KYC / nominee / bank-update drives, feedback and referral systems.",
    bg: "bg-brand-navy-light/70",
    fg: "text-primary",
    impact: "Protect your AUM",
  },
  {
    icon: BarChart3,
    title: "Reporting & MIS",
    benefit: "Daily SIP / lumpsum / redemption, net sales, SIP-stopped & rejected, AUM movement, RM- and branch-wise, lead-conversion and AMC / scheme-category reports — live, every day.",
    bg: "bg-brand-navy-light/70",
    fg: "text-brand-navy",
    impact: "Run the firm by numbers",
  },
  {
    icon: Rocket,
    title: "Marketing & lead generation",
    benefit: "Content calendar, investor-education posts, WhatsApp & email creatives, campaign and event promotion, landing pages and lead capture — every creative compliance-checked.",
    bg: "bg-rose-500/10",
    fg: "text-rose-500",
    impact: "Stay consistently visible",
  },
  {
    icon: Brain,
    title: "AI business assistant",
    benefit: "Ask-your-data CRM queries, email-draft and meeting-summary help, lead qualification, campaign ideas and client-review summaries — practical AI for daily practice management.",
    bg: "bg-rose-500/10",
    fg: "text-rose-500",
    badge: "AI-powered",
    badgeBg: "bg-rose-500/15",
    badgeFg: "text-rose-700 dark:text-rose-300",
    impact: "Work smarter, not harder",
  },
  {
    icon: Lock,
    title: "Security, SOPs & team control",
    benefit: "Role-based access, 2FA, backups, staff-exit access removal and document permissions — plus SOPs and training so the practice no longer depends on one person.",
    bg: "bg-emerald-500/10",
    fg: "text-emerald-600 dark:text-emerald-400",
    impact: "Scale beyond the owner",
  },
];

const PLANS = [
  {
    name: "Starter",
    for: "Everything an established MFD firm needs to run day-to-day — clients, money, service & basics in one organised place.",
    setup: "₹49,000",
    price: "₹9,999",
    unit: "/ user / year",
    seats: "3 users = ₹29,997 / year",
    featured: false,
    cta: "Start Free Trial",
    inherits: null,
    items: [
      "Dashboard",
      "Tasks, Meetings & Calendar",
      "Leads & Clients",
      "Family Mapping",
      "Risk Profile",
      "10 Calculators",
      "Insurance — policies, claims & renewal alerts",
      "Business entries for all products",
      "Email automation",
      "Product master",
      "User management",
      "Reports & MIS",
      "Basic support",
      "CRM onboarding & training",
    ],
  },
  {
    name: "Growth",
    for: "Automation, AI alerts & team tools to scale your AUM without adding headcount.",
    setup: "₹79,000",
    price: "₹12,999",
    unit: "/ user / year",
    seats: "3 users = ₹38,997 / year",
    featured: false,
    cta: "Start Free Trial",
    inherits: "Everything in Starter, plus:",
    items: [
      "Command Center — AI alerts",
      "Next Best Action — AI alerts",
      "20 Calculators",
      "Goal Planning",
      "Service Requests",
      "Proposals",
      "Insurance Commission Tracker",
      "WhatsApp Automation",
      "Attendance & Leave Tracker",
      "Sub-Distributor Module",
      "Workflow Rules & Basic Automation",
      "Aina Content Library",
      "Personalised training",
    ],
  },
  {
    name: "Premium",
    for: "Full AI, compliance & practice management for firms scaling seriously.",
    setup: "₹97,000",
    price: "₹14,999",
    unit: "/ user / year",
    seats: "3 users = ₹44,997 / year",
    featured: true,
    cta: "Start Free Trial",
    inherits: "Everything in Starter & Growth, plus:",
    items: [
      "AI Assistant",
      "RTA File Import",
      "Advanced Goal Planning",
      "Brokerage Management",
      "DDQ Compliance Management & Audit",
      "Portfolio Intelligence",
      "Practice & Finance",
      "Advanced Automation",
      "Website Management",
      "Social Media Management",
      "Custom CRM customisation",
      "AI tool training",
      "IT-related training & support",
      "Custom presentation & tools",
    ],
  },
];

/** Honest differentiators (real product facts — not fabricated proof). */
const WHY_AINA = [
  {
    icon: ShieldCheck,
    title: "Compliance built in, not bolted on",
    body: "Every WhatsApp, email and SMS passes an 11-rule AMFI/SEBI gate — ARN/EUIN, disclaimers, consent and opt-out — so your audit pack assembles itself.",
  },
  {
    icon: MessageSquare,
    title: "Your WhatsApp, your cost",
    body: "Connect your own WhatsApp, SMS and email. Messaging stays in your name with no per-message markup from us.",
  },
  {
    icon: Lock,
    title: "Your data stays yours",
    body: "Row-level isolation (DPDP-ready), 2FA, backups and staff-exit access removal — each RM sees only their own book.",
  },
  {
    icon: Users2,
    title: "Built with working ARN holders",
    body: "Designed around the real MFD day — CAMS/KFintech imports, family reviews, SIP recovery — not a generic CRM bent to fit.",
  },
];

/** Real, attributable client quotes only — leave empty until you have them. */
const TESTIMONIALS: { quote: string; name: string; detail: string }[] = [];

/* ───────────────────────── Helper components ───────────────────────── */

function Stat({ value, suffix, label }: { value: number; suffix?: string; label: string }) {
  return (
    <div className="text-center flex flex-col items-center justify-center">
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-primary tabular-nums">
        <CountUp value={value} suffix={suffix} />
      </div>
      <div className="text-xs text-muted-foreground font-semibold mt-1.5 max-w-[180px]">{label}</div>
    </div>
  );
}

function Spotlight({
  eyebrow,
  title,
  body,
  points,
  accent,
  reverse,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  accent: string;
  reverse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid lg:grid-cols-2 gap-10 lg:gap-16 items-center ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
      <div>
        <span className="chip bg-brand-navy-light text-primary">{eyebrow}</span>
        <h2 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground leading-tight">{title}</h2>
        <p className="mt-4 text-muted-foreground leading-relaxed">{body}</p>
        <ul className="mt-6 flex flex-col gap-3">
          {points.map((pt) => (
            <li key={pt} className="flex items-start gap-2.5 text-sm font-medium text-foreground/85">
              <CheckCircle2 className="size-4.5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              {pt}
            </li>
          ))}
        </ul>
      </div>
      <div className={`relative rounded-2xl bg-secondary/40 p-6 sm:p-10 flex items-center justify-center border border-border/30`}>
        {children}
      </div>
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
