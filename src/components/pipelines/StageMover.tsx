"use client";

/** StageMover — move a lead within (stage) or across (pipeline) the board. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PIPELINES, PIPELINE_KEYS, firstStage, type PipelineKey } from "@/lib/pipelines/config";

export function StageMover({ leadId, pipeline, stage }: { leadId: string; pipeline: PipelineKey; stage: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(body: any) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/pipeline`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-1 mt-1.5">
      <select value={stage} disabled={busy} onChange={(e) => patch({ pipelineStage: e.target.value })} className="input-base text-[11px] py-0.5 flex-1" title="Move stage">
        {PIPELINES[pipeline].stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <select value={pipeline} disabled={busy} onChange={(e) => { const p = e.target.value as PipelineKey; patch({ pipeline: p, pipelineStage: firstStage(p) }); }} className="input-base text-[11px] py-0.5 w-20" title="Move pipeline">
        {PIPELINE_KEYS.map((p) => <option key={p} value={p}>{PIPELINES[p].label.split(" ")[0]}</option>)}
      </select>
      {busy && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
    </div>
  );
}
