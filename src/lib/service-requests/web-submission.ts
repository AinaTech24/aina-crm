/**
 * What the public service request form sends, read and checked — pure, so it is
 * tested (tests/service-request-web-form.test.ts) and the route stays thin.
 *
 * The messages are written for the person filling the form in: they are shown
 * on the page as they are.
 */

/** What a client can ask for. The values are service_requests.type. */
export const WEB_SERVICES = [
  { value: "statement_request", label: "Account statement" },
  { value: "capital_gain_report", label: "Capital-gain report" },
  { value: "redemption_request", label: "Redemption" },
  { value: "switch_request", label: "Switch" },
  { value: "nominee_update", label: "Nominee update" },
  { value: "bank_update", label: "Bank account update" },
  { value: "mobile_update", label: "Mobile number update" },
  { value: "email_update", label: "Email address update" },
  { value: "kyc_update", label: "KYC update" },
  { value: "folio_correction", label: "Folio correction" },
  { value: "minor_to_major", label: "Minor to major" },
  { value: "transmission_case", label: "Transmission (death of a holder)" },
  { value: "other", label: "Other" },
] as const;

export type WebServiceType = (typeof WEB_SERVICES)[number]["value"];

export const MAX_SERVICES_PER_FORM = 6;
export const NAME_MAX = 120;
export const DETAILS_MAX = 2000;
export const OTHER_MAX = 200;

export type ServiceSubmission = {
  name: string;
  /** Lower-cased. */
  email: string | null;
  /** As typed (trimmed) — shown to staff. */
  phone: string | null;
  /** The last ten digits, for matching a client. */
  phoneLast10: string | null;
  /** Distinct, in the order chosen. */
  services: WebServiceType[];
  /** What the client typed when they chose "Other". */
  otherText: string | null;
  details: string | null;
};

export type ServiceParse =
  | { kind: "ok"; value: ServiceSubmission }
  | { kind: "invalid"; error: string }
  /** The hidden honeypot field was filled in: a bot. Answer as if it worked. */
  | { kind: "trap" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID = new Set<string>(WEB_SERVICES.map((s) => s.value));

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export const serviceLabel = (type: string) => WEB_SERVICES.find((s) => s.value === type)?.label ?? "Service request";

export function parseServiceSubmission(body: unknown): ServiceParse {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  if (str(b.website) || str(b._gotcha)) return { kind: "trap" };

  const name = str(b.name).replace(/\s+/g, " ");
  if (name.length < 2) return { kind: "invalid", error: "Please enter your full name." };
  if (name.length > NAME_MAX) return { kind: "invalid", error: "Please shorten your name." };

  const email = str(b.email).toLowerCase() || null;
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) {
    return { kind: "invalid", error: "That email address doesn't look right." };
  }

  const phone = str(b.phone) || null;
  let phoneLast10: string | null = null;
  if (phone) {
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length < 10 || digits.length > 13) return { kind: "invalid", error: "That mobile number doesn't look right." };
    phoneLast10 = digits.slice(-10);
  }
  if (!email && !phone) {
    return { kind: "invalid", error: "Please give a mobile number or an email address, so the firm can reach you." };
  }

  const rawServices = Array.isArray(b.services) ? b.services : [];
  const services = [...new Set(rawServices.filter((s): s is WebServiceType => typeof s === "string" && VALID.has(s)))];
  if (services.length === 0) return { kind: "invalid", error: "Please choose a service." };
  if (services.length > MAX_SERVICES_PER_FORM) {
    return { kind: "invalid", error: `Please choose at most ${MAX_SERVICES_PER_FORM} services in one request.` };
  }

  const otherText = str(b.otherText).replace(/\s+/g, " ") || null;
  if (services.includes("other")) {
    if ((otherText?.length ?? 0) < 3) return { kind: "invalid", error: "Please tell us what you need under Other." };
    if ((otherText?.length ?? 0) > OTHER_MAX) return { kind: "invalid", error: "Please shorten what you need under Other." };
  }

  const details = str(b.details) || null;
  if (details && details.length > DETAILS_MAX) return { kind: "invalid", error: "Please keep the description under 2,000 characters." };

  return {
    kind: "ok",
    value: { name, email, phone, phoneLast10, services, otherText: services.includes("other") ? otherText : null, details },
  };
}
