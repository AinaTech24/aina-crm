/**
 * Dashboard period helpers — server-safe (NO "use client").
 *
 * Lives in lib (not in the PeriodSelector client component) so the server
 * OwnerCockpit can call resolvePeriodDates() directly. A client component
 * can't export functions the server invokes, so the type + the pure
 * resolver belong here; the PeriodSelector component imports the type from
 * this module.
 *
 * India FY = April–March. QTD quarters:
 *   Q1: Apr–Jun · Q2: Jul–Sep · Q3: Oct–Dec · Q4: Jan–Mar
 */

export type Period = "mtd" | "qtd" | "fytd" | "lm" | "custom";

export const PERIOD_LABELS: Record<"mtd" | "qtd" | "fytd" | "lm", string> = {
  mtd: "Month to date",
  qtd: "Quarter to date",
  fytd: "FY to date",
  lm: "Last month",
};

/**
 * Given a period key and the current date, return the period start (ISO)
 * for SQL WHERE clauses plus a human label.
 */
export function resolvePeriodDates(
  period: Period,
  now = new Date(),
  customStart?: string
): { startISO: string; label: string } {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based

  if (period === "custom" && customStart && /^\d{4}-\d{2}-\d{2}$/.test(customStart)) {
    const d = new Date(customStart);
    if (!isNaN(d.getTime())) {
      return { startISO: d.toISOString(), label: `Since ${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}` };
    }
  }

  // India FY: April (month=3) is Q1 start
  const fyStart = m >= 3 ? new Date(y, 3, 1) : new Date(y - 1, 3, 1);

  // QTD quarters (India FY-aligned)
  let qtdStart: Date;
  if (m >= 3 && m <= 5) {
    qtdStart = new Date(y, 3, 1); // Q1 Apr–Jun
  } else if (m >= 6 && m <= 8) {
    qtdStart = new Date(y, 6, 1); // Q2 Jul–Sep
  } else if (m >= 9 && m <= 11) {
    qtdStart = new Date(y, 9, 1); // Q3 Oct–Dec
  } else {
    qtdStart = new Date(y, 0, 1); // Q4 Jan–Mar
  }

  switch (period) {
    case "lm": {
      const lmStart = new Date(y, m - 1, 1);
      return {
        startISO: lmStart.toISOString(),
        label: lmStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      };
    }
    case "qtd":
      return {
        startISO: qtdStart.toISOString(),
        label: `Q${Math.floor(((m - 3 + 12) % 12) / 3) + 1} FY${String(fyStart.getFullYear()).slice(-2)}-${String(fyStart.getFullYear() + 1).slice(-2)}`,
      };
    case "fytd":
      return {
        startISO: fyStart.toISOString(),
        label: `FY${String(fyStart.getFullYear()).slice(-2)}-${String(fyStart.getFullYear() + 1).slice(-2)}`,
      };
    case "mtd":
    default:
      return {
        startISO: new Date(y, m, 1).toISOString(),
        label: now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      };
  }
}
