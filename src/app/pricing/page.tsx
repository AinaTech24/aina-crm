import type { Metadata } from "next";
import { SitePage } from "@/components/landing/SitePage";
import { PricingFlow } from "@/components/pricing/PricingFlow";
import { DEFAULT_PRICING, inr } from "@/lib/billing/aum-pricing";
import { loadPricingSettings } from "@/lib/billing/pricing-settings";

export const metadata: Metadata = {
  title: { absolute: "Pricing — AINA CRM for Mutual Fund Distributors" },
  description:
    "Get your AINA CRM price in a minute: maintenance by your AUM plus a yearly fee per user. Start with a 6-month commitment or a year (save 15%); monthly and half-yearly billing follow.",
  alternates: { canonical: "/pricing" },
};

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const s = await loadPricingSettings().catch(() => DEFAULT_PRICING);
  const perUserYearly = inr(s.perUserYearlyPaise);
  const months = s.cycles.commitment.months;
  const pct = (bp: number) => `${(bp / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
  return (
    <SitePage crumbs={[["Home", "/"], ["Pricing", "/pricing"]]}>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8">
        <div className="max-w-3xl">
          <span className="text-xs font-bold uppercase tracking-widest text-site-crimson">Pricing</span>
          <h1 className="mt-3 font-brand text-4xl sm:text-5xl leading-tight text-site-ink text-balance">
            One price, set by your AUM and your team.
          </h1>
          <p className="mt-4 text-site-muted leading-relaxed">
            Monthly maintenance by your firm&apos;s AUM —{" "}
            {s.tiers.map((t, i) => (
              <span key={t.key}>
                {i > 0 && (i === s.tiers.length - 1 ? " and " : ", ")}
                {t.label.toLowerCase()} {inr(t.monthlyPaise)}
              </span>
            ))}{" "}
            a month — plus {perUserYearly} per CRM user a year. GST extra.
          </p>
          <p className="mt-3 text-site-muted leading-relaxed">
            {s.firstPurchaseCommitment ? (
              <>
                You start with a {months}-month commitment at the monthly price, paid upfront, or a full year
                {s.cycles.yearly.discountBp > 0 ? ` and save ${pct(s.cycles.yearly.discountBp)}` : ""}. After the first {months} months, choose
                how you continue: monthly, half-yearly
                {s.cycles.half_yearly.discountBp > 0 ? ` (save ${pct(s.cycles.half_yearly.discountBp)})` : ""} or yearly — or simply carry on monthly.
              </>
            ) : (
              <>Pay monthly, half-yearly or yearly; the longer the cycle, the more you save.</>
            )}
          </p>
        </div>
        <PricingFlow />
      </section>
    </SitePage>
  );
}
