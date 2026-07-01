"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Plug, KeyRound, RefreshCw, Zap } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PasswordInput } from "@/components/ui/PasswordInput";

type Status = {
  hasCredentials: boolean;
  connected: boolean;
  baseUrl: string | null;
  fpTenant: string | null;
  clientIdHint: string | null;
  grantedBy: string | null;
  txCount: number;
  lastSync: { status: string; parsed_at: string | null; rows_imported: number | null; remarks: string | null } | null;
};

/** Settings card for the "Mailback Import" connection (vendor-neutral UI). */
export function FintechPrimitivesCard() {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"view" | "edit">("edit");
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/integrations/fp/status");
      if (r.ok) {
        const s: Status = await r.json();
        setStatus(s);
        setMode(s.hasCredentials ? "view" : "edit");
        if (s.fpTenant) setTenantId(s.fpTenant);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function test() {
    setTesting(true);
    try {
      const r = await fetch("/api/integrations/fp/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant: tenantId, clientId, clientSecret }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) toast.success("Credentials verified successfully.", "Connection OK");
      else toast.error(j.error || "Those credentials were rejected.", "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch("/api/integrations/fp/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant: tenantId, clientId, clientSecret }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error || "Couldn't save the credentials.", "Mailback Import");
        return;
      }
      toast.success("Mailback Import credentials saved.", "Saved");
      setClientSecret("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Mailback Import? Syncing stops; your saved credentials are kept (inactive).")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/integrations/fp/disconnect", { method: "POST" });
      if (r.ok) {
        toast.success("Mailback Import disconnected.", "Done");
        await load();
      } else toast.error("Couldn't disconnect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const r = await fetch("/api/integrations/fp/sync", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) toast.error(j.error || "Couldn't start the sync.", "Mailback Import");
      else toast.success("Pulling your folios & transactions…", "Sync started");
    } finally {
      setSyncing(false);
    }
  }

  const statusChip = loading ? (
    <Loader2 className="size-4 animate-spin text-muted-foreground" />
  ) : status?.connected ? (
    <span className="chip text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
      <CheckCircle2 className="size-3" /> Connected
    </span>
  ) : status?.hasCredentials ? (
    <span className="chip text-[11px] bg-amber-50 text-amber-700 border border-amber-200">Inactive</span>
  ) : (
    <span className="chip text-[11px] bg-secondary text-muted-foreground border border-border">Not connected</span>
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-brand-cyan-light grid place-items-center">
            <Plug className="size-5 text-brand-cyan-deep" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Mailback Import</h3>
            <p className="text-xs text-muted-foreground">
              Pull your folios &amp; transactions (with capital-gains) straight into the CRM.
            </p>
          </div>
        </div>
        {statusChip}
      </div>

      {/* Connected — show summary + controls */}
      {!loading && status?.connected && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Transactions" value={status.txCount} />
            <Stat label="Last sync" text={status.lastSync?.status ?? "—"} />
            <Stat label="Imported" value={status.lastSync?.rows_imported ?? 0} />
          </div>
          {status.lastSync?.remarks && (
            <p className="text-[11px] text-muted-foreground -mt-2">{status.lastSync.remarks}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={syncNow} disabled={syncing} className="btn-primary text-xs disabled:opacity-60">
              {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />} Sync now
            </button>
            <button onClick={disconnect} disabled={busy} className="btn-secondary text-xs disabled:opacity-60">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Disconnect
            </button>
            <button onClick={() => setMode("edit")} className="btn-ghost text-xs">
              <KeyRound className="size-3.5" /> Edit credentials
            </button>
          </div>
        </>
      )}

      {/* Credentials form */}
      {!loading && mode === "edit" && (
        <form onSubmit={save} className="space-y-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Enter the Mailback Import API credentials provided during your onboarding. We authenticate securely and never
            display the secret again.
          </p>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Tenant ID</label>
            <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} required placeholder="your-tenant-id" className="input-base mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Client ID</label>
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} required placeholder="Client ID" className="input-base mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Client Secret</label>
            <PasswordInput value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required placeholder="Client Secret" className="input-base mt-1 text-sm" />
          </div>
          <div className="text-[11px] text-muted-foreground leading-relaxed rounded-lg border border-border bg-secondary/40 px-3 py-2 inline-flex items-start gap-2">
            <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
            Use <strong>Test connection</strong> to verify the credentials before saving.
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={test} disabled={testing || !tenantId || !clientId || !clientSecret} className="btn-secondary text-xs disabled:opacity-60">
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Test connection
            </button>
            <button type="submit" disabled={saving} className="btn-primary text-xs disabled:opacity-60">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Save credentials
            </button>
            {status?.hasCredentials && (
              <button type="button" onClick={() => setMode("view")} className="btn-ghost text-xs">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function Stat({ label, value, text }: { label: string; value?: number; text?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card py-2">
      <div className="text-lg font-bold tabular-nums text-foreground">{text ?? value ?? 0}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
