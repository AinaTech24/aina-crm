"use client";

import { useState } from "react";
import { Crown, UserRound, Wrench, Check, type LucideIcon } from "lucide-react";

/**
 * "Less manual tracking. More meaningful work." — one tab per audience, each
 * with its promise and a sketch of what that person opens to in the CRM.
 * Figures are sample data, labelled as such.
 */

type Audience = {
  key: string;
  icon: LucideIcon;
  name: string;
  body: string;
  board: string;
  tiles: { label: string; value: string; note: string; alarm?: boolean }[];
};

const AUDIENCES: Audience[] = [
  {
    key: "owner", icon: Crown, name: "For Business Owners",
    body: "Gain better visibility into your team, client servicing, business activities, and pending responsibilities.",
    board: "Owner Dashboard",
    tiles: [
      { label: "AUM", value: "₹48.6 Cr", note: "Balance today" },
      { label: "Net business", value: "₹2.1 Cr", note: "This financial year" },
      { label: "Team tasks open", value: "38", note: "Across 6 people" },
      { label: "Overdue", value: "4", note: "Need attention", alarm: true },
    ],
  },
  {
    key: "rm", icon: UserRound, name: "For Relationship Managers",
    body: "Stay organised with leads, meetings, client follow-ups, and everyday priorities.",
    board: "My Day",
    tiles: [
      { label: "Meetings today", value: "3", note: "Next at 11:30" },
      { label: "Follow-ups due", value: "9", note: "Leads & clients" },
      { label: "Reviews this week", value: "6", note: "Client reviews" },
      { label: "Overdue", value: "2", note: "Act now", alarm: true },
    ],
  },
  {
    key: "ops", icon: Wrench, name: "For Operations Teams",
    body: "Manage recurring activities and responsibilities through structured processes instead of scattered instructions.",
    board: "Operations Queue",
    tiles: [
      { label: "Open requests", value: "34", note: "In the queue" },
      { label: "Due today", value: "11", note: "Assigned work" },
      { label: "SIP exceptions", value: "5", note: "To follow up" },
      { label: "Past SLA", value: "3", note: "Escalated", alarm: true },
    ],
  },
];

export function RoleDashboards() {
  const [active, setActive] = useState(AUDIENCES[0].key);
  const a = AUDIENCES.find((r) => r.key === active) ?? AUDIENCES[0];

  return (
    <div className="mt-14 grid gap-10 lg:grid-cols-12 lg:items-center">
      <div role="tablist" aria-label="Who it helps" className="lg:col-span-5 flex flex-col gap-3">
        {AUDIENCES.map((r) => {
          const on = r.key === active;
          return (
            <button
              key={r.key}
              type="button"
              role="tab"
              id={`aud-tab-${r.key}`}
              aria-selected={on}
              aria-controls="aud-panel"
              onClick={() => setActive(r.key)}
              className={`text-left rounded-3xl p-5 sm:p-6 transition ${
                on ? "bg-white text-site-ink shadow-xl" : "bg-white/5 text-white ring-1 ring-white/10 hover:bg-white/10"
              }`}
            >
              <span className="flex items-center gap-3">
                <span className={`size-10 shrink-0 rounded-2xl grid place-items-center ${on ? "bg-site-crimson text-white" : "bg-white/10 text-white"}`}>
                  <r.icon className="size-5" />
                </span>
                <span className="font-brand text-xl sm:text-2xl">{r.name}</span>
              </span>
              <span className={`mt-3 block text-sm sm:text-base leading-relaxed ${on ? "text-site-muted" : "text-white/60"}`}>{r.body}</span>
            </button>
          );
        })}
      </div>

      <div id="aud-panel" role="tabpanel" aria-labelledby={`aud-tab-${a.key}`} className="lg:col-span-7">
        <div className="rounded-3xl bg-site-paper p-4 sm:p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-site-cream px-3 py-1.5 text-xs font-bold text-site-text">
              <a.icon className="size-3.5 text-site-crimson" /> {a.board}
            </span>
            <span className="text-2xs font-semibold text-site-muted">Sample data</span>
          </div>
          <div key={a.key} className="mt-4 grid grid-cols-2 gap-3 animate-fade-in">
            {a.tiles.map((t) => (
              <div key={t.label} className={`rounded-2xl p-4 ${t.alarm ? "bg-site-crimson/5 ring-1 ring-site-crimson/30" : "bg-site-cream"}`}>
                <div className="text-2xs font-semibold text-site-muted">{t.label}</div>
                <div className={`mt-1 text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight ${t.alarm ? "text-site-crimson" : "text-site-text"}`}>
                  {t.value}
                </div>
                <div className="mt-0.5 text-2xs text-site-muted">{t.note}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-site-mint/10 px-4 py-3 text-sm font-semibold text-site-mint">
            <Check className="size-4 shrink-0" /> Everyone sees what is done — and what is still pending.
          </div>
        </div>
      </div>
    </div>
  );
}
