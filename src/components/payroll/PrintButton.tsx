"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Print the page, or "Save as PDF" in the print dialog. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer className="size-4" /> {label}
    </Button>
  );
}
