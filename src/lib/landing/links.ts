/**
 * The public site's calls to action, in one place. Self-serve sign-up is
 * closed (workspaces are created by Aina — see src/app/signup/page.tsx), so the
 * site's primary action is a demo request, not a trial.
 */

/** WhatsApp community for MFDs. */
export const COMMUNITY_URL = "https://chat.whatsapp.com/C6ttmFYUtxHA7GYna5YGcN";

/** Demo request — opens WhatsApp to Aina's sales/support line with a first message. */
export const DEMO_URL = `https://wa.me/918200770942?text=${encodeURIComponent("Hi, I'd like a demo of Aina CRM for my MFD practice.")}`;
