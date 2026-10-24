"use client";

import { useState } from "react";
import { Crown, Building2, UserRound, Wrench, Umbrella, HeartPulse, type LucideIcon } from "lucide-react";

/**
 * The six role dashboards — the same six the CRM's Dashboard dropdown holds
 * (lib/dashboards/system/definitions.ts). One line of promise per role and a
 * sketch of its headline tiles, with sample figures labelled as such.
 */

type Role = {
  key: string;
  icon: LucideIcon;
  name: string;
  promise: string;
  tiles: { label: string; value: string; note: string; alarm?: boolean }[];
};

const ROLES: Role[] = [
  {
    key: "owner", icon: Crown, name: "Owner",
    promise: "The whole firm on one page — and what needs you today.",
    tiles: [
      { label: "AUM", value: "₹48.6 Cr", note: "Balance today" },
      { label: "Net business", value: "₹2.1 Cr", note: "Booked · this FY" },
      { label: "New clients", value: "42 / 60", note: "vs FY target" },
      { label: "Compliance gaps", value: "7", note: "Need action", alarm: true },
    ],
  },
  {
    key: "branch", icon: Building2, name: "Branch Head",
    promise: "Your branch, your RMs, your targets. Nothing more, nothing less.",
    tiles: [
      { label: "Branch AUM", value: "₹12.4 Cr", note: "Balance today" },
      { label: "Target", value: "68%", note: "FY to date" },
      { label: "SIP exceptions", value: "5", note: "This month", alarm: true },
      { label: "Reviews due", value: "18", note: "Next 7 days" },
    ],
  },
  {
    key: "rm", icon: UserRound, name: "RM",
    promise: "My day first: who to call, what's overdue, how close I am to target.",
    tiles: [
      { label: "My AUM", value: "₹6.8 Cr", note: "Balance today" },
      { label: "Due today", value: "9", note: "Tasks & follow-ups" },
      { label: "Overdue", value: "2", note: "Act now", alarm: true },
      { label: "My SIP book", value: "₹4.6 L", note: "Per month" },
    ],
  },
  {
    key: "ops", icon: Wrench, name: "Operations",
    promise: "The queue, the SLAs and the rejections — oldest and riskiest first.",
    tiles: [
      { label: "Open requests", value: "34", note: "In the queue" },
      { label: "SLA breached", value: "3", note: "Escalated", alarm: true },
      { label: "High value", value: "6", note: "Above threshold" },
      { label: "Rejections", value: "4", note: "From the RTA feed" },
    ],
  },
  {
    key: "insurance", icon: Umbrella, name: "Insurance",
    promise: "Premium, renewals and issuance across personal and commercial lines.",
    tiles: [
      { label: "Premium", value: "₹86 L", note: "This FY" },
      { label: "Renewals due", value: "21", note: "Next 30 days" },
      { label: "Pending issuance", value: "5", note: "1 past SLA", alarm: true },
      { label: "Retention", value: "91%", note: "Renewed on time" },
    ],
  },
  {
    key: "claims", icon: HeartPulse, name: "Claims",
    promise: "Every open claim, what it's waiting for, and what's going stale.",
    tiles: [
      { label: "Open claims", value: "17", note: "Live queue" },
      { label: "No next action", value: "2", note: "Needs an owner", alarm: true },
      { label: "Docs pending", value: "6", note: "From client" },
      { label: "Settled", value: "₹14 L", note: "This quarter" },
    ],
  },
];

export function RoleDashboards() {
  const [active, setActive] = useState(ROLES[0].key);
  const role = ROLES.find((r) => r.key === active) ?? ROLES[0];

  return (
    <div className="mt-12 grid gap-10 lg:grid-cols-12 lg:items-center">
      <div className="lg:col-span-5">
        <div role="tablist" aria-label="Role dashboards" className="flex flex-wrap gap-2">
          {ROLES.map((r) => {
            const on = r.key === active;
            return (
              <button
                key={r.key}
                type="button"
                role="tab"
                id={`role-tab-${r.key}`}
                aria-selected={on}
                aria-controls="role-panel"
                onClick={() => setActive(r.key)}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  on ? "bg-white text-site-ink shadow" : "bg-white/10 text-white/75 hover:bg-white/15 hover:text-white"
                }`}
              >
                <r.icon className="size-4" /> {r.name}
              </button>
            );
          })}
        </div>
        <p key={role.key} className="mt-8 font-brand text-3xl sm:text-4xl leading-tight text-white text-balance animate-fade-in">
          {role.promise}
        </p>
      </div>

      <div id="role-panel" role="tabpanel" aria-labelledby={`role-tab-${role.key}`} className="lg:col-span-7">
        <div className="rounded-3xl bg-site-paper p-4 sm:p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-site-cream px-3 py-1.5 text-xs font-bold text-site-text">
              <role.icon className="size-3.5 text-site-crimson" /> {role.name} Dashboard
            </span>
            <span className="text-2xs font-semibold text-site-muted">Sample data</span>
          </div>
          <div key={role.key} className="mt-4 grid grid-cols-2 gap-3 animate-fade-in">
            {role.tiles.map((t) => (
              <div
                key={t.label}
                className={`rounded-2xl p-4 ${t.alarm ? "bg-site-crimson/5 ring-1 ring-site-crimson/30" : "bg-site-cream"}`}
              >
                <div className="text-2xs font-semibold text-site-muted">{t.label}</div>
                <div className={`mt-1 text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight ${t.alarm ? "text-site-crimson" : "text-site-text"}`}>
                  {t.value}
                </div>
                <div className="mt-0.5 text-2xs text-site-muted">{t.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
