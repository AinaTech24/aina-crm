"use client";

/**
 * Stops the mouse wheel from changing a number field.
 *
 * Browsers step an <input type="number"> up or down when the wheel turns over
 * it while it has focus. Someone who typed an amount and then scrolled the
 * page with the pointer resting on the field silently changed it — a sum
 * assured of ₹1 Cr became −11 on the insurance form, and every amount field in
 * the CRM had the same trap.
 *
 * One listener for the whole app: when the wheel turns over the FOCUSED number
 * field, the field loses focus first, so the page scrolls and the value stays
 * exactly as typed. Typing and the arrow keys still work as before.
 */

import { useEffect } from "react";

export function NumberWheelGuard() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number" && e.target instanceof Node && el.contains(e.target)) {
        el.blur();
      }
    };
    // Capture + passive: runs before the browser applies the step, and never
    // blocks scrolling.
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
  }, []);
  return null;
}
