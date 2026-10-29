/**
 * The public site's calls to action, in one place. Self-serve sign-up is
 * closed (workspaces are created by Aina — see src/app/signup/page.tsx), so the
 * site's primary action is a demo request, not a trial.
 */

/** WhatsApp community for MFDs. */
export const COMMUNITY_URL = "https://chat.whatsapp.com/C6ttmFYUtxHA7GYna5YGcN";

/** Demo request — opens WhatsApp to Aina's sales/support line with a first message. */
export const DEMO_URL = `https://wa.me/918200770942?text=${encodeURIComponent("Hi, I'd like a demo of Aina CRM for my MFD practice.")}`;

/** The public site's canonical origin (sitemap, canonical URLs, structured data). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://crm.ainatech.in").replace(/\/$/, "");

/** Aina Tech Services LLP's published contact details (as on ainatech.in). */
export const CONTACT = {
  company: "Aina Tech Services LLP",
  street: "317, 3rd Floor, Krishna Shrey Complex, Nr. Sanket Sales, Raj Marg",
  city: "Anand",
  region: "Gujarat",
  postalCode: "388001",
  country: "IN",
  email: "info@ainatech.in",
  phoneDisplay: "+91 82007 70942",
  phone: "+918200770942",
  whatsapp: "https://wa.me/918200770942",
  website: "https://ainatech.in",
} as const;
