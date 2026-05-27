import Link from "next/link";
import { ChevronLeft, Webhook, Check, AlertCircle, ExternalLink } from "lucide-react";

const INTEGRATIONS = [
  {
    name: "BSE Star MF",
    desc: "Place SIPs, lumpsum, redemption orders. Requires your BSE member code + user id.",
    envCheck: () => !!process.env.BSE_STAR_MEMBER_CODE,
    setupSteps: ["Get BSE membership (₹50K one-time setup)", "Add credentials in your tenant config", "We orchestrate orders on your behalf"],
  },
  {
    name: "NSE NMF II",
    desc: "Alternative to BSE for transaction execution.",
    envCheck: () => false,
    setupSteps: ["NSE registration required", "Per-tenant credentials"],
  },
  {
    name: "CAMS / KFintech reverse feed",
    desc: "Daily transaction + folio + AUM reconciliation from RTAs.",
    envCheck: () => false,
    setupSteps: ["Sign up for distributor reverse feed with each RTA", "Share SFTP credentials with AINA", "Daily auto-import into your CRM"],
  },
  {
    name: "Razorpay",
    desc: "Subscription billing (your AINA subscription).",
    envCheck: () => !!process.env.RAZORPAY_KEY_ID,
    setupSteps: ["AINA configures this — you don't need to do anything"],
  },
  {
    name: "KYC providers (Karza / Hyperverge / IDfy)",
    desc: "CKYC fetch, eKYC, video KYC, Aadhaar XML, DigiLocker, eSign.",
    envCheck: () => false,
    setupSteps: ["Pick a partner", "AINA wires the integration"],
  },
  {
    name: "Account Aggregator",
    desc: "Pull investor's portfolio across other distributors with consent.",
    envCheck: () => false,
    setupSteps: ["Roadmap — Phase 4"],
  },
];

export const dynamic = "force-dynamic";

export default function IntegrationsPage() {
  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <Webhook className="size-5" /> Integrations
      </h1>
      <p className="text-sm text-muted-foreground">
        Connect external services. Most integrations are configured by AINA on your behalf during onboarding.
      </p>

      <div className="grid grid-cols-1 gap-3">
        {INTEGRATIONS.map((i) => {
          const ok = i.envCheck();
          return (
            <div key={i.name} className="border rounded-lg bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{i.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{i.desc}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${ok ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-600"}`}>
                  {ok ? <><Check className="size-3" /> Connected</> : <><AlertCircle className="size-3" /> Not connected</>}
                </span>
              </div>
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs font-medium text-muted-foreground">Setup</div>
                <ol className="mt-1.5 space-y-1 text-sm">
                  {i.setupSteps.map((s, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-muted-foreground tabular-nums">{idx + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border rounded-lg bg-card p-5 text-sm text-muted-foreground">
        Need a custom integration? <Link href="/dashboard/support" className="text-primary hover:underline">Open a support ticket</Link>.
      </div>
    </div>
  );
}
