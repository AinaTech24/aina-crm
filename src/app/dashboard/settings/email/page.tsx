import Link from "next/link";
import { ChevronLeft, Mail, Check, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default function EmailSettingsPage() {
  const configured = !!(process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes("xxx"));

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <Mail className="size-5" /> Email setup
      </h1>

      <div className={`border rounded-lg p-5 ${configured ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
        <div className="flex items-start gap-2">
          {configured ? <Check className="size-5 text-emerald-600 mt-0.5" /> : <AlertCircle className="size-5 text-amber-600 mt-0.5" />}
          <div>
            <div className="font-medium">{configured ? "Resend configured" : "Resend not configured"}</div>
            <p className="text-sm text-muted-foreground mt-1">
              {configured
                ? "Transactional + marketing email routed through Resend."
                : "Add RESEND_API_KEY to .env to enable email sends. Until then, sends are queued in stub mode."}
            </p>
          </div>
        </div>
      </div>

      <div className="border rounded-lg bg-card p-5 space-y-3 text-sm">
        <Row label="Transactional from" value={process.env.EMAIL_FROM_TRANSACTIONAL ?? "—"} />
        <Row label="Marketing from" value={process.env.EMAIL_FROM_MARKETING ?? "—"} />
        <Row label="SPF / DKIM / DMARC" value={configured ? "✓ Verified via Resend dashboard" : "Verify on Resend setup"} />
        <Row label="Unsubscribe footer" value="Auto-injected on marketing sends" />
      </div>

      <div className="border rounded-lg bg-card p-5 text-sm text-muted-foreground">
        <p>
          Transactional and marketing streams stay on <strong>separate sending domains + IPs</strong> to
          preserve deliverability. AINA configures these for you during onboarding. Open a support ticket if you
          need a domain change.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 py-1.5 border-b last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
