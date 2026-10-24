"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { notify } from "@/components/ui/Toast";

/** "Use this version" on one row of a template's version history. */
export function UseVersionButton({
  templateId,
  versionId,
  versionNumber,
  isActive,
  usable,
  reason,
}: {
  templateId: string;
  versionId: string;
  versionNumber: number;
  isActive: boolean;
  usable: boolean;
  reason?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // The row's own "Active" badge already says it.
  if (isActive) return null;

  async function use() {
    setBusy(true);
    try {
      const r = await fetch(`/api/templates/${templateId}/activate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      notify.success(`Version ${versionNumber} is now the one sent.`);
      router.push(`/dashboard/templates/${templateId}?v=${versionNumber}`);
      router.refresh();
    } catch (e: any) {
      notify.error(e?.message ?? "Could not switch version");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      className="mt-2 w-full"
      onClick={use}
      loading={busy}
      disabled={!usable}
      title={usable ? `Send version ${versionNumber} from now on` : reason}
    >
      Use this version
    </Button>
  );
}
