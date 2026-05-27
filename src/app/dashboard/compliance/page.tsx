import { ShieldCheck, AlertTriangle, FileText, FileCheck } from "lucide-react";

export default function CompliancePage() {
  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compliance & DDQ readiness</h1>
        <p className="text-muted-foreground text-sm">
          The moat. Every send checked, every document tracked, one-click inspection mode.
        </p>
      </div>

      <div className="border rounded-lg p-6 bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-emerald-950/20 dark:to-blue-950/20">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground">DDQ readiness score</div>
            <div className="text-5xl font-bold mt-1">87<span className="text-2xl text-muted-foreground">/100</span></div>
            <div className="text-sm text-muted-foreground mt-2">
              Last computed: 2 hours ago · Generate DDQ pack →
            </div>
          </div>
          <ShieldCheck className="size-16 text-emerald-600/40" />
        </div>
        <div className="grid grid-cols-4 gap-3 mt-6">
          <ScoreCard label="NISM validity" score={92} />
          <ScoreCard label="ARN renewal" score={100} />
          <ScoreCard label="KYD docs" score={85} />
          <ScoreCard label="Complaint register" score={100} />
          <ScoreCard label="Empanelment docs" score={73} />
          <ScoreCard label="SOP sign-off" score={68} />
          <ScoreCard label="Audit trail" score={100} />
          <ScoreCard label="Consent ledger" score={91} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600" /> Expiry watch
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            <ExpiryRow type="ARN" who="Acme Wealth" when="92 days" />
            <ExpiryRow type="NISM" who="Pooja Shah (RM)" when="30 days" urgent />
            <ExpiryRow type="EUIN" who="Suresh Iyer (RM)" when="121 days" />
            <ExpiryRow type="AMC Empanelment" who="HDFC AMC" when="45 days" />
            <ExpiryRow type="CKYC" who="Rajesh Patel" when="28 days" urgent />
          </ul>
        </div>
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <FileText className="size-4" /> Pending approvals
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            <PendingRow type="Marketing template" who="market_volatility_stay_invested" />
            <PendingRow type="Marketing template" who="diwali_2026_greeting" />
            <PendingRow type="SOP version" who="Lead follow-up v3.2" />
            <PendingRow type="Creative" who="Q3 newsletter banner" />
          </ul>
        </div>
      </div>

      <div className="border rounded-lg bg-card p-5">
        <h2 className="font-semibold flex items-center gap-2">
          <FileCheck className="size-4" /> Recent audit trail
        </h2>
        <ul className="mt-3 space-y-1 text-xs font-mono">
          <li className="py-1 border-b">
            <span className="text-muted-foreground">2026-05-22 09:42</span> · workflow · sent WA template sip_rejection_low_balance to Rajesh Patel · score 95
          </li>
          <li className="py-1 border-b">
            <span className="text-muted-foreground">2026-05-22 09:30</span> · workflow · sent email kyc_renew_email to Pooja Shah · score 100
          </li>
          <li className="py-1 border-b">
            <span className="text-muted-foreground">2026-05-22 09:15</span> · user · viewed PAN of Mehta Family (reason: review prep)
          </li>
          <li className="py-1 border-b">
            <span className="text-muted-foreground">2026-05-22 08:30</span> · workflow · broadcast market_volatility to segment Mumbai_HNI (217 sent)
          </li>
        </ul>
      </div>
    </div>
  );
}

function ScoreCard({ label, score }: { label: string; score: number }) {
  const color = score >= 90 ? "bg-emerald-500" : score >= 70 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="bg-background/50 rounded-md p-3 border">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${color}`} style={{ width: `${score}%` }} />
        </div>
        <span className="text-xs font-semibold tabular-nums">{score}</span>
      </div>
    </div>
  );
}

function ExpiryRow({ type, who, when, urgent }: { type: string; who: string; when: string; urgent?: boolean }) {
  return (
    <li className="flex items-center justify-between py-1.5 border-b last:border-0">
      <div>
        <span className="font-medium">{type}</span>{" "}
        <span className="text-muted-foreground">— {who}</span>
      </div>
      <span className={`text-xs ${urgent ? "text-rose-600 font-medium" : "text-muted-foreground"}`}>
        {when}
      </span>
    </li>
  );
}

function PendingRow({ type, who }: { type: string; who: string }) {
  return (
    <li className="flex items-center justify-between py-1.5 border-b last:border-0">
      <div>
        <span className="font-medium">{type}</span>{" "}
        <span className="text-muted-foreground font-mono text-xs">— {who}</span>
      </div>
      <button className="text-xs text-primary hover:underline">Review</button>
    </li>
  );
}
