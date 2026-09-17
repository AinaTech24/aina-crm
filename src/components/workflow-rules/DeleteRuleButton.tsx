"use client";

import { useState } from "react";
import { notify } from "@/components/ui/Toast";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { confirmDialog } from "@/components/ui/ConfirmProvider";

export function DeleteRuleButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!(await confirmDialog({ title: `Delete the rule "${name}"?`, message: `This cannot be undone.`, confirmLabel: "Delete", tone: "danger" }))) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/workflow-rules/${id}`, { method: "DELETE" });
      if (!r.ok) {
        notify.error("Failed to delete");
        setBusy(false);
        return;
      }
      router.push("/dashboard/workflows/rules");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button onClick={del} disabled={busy} className="btn-secondary text-xs text-rose-700 hover:bg-rose-50">
      <Trash2 className="size-3.5" /> Delete
    </button>
  );
}
