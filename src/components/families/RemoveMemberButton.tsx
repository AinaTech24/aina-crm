"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function RemoveMemberButton({
  familyId,
  investorId,
  investorName,
}: {
  familyId: string;
  investorId: string;
  investorName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm(`Remove ${investorName} from this family? (The investor record is kept.)`)) return;
    setBusy(true);
    try {
      await fetch(`/api/families/${familyId}/members?investorId=${investorId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="text-xs text-rose-600 hover:underline disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin inline" /> : "Remove"}
    </button>
  );
}
