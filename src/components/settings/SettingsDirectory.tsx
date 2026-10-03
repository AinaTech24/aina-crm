"use client";

/**
 * The Settings index: every settings page, in seven sections, with a search
 * box over titles, descriptions and the words people actually type ("logo",
 * "2FA", "invoice") — which is often not the page's title.
 *
 * Lives on the client because the search filters as you type, and because a
 * lucide icon is a function, which a server component cannot hand to a
 * client one.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, Gauge, Building2, Database, Users, CreditCard, MessageCircle, Mail, Webhook, ShieldCheck, Workflow,
  KeyRound, Palette, UserCircle, GitBranch, Target, Network, BellRing, ClipboardCheck, SlidersHorizontal, Search, X,
  MessageSquare, LayoutTemplate, Boxes,
} from "lucide-react";

type Group = "You" | "Workspace" | "Clients & onboarding" | "Automation" | "Team" | "Connections" | "Billing";

const GROUP_ORDER: Group[] = ["You", "Workspace", "Clients & onboarding", "Automation", "Team", "Connections", "Billing"];

type Section = { icon: typeof Activity; title: string; desc: string; href: string; group: Group; keywords?: string };

const SECTIONS: Section[] = [
  { icon: UserCircle, title: "My profile", desc: "Your details, change password, targets & leave entitlements.", href: "/dashboard/settings/profile", group: "You", keywords: "password signature photo phone" },
  { icon: KeyRound, title: "Two-factor authentication", desc: "Add a TOTP authenticator code on top of your password. Self-service for your own account.", href: "/dashboard/settings/security", group: "You", keywords: "2fa otp totp security login sessions devices" },

  { icon: Activity, title: "Product readiness", desc: "Live, demo, blocked and unavailable services — including launch-critical checks.", href: "/dashboard/settings/readiness", group: "Workspace", keywords: "status health go-live" },
  { icon: Building2, title: "Organisation profile", desc: "Branding, contact, AUM range, business profile.", href: "/dashboard/settings/organisation", group: "Workspace", keywords: "firm company arn address logo gst" },
  { icon: Palette, title: "Appearance & theme", desc: "Re-skin the CRM to your brand — colours, font & density, and your white-label URL.", href: "/dashboard/settings/appearance", group: "Workspace", keywords: "logo colour color brand theme white-label domain font" },

  { icon: SlidersHorizontal, title: "Custom fields", desc: "Add your own fields to leads & clients — text, number, date, dropdown and more.", href: "/dashboard/settings/custom-fields", group: "Clients & onboarding" },
  { icon: Database, title: "Dropdown options", desc: "Edit the choices your team picks from — lead sources, campaign types, service types and more.", href: "/dashboard/settings/masters", group: "Clients & onboarding", keywords: "masters picklist values lead source" },
  // Scheme Master and AMC Empanelments moved here from the sidebar (2026-10-01): master data that rarely changes.
  { icon: Boxes, title: "Scheme master", desc: "Every mutual fund scheme the CRM knows — codes, categories and plan options.", href: "/dashboard/schemes", group: "Clients & onboarding", keywords: "schemes funds amfi isin nav plan category master" },
  { icon: Building2, title: "AMC empanelments", desc: "The fund houses your firm is empanelled with, and their status.", href: "/dashboard/amc-empanelments", group: "Clients & onboarding", keywords: "amc fund house empanelment arn" },
  { icon: ShieldCheck, title: "Risk profile questionnaire", desc: "Customise questions, scoring, and risk-category bands for your firm.", href: "/dashboard/settings/risk-profile", group: "Clients & onboarding", keywords: "risk profiling suitability" },
  { icon: ClipboardCheck, title: "Onboarding form fields", desc: "Choose which client account-opening / KYC fields your team MUST fill — make any field mandatory or optional.", href: "/dashboard/settings/onboarding-fields", group: "Clients & onboarding", keywords: "kyc mandatory required account opening" },

  // Automations and Message Templates moved here from the sidebar (2026-10-01): set up by an admin, not worked from daily.
  { icon: Workflow, title: "Automations", desc: "Rules that send messages and create tasks on their own — with their actions and run history.", href: "/dashboard/automations", group: "Automation", keywords: "workflows rules triggers actions run history recipes" },
  { icon: LayoutTemplate, title: "Message templates", desc: "The WhatsApp, email and SMS templates your team and automations send.", href: "/dashboard/templates", group: "Automation", keywords: "whatsapp email sms template designer approval meta" },
  { icon: Workflow, title: "Stages & journeys", desc: "Edit the stages, deadlines, required fields and automations for leads, service requests, complaints, SIP recovery and reviews.", href: "/dashboard/settings/blueprints", group: "Automation", keywords: "blueprints pipeline workflow sla" },
  { icon: BellRing, title: "Notification templates", desc: "Edit the 18 lead-journey templates — welcome, referral, meeting, proposal, docs, portal.", href: "/dashboard/settings/notification-templates", group: "Automation", keywords: "email whatsapp sms messages" },
  { icon: Workflow, title: "Task templates", desc: "Design predefined tasks with sub-task checklists (SOPs) — your team applies them when creating a task.", href: "/dashboard/settings/task-templates", group: "Automation", keywords: "sop checklist" },
  { icon: GitBranch, title: "Auto-assignment rules", desc: "Route new leads & clients to your team automatically — round-robin or load-balanced.", href: "/dashboard/settings/assignment-rules", group: "Automation", keywords: "round robin routing allocate" },

  { icon: Users, title: "Team & roles", desc: "Invite team members, assign roles, manage seats.", href: "/dashboard/employees", group: "Team", keywords: "users employees invite permissions seats staff" },
  { icon: Network, title: "Teams within a branch", desc: "Group each branch into small teams (desks) and assign RMs — powers the monthly MIS roll-ups.", href: "/dashboard/settings/desks", group: "Team", keywords: "desks mis" },
  { icon: Gauge, title: "Dashboards", desc: "Which dashboard each role opens by default, and dashboards assigned to one person.", href: "/dashboard/settings/dashboards", group: "Team", keywords: "default home role assign" },
  { icon: Gauge, title: "Dashboard thresholds", desc: "Where the dashboards draw their lines — target bands, phasing, stale leads, proposal ageing and SLAs.", href: "/dashboard/settings/dashboard-thresholds", group: "Team", keywords: "sla bands" },
  { icon: Target, title: "Targets & quota", desc: "Set monthly business, new-meeting and renewal-meeting targets per team member — track vs achievement.", href: "/dashboard/settings/targets", group: "Team", keywords: "kra goals" },

  { icon: MessageCircle, title: "WhatsApp connection", desc: "Your Aina WhatsApp number and Meta template approvals.", href: "/dashboard/settings/whatsapp", group: "Connections", keywords: "aisensy meta templates" },
  { icon: Mail, title: "Email setup", desc: "Sending domain, DKIM, transactional + marketing streams.", href: "/dashboard/settings/email", group: "Connections", keywords: "smtp domain dkim mailbox sender" },
  // Moved here from the sidebar (2026-10-01): the message log is checked now and then, not worked from daily.
  { icon: MessageSquare, title: "Communications", desc: "Every WhatsApp, email and SMS sent and received, with delivery status — and Compose.", href: "/dashboard/communications", group: "Connections", keywords: "messages log outbox inbox delivered read failed compose whatsapp email sms cadence responses" },
  { icon: Webhook, title: "Integrations", desc: "BSE Star MF, CAMS / KFintech feeds, Razorpay, KYC providers.", href: "/dashboard/settings/integrations", group: "Connections", keywords: "api zoho bse nse cams kfintech kyc" },

  { icon: CreditCard, title: "Billing & subscription", desc: "Current plan, payment history, renewal.", href: "/dashboard/billing", group: "Billing", keywords: "plan invoice payment razorpay renew upgrade" },
];

export function SettingsDirectory({ hidden = [] }: {
  /** Pages this viewer cannot open (a card that moved here from the sidebar keeps its access rules). */
  hidden?: string[];
}) {
  const [q, setQ] = useState("");
  const sections = useMemo(() => SECTIONS.filter((s) => !hidden.includes(s.href)), [hidden]);

  // Every word must appear somewhere in the title, description, section or
  // keywords, so "email templates" finds Notification templates.
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return sections;
    return sections.filter((s) => {
      const hay = `${s.title} ${s.desc} ${s.group} ${s.keywords ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [q, sections]);

  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <label htmlFor="settings-search" className="sr-only">Search settings</label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id="settings-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
          placeholder="Search settings — e.g. logo, 2FA, WhatsApp, invoice"
          className="input-base w-full pl-9 pr-9"
          autoComplete="off"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} className="btn-icon absolute right-0.5 top-1/2 -translate-y-1/2" aria-label="Clear search">
            <X className="size-4" />
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No settings match “{q.trim()}”.{" "}
          <button type="button" onClick={() => setQ("")} className="font-medium text-foreground hover:underline">Clear search</button>
        </p>
      ) : (
        GROUP_ORDER.map((g) => {
          const cards = shown.filter((s) => s.group === g);
          if (cards.length === 0) return null;
          const headingId = `settings-${g.toLowerCase().replace(/[^a-z]+/g, "-")}`;
          return (
            <section key={g} aria-labelledby={headingId}>
              <h2 id={headingId} className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">{g}</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {cards.map((s) => {
                  const Icon = s.icon;
                  return (
                    // Name only (the firm asked for less text); the description is
                    // the hover title and still feeds the search above.
                    <Link
                      key={s.href}
                      href={s.href}
                      title={s.desc}
                      className="border rounded-lg p-4 bg-card hover:bg-accent/40 transition-colors flex items-center gap-3"
                    >
                      <Icon className="size-5 text-muted-foreground" />
                      <div className="flex-1 font-medium">{s.title}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
