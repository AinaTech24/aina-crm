/**
 * What a client form does with a pincode lookup (2026-11-14, the owner's
 * request — it replaces the 2026-10-14 rule that the forms never fill from a
 * pincode). That rule came from a form that OVERWROTE typed cities with India
 * Post district names, so this only ever fills what is BLANK:
 *
 *  - city    blank → the pincode's district; typed → kept
 *  - state   blank → the pincode's state;    typed and different → kept, with
 *            a hint the user can accept ("Pincode 380015 is in Gujarat — use it")
 *  - country blank → India; anything else typed → no lookup at all
 *
 * Pure, so the forms and the tests share one decision.
 */

import { canonicalState, isIndianAddress } from "@/lib/geo/places";

export type PincodeAddress = { city: string; state: string; country: string };
export type PincodePlace = { city: string; state: string };

/** A complete Indian pincode worth looking up for this address. */
export function shouldLookUpPincode(pincode: string, country: string): boolean {
  return /^[1-9]\d{5}$/.test(pincode.trim()) && isIndianAddress(country);
}

export type PincodeFill = {
  /** Fields to set — only ones that were blank. */
  set: Partial<PincodeAddress>;
  /** The typed state disagrees with the pincode's: offer this one. */
  stateMismatch: string | null;
};

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
