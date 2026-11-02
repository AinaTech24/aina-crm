"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Print, or "Save as PDF" in the print dialog, to send the summary. */
export function PrintButton() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      <Printer className="size-4" /> Print or save as PDF
    </Button>
  );
}
