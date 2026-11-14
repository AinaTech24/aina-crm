"use client";

/**
 * Address auto-fill from the pincode on the client forms. Looks the pincode up
 * when the user TYPES a complete one (never for the pincode already on file
 * when an edit form opens), then fills only blank city / state / country
 * (lib/pincode/autofill.ts). Returns a one-line status for under the field and,
 * when the typed state disagrees, the pincode's state to offer.
 */

import { useEffect, useRef, useState } from "react";
import { pincodeFill, shouldLookUpPincode, type PincodeAddress } from "@/lib/pincode/autofill";

export type PincodeStatus = { tone: "muted" | "warn"; text: string } | null;

export function usePincodeAutofill(
  addr: PincodeAddress & { pincode: string },
  apply: (set: Partial<PincodeAddress>) => void,
) {
  const [status, setStatus] = useState<PincodeStatus>(null);
  const [suggestState, setSuggestState] = useState<string | null>(null);
  const initial = useRef(addr.pincode);
  const latest = useRef(addr);
  latest.current = addr;

  useEffect(() => {
    const pin = addr.pincode.trim();
    setSuggestState(null);
    if (pin === initial.current) { setStatus(null); return; }
    initial.current = "";
    if (!shouldLookUpPincode(pin, addr.country)) { setStatus(null); return; }
    const ctrl = new AbortController();
    setStatus({ tone: "muted", text: "Looking up the pincode…" });
    fetch(`/api/pincode/${pin}`, { signal: ctrl.signal })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((place: { city: string; state: string } | null) => {
        if (ctrl.signal.aborted) return;
        if (!place) { setStatus({ tone: "warn", text: "Pincode not found — enter the city and state." }); return; }
        const { set, stateMismatch } = pincodeFill(latest.current, place);
        if (Object.keys(set).length) apply(set);
        setSuggestState(stateMismatch);
        const filled = [set.city && "city", set.state && "state"].filter(Boolean).join(" and ");
        setStatus(
          stateMismatch ? { tone: "warn", text: `Pincode ${pin} is in ${stateMismatch}.` }
          : filled ? { tone: "muted", text: `${filled[0].toUpperCase()}${filled.slice(1)} filled from the pincode (${place.city}, ${place.state}) — check it.` }
          : { tone: "muted", text: `Pincode ${pin}: ${place.city}, ${place.state}.` },
        );
      })
      .catch(() => { if (!ctrl.signal.aborted) setStatus(null); });
    return () => ctrl.abort();
    // Only a new pincode (or a country change to India) starts a lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr.pincode, addr.country]);

  function acceptState() {
    if (!suggestState) return;
    apply({ state: suggestState });
    setSuggestState(null);
    setStatus({ tone: "muted", text: `State set to ${suggestState}.` });
  }

  return { status, suggestState, acceptState };
}
