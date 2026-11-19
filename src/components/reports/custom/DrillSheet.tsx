"use client";

/**
 * The records behind a clicked number (Zoho's drill-down): a side panel that
 * runs the report as a detailed list narrowed to the clicked group values and
 * the viewer's quick filters, 100 at a time, each row linking to its record.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { DetailedTable, type Detailed, type Drill } from "./ReportTables";

const PAGE = 100;

export function DrillSheet({
  reportId,
  drill,
  filter,
  query,
  onClose,
}: {
  reportId: string;
  drill: Drill[] | null;
  filter: unknown;
  /** The We Care date-range bar's query string, when it is on. */
  query?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Detailed | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(offset: number) {
    if (!drill) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/reports/saved/${reportId}/run${query ? `?${query}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ drill: drill.map(({ field, value }) => ({ field, value })), filter, limit: PAGE, offset }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not load the records");
      const next = j.result as Detailed;
      setData((prev) => (offset && prev ? { ...next, rows: [...prev.rows, ...next.rows] } : next));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    if (drill) void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill]);

  return (
    <Sheet open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full max-w-4xl space-y-3">
        <div className="pr-10">
          <SheetTitle className="text-base font-semibold">{drill?.map((d) => d.label).join(" › ")}</SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            {data ? `${data.total.toLocaleString("en-IN")} record${data.total === 1 ? "" : "s"}` : "Loading…"}
          </SheetDescription>
        </div>
        {err ? (
          <p className="text-sm text-destructive">{err}</p>
        ) : !data ? (
          <div className="py-12 grid place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="card-surface overflow-hidden">
            <DetailedTable r={data} />
          </div>
        )}
        {data && data.rows.length < data.total && (
          <Button size="sm" loading={loading} onClick={() => load(data.rows.length)}>
            Show more ({(data.total - data.rows.length).toLocaleString("en-IN")} left)
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}
