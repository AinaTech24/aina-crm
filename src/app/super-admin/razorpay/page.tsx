import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getRazorpayStatusForAdmin } from "@/lib/billing/razorpay-config";
import { RazorpaySettingsForm } from "@/components/super-admin/RazorpaySettingsForm";

export const dynamic = "force-dynamic";

export default async function PlatformRazorpayPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");

  const status = await getRazorpayStatusForAdmin();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="page-title">Razorpay (billing)</h1>
        <p className="text-muted-foreground text-sm">
          The Razorpay account you bill MFD subscriptions through. Saved here (encrypted) it applies platform-wide
          within ~30 seconds — no redeploy. If left blank, the platform falls back to the{" "}
          <code className="bg-background px-1 rounded">RAZORPAY_*</code> environment variables.
        </p>
      </div>

      <RazorpaySettingsForm initial={status} />

      <div className="border rounded-lg bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5 max-w-2xl">
        <p className="font-medium text-foreground">Where to find these</p>
        <p>
          <strong>Key ID &amp; Secret:</strong> Razorpay Dashboard → Settings → API Keys → Generate Key. Use a{" "}
          <code className="bg-background px-1 rounded">rzp_live_…</code> key for real charges (
          <code className="bg-background px-1 rounded">rzp_test_…</code> to trial it safely).
        </p>
        <p>
          <strong>Webhook Secret:</strong> Razorpay Dashboard → Settings → Webhooks → add a webhook pointing at{" "}
          <code className="bg-background px-1 rounded">https://crm.ainatech.in/api/webhooks/razorpay</code>, set a
          secret there, and paste the same secret here. Subscribe to the <em>subscription</em> and <em>payment</em> events.
        </p>
        <p>Hit <strong>Test connection</strong> after saving to confirm the keys authenticate.</p>
      </div>
    </div>
  );
}
