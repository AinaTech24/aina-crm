"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle, Plug, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Status = {
  serverConfigured: boolean;
  connected: boolean;
  dataCenter: string | null;
  grantedBy: string | null;
  counts: { synced: number; error: number; pending: number };
};

export function ZohoIntegrationCard() {
  const toast = useToast();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/integrations/zoho/status");
      if (r.ok) setStatus(await r.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const z = params.get("zoho");
    if (z === "connected") toast.success("Your records will start syncing to Zoho CRM.", "Zoho connected");
    else if (z === "error") toast.error("Couldn't connect to Zoho. Please try again.", "Connection failed");
  }, [params, toast]);

  async function disconnect() {
    if (!confirm("Disconnect Zoho? Syncing stops — your existing Zoho records are kept.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/integrations/zoho/disconnect", { method: "POST" });
      if (r.ok) {
        toast.success("Zoho disconnected.", "Done");
        void load();
      } else toast.error("Couldn't disconnect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-brand-cyan-light grid place-items-center">
            <Plug className="size-5 text-brand-cyan-deep" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Zoho CRM</h3>
            <p className="text-xs text-muted-foreground">One-way sync — new & updated records push to your Zoho CRM.</p>
          </div>
        </div>
        {loading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : status?.connected ? (
          <span className="chip text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
            <CheckCircle2 className="size-3" /> Connected
          </span>
        ) : (
          <span className="chip text-[11px] bg-secondary text-muted-foreground border border-border">Not connected</span>
        )}
      </div>

      {!loading && !status?.serverConfigured && (
        <div className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 inline-flex items-start gap-2">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          Zoho isn&rsquo;t set up on the server yet. Your administrator needs to add the Zoho app credentials
          (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET) before this can be connected.
        </div>
      )}

      {!loading && status?.connected && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Synced" value={status.counts.synced} tone="emerald" />
          <Stat label="Failed" value={status.counts.error} tone={status.counts.error ? "rose" : "slate"} />
          <Stat label="Pending" value={status.counts.pending} tone="slate" />
        </div>
      )}

      <div className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
        <strong>Before connecting:</strong> in your Zoho CRM, add a single-line custom field named{" "}
        <code className="px-1 rounded bg-secondary">Aina_Record_ID</code> to the Contacts and Leads modules — that&rsquo;s
        what keeps the sync from creating duplicates. (More modules — Tasks, Insurance, SIPs… — are added in upcoming releases.)
      </div>

      <div className="flex items-center gap-2">
        {status?.connected ? (
          <>
            <button onClick={disconnect} disabled={busy} className="btn-secondary text-xs disabled:opacity-60">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Disconnect
            </button>
            <button onClick={() => load()} className="btn-ghost text-xs" title="Refresh status">
              <RefreshCw className="size-3.5" /> Refresh
            </button>
            {status.dataCenter && <span className="text-[11px] text-muted-foreground ml-auto">DC: {status.dataCenter.toUpperCase()}</span>}
          </>
        ) : (
          <a
            href="/api/integrations/zoho/connect"
            className={`btn-primary text-xs ${!status?.serverConfigured ? "pointer-events-none opacity-50" : ""}`}
          >
            <Plug className="size-3.5" /> Connect Zoho CRM
          </a>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "emerald" | "rose" | "slate" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card py-2">
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
