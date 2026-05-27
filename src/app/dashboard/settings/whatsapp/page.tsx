import Link from "next/link";
import { sql } from "drizzle-orm";
import { ChevronLeft, MessageCircle, Check, AlertCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function WhatsAppSettingsPage() {
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const numbers = await tx.execute(sql`SELECT * FROM whatsapp_numbers ORDER BY created_at DESC`);
    const templates = await tx.execute(sql`
      SELECT COUNT(*) FILTER (WHERE meta_status = 'APPROVED')::int AS approved,
             COUNT(*) FILTER (WHERE meta_status = 'PENDING')::int AS pending,
             COUNT(*) FILTER (WHERE meta_status = 'REJECTED')::int AS rejected
      FROM whatsapp_templates
    `);
    return { numbers: numbers.rows as any[], templates: templates.rows[0] as any };
  });

  const configured = !!(process.env.AISENSY_API_KEY && !process.env.AISENSY_API_KEY.includes("xxx"));

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <MessageCircle className="size-5" /> WhatsApp connection
      </h1>

      <div className={`border rounded-lg p-5 ${configured ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
        <div className="flex items-start gap-2">
          {configured ? <Check className="size-5 text-emerald-600 mt-0.5" /> : <AlertCircle className="size-5 text-amber-600 mt-0.5" />}
          <div>
            <div className="font-medium">{configured ? "AiSensy API key configured" : "AiSensy not configured"}</div>
            <p className="text-sm text-muted-foreground mt-1">
              {configured
                ? "WhatsApp messages will route through AiSensy."
                : "Add AISENSY_API_KEY to your .env to start sending. Until then, messages are queued in stub mode."}
            </p>
          </div>
        </div>
      </div>

      <div className="border rounded-lg bg-card p-5">
        <h2 className="font-semibold">Connected numbers</h2>
        {data.numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-3">
            No WhatsApp numbers configured. AINA wires the first number for you during onboarding.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.numbers.map((n: any) => (
              <li key={n.id} className="flex items-center justify-between border rounded p-2 text-sm">
                <span className="font-mono">{n.phone_e164}</span>
                <span className="text-xs text-muted-foreground">{n.display_name ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border rounded-lg bg-card p-5">
        <h2 className="font-semibold">Template approvals (Meta)</h2>
        <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
          <Stat label="Approved" value={data.templates.approved ?? 0} tone="emerald" />
          <Stat label="Pending" value={data.templates.pending ?? 0} tone="amber" />
          <Stat label="Rejected" value={data.templates.rejected ?? 0} tone="rose" />
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Template sync runs every 15 minutes. Templates also go through our internal compliance gate before being submitted to Meta.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" }) {
  const color = { emerald: "text-emerald-600", amber: "text-amber-600", rose: "text-rose-600" }[tone];
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${value > 0 ? color : ""}`}>{value}</div>
    </div>
  );
}
