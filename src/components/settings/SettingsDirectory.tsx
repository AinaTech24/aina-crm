"use client";

/**
 * The Settings index: every settings page, in eight panels, with a search box
 * over titles, descriptions and the words people actually type ("logo",
 * "2FA", "invoice") — which is often not the page's title.
 *
 * Arranged 2026-10-07 at the firm's request: compact panels (one per area, a
 * row per page) instead of a full-width card per page, and the duplicates out —
 * "Notification templates" is a checklist of the same templates Message
 * templates manages, and "Product readiness" is a platform status page, not a
 * firm setting. Both pages still open at their addresses.
 *
 * Lives on the client because the search filters as you type, and because a
 * lucide icon is a function, which a server component cannot hand to a
 * client one.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BellRing,
  Building2, Database, Users, CreditCard, MessageCircle, Mail, Webhook, ShieldCheck, KeyRound, Palette, UserCircle,
  Target, Network, ClipboardCheck, SlidersHorizontal, Search, X, LayoutTemplate, Boxes, Landmark, Zap, Route,
  ListChecks, Shuffle, MessagesSquare, LayoutDashboard, Gauge, ChevronRight, type LucideIcon,
} from "lucide-react";

type Group =
  | "Your account"
  | "Firm"
  | "Team"
  | "Clients & data"
  | "Automation"
  | "Messaging"
  | "Connections"
  | "Dashboards";

const GROUP_ORDER: Group[] = ["Your account", "Firm", "Team", "Clients & data", "Automation", "Messaging", "Connections", "Dashboards"];

type Section = { icon: LucideIcon; title: string; desc: string; href: string; group: Group; keywords?: string };

const SECTIONS: Section[] = [
  { icon: UserCircle, title: "My profile", desc: "Your details, change password, signature, targets and leave.", href: "/dashboard/settings/profile", group: "Your account", keywords: "password signature photo phone" },
  { icon: KeyRound, title: "Two-factor authentication", desc: "Add an authenticator code on top of your password.", href: "/dashboard/settings/security", group: "Your account", keywords: "2fa otp totp security login sessions devices" },

  { icon: Building2, title: "Organisation profile", desc: "Firm details, ARN, contact and business profile.", href: "/dashboard/settings/organisation", group: "Firm", keywords: "firm company arn address logo gst" },
  { icon: ShieldCheck, title: "Privacy notice", desc: "Your DPDP privacy notice and privacy contact for clients and leads.", href: "/dashboard/settings/privacy-notice", group: "Firm", keywords: "dpdp data protection privacy policy notice consent dpo grievance officer personal data" },
  { icon: Palette, title: "Appearance & theme", desc: "Colours, font, density and your white-label address.", href: "/dashboard/settings/appearance", group: "Firm", keywords: "logo colour color brand theme white-label domain font" },
  { icon: CreditCard, title: "Billing & subscription", desc: "Current plan, payment history, renewal.", href: "/dashboard/billing", group: "Firm", keywords: "plan invoice payment razorpay renew upgrade" },

  { icon: Users, title: "Team & roles", desc: "Invite team members, assign roles, manage seats.", href: "/dashboard/employees", group: "Team", keywords: "users employees invite permissions seats staff" },
  { icon: Network, title: "Teams within a branch", desc: "Group each branch into desks and assign RMs.", href: "/dashboard/settings/desks", group: "Team", keywords: "desks mis" },
  { icon: Target, title: "Targets & quota", desc: "Business and meeting targets per team member.", href: "/dashboard/settings/targets", group: "Team", keywords: "kra goals" },
  { icon: Shuffle, title: "Auto-assignment rules", desc: "Route new leads and clients to your team automatically.", href: "/dashboard/settings/assignment-rules", group: "Team", keywords: "round robin routing allocate" },

  { icon: SlidersHorizontal, title: "Custom fields", desc: "Your own fields on leads and clients.", href: "/dashboard/settings/custom-fields", group: "Clients & data" },
  { icon: Database, title: "Dropdown options", desc: "The choices your team picks from — lead sources, service types and more.", href: "/dashboard/settings/masters", group: "Clients & data", keywords: "masters picklist values lead source" },
  { icon: ClipboardCheck, title: "Onboarding form fields", desc: "Which account-opening and KYC fields are mandatory.", href: "/dashboard/settings/onboarding-fields", group: "Clients & data", keywords: "kyc mandatory required account opening" },
  { icon: ShieldCheck, title: "Risk profile questionnaire", desc: "Questions, scoring and risk-category bands.", href: "/dashboard/settings/risk-profile", group: "Clients & data", keywords: "risk profiling suitability" },
  { icon: Boxes, title: "Scheme master", desc: "Every mutual fund scheme the CRM knows.", href: "/dashboard/schemes", group: "Clients & data", keywords: "schemes funds amfi isin nav plan category master" },
  { icon: Landmark, title: "AMC empanelments", desc: "The fund houses your firm is empanelled with.", href: "/dashboard/amc-empanelments", group: "Clients & data", keywords: "amc fund house empanelment arn" },

  { icon: Zap, title: "Automations", desc: "Rules that send messages and create tasks on their own.", href: "/dashboard/automations", group: "Automation", keywords: "workflows rules triggers actions run history recipes" },
  { icon: Route, title: "Stages & journeys", desc: "Stages, deadlines and required fields for leads, requests and reviews.", href: "/dashboard/settings/blueprints", group: "Automation", keywords: "blueprints pipeline workflow sla" },
  { icon: ListChecks, title: "Task templates", desc: "Predefined tasks with checklists (SOPs).", href: "/dashboard/settings/task-templates", group: "Automation", keywords: "sop checklist" },
  { icon: BellRing, title: "Escalation", desc: "When overdue tasks reach the manager, branch head and owner.", href: "/dashboard/settings/escalation", group: "Automation", keywords: "overdue escalate ladder manager branch head owner sla" },
  { icon: ClipboardCheck, title: "QA sampling", desc: "Check a share of each person's completed work every week.", href: "/dashboard/settings/qa-sampling", group: "Automation", keywords: "qa quality check audit sample review pass fail correction" },

  { icon: LayoutTemplate, title: "Message templates", desc: "The WhatsApp, email and SMS templates your team and automations send.", href: "/dashboard/templates", group: "Messaging", keywords: "whatsapp email sms template designer approval meta notification journey" },
  { icon: Mail, title: "Email introduction", desc: "Company intro, services, office timing, mission and founder for client emails.", href: "/dashboard/settings/email-introduction", group: "Messaging", keywords: "about us company intro services office hours timing mission founder photo merge fields variables welcome lead email" },
  { icon: MessagesSquare, title: "Message log", desc: "Every message sent and received, with delivery status.", href: "/dashboard/communications", group: "Messaging", keywords: "communications messages log outbox inbox delivered read failed compose whatsapp email sms cadence responses" },

  { icon: MessageCircle, title: "WhatsApp", desc: "Your WhatsApp number and Meta template approvals.", href: "/dashboard/settings/whatsapp", group: "Connections", keywords: "aisensy meta templates connection" },
  { icon: Mail, title: "Email", desc: "Sending domain, DKIM, mailboxes.", href: "/dashboard/settings/email", group: "Connections", keywords: "smtp domain dkim mailbox sender setup" },
  { icon: Webhook, title: "Integrations", desc: "CAMS / KFintech mailback, BSE Star MF, Razorpay, KYC providers.", href: "/dashboard/settings/integrations", group: "Connections", keywords: "api zoho bse nse cams kfintech kyc rta mailback password" },

  { icon: LayoutDashboard, title: "Default dashboards", desc: "Which dashboard each role and person opens first.", href: "/dashboard/settings/dashboards", group: "Dashboards", keywords: "default home role assign" },
  { icon: Gauge, title: "Dashboard thresholds", desc: "Target bands, phasing, SLAs and ageing lines.", href: "/dashboard/settings/dashboard-thresholds", group: "Dashboards", keywords: "sla bands" },
];

export function SettingsDirectory({ hidden = [] }: {
  /** Pages this viewer cannot open (a card that moved here from the sidebar keeps its access rules). */
  hidden?: string[];
}) {
  const [q, setQ] = useState("");
  const sections = useMemo(() => SECTIONS.filter((s) => !hidden.includes(s.href)), [hidden]);

  // Every word must appear somewhere in the title, description, panel or
  // keywords, so "email templates" finds Message templates.
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return sections;
    return sections.filter((s) => {
      const hay = `${s.title} ${s.desc} ${s.group} ${s.keywords ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [q, sections]);

  return (
    <div className="space-y-5">
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
        // Panels flow down three columns (two on a tablet, one on a phone), so
        // a short panel never leaves a hole beside a long one.
        <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
          {GROUP_ORDER.map((g) => {
            const rows = shown.filter((s) => s.group === g);
            if (rows.length === 0) return null;
            const headingId = `settings-${g.toLowerCase().replace(/[^a-z]+/g, "-")}`;
            return (
              <section key={g} aria-labelledby={headingId} className="card-surface mb-4 break-inside-avoid p-2">
                <h2 id={headingId} className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g}
                </h2>
                <ul>
                  {rows.map((s) => {
                    const Icon = s.icon;
                    return (
                      <li key={s.href}>
                        {/* Name only; the description is the hover title and still feeds the search. */}
                        <Link
                          href={s.href}
                          title={s.desc}
                          className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-secondary"
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-foreground/70 transition-colors group-hover:bg-card group-hover:text-primary">
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{s.title}</span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
