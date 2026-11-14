"use client";

/**
 * Investor-side blueprint stage bar.
 *
 * Two render modes based on the API response:
 *   1. Source-lead path → the investor was converted from a lead, so we
 *      have a real blueprint instance. Delegate to the existing
 *      <BlueprintStageBar> with phase="client" so the user can re-sync,
 *      view history, etc.
 *   2. Synthetic path → no source lead (added directly / imported). Render
 *      a read-only bar placed from the FACTS on the client record (KYC
 *      verified, UCC, mandate, folios / transactions, family) — never a
 *      fake "all done", never a failure step ticked. No advance / re-sync
 *      buttons because there's nothing to advance against.
 *
 * Always renders something so the user sees the journey on every client.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { BlueprintStageBar } from "@/components/leads/BlueprintStageBar";
import { MapFamilyHost } from "@/components/families/MapFamilyDialog";
import { KycRouteDialog } from "@/components/investors/KycRouteDialog";

type ApiData = {
  leadId: string | null;
  synthetic: boolean;
  allStages: Array<{
    key: string;
    name: string;
    order: number;
    status: "done" | "current" | "upcoming" | "skipped";
    phase?: "lead" | "client";
  }>;
  current?: { name: string; order: number };
};

export function InvestorBlueprintStageBar({ investorId, investorName }: { investorId: string; investorName?: string }) {
  const [data, setData] = useState<ApiData | null>(null);
  const [err, setErr] = useState(false);
  const [kycOpen, setKycOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/investors/${investorId}/blueprint`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, [investorId]);

  if (err) return null;
  if (!data) {
    return (
      <div className="card-surface p-3 text-xs text-muted-foreground">
        Loading client journey…
      </div>
    );
  }

  // Real lead-backed blueprint → reuse the full component with phase=client.
  if (!data.synthetic && data.leadId) {
    return (
      <>
        <BlueprintStageBar
          leadId={data.leadId}
          phase="client"
          convertedInvestorId={investorId}
        />
        {/* The journey's "Map Family" button opens this (MapFamilyDialog). */}
        <MapFamilyHost investorId={investorId} investorName={investorName ?? "this client"} />
      </>
    );
  }

  // Synthetic / direct-import client — a small read-only bar, from facts.
  const doneAll = data.allStages.every((s) => s.status === "done" || s.status === "skipped");
  return (
    <div className="card-surface p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-brand-cyan" />
          <h3 className="font-semibold text-sm">Client Onboarding</h3>
          <span className="text-xs text-muted-foreground">
            Added directly · placed from the client record
          </span>
        </div>
        {doneAll ? (
          <span className="chip bg-emerald-50 text-emerald-700 text-2xs inline-flex items-center gap-1">
            <CheckCircle2 className="size-3" /> Onboarded
          </span>
        ) : data.current ? (
          <span className="chip bg-secondary text-secondary-foreground text-2xs">Next: {data.current.name}</span>
        ) : null}
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <ol className="flex items-center min-w-max gap-0.5">
          {data.allStages.map((s, i) => (
            <li key={s.key} className="flex items-center">
              <StepWrap kyc={s.key === "kyc_validated" && s.status !== "done"} onKyc={() => setKycOpen(true)}>
                <div
                  className={`size-7 rounded-full grid place-items-center text-2xs font-bold ${
                    s.status === "done"
                      ? "bg-emerald-500 text-white"
                      : s.status === "current"
                        ? "bg-brand-cyan text-white ring-2 ring-brand-cyan/30"
                        : s.status === "skipped"
                          ? "border border-dashed border-border text-muted-foreground"
                          : "bg-secondary text-muted-foreground"
                  }`}
                  title={s.status === "skipped" ? `${s.name} — not used (invested without it)` : s.status === "done" ? s.name : `${s.name} — not recorded yet`}
                >
                  {s.status === "done" ? "✓" : s.status === "skipped" ? "–" : s.order}
                </div>
                <span
                  className={`mt-1 text-2xs text-center leading-tight max-w-[90px] ${
                    s.status === "current" ? "font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {s.name}
                </span>
              </StepWrap>
              {i < data.allStages.length - 1 && (
                <div
                  className={`h-0.5 w-10 mx-0.5 mb-5 ${
                    s.status === "done" ? "bg-emerald-400" : "bg-border"
                  }`}
                />
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-2.5 border border-border/60 flex items-start gap-2">
        <Sparkles className="size-3.5 mt-0.5 flex-shrink-0 text-brand-cyan" />
        <span>
          This client was added directly (not converted from a lead), so there is
          no lead journey on file. A step is ticked only when the client record
          shows it — KYC verified, a UCC, an active mandate, a folio or
          transaction, a family. Need a fresh KYC?{" "}
          <button type="button" onClick={() => setKycOpen(true)} className="font-semibold text-foreground underline underline-offset-2">
            Start Online or Physical KYC
          </button>{" "}
          as a task.
        </span>
      </div>
      {kycOpen && <KycRouteDialog investorId={investorId} investorName={investorName ?? "this client"} onClose={() => setKycOpen(false)} />}
    </div>
  );
}

/** A step on the read-only bar; "KYC Registered" (fresh KYC) is a button that opens the KYC choice. */
function StepWrap({ kyc, onKyc, children }: { kyc: boolean; onKyc: () => void; children: React.ReactNode }) {
  if (!kyc) return <div className="flex flex-col items-center min-w-[80px]">{children}</div>;
  return (
    <button
      type="button"
      onClick={onKyc}
      title="Fresh KYC: choose Online or Physical KYC and create the task"
      className="flex flex-col items-center min-w-[80px] rounded-lg p-0.5 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {children}
    </button>
  );
}
