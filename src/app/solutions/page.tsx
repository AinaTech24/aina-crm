import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { SitePage } from "@/components/landing/SitePage";
import { SOLUTION_PAGES } from "@/lib/landing/solutions";
import { breadcrumbLd, graph, organizationLd } from "@/lib/landing/jsonld";

export const metadata: Metadata = {
  title: { absolute: "Solutions for Mutual Fund Distributors | MFD CRM, Back Office, DDQ & SIP Tracking — AINA CRM" },
  description:
    "AINA CRM solutions for Mutual Fund Distributors in India: CRM for MFDs, mutual fund software for distributors, AMFI DDQ compliance and SIP tracking with rejection follow-up.",
  alternates: { canonical: "/solutions" },
};

export default function SolutionsHub() {
  return (
    <SitePage
      crumbs={[["Home", "/"], ["Solutions", "/solutions"]]}
      jsonLd={graph(organizationLd(), breadcrumbLd([["Home", "/"], ["Solutions", "/solutions"]]))}
    >
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
        <span className="text-xs font-bold uppercase tracking-widest text-site-crimson">Solutions</span>
        <h1 className="mt-4 font-brand text-4xl sm:text-6xl leading-tight text-site-ink text-balance max-w-3xl">
          Software for Mutual Fund Distributors, <em className="text-site-crimson">by the problem you are solving.</em>
        </h1>
        <ul className="mt-14 grid sm:grid-cols-2 gap-5">
          {SOLUTION_PAGES.map((p) => (
            <li key={p.slug}>
              <Link href={`/solutions/${p.slug}`} className="group block h-full rounded-3xl bg-site-paper p-7 ring-1 ring-site-sand hover:shadow-xl transition">
                <span className="text-xs font-bold uppercase tracking-widest text-site-crimson">{p.kicker}</span>
                <h2 className="mt-3 font-brand text-2xl text-site-ink">{p.navLabel}</h2>
                <p className="mt-3 text-sm text-site-muted leading-relaxed">{p.description}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-site-crimson">
                  Read more <ArrowRight className="size-4 group-hover:translate-x-0.5 transition" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </SitePage>
  );
}
