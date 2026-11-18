import type { Metadata } from "next";
import { SitePage } from "@/components/landing/SitePage";
import { PricingFlow } from "@/components/pricing/PricingFlow";

export const metadata: Metadata = {
  title: { absolute: "Pricing — AINA CRM for Mutual Fund Distributors" },
  description:
    "Get your AINA CRM price in a minute: maintenance by your AUM plus a yearly fee per user. Start with a 6-month commitment or a year (save 15%); monthly and half-yearly billing follow.",
  alternates: { canonical: "/pricing" },
};

export const dynamic = "force-dynamic";

export default function PricingPage() {
  return (
    <SitePage crumbs={[["Home", "/"], ["Pricing", "/pricing"]]}>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8">
        <div className="max-w-3xl">
          <span className="text-xs font-bold uppercase tracking-widest text-site-crimson">Pricing</span>
          <h1 className="mt-3 font-brand text-4xl sm:text-5xl leading-tight text-site-ink text-balance">
            One price, set by your AUM and your team.
          </h1>
        </div>
        <PricingFlow />
      </section>
    </SitePage>
  );
}
