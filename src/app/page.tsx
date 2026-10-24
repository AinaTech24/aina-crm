import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, ArrowDown, Phone, Clock, BellOff, FolderOpen, UserCog, Hand, EyeOff, Target, Users, Repeat,
  CalendarDays, ListChecks, BarChart3, X, Check, type LucideIcon,
} from "lucide-react";
import { RoleDashboards } from "@/components/landing/RoleDashboards";
import { LivePractice } from "@/components/landing/LivePractice";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { ContactList, SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { WhatsAppWidget } from "@/components/landing/WhatsAppWidget";
import { brandFont } from "@/lib/landing/font";
import { DEMO_URL } from "@/lib/landing/links";
import { HOME_FAQS } from "@/lib/landing/faqs";
import { BLOG_POSTS, formatPostDate } from "@/lib/landing/blog";
import { SOLUTION_PAGES } from "@/lib/landing/solutions";
import { faqLd, graph, organizationLd, softwareLd, websiteLd } from "@/lib/landing/jsonld";

/* SEO — the title, H1 and first paragraph carry the phrases MFDs search for:
   "CRM for mutual fund distributors", "MFD CRM software", "mutual fund
   software for distributors". Brand last in the title so the phrase leads. */
export const metadata: Metadata = {
  title: { absolute: "AINA CRM — CRM Software for Mutual Fund Distributors (MFD) in India" },
  description:
    "CRM software built for Mutual Fund Distributors in India. Manage leads, clients, SIPs, client reviews, team tasks and business tracking in one place.",
  keywords: [
    "AINA CRM",
    "CRM for Mutual Fund Distributors",
    "MFD CRM software",
    "Mutual Fund Distributor CRM",
    "mutual fund software for distributors",
    "back office software for mutual fund distributors",
    "SIP tracking software",
    "AMFI DDQ compliance",
    "client review management for MFD",
    "task management for MFD teams",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    locale: "en_IN",
    title: "AINA CRM — CRM Software for Mutual Fund Distributors",
    description: "Your MFD business is growing. Are your systems keeping up? One CRM for leads, clients, SIPs, meetings, tasks and business tracking.",
    siteName: "AINA CRM",
  },
  twitter: {
    card: "summary_large_image",
    title: "AINA CRM — CRM Software for Mutual Fund Distributors",
    description: "Your MFD business is growing. Are your systems keeping up? One CRM for leads, clients, SIPs, meetings, tasks and business tracking.",
  },
};

const JSON_LD = graph(
  organizationLd(),
  websiteLd(),
  softwareLd("CRM software designed around the everyday workflows of Mutual Fund Distributors in India.", SOLUTIONS_LIST()),
  faqLd(HOME_FAQS),
);

export default function Home() {
  return (
    <main className={`${brandFont.variable} min-h-screen flex flex-col bg-site-cream text-site-text relative overflow-x-clip`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      <SiteHeader />

      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 size-96 rounded-full bg-site-crimson/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute top-40 -right-40 size-96 rounded-full bg-site-ink/10 blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-20 lg:pt-20 lg:pb-28 grid lg:grid-cols-12 gap-14 lg:gap-10 items-center">
          <div className="lg:col-span-7">
            {/* The search phrase is part of the H1 (as its first line), styled as the label above the headline. */}
            <h1>
              <span className="inline-flex items-center gap-2 rounded-full bg-site-paper px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-site-text ring-1 ring-site-sand">
                <span className="size-1.5 rounded-full bg-site-crimson" /> CRM software for Mutual Fund Distributors
              </span>
              <span className="mt-7 block font-brand text-5xl sm:text-6xl leading-none tracking-tight text-site-ink text-balance">
                Your MFD business is growing.{" "}
                <em className="text-site-crimson">Are your systems keeping up?</em>
              </span>
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

      {/* ───────────────────── Solutions (internal links) ───────────────────── */}
      <section aria-labelledby="solutions-h" className="pb-24 lg:pb-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 id="solutions-h" className="text-xs font-bold uppercase tracking-widest text-site-crimson">Explore by what you need</h2>
          <ul className="mt-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SOLUTION_PAGES.map((p) => (
              <li key={p.slug}>
                <Link href={`/solutions/${p.slug}`} className="group flex h-full items-start justify-between gap-3 rounded-3xl bg-site-paper p-5 ring-1 ring-site-sand hover:shadow-lg transition">
                  <span className="font-brand text-lg leading-snug text-site-ink">{p.navLabel}</span>
                  <ArrowRight className="size-4 mt-1.5 shrink-0 text-site-crimson group-hover:translate-x-0.5 transition" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ───────────────────── Blog ───────────────────── */}
      <section id="blog" className="bg-site-paper border-y border-site-sand py-24 lg:py-28 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <Heading left kicker="From the blog" title={<>Guides MFDs <em className="text-site-crimson">actually search for.</em></>} />
            <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-bold text-site-crimson hover:underline">
              All articles <ArrowRight className="size-4" />
            </Link>
          </div>
          <ul className="mt-12 grid md:grid-cols-3 gap-5">
            {LATEST_POSTS.map((p) => (
              <li key={p.slug}>
                <Link href={`/blog/${p.slug}`} className="group flex h-full flex-col rounded-3xl bg-site-cream p-6 ring-1 ring-site-sand hover:shadow-lg transition">
                  <span className="text-2xs font-bold uppercase tracking-widest text-site-crimson">{p.category}</span>
                  <h3 className="mt-3 font-brand text-xl leading-snug text-site-ink">{p.title}</h3>
                  <span className="mt-auto pt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-site-muted">
                    <Clock className="size-3.5" /> {p.readMins} min read · {formatPostDate(p.published)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ───────────────────── FAQ ───────────────────── */}
      <section id="faq" className="py-24 lg:py-32 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4">
            <Heading left kicker="FAQ" title="Questions MFDs ask us." />
            <p className="mt-4 text-sm text-site-muted">
              More in the{" "}
              <Link href="/blog" className="font-bold text-site-crimson hover:underline">blog</Link> and the{" "}
              <Link href="/knowledge-base" className="font-bold text-site-crimson hover:underline">KAIZEN knowledge base</Link>.
            </p>
          </div>
          <div className="lg:col-span-8">
            <FaqAccordion items={HOME_FAQS} />
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
          <div id="contact" className="relative mt-14 pt-10 border-t border-white/10 max-w-3xl mx-auto text-left scroll-mt-24">
            <h3 className="text-center text-xs font-bold uppercase tracking-widest text-site-rose">Reach us</h3>
            <ContactList dark className="mt-6 sm:grid sm:grid-cols-2 sm:gap-x-10" />
          </div>
        </div>
      </section>

      <SiteFooter />
      <WhatsAppWidget />
    </main>
  );
}

/* ───────────────────────── Content ───────────────────────── */

const LATEST_POSTS = [...BLOG_POSTS].sort((a, b) => b.published.localeCompare(a.published)).slice(0, 3);

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
