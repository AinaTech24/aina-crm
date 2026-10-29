"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";

/**
 * Mobile hamburger menu for the landing nav — the desktop link row is hidden
 * below lg, so without this phones get no in-page navigation. Closes on link tap.
 */
export function MobileNav({ links, demoUrl }: { links: [string, string][]; demoUrl: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-full hover:bg-site-sand/60 text-site-text"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 top-16 z-40 bg-black/30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 right-0 top-16 z-50 border-b border-site-sand bg-site-cream shadow-lg"
          >
            <nav className="max-w-7xl mx-auto px-6 py-4 flex flex-col">
              {links.map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="py-3 text-base font-semibold text-site-text hover:text-site-crimson border-b border-site-sand last:border-0"
                >
                  {label}
                </a>
              ))}
              <div className="flex flex-col gap-2.5 pt-4">
                <Link href="/login" onClick={() => setOpen(false)} className="rounded-full border border-site-sand bg-site-paper py-3 text-center text-sm font-bold text-site-text">
                  Log in
                </Link>
                <a
                  href={demoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-site-crimson py-3 text-sm font-bold text-white"
                >
                  Book a demo <ArrowRight className="size-4" />
                </a>
              </div>
            </nav>
          </div>
        </>
      )}
    </div>
  );
}
