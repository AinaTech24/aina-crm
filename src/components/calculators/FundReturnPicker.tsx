"use client";

/**
 * FundReturnPicker — pick a real MF scheme and prefill an expected-return field
 * with its live trailing CAGR (5Y, falling back to 3Y/1Y) from MFAPI. Lets an
 * advisor ground a projection in a real fund's actual track record.
 */

import { useState } from "react";
import { SchemeAutocomplete, type SchemePick } from "../mf/SchemeAutocomplete";

export function FundReturnPicker({
  onPick, prefer = "y5",
}: {
  onPick: (pct: number) => void;
  prefer?: "y3" | "y5";
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handle(s: SchemePick) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/mf/schemes/${encodeURIComponent(s.schemeCode)}/returns`);
      if (!res.ok) { setNote("No return history for this fund."); return; }
      const j = await res.json();
      const r = j?.returns ?? {};
      const order = prefer === "y5" ? ["y5", "y3", "y1"] : ["y3", "y5", "y1"];
      let chosen: { pct: number; label: string } | null = null;
      for (const k of order) {
        if (typeof r[k] === "number") { chosen = { pct: r[k], label: k === "y5" ? "5Y" : k === "y3" ? "3Y" : "1Y" }; break; }
      }
      if (chosen) {
        onPick(Math.round(chosen.pct * 10) / 10);
        setNote(`${s.schemeName} · ${chosen.pct.toFixed(1)}% (${chosen.label} CAGR, MFAPI)`);
      } else {
        setNote("Insufficient history to derive a return.");
      }
    } catch {
      setNote("Couldn't reach MFAPI — keep the assumed return.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <SchemeAutocomplete size="sm" placeholder="Prefill return from a real fund…" onSelect={handle} />
      {(note || busy) && (
        <p className="text-[10px] text-muted-foreground">
          {busy ? "Fetching the fund's track record…" : note}
        </p>
      )}
    </div>
  );
}
