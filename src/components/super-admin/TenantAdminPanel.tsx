"use client";

/**
 * Platform-admin account controls for a single tenant:
 *   · view / update the contact email
 *   · send the tenant owner a password-reset link
 *   · delete the tenant (soft delete, typed-ARN confirmation)
 *
 * Lives below the tenant detail header. Uses inline status messages (the
 * super-admin shell doesn't mount the toast provider).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, KeyRound, Trash2, Loader2, Check, AlertTriangle } from "lucide-react";

export function TenantAdminPanel({
  tenantId,
  currentEmail,
  arn,
  legalName,
}: {
  tenantId: string;
  currentEmail: string | null;
  arn: string;
  legalName: string;
}) {
  const router = useRouter();

  const [email, setEmail] = useState(currentEmail ?? "");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmArn, setConfirmArn] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState<string | null>(null);

  async function saveEmail() {
    setEmailBusy(true);
    setEmailMsg(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailMsg({ ok: false, text: j.error ?? "Could not update email" });
        return;
      }
      setEmailMsg({ ok: true, text: email.trim() ? "Contact email updated." : "Contact email cleared." });
      router.refresh();
    } finally {
      setEmailBusy(false);
    }
  }

  async function resetPassword() {
    setResetBusy(true);
    setResetMsg(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/reset-password`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetMsg({ ok: false, text: j.error ?? "Could not send reset link" });
        return;
      }
      setResetMsg({
        ok: true,
        text: `Reset link sent to ${j.sentTo}${j.emailSent === false ? " (email delivery not configured — check server logs)" : ""}.`,
      });
    } finally {
      setResetBusy(false);
    }
  }

  async function deleteTenant() {
    setDelBusy(true);
    setDelMsg(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmArn: confirmArn.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDelMsg(j.error ?? "Could not delete tenant");
        return;
      }
      router.push("/super-admin/tenants");
      router.refresh();
    } finally {
      setDelBusy(false);
    }
  }

  const armed = confirmArn.trim().toLowerCase() === arn.toLowerCase();

  return (
    <div className="border rounded-lg bg-card p-5 space-y-5">
      <h2 className="font-semibold">Account administration</h2>

      {/* Contact email */}
      <div>
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Mail className="size-4 text-muted-foreground" /> Contact email
        </label>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="firm@example.com"
            className="input-base text-sm h-9 min-w-[16rem] flex-1"
          />
          <button
            onClick={saveEmail}
            disabled={emailBusy || email.trim() === (currentEmail ?? "")}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
          >
            {emailBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
          </button>
        </div>
        {emailMsg && (
          <p className={`text-xs mt-1.5 ${emailMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{emailMsg.text}</p>
        )}
      </div>

      {/* Reset password */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium flex items-center gap-1.5">
              <KeyRound className="size-4 text-muted-foreground" /> Owner password
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Emails the tenant owner a one-time link to set a new password (valid 1 hour). You never see the password.
            </p>
          </div>
          <button
            onClick={resetPassword}
            disabled={resetBusy}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50 whitespace-nowrap"
          >
            {resetBusy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Send reset link
          </button>
        </div>
        {resetMsg && (
          <p className={`text-xs mt-2 ${resetMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{resetMsg.text}</p>
        )}
      </div>

      {/* Danger zone — delete tenant */}
      <div className="border-t pt-4">
        <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4">
          <div className="text-sm font-semibold text-rose-700 flex items-center gap-1.5">
            <AlertTriangle className="size-4" /> Delete tenant
          </div>
          <p className="text-xs text-rose-700/80 mt-1">
            Removes <span className="font-medium">{legalName}</span> from the platform and blocks all its logins.
            This is a soft delete — the data is retained and can be restored by AINA engineering.
          </p>
          {!confirmOpen ? (
            <button
              onClick={() => { setConfirmOpen(true); setDelMsg(null); }}
              className="mt-3 rounded-md border border-rose-300 text-rose-700 px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-rose-100"
            >
              <Trash2 className="size-3.5" /> Delete tenant…
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <label className="text-xs text-rose-700">
                Type the ARN <span className="font-mono font-semibold">{arn}</span> to confirm:
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={confirmArn}
                  onChange={(e) => setConfirmArn(e.target.value)}
                  placeholder={arn}
                  className="input-base text-sm h-9 font-mono min-w-[12rem]"
                  autoFocus
                />
                <button
                  onClick={deleteTenant}
                  disabled={!armed || delBusy}
                  className="rounded-md bg-rose-600 text-white px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
                >
                  {delBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Permanently delete
                </button>
                <button
                  onClick={() => { setConfirmOpen(false); setConfirmArn(""); setDelMsg(null); }}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
              {delMsg && <p className="text-xs text-rose-600">{delMsg}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
