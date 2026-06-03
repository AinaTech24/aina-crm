import Link from "next/link";
import type { Metadata } from "next";
import {
  Zap, ShieldCheck, TrendingUp, Brain, Sprout, HeartHandshake, GitBranch,
  MessageSquare, BarChart3, Users, Lock, ScrollText, ArrowRight, Check,
  Clock, Sparkles, Star, AlertTriangle, IndianRupee, LineChart, Bell, FileCheck2,
} from "lucide-react";

export const metadata: Metadata = {
  title: "MFD Growth OS — CRM & Automation for Mutual Fund Distributors",
  description:
    "Run your entire MFD practice on autopilot. SEBI-compliant WhatsApp & email automation, live portfolio XIRR, AI churn prediction, SIP tracking, tax-harvesting and a guided lead-to-client pipeline — built for Indian ARN-holding firms.",
  alternates: { canonical: "/" },
};

/** Structured data so Google can render a rich result for the product + brand. */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "MFD Growth OS",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "All-in-one CRM and automation platform for Indian Mutual Fund Distributors — SEBI-compliant messaging, live XIRR, AI churn prediction, SIP tracking and practice automation.",
      offers: {
        "@type": "Offer",
        price: "14999",
        priceCurrency: "INR",
        priceValidUntil: "2026-12-31",
      },
      featureList: [
        "SEBI-compliant WhatsApp & email automation",
        "Live portfolio valuation & XIRR",
        "AI churn-risk prediction",
        "Tax-harvesting planner",
        "SIP tracker & rejection recovery",
        "Lead-to-client blueprint pipeline",
        "Reports & MIS",
      ],
    },
    {
      "@type": "Organization",
      name: "AINA Technologies",
      description: "Maker of MFD Growth OS — the practice operating system for Indian Mutual Fund Distributors.",
      brand: "MFD Growth OS",
    },
  ],
};

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      {/* ───────────────────────── Nav ───────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-lg tracking-tight">
            <div className="size-8 rounded-lg brand-gradient grid place-items-center text-white shadow-sm">
              <Zap className="size-4" />
            </div>
            <span>MFD Growth OS</span>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how" className="hover:text-foreground transition-colors">How it works</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <Link href="/dashboard/workflows" className="hover:text-foreground transition-colors">Workflows</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden sm:inline-flex text-sm font-medium px-4 py-2 rounded-lg hover:bg-secondary transition-colors">
              Log in
            </Link>
            <Link href="/signup" className="btn-primary text-sm">
              Start free <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative overflow-hidden brand-soft">
        <div className="absolute -top-40 -right-40 size-[32rem] rounded-full bg-brand-cyan/10 blur-3xl" />
        <div className="max-w-7xl mx-auto px-6 py-20 lg:py-28 grid lg:grid-cols-2 gap-14 items-center relative">
          <div className="animate-fade-in">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/30 bg-brand-cyan-light/60 px-3.5 py-1.5 text-xs font-semibold text-brand-cyan-deep">
              <span className="size-1.5 rounded-full bg-brand-cyan animate-pulse" />
              SEBI 2026-ready · DPDP compliant · AMFI-checked sends
            </span>
            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05]">
              Grow your MFD practice on{" "}
              <span className="bg-gradient-to-r from-brand-navy to-brand-cyan bg-clip-text text-transparent">autopilot</span>.
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-xl">
              The all-in-one CRM that runs your back-office for you — compliant WhatsApp & email
              automation, live portfolio XIRR, AI that flags clients before they leave, and a guided
              pipeline from first call to active SIP. Built for Indian ARN-holding firms.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="btn-primary text-base px-6 py-3">
                Start free — no card needed <ArrowRight className="size-4" />
              </Link>
              <Link href="/dashboard" className="btn-secondary text-base px-6 py-3">
                Try the live demo
              </Link>
            </div>
            <div className="mt-7 flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex -space-x-2">
                {["bg-brand-navy", "bg-brand-cyan", "bg-brand-violet", "bg-brand-mint"].map((c, i) => (
                  <div key={i} className={`size-7 rounded-full ${c} ring-2 ring-background`} />
                ))}
              </div>
              <span className="flex items-center gap-1">
                <span className="flex text-amber-400">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className="size-3.5 fill-current" />)}</span>
                Loved by modern ARN holders
              </span>
            </div>
          </div>

          {/* Hero visual — floating product cards */}
          <div className="relative animate-fade-in lg:pl-6">
            <div className="rounded-2xl brand-mesh p-6 shadow-2xl">
              <div className="rounded-xl bg-background p-4 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-muted-foreground">Live portfolio value</span>
                  <span className="chip bg-emerald-50 text-emerald-700 text-[10px]">XIRR 14.2% p.a.</span>
                </div>
                <div className="text-3xl font-bold tabular-nums">₹2,48,16,500</div>
                <div className="text-xs text-emerald-600 font-medium mt-0.5">▲ ₹38.1L unrealised gain</div>
                <div className="mt-3 h-12 flex items-end gap-1">
                  {[40, 55, 48, 62, 70, 65, 82, 78, 92, 88, 100].map((h, i) => (
                    <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-brand-cyan/40 to-brand-cyan" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="rounded-xl bg-background p-3 shadow-lg">
                  <Brain className="size-4 text-rose-500" />
                  <div className="text-xs font-semibold mt-1.5">Churn radar</div>
                  <div className="text-[10px] text-muted-foreground">3 clients at risk → retention play ready</div>
                </div>
                <div className="rounded-xl bg-background p-3 shadow-lg">
                  <ShieldCheck className="size-4 text-emerald-600" />
                  <div className="text-xs font-semibold mt-1.5">Compliance Guard</div>
                  <div className="text-[10px] text-muted-foreground">Every send SEBI-checked, 0 violations</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────── Trust / stats bar ───────────────────── */}
      <section className="border-y border-border/60 bg-card/50">
        <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat value="24+" label="Pre-built automations" />
          <Stat value="40+" label="Canned MIS reports" />
          <Stat value="13,900+" label="Schemes priced live (AMFI)" />
          <Stat value="100%" label="Compliant sends, by design" />
        </div>
      </section>

      {/* ───────────────────────── Problem ───────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Your AUM is growing. Your spreadsheets can&apos;t keep up.
        </h2>
        <p className="mt-4 text-lg text-muted-foreground leading-relaxed max-w-3xl mx-auto">
          Missed SIP renewals. Clients who quietly redeemed. A SEBI inspection you weren&apos;t ready
          for. Referrals you forgot to ask for. Every manual gap is AUM walking out the door — and the
          MFDs winning the next decade have already stopped doing this by hand.
        </p>
        <div className="mt-8 grid sm:grid-cols-3 gap-4 text-left">
          {[
            { icon: AlertTriangle, t: "Clients leave silently", d: "Without a churn signal, you find out a folio closed only after the redemption clears." },
            { icon: Clock, t: "Compliance eats your week", d: "Manually checking every message for ARN taglines and SEBI rules doesn't scale past a handful of clients." },
            { icon: LineChart, t: "No single source of truth", d: "Folios in CAMS, SIPs in Excel, tasks on WhatsApp. Nothing talks to anything." },
          ].map((p) => (
            <div key={p.t} className="card-surface p-5">
              <p.icon className="size-5 text-rose-500" />
              <h3 className="font-semibold mt-3">{p.t}</h3>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────────── Features → benefits ───────────────────── */}
      <section id="features" className="bg-card/40 border-y border-border/60">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="text-center max-w-2xl mx-auto">
            <span className="chip bg-brand-cyan-light text-brand-cyan-deep">Everything in one place</span>
            <h2 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">
              One platform. Every job in your practice.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Not a feature list — an outcome list. Here&apos;s what each does for your firm.
            </p>
          </div>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <article key={f.title} className="card-surface p-6 hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className={`size-11 rounded-xl grid place-items-center ${f.bg}`}>
                  <f.icon className={`size-5 ${f.fg}`} />
                </div>
                <h3 className="font-semibold mt-4 text-[15px]">{f.title}</h3>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{f.benefit}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────── Spotlight (3 flagship) ───────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-20 space-y-20">
        <Spotlight
          eyebrow="Live data"
          title="Show clients their real returns — live."
          body="We pull the AMFI NAV feed every day and value every folio: current worth, unrealised gain, and true money-weighted XIRR per scheme and per client. No more 'I'll check and call you back.'"
          points={["Daily AMFI NAV for 13,900+ schemes", "XIRR + absolute return per client & scheme", "Honest coverage — unpriced schemes flagged, never hidden"]}
          icon={TrendingUp}
          accent="from-brand-cyan/15 to-brand-cyan/5"
        />
        <Spotlight
          reverse
          eyebrow="Predictive AI"
          title="Catch the client about to leave — before they do."
          body="A transparent risk model watches redemptions, SIP stops, returns and engagement, then scores every client. High-risk ones surface with the exact reasons and an AI-drafted retention play your RM can act on today."
          points={["Explainable score — every reason shown", "Retention worklist, highest-risk first", "AI retention play, SEBI-safe by design"]}
          icon={Brain}
          accent="from-rose-500/15 to-rose-500/5"
        />
        <Spotlight
          eyebrow="The moat"
          title="Compliance you never have to think about."
          body="Every WhatsApp, email and SMS passes a non-bypassable 11-rule SEBI gate before it leaves — ARN tagline, risk disclaimer, consent, opt-out. The audit trail feeds your DDQ pack automatically."
          points={["Non-bypassable gate on every send", "ARN/EUIN footer auto-injected", "AMFI/SEBI circular digest — in plain English"]}
          icon={ShieldCheck}
          accent="from-emerald-500/15 to-emerald-500/5"
        />
      </section>

      {/* ───────────────────────── How it works ───────────────────────── */}
      <section id="how" className="bg-card/40 border-y border-border/60">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Live in an afternoon.</h2>
            <p className="mt-4 text-muted-foreground text-lg">No IT team. No migration headache.</p>
          </div>
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            {[
              { n: "1", t: "Import your book", d: "Drop in your client, SIP and transaction Excel — or your CAMS/KFintech file. We map it in minutes." },
              { n: "2", t: "Turn on automations", d: "Pick from 24+ ready recipes — birthday wishes, SIP recovery, review reminders, churn alerts. One click each." },
              { n: "3", t: "Watch it run", d: "Compliant messages send themselves, dashboards stay live, and your team works the worklists that matter." },
            ].map((s) => (
              <div key={s.n} className="relative card-surface p-6">
                <div className="size-10 rounded-xl brand-gradient text-white grid place-items-center font-bold shadow">{s.n}</div>
                <h3 className="font-semibold mt-4 text-lg">{s.t}</h3>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── FOMO band ───────────────────────── */}
      <section className="brand-mesh text-white">
        <div className="max-w-5xl mx-auto px-6 py-16 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold">
            <Clock className="size-3.5" /> The window is now
          </span>
          <h2 className="mt-5 text-3xl sm:text-4xl font-bold tracking-tight">
            SEBI&apos;s new rules are live. Your competitors are automating.
          </h2>
          <p className="mt-4 text-white/80 text-lg leading-relaxed max-w-2xl mx-auto">
            India&apos;s ₹68 lakh crore mutual-fund industry is going digital fast. The distributors who
            automate compliance and client experience now will own the relationships — and the AUM — for
            the next decade. Every month on spreadsheets is a head-start you give away.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link href="/signup" className="rounded-xl bg-white text-brand-navy px-6 py-3 font-semibold hover:bg-white/90 transition-colors inline-flex items-center gap-2">
              Claim your free workspace <ArrowRight className="size-4" />
            </Link>
            <Link href="/dashboard" className="rounded-xl border border-white/30 px-6 py-3 font-semibold hover:bg-white/10 transition-colors">
              See the demo first
            </Link>
          </div>
        </div>
      </section>

      {/* ───────────────────────── Pricing ───────────────────────── */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center max-w-2xl mx-auto">
          <span className="chip bg-amber-50 text-amber-700">Founding-member pricing · limited</span>
          <h2 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">Honest pricing. No per-seat traps.</h2>
          <p className="mt-4 text-muted-foreground text-lg">One firm, your whole team. Cancel anytime.</p>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-5 items-start">
          {PLANS.map((p) => (
            <div key={p.name} className={`card-elevated p-6 ${p.featured ? "ring-2 ring-brand-cyan relative" : ""}`}>
              {p.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 chip bg-brand-cyan text-white text-[10px] uppercase tracking-wide">
                  Most popular
                </span>
              )}
              <h3 className="font-semibold text-lg">{p.name}</h3>
              <p className="text-xs text-muted-foreground mt-1 h-8">{p.for}</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{p.price}</span>
                <span className="text-sm text-muted-foreground">{p.unit}</span>
              </div>
              <ul className="mt-5 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="size-4 text-emerald-600 mt-0.5 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className={`mt-6 w-full ${p.featured ? "btn-primary" : "btn-secondary"} justify-center`}>
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-6">
          All plans include the SEBI compliance gate, audit trail and bank-grade security. GST extra.
        </p>
      </section>

      {/* ───────────────────────── Final CTA ───────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="card-elevated brand-soft p-10 sm:p-14 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Stop running your practice from memory.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg max-w-xl mx-auto">
            Spin up your firm&apos;s workspace in minutes and let the platform do the chasing, the
            checking and the calculating — so you can do the advising.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link href="/signup" className="btn-primary text-base px-7 py-3">
              Start free <ArrowRight className="size-4" />
            </Link>
            <Link href="/dashboard" className="btn-secondary text-base px-7 py-3">
              Explore the demo
            </Link>
          </div>
        </div>
      </section>

      {/* ───────────────────────── Footer ───────────────────────── */}
      <footer className="border-t border-border/60 bg-card/40">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 font-bold">
                <div className="size-7 rounded-lg brand-gradient grid place-items-center text-white">
                  <Zap className="size-4" />
                </div>
                MFD Growth OS
              </div>
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed max-w-xs">
                The practice operating system for Indian Mutual Fund Distributors. Built by AINA Technologies.
              </p>
            </div>
            <FooterCol title="Product" links={[["Features", "#features"], ["Pricing", "#pricing"], ["How it works", "#how"], ["Workflows", "/dashboard/workflows"]]} />
            <FooterCol title="Company" links={[["Log in", "/login"], ["Start free", "/signup"], ["Live demo", "/dashboard"]]} />
            <FooterCol title="Trust" links={[["SEBI-aligned sends", "#features"], ["DPDP-ready data", "#features"], ["Security", "#features"]]} />
          </div>
          <div className="mt-10 pt-6 border-t border-border/60 flex flex-col sm:flex-row justify-between gap-3 text-xs text-muted-foreground">
            <span>© {new Date().getFullYear()} AINA Technologies. All rights reserved.</span>
            <span className="max-w-xl sm:text-right">
              Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ───────────────────────── Data ───────────────────────── */

const FEATURES = [
  { icon: GitBranch, title: "Automation engine", benefit: "24+ ready recipes run your back-office — birthdays, SIP recovery, reviews, anniversaries — hands-off.", bg: "bg-brand-navy-light", fg: "text-brand-navy" },
  { icon: ShieldCheck, title: "Compliance Guard", benefit: "Every message passes an 11-rule SEBI gate before it sends. You literally can't be non-compliant.", bg: "bg-emerald-50", fg: "text-emerald-600" },
  { icon: TrendingUp, title: "Live NAV & XIRR", benefit: "Daily AMFI NAV values every folio. Show clients real, money-weighted returns on the spot.", bg: "bg-brand-cyan-light", fg: "text-brand-cyan-deep" },
  { icon: Brain, title: "Churn prediction AI", benefit: "Spot clients about to redeem before they do — with the reasons and an AI retention play.", bg: "bg-rose-50", fg: "text-rose-500" },
  { icon: Sprout, title: "Tax-harvesting", benefit: "Find every client's tax-free LTCG headroom and save them up to ₹15,625/yr — one report.", bg: "bg-emerald-50", fg: "text-emerald-600" },
  { icon: HeartHandshake, title: "Referral growth engine", benefit: "Turn happy clients into your sales team — advocate radar, auto thank-yous, conversion tracking.", bg: "bg-violet-50", fg: "text-brand-violet" },
  { icon: GitBranch, title: "Lead → client blueprint", benefit: "A guided pipeline from first call to active SIP, with SLAs. Nothing slips through the cracks.", bg: "bg-brand-navy-light", fg: "text-brand-navy" },
  { icon: MessageSquare, title: "WhatsApp · Email · SMS", benefit: "Reach clients where they are — AiSensy WA, Resend email, DLT SMS — all consent + opt-out aware.", bg: "bg-brand-cyan-light", fg: "text-brand-cyan-deep" },
  { icon: BarChart3, title: "Reports & MIS", benefit: "40+ canned reports — every number a partner meeting or SEBI inspection could ask, one click away.", bg: "bg-amber-50", fg: "text-amber-600" },
  { icon: Users, title: "Family & goal mapping", benefit: "Plan at the household level, map the next generation, and never lose a family to succession.", bg: "bg-violet-50", fg: "text-brand-violet" },
  { icon: Lock, title: "Bank-grade security", benefit: "TOTP 2FA, row-level tenant isolation and a full audit trail. Your client data is locked down.", bg: "bg-slate-100", fg: "text-slate-600" },
  { icon: ScrollText, title: "Regulatory digest", benefit: "AMFI/SEBI circulars in plain English with exactly what you must do — AI-summarised, always current.", bg: "bg-brand-cyan-light", fg: "text-brand-cyan-deep" },
];

const PLANS = [
  {
    name: "Starter", for: "Solo ARN holders finding their feet", price: "₹14,999", unit: "/yr", featured: false, cta: "Start free trial",
    features: ["Up to 1,000 clients", "Compliant WA + email automation", "Live XIRR & SIP tracker", "Core reports & dashboards"],
  },
  {
    name: "Growth", for: "Growing firms with a small team", price: "₹39,999", unit: "/yr", featured: true, cta: "Start free trial",
    features: ["Up to 10,000 clients", "Churn AI + retention plays", "Tax-harvesting & referral engine", "Full 40+ report suite", "Role-based team access"],
  },
  {
    name: "Scale", for: "Multi-branch distribution houses", price: "Let's talk", unit: "", featured: false, cta: "Contact sales",
    features: ["Unlimited clients & branches", "CAMS/KFintech feed onboarding", "Priority support + onboarding", "Custom workflows & SLAs"],
  },
];

/* ───────────────────────── Components ───────────────────────── */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-brand-navy to-brand-cyan bg-clip-text text-transparent">{value}</div>
      <div className="text-xs text-muted-foreground mt-1 font-medium">{label}</div>
    </div>
  );
}

function Spotlight({
  eyebrow, title, body, points, icon: Icon, accent, reverse,
}: {
  eyebrow: string; title: string; body: string; points: string[];
  icon: any; accent: string; reverse?: boolean;
}) {
  return (
    <div className={`grid lg:grid-cols-2 gap-10 items-center ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
      <div>
        <span className="chip bg-secondary text-muted-foreground">{eyebrow}</span>
        <h3 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">{title}</h3>
        <p className="mt-4 text-muted-foreground leading-relaxed">{body}</p>
        <ul className="mt-5 space-y-2.5">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2.5 text-sm font-medium">
              <Check className="size-4 text-emerald-600 mt-0.5 shrink-0" /> {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={`rounded-2xl border border-border/60 bg-gradient-to-br ${accent} p-10 grid place-items-center min-h-[15rem]`}>
        <Icon className="size-24 text-foreground/80" strokeWidth={1.2} />
      </div>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-foreground/70 mb-3">{title}</div>
      <ul className="space-y-2">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
