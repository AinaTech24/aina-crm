"use client";

/**
 * VerifyContact — email/phone verification pills on Client 360 (Sanchay
 * "Verified At" parity). Shows a green ✓ when verified, else a one-tap
 * "Verify" that stamps it via POST /api/investors/[id]/verify-contact.
 *
 * Drawn inside the client setup checklist, in the same pill anatomy as the
 * KYC / nominee / bank items there, so the two states read as one list.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, ShieldQuestion } from "lucide-react";

export function VerifyContact({
  investorId, hasEmail, hasPhone, emailVerified, phoneVerified,
}: {
  investorId: string; hasEmail: boolean; hasPhone: boolean; emailVerified: boolean; phoneVerified: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(channel: "email" | "phone", verified: boolean) {
    setBusy(channel);
    try {
      await fetch(`/api/investors/${investorId}/verify-contact`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, verified }),
      });
      router.refresh();
    } finally { setBusy(null); }
  }

  function Pill({ channel, label, has, verified }: { channel: "email" | "phone"; label: string; has: boolean; verified: boolean }) {
    if (!has) return null;
    const spinning = busy === channel;
    return verified ? (
      <button type="button" onClick={() => toggle(channel, false)} disabled={spinning}
        className="inline-flex items-center gap-1 rounded-md border border-success/20 bg-success/5 px-2 py-1 text-2xs font-medium text-success hover:bg-secondary disabled:opacity-50"
        title={`${label} verified — click to clear`}>
        {spinning ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />} {label} verified
      </button>
    ) : (
      <button type="button" onClick={() => toggle(channel, true)} disabled={spinning}
        className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/5 px-2 py-1 text-2xs font-medium text-warning-foreground hover:bg-secondary disabled:opacity-50"
        title={`Mark the ${label.toLowerCase()} as verified`}>
        {spinning ? <Loader2 className="size-3 animate-spin" /> : <ShieldQuestion className="size-3" />} Verify {label.toLowerCase()}
      </button>
    );
  }

  if (!hasEmail && !hasPhone) return null;
  return (
    <>
      <Pill channel="email" label="Email" has={hasEmail} verified={emailVerified} />
      <Pill channel="phone" label="Phone" has={hasPhone} verified={phoneVerified} />
    </>
  );
}
