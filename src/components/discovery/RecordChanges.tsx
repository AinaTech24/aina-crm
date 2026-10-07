"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import type { RecordDiff } from "@/lib/discovery/record-diff";

/**
 * Where the fact-find and the client / lead record disagree — usually the
 * client correcting their own details on the link. The RM ticks what is right
 * and applies it; the server copies the fact-find's stored values, never what
 * this page sends. PAN changes go through the client's edit page.
 */
export function RecordChanges({
  discoveryId,
  diffs,
  subjectType,
  subjectId,
  canEdit,
}: {
  discoveryId: string;
  diffs: RecordDiff[];
  subjectType: string;
  subjectId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const applicable = diffs.filter((d) => d.applicable);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(applicable.map((d) => d.field)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!diffs.length) return null;

  const editHref = subjectType === "lead" ? `/dashboard/leads/${subjectId}` : `/dashboard/investors/${subjectId}/edit`;

  async function apply() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/discovery/${discoveryId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields: [...picked] }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Could not update the record.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-surface p-4 space-y-3 border-warning/50 bg-warning/5">
      <div className="flex items-center gap-2">
        <RefreshCw className="size-4 text-warning-foreground" aria-hidden />
        <h2 className="font-semibold text-sm">Different from the {subjectType === "lead" ? "lead" : "client"} record</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {canEdit && <th className="w-8 relative"><span className="sr-only">Apply</span></th>}
              <th className="text-left">Field</th>
              <th className="text-left">On record</th>
              <th className="text-left">In the fact-find</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => (
              <tr key={d.field}>
                {canEdit && (
                  <td>
                    {d.applicable && (
                      <input
                        type="checkbox"
                        aria-label={`Apply ${d.label}`}
                        checked={picked.has(d.field)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(d.field); else next.delete(d.field);
                          setPicked(next);
                        }}
                      />
                    )}
                  </td>
                )}
                <td className="font-medium">{d.label}</td>
                <td className="text-muted-foreground">{d.record || "—"}</td>
                <td>
                  {d.factFind}
                  {!d.applicable && (
                    <Link href={editHref} className="ml-2 text-xs text-primary hover:underline">Change on the record</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <p className="text-xs font-medium text-destructive">{err}</p>}
      {canEdit && applicable.length > 0 && (
        <div className="flex justify-end">
          <button type="button" className="btn-secondary text-sm" disabled={busy || picked.size === 0} onClick={apply}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Update the record
          </button>
        </div>
      )}
    </section>
  );
}
