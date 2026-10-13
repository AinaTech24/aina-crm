"use client";

/**
 * Fill city and state when a full pincode is typed. Calls `onFound` once per
 * new 6-digit pincode; the person can still edit both afterwards.
 */
import { useEffect, useRef } from "react";

export function usePincodeAutofill(pincode: string, onFound: (place: { city: string; state: string }) => void) {
  const last = useRef<string>(pincode);
  const cb = useRef(onFound);
  cb.current = onFound;
  useEffect(() => {
    const pin = pincode.replace(/\D/g, "");
    if (pin.length !== 6 || pin === last.current) return;
    last.current = pin;
    const ctrl = new AbortController();
    fetch(`/api/pincode/${pin}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p?.city && p?.state) cb.current(p); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [pincode]);
}
