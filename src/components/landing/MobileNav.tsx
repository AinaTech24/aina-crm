"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";

const LINKS: [string, string][] = [
  ["Features", "#features"],
  ["Calculators", "#calculators"],
  ["How It Works", "#how-it-works"],
  ["Pricing", "#pricing"],
  ["FAQ", "#faq"],
];

/**
 * Mobile hamburger menu for the landing nav — the desktop link row is hidden
 * below md, so without this phones get no in-page navigation. Closes on link tap.
 */
export function MobileNav({ communityUrl }: { communityUrl: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-9 place-items-center rounded-lg hover:bg-secondary text-foreground/80"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 top-16 z-40 bg-black/30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 right-0 top-16 z-50 border-b border-border/60 shadow-lg"
            style={{ backgroundColor: "hsl(var(--background))" }}
          >
            <nav className="max-w-7xl mx-auto px-6 py-4 flex flex-col">
              {LINKS.map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="py-3 text-sm font-semibold text-foreground/80 hover:text-primary border-b border-border/30 last:border-0"
                >
                  {label}
                </a>
              ))}
              <div className="flex flex-col gap-2.5 pt-4">
                <Link href="/login" onClick={() => setOpen(false)} className="btn-secondary justify-center text-sm">
                  Log in
                </Link>
                <a
                  href={communityUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="btn-primary justify-center text-sm"
                >
                  Join Community <ArrowRight className="size-4" />
                </a>
              </div>
            </nav>
          </div>
        </>
      )}
    </div>
  );
}
