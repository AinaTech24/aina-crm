/**
 * City and state from the pincode — for REGISTRAR imports only.
 *
 * The client forms used to fill city and state as the pincode was typed
 * (13 Oct 2026). The firm took that out the next day: a lookup answer
 * (India Post's district) replaced what the person had typed, and sometimes
 * wrote a district nobody calls the client's city. A person types the
 * address; this file only completes a REGISTRAR row that came with a pincode
 * and no city or state:
 *   - only a blank value (or a registrar's stand-in: "NA", "-", "NIL" …) is
 *     filled; anything written is kept as it is;
 *   - only an Indian address (country blank or India) with a valid 6-digit
 *     pincode;
 *   - an answer that is not a real place is ignored (lookupPincode);
 *   - at most `maxLookups` distinct pincodes per import (the rest fill on a
 *     later import — lookupPincode remembers what it has seen).
 */

import { lookupPincode } from "./lookup";

type Address = { line1?: string; city?: string; state?: string; pincode?: string; country?: string };

const STAND_IN = /^(N\.?A\.?|NIL|NULL|NONE|-+|\.+|0+|X+)$/i;
const blank = (v?: string | null) => !v || !v.trim() || STAND_IN.test(v.trim());
const indian = (country?: string | null) => blank(country) || /^(india|ind|in)$/i.test(String(country).trim());

/** Fill blank city / state in place. Returns how many addresses changed. */
export async function fillCityStateFromPincode(
  addresses: Array<Address | null | undefined>,
  opts: { maxLookups?: number; concurrency?: number } = {},
): Promise<number> {
  const max = opts.maxLookups ?? 400;
  const todo = addresses.filter((a): a is Address =>
    !!a && /^[1-9]\d{5}$/.test(String(a.pincode ?? "").trim()) && indian(a.country) && (blank(a.city) || blank(a.state)));
  if (!todo.length) return 0;

  const pins = [...new Set(todo.map((a) => String(a.pincode).trim()))].slice(0, max);
  const places = new Map<string, { city: string; state: string }>();
  const queue = [...pins];
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, queue.length) }, async () => {
    for (let pin = queue.shift(); pin; pin = queue.shift()) {
      const place = await lookupPincode(pin);
      if (place) places.set(pin, place);
    }
  }));

  let changed = 0;
  for (const a of todo) {
    const place = places.get(String(a.pincode).trim());
    if (!place) continue;
    let touched = false;
    if (blank(a.city)) { a.city = place.city; touched = true; }
    if (blank(a.state)) { a.state = place.state; touched = true; }
    if (touched) changed++;
  }
  return changed;
}
