"use client";

/**
 * The new landing page's floating pill navbar, for the Knowledge Base pages.
 * Same links and look as public/landing/index.html; "Knowledge Base" is the current page.
 * Every link leaves with a plain <a> (a full page load), so the landing styles can never
 * stay behind when the visitor moves on to the static landing page or the app.
 */

import { useState } from "react";

const DEMO =
  "https://wa.me/918200770942?text=Hi%2C%20I'd%20like%20a%20demo%20of%20Aina%20CRM%20for%20my%20MFD%20practice.";

const LINKS: [string, string][] = [
  ["Features", "/#features"],
  ["Why AINA", "/#why"],
  ["Solutions", "/#solutions"],
  ["Blog", "/#blog"],
  ["Knowledge Base", "/knowledge-base"],
  ["FAQ", "/#faq"],
  ["Contact", "/#contact"],
];

export function KbNav() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="top" aria-label="Main">
      <div className="nav-in">
        <a className="pill-box" href="/" aria-label="AINA CRM home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing/images/logo.png" alt="Aina — Automation, Innovation, Navigation, Analytics" />
        </a>
        <div className={`links${open ? " open" : ""}`} id="kbNavLinks">
          {LINKS.map(([label, href]) => (
            <a key={label} href={href} className={href === "/knowledge-base" ? "cur" : undefined}>
              {label}
            </a>
          ))}
        </div>
        <div className="nav-end">
          <a className="nav-login" href="/login">Log in</a>
          <a className="btn p nav-cta" href={DEMO} target="_blank" rel="noopener noreferrer">Book a Demo →</a>
          <button
            className="nav-burger"
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="kbNavLinks"
            onClick={() => setOpen((o) => !o)}
          >
            <i /><i /><i />
          </button>
        </div>
      </div>
    </nav>
  );
}
