"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Check, Copy, Loader2, Mail, MessageCircle } from "lucide-react";
import { DiscoveryForm } from "./DiscoveryForm";
import type { DiscoveryData } from "@/lib/discovery/calc";

type Recipient = { name: string | null; phone: string | null; email: string | null };

/** wa.me wants the number with its country code and nothing else. */
function waNumber(phone: string | null): string | null {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  return null;
}

/**
 * In-meeting editor wrapper — saves as you type (a couple of seconds after the
 * last edit), warns before leaving with unsaved edits, mints a client share
 * link with WhatsApp / email buttons, and marks the discovery reviewed. The
 * form itself recalculates live.
 */
export function DiscoveryEditor({
  id,
  initialData,
  status,
  subjectType,
  subjectId,
}: {
  id: string;
  initialData: DiscoveryData;
  status: string;
  subjectType?: string;
  subjectId?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [share, setShare] = useState<{ url: string; recipient: Recipient; firmName: string | null } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [formData, setFormData] = useState(initialData);
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const latest = useRef<DiscoveryData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async (data: DiscoveryData, extra?: Record<string, unknown>, opts?: { quiet?: boolean }) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/discovery/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data, ...extra }),
      });
      if (res.ok) {
        if (latest.current === data) setDirty(false);
        setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }));
        if (!opts?.quiet) router.refresh();
        return true;
      }
      const j = await res.json().catch(() => ({}));
      setSaveError(j.error ?? "Could not save — your changes are still on this page.");
      return false;
    } catch {
      setSaveError("No connection — your changes are still on this page.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [id, router]);

  // Autosave two seconds after the last edit.
  const onChange = useCallback((d: DiscoveryData) => {
    latest.current = d;
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(d, undefined, { quiet: true }); }, 2000);
  }, [save]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function makeLink() {
    setSharing(true);
    setShare(null);
    setShareError(null);
    try {
      // The client opens what is saved — save pending edits first.
      if (dirty && latest.current) await save(latest.current, undefined, { quiet: true });
      const res = await fetch(`/api/discovery/${id}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInDays: 14 }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setShare({ url: j.url, recipient: j.recipient ?? { name: null, phone: null, email: null }, firmName: j.firmName ?? null });
        router.refresh();
      } else {
        setShareError(j.error ?? "Could not create the link.");
      }
    } finally {
      setSharing(false);
    }
  }

  async function saveRisk() {
    setNotice(null);
    if (latest.current && dirty) {
      const ok = await save(latest.current, undefined, { quiet: true });
      if (!ok) return;
    }
    const res = await fetch(`/api/discovery/${id}/risk`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(j.error ?? "Could not save the risk profile.");
      return;
    }
    // Reload so section 10 shows the profile now on record.
    const fresh = await fetch(`/api/discovery/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (fresh?.discovery?.data) {
      setFormData(fresh.discovery.data);
      latest.current = null;
      setDirty(false);
      setFormKey((k) => k + 1);
    }
    setNotice(`Saved ${j.bandLabel ?? "the risk profile"} as a provisional risk profile. The client confirms it from Risk Profiles.`);
    router.refresh();
  }

  const greeting = share?.recipient.name ? `Hi ${share.recipient.name.split(" ")[0]}, ` : "Hi, ";
  const message = share
    ? `${greeting}please fill in this short Financial Health Check before our meeting${share.firmName ? ` — ${share.firmName}` : ""}. You can save and come back to it: ${share.url}`
    : "";
  const wa = share ? waNumber(share.recipient.phone) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap card-surface p-3">
        <button onClick={makeLink} disabled={sharing} className="btn-secondary text-sm">
          {sharing ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Share client link
        </button>
        {saveError ? (
          <span className="text-xs font-medium text-destructive">{saveError}</span>
        ) : saving ? (
          <span className="text-xs text-muted-foreground">Saving…</span>
        ) : dirty ? (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        ) : savedAt ? (
          <span className="text-xs text-muted-foreground">Saved {savedAt}</span>
        ) : null}
        <span className="text-2xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground capitalize ml-auto">{status}</span>
      </div>

      {shareError && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{shareError}</div>}
      {notice && <div className="rounded-md bg-secondary px-3 py-2 text-sm">{notice}</div>}

      {share && (
        <div className="card-surface p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-primary flex-shrink-0" />
            <input readOnly value={share.url} className="input-base text-xs flex-1 min-w-0 font-mono" onFocus={(e) => e.currentTarget.select()} />
            <button
              onClick={() => { navigator.clipboard.writeText(share.url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="btn-secondary text-xs"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {wa && (
              <a className="btn-secondary text-xs" href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                <MessageCircle className="size-3.5" /> WhatsApp
              </a>
            )}
            {share.recipient.email && (
              <a
                className="btn-secondary text-xs"
                href={`mailto:${share.recipient.email}?subject=${encodeURIComponent("Your Financial Health Check")}&body=${encodeURIComponent(message)}`}
              >
                <Mail className="size-3.5" /> Email
              </a>
            )}
            <span className="text-2xs text-muted-foreground">Valid 14 days. A new link cancels the earlier ones.</span>
          </div>
        </div>
      )}

      <DiscoveryForm
        key={formKey}
        initialData={formData}
        subject={subjectType && subjectId ? { type: subjectType, id: subjectId } : undefined}
        onChange={onChange}
        onSave={(d) => { latest.current = d; void save(d); }}
        onSubmit={(d) => { latest.current = d; void save(d, { markReviewed: true }); }}
        onSaveRisk={subjectType === "investor" ? saveRisk : undefined}
        submitLabel="Mark reviewed"
        saving={saving}
      />
    </div>
  );
}
