/** Formats a strategy figure. Plain module: called from the server page and the client tables. */

import { formatMoney } from "@/lib/format";

export type FigureUnit = "inr" | "count" | "hours";

export function fmtFigure(v: number | null | undefined, unit: FigureUnit): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "inr") return formatMoney(v, { decimals: 2 });
  if (unit === "hours") return `${Math.round(v * 10) / 10} h`;
  return Math.round(v).toLocaleString("en-IN");
}
