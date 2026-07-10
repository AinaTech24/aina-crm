"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  Copy,
  Check,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PasswordInput } from "@/components/ui/PasswordInput";

type Recent = {
  id: string;
  source: string;
  kind: string;
  fileName: string;
  status: string;
  rowsImported: number | null;
  parsedAt: string | null;
  remarks: string | null;
  createdAt: string;
};

type Status = {
  address: string;
  inboundDomain: string;
  inboxReady: boolean;
  hasCamsPassword: boolean;
  hasKfintechPassword: boolean;
  verifiedAt: string | null;
  lastReceivedAt: string | null;
  forwardingConfirmCode: string | null;
  forwardingConfirmUrl: string | null;
  forwardingConfirmAt: string | null;
  recent: Recent[];
};

/** Settings card: direct RTA mailback auto-import via email forwarding. */
export function RtaMailbackCard() {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [cams, setCams] = useState("");
  const [kfin, setKfin] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  async function load(opts?: { quiet?: boolean }) {
    if (!opts?.quiet) setLoading(true);
    try {
      const r = await fetch("/api/integrations/rta-mailback", { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch {
      /* ignore */
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // Live refresh — pick up "Receiving mail" + new auto-imports without a manual
    // reload (the poller ingests forwarded mail every ~2 min in the background).
    const id = setInterval(() => void load({ quiet: true }), 15_000);
    return () => clearInterval(id);
  }, []);

  async function copyAddress() {
    if (!status?.address) return;
    try {
      await navigator.clipboard.writeText(status.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy the address manually.");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!cams && !kfin) {
      toast.error("Enter at least one password to save.");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      if (cams) body.camsPassword = cams;
      if (kfin) body.kfintechPassword = kfin;
      const r = await fetch("/api/integrations/rta-mailback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error(j.error || "Couldn't save.", "RTA mailback");
        return;
      }
      toast.success("Mailback passwords saved.", "Saved");
      setCams("");
      setKfin("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    if (!confirm("Rotate to a new forwarding address? You'll need to update the auto-forward rule in your mailbox.")) return;
    setRotating(true);
    try {
      const r = await fetch("/api/integrations/rta-mailback/regenerate", { method: "POST" });
      if (r.ok) {
        toast.success("New address generated — update your forwarding rule.", "Rotated");
        await load();
      } else toast.error("Couldn't rotate the address.");
    } finally {
      setRotating(false);
    }
  }

  const verifiedChip = loading ? (
    <Loader2 className="size-4 animate-spin text-muted-foreground" />
  ) : status?.verifiedAt ? (
    <span className="chip text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
      <CheckCircle2 className="size-3" /> Receiving mail
    </span>
  ) : (
    <span className="chip text-[11px] bg-amber-50 text-amber-700 border border-amber-200">Awaiting first forward</span>
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-brand-cyan-light grid place-items-center">
            <Mail className="size-5 text-brand-cyan-deep" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">RTA Mailback — Auto-import</h3>
            <p className="text-xs text-muted-foreground">
              Forward your daily CAMS / KFintech mailback email here — we import it automatically.
            </p>
          </div>
        </div>
        {verifiedChip}
      </div>

      {/* Platform inbox not configured yet */}
      {!loading && status && !status.inboxReady && (
        <div className="flex items-start gap-2 text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          <span>The auto-import inbox is still being set up by AINA. You can save your passwords now; forwarding will start working once it&apos;s live.</span>
        </div>
      )}

      {/* Forwarding confirmation code captured from Gmail/Outlook */}
      {!loading && status?.forwardingConfirmCode && (
        <div className="flex items-start gap-2 text-xs rounded-lg border border-blue-200 bg-blue-50 text-blue-800 px-3 py-2">
          <ShieldCheck className="size-3.5 mt-0.5 shrink-0" />
          <span>
            Forwarding confirmation received — code{" "}
            <strong className="tabular-nums">{status.forwardingConfirmCode}</strong>.
            {status.forwardingConfirmUrl && (
              <>
                {" "}
                <a href={status.forwardingConfirmUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  Open confirmation link
                </a>
                .
              </>
            )}{" "}
            Enter the code (or click the link) in your mailbox to activate forwarding.
          </span>
        </div>
      )}

      {/* The unique forward address */}
      {!loading && status && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Your forwarding address</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-secondary/60 border border-border rounded-lg px-3 py-2 font-mono break-all">
              {status.address}
            </code>
            <button onClick={copyAddress} className="btn-secondary text-xs shrink-0" title="Copy address">
              {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              {status.lastReceivedAt
                ? `Last mail received ${new Date(status.lastReceivedAt).toLocaleString("en-IN")}`
                : "No mail received yet."}
            </p>
            <button onClick={regenerate} disabled={rotating} className="btn-ghost text-[11px] disabled:opacity-60">
              {rotating ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Rotate
            </button>
          </div>
        </div>
      )}

      {/* Passwords */}
      {!loading && (
        <form onSubmit={save} className="space-y-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Enter the ZIP password you set with each RTA when subscribing to their mailback. Stored encrypted; we use it to
            open the forwarded files. Leave a field blank to keep the saved one.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                CAMS password
                {status?.hasCamsPassword && <span className="chip text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200">saved</span>}
              </label>
              <PasswordInput
                value={cams}
                onChange={(e) => setCams(e.target.value)}
                placeholder={status?.hasCamsPassword ? "•••••••• (saved)" : "CAMS ZIP password"}
                className="input-base mt-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                KFintech password
                {status?.hasKfintechPassword && <span className="chip text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200">saved</span>}
              </label>
              <PasswordInput
                value={kfin}
                onChange={(e) => setKfin(e.target.value)}
                placeholder={status?.hasKfintechPassword ? "•••••••• (saved)" : "KFintech ZIP password"}
                className="input-base mt-1 text-sm"
              />
            </div>
          </div>
          <button type="submit" disabled={saving} className="btn-primary text-xs disabled:opacity-60">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Save passwords
          </button>
        </form>
      )}

      {/* Setup steps */}
      {!loading && status && (
        <details className="border-t border-border pt-3 group">
          <summary className="text-xs font-medium cursor-pointer select-none text-foreground">How to set this up</summary>
          <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            <li className="flex gap-2">
              <span className="tabular-nums">1.</span>
              <span>Subscribe to the daily mailback with <strong>CAMS</strong> and <strong>KFintech</strong> (set a ZIP password with each) — enter those passwords above.</span>
            </li>
            <li className="flex gap-2">
              <span className="tabular-nums">2.</span>
              <span>In your mailbox (Gmail / Outlook), add an <strong>auto-forward</strong> rule sending the RTA mailback emails to <code className="font-mono">{status.address}</code>.</span>
            </li>
            <li className="flex gap-2">
              <span className="tabular-nums">3.</span>
              <span>Your mailbox will ask to confirm forwarding — we auto-capture the code and show it here. Confirm it once.</span>
            </li>
            <li className="flex gap-2">
              <span className="tabular-nums">4.</span>
              <span>Done. Each day&apos;s file imports automatically — transactions, folios, AUM and brokerage flow straight into your CRM.</span>
            </li>
          </ol>
        </details>
      )}

      {/* Recent auto-imports */}
      {!loading && status && status.recent.length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">Recent auto-imports</div>
          <ul className="space-y-1">
            {status.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate flex-1">
                  <span className="font-mono">{r.source.toUpperCase()}</span> · {r.kind.replace(/_/g, " ")} · <span className="text-muted-foreground">{r.fileName}</span>
                </span>
                <span
                  className={`chip text-[10px] shrink-0 ${
                    r.status === "completed"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : r.status === "partial"
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : r.status === "failed" || r.status === "rejected"
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : "bg-secondary text-muted-foreground border border-border"
                  }`}
                >
                  {r.status}
                  {r.rowsImported != null ? ` · ${r.rowsImported}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
