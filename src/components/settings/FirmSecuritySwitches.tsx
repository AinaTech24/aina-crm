"use client";

/**
 * The firm's two DPDP safeguards on Settings → Security (owner / admin):
 * require two-factor sign-in for everyone, and allow or stop AI features.
 * PUT /api/settings/firm-security.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-primary" : "bg-secondary border border-border"}`}
    >
      <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function FirmSecuritySwitches({
  require2fa,
  aiEnabled,
  withoutTwoFa,
  teamSize,
}: {
  require2fa: boolean;
  aiEnabled: boolean;
  /** Active team members who have not set up 2FA yet. */
  withoutTwoFa: number;
  teamSize: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function save(body: { require2fa?: boolean; aiEnabled?: boolean }, done: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/firm-security", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      notify.success(done);
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Firm security" />
      <div className="divide-y divide-border px-5 pb-2">
        <div className="flex items-start gap-4 py-4">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">Require two-factor sign-in for everyone</div>
            <div className="text-muted-foreground">
              {withoutTwoFa > 0
                ? `${withoutTwoFa} of ${teamSize} team members have not set it up. They will be asked to at their next sign-in.`
                : `All ${teamSize} team members have set it up.`}
            </div>
          </div>
          <Switch
            label="Require two-factor sign-in"
            checked={require2fa}
            disabled={busy}
            onChange={async (v) => {
              if (v) {
                const ok = await confirmDialog({
                  title: "Require two-factor sign-in?",
                  message: "Everyone will need an authenticator app on their phone. Anyone without one sets it up at their next sign-in, and the mobile app asks them to do that on the web first.",
                  confirmLabel: "Require it",
                });
                if (!ok) return;
              }
              await save({ require2fa: v }, v ? "Two-factor sign-in is now required." : "Two-factor sign-in is optional again.");
            }}
          />
        </div>
        <div className="flex items-start gap-4 py-4">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">AI features</div>
            <div className="text-muted-foreground">
              Drafts, summaries and the assistant send the details they need to the AI provider, which may process them outside India.
              PAN, Aadhaar, phone numbers and email addresses are always replaced before anything is sent. Off: no AI feature runs for the firm.
            </div>
          </div>
          <Switch
            label="Allow AI features"
            checked={aiEnabled}
            disabled={busy}
            onChange={(v) => save({ aiEnabled: v }, v ? "AI features are on." : "AI features are off for the firm.")}
          />
        </div>
      </div>
    </Card>
  );
}
