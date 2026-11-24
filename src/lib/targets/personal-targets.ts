/**
 * A person's FY targets — the SEVEN numbers of the dashboard's "My target tracker" (2026-11-24).
 *
 * Settings → Targets & quota asks for exactly these, per team member, and stores each as
 * one annual figure in `kra_targets` — the table the tracker reads (lib/dashboard/my/window.ts,
 * PERSON_KEY). So a target typed there is what the tracker, the RM desk and the branch
 * view's per-person figures compare against; nothing has to be set again on the Team scorecard.
 * The tracker phases the annual figure into a week or a month itself.
 *
 * Pure.
 */

export type PersonalTargetUnit = "inr" | "count";

export type PersonalTargetMetric = {
  /** The tracker's own label — the field is called what the card is called. */
  label: string;
  /** The `kra_targets.metric_key` the tracker reads for this card. */
  key: string;
  unit: PersonalTargetUnit;
  /** What the figure measures, in a line under the field. */
  hint: string;
  placeholder: string;
};

export const PERSONAL_TARGET_METRICS: PersonalTargetMetric[] = [
  { label: "SIP book", key: "sip_book", unit: "inr", hint: "Monthly SIP book to reach by the year end", placeholder: "e.g. 500000" },
  { label: "Net new SIP", key: "net_sip", unit: "inr", hint: "Monthly SIP added, less stopped, over the year", placeholder: "e.g. 300000" },
  { label: "Net business", key: "mf_business", unit: "inr", hint: "Business booked less redemptions, over the year", placeholder: "e.g. 5000000" },
  { label: "New clients", key: "new_clients", unit: "count", hint: "Clients onboarded over the year", placeholder: "e.g. 10" },
  { label: "Meetings", key: "meetings", unit: "count", hint: "Meetings completed over the year", placeholder: "e.g. 50" },
  { label: "Review meetings", key: "reviews", unit: "count", hint: "Review meetings completed over the year", placeholder: "e.g. 20" },
  { label: "Insurance business", key: "insurance_business", unit: "inr", hint: "Insurance premium booked over the year", placeholder: "e.g. 300000" },
];

export const PERSONAL_TARGET_KEYS = PERSONAL_TARGET_METRICS.map((m) => m.key);

const MAX_AMOUNT = 1e12;
const MAX_COUNT = 1_000_000;

export type CleanTargets = { set: Record<string, number>; clear: string[]; errors: Record<string, string> };

/**
 * What a form posted → what to store. A blank or null clears the target (a person with no target is
 * "Not set", never a target of zero, so 0 clears too). Unknown keys are ignored; a bad number is
 * reported against its key and nothing for it is written.
 */
export function cleanPersonalTargets(input: unknown): CleanTargets {
  const out: CleanTargets = { set: {}, clear: [], errors: {} };
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  for (const m of PERSONAL_TARGET_METRICS) {
    if (!(m.key in src)) continue;
    const raw = src[m.key];
    if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) { out.clear.push(m.key); continue; }
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s₹]/g, ""));
    if (!Number.isFinite(n) || n < 0) { out.errors[m.key] = `${m.label}: enter a number, zero or more`; continue; }
    if (n === 0) { out.clear.push(m.key); continue; }
    if (m.unit === "count" && !Number.isInteger(n)) { out.errors[m.key] = `${m.label}: enter a whole number`; continue; }
    if (n > (m.unit === "inr" ? MAX_AMOUNT : MAX_COUNT)) { out.errors[m.key] = `${m.label}: that is too large`; continue; }
    out.set[m.key] = m.unit === "inr" ? Math.round(n * 100) / 100 : n;
  }
  return out;
}
