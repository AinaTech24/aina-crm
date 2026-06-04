import Link from "next/link";
import type { Metadata } from "next";
import {
  ShieldCheck, TrendingUp, Brain, Sprout, HeartHandshake, GitBranch,
  MessageSquare, BarChart3, Users, Lock, ScrollText, ArrowRight, Check,
  Clock, Star, AlertTriangle, IndianRupee, LineChart, Bell, HelpCircle,
  ShieldAlert, RefreshCw, Zap, ArrowDownRight, CheckCircle2, ChevronRight,
} from "lucide-react";

export const metadata: Metadata = {
  title: "AINA CRM — CRM & Automation for Indian Mutual Fund Distributors (MFDs)",
  description:
    "Run your MFD practice on autopilot. Reconcile CAMS & KFintech feeds dynamically, recover bounced SIPs via automated WhatsApp, ensure 100% SEBI compliance with our 11-rule gate, and track live portfolio XIRR per family unit. Built for Indian ARN-holding distributors.",
  keywords: [
    "Mutual Fund Distributor CRM",
    "MFD software India",
    "CAMS KFintech feed reconciliation",
    "SEBI compliant whatsapp MFD",
    "live XIRR portfolio tracker",
    "AMFI compliance software",
    "ARN holder CRM",
    "AUM growth automation",
  ],
  alternates: { canonical: "/" },
};

/** Structured data for Google Search rich snippets (Product + FAQ). */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Aina CRM",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "All-in-one CRM and automation platform built for Indian Mutual Fund Distributors. Automates CAMS/KFintech feed ingestion, runs SEBI-compliant WhatsApp workflows, tracks family portfolio XIRR, and offers AI-powered client churn warnings.",
      offers: {
        "@type": "Offer",
        price: "14999",
        priceCurrency: "INR",
        priceValidUntil: "2026-12-31",
      },
      featureList: [
        "Dynamic CAMS & KFintech feed mapping",
        "11-Rule SEBI compliance gate for WhatsApp & Email",
        "Automated SIP ECS bounce recovery sequences",
        "Live portfolio AMFI NAV valuation & XIRR",
        "AI-powered client churn radar and retention scripts",
        "Multi-tenant RM allocation and role-based access control",
        "Family and household wealth grouping",
      ],
    },
    {
      "@type": "Organization",
      name: "Aina Tech Services LLP",
      description: "Creator of Aina CRM — the premier automation operating system for Mutual Fund Distributors in India.",
      brand: "Aina CRM",
    },
  ],
};

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col bg-background relative overflow-x-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      {/* Background Mesh Overlay */}
      <div className="absolute top-0 left-0 right-0 h-[60rem] pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-[30%] -left-[20%] w-[80%] h-[80%] rounded-full bg-gradient-to-tr from-brand-navy-light/70 to-transparent blur-3xl opacity-60" />
        <div className="absolute -top-[20%] -right-[15%] w-[60%] h-[70%] rounded-full bg-gradient-to-bl from-brand-cyan-light/50 to-transparent blur-3xl opacity-50" />
      </div>

      {/* ───────────────────────── Nav ───────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/75 backdrop-blur-xl transition-all">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="inline-flex items-center hover:opacity-90 transition-opacity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aina-logo.png" alt="Aina CRM Logo" className="h-8 w-auto object-contain shrink-0" />
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-muted-foreground">
            <a href="#features" className="hover:text-primary transition-colors">Features</a>
            <a href="#pain-points" className="hover:text-primary transition-colors">Pain Points</a>
            <a href="#automation" className="hover:text-primary transition-colors">How It Works</a>
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
      <section className="relative pt-12 pb-24 lg:pt-20 lg:pb-32 z-10">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          
          {/* Left Column: Copy & Actions */}
          <div className="lg:col-span-7 flex flex-col items-start text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-6">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              AMFI & SEBI 2026 Ready · DPDP Compliant Data Isolation
            </span>
            
            <h1 className="text-4xl sm:text-5xl lg:text-[3.75rem] font-extrabold tracking-tight leading-[1.1] text-foreground">
              Run your entire MFD practice on{" "}
              <span className="text-gradient">autopilot</span>.
            </h1>
            
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl">
              Stop fighting with spreadsheets and manual RTA updates. AINA is the dedicated CRM built for Indian ARN holders. Reconcile CAMS/KFintech feeds dynamically, recover bounced SIPs automatically via WhatsApp, and value portfolios in real-time with zero trail leakage.
            </p>
            
            <div className="mt-8 flex flex-wrap gap-4 w-full sm:w-auto">
              <Link href="/signup" className="btn-primary text-base px-7 py-3 w-full sm:w-auto justify-center">
                Claim Free Workspace <ArrowRight className="size-5" />
              </Link>
              <Link href="/dashboard" className="btn-secondary text-base px-7 py-3 w-full sm:w-auto justify-center">
                Try Live Demo
              </Link>
            </div>
            
            {/* Social Trust Metrics */}
            <div className="mt-10 pt-8 border-t border-border/60 w-full flex flex-col sm:flex-row items-start sm:items-center gap-6 text-sm text-muted-foreground">
              <div className="flex -space-x-3">
                <div className="size-9 rounded-full bg-brand-navy border-2 border-background flex items-center justify-center text-[10px] font-bold text-white">RM</div>
                <div className="size-9 rounded-full bg-brand-cyan border-2 border-background flex items-center justify-center text-[10px] font-bold text-white">OP</div>
                <div className="size-9 rounded-full bg-brand-violet border-2 border-background flex items-center justify-center text-[10px] font-bold text-white">M</div>
                <div className="size-9 rounded-full bg-brand-mint border-2 border-background flex items-center justify-center text-[10px] font-bold text-white">AN</div>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1">
                  <span className="flex text-amber-500">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className="size-4 fill-current stroke-amber-500" />
                    ))}
                  </span>
                  <span className="font-bold text-foreground ml-1">4.9/5 Rating</span>
                </div>
                <span>Trusted by 500+ Indian ARN holders & MFD aggregators</span>
              </div>
            </div>
          </div>

          {/* Right Column: Premium Dashboard Graphic (Glassmorphism) */}
          <div className="lg:col-span-5 relative w-full flex justify-center">
            {/* Ambient decorative glowing back-panel */}
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-brand-navy to-brand-cyan opacity-20 blur-xl pointer-events-none" />
            
            <div className="glass-card rounded-2xl w-full max-w-[460px] p-5 relative border border-white/20 shadow-2xl flex flex-col gap-4">
              
              {/* Card Header */}
              <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <span className="pulse-dot" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">AMFI Live Ingest Feed</span>
                </div>
                <span className="text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                  Synced: Just Now
                </span>
              </div>

              {/* AUM Metric Block */}
              <div>
                <span className="text-xs text-muted-foreground font-medium">Practice Managed Assets</span>
                <div className="text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight mt-1 text-foreground flex items-baseline gap-1">
                  ₹4,28,16,500
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
                  <TrendingUp className="size-3.5" />
                  <span>▲ ₹58.4L unrealised gain (+16.42% XIRR)</span>
                </div>
              </div>

              {/* Decorative SVG Sparkline Graph */}
              <div className="h-20 w-full mt-2 relative">
                <svg viewBox="0 0 400 100" className="w-full h-full overflow-visible">
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
                  {/* Grid lines */}
                  <line x1="0" y1="20" x2="400" y2="20" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
                  <line x1="0" y1="50" x2="400" y2="50" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
                  <line x1="0" y1="80" x2="400" y2="80" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
                  {/* Fill Area */}
                  <path
                    d="M0,90 C50,85 70,60 100,65 C130,70 160,40 190,45 C220,50 250,25 280,30 C310,35 340,10 400,5 L400,100 L0,100 Z"
                    fill="url(#gradient-area)"
                  />
                  {/* Glowing Line */}
                  <path
                    d="M0,90 C50,85 70,60 100,65 C130,70 160,40 190,45 C220,50 250,25 280,30 C310,35 340,10 400,5"
                    fill="none"
                    stroke="url(#gradient-line)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                  {/* Pulsing indicator node */}
                  <circle cx="400" cy="5" r="5" fill="hsl(var(--brand-cyan))" />
                  <circle cx="400" cy="5" r="10" fill="none" stroke="hsl(var(--brand-cyan))" strokeOpacity="0.4" strokeWidth="2" />
                </svg>
              </div>

              {/* Sub-widgets showing operations */}
              <div className="grid grid-cols-2 gap-3 mt-1">
                <div className="rounded-xl border border-border/50 bg-secondary/35 p-3 flex flex-col justify-between hover-glow-cyan transition-all">
                  <div className="flex justify-between items-center">
                    <Brain className="size-4.5 text-rose-500 shrink-0" />
                    <span className="pulse-warning-dot" />
                  </div>
                  <div className="mt-3">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Churn Radar</span>
                    <span className="text-xs font-bold text-foreground mt-0.5 block leading-tight">3 At-Risk Folios</span>
                    <span className="text-[9px] text-muted-foreground block mt-0.5">Retention plays ready</span>
                  </div>
                </div>

                <div className="rounded-xl border border-border/50 bg-secondary/35 p-3 flex flex-col justify-between hover-glow-cyan transition-all">
                  <div className="flex justify-between items-center">
                    <ShieldCheck className="size-4.5 text-emerald-600 shrink-0" />
                    <span className="size-2 rounded-full bg-emerald-500" />
                  </div>
                  <div className="mt-3">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">SEBI Gate</span>
                    <span className="text-xs font-bold text-foreground mt-0.5 block leading-tight">100% Compliant</span>
                    <span className="text-[9px] text-muted-foreground block mt-0.5">No EUIN violations</span>
                  </div>
                </div>
              </div>

              {/* Active SIP Bounce Alert Banner */}
              <div className="rounded-xl bg-brand-navy-light/70 border border-brand-navy/15 p-3 flex items-start gap-2.5">
                <ShieldAlert className="size-4.5 text-brand-navy shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-brand-navy-deep uppercase tracking-wider">SIP Bounce Alert</span>
                    <span className="text-[8px] bg-brand-navy text-white px-1.5 py-0.2 rounded font-bold uppercase">Auto-recovery</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                    ECS mandate failure detected for <strong className="text-foreground">Sharma Family</strong>. WhatsApp reminder queued.
                  </p>
                </div>
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* ───────────────────── Trust / Stats Bar ───────────────────── */}
      <section className="border-y border-border/40 bg-secondary/20 relative z-10 py-10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          <Stat value="₹2,500 Cr+" label="Indian MFD AUM Tracked" />
          <Stat value="24+" label="Out-of-box Automation Recipes" />
          <Stat value="13,900+" label="AMFI Schemes Syncing Live" />
          <Stat value="11 Rules" label="Deterministic SEBI Compliance checks" />
        </div>
      </section>

      {/* ───────────────────────── Pain Points Section ───────────────────────── */}
      <section id="pain-points" className="py-20 lg:py-28 relative z-10 bg-background/50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-navy-light px-3 py-1 text-xs font-semibold text-brand-navy-deep">
              The Reality of Indian MFDs
            </span>
            <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Why spreadsheets and basic CRMs are costing you AUM
            </h2>
            <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
              Distributors lose an average of 6% to 8% of their assets under management annually to silent redemptions, unmonitored commission structures, and missed ECS bounces. Here is how AINA changes the game.
            </p>
          </div>

          <div className="mt-16 grid lg:grid-cols-2 gap-8 items-stretch">
            
            {/* The Manual Nightmare (Spreadsheets) */}
            <div className="rounded-2xl border border-rose-500/15 bg-rose-500/[0.01] p-6 sm:p-8 flex flex-col gap-6">
              <div className="flex items-center gap-3 border-b border-rose-500/10 pb-4">
                <div className="size-10 rounded-xl bg-rose-100 dark:bg-rose-950/30 flex items-center justify-center text-rose-500 shrink-0">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">The Manual Spreadsheet Chaos</h3>
                  <span className="text-[11px] font-semibold text-rose-500 uppercase tracking-wider">High Risk · High Effort · Leakage</span>
                </div>
              </div>

              <ul className="flex flex-col gap-5 flex-1">
                <li className="flex gap-3">
                  <ShieldAlert className="size-5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm text-foreground">RTA Column Adjustments Break Imports</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Every time CAMS or KFintech adds or shifts a column in their brokerage statements, your manual import processes crash. Reconciliations stall for days.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <ShieldAlert className="size-5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm text-foreground">SIP ECS Bounces Go Unnoticed</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Bank mandate rejections slip by. By the time you notice an SIP has ceased, the client has lost the saving habit, and your future AUM stops compounding.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <ShieldAlert className="size-5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm text-foreground">Silent Investor Churn</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Clients redeem or halt plans without warning. RMs only spot the closure months later during routine portfolio reviews, after the AUM has left your platform.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <ShieldAlert className="size-5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm text-foreground">Compliance Inspection Anxiety</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Worrying if WhatsApp broadcasts contain required ARN disclosures, EUIN stamps, or compliance footnotes. Gathering logs for audits consumes weeks of work.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            {/* The AINA Solution */}
            <div className="rounded-2xl border border-brand-cyan/20 bg-brand-cyan/[0.02] p-6 sm:p-8 flex flex-col gap-6 hover-glow-cyan transition-all">
              <div className="flex items-center gap-3 border-b border-brand-cyan/20 pb-4">
                <div className="size-10 rounded-xl bg-brand-cyan-light dark:bg-brand-cyan-deep/30 flex items-center justify-center text-accent shrink-0">
                  <Zap className="size-5 text-accent" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">The AINA Autopilot Engine</h3>
                  <span className="text-[11px] font-semibold text-accent uppercase tracking-wider">Zero Effort · 100% Protected · High Growth</span>
                </div>
              </div>

              <ul className="flex flex-col gap-5 flex-1">
                <li className="flex gap-3">
                  <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm text-foreground">Dynamic RTA Mapping Engine</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Our feed parser resolves column index mapping dynamically based on column text headers. New fields or column shifting will never break your CAMS/KFintech uploads.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm text-foreground">Instant WhatsApp ECS Bounce Recovery</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Event pipelines detect rejections instantly. The system triggers an automated WhatsApp message with a secure AMFI-authorized payment link to catch the bounce.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm text-foreground">Predictive Churn Radar & AI Plays</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      AI scores retention risks based on static activity, redemptions, and query logs. Signals high-risk folios and writes custom outreach templates for your RMs.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm text-foreground">11-Rule Gate Keeps You SEBI-Clean</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Every broadcast runs through an automated checkpoint before dispatch. Auto-appends ARN taglines, logs customer consent, and keeps your audit trails inspection-ready.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* ───────────────────── Core Features Grid ───────────────────── */}
      <section id="features" className="py-20 bg-secondary/15 border-y border-border/40 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto">
            <span className="chip bg-brand-cyan-light text-brand-cyan-deep">Features Built For Indian MFDs</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
              Everything you need to scale your distributor firm
            </h2>
            <p className="mt-3 text-muted-foreground">
              Move beyond generic CRMs. Experience automation tailored specifically for mutual fund portfolios.
            </p>
          </div>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {CORE_FEATURES.map((f) => (
              <article key={f.title} className="glass-card hover-glow-cyan rounded-xl p-6 border border-border/40 hover:shadow-lg transition-all flex flex-col justify-between">
                <div>
                  <div className={`size-11 rounded-lg grid place-items-center ${f.bg} shrink-0`}>
                    <f.icon className={`size-5.5 ${f.fg}`} />
                  </div>
                  <h3 className="font-bold mt-4 text-[15px] text-foreground flex items-center gap-2">
                    {f.title}
                    {f.badge && (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${f.badgeBg} ${f.badgeFg}`}>
                        {f.badge}
                      </span>
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

      {/* ───────────────────── Flagship Deep Dives (Spotlights) ───────────────────── */}
      <section className="py-20 lg:py-28 max-w-7xl mx-auto px-6 space-y-24 lg:space-y-36 relative z-10">
        
        {/* Spotlight 1: Live NAV & XIRR Engine */}
        <Spotlight
          eyebrow="Portfolio Intelligence"
          title="Daily AMFI NAV updates & true household XIRR"
          body="Ditch manual valuation calculations. AINA pulls daily mutual fund NAV files directly from AMFI (covering 13,900+ schemes) to calculate real-time valuations, absolute returns, and cash-flow-adjusted XIRR per folio and household."
          points={[
            "Daily automated AMFI NAV sync for complete accuracy",
            "Consolidated family views to track total household wealth",
            "Automatic notification on significant portfolio milestones",
          ]}
          accent="from-brand-cyan/10 to-brand-cyan/2"
        >
          <div className="w-full flex flex-col gap-3.5 bg-background/80 dark:bg-card p-4 sm:p-5 rounded-xl border border-border/50 shadow-md">
            <div className="flex justify-between items-center border-b border-border/60 pb-2">
              <span className="text-xs font-bold text-foreground">Household Assets Review</span>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Consolidated</span>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-muted-foreground">Nippon India Large Cap</span>
                <span className="font-mono tabular-nums text-foreground">₹12,45,600 (15.8% XIRR)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-muted-foreground">Parag Parikh Flexi Cap</span>
                <span className="font-mono tabular-nums text-foreground">₹18,12,000 (17.2% XIRR)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-muted-foreground">SBI Small Cap Fund</span>
                <span className="font-mono tabular-nums text-foreground">₹6,88,400 (19.4% XIRR)</span>
              </div>
            </div>
            
            <div className="border-t border-border/60 pt-2 flex items-center justify-between text-xs font-bold mt-2">
              <span className="text-foreground">Total Family Portfolio</span>
              <span className="text-gradient">₹37,46,000 (16.9% XIRR)</span>
            </div>
          </div>
        </Spotlight>

        {/* Spotlight 2: Predictive Churn Radar AI */}
        <Spotlight
          reverse
          eyebrow="Retention Technology"
          title="Detect churn before folios are liquidated"
          body="AINA monitors subtle behaviors — redemption spikes, suspended SIPs, low email/WhatsApp engagement, and recent performance drops. The platform flags high-risk accounts and drafts tailored retention scripts automatically."
          points={[
            "Explainable AI scoring system detailing risk metrics",
            "Auto-generated outreach drafts based on historical behavior",
            "Daily task allocation rules to direct your RM's attention",
          ]}
          accent="from-rose-500/10 to-rose-500/2"
        >
          <div className="w-full flex flex-col gap-4 bg-background/80 dark:bg-card p-4 sm:p-5 rounded-xl border border-border/50 shadow-md">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-foreground">RM Retention Worklist</span>
              <span className="text-[9px] bg-rose-500 text-white px-2 py-0.5 rounded font-bold">Action Needed</span>
            </div>
            
            <div className="space-y-3">
              <div className="p-2.5 rounded-lg bg-rose-500/5 border border-rose-500/10 flex items-center justify-between text-xs">
                <div>
                  <strong className="text-foreground block">Rajesh Mehta</strong>
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">2 SIPs stopped · 84% Risk Score</span>
                </div>
                <button className="text-[10px] font-bold bg-rose-500 text-white px-2.5 py-1 rounded hover:bg-rose-600 transition-colors">
                  Open Play
                </button>
              </div>

              <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10 flex items-center justify-between text-xs">
                <div>
                  <strong className="text-foreground block">Pooja Sharma</strong>
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">Unusual partial redemption · 62% Risk</span>
                </div>
                <button className="text-[10px] font-bold bg-amber-500 text-white px-2.5 py-1 rounded hover:bg-amber-600 transition-colors">
                  Open Play
                </button>
              </div>
            </div>
          </div>
        </Spotlight>

        {/* Spotlight 3: Deterministic Compliance Gate */}
        <Spotlight
          eyebrow="Compliance Safeguard"
          title="Automated, non-bypassable SEBI filter"
          body="Rest easy during audits. Every single message, WhatsApp template, and email dispatched through AINA automatically processes through an 11-rule gate. Checks for opt-out links, consent records, and correct ARN/EUIN identifiers."
          points={[
            "11-rule SEBI checks applied automatically on all channels",
            "Auto-injected compliance footers with ARN and disclaimers",
            "Permanent audit log details to generate DDQ packs in seconds",
          ]}
          accent="from-emerald-500/10 to-emerald-500/2"
        >
          <div className="w-full max-w-[280px] bg-emerald-500/5 rounded-2xl border border-emerald-500/20 p-4 shadow-lg flex flex-col gap-3">
            <div className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
              <ShieldCheck className="size-5 text-emerald-600" />
              <span className="text-xs font-bold text-emerald-800 dark:text-emerald-400">SEBI-Compliant Gateway</span>
            </div>
            
            {/* WhatsApp template demo */}
            <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 shadow-sm text-[10px]">
              <p className="text-slate-800 dark:text-slate-200">
                Dear Sunil, your monthly portfolio report has been compiled successfully. Live XIRR: 15.6%.
              </p>
              <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[8px] text-slate-400 leading-tight">
                ARN-123456 | AMFI registered | Mutual Fund investments are subject to market risks. Read all scheme documents carefully. Reply UNSUB to opt-out.
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] font-bold text-emerald-600">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="size-3" /> Gate Passed
              </span>
              <span>100% compliant send</span>
            </div>
          </div>
        </Spotlight>

      </section>

      {/* ───────────────────────── Interactive Automation Stepper ───────────────────────── */}
      <section id="automation" className="py-20 lg:py-28 bg-secondary/15 border-y border-border/40 relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl font-extrabold tracking-tight text-foreground">How AINA automates your operations</h2>
            <p className="mt-3 text-muted-foreground text-sm">
              An event occurs. AINA detects it, validates it, and triggers compliant recovery sequences without human intervention.
            </p>
          </div>

          <div className="mt-16 grid md:grid-cols-4 gap-6 relative">
            
            {/* Step 1 */}
            <div className="glass-card rounded-xl p-5 flex flex-col gap-3 relative border border-border/50 hover-glow-cyan transition-all">
              <div className="size-8 rounded-lg bg-rose-500/10 text-rose-500 font-bold text-sm flex items-center justify-center border border-rose-500/20">1</div>
              <div>
                <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                  ECS Mandate Bounced
                  <span className="pulse-danger-dot" />
                </h4>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  CAMS/KFintech reports a bounced SIP transaction due to insufficient client bank balance.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="glass-card rounded-xl p-5 flex flex-col gap-3 relative border border-border/50 hover-glow-cyan transition-all">
              <div className="size-8 rounded-lg bg-brand-cyan/15 text-accent font-bold text-sm flex items-center justify-center border border-brand-cyan/30">2</div>
              <div>
                <h4 className="font-bold text-sm text-foreground">Compliance Gate Validation</h4>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  The engine verifies client opt-in logs, fetches current scheme codes, and constructs SEBI compliant text headers.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="glass-card rounded-xl p-5 flex flex-col gap-3 relative border border-border/50 hover-glow-cyan transition-all">
              <div className="size-8 rounded-lg bg-brand-cyan/15 text-accent font-bold text-sm flex items-center justify-center border border-brand-cyan/30">3</div>
              <div>
                <h4 className="font-bold text-sm text-foreground">WhatsApp Dispatch</h4>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  A personalized recovery notification containing a secure AMFI payment URL is routed directly to their WhatsApp.
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="glass-card rounded-xl p-5 flex flex-col gap-3 relative border border-border/50 hover-glow-cyan transition-all">
              <div className="size-8 rounded-lg bg-emerald-500/10 text-emerald-500 font-bold text-sm flex items-center justify-center border border-emerald-500/20">4</div>
              <div>
                <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                  SIP Recovered
                  <span className="pulse-dot" />
                </h4>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  The investor completes payment in one tap. Your AUM compounding remains active and your commission trail is secured.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ───────────────────────── Pricing ───────────────────────── */}
      <section id="pricing" className="py-20 lg:py-28 relative z-10 max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto">
          <span className="chip bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
            Founding Member Special Pricing
          </span>
          <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Two simple plans. Pick what your firm needs.
          </h2>
          <p className="mt-3 text-muted-foreground">
            A one-time setup gets your firm fully live, then a flat ₹14,999 per user / year. No hidden fees.
          </p>
        </div>

        <div className="mt-16 grid sm:grid-cols-2 gap-8 items-stretch max-w-4xl mx-auto">
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
                  Most Popular for MFD Firms
                </span>
              )}
              <h3 className="font-extrabold text-xl text-foreground">{p.name}</h3>
              <p className="text-xs text-muted-foreground mt-2 min-h-[30px] leading-relaxed">{p.for}</p>
              
              <div className="mt-4 pt-4 border-t border-border/40">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-extrabold text-foreground">{p.setup}</span>
                  <span className="text-sm text-muted-foreground font-semibold">one-time setup</span>
                </div>
                <div className="mt-1.5 text-sm text-muted-foreground font-medium">
                  then <span className="font-bold text-foreground">{p.price}</span> {p.unit}
                </div>
              </div>
              
              {p.featured && (
                <p className="mt-5 text-sm font-bold text-foreground">
                  Everything in Starter, plus:
                </p>
              )}
              <div className="mt-5 flex flex-col gap-4 flex-grow">
                {p.groups.map((g) => (
                  <div key={g.title}>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-foreground/70 mb-2">
                      {g.title}
                    </div>
                    <ul className="flex flex-col gap-2">
                      {g.items.map((f) => (
                        <li key={f} className="flex items-start gap-2.5 text-xs text-muted-foreground font-medium">
                          <Check className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              
              <Link href="/signup" className={`mt-8 w-full ${p.featured ? "btn-primary" : "btn-secondary"} font-bold py-3 text-center justify-center shadow-md`}>
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
        
        <p className="text-center text-xs text-muted-foreground mt-8 max-w-lg mx-auto">
          * Dynamic RTA feed onboarding supports all standard CAMS/KFintech exports. Compliance gate features auto-update with current SEBI regulations. Taxes as applicable.
        </p>
      </section>

      {/* ───────────────────────── FAQ (Details/Summary Accordion) ───────────────────────── */}
      <section id="faq" className="py-20 lg:py-28 bg-secondary/10 border-t border-border/40 relative z-10">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="chip bg-brand-cyan-light text-brand-cyan-deep">Answering Your Concerns</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">Frequently Asked Questions</h2>
            <p className="mt-3 text-muted-foreground">
              Everything you need to know about our compliance features, feed data imports, and team setups.
            </p>
          </div>

          <div className="space-y-4">
            {FAQS.map((faq, idx) => (
              <details
                key={idx}
                className="group glass-card rounded-xl border border-border/40 p-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex justify-between items-center font-bold text-sm sm:text-base cursor-pointer select-none text-foreground">
                  <span>{faq.q}</span>
                  <ChevronRight className="size-5 transition-transform group-open:rotate-90 text-muted-foreground" />
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
            Stop losing AUM to manual operational gaps.
          </h2>
          <p className="mt-4 text-white/80 text-base max-w-xl mx-auto leading-relaxed">
            Set up your AINA CRM workspace in minutes. Let our automation engines track returns, manage client compliance, and recover failed SIPs, freeing your time for relationships.
          </p>
          <div className="mt-8 flex flex-wrap gap-4 justify-center">
            <Link href="/signup" className="rounded-xl bg-white text-brand-navy-deep hover:bg-white/90 px-8 py-3 text-base font-bold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-md inline-flex items-center gap-2">
              Start Free Trial <ArrowRight className="size-5" />
            </Link>
            <Link href="/dashboard" className="rounded-xl border border-white/20 bg-white/5 text-white hover:bg-white/10 px-8 py-3 text-base font-bold transition-all shadow-sm">
              Explore Demo
            </Link>
          </div>
        </div>
      </section>

      {/* ───────────────────────── Footer ───────────────────────── */}
      <footer className="border-t border-border/40 bg-secondary/20 relative z-10">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/aina-wordmark.png" alt="AINA Wordmark Logo" className="h-8 w-auto object-contain shrink-0" />
              <p className="text-xs text-muted-foreground mt-4 leading-relaxed max-w-xs">
                AINA CRM is the dedicated practice management and automation operating system designed exclusively for Mutual Fund Distributors in India. Built by Aina Tech Services LLP.
              </p>
            </div>
            <FooterCol title="Product Capabilities" links={[["Feature List", "#features"], ["Pain Points Solved", "#pain-points"], ["Operations Automation", "#automation"], ["Pricing Plans", "#pricing"]]} />
            <FooterCol title="Identity" links={[["System Login", "/login"], ["Free Trial Registration", "/signup"], ["Developer Sandbox", "/dashboard"]]} />
            <FooterCol title="Compliance Security" links={[["SEBI Gate Rules", "#features"], ["DPDP Data Guidelines", "#features"], ["AMFI Sync Feeds", "#features"]]} />
          </div>
          
          <div className="mt-14 pt-8 border-t border-border/40 flex flex-col lg:flex-row justify-between gap-4 text-[11px] text-muted-foreground leading-relaxed">
            <span>© {new Date().getFullYear()} Aina Tech Services LLP. All rights reserved.</span>
            <span className="max-w-2xl lg:text-right">
              Disclaimer: Mutual Fund investments are subject to market risks. Read all scheme related documents carefully. Aina CRM provides automation and analytics tools for distributors and does not execute mutual fund transactions directly.
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ───────────────────────── Static Data Arrays ───────────────────────── */

const CORE_FEATURES = [
  {
    icon: GitBranch,
    title: "Operations Automation Engine",
    benefit: "Deploy pre-built recipe pipelines targeting MFD milestones. Reconcile transactions, follow up on pending mandates, and send birthday wishes automatically.",
    bg: "bg-brand-navy-light/70",
    fg: "text-brand-navy",
    impact: "90% manual workload cut",
  },
  {
    icon: ShieldCheck,
    title: "11-Rule SEBI Compliance Gate",
    benefit: "Ensures every WhatsApp, Email, or SMS message dispatched contains appropriate disclaimers, Opt-out strings, and verified ARN details automatically.",
    bg: "bg-emerald-500/10",
    fg: "text-emerald-600 dark:text-emerald-400",
    badge: "Strict Protection",
    badgeBg: "bg-emerald-500/15",
    badgeFg: "text-emerald-700 dark:text-emerald-300",
    impact: "Zero SEBI audit risk",
  },
  {
    icon: TrendingUp,
    title: "Live Portfolio XIRR Sync",
    benefit: "Connect client folios to automated AMFI scheme valuation pipelines. Computes cash-flow adjusted XIRR and absolute gains instantly for family groupings.",
    bg: "bg-brand-cyan-light/70",
    fg: "text-brand-cyan-deep",
    impact: "1-Click Client reviews",
  },
  {
    icon: Brain,
    title: "AI Churn-Risk Radar",
    benefit: "Evaluates folio stability, redemption history, and communication response logs. Automatically flags client risk levels and prepares custom RM scripts.",
    bg: "bg-rose-500/10",
    fg: "text-rose-500",
    badge: "AI-Powered",
    badgeBg: "bg-rose-500/15",
    badgeFg: "text-rose-700 dark:text-rose-300",
    impact: "30% customer drop reduction",
  },
  {
    icon: Sprout,
    title: "Tax-Harvesting Planner",
    benefit: "Scans client portfolios for unrealized LTCG limits and maps tax saving transactions (up to ₹1,25,000/yr per household) automatically.",
    bg: "bg-emerald-500/10",
    fg: "text-emerald-600 dark:text-emerald-400",
    impact: "₹15,625 average annual savings",
  },
  {
    icon: HeartHandshake,
    title: "Referral Engine & Advocate Radar",
    benefit: "Monitors satisfaction signals and prompts top-tier investors for reviews or client referrals automatically using compliant WhatsApp flows.",
    bg: "bg-violet-500/10",
    fg: "text-brand-violet",
    impact: "2.5x referral sign-ups",
  },
];

const PLANS = [
  {
    name: "Starter",
    for: "Everything a growing MFD firm needs to run day-to-day — clients, money, service, compliance & marketing in one organised place.",
    setup: "₹49,000",
    price: "₹14,999",
    unit: "/ user / year",
    featured: false,
    cta: "Start Free Trial",
    groups: [
      {
        title: "Run your day",
        items: [
          "Role-based home screen for owner, RMs & back-office",
          "A daily 'what to do next' list for every team member",
          "Shared calendar for tasks, meetings & client reviews",
          "Live team performance at a glance",
        ],
      },
      {
        title: "Know every client",
        items: [
          "Complete 360° client records with health scoring & full ledger",
          "Group households to see total family wealth",
          "Capture, score & convert every lead from enquiry to client",
          "Risk profiles on file; never miss a birthday or anniversary",
        ],
      },
      {
        title: "Advise & track money",
        items: [
          "SIP, goal & retirement calculators built in",
          "Generate proposals with a built-in suitability check",
          "Full transaction history with live value & returns (XIRR)",
          "Track every SIP and catch bounced / failed instalments",
          "Insurance policies, claims & renewals tracked end-to-end",
        ],
      },
      {
        title: "Serve & communicate",
        items: [
          "Log every interaction; one-click WhatsApp / email / SMS",
          "Resolve service requests on time with satisfaction tracking",
          "SEBI-ready complaint register",
          "One unified inbox & outbox for all client conversations",
        ],
      },
      {
        title: "Market your practice",
        items: [
          "Approved WhatsApp / Email / SMS templates",
          "Run marketing campaigns & plan your social content",
          "Simple rules that auto-create tasks & send messages",
          "Build client segments and monitor every automation run",
        ],
      },
      {
        title: "Stay compliant & organised",
        items: [
          "Inspection-ready compliance center & full audit trail",
          "Secure document vault, team announcements & duplicate clean-up",
          "Cyber-readiness register for RBI / SEBI expectations",
        ],
      },
      {
        title: "Run the firm",
        items: [
          "Manage employees & sub-distributors",
          "Legal registrations, AMC empanelments & scheme master",
          "Standard reports, MIS & trail-income forecast",
          "Firm profile, billing, settings & integrations (WAina, etc.)",
        ],
      },
    ],
  },
  {
    name: "Growth",
    for: "Everything in Starter — plus automation, AI & analytics to scale AUM without adding headcount.",
    setup: "₹79,000",
    price: "₹14,999",
    unit: "/ user / year",
    featured: true,
    cta: "Start Free Trial",
    groups: [
      {
        title: "Automate the busywork",
        items: [
          "A firm-wide command center that surfaces the day's actions",
          "Advanced no-code workflow builder + sales-ops rules",
        ],
      },
      {
        title: "Win & keep more clients with AI",
        items: [
          "Live buying-intent signals on every lead",
          "Churn radar that flags clients about to leave — before they go",
          "Cross-sell & top-up opportunity finder across your whole book",
          "Tax-harvesting suggestions, ready to act on",
          "An AI assistant for instant client briefs & answers",
        ],
      },
      {
        title: "Deeper planning & insight",
        items: [
          "Goal-based planning & complete financial plans",
          "Visual deal pipeline board",
          "Portfolio intelligence & analytics",
        ],
      },
      {
        title: "Stronger operations",
        items: [
          "Auto-import CAMS / KFintech feeds with 3-way reconciliation",
          "Early-warning radar for SIPs at risk",
        ],
      },
      {
        title: "Capture every rupee you're owed",
        items: [
          "Insurance protection-gap radar & commission tracking",
          "MF commission reconciliation",
          "Practice P&L, expenses & monthly targets",
        ],
      },
      {
        title: "Premium content & deeper compliance",
        items: [
          "Ready-made, co-branded creatives library",
          "AMFI DDQ readiness checklist + circular digests",
          "Nomination tracker & SOP library",
          "Team attendance & leave management",
        ],
      },
    ],
  },
];

const FAQS = [
  {
    q: "How fast can I onboard my MFD book of business?",
    a: "Onboarding is fast. Simply export your client lists, folios, or transactions from your RTA back-office (CAMS or KFintech) and drop them into AINA. Our dynamic header mapping resolves column orders automatically. Most firms are fully operational within 30 minutes.",
  },
  {
    q: "What happens when RTAs change the column headers in their statement exports?",
    a: "Unlike legacy MFD software which breaks when imports shift, AINA utilizes a dynamic header-mapping parser. It automatically resolves columns based on text headers (e.g. mapping PAN_NO, PAN, or INV_PAN to the canonical PAN field) instead of strict index offsets.",
  },
  {
    q: "Is my client financial data kept secure?",
    a: "Absolutely. AINA enforces strict multi-tenant isolation at the database layer (Row-Level Security) using transaction-scoped tokens. Every single query is wrapped in tenant authentication boundaries. We also employ strict role-based access control, ensuring relationship managers can only view accounts assigned to them.",
  },
  {
    q: "How does AINA guarantee WhatsApp messaging compliance with SEBI?",
    a: "Every outbound communication runs through a deterministic 11-rule SEBI Compliance Gate. The system checks for validated client consent, auto-injects your registration ARN/EUIN identifiers, appends required risk disclaimers, and adds unsubscribe options. Your compliance trail is logged automatically for audit inspection.",
  },
  {
    q: "Do you support family/household wealth grouping?",
    a: "Yes. MFDs can group individual investor accounts into unified household structures. This enables you to review overall asset exposure, compute consolidated XIRR performance charts, and prepare family-level review decks in one click.",
  },
];

/* ───────────────────────── Helper Components ───────────────────────── */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center flex flex-col items-center justify-center">
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gradient">
        {value}
      </div>
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mt-1.5 max-w-[180px] leading-snug">
        {label}
      </div>
    </div>
  );
}

function Spotlight({
  eyebrow, title, body, points, accent, reverse, children,
}: {
  eyebrow: string; title: string; body: string; points: string[];
  accent: string; reverse?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`grid lg:grid-cols-12 gap-10 lg:gap-16 items-center ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
      
      {/* Content Column */}
      <div className="lg:col-span-6 flex flex-col items-start text-left">
        <span className="inline-flex items-center gap-1 bg-secondary text-foreground/80 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded">
          {eyebrow}
        </span>
        <h3 className="mt-3.5 text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground leading-tight">
          {title}
        </h3>
        <p className="mt-4 text-sm sm:text-base text-muted-foreground leading-relaxed">
          {body}
        </p>
        <ul className="mt-6 flex flex-col gap-3">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2 text-xs font-semibold text-muted-foreground">
              <Check className="size-4.5 text-emerald-600 mt-0.5 shrink-0" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
      
      {/* Visual Component Column */}
      <div className={`lg:col-span-6 w-full flex justify-center`}>
        <div className={`w-full max-w-[420px] rounded-2xl border border-border/50 bg-gradient-to-br ${accent} p-6 sm:p-8 flex justify-center items-center shadow-lg relative overflow-hidden`}>
          {/* subtle radial blur element inside */}
          <div className="absolute inset-0 bg-white/5 dark:bg-black/5 backdrop-blur-xs" />
          <div className="relative w-full z-10 flex justify-center items-center">
            {children}
          </div>
        </div>
      </div>

    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div className="flex flex-col items-start">
      <div className="text-xs font-bold uppercase tracking-wider text-foreground mb-4">
        {title}
      </div>
      <ul className="flex flex-col gap-2.5">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
