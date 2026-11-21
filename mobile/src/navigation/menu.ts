/**
 * The module list for the More tab, as data.
 *
 * Bottom tabs are Home · Leads · Clients · Activities · More; every other module
 * is listed here, grouped and capability-gated (mirrors the server's `can()`
 * matrix). Entries that are also tabs (Clients, Leads, Calls) stay here for the
 * "coming up" label lookup in m/[module] but are hidden from More.
 */

import { type ComponentProps } from "react";
import { Feather } from "@expo/vector-icons";

type FeatherName = ComponentProps<typeof Feather>["name"];

export interface MenuItem {
  key: string;
  label: string;
  icon: FeatherName;
  route: string;
  /** Visible if the user has ANY of these caps. Empty = always visible. */
  anyCap?: string[];
}

export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

export const MENU: MenuGroup[] = [
  {
    title: "Overview",
    items: [
      { key: "attendance", label: "Attendance", icon: "clock", route: "/m/attendance" },
      // Net sales, SIP health and efforts all require reports.business / reports.manage
      // on the server — an RM used to open this to a page of ₹0 tiles.
      { key: "review", label: "Monthly Review", icon: "clipboard", route: "/m/review", anyCap: ["reports.business", "reports.manage"] },
      { key: "business", label: "Business", icon: "bar-chart-2", route: "/m/business", anyCap: ["dashboard.view.owner", "reports.business", "reports.manage"] },
    ],
  },
  {
    title: "Clients",
    items: [
      { key: "investors", label: "Clients", icon: "users", route: "/m/investors", anyCap: ["investor.view.all", "investor.view.assigned"] },
      { key: "opportunities", label: "Opportunities", icon: "crosshair", route: "/m/opportunities", anyCap: ["investor.view.all", "investor.view.assigned"] },
      { key: "risk-profiles", label: "Risk Profiles", icon: "shield", route: "/m/risk-profiles", anyCap: ["investor.view.all", "investor.view.assigned"] },
      { key: "discovery", label: "Discovery (Fact-find)", icon: "clipboard", route: "/m/discovery", anyCap: ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"] },
      { key: "fixed-deposits", label: "Fixed Deposits", icon: "lock", route: "/m/fixed-deposits", anyCap: ["investor.view.all", "investor.view.assigned"] },
      { key: "goals", label: "Goal Planning", icon: "target", route: "/m/goals", anyCap: ["goal.manage"] },
    ],
  },
  {
    title: "Sales Tools",
    items: [
      { key: "calculators", label: "Calculators", icon: "sliders", route: "/m/calculators" },
      { key: "proposals", label: "Proposals", icon: "file-text", route: "/m/proposals", anyCap: ["proposal.view"] },
    ],
  },
  {
    title: "Pipeline",
    items: [
      { key: "leads", label: "Leads", icon: "trending-up", route: "/m/leads", anyCap: ["lead.view.all", "lead.view.assigned"] },
      { key: "activities", label: "Calls", icon: "phone-call", route: "/m/activities" },
    ],
  },
  {
    title: "Servicing",
    items: [
      { key: "sips", label: "SIP Tracker", icon: "repeat", route: "/m/sips" },
      { key: "service-requests", label: "Service Requests", icon: "life-buoy", route: "/m/service-requests" },
    ],
  },
  {
    title: "Schedule",
    items: [
      { key: "calendar", label: "Calendar", icon: "calendar", route: "/m/calendar" },
      { key: "review-meetings", label: "Meetings", icon: "video", route: "/m/review-meetings", anyCap: ["review_meeting.manage.all", "review_meeting.manage.assigned"] },
    ],
  },
];
