"use client";

/**
 * MSG91 SMS — the firm's own DLT-registered sender (Settings → Integrations).
 * Saves the MSG91 auth key and the 6-character DLT header once; every SMS the
 * firm sends then goes from its own account. /api/settings/integrations/msg91.
 */

import { useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

type Status = { connected: boolean; keyHint?: string; senderId?: string | null };

export function Msg91ConnectCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [senderId, setSenderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/settings/integrations/msg91", { cache: "no-store" });
      if (res.status === 403) return setForbidden(true);
      if (!res.ok) return;
      const s = (await res.json()) as Status;
      setStatus(s);
      setSenderId(s.senderId ?? "");
      setEditing(!s.connected);
    })();
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/integrations/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), senderId: senderId.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setError(j.error ?? "Could not save");
      setStatus(j);
      setApiKey("");
      setEditing(false);
      notify.success("MSG91 connected — SMS now goes from your own sender.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirmDialog({
      title: "Disconnect MSG91?",
      message: "SMS goes back to the platform's shared sender, which may not carry your DLT templates.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/integrations/msg91", { method: "DELETE" });
      if (!res.ok) return notify.error("Could not disconnect");
      setStatus({ connected: false });
      setEditing(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="section-title flex items-center gap-2">
          <MessageSquareText className="size-4 text-muted-foreground" aria-hidden /> MSG91 SMS
        </h3>
        {status && <Badge tone={status.connected ? "success" : "neutral"}>{status.connected ? "Connected" : "Not connected"}</Badge>}
      </div>

      {forbidden ? (
        <p className="mt-3 text-sm text-muted-foreground">Only the firm owner can connect the firm&apos;s SMS sender.</p>
      ) : !status ? null : status.connected && !editing ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Auth key</span> <span className="font-mono">{status.keyHint ?? "••••"}</span>
            <span className="ml-4 text-muted-foreground">Sender ID</span> <span className="font-mono">{status.senderId ?? "—"}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Update</Button>
            <Button variant="ghost" size="sm" onClick={disconnect} disabled={busy}>Disconnect</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            SMS in India goes out under the DLT entity, sender ID and templates your firm registered. Until this is filled in, SMS uses the platform&apos;s shared sender.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="MSG91 auth key" hint="MSG91 → API → Auth key. Stored encrypted; never shown again." required>
              {(id, describedBy) => (
                <input id={id} aria-describedby={describedBy} type="password" autoComplete="off" className="input-base w-full font-mono"
                  value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              )}
            </Field>
            <Field label="Sender ID (DLT header)" hint="The 6-character header approved on your DLT portal." required error={error}>
              {(id, describedBy, invalid) => (
                <input id={id} aria-describedby={describedBy} aria-invalid={invalid} maxLength={6} className="input-base w-full font-mono uppercase"
                  value={senderId} onChange={(e) => setSenderId(e.target.value.toUpperCase())} />
              )}
            </Field>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={save} loading={busy} disabled={busy || !apiKey.trim() || senderId.trim().length !== 6}>Save</Button>
            {status.connected && <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
