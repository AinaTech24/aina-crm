"use client";

import { useState } from "react";
import {
  Crown, Building2, UserRound, Wrench, Umbrella, HeartPulse, Check, type LucideIcon,
} from "lucide-react";

/**
 * The six role dashboards, one tab each — the same six the CRM's Dashboard
 * dropdown holds (lib/dashboards/system/definitions.ts). Copy describes what
 * each one really shows; the tiles are a sketch with sample figures, never a
 * claim about anyone's book.
 */

type Role = {
  key: string;
  icon: LucideIcon;
  name: string;
  forWhom: string;
  promise: string;
  shows: string[];
  tiles: { label: string; value: string; note: string; alarm?: boolean }[];
};

const ROLES: Role[] = [
  {
    key: "owner",
    icon: Crown,
    name: "Owner",
    forWhom: "Owner, compliance, marketing",
    promise: "The whole firm on one page — and what needs you today.",
    shows: [
      "AUM and SIP book as balances, business as money that actually moved",
      "New clients against your financial-year target",
      "Branches and team side by side, compliance gaps and expiries",
      "Brokerage, premium book, top clients and automation results",
    ],
    tiles: [
      { label: "AUM", value: "₹48.6 Cr", note: "Balance today" },
      { label: "Net business", value: "₹2.1 Cr", note: "Booked, this FY" },
      { label: "New clients", value: "42 / 60", note: "vs FY target" },
      { label: "Compliance gaps", value: "7", note: "Need action", alarm: true },
    ],
  },
  {
    key: "branch",
    icon: Building2,
    name: "Branch Head",
    forWhom: "Branch heads",
    promise: "Your branch, your RMs, your targets — locked to your branch.",
    shows: [
      "Every RM's book and business in one ledger that adds up to the branch",
      "Targets phased through the year, achieved / near / short",
      "SIP exceptions, open tasks, service requests and reviews due",
      "Click an RM to open their one-on-one view",
    ],
    tiles: [
      { label: "Branch AUM", value: "₹12.4 Cr", note: "Balance today" },
      { label: "Target", value: "68%", note: "FY to date" },
      { label: "SIP exceptions", value: "5", note: "This month", alarm: true },
      { label: "Reviews due", value: "18", note: "Next 7 days" },
    ],
  },
  {
    key: "rm",
    icon: UserRound,
    name: "Relationship Manager",
    forWhom: "RMs and team members",
    promise: "My day first: who to call, what is overdue, what I have achieved.",
    shows: [
      "Morning priorities and My Day — meetings, follow-ups, reviews",
      "Needs my attention: SIP rejections, queries, renewals",
      "My client book, leads, SIPs and targets",
      "Only my own clients — never another RM's book",
    ],
    tiles: [
      { label: "My AUM", value: "₹6.8 Cr", note: "Balance today" },
      { label: "Due today", value: "9", note: "Tasks & follow-ups" },
      { label: "Overdue", value: "2", note: "Act now", alarm: true },
      { label: "My SIP book", value: "₹4.6 L", note: "Per month" },
    ],
  },
  {
    key: "ops",
    icon: Wrench,
    name: "Operations",
    forWhom: "Operations, back office, service team",
    promise: "The queue, the SLAs and the rejections — oldest and riskiest first.",
    shows: [
      "Pending work by type, owner and age with escalation levels",
      "SLA breaches and items with no update",
      "Team load, so work is shared fairly",
      "RTA and exchange rejections, plus the compliance tab",
    ],
    tiles: [
      { label: "Open requests", value: "34", note: "In the queue" },
      { label: "SLA breached", value: "3", note: "Escalated", alarm: true },
      { label: "High value", value: "6", note: "Above threshold" },
      { label: "Rejections", value: "4", note: "From the RTA feed" },
    ],
  },
  {
    key: "insurance",
    icon: Umbrella,
    name: "Insurance Team",
    forWhom: "Insurance team",
    promise: "Premium, renewals and issuance — personal and commercial lines.",
    shows: [
      "New and renewal premium against insurance targets",
      "Renewals due and policies pending issuance",
      "Retention and lost business, dated from the record",
      "Team, pipeline, products and insurers",
    ],
    tiles: [
      { label: "Premium", value: "₹86 L", note: "This FY" },
      { label: "Renewals due", value: "21", note: "Next 30 days" },
      { label: "Pending issuance", value: "5", note: "Past SLA: 1", alarm: true },
      { label: "Retention", value: "91%", note: "Renewed on time" },
    ],
  },
  {
    key: "claims",
    icon: HeartPulse,
    name: "Claims",
    forWhom: "Insurance team (from the dropdown)",
    promise: "Every open claim, what it is waiting for, and what is going stale.",
    shows: [
      "Worklist of open claims with their next action",
      "High-value, stale and no-next-action claims",
      "Document checklist that follows the product",
      "Status breakdown, ageing, rejections and insurers",
    ],
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
    <div className="mt-12">
      {/* Segmented control — the same "this view or that" pill the CRM uses. */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div role="tablist" aria-label="Role dashboards" className="mx-auto flex w-max gap-1 rounded-2xl bg-secondary/70 p-1">
          {ROLES.map((r) => {
            const on = r.key === active;
            return (
              <button
                key={r.key}
                type="button"
                role="tab"
                id={`role-tab-${r.key}`}
                aria-selected={on}
                aria-controls={`role-panel-${r.key}`}
                onClick={() => setActive(r.key)}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                  on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <r.icon className="size-4" /> {r.name}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`role-panel-${role.key}`}
        aria-labelledby={`role-tab-${role.key}`}
        className="mt-8 grid gap-8 lg:grid-cols-2 lg:items-center"
      >
        <div>
          <span className="text-2xs font-bold uppercase tracking-widest text-primary">{role.name} Dashboard</span>
          <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground text-balance">{role.promise}</h3>
          <p className="mt-2 text-sm text-muted-foreground">Default for: {role.forWhom}</p>
          <ul className="mt-5 flex flex-col gap-2.5">
            {role.shows.map((s) => (
              <li key={s} className="flex items-start gap-2.5 text-sm text-foreground/85">
                <span className="mt-0.5 size-5 shrink-0 rounded-full bg-success/10 text-success grid place-items-center">
                  <Check className="size-3.5" />
                </span>
                {s}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg bg-secondary/70 px-2.5 py-1.5 text-xs font-bold text-foreground">
              <role.icon className="size-3.5 text-primary" /> {role.name} Dashboard ▾
            </span>
            <span className="text-2xs font-semibold text-muted-foreground">Sample data</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {role.tiles.map((t) => (
              <div
                key={t.label}
                className={`rounded-xl p-3 ${t.alarm ? "border border-destructive/30 bg-destructive/5" : "bg-secondary/70"}`}
              >
                <div className="text-2xs font-semibold text-muted-foreground">{t.label}</div>
                <div className={`mt-1 text-xl font-extrabold tabular-nums ${t.alarm ? "text-destructive" : "text-foreground"}`}>{t.value}</div>
                <div className="mt-0.5 text-2xs text-muted-foreground">{t.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
