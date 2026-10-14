/**
 * "You just called them — how did it go?"
 *
 * Every Call / WhatsApp / SMS / Email launcher in the app opens the RM's OWN
 * phone or mail client, so the CRM never learns the touchpoint happened unless
 * someone opens the Log activity drawer afterwards — and mostly nobody does.
 * A launcher that carries these data attributes is noticed by ContactLogPrompt
 * (mounted once in the dashboard layout), which asks one question with tap
 * answers and logs the activity through POST /api/activities.
 *
 * Plain module on purpose: server components spread `contactLogAttrs(...)`
 * onto their own <a> tags, and a server component cannot call a function
 * exported from a "use client" module.
 */

export type ContactLogSubject = { type: "investor" | "lead"; id: string; name: string };
export type ContactChannel = "call" | "whatsapp" | "sms" | "email";

/** Fired on window by `announceContact`; ContactLogPrompt listens for it. */
export const CONTACT_LAUNCHED_EVENT = "aina:contact-launched";

export type ContactLaunched = ContactLogSubject & { channel: ContactChannel };

/** Data attributes for a launcher <a>. Null subject → nothing to spread. */
export function contactLogAttrs(subject: ContactLogSubject | null | undefined): Record<string, string> {
  if (!subject?.id) return {};
  return {
    "data-log-type": subject.type,
    "data-log-id": subject.id,
    "data-log-name": subject.name,
  };
}

/** The channel a launcher href opens, or null when it is not a contact link. */
export function channelForHref(href: string | null | undefined): ContactChannel | null {
  if (!href) return null;
  const h = href.trim().toLowerCase();
  if (h.startsWith("tel:")) return "call";
  if (h.startsWith("sms:")) return "sms";
  if (h.startsWith("mailto:")) return "email";
  if (h.startsWith("https://wa.me/") || h.startsWith("https://api.whatsapp.com/") || h.startsWith("whatsapp:")) return "whatsapp";
  return null;
}

/** For launchers that open with window.open instead of an <a>. Browser only. */
export function announceContact(c: ContactLaunched): void {
  if (typeof window === "undefined" || !c.id) return;
  window.dispatchEvent(new CustomEvent<ContactLaunched>(CONTACT_LAUNCHED_EVENT, { detail: c }));
}

/** One tap answer → the activity it records. */
export type ContactOutcome = {
  key: string;
  label: string;
  kind: "call" | "whatsapp" | "sms" | "email";
  status?: "answered" | "no_answer" | "busy" | "completed";
};

export const OUTCOMES: Record<ContactChannel, ContactOutcome[]> = {
  call: [
    { key: "answered", label: "Connected", kind: "call", status: "answered" },
    { key: "no_answer", label: "No answer", kind: "call", status: "no_answer" },
    { key: "busy", label: "Busy", kind: "call", status: "busy" },
  ],
  whatsapp: [{ key: "sent", label: "Sent", kind: "whatsapp", status: "completed" }],
  sms: [{ key: "sent", label: "Sent", kind: "sms", status: "completed" }],
  email: [{ key: "sent", label: "Sent", kind: "email", status: "completed" }],
};

export const QUESTION: Record<ContactChannel, (first: string) => string> = {
  call: (n) => `How did the call with ${n} go?`,
  whatsapp: (n) => `Did you send ${n} the WhatsApp?`,
  sms: (n) => `Did you send ${n} the SMS?`,
  email: (n) => `Did you send ${n} the email?`,
};

/** The POST /api/activities body for one answer. */
export function activityBody(c: ContactLaunched, o: ContactOutcome) {
  return {
    subjectType: c.type,
    subjectId: c.id,
    kind: o.kind,
    direction: "outbound" as const,
    ...(o.status ? { status: o.status } : {}),
  };
}

/**
 * Open the Log activity drawer from anywhere (Ctrl/Cmd+K, "+ Add", the mobile
 * "+" button) with a client / lead picker. ActivityLauncher listens for it.
 */
export const LOG_ACTIVITY_EVENT = "aina:log-activity";

export function openLogActivity(kind: "call" | "note" | "visit" | "whatsapp" = "call"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOG_ACTIVITY_EVENT, { detail: { kind } }));
}
