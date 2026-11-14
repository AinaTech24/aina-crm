"use client";

/** The one line under an address block after a pincode lookup (usePincodeAutofill). */

import { Button } from "@/components/ui/Button";
import type { PincodeStatus } from "@/components/investors/usePincodeAutofill";

export function PincodeHint({ status, suggestState, onUseState }: {
  status: PincodeStatus;
  suggestState: string | null;
  onUseState: () => void;
}) {
  if (!status) return null;
  return (
    <p aria-live="polite" className={`flex flex-wrap items-center gap-2 text-xs ${status.tone === "warn" ? "text-warning-foreground" : "text-muted-foreground"}`}>
      <span>{status.text}</span>
      {suggestState && (
        <Button type="button" variant="ghost" size="sm" onClick={onUseState}>Use {suggestState}</Button>
      )}
    </p>
  );
}
