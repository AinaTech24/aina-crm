"use client";

import { useEffect, useState } from "react";
import {
  Repeat, Cake, FileUp, ShieldCheck, Landmark, BadgeCheck, MessageSquareWarning, ClipboardCheck,
  ArrowRight, type LucideIcon,
} from "lucide-react";

/**
 * The hero's moving picture: things that happen in an MFD practice, and what
 * the CRM does about each one — the automation spine (event → action) made
 * visible. Names are illustrative. A new event slides in every few seconds;
 * hovering pauses it, and with reduced motion it is a still list.
 */

type Item = { icon: LucideIcon; event: string; who: string; action: string; tone: "mint" | "rose" | "gold" };

const FEED: Item[] = [
  { icon: Repeat, event: "SIP bounced", who: "Riya Shah · ₹10,000", action: "RM task + WhatsApp sent", tone: "rose" },
  { icon: FileUp, event: "CAMS feed imported", who: "214 transactions", action: "Matched to the right clients", tone: "mint" },
  { icon: ClipboardCheck, event: "Risk profile due", who: "Patel family", action: "Link sent · client confirms by OTP", tone: "gold" },
  { icon: Cake, event: "Birthday tomorrow", who: "Arjun Mehta", action: "Wishes scheduled for 9:00", tone: "mint" },
  { icon: ShieldCheck, event: "Message drafted", who: "Diwali campaign", action: "Compliance · 11 of 11 passed", tone: "mint" },
  { icon: Landmark, event: "FD matures in 15 days", who: "₹5,00,000 · SBI", action: "Reminder task to the RM", tone: "gold" },
  { icon: BadgeCheck, event: "Proposal approved", who: "Neha Iyer · new SIP", action: "Journey moves to KYC", tone: "mint" },
  { icon: MessageSquareWarning, event: "Complaint from website", who: "Ticket SR-2026-00412", action: "Routed to compliance · 21-day SLA", tone: "rose" },
];

const VISIBLE = 4;
const STEP_MS = 2800;

const TONE: Record<Item["tone"], string> = {
  mint: "bg-site-mint/15 text-site-mint-soft",
  rose: "bg-site-rose/15 text-site-rose",
  gold: "bg-site-gold/20 text-amber-200",
};

export function LivePractice() {
  const [head, setHead] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(mq.matches);
    const on = () => setStill(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    if (paused || still) return;
    const id = setInterval(() => setHead((h) => h + 1), STEP_MS);
    return () => clearInterval(id);
  }, [paused, still]);

  // Newest first: the item at `head` is on top, the older ones slide down.
  const rows = Array.from({ length: VISIBLE }, (_, i) => {
    const n = head - i;
    return { n, item: FEED[((n % FEED.length) + FEED.length) % FEED.length] };
  });

  return (
    <div
      className="relative w-full max-w-lg rounded-3xl bg-site-ink p-5 sm:p-6 text-white shadow-2xl ring-1 ring-white/10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-site-crimson/30 blur-3xl" />
      <div className="relative flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-2xs font-bold uppercase tracking-widest text-white/60">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-site-mint-soft opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-2 rounded-full bg-site-mint-soft" />
          </span>
          Right now in your practice
        </span>
        <span className="text-2xs text-white/40">Illustration</span>
      </div>

      <ul className="relative mt-5 flex flex-col gap-2.5" aria-live="off">
        {rows.map(({ n, item }, i) => (
          <li
            key={n}
            className={`rounded-2xl bg-white/5 ring-1 ring-white/10 p-3 sm:p-3.5 transition-opacity duration-500 ${
              i === 0 && !still ? "animate-feed-in" : ""
            } ${i === VISIBLE - 1 ? "opacity-40" : ""}`}
          >
            <div className="flex items-center gap-3">
              <span className="size-9 shrink-0 rounded-xl bg-white/10 grid place-items-center">
                <item.icon className="size-4 text-white/85" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold leading-tight">{item.event}</div>
                <div className="text-2xs text-white/50 truncate">{item.who}</div>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-2 pl-12">
              <ArrowRight className="size-3.5 shrink-0 text-white/35" />
              <span className={`rounded-full px-2.5 py-1 text-2xs font-semibold ${TONE[item.tone]}`}>{item.action}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
