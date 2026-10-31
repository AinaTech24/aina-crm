/**
 * The firm's privacy notice under the Digital Personal Data Protection Act,
 * 2023 and the DPDP Rules, 2025 (Rule 3: a notice at collection that says what
 * is collected, why, how to withdraw consent, how to exercise rights and how
 * to complain to the Data Protection Board).
 *
 * The FIRM is the data fiduciary for its clients and leads; this CRM is its
 * processor. So the notice is the firm's: its name, ARN, address and privacy
 * contact (tenants.dpo, also edited in Firm profile). Every firm has a valid
 * notice from day one — the standard text below fits an Indian MFD practice —
 * and Settings → Privacy notice adds the firm's own purposes and recipients.
 * Saving there bumps `version`, which every consent record carries.
 *
 * Public at /privacy/<tenant id> (middleware PUBLIC_PATH_PREFIXES).
 */

import { z } from "zod";

export const PRIVACY_NOTICE_PATH = "/privacy";

export const privacyNoticePath = (tenantId: string) => `${PRIVACY_NOTICE_PATH}/${tenantId}`;

const lines = z
  .array(z.string().trim().min(1).max(300))
  .max(20)
  .default([]);

/** What Settings → Privacy notice stores in tenants.privacy_notice. */
export const PrivacyNoticeSettingsSchema = z.object({
  extraPurposes: lines,
  extraRecipients: lines,
  /** Show the AI-assistance processor line (drafting, summaries). */
  mentionsAi: z.boolean().default(true),
});
export type PrivacyNoticeSettings = z.infer<typeof PrivacyNoticeSettingsSchema>;

export type StoredPrivacyNotice = PrivacyNoticeSettings & { version: number; publishedAt: string | null };

/** Read the jsonb column; anything unreadable falls back to the standard notice. */
export function readPrivacyNotice(raw: unknown): StoredPrivacyNotice {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const parsed = PrivacyNoticeSettingsSchema.safeParse(obj);
  const base = parsed.success ? parsed.data : PrivacyNoticeSettingsSchema.parse({});
  const version = Number.isInteger(obj.version) && (obj.version as number) > 0 ? (obj.version as number) : 1;
  const publishedAt = typeof obj.publishedAt === "string" ? obj.publishedAt : null;
  return { ...base, version, publishedAt };
}

export type PrivacyContact = { name?: string | null; email?: string | null; phone?: string | null };

/** The person who answers privacy questions: the DPO, else the firm's own contact. */
export function privacyContact(dpo: PrivacyContact | null | undefined, firm: { email?: string | null; phone?: string | null }): PrivacyContact {
  const d = dpo ?? {};
  const email = d.email?.trim() || firm.email?.trim() || null;
  const phone = d.phone?.trim() || firm.phone?.trim() || null;
  return { name: d.name?.trim() || null, email, phone };
}

export type FirmForNotice = {
  name: string;
  legalName?: string | null;
  arn?: string | null;
  address?: string | null;
  website?: string | null;
};

export type NoticeSection = { heading: string; paragraphs?: string[]; bullets?: string[] };

export const STANDARD_COLLECTED = [
  "Identity and contact details — name, PAN, date of birth, address, phone and email",
  "KYC documents and the details on them, and details of your nominees, family members and guardian (for a minor)",
  "Financial details — income, investments, goals, insurance and your risk profile",
  "Your holdings, transactions and SIPs as reported by the registrars (CAMS, KFin Technologies) and fund houses",
  "Our conversations with you — calls, meetings, emails and WhatsApp messages",
];

export const STANDARD_PURPOSES = [
  "To reply to your enquiry and tell you about our services",
  "To complete your KYC and open your accounts, as SEBI and the Prevention of Money Laundering Act require",
  "To arrange, track and service your mutual fund and other investments — purchases, SIPs, switches and redemptions",
  "To understand your needs and risk profile before we recommend a product",
  "To send statements, reminders and service updates about your investments",
  "To send market updates and offers — only with your consent, which you can withdraw at any time",
  "To meet legal, regulatory, tax and audit requirements",
];

export const STANDARD_RECIPIENTS = [
  "Fund houses (AMCs), their registrars CAMS and KFin Technologies, and the exchange platforms (BSE StAR MF, NSE) that carry out your transactions",
  "KYC Registration Agencies, to verify and update your KYC",
  "Insurance companies and other product providers, when you ask us for their product",
  "Regulators, courts and authorities, when the law requires it",
  "Service providers who process data for us under contract: our CRM provider AinaTech, hosted on Amazon Web Services in Mumbai; email (Resend), WhatsApp (AiSensy) and SMS (MSG91) delivery",
];

export const AI_RECIPIENT =
  "AI assistance used to draft messages and summaries for our team (Anthropic or Google), which may process data outside India";

/** The notice as sections — the public page and the tests read the same thing. */
export function buildNoticeSections(firm: FirmForNotice, notice: StoredPrivacyNotice, contact: PrivacyContact): NoticeSection[] {
  const who = firm.legalName && firm.legalName !== firm.name ? `${firm.name} (${firm.legalName})` : firm.name;
  const arn = firm.arn ? `, an AMFI-registered mutual fund distributor (ARN-${firm.arn.replace(/^arn[\s-]*/i, "")})` : "";
  const contactBits = [contact.name, contact.email, contact.phone].filter(Boolean).join(" · ");

  return [
    {
      heading: "Who we are",
      paragraphs: [
        `${who}${arn}${firm.address ? `, ${firm.address}` : ""}, decides how your personal data is used. This notice explains what we collect, why, who we share it with and the rights you have under the Digital Personal Data Protection Act, 2023.`,
      ],
    },
    { heading: "What we collect", bullets: STANDARD_COLLECTED },
    { heading: "Why we use it", bullets: [...STANDARD_PURPOSES, ...notice.extraPurposes] },
    {
      heading: "Who we share it with",
      paragraphs: ["We never sell your data. We share only what each of these needs:"],
      bullets: [...STANDARD_RECIPIENTS, ...(notice.mentionsAi ? [AI_RECIPIENT] : []), ...notice.extraRecipients],
    },
    {
      heading: "How long we keep it",
      paragraphs: [
        "For as long as you are our client, and afterwards for as long as the law requires — for example, the Prevention of Money Laundering Act requires records for five years after the relationship ends. Enquiries that do not become clients are deleted or anonymised once we no longer need them.",
      ],
    },
    {
      heading: "Your rights",
      bullets: [
        "Get a summary of the personal data we hold about you and who we have shared it with",
        "Have inaccurate or incomplete data corrected and updated",
        "Have your data erased once it is no longer needed, except what the law requires us to keep",
        "Withdraw your consent at any time — as easily as you gave it. Withdrawing does not affect what was done before",
        "Nominate someone to exercise these rights if you die or cannot act yourself",
        "Have your grievance answered",
      ],
    },
    {
      heading: "Children",
      paragraphs: ["For a minor's account we process data only with the consent of the parent or legal guardian, and we do not send marketing to children."],
    },
    {
      heading: "Contact us",
      paragraphs: [
        contactBits
          ? `To use any of these rights or ask a question, contact our privacy contact: ${contactBits}. We reply within 90 days.`
          : "To use any of these rights or ask a question, contact your relationship manager. We reply within 90 days.",
        "If you are not satisfied with our reply, you may complain to the Data Protection Board of India.",
      ],
    },
  ];
}

/** One-line purposes for the consent tick on each public form. */
export const CONSENT_PURPOSE = {
  lead_form: "contact me about my enquiry and tell me about its services",
  docs_form: "complete my KYC and open and service my investments",
  discovery_form: "understand my finances and recommend suitable investments",
} as const;
export type ConsentSource = keyof typeof CONSENT_PURPOSE | "email_notice";
