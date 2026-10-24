/**
 * What the registrar itself says about a SIP registration, read from its SIP
 * register — and the words it used, so the SIP book can show them.
 *
 *  - KFintech MFSD243 has a Status column: "Live SIP", "Terminated",
 *    "Terminated by Investor", "Process Rejection", "Bank Rejection",
 *    "Expired", "Cancelled".
 *  - CAMS WBR49 has no status: a CEASE_DATE means it stopped, and REMARKS says
 *    why ("Customer opted Cancellation.", "Three consecutive reversals").
 *
 * Attitude Financial, 9 Oct 2026: the SIP book had 173 KFintech SIPs closed
 * because nothing had been collected for 75 days, and MFSD243 marked 171 of
 * them Terminated / Terminated by Investor / rejected / expired / cancelled —
 * but the import read only the cease date, so the book could not say so.
 *
 * The firm's decision the same day: the registrar's status is SHOWN in the SIP
 * book, never acted on. `status` below is what the registrar says; the import
 * keeps its own rule (only a CAMS cease date stops a SIP) and records `reason`
 * as a label.
 */

export type RegistrarSipState = {
  status: "active" | "stopped" | "rejected" | "completed";
  /** "KFintech: Terminated by Investor · ceased 12 Mar 2024" — null while live. */
  reason: string | null;
  /** The registrar SAID it is live (a status column), not merely "no cease date". */
  explicitLive: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function day(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function classify(text: string): RegistrarSipState["status"] | null {
  const t = text.toLowerCase();
  if (/reject|revers|mandate incomplete/.test(t)) return "rejected";
  if (/expir|matur|goal|complet/.test(t)) return "completed";
  if (/terminat|cancel|ceas|stop|closed|inactive|revok/.test(t)) return "stopped";
  if (/\blive\b|\bactive\b|running|registered/.test(t)) return "active";
  return null;
}

export function registrarSipState(
  row: { registrarStatus?: string; registrarRemark?: string; ceaseDate?: string; registrarEndDate?: string },
  source: string,
  todayIst: string,
): RegistrarSipState {
  const who = source === "cams" ? "CAMS" : source === "kfintech" ? "KFintech" : "Registrar";
  const status = row.registrarStatus?.trim() ?? "";
  const remark = row.registrarRemark?.trim().replace(/\s+/g, " ").replace(/\.$/, "") ?? "";
  const end = row.ceaseDate ?? row.registrarEndDate;
  const ceased = end && end <= todayIst ? end : undefined;
  const words = (said: string) =>
    [`${who}: ${said}`, ceased ? `ceased ${day(ceased)}` : null].filter(Boolean).join(" · ").slice(0, 300);

  const byStatus = status ? classify(status) : null;
  if (byStatus === "active") {
    // A cease date in the past outranks a stale "live" label.
    if (!ceased) return { status: "active", reason: null, explicitLive: true };
  } else if (byStatus) {
    return { status: byStatus, reason: words(status), explicitLive: false };
  }
  if (ceased) {
    const said = remark || status || "ceased";
    const s = classify(said);
    return { status: s && s !== "active" ? s : "stopped", reason: words(remark || status || "Ceased"), explicitLive: false };
  }
  return { status: "active", reason: null, explicitLive: false };
}
