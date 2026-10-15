"use client";

/**
 * Client page → Compliance status: what the KRA last said about this client's
 * KYC, when, and a "Check now" that asks again through the firm's NSE MF Invest
 * connection (POST /api/investors/[id]/kyc-check).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/utils";

export function KycCheckButton({
  investorId,
  remark,
  checkedAt,
  canCheck,
}: {
  investorId: string;
  remark: string | null;
  checkedAt: string | null;
  canCheck: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      const res = await fetch(`/api/investors/${investorId}/kyc-check`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? "Could not check KYC");
        return;
      }
      if (j.outcome !== "ok" || j.error) {
        toast.warning(j.error ?? "The KRA did not answer — status unchanged");
      } else if (j.changed) {
        toast.success(`KYC status updated: ${j.remark ?? j.statusAfter}${j.kra ? ` (${j.kra})` : ""}`);
      } else {
        toast.info(`No change: ${j.remark ?? j.statusAfter}${j.kra ? ` (${j.kra})` : ""}`);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>
        {remark ?? <span className="text-muted-foreground">Not checked yet</span>}
        {checkedAt && <span className="text-xs text-muted-foreground"> · {formatRelative(checkedAt)}</span>}
      </span>
      {canCheck && (
        <Button size="sm" variant="ghost" loading={busy} icon={<RefreshCw className="size-3.5" aria-hidden />} onClick={check}>
          Check now
        </Button>
      )}
    </div>
  );
}
