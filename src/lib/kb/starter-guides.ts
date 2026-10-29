/**
 * The shipped help-centre content: one process guide per module of Aina CRM, each with its
 * title, description, steps and the screenshots (files in /public/kb) that go with them.
 *
 * Written from the product itself — every button name and path below was read off the live
 * screens, and the screenshots were captured from them. They are installed (published) by
 * migration 0248 and by "Add starter guides" in the super-admin, and stay fully editable there.
 * Keep every claim true of the product; when a screen changes, update the guide in the admin.
 */

import type { StarterFolder, StarterGuide } from "./guides/types";
import { HOME_GUIDES } from "./guides/home";
import { WORK_GUIDES } from "./guides/work";
import { CLIENT_GUIDES } from "./guides/clients";
import { PLANNING_GUIDES } from "./guides/planning";
import { BUSINESS_GUIDES } from "./guides/business";
import { INSIGHT_GUIDES } from "./guides/insights";
import { AUTOMATION_GUIDES } from "./guides/automation";
import { COMPLIANCE_GUIDES } from "./guides/compliance";
import { TEAM_GUIDES } from "./guides/team";
import { DATA_GUIDES } from "./guides/data";
import { PRACTICE_GUIDES } from "./guides/practice";

export type { GuideShot, StarterFolder, StarterGuide } from "./guides/types";

export const STARTER_CATEGORY = {
  slug: "aina-crm-user-guide",
  name: "Aina CRM user guide",
  description: "Step-by-step guides with screenshots for every module of Aina CRM.",
};

/** Same order and names as the CRM's sidebar, so a user can find a guide where the module lives. */
export const STARTER_FOLDERS: StarterFolder[] = [
  { slug: "guide-home", name: "Home", description: "Dashboards and your team's view." },
  { slug: "guide-work", name: "Work", description: "Tasks, meetings, calendar and service requests." },
  { slug: "guide-clients", name: "Clients", description: "Leads, clients, opportunities, families and risk profiles." },
  { slug: "guide-planning", name: "Planning tools", description: "Calculators, goals, health checks, proposals and insurance." },
  { slug: "guide-business", name: "Business", description: "SIPs, rejections, transactions, business entries and FDs." },
  { slug: "guide-insights", name: "Insights", description: "Reports, forecasts and the AI assistant." },
  { slug: "guide-automation", name: "Automation & messaging", description: "Automations, templates, campaigns and communications." },
  { slug: "guide-compliance", name: "Compliance", description: "Documents, DDQ readiness, nominations and the audit log." },
  { slug: "guide-team", name: "Team", description: "Team members, attendance, leave, induction and announcements." },
  { slug: "guide-data", name: "Data & admin", description: "Registrar imports, reconciliation, masters and clean-up." },
  { slug: "guide-practice", name: "Practice", description: "Practice systems and the operations manual." },
  { slug: "guide-settings", name: "Settings", description: "Your account, firm, team, integrations and messaging setup." },
];

export const GUIDES: StarterGuide[] = [
  ...HOME_GUIDES,
  ...WORK_GUIDES,
  ...CLIENT_GUIDES,
  ...PLANNING_GUIDES,
  ...BUSINESS_GUIDES,
  ...INSIGHT_GUIDES,
  ...AUTOMATION_GUIDES,
  ...COMPLIANCE_GUIDES,
  ...TEAM_GUIDES,
  ...DATA_GUIDES,
  ...PRACTICE_GUIDES,
];
