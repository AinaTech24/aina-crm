import { sql } from "drizzle-orm";
import { Lock, Shield, AlertTriangle } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

const SYSTEMS = [
  { key: "crm", label: "CRM (this platform)" },
  { key: "email", label: "Email (Workspace / 365)" },
  { key: "drive", label: "Google Drive / OneDrive" },
  { key: "rta_cams", label: "CAMS Distributor Portal" },
  { key: "rta_kfintech", label: "KFintech Distributor Portal" },
  { key: "bse_star", label: "BSE Star MF" },
  { key: "nse_nmf", label: "NSE NMF II" },
  { key: "website_admin", label: "Website Admin" },
  { key: "social_meta", label: "Meta Business Suite" },
  { key: "social_linkedin", label: "LinkedIn" },
  { key: "social_youtube", label: "YouTube Studio" },
  { key: "ai_sensy", label: "AiSensy (WhatsApp)" },
];

export const dynamic = "force-dynamic";

export default async function CybersecurityPage() {
  const session = await requireSession();

  // Pull team data — 2FA, last login, status — to assess
  const team = await withTenant(session.tenantId, async (tx) => {
    return tx.execute(sql`
      SELECT id, name, email, roles, two_fa_enabled, last_login_at, status
      FROM users
      WHERE status IN ('active', 'invited')
      ORDER BY name ASC
    `);
  });

  const total = team.rows.length;
  const with2fa = team.rows.filter((u: any) => u.two_fa_enabled).length;

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cybersecurity & access</h1>
        <p className="text-muted-foreground text-sm">
          DPDP-grade access controls. Quarterly review checklist + exit access removal.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Active users" value={total} />
        <Stat label="2FA enabled" value={with2fa} tone={with2fa < total ? "amber" : "emerald"} />
        <Stat label="2FA pending" value={total - with2fa} tone={total - with2fa > 0 ? "rose" : "muted"} />
        <Stat label="IP allow-list" value="off" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <Shield className="size-4" /> Team security status
          </h2>
          <table className="w-full text-sm mt-3">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 font-medium">User</th>
                <th className="text-left py-2 font-medium">2FA</th>
                <th className="text-right py-2 font-medium">Last login</th>
              </tr>
            </thead>
            <tbody>
              {(team.rows as any[]).map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-2">
                    <div className="text-sm">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="py-2">
                    {u.two_fa_enabled ? (
                      <span className="text-xs text-emerald-600">✓ enabled</span>
                    ) : (
                      <span className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertTriangle className="size-3" /> off
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right text-xs text-muted-foreground">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString("en-IN") : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <Lock className="size-4" /> System access tracker
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Per-user access matrix across firm systems. Sync quarterly + revoke on exit.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {SYSTEMS.map((s) => (
              <li key={s.key} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <span>{s.label}</span>
                <span className="text-xs text-muted-foreground">— config TBD</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border rounded-lg bg-card p-5">
        <h2 className="font-semibold">Quarterly review checklist</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {[
            "Verify 2FA enabled for all owner / compliance / bulk-export role holders",
            "Review system access list — revoke any access for departed staff",
            "Confirm password rotation policy (90 days for sensitive roles)",
            "Audit log review — spot-check PII access events",
            "Confirm encrypted backup of CRM + documents (S3 lifecycle)",
            "Antivirus / device security check (manual)",
            "Phishing simulation drill (recommended quarterly)",
            "Confirm IP allow-list configured for office network if applicable",
          ].map((line, i) => (
            <li key={i} className="flex items-start gap-2">
              <input type="checkbox" className="size-3.5 mt-0.5 rounded" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "rose" | "amber" | "emerald" | "muted" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
