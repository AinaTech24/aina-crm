/**
 * Pincode → city / state / country, filling BLANKS only (the CRM's rule of
 * 2026-11-14, commit 362bf262; it replaced "the forms never fill from the
 * pincode", which followed a form that OVERWROTE typed cities with India Post
 * districts). The decision is a port of the CRM's src/lib/pincode/autofill.ts:
 *
 *  - city    blank → the pincode's district; typed → kept
 *  - state   blank → the pincode's state;    typed and different → kept, with
 *            a "Use <state>" offer
 *  - country blank → India; anything else typed → no lookup at all
 *
 * The lookup is GET /api/pincode/[pin] (India Post, any signed-in user, no
 * client data). The form engine's `derive` is synchronous, so the answer is
 * kept in a small module cache: a complete pincode starts the lookup, and the
 * fill is applied as soon as the answer is in hand — on the next change to the
 * form, and at the latest when the form is saved. Nothing typed is ever
 * replaced.
 */

import { api } from "../../api/client";
import { canonicalState, isIndianAddress } from "./places";

export type PincodeAddress = { city: string; state: string; country: string };
export type PincodePlace = { city: string; state: string };

/** A complete Indian pincode worth looking up for this address. */
export function shouldLookUpPincode(pincode: string, country: string): boolean {
  return /^[1-9]\d{5}$/.test((pincode ?? "").trim()) && isIndianAddress(country);
}

export type PincodeFill = {
  /** Fields to set — only ones that were blank. */
  set: Partial<PincodeAddress>;
  /** The typed state disagrees with the pincode's: offer this one. */
  stateMismatch: string | null;
};

/** The CRM's pincodeFill (lib/pincode/autofill.ts), unchanged. */
export function pincodeFill(current: PincodeAddress, place: PincodePlace): PincodeFill {
  const set: Partial<PincodeAddress> = {};
  if (!current.city.trim() && place.city) set.city = place.city;
  const typedState = canonicalState(current.state) ?? current.state.trim();
  const placeState = canonicalState(place.state) ?? place.state;
  if (!typedState && placeState) set.state = placeState;
  if (!current.country.trim()) set.country = "India";
  const stateMismatch = typedState && placeState && typedState.toLowerCase() !== placeState.toLowerCase() ? placeState : null;
  return { set, stateMismatch };
}

// ── The lookup, cached per pincode for the app's lifetime ────────────────────

type Entry = { status: "loading" } | { status: "found"; place: PincodePlace } | { status: "unknown" };
const cache = new Map<string, Entry>();

/** What is known about this pincode right now (starts the lookup if nothing is). */
export function pincodeLookup(pin: string): Entry | null {
  const p = (pin ?? "").trim();
  if (!/^[1-9]\d{5}$/.test(p)) return null;
  const hit = cache.get(p);
  if (hit) return hit;
  cache.set(p, { status: "loading" });
  api.get<{ city?: string; state?: string }>(`/api/pincode/${p}`)
    .then((r) => cache.set(p, r?.city || r?.state ? { status: "found", place: { city: r.city ?? "", state: r.state ?? "" } } : { status: "unknown" }))
    // 404 = unknown pincode; a network failure is forgotten so a retry can ask again.
    .catch((e: any) => { if (e?.status === 404 || e?.status === 400) cache.set(p, { status: "unknown" }); else cache.delete(p); });
  return cache.get(p)!;
}

/** The fill for this address, or null while the answer is not in. */
export function pincodeFillFor(addr: PincodeAddress & { pincode: string }): (PincodeFill & { place: PincodePlace }) | null {
  if (!shouldLookUpPincode(addr.pincode, addr.country)) return null;
  const e = pincodeLookup(addr.pincode);
  if (!e || e.status !== "found") return null;
  return { ...pincodeFill(addr, e.place), place: e.place };
}

/** The one line under the pincode (the web's PincodeHint), from the cache. */
export function pincodeHint(addr: PincodeAddress & { pincode: string }): string {
  if (!shouldLookUpPincode(addr.pincode, addr.country)) return "";
  const e = cache.get(addr.pincode.trim());
  // Nothing while the answer is on its way: the form re-renders on a change,
  // not when a lookup lands, so a "Looking up…" line could outlive the lookup.
  if (!e || e.status === "loading") return "";
  if (e.status === "unknown") return "Pincode not found — enter the city and state.";
  const { stateMismatch } = pincodeFill(addr, e.place);
  return stateMismatch
    ? `Pincode ${addr.pincode.trim()} is in ${stateMismatch}.`
    : `Pincode ${addr.pincode.trim()}: ${e.place.city}, ${canonicalState(e.place.state) ?? e.place.state}.`;
}

/** Test seam: forget every answer. */
export function clearPincodeCache() {
  cache.clear();
}
