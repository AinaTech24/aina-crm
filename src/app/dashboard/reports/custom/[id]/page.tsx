"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Download, Pencil, Loader2, BarChart3, AlertCircle } from "lucide-react";

// Recharts is heavy + not tree-shakeable; load it only when a report actually
// has a chart, not on every report view.
const ReportChart = dynamic(() => import("@/components/reports/ReportChart"), {
  ssr: false,
  loading: () => <div className="skeleton h-72 w-full rounded-xl" />,
});

type Detailed = { kind: "detailed"; columns: { key: string; label: string; type: string }[]; rows: Record<string, unknown>[] };
type Matrix = { kind: "matrix"; groupByLabel: string; colLabels: string[]; rows: { key: string; cells: number[]; total: number }[]; grandTotal: number; aggregate: "count" | "sum" };

function fmt(v: unknown, type?: string): string {
  if (v == null || v === "") return "—";
  if (type === "currency" || type === "number" || type === "integer") {
    const n = Number(v);
    if (Number.isFinite(n)) return n.toLocaleString("en-IN");
  }
  if (v instanceof Date) return new Date(v).toISOString().slice(0, 10);
  const s = String(v);
  // ISO timestamp → date
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s;
}

export default function ReportViewPage() {
  const id = (useParams() as { id: string }).id;
  const [meta, setMeta] = useState<{ name: string; description?: string; reportType: string; chartType?: string; isMine?: boolean } | null>(null);
  const [result, setResult] = useState<Detailed | Matrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [m, run] = await Promise.all([
          fetch(`/api/reports/saved/${id}`).then((r) => r.json()),
          fetch(`/api/reports/saved/${id}/run?limit=500`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
        ]);
        setMeta({ name: m.name, description: m.description, reportType: m.reportType, chartType: m.chartType });
        if (!run.ok) setErr(run.body?.error ?? "Failed to run report");
        else setResult(run.body.result);
      } catch (e: any) {
        setErr(e.message ?? "Failed to load report");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  return (
    <div className="space-y-4 max-w-6xl">
      <Link href="/dashboard/reports/custom" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to custom reports
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <BarChart3 className="size-6 text-brand-cyan" /> {meta?.name ?? "Report"}
          </h1>
          {meta?.description && <p className="page-subtitle">{meta.description}</p>}
        </div>
        <div className="flex gap-2">
          <Link href={`/dashboard/reports/custom/new?edit=${id}`} className="btn-secondary text-xs"><Pencil className="size-3.5" /> Edit</Link>
          <a href={`/api/reports/saved/${id}/export`} className="btn-primary text-xs"><Download className="size-4" /> Export Excel</a>
        </div>
      </div>

      {!loading && !err && result?.kind === "matrix" && meta?.chartType && meta.chartType !== "none" && (
        <div className="card-surface p-5">
          <ReportChart chartType={meta.chartType as "bar" | "pie" | "line"} matrix={result} />
        </div>
      )}

      <div className="card-surface overflow-hidden">
        {loading ? (
          <div className="p-12 grid place-items-center text-muted-foreground"><Loader2 className="size-6 animate-spin" /></div>
        ) : err ? (
          <div className="p-8 text-center text-sm text-rose-600 flex flex-col items-center gap-2">
            <AlertCircle className="size-6" /> {err}
          </div>
        ) : result?.kind === "detailed" ? (
          <DetailedTable r={result} />
        ) : result?.kind === "matrix" ? (
          <MatrixTable r={result} />
        ) : (
          <div className="p-12 text-center text-sm text-muted-foreground">No data.</div>
        )}
      </div>
      {result?.kind === "detailed" && (
        <p className="text-xs text-muted-foreground">{result.rows.length} row{result.rows.length === 1 ? "" : "s"} (first 500).</p>
      )}
    </div>
  );
}

function DetailedTable({ r }: { r: Detailed }) {
  if (r.rows.length === 0) return <div className="p-12 text-center text-sm text-muted-foreground">No rows match this report's filters.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
          <tr>{r.columns.map((c) => <th key={c.key} className="text-left px-3 py-2 font-medium whitespace-nowrap">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-secondary/40 transition-colors">
              {r.columns.map((c) => <td key={c.key} className="px-3 py-2 whitespace-nowrap">{fmt(row[c.key], c.type)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixTable({ r }: { r: Matrix }) {
  if (r.rows.length === 0) return <div className="p-12 text-center text-sm text-muted-foreground">No rows match this report's filters.</div>;
  const colTotals = r.colLabels.map((_, ci) => r.rows.reduce((s, row) => s + (row.cells[ci] ?? 0), 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
          <tr>
            <th className="text-left px-3 py-2 font-medium">{r.groupByLabel}</th>
            {r.colLabels.map((c) => <th key={c} className="text-right px-3 py-2 font-medium whitespace-nowrap">{c}</th>)}
            <th className="text-right px-3 py-2 font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row) => (
            <tr key={row.key} className="border-b last:border-0 hover:bg-secondary/40 transition-colors">
              <td className="px-3 py-2 font-medium whitespace-nowrap">{row.key}</td>
              {row.cells.map((v, ci) => <td key={ci} className="px-3 py-2 text-right tabular-nums">{v.toLocaleString("en-IN")}</td>)}
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.total.toLocaleString("en-IN")}</td>
            </tr>
          ))}
          <tr className="bg-secondary/40 font-semibold">
            <td className="px-3 py-2">Total</td>
            {colTotals.map((v, ci) => <td key={ci} className="px-3 py-2 text-right tabular-nums">{v.toLocaleString("en-IN")}</td>)}
            <td className="px-3 py-2 text-right tabular-nums">{r.grandTotal.toLocaleString("en-IN")}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
