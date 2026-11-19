/**
 * The review sheet (docs/PAYROLL_MODULE_DESIGN.md §3.5 step 4): this month
 * against last month, person by person — who is new, who left, whose pay moved
 * by more than 10%, who gets nothing, who is on hold. Pure; the run page and
 * the variance CSV both use it.
 */

export type VarianceItem = { userId: string; name: string; gross: number; net: number; onHold: boolean };
export type VarianceFlag = "new" | "left" | "up" | "down" | "zero" | "held";
export type VarianceRow = {
  userId: string;
  name: string;
  lastNet: number | null;
  net: number | null;
  change: number | null;
  changePct: number | null;
  flags: VarianceFlag[];
};

export const FLAG_LABEL: Record<VarianceFlag, string> = {
  new: "New this month",
  left: "Not paid this month",
  up: "Up more than 10%",
  down: "Down more than 10%",
  zero: "Nil pay",
  held: "On hold",
};

/** Rows that need a look, then everyone else; biggest moves first. */
export function variance(current: VarianceItem[], previous: VarianceItem[] | null, threshold = 0.1): VarianceRow[] {
  const prev = new Map((previous ?? []).filter((p) => !p.onHold).map((p) => [p.userId, p]));
  const rows: VarianceRow[] = [];
  const seen = new Set<string>();
  for (const c of current) {
    seen.add(c.userId);
    const p = prev.get(c.userId);
    const flags: VarianceFlag[] = [];
    if (c.onHold) flags.push("held");
    if (!c.onHold && c.net <= 0) flags.push("zero");
    let change: number | null = null;
    let changePct: number | null = null;
    if (previous && !p) flags.push("new");
    if (p) {
      change = Math.round(c.net - p.net);
      changePct = p.net > 0 ? Math.round((change / p.net) * 1000) / 10 : null;
      if (!c.onHold && p.net > 0 && Math.abs(change) / p.net > threshold) flags.push(change > 0 ? "up" : "down");
    }
    rows.push({ userId: c.userId, name: c.name, lastNet: p ? p.net : null, net: c.net, change, changePct, flags });
  }
  for (const p of prev.values()) {
    if (seen.has(p.userId)) continue;
    rows.push({ userId: p.userId, name: p.name, lastNet: p.net, net: null, change: -Math.round(p.net), changePct: -100, flags: ["left"] });
  }
  return rows.sort((a, b) => (b.flags.length ? 1 : 0) - (a.flags.length ? 1 : 0) || Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0) || a.name.localeCompare(b.name));
}
