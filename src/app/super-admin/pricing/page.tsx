import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { loadPricingForAdmin } from "@/lib/billing/pricing-settings";
import { PricingSettingsForm } from "@/components/super-admin/PricingSettingsForm";

export const dynamic = "force-dynamic";

export default async function PlatformPricingPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");
  const { settings, override } = await loadPricingForAdmin();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="page-title">Pricing &amp; billing</h1>
        <p className="text-muted-foreground text-sm">
          What a firm pays: maintenance by its AUM, plus a yearly fee per CRM user, billed monthly, half-yearly or
          yearly with GST on top. The server recomputes every price from these numbers — a price sent by a browser is
          never used. See also <Link className="text-primary underline" href="/super-admin/pricing/quotes">pricing quotes</Link>,{" "}
          <Link className="text-primary underline" href="/super-admin/invoices">tax invoices</Link> and{" "}
          <Link className="text-primary underline" href="/super-admin/legal">legal documents</Link>.
        </p>
      </div>
      <PricingSettingsForm settings={settings} overridden={Object.keys(override).length > 0} />
    </div>
  );
}
