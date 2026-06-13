"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Accessible FAQ accordion with a smooth expand/shrink. The answer wrapper uses
 * the grid-rows 0fr→1fr trick so height animates fluidly (no fixed max-height
 * guesswork), and the chevron rotates in step.
 */
export function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {items.map((f, i) => {
        const isOpen = open === i;
        return (
          <div
            key={i}
            className={`glass-card rounded-xl border transition-colors ${
              isOpen ? "border-primary/30" : "border-border/40"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="w-full flex items-center justify-between gap-4 p-4 sm:p-5 text-left"
            >
              <span className="font-bold text-sm sm:text-base text-foreground">{f.q}</span>
              <ChevronDown
                className={`size-5 shrink-0 transition-transform duration-300 ${
                  isOpen ? "rotate-180 text-primary" : "text-muted-foreground"
                }`}
              />
            </button>
            <div
              className={`grid transition-all duration-300 ease-out ${
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <p className="px-4 sm:px-5 pb-4 sm:pb-5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  {f.a}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
