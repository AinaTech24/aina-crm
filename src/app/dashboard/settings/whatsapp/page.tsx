import Link from "next/link";
import { sql } from "drizzle-orm";
import { ChevronLeft, MessageCircle, Check } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { wapiCheckConnection, type WapiPhoneNumber } from "@/lib/comms/adapters/waina";

export const dynamic = "force-dynamic";

const QUALITY_TONE: Record<string, string> = {
  GREEN: "text-emerald-600",
  YELLOW: "text-amber-600",
  RED: "text-rose-600",
  UNKNOWN: "text-muted-foreground",
};

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
    // Resolve the Aina WhatsApp (Wapi) API key for a live status probe.
    const integ = await getTenantIntegration(tx, session.tenantId, "waina").catch(() => null);
    return {
      numbers: numbers.rows as any[],
      templates: templates.rows[0] as any,
      apiKey: integ?.config?.apiKey ?? process.env.WAINA_API_KEY ?? null,
      baseUrl: integ?.config?.webhookUrl ?? process.env.WAINA_BASE_URL ?? null,
    };
  });

  // Best-effort live probe of the Aina WhatsApp workspace (GET /extension/status).
  let live: { ok: boolean; workspaceName?: string; numbers: WapiPhoneNumber[] } | null = null;
  if (data.apiKey) {
    const r = await wapiCheckConnection(data.apiKey, data.baseUrl);
    if (r.ok) live = { ok: true, workspaceName: r.workspaceName, numbers: r.numbers };
  }

  const liveNumbers = live?.numbers ?? [];
  const numbersConnected = liveNumbers.length || data.numbers.length;
  const active = !!live?.ok || numbersConnected > 0;

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <MessageCircle className="size-5" /> WhatsApp connection
      </h1>

      <div className={`border rounded-lg p-5 ${active ? "bg-emerald-50 border-emerald-300" : "bg-card border-border"}`}>
        <div className="flex items-start gap-2">
          {active ? (
            <Check className="size-5 text-emerald-600 mt-0.5" />
          ) : (
            <MessageCircle className="size-5 text-brand-cyan mt-0.5" />
          )}
          <div>
            <div className="font-medium">
              {active ? "Aina WhatsApp is active" : "WhatsApp is delivered through Aina"}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {live?.ok
                ? `Connected to Aina WhatsApp${
                    live.workspaceName ? ` — workspace “${live.workspaceName}”` : ""
                  }. Your messages send through ${numbersConnected || "your"} number${
                    numbersConnected === 1 ? "" : "s"
                  }, no setup needed on your side.`
                : active
                ? `Your messages are delivered through Aina WhatsApp${
                    numbersConnected > 1 ? ` across ${numbersConnected} numbers` : ""
                  }. Nothing to configure on your side.`
                : "Aina manages your WhatsApp Business connection end-to-end. Your number is provisioned and verified during onboarding — there's nothing to set up here."}
            </p>
          </div>
        </div>
      </div>

      <div className="border rounded-lg bg-card p-5">
        <h2 className="font-semibold">Connected numbers</h2>
        {liveNumbers.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {liveNumbers.map((n) => (
              <li key={n.id} className="flex items-center justify-between border rounded p-2 text-sm">
                <span className="font-mono">{n.display_phone_number}</span>
                <span className="text-xs flex items-center gap-2">
                  {n.is_primary && (
                    <span className="rounded-full bg-brand-cyan-light text-brand-cyan-deep px-2 py-0.5 font-semibold">
                      Primary
                    </span>
                  )}
                  {n.quality_rating && (
                    <span className={`font-medium ${QUALITY_TONE[n.quality_rating] ?? "text-muted-foreground"}`}>
                      {n.quality_rating} quality
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : data.numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-3">
            No WhatsApp numbers configured. Aina wires the first number for you during onboarding.
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
