import Link from "next/link";
import type { Metadata } from "next";
import {
  ShieldCheck, TrendingUp, Brain, GitBranch,
  MessageSquare, BarChart3, Lock, ArrowRight, Check, Calculator,
  Clock, Star, IndianRupee, Bell, FileSpreadsheet,
  ShieldAlert, Zap, CheckCircle2, ChevronRight, Upload, Cog, Rocket,
  Users2,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────────────
   SEO — written around what Indian MFDs actually type into Google:
   "mutual fund software for distributors", "MFD CRM India", "CAMS KFintech
   import software", "SIP tracking software", "mutual fund distributor app",
   "AMFI compliant WhatsApp", "trail commission reconciliation".
   ───────────────────────────────────────────────────────────────────────── */
export const metadata: Metadata = {
  title: "AINA CRM — Mutual Fund Software for Distributors | MFD CRM India",
  description:
    "The all-in-one mutual fund distributor software built for Indian ARN holders. Auto-import CAMS & KFintech files, track every SIP and AUM live, recover bounced SIPs on WhatsApp, send AMFI-compliant messages, 60+ client-ready financial calculators, branded reports & MIS. Start free.",
  keywords: [
    "mutual fund software for distributors",
    "MFD software India",
    "mutual fund distributor CRM",
    "best CRM for mutual fund distributors",
    "MFD back office software",
    "CAMS KFintech file import software",
    "SIP tracking software for distributors",
    "AUM tracking software India",
    "AMFI compliant WhatsApp software",
    "trail commission reconciliation software",
    "financial calculators for MFD",
    "mutual fund client reporting software",
    "ARN holder practice management",
    "SEBI compliance software MFD",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "AINA CRM — Mutual Fund Software for Distributors (MFD CRM India)",
    description:
      "Auto-import CAMS/KFintech, live AUM & XIRR, WhatsApp SIP-bounce recovery, AMFI-compliant messaging, 60+ calculators, branded client reports. Built only for Indian MFDs.",
    siteName: "AINA CRM",
  },
  twitter: {
    card: "summary_large_image",
    title: "AINA CRM — Mutual Fund Software for Distributors",
    description:
      "Run your MFD practice on autopilot: CAMS/KFintech auto-import, SIP bounce recovery on WhatsApp, AMFI-compliant comms, 60+ calculators, live family XIRR.",
  },
};

/* FAQ content doubles as the FAQPage rich-snippet source — keep both in sync. */
const FAQS = [
  {
    q: "Which software is best for mutual fund distributors in India?",
    a: "The best MFD software covers your whole day in one place: client CRM, CAMS/KFintech file import, live AUM & XIRR valuation, SIP tracking with bounce alerts, AMFI/SEBI-compliant WhatsApp & email, financial calculators, and inspection-ready compliance records. AINA CRM was built only for Indian ARN holders, so all of this works out of the box — no generic-CRM customisation projects.",
  },
  {
    q: "Can AINA import my CAMS and KFintech files automatically?",
    a: "Yes. Drop any standard CAMS or KFintech export (holdings, transactions, SIP, mandate, folio master and more) into AINA and the dynamic header-mapping parser reads it — even when the RTA adds or re-orders columns. On the Growth plan, feeds auto-ingest on a schedule with 3-way reconciliation, so your book is always current without late-night Excel work.",
  },
  {
    q: "How do I track my clients' SIPs and catch bounced instalments?",
    a: "AINA tracks every SIP per client and family. The moment an instalment bounces or a mandate fails, it raises an alert, creates a task for the RM, and can automatically send the client a compliant WhatsApp reminder — so the SIP restarts before the saving habit breaks and your future trail is protected.",
  },
  {
    q: "Is WhatsApp marketing allowed for mutual fund distributors? How does AINA keep it compliant?",
    a: "Yes — when done with consent and the right disclosures. Every message sent from AINA passes an 11-rule compliance gate before dispatch: client consent is verified, your ARN/EUIN identification is stamped, the market-risk disclaimer and opt-out are appended, and the full trail is logged. Meta-approved WhatsApp templates are managed inside the platform.",
  },
  {
    q: "Is my client data safe? Who can see it?",
    a: "Your data is isolated at the database level with row-level security — every query is locked to your firm. Inside the firm, role-based access ensures an RM sees only their own book while the owner sees everything. The platform is designed for India's DPDP data-protection expectations, with audit logs on every sensitive action.",
  },
  {
    q: "What does MFD software cost in India?",
    a: "AINA keeps it simple: a one-time setup per firm, then a flat per-user yearly fee — from ₹9,999 (Starter) to ₹14,999 (Premium), billed annually with a 3-user minimum. No per-client charges and no AUM-linked fees — your software bill doesn't grow just because your AUM does.",
  },
];

/** Structured data for Google rich results (Software + Organization + FAQ). */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "AINA CRM",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Mutual fund software for Indian distributors (MFDs): CAMS/KFintech auto-import, live AUM & family XIRR, SIP bounce recovery on WhatsApp, AMFI/SEBI-compliant messaging, 60+ financial calculators, branded reports and MIS.",
      offers: { "@type": "Offer", price: "9999", priceCurrency: "INR", priceValidUntil: "2026-12-31" },
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
      description: "Maker of AINA CRM — the practice-management and automation platform for Mutual Fund Distributors in India.",
      brand: "AINA CRM",
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
    <main className="min-h-screen flex flex-col bg-background relative overflow-x-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* Ambient background mesh */}
      <div className="absolute top-0 left-0 right-0 h-[60rem] pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-[30%] -left-[20%] w-[80%] h-[80%] rounded-full bg-gradient-to-tr from-brand-navy-light/70 to-transparent blur-3xl opacity-60" />
        <div className="absolute -top-[20%] -right-[15%] w-[60%] h-[70%] rounded-full bg-gradient-to-bl from-brand-cyan-light/50 to-transparent blur-3xl opacity-50" />
      </div>

      {/* ───────────────────────── Nav ───────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/75 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="inline-flex items-center hover:opacity-90 transition-opacity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aina-logo.png" alt="AINA CRM — mutual fund software for distributors" className="h-8 w-auto object-contain shrink-0" />
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm font-semibold text-muted-foreground">
            <a href="#features" className="hover:text-primary transition-colors">Features</a>
            <a href="#calculators" className="hover:text-primary transition-colors">Calculators</a>
            <a href="#how-it-works" className="hover:text-primary transition-colors">How It Works</a>
            <a href="#pricing" className="hover:text-primary transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-primary transition-colors">FAQ</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-semibold px-4 py-2 rounded-lg hover:bg-secondary text-foreground/80 hover:text-foreground transition-all">
              Log in
            </Link>
            <Link href="/signup" className="btn-primary text-sm font-semibold shadow-glow-navy">
              Start Free <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative pt-12 pb-20 lg:pt-20 lg:pb-28 z-10">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Copy */}
          <div className="lg:col-span-7 flex flex-col items-start text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-6">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              Built only for Indian MFDs · AMFI & SEBI-aware · DPDP-ready data isolation
            </span>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.6rem] font-extrabold tracking-tight leading-[1.08] text-foreground">
              The mutual fund distributor software that gives you your{" "}
              <span className="text-gradient">evenings back</span>.
            </h1>

            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl">
              Stop juggling Excel, RTA portals and WhatsApp. AINA imports your CAMS/KFintech files
              automatically, tracks every SIP and rupee of AUM live, recovers bounced SIPs on WhatsApp,
              and keeps every message AMFI-compliant — while you spend your time with clients, not spreadsheets.
            </p>

            {/* Proof bullets — scannable, keyword-bearing */}
            <ul className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm font-medium text-foreground/85">
              {[
                "CAMS & KFintech files import themselves",
                "Live AUM, folio value & family XIRR daily",
                "SIP bounce → WhatsApp recovery, automatic",
                "60+ client-ready calculators, branded PDFs",
                "AMFI/SEBI-compliant WhatsApp, email & SMS",
                "Trail, commission & practice P&L in one MIS",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-4 w-full sm:w-auto">
              <Link href="/signup" className="btn-primary text-base px-7 py-3 w-full sm:w-auto justify-center">
                Claim Free Workspace <ArrowRight className="size-5" />
              </Link>
              <Link href="/dashboard" className="btn-secondary text-base px-7 py-3 w-full sm:w-auto justify-center">
                Try Live Demo
              </Link>
            </div>

            <div className="mt-9 pt-7 border-t border-border/60 w-full">
              <div className="flex flex-wrap items-center gap-x-7 gap-y-3 text-xs font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-600" /> AMFI &amp; SEBI-aware by design
                </span>
                <span className="inline-flex items-center gap-2">
                  <Lock className="size-4 text-brand-cyan-deep" /> Row-level data isolation (DPDP-ready)
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
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-brand-navy to-brand-cyan opacity-20 blur-xl pointer-events-none" />

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
                      <stop offset="50%" stopColor="hsl(var(--brand-cyan))" />
                      <stop offset="100%" stopColor="hsl(var(--brand-cyan))" />
                    </linearGradient>
                  </defs>
                  <line x1="0" y1="20" x2="400" y2="20" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
                  <line x1="0" y1="50" x2="400" y2="50" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
                  <line x1="0" y1="80" x2="400" y2="80" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
                  <path d="M0,90 C50,85 70,60 100,65 C130,70 160,40 190,45 C220,50 250,25 280,30 C310,35 340,10 400,5 L400,100 L0,100 Z" fill="url(#gradient-area)" />
                  <path d="M0,90 C50,85 70,60 100,65 C130,70 160,40 190,45 C220,50 250,25 280,30 C310,35 340,10 400,5" fill="none" stroke="url(#gradient-line)" strokeWidth="3.5" strokeLinecap="round" />
                  <circle cx="400" cy="5" r="5" fill="hsl(var(--brand-cyan))" />
                  <circle cx="400" cy="5" r="10" fill="none" stroke="hsl(var(--brand-cyan))" strokeOpacity="0.4" strokeWidth="2" />
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
            <Stat value="60+" label="Client-ready financial calculators" />
            <Stat value="13,900+" label="AMFI schemes valued daily" />
            <Stat value="40+" label="Ready-made automation recipes" />
            <Stat value="11 rules" label="Compliance checks on every send" />
          </div>
        </div>
      </section>

      {/* ───────────────────── Core features ───────────────────── */}
      <section id="features" className="py-20 bg-secondary/15 border-y border-border/40 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="chip bg-brand-cyan-light text-brand-cyan-deep">One platform, your whole practice</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
              Everything an Indian MFD needs — nothing a generic CRM drags in
            </h2>
            <p className="mt-3 text-muted-foreground">
              Client 360°, money, service, marketing, compliance and MIS — designed around folios,
              families, SIPs and trail, not “deals” and “tickets”.
            </p>
          </div>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {CORE_FEATURES.map((f, i) => (
              <article key={f.title} className="group glass-card hover-glow-cyan rounded-xl p-6 border border-border/40 hover:shadow-lg transition-all flex flex-col justify-between relative overflow-hidden">
                <span className="absolute top-3 right-4 text-3xl font-black tabular-nums text-foreground/[0.06] group-hover:text-brand-cyan/15 transition-colors select-none">
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

      {/* ───────────────────── Integrations strip ───────────────────── */}
      <section className="py-16 relative z-10 border-b border-border/40">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <span className="chip bg-brand-cyan-light text-brand-cyan-deep">Works with the rails you already run on</span>
          <h2 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            Plugs into your RTAs, WhatsApp and payments — no rip-and-replace
          </h2>
          <p className="mt-3 text-sm text-muted-foreground max-w-2xl mx-auto">
            AINA reads your existing exports and connects to the channels Indian MFDs already use, so you keep your stack and just add the brain on top.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {[
              "CAMS", "KFintech", "AMFI NAV feed", "WhatsApp (AiSensy)", "MSG91 SMS",
              "Email (Resend)", "Razorpay", "NSE NMF II", "BSE STAR MF",
            ].map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card px-4 py-2.5 text-sm font-semibold text-foreground/80 shadow-sm hover:border-brand-cyan/40 hover:text-foreground transition-colors"
              >
                <span className="size-1.5 rounded-full bg-brand-cyan" />
                {name}
              </span>
            ))}
          </div>
          <p className="mt-6 text-[11px] text-muted-foreground">
            You connect your own WhatsApp / SMS / email accounts — so messaging stays in your name, at your cost, with no per-message markup from us.
          </p>
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
                  <Calculator className="size-3.5 text-brand-cyan-deep shrink-0" />
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
            <span className="chip bg-brand-cyan-light text-brand-cyan-deep">Live in a day, not a quarter</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">How your firm moves to AINA</h2>
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
                  <div className="size-9 rounded-lg bg-brand-cyan/15 text-accent font-extrabold text-sm flex items-center justify-center border border-brand-cyan/30">{s.step}</div>
                  <s.icon className="size-5 text-brand-cyan-deep" />
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
                  ? "border-brand-cyan/40 bg-brand-cyan/[0.03] shadow-xl md:-translate-y-2 ring-1 ring-brand-cyan/30"
                  : "border-border/60"
              }`}
            >
              {p.featured && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-brand-navy to-brand-cyan text-white text-[10px] uppercase font-bold tracking-widest px-3 py-1 rounded-full shadow-md">
                  Most popular with MFD firms
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
            <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5 text-brand-cyan-deep" /> Row-level data isolation</span>
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
            <span className="chip bg-brand-cyan-light text-brand-cyan-deep">Questions MFDs ask us</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
              Mutual fund distributor software — FAQs
            </h2>
            <p className="mt-3 text-muted-foreground">
              Straight answers on data import, SIP tracking, WhatsApp compliance, calculators, security and pricing.
            </p>
          </div>

          <div className="space-y-4">
            {FAQS.map((faq, idx) => (
              <details key={idx} className="group glass-card rounded-xl border border-border/40 p-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex justify-between items-center font-bold text-sm sm:text-base cursor-pointer select-none text-foreground gap-3">
                  <span>{faq.q}</span>
                  <ChevronRight className="size-5 transition-transform group-open:rotate-90 text-muted-foreground shrink-0" />
                </summary>
                <div className="mt-3 pt-3 border-t border-border/30 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── Final CTA ───────────────────────── */}
      <section className="py-20 max-w-6xl mx-auto px-6 relative z-10">
        <div className="rounded-2xl brand-mesh p-8 sm:p-14 text-center relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 size-80 rounded-full bg-white/5 blur-3xl pointer-events-none" />
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Your AUM compounds. Your admin shouldn&apos;t.
          </h2>
          <p className="mt-4 text-white/80 text-base max-w-xl mx-auto leading-relaxed">
            Set up your AINA workspace in minutes. Import your book, switch on the automations,
            and get back to the only thing that grows a practice — client conversations.
          </p>
          <div className="mt-8 flex flex-wrap gap-4 justify-center">
            <Link href="/signup" className="rounded-xl bg-white text-brand-navy-deep hover:bg-white/90 px-8 py-3 text-base font-bold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-md inline-flex items-center gap-2">
              Start Free Trial <ArrowRight className="size-5" />
            </Link>
            <Link href="/dashboard" className="rounded-xl border border-white/20 bg-white/5 text-white hover:bg-white/10 px-8 py-3 text-base font-bold transition-all shadow-sm">
              Explore Demo
            </Link>
          </div>
          <div className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-semibold text-white/70">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5" /> Free trial — no card needed</span>
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
              <img src="/aina-wordmark.png" alt="AINA CRM" className="h-8 w-auto object-contain shrink-0" />
              <p className="text-xs text-muted-foreground mt-4 leading-relaxed max-w-xs">
                AINA CRM is mutual fund software for distributors in India — client CRM, CAMS/KFintech
                import, SIP &amp; AUM tracking, AMFI-compliant WhatsApp, 60+ financial calculators,
                reports and MIS for ARN holders. Built by Aina Tech Services LLP.
              </p>
            </div>
            <FooterCol title="For MFDs" links={[["Feature tour", "#features"], ["Financial calculators", "#calculators"], ["How it works", "#how-it-works"], ["Pricing", "#pricing"]]} />
            <FooterCol title="Get started" links={[["Pricing plans", "#pricing"], ["Start free trial", "/signup"], ["Log in", "/login"], ["Live demo", "/dashboard"]]} />
            <FooterCol title="Trust & compliance" links={[["AMFI/SEBI compliance gate", "#features"], ["Data security (DPDP)", "#faq"], ["FAQs", "#faq"]]} />
          </div>

          <div className="mt-14 pt-8 border-t border-border/40 flex flex-col lg:flex-row justify-between gap-4 text-[11px] text-muted-foreground leading-relaxed">
            <span>© {new Date().getFullYear()} Aina Tech Services LLP. All rights reserved.</span>
            <span className="max-w-2xl lg:text-right">
              Disclaimer: Mutual fund investments are subject to market risks. Read all scheme-related
              documents carefully. AINA CRM provides practice-management, analytics and communication
              tools for distributors and does not execute mutual fund transactions.
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ───────────────────────── Static data ───────────────────────── */

/** First-person pains MFDs recognise instantly — each mapped to the fix. */
const PAIN_POINTS = [
  {
    icon: FileSpreadsheet,
    pain: "My evenings disappear into CAMS and KFintech Excel files.",
    cost: "Manual imports break every time the RTA shifts a column. Reconciliation slips, the book goes stale, and you're doing data entry at 11 pm instead of planning tomorrow's meetings.",
    fix: "Drop the file — AINA's dynamic header-mapping reads any standard CAMS/KFintech export even when columns move, and the Growth plan auto-ingests feeds with 3-way reconciliation. Your book updates itself.",
  },
  {
    icon: Bell,
    pain: "I find out about SIP bounces weeks after they happen.",
    cost: "Every silent bounce breaks a client's saving habit and quietly stops your future trail from compounding. Multiply that across a book and it's lakhs of lost AUM a year.",
    fix: "Bounces are flagged the day they hit the feed. AINA alerts the RM, and the automation sends the client a compliant WhatsApp nudge with what to do next — most SIPs restart before the next cycle.",
  },
  {
    icon: TrendingUp,
    pain: "Clients redeem without ever telling me first.",
    cost: "By the time a redemption shows up in the feed, the money — and often the relationship — is gone. There was a window to talk; you never knew it was open.",
    fix: "The churn radar watches stopped SIPs, unusual redemptions and fading engagement, scores every client's risk with reasons, and queues a retention play — so your RM calls before the form is signed.",
  },
  {
    icon: ShieldAlert,
    pain: "Every WhatsApp broadcast makes me nervous about AMFI and SEBI.",
    cost: "One missing ARN line or disclaimer in a forwarded message can turn an inspection into a nightmare. Reconstructing communication logs for an audit takes weeks.",
    fix: "You can't send a non-compliant message from AINA — an 11-rule gate verifies consent, stamps ARN/EUIN, appends disclaimers and opt-out, and logs everything. Your audit pack assembles itself.",
  },
  {
    icon: Clock,
    pain: "A single client review takes me half a day to prepare.",
    cost: "Pulling valuations, computing returns, formatting a deck — for one family. So reviews get postponed, and postponed reviews are how relationships (and AUM) drift away.",
    fix: "Daily AMFI NAVs keep every folio valued. One click produces a branded family review — total wealth, XIRR, SIP health — plus 60+ calculators to make the next recommendation land.",
  },
  {
    icon: Users2,
    pain: "My practice lives in six different apps and nobody sees the whole picture.",
    cost: "Excel for AUM, WhatsApp for clients, a diary for tasks, the RTA portal for transactions, email for proposals. Handoffs leak, juniors can't be trusted with the full book, and you are the bottleneck.",
    fix: "One platform: client 360° with family grouping, tasks and reviews, comms inbox, proposals, service requests, compliance and MIS — with role-based access so each RM sees exactly their own book.",
  },
];

const CORE_FEATURES = [
  {
    icon: GitBranch,
    title: "Automation engine, 40+ recipes",
    benefit: "SIP-bounce recovery, review reminders, birthday wishes, KYC document collection, mandate-expiry alerts — switch on ready-made workflows that run your back office around the clock.",
    bg: "bg-brand-navy-light/70",
    fg: "text-brand-navy",
    impact: "Hours saved every single day",
  },
  {
    icon: ShieldCheck,
    title: "11-rule AMFI/SEBI compliance gate",
    benefit: "Every WhatsApp, email and SMS is checked before it leaves: consent, ARN/EUIN, disclaimers, opt-out — auto-applied and logged for inspection day.",
    bg: "bg-emerald-500/10",
    fg: "text-emerald-600 dark:text-emerald-400",
    badge: "Non-bypassable",
    badgeBg: "bg-emerald-500/15",
    badgeFg: "text-emerald-700 dark:text-emerald-300",
    impact: "Inspection-ready, always",
  },
  {
    icon: TrendingUp,
    title: "Live AUM & family XIRR",
    benefit: "Daily AMFI NAVs value every folio automatically. True cash-flow XIRR per folio, client and household — client reviews become one click, not one evening.",
    bg: "bg-brand-cyan-light/70",
    fg: "text-brand-cyan-deep",
    impact: "1-click client reviews",
  },
  {
    icon: Brain,
    title: "AI churn radar & opportunity finder",
    benefit: "Stopped SIPs, odd redemptions and silence are scored into an explainable risk number with a ready retention play. Cross-sell and top-up chances surface across your whole book.",
    bg: "bg-rose-500/10",
    fg: "text-rose-500",
    badge: "AI-powered",
    badgeBg: "bg-rose-500/15",
    badgeFg: "text-rose-700 dark:text-rose-300",
    impact: "Keep AUM you'd have lost",
  },
  {
    icon: MessageSquare,
    title: "WhatsApp-first client engagement",
    benefit: "Meta-approved templates managed in-app, one unified inbox for every conversation, document-collection links clients tap to upload KYC — all consent-tracked and compliant.",
    bg: "bg-brand-cyan-light/70",
    fg: "text-brand-cyan-deep",
    impact: "Replies where clients live",
  },
  {
    icon: Lock,
    title: "Bank-grade data isolation",
    benefit: "Row-level security locks every query to your firm; role-based access keeps each RM inside their own book. Designed for India's DPDP expectations with audit logs throughout.",
    bg: "bg-emerald-500/10",
    fg: "text-emerald-600 dark:text-emerald-400",
    impact: "Your book stays yours",
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
    featured: true,
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
      "AINA Content Library",
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
    featured: false,
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

/* ───────────────────────── Helper components ───────────────────────── */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center flex flex-col items-center justify-center">
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gradient">{value}</div>
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
        <span className="chip bg-brand-cyan-light text-brand-cyan-deep">{eyebrow}</span>
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
      <div className={`relative rounded-2xl bg-gradient-to-br ${accent} p-6 sm:p-10 flex items-center justify-center border border-border/30`}>
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
