/**
 * What a "Get pricing" request must carry, cleaned up — and the bot trap.
 * Pure (shared by POST /api/public/pricing/quote and its tests). The same
 * contract as lib/complaints/submission.ts: `trap` is answered with a fake
 * success so a bot learns nothing.
 */

import { isValidEmail } from "@/lib/public-otp";
import type { PricingSettings } from "./aum-pricing";

export type QuoteRequest = {
  contactName: string;
  firmName: string;
  email: string;
  mobile: string;
  arn: string | null;
  aumCrore: number;
  users: number;
};

export type ParsedQuoteRequest =
  | { kind: "ok"; value: QuoteRequest }
  | { kind: "invalid"; error: string; field?: string }
  | { kind: "trap" };

const squash = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Indian mobile: optional +91 / 0, then 10 digits starting 6–9. Returns "+91XXXXXXXXXX". */
export function normaliseMobile(v: unknown): string | null {
  const digits = String(v ?? "").replace(/[^\d]/g, "");
  const last10 = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(last10) ? `+91${last10}` : null;
}

/** "arn 12345" / "ARN-12345" / "12345" → "ARN-12345". */
export function normaliseArn(v: unknown): string | null | "bad" {
  const s = squash(v).toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  const m = /^(?:ARN-?)?(\d{3,7})$/.exec(s);
  return m ? `ARN-${m[1]}` : "bad";
}

export function parseQuoteRequest(body: unknown, settings: PricingSettings): ParsedQuoteRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { kind: "invalid", error: "Please fill in the form." };
  const b = body as Record<string, unknown>;
  // Honeypot: a field no person sees. Anything in it is a bot.
  if (squash(b.website) || squash(b._gotcha)) return { kind: "trap" };

  const contactName = squash(b.contactName ?? b.name);
  if (contactName.length < 2 || contactName.length > 100) return { kind: "invalid", error: "Please enter your name.", field: "contactName" };
  const firmName = squash(b.firmName);
  if (firmName.length < 2 || firmName.length > 150) return { kind: "invalid", error: "Please enter your firm's name.", field: "firmName" };
  const email = squash(b.email).toLowerCase();
  if (!isValidEmail(email) || email.length > 200) return { kind: "invalid", error: "Please enter a valid email address.", field: "email" };
  const mobile = normaliseMobile(b.mobile);
  if (!mobile) return { kind: "invalid", error: "Please enter a 10-digit Indian mobile number.", field: "mobile" };
  const arn = normaliseArn(b.arn);
  if (arn === "bad") return { kind: "invalid", error: "An ARN looks like ARN-123456 — or leave it blank.", field: "arn" };

  const aumRaw = typeof b.aumCrore === "number" ? b.aumCrore : Number(squash(b.aumCrore).replace(/,/g, ""));
  if (!Number.isFinite(aumRaw) || aumRaw < 0 || aumRaw > 1_000_000) {
    return { kind: "invalid", error: "Please enter your AUM in ₹ crore (0 or more).", field: "aumCrore" };
  }
  const aumCrore = Math.round(aumRaw * 100) / 100;
  const users = typeof b.users === "number" ? b.users : Number(squash(b.users));
  if (!Number.isInteger(users) || users < settings.minUsers || users > settings.maxUsers) {
    return {
      kind: "invalid",
      error: `Users must be a whole number from ${settings.minUsers} to ${settings.maxUsers}. For more, please contact us.`,
      field: "users",
    };
  }
  return { kind: "ok", value: { contactName, firmName, email, mobile, arn, aumCrore, users } };
}
