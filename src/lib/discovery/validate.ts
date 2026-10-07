/**
 * The shape a fact-find may be saved in.
 *
 * The RM's save and the client's link both used to store whatever JSON
 * arrived — any keys, any depth, any size. Now only the form's own sections
 * are kept, each a plain object or a list of plain rows, with values that are
 * short strings, numbers or booleans. Anything else is dropped, not stored.
 *
 * FORMAT is not enforced here (a draft may hold a half-typed PAN); the form
 * shows those errors. This guards STRUCTURE and SIZE only.
 *
 * Fields the server owns — the risk profile on record, what was prefilled, the
 * firm's SIP figure, the retired advisor assessment — are never taken from a
 * request: callers keep the stored values (see keepServerFields).
 */

import type { DiscoveryData } from "./calc";

const MAX_ROWS = 40;
const MAX_FIELDS = 40;
const MAX_STR = 500;
const MAX_BYTES = 200_000;

/** Sections a request may write. */
const OBJECT_SECTIONS = ["identification", "expenses", "surplusInputs", "riskProfile"] as const;
const LIST_SECTIONS = ["income", "assets", "liabilities", "lifeInsurance", "healthInsurance", "goals"] as const;
export const CLIENT_SECTIONS = [...OBJECT_SECTIONS, ...LIST_SECTIONS] as const;

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;

function cleanValue(v: unknown): string | number | boolean | null | undefined {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.slice(0, MAX_STR);
  return undefined; // objects / arrays inside a field are not part of the form
}

function cleanObject(o: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  let n = 0;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (!KEY.test(k) || n >= MAX_FIELDS) continue;
    const c = cleanValue(v);
    if (c === undefined) continue;
    out[k] = c;
    n++;
  }
  return out;
}

function cleanList(a: unknown): Array<Record<string, string | number | boolean | null>> | undefined {
  if (!Array.isArray(a)) return undefined;
  return a.slice(0, MAX_ROWS).map(cleanObject).filter((r): r is Record<string, string | number | boolean | null> => !!r);
}

/** Thrown when a request body is too large to be a fact-find. */
export class DiscoveryTooLarge extends Error {
  status = 413;
  constructor() {
    super("This fact-find is too large to save.");
  }
}

/**
 * The client-editable sections of `input`, cleaned. Sections not present in
 * `input` are absent from the result, so a partial update leaves the rest.
 */
export function cleanSections(input: unknown): Partial<DiscoveryData> {
  if (!input || typeof input !== "object") return {};
  if (JSON.stringify(input).length > MAX_BYTES) throw new DiscoveryTooLarge();
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of OBJECT_SECTIONS) {
    if (src[k] === undefined) continue;
    const c = cleanObject(src[k]);
    if (c) out[k] = c;
  }
  for (const k of LIST_SECTIONS) {
    if (src[k] === undefined) continue;
    const c = cleanList(src[k]);
    if (c) out[k] = c;
  }
  return out as Partial<DiscoveryData>;
}

/** `next` with every server-owned field taken from what is stored. */
export function keepServerFields(stored: DiscoveryData | null | undefined, next: Partial<DiscoveryData>): DiscoveryData {
  const s = (stored ?? {}) as DiscoveryData;
  return {
    ...s,
    ...next,
    recordedRisk: s.recordedRisk,
    prefilledFromRecord: s.prefilledFromRecord,
    existingSipMonthly: s.existingSipMonthly,
    assessment: s.assessment,
    recommendations: s.recommendations,
  };
}
