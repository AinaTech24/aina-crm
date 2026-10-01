/**
 * Landing-page pricing plans — loaded from the admin-managed `landing_packages`
 * table, with a hardcoded fallback so the public page never breaks (empty table,
 * DB hiccup, or a fresh install before the seed runs).
 */

import { asc, eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { landingPackages } from "@/db/schema";

export type LandingPlan = {
  name: string;
  tagline: string | null;
  priceLabel: string | null;
  unitLabel: string | null;
  setupLabel: string | null;
  setupOriginalLabel: string | null;
  discountBadge: string | null;
  seatsLabel: string | null;
  inheritsLabel: string | null;
  features: string[];
  featured: boolean;
  badgeLabel: string | null;
  isCustom: boolean;
  ctaLabel: string;
  ctaHref: string;
};

/** Shipped defaults — mirror the seed; used when the table is empty/unreachable. */
export const FALLBACK_PLANS: LandingPlan[] = [
  {
    name: "Growth",
    tagline: "Everything an MFD firm needs to run day-to-day — clients, money, service, automation & AI alerts in one organised place.",
    priceLabel: "₹9,499", unitLabel: "/ user / year", setupLabel: "₹45,000", setupOriginalLabel: null, discountBadge: null, seatsLabel: "3 users = ₹28,497 / year",
    inheritsLabel: null, featured: false, badgeLabel: null, isCustom: false, ctaLabel: "Start Free Trial", ctaHref: "/signup",
    features: [
      "Dashboard, Tasks, Meetings & Calendar", "Leads, Clients & Family Mapping", "Risk Profile & Any 20 Calculators",
      "Insurance Policies & Claims", "Insurance Renewal Alerts", "Business Entities — All Products", "Email Automation",
      "User Management & Basic Support", "Report / MIS", "Command Centre — AI Alerts", "Next Big Action — AI Alerts",
      "Proposals & Insurance Commission Tracker", "Attendance & Leave Tracker", "Sub-Distributor Module",
      "Workflow Rules & Basic Automation", "Recorded Training Sessions",
    ],
  },
  {
    name: "Premium",
    tagline: "Full AI, compliance & practice management for firms scaling seriously.",
    priceLabel: "₹12,499", unitLabel: "/ user / year", setupLabel: "₹75,000", setupOriginalLabel: null, discountBadge: null, seatsLabel: "3 users = ₹37,497 / year",
    inheritsLabel: "Everything in Growth, plus:", featured: true, badgeLabel: null, isCustom: false, ctaLabel: "Start Free Trial", ctaHref: "/signup",
    features: [
      "AI Assistant & AI Tool Training", "RTA File Import", "Advanced Goal Planning", "Brokerage Management",
      "DDQ Compliance Management & Audit", "Portfolio Intelligence", "Practice & Finance Tools", "Advanced Automation",
      "Custom CRM Customisation", "WhatsApp Automation", "IT Support & Customised Presentations",
      "CRM Usage Tracking & Team Implementation", "Personalized Training Sessions",
    ],
  },
  {
    name: "Custom CRM Customization",
    tagline: "A CRM built and tailored to your firm's exact workflow — hosted on your own server, fully under your control.",
    priceLabel: null, unitLabel: null, setupLabel: null, setupOriginalLabel: null, discountBadge: null, seatsLabel: null,
    inheritsLabel: "Everything in Premium, plus:", featured: false, badgeLabel: null, isCustom: true, ctaLabel: "Call now", ctaHref: "tel:+918200770942",
    features: [
      "Hosted on your own server / infrastructure", "Bespoke modules & workflows built for your firm",
      "Custom integrations (RTA, AMC, in-house tools)", "Your branding end-to-end (white-label)",
      "Dedicated implementation & priority support", "Tailored data migration & onboarding",
    ],
  },
];

export async function loadLandingPlans(): Promise<LandingPlan[]> {
  try {
    const rows = await withSystem(async (tx) =>
      tx.select().from(landingPackages).where(eq(landingPackages.published, true)).orderBy(asc(landingPackages.sortOrder))
    );
    if (!rows.length) return FALLBACK_PLANS;
    return rows.map((r) => ({
      name: r.name,
      tagline: r.tagline,
      priceLabel: r.priceLabel,
      unitLabel: r.unitLabel,
      setupLabel: r.setupLabel,
      setupOriginalLabel: r.setupOriginalLabel,
      discountBadge: r.discountBadge,
      seatsLabel: r.seatsLabel,
      inheritsLabel: r.inheritsLabel,
      features: Array.isArray(r.features) ? r.features : [],
      featured: r.featured,
      badgeLabel: r.badgeLabel,
      isCustom: r.isCustom,
      ctaLabel: r.ctaLabel,
      ctaHref: r.ctaHref,
    }));
  } catch {
    return FALLBACK_PLANS;
  }
}
