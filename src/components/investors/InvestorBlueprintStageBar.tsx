"use client";

/**
 * Investor-side wrapper around the existing BlueprintStageBar.
 *
 * The same component renders, but:
 *   - data is fetched from /api/investors/[id]/blueprint, which resolves the
 *     source lead and returns its blueprint
 *   - only client-phase stages (13-15: Operations / Portal Welcome / Active
 *     Client) are shown
 *
 * Gracefully hides itself if the investor was created outside the lead flow
 * (no source lead → no blueprint).
 */
import { useEffect, useState } from "react";
import { BlueprintStageBar } from "@/components/leads/BlueprintStageBar";

export function InvestorBlueprintStageBar({ investorId }: { investorId: string }) {
  const [leadId, setLeadId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/investors/${investorId}/blueprint`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (cancelled) return;
        setLeadId(d.leadId);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [investorId]);

  if (missing || !leadId) return null;
  return (
    <BlueprintStageBar
      leadId={leadId}
      phase="client"
      // We're already on the client page — disable the convert CTA logic.
      convertedInvestorId={investorId}
    />
  );
}
