import Link from "next/link";
import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import {
  ArrowRight, ArrowDown, Phone, BellOff, FolderOpen, UserCog, Hand, EyeOff, Target, Users, Repeat,
  CalendarDays, ListChecks, BarChart3, X, Check, type LucideIcon,
} from "lucide-react";
import { MobileNav } from "@/components/landing/MobileNav";
import { RoleDashboards } from "@/components/landing/RoleDashboards";
import { LivePractice } from "@/components/landing/LivePractice";
import { COMMUNITY_URL, DEMO_URL } from "@/lib/landing/links";

/** The site's display face — a warm serif against the logo's crimson and teal. */
const brandFont = Fraunces({ subsets: ["latin"], variable: "--font-brand", style: ["normal", "italic"], display: "swap" });

/* SEO — written around what Indian MFDs actually type into Google. */
export const metadata: Metadata = {
  title: "AINA CRM — CRM Software Built for Mutual Fund Distributors",
  description:
    "Stop managing leads, client follow-ups, SIPs, meetings and team activities across spreadsheets, WhatsApp and multiple files. AINA CRM is designed around the everyday workflows of Mutual Fund Distributors.",
  keywords: [
    "CRM for Mutual Fund Distributors",
    "MFD CRM software",
    "Mutual Fund Distributor CRM",
    "CRM for MFD",
    "lead management for MFD",
    "SIP tracking software",
    "client review management",
    "task management for MFD teams",
    "mutual fund distributor software",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "AINA CRM — Built for Mutual Fund Distributors",
    description: "Your MFD business is growing. Are your systems keeping up? One CRM for leads, clients, SIPs, meetings, tasks and business tracking.",
    siteName: "AINA CRM",
  },
  twitter: {
    card: "summary_large_image",
    title: "AINA CRM — Built for Mutual Fund Distributors",
    description: "Your MFD business is growing. Are your systems keeping up? One CRM for leads, clients, SIPs, meetings, tasks and business tracking.",
  },
};

/** Structured data for Google rich results (Software + Organization). */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "AINA CRM",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: "CRM software designed around the everyday workflows of Mutual Fund Distributors.",
      featureList: SOLUTIONS_LIST(),
    },
    {
      "@type": "Organization",
      name: "Aina Tech Services LLP",
      description: "Developer of AINA CRM — CRM software for Mutual Fund Distributors in India.",
      brand: "AINA CRM",
    },
  ],
};

export default function Home() {
  return (
    <main className={`${brandFont.variable} min-h-screen flex flex-col bg-site-cream text-site-text relative overflow-x-clip`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* ───────────────────────── Nav ───────────────────────── */}
      <header className="sticky top-0 z-50 bg-site-cream/85 backdrop-blur-xl border-b border-site-sand/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <Link href="/" className="inline-flex items-center hover:opacity-90 transition-opacity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aina-logo.png" alt="AINA CRM — CRM software for mutual fund distributors" className="h-9 w-auto object-contain shrink-0" />
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
              Book a Demo <ArrowRight className="size-4" />
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
            <span className="inline-flex items-center gap-2 rounded-full bg-site-paper px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-site-text ring-1 ring-site-sand">
              <span className="size-1.5 rounded-full bg-site-crimson" /> CRM software for Mutual Fund Distributors
            </span>
            <h1 className="mt-7 font-brand text-5xl sm:text-6xl leading-none tracking-tight text-site-ink text-balance">
              Your MFD business is growing.{" "}
              <em className="text-site-crimson">Are your systems keeping up?</em>
            </h1>
            <p className="mt-7 max-w-xl text-lg text-site-muted leading-relaxed">
              Stop managing leads, client follow-ups, SIPs, meetings, and team activities across spreadsheets, WhatsApp, and multiple files.
            </p>
            <p className="mt-4 max-w-xl text-lg text-site-text leading-relaxed">
              Bring your MFD business together with <span className="font-bold">AINA CRM</span> — a CRM designed around the everyday
              workflows of Mutual Fund Distributors.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3">
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full bg-site-crimson px-8 py-4 text-base font-bold text-white shadow-lg shadow-site-crimson/25 hover:bg-site-crimson-deep transition">
                Book a Demo <ArrowRight className="size-5" />
              </a>
              <a href="#features" className="inline-flex items-center justify-center gap-2 rounded-full bg-site-paper px-7 py-4 text-base font-bold text-site-ink ring-1 ring-site-sand hover:bg-site-sand/50 transition">
                Explore Features <ArrowDown className="size-5" />
              </a>
            </div>
          </div>
          <div className="lg:col-span-5 flex justify-center lg:justify-end">
            <LivePractice />
          </div>
        </div>
      </section>

      {/* ───────────────────── 2 · The problem ─────────────────────
          Five problems as notes scattered on a desk — straightened on hover. */}
      <section id="problem" className="py-24 lg:py-32 scroll-mt-16 bg-site-paper border-y border-site-sand">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <Heading
            kicker="The problem"
            title={<>Your business has grown. <em className="text-site-crimson">But have your processes?</em></>}
            lead="More clients. More transactions. More follow-ups. More responsibilities. Yet many MFD businesses still struggle with:"
          />
          <ul className="mt-14 grid sm:grid-cols-2 lg:grid-cols-5 gap-4 lg:gap-3">
            {PROBLEMS.map((p, i) => (
              <li
                key={p.title}
                className={`rounded-3xl bg-site-cream p-6 ring-1 ring-site-sand shadow-sm transition duration-300 hover:rotate-0 hover:-translate-y-1 hover:shadow-lg ${TILT[i % TILT.length]}`}
              >
                <span className="size-11 rounded-2xl bg-site-crimson/10 text-site-crimson grid place-items-center">
                  <p.icon className="size-5" />
                </span>
                <h3 className="mt-5 font-brand text-xl text-site-ink">{p.title}</h3>
                <p className="mt-2 text-sm text-site-muted leading-relaxed">{p.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-16 text-center font-brand text-2xl sm:text-3xl text-site-ink text-balance max-w-3xl mx-auto">
            Your team is working hard. <em className="text-site-crimson">Your systems should make their work easier.</em>
          </p>
        </div>
      </section>

      {/* ───────────────────── 3 · The solution ───────────────────── */}
      <section id="features" className="relative bg-site-ink text-white py-24 lg:py-32 scroll-mt-16 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-site-ink-3 blur-3xl" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <Heading
            dark
            kicker="The solution"
            title={<>One CRM. <em className="text-site-rose">More clarity.</em> Better control.</>}
            lead="Everything your MFD team needs to stay organised."
          />
          <ol className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SOLUTIONS.map((s, i) => (
              <li key={s.title} className="group rounded-3xl bg-white/5 p-6 sm:p-7 ring-1 ring-white/10 hover:bg-white/10 transition">
                <div className="flex items-start justify-between">
                  <span className="font-brand text-5xl text-site-rose/90 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="size-11 rounded-2xl bg-white/10 grid place-items-center group-hover:bg-site-crimson transition-colors">
                    <s.icon className="size-5" />
                  </span>
                </div>
                <h3 className="mt-6 font-brand text-2xl">{s.title}</h3>
                <p className="mt-3 text-sm sm:text-base text-white/65 leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ───────────────────── 4 · Benefits ───────────────────── */}
      <section id="benefits" className="relative bg-site-ink-2 text-white py-24 lg:py-32 scroll-mt-16 overflow-hidden">
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <Heading dark kicker="Benefits" title={<>Less manual tracking. <em className="text-site-rose">More meaningful work.</em></>} />
          <RoleDashboards />
          <p className="mt-16 text-center font-brand text-2xl sm:text-3xl text-white/90 text-balance">
            One connected system for a more organised MFD business.
          </p>
        </div>
      </section>

      {/* ───────────────────── 5 · Why AINA ───────────────────── */}
      <section id="why" className="py-24 lg:py-32 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <Heading left kicker="Why AINA CRM?" title={<>Not just another CRM. <em className="text-site-crimson">Built around the MFD business.</em></>} />
            <p className="mt-6 text-lg text-site-muted leading-relaxed">
              Generic CRM software is often designed around ordinary sales pipelines.
            </p>
            <p className="mt-4 text-lg text-site-text leading-relaxed">
              AINA CRM is designed for the workflows that matter to Mutual Fund Distributors — from lead conversion and client servicing
              to SIP tracking, reviews, and team accountability.
            </p>
            <p className="mt-6 border-l-4 border-site-crimson pl-4 font-brand text-xl sm:text-2xl text-site-ink">
              Because managing an MFD business requires more than maintaining a contact database.
            </p>
          </div>

          {/* Generic pipeline vs the MFD workflow. */}
          <div className="flex flex-col gap-4">
            <div className="rounded-3xl bg-site-paper p-6 ring-1 ring-site-sand">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-site-muted">
                <X className="size-4 text-site-crimson" /> A generic CRM
              </div>
              <Flow steps={["Contact", "Deal", "Closed"]} muted />
            </div>
            <div className="rounded-3xl bg-site-ink p-6 text-white shadow-2xl">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-site-rose">
                <Check className="size-4" /> AINA CRM
              </div>
              <Flow steps={["Lead", "Client", "SIPs & transactions", "Reviews", "Servicing", "Team accountability"]} />
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── Final CTA ───────────────────────── */}
      <section id="demo" className="px-4 sm:px-6 pb-6 scroll-mt-16">
        <div className="relative max-w-7xl mx-auto overflow-hidden rounded-3xl bg-site-ink px-6 py-20 sm:py-24 text-center">
          <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 -translate-x-1/2 size-96 rounded-full bg-site-ink-3 blur-3xl" />
          <div className="relative max-w-3xl mx-auto">
            <h2 className="font-brand text-4xl sm:text-5xl leading-tight text-white text-balance">
              Your clients deserve consistent service. <em className="text-site-rose">Your team deserves a better system.</em>
            </h2>
            <p className="mt-6 text-lg text-white/65">
              Discover how AINA CRM can help bring structure, visibility, and accountability to your MFD business.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full bg-site-crimson px-8 py-4 text-base font-bold text-white hover:bg-site-crimson-deep transition">
                Request a CRM Demo <ArrowRight className="size-5" />
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
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aina-logo.png" alt="AINA CRM" className="h-9 w-auto object-contain" />
            <p className="mt-3 font-brand text-lg text-site-ink">AINA CRM — A smarter way to manage your MFD business.</p>
          </div>
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
    </main>
  );
}

/* ───────────────────────── Content ───────────────────────── */

const NAV: [string, string][] = [
  ["The problem", "#problem"],
  ["Features", "#features"],
  ["Benefits", "#benefits"],
  ["Why AINA", "#why"],
  ["KAIZEN", "/knowledge-base"],
];

const PROBLEMS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: BellOff, title: "Missed follow-ups", body: "Leads and client requests get overlooked." },
  { icon: FolderOpen, title: "Scattered client data", body: "Important information is spread across files and systems." },
  { icon: UserCog, title: "Owner dependency", body: "Daily operations still require constant owner involvement." },
  { icon: Hand, title: "Manual work", body: "Repetitive tracking and updates consume valuable time." },
  { icon: EyeOff, title: "Limited visibility", body: "Difficult to know what the team has completed and what remains pending." },
];

/** A slight, alternating tilt — the "scattered notes" look on large screens only. */
const TILT = ["lg:-rotate-2", "lg:rotate-1", "lg:-rotate-1", "lg:rotate-2", "lg:-rotate-1"];

const SOLUTIONS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Target, title: "Lead Management", body: "Capture leads, track every conversation, manage follow-ups, and maintain visibility from enquiry to conversion." },
  { icon: Users, title: "Client Management", body: "Organise client information, investment records, interaction history, and service activities in one place." },
  { icon: Repeat, title: "SIP & Transaction Tracking", body: "Track SIP records, transaction activity, and pending actions with structured business data." },
  { icon: CalendarDays, title: "Client Meeting & Review Management", body: "Manage client meetings, review schedules, discussion notes, and follow-up responsibilities." },
  { icon: ListChecks, title: "Task Management System", body: "Assign tasks, track deadlines, review pending work, and create clear accountability across your team." },
  { icon: BarChart3, title: "Business Tracking System", body: "Monitor key business activities, team performance, and progress through dashboards and reports." },
];

function SOLUTIONS_LIST() {
  return [
    "Lead Management",
    "Client Management",
    "SIP & Transaction Tracking",
    "Client Meeting & Review Management",
    "Task Management System",
    "Business Tracking System",
  ];
}

const FOOTER: [string, string][] = [
  ["Book a Demo", DEMO_URL],
  ["Community", COMMUNITY_URL],
  ["KAIZEN", "/knowledge-base"],
  ["Log in", "/login"],
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Refunds", "/refund"],
];

/* ───────────────────────── Helper components ───────────────────────── */

function Heading({ kicker, title, lead, dark, left }: { kicker: string; title: React.ReactNode; lead?: string; dark?: boolean; left?: boolean }) {
  return (
    <div className={left ? "" : "text-center max-w-3xl mx-auto"}>
      <span className={`text-xs font-bold uppercase tracking-widest ${dark ? "text-site-rose" : "text-site-crimson"}`}>{kicker}</span>
      <h2 className={`mt-4 font-brand text-4xl sm:text-5xl leading-tight tracking-tight text-balance ${dark ? "text-white" : "text-site-ink"}`}>
        {title}
      </h2>
      {lead && <p className={`mt-5 text-lg leading-relaxed text-balance ${dark ? "text-white/65" : "text-site-muted"}`}>{lead}</p>}
    </div>
  );
}

function Flow({ steps, muted }: { steps: string[]; muted?: boolean }) {
  return (
    <ol className="mt-4 flex flex-wrap items-center gap-2">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${
              muted ? "bg-site-cream text-site-muted ring-1 ring-site-sand" : "bg-white/10 text-white ring-1 ring-white/15"
            }`}
          >
            {s}
          </span>
          {i < steps.length - 1 && <ArrowRight className={`size-4 ${muted ? "text-site-sand" : "text-site-rose"}`} />}
        </li>
      ))}
    </ol>
  );
}
