"use client";

/**
 * The Strategic Objective page's tables (client side because DataTable takes
 * cell renderers): baseline → now → needed this FY → objective, and the path
 * year by year.
 */

import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { fmtFigure, type FigureUnit } from "./figure-format";

export type PathRowView = {
  key: string;
  label: string;
  unit: FigureUnit;
  baseline: number | null;
  current: number | null;
  currentNote: string | null;
  neededThisYear: number | null;
  target: number;
  progress: number | null;
  status: "on_track" | "behind" | "well_behind" | "no_data";
  compound: boolean;
  perYear: number | null;
  points: Array<{ fy: number; needed: number }>;
};

const STATUS: Record<PathRowView["status"], { label: string; tone: BadgeTone }> = {
  on_track: { label: "On track", tone: "success" },
  behind: { label: "Behind", tone: "warning" },
  well_behind: { label: "Well behind", tone: "danger" },
  no_data: { label: "No figure", tone: "neutral" },
};

export function PathTable({ rows, fyLabel, objectiveLabel }: { rows: PathRowView[]; fyLabel: string; objectiveLabel: string }) {
  const columns: Column<PathRowView>[] = [
    { key: "figure", header: "Figure", cell: (r) => <span className="font-medium">{r.label}</span> },
    { key: "baseline", header: "Baseline", align: "right", cell: (r) => fmtFigure(r.baseline, r.unit) },
    {
      key: "now",
      header: "Now",
      align: "right",
      cell: (r) => (
        <span title={r.currentNote ?? undefined}>
          {r.current == null ? <span className="text-muted-foreground">Not recorded</span> : fmtFigure(r.current, r.unit)}
        </span>
      ),
    },
    { key: "needed", header: `Needed by end of ${fyLabel}`, align: "right", cell: (r) => fmtFigure(r.neededThisYear, r.unit) },
    { key: "objective", header: objectiveLabel, align: "right", cell: (r) => fmtFigure(r.target, r.unit) },
    {
      key: "progress",
      header: "Progress",
      align: "right",
      hideOnMobile: true,
      cell: (r) => (r.progress == null ? "—" : `${r.progress.toFixed(1)}%`),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <Badge tone={STATUS[r.status].tone} dot raw>{STATUS[r.status].label}</Badge>,
    },
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.key} caption="The strategic objective, figure by figure" />;
}

export function YearByYearTable({ rows }: { rows: PathRowView[] }) {
  const years = [...new Set(rows.flatMap((r) => r.points.map((p) => p.fy)))].sort((a, b) => a - b);
  const columns: Column<PathRowView>[] = [
    {
      key: "figure",
      header: "Figure",
      cell: (r) => (
        <div>
          <div className="font-medium">{r.label}</div>
          {r.perYear != null && (
            <div className="text-2xs text-muted-foreground">
              {r.compound ? `${(r.perYear * 100).toFixed(1)}% a year` : `${r.perYear >= 0 ? "+" : ""}${fmtFigure(r.perYear, r.unit)} a year`}
            </div>
          )}
        </div>
      ),
    },
    ...years.map<Column<PathRowView>>((fy) => ({
      key: `fy${fy}`,
      header: `FY${fy}`,
      align: "right",
      cell: (r) => fmtFigure(r.points.find((p) => p.fy === fy)?.needed, r.unit),
    })),
  ];
  return <DataTable rows={rows.filter((r) => r.points.length)} columns={columns} rowKey={(r) => r.key} density="compact" caption="The path to the objective, year by year" />;
}
