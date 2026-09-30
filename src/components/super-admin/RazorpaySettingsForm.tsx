"use client";

import { useId, useState } from "react";
import { KeyRound, Loader2, CheckCircle2, XCircle, Save, Plug, CreditCard } from "lucide-react";

type Status = {
  keyId: string | null;
  mode: "live" | "test" | null;
  secretConfigured: boolean;
  secretLast4: string | null;
  webhookConfigured: boolean;
  source: "db" | "env" | "none";
};

export function RazorpaySettingsForm({ initial }: { initial: Status }) {
  const uid = useId();
  const [keyId, setKeyId] = useState(initial.keyId ?? "");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [status, setStatus] = useState<Status>(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const busy = saving || testing;

  async function save() {
    if (!keyId.trim()) {
      setMsg({ kind: "err", text: "Enter your Razorpay Key ID." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/razorpay-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyId: keyId.trim(),
          keySecret: keySecret || undefined,
          webhookSecret: webhookSecret || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error || "Save failed." });
      } else {
        setStatus(data.status);
        setKeySecret("");
        setWebhookSecret("");
        setMsg({ kind: "ok", text: "Saved — billing uses these keys within ~30 seconds. No redeploy needed." });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error." });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/razorpay-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: keyId.trim() || undefined, keySecret: keySecret || undefined }),
      });
      const data = await res.json();
      if (data.ok) setMsg({ kind: "ok", text: `Connection OK${data.mode ? ` — ${data.mode} mode` : ""}.` });
      else setMsg({ kind: "err", text: data.error || "Connection failed." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5 space-y-5 max-w-2xl">
      <div className="flex items-center gap-2">
        <CreditCard className="size-5 text-muted-foreground" />
        <div>
          <h2 className="font-semibold">Razorpay account</h2>
          <p className="text-xs text-muted-foreground">
            The account you collect MFD subscription payments through. Secret + webhook secret are encrypted at rest.
          </p>
        </div>
      </div>

      {/* Current status */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-1 rounded-full bg-muted">
          Key ID: <strong>{status.keyId ? status.keyId : "—"}</strong>
        </span>
        {status.mode && (
          <span className={`px-2 py-1 rounded-full ${status.mode === "live" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {status.mode === "live" ? "LIVE" : "TEST"} mode
          </span>
        )}
        <span className={`px-2 py-1 rounded-full ${status.secretConfigured ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {status.secretConfigured ? `Secret set ••••${status.secretLast4 ?? ""}` : "No secret"}
        </span>
        <span className={`px-2 py-1 rounded-full ${status.webhookConfigured ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
          {status.webhookConfigured ? "Webhook secret set" : "No webhook secret"}
        </span>
        <span className="px-2 py-1 rounded-full bg-muted">
          Source: {status.source === "db" ? "Aina Admin" : status.source === "env" ? "env var" : "none"}
        </span>
      </div>

      {/* Key ID */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <KeyRound className="size-3.5" /> Key ID
        </label>
        <input
          value={keyId}
          onChange={(e) => setKeyId(e.target.value)}
          autoComplete="off"
          placeholder="rzp_live_… or rzp_test_…"
          className="w-full rounded-md border px-3 py-2 text-sm font-mono"
        />
        <p className="text-2xs text-muted-foreground">Public key — also handed to Checkout in the browser. Safe to display.</p>
      </div>

      {/* Key Secret */}
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-key-secret`} className="text-sm font-medium">Key Secret</label>
        <input id={`${uid}-key-secret`}
          type="password"
          autoComplete="off"
          value={keySecret}
          onChange={(e) => setKeySecret(e.target.value)}
          placeholder={status.secretConfigured ? `•••• saved (leave blank to keep ••••${status.secretLast4 ?? ""})` : "Your Razorpay key secret"}
          className="w-full rounded-md border px-3 py-2 text-sm font-mono"
        />
        <p className="text-2xs text-muted-foreground">Stored encrypted (AES-256-GCM) — never shown again after saving.</p>
      </div>

      {/* Webhook Secret */}
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-webhook-secret`} className="text-sm font-medium">Webhook Secret</label>
        <input id={`${uid}-webhook-secret`}
          type="password"
          autoComplete="off"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder={status.webhookConfigured ? "•••• saved (leave blank to keep)" : "Secret you set on the Razorpay webhook"}
          className="w-full rounded-md border px-3 py-2 text-sm font-mono"
        />
        <p className="text-2xs text-muted-foreground">
          Must match the secret on your Razorpay webhook for <code className="bg-background px-1 rounded">/api/webhooks/razorpay</code>.
        </p>
      </div>

      {/* Message */}
      {msg && (
        <div className={`flex items-start gap-2 text-sm rounded-md px-3 py-2 ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {msg.kind === "ok" ? <CheckCircle2 className="size-4 mt-0.5" /> : <XCircle className="size-4 mt-0.5" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || !keyId.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save changes
        </button>
        <button
          type="button"
          onClick={test}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          Test connection
        </button>
      </div>
    </div>
  );
}
