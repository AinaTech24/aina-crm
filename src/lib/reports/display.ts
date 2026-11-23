/**
 * How a report's labels read on screen (We Care's simpler report pages,
 * 2026-11-23). Plain helpers, safe on the server and the client.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "WCFW Equity Business MoM" → "Equity Business MoM": the firm prefix says nothing inside the firm's own CRM. */
export function reportDisplayName(name: string): string {
  return name.replace(/^WCFW\s+/i, "").trim() || name;
}

/** A group or column value as a person reads it: "2026-11" → "Nov 2026", "2026-11-05" → "5 Nov 2026". */
export function periodLabel(v: unknown): string {
  const s = v == null ? "" : String(v);
  let m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  return s;
}

/** A stored code as words: "client_contacted" → "Client contacted". */
export function humanCode(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(s)) return s;
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** True when every group key is a month ("2026-11"). */
export function isMonthKeys(keys: unknown[]): boolean {
  return keys.length > 0 && keys.every((k) => /^\d{4}-\d{2}$/.test(String(k)));
}
