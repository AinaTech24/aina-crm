"use client";

/**
 * Compact "Onboarding stage" cell for the client-details grid — the client's
 * current stage on the onboarding journey (fetched from
 * /api/investors/[id]/blueprint). Read-only; the full stage bar lives on the
 * Engagement tab for clients converted from a lead. Styled to line up with the
 * other <Status>/<KV> cells.
 *
 * Reads `current.name`. It used to look for a `stages` array the API never
 * returned (the field is `allStages`), so every client read "Not started".
 */

import { useEffect, useState } from "react";

export function BlueprintStatusKV({ investorId }: { investorId: string }) {
  const [stage, setStage] = useState<string | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    let alive = true;
    fetch(`/api/investors/${investorId}/blueprint`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        const stages: any[] = j?.allStages ?? [];
        const current = j?.current?.name ?? stages.find((s) => s.status === "current")?.name;
        const lastDone = [...stages].reverse().find((s) => s.status === "done")?.name;
        setStage(current ?? lastDone ?? null);
      })
      .catch(() => { if (alive) setStage(null); });
    return () => { alive = false; };
  }, [investorId]);

  return (
    <div>
      <div className="text-xs text-muted-foreground">Onboarding stage</div>
      <span className="text-xs px-2 py-0.5 rounded-full mt-1 inline-block bg-secondary text-secondary-foreground">
        {stage === undefined ? "…" : stage || "Not started"}
      </span>
    </div>
  );
}
