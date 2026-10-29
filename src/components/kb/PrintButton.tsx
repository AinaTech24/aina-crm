"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground print:hidden"
    >
      <Printer className="size-4" /> Print
    </button>
  );
}
