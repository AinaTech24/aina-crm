"use client";

import { useState } from "react";
import { X, Check, CalendarClock, Repeat, FileSpreadsheet, ShieldCheck } from "lucide-react";

/**
 * "Without Aina / With Aina" — one switch flips four everyday moments. Starts
 * on "without" so the visitor makes the change themselves.
 */

const MOMENTS = [
  {
    icon: CalendarClock,
    moment: "“Call me after Diwali”",
    without: "Lives in one RM's memory. Usually forgotten.",
    with: "Parked with a date. The reminder arrives a week before.",
  },
  {
    icon: Repeat,
    moment: "A SIP bounces",
    without: "Spotted weeks later in a statement.",
    with: "Flagged from the RTA feed with a follow-up on the client.",
  },
  {
    icon: FileSpreadsheet,
    moment: "Month-end numbers",
    without: "Five RMs, five spreadsheets, five totals.",
    with: "One figure — booked, and checked against CAMS & KFintech.",
  },
  {
    icon: ShieldCheck,
    moment: "The DDQ audit",
    without: "A week of digging through inboxes.",
    with: "Consent, checks and the audit trail — already on record.",
  },
];

export function BeforeAfter() {
  const [on, setOn] = useState(false);

  return (
    <div className="mt-10">
      <div className="flex justify-center">
        <div role="group" aria-label="Compare" className="inline-flex rounded-full bg-site-sand/70 p-1">
          <button
            type="button"
            aria-pressed={!on}
            onClick={() => setOn(false)}
            className={`rounded-full px-5 py-2.5 text-sm font-bold transition ${!on ? "bg-site-paper text-site-text shadow" : "text-site-muted hover:text-site-text"}`}
          >
            Without Aina
          </button>
          <button
            type="button"
            aria-pressed={on}
            onClick={() => setOn(true)}
            className={`relative rounded-full px-5 py-2.5 text-sm font-bold transition ${on ? "bg-site-crimson text-white shadow" : "text-site-crimson hover:bg-site-paper/60"}`}
          >
            With Aina
            {!on && (
              <span aria-hidden className="absolute -right-1 -top-1 flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-site-crimson opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-3 rounded-full bg-site-crimson" />
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {MOMENTS.map((m) => (
          <article
            key={m.moment}
            className={`rounded-3xl p-6 sm:p-7 transition-colors duration-500 ${
              on ? "bg-site-ink text-white" : "bg-site-paper text-site-text ring-1 ring-site-sand"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`size-10 rounded-2xl grid place-items-center transition-colors duration-500 ${on ? "bg-white/10" : "bg-site-cream"}`}>
                <m.icon className={`size-5 ${on ? "text-site-mint-soft" : "text-site-muted"}`} />
              </span>
              <h3 className="font-brand text-xl sm:text-2xl">{m.moment}</h3>
            </div>
            <p key={String(on)} className="mt-4 flex items-start gap-2.5 text-base leading-relaxed animate-fade-in">
              {on ? (
                <Check className="size-5 mt-0.5 shrink-0 text-site-mint-soft" />
              ) : (
                <X className="size-5 mt-0.5 shrink-0 text-site-crimson" />
              )}
              <span className={on ? "text-white/90" : "text-site-muted"}>{on ? m.with : m.without}</span>
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
