/**
 * The WhatsApp templates every firm needs, created and sent to Meta for approval
 * the moment the firm connects its own WhatsApp channel (Vartify). Pure data —
 * `whatsapp-provision.ts` writes them and submits them.
 *
 * Two kinds, because Meta prices and judges them differently:
 *   - UTILITY   — a message about something the client already has or asked for
 *                 (a SIP, a meeting, a document, a premium). No promotion.
 *   - MARKETING — greetings, invitations and nudges. Opt-in only; each carries
 *                 the AMFI market-risk line, the firm's name + ARN and an opt-out.
 *
 * Rules the bodies follow (Meta rejects a template that breaks them, and
 * `tests/whatsapp-catalogue.test.ts` pins them):
 *   - a variable is never the first or last thing in the body, and two never
 *     touch — text always sits between them;
 *   - variables are declared in the order they first appear, because a send
 *     fills Meta's positional {{1}}, {{2}}… from the declared list;
 *   - every variable has a realistic `example`: Meta reviews the sample values;
 *   - no returns are promised, no scheme is recommended.
 *
 * Variable keys are the CRM's own merge fields, so a template works unchanged
 * from a workflow, the client page's Send message and the compose form:
 *   investor.first_name / investor.rm_name   — the client and their RM
 *   transaction.*                            — filled from the client's latest record
 *   firm_sign_off                            — "Legal name (ARN-123456)", from the firm
 *   link.risk_profile                        — the client's own questionnaire link
 *   anything else                            — passed by the caller (workflow / compose form)
 */

export type CatalogueVariable = {
  key: string;
  type: "string" | "number" | "currency" | "date" | "boolean" | "url";
  /** Shown to Meta as the sample value for this placeholder. */
  example: string;
  fallback?: string;
};

export type CatalogueTemplate = {
  /** Also the Meta template name: lowercase letters, digits, underscore. */
  key: string;
  name: string;
  description: string;
  category: "utility" | "marketing";
  /** Where the firm would use it — shown in Settings. */
  useFor: string;
  body: string;
  footer?: string;
  variables: CatalogueVariable[];
};

export const WA_LANGUAGE = "en_US";

const NAME: CatalogueVariable = { key: "investor.first_name", type: "string", example: "Rahul", fallback: "there" };
const RM: CatalogueVariable = { key: "investor.rm_name", type: "string", example: "Priya Shah", fallback: "your relationship manager" };
const SIGN: CatalogueVariable = { key: "firm_sign_off", type: "string", example: "Shah Wealth Advisors LLP (ARN-123456)" };
const SCHEME: CatalogueVariable = { key: "transaction.scheme_name", type: "string", example: "Axis Bluechip Fund" };
const AMOUNT: CatalogueVariable = { key: "transaction.amount", type: "string", example: "10,000" };
const TXN_DATE: CatalogueVariable = { key: "transaction.transaction_date", type: "string", example: "05 Nov 2026" };
const REASON: CatalogueVariable = { key: "transaction.rejection_reason", type: "string", example: "insufficient balance" };

/** The AMFI line the compliance gate looks for on every marketing message. */
const RISK = "Mutual fund investments are subject to market risks. Read all scheme related documents carefully.";
const OPT_OUT = "Reply STOP to opt out.";

const sign = (tail: string) => `— {{firm_sign_off}}.${tail ? ` ${tail}` : ""}`;

export const WHATSAPP_TEMPLATES: CatalogueTemplate[] = [
  // ───────────────────────────── UTILITY ─────────────────────────────
  {
    key: "wa_welcome_new_client",
    name: "Welcome — new client",
    description: "Sent once a client's account is set up.",
    category: "utility",
    useFor: "New client onboarded",
    body:
      "Hi {{investor.first_name}}, welcome aboard! Your investor profile is now set up, and {{investor.rm_name}} is your point of contact for anything you need with your investments.\n\n" +
      sign(""),
    variables: [NAME, RM, SIGN],
  },
  {
    key: "wa_sip_registered",
    name: "SIP registered",
    description: "Confirms a new SIP has been registered.",
    category: "utility",
    useFor: "New SIP registered",
    body:
      "Hi {{investor.first_name}}, your SIP of ₹{{transaction.amount}} in {{transaction.scheme_name}} has been registered with the first instalment on {{transaction.transaction_date}}. Please keep enough balance in your bank account on the debit date.\n\n" +
      sign(""),
    variables: [NAME, AMOUNT, SCHEME, TXN_DATE, SIGN],
  },
  {
    key: "wa_sip_rejected",
    name: "SIP rejected",
    description: "Tells the client a SIP instalment failed and who will help.",
    category: "utility",
    useFor: "SIP rejection follow-up",
    body:
      "Hi {{investor.first_name}}, your SIP instalment of ₹{{transaction.amount}} in {{transaction.scheme_name}} due on {{transaction.transaction_date}} could not be processed. Reason: {{transaction.rejection_reason}}. {{investor.rm_name}} will get in touch to help you fix this so the next instalment is not missed.\n\n" +
      sign(""),
    variables: [NAME, AMOUNT, SCHEME, TXN_DATE, REASON, RM, SIGN],
  },
  {
    key: "wa_sip_debit_reminder",
    name: "SIP debit reminder",
    description: "A reminder before an instalment is debited.",
    category: "utility",
    useFor: "Day before a SIP debit",
    body:
      "Hi {{investor.first_name}}, a reminder that your SIP of ₹{{transaction.amount}} in {{transaction.scheme_name}} will be debited from your bank account on {{sip_debit_date}}. Please keep enough balance so it goes through.\n\n" +
      sign(""),
    variables: [
      NAME,
      AMOUNT,
      SCHEME,
      { key: "sip_debit_date", type: "string", example: "07 Nov 2026" },
      SIGN,
    ],
  },
  {
    key: "wa_mandate_expiry",
    name: "Bank mandate expiring",
    description: "Asks the client to renew an expiring SIP mandate.",
    category: "utility",
    useFor: "Mandate close to expiry",
    body:
      "Hi {{investor.first_name}}, the bank mandate behind your SIPs expires on {{mandate_expiry_date}}. Please renew it so your SIPs continue without a break. {{investor.rm_name}} can help you with the form.\n\n" +
      sign(""),
    variables: [NAME, { key: "mandate_expiry_date", type: "string", example: "30 Nov 2026" }, RM, SIGN],
  },
  {
    key: "wa_transaction_received",
    name: "Transaction request received",
    description: "Acknowledges a purchase or redemption request.",
    category: "utility",
    useFor: "Purchase / redemption booked",
    body:
      "Hi {{investor.first_name}}, we have received your {{transaction_type}} request of ₹{{transaction.amount}} in {{transaction.scheme_name}} dated {{transaction.transaction_date}}. It will reflect in your account once the fund house has processed it.\n\n" +
      sign(""),
    variables: [
      NAME,
      { key: "transaction_type", type: "string", example: "purchase" },
      AMOUNT,
      SCHEME,
      TXN_DATE,
      SIGN,
    ],
  },
  {
    key: "wa_kyc_pending",
    name: "KYC pending",
    description: "Asks for the details needed to finish a client's KYC.",
    category: "utility",
    useFor: "KYC not yet complete",
    body:
      "Hi {{investor.first_name}}, your KYC is not complete yet. Please share the pending details or documents with {{investor.rm_name}} so we can finish it. Investments can be placed only after your KYC is verified.\n\n" +
      sign(""),
    variables: [NAME, RM, SIGN],
  },
  {
    key: "wa_risk_profile_link",
    name: "Risk profile link",
    description: "Sends the client their own questionnaire link.",
    category: "utility",
    useFor: "Risk profile due or missing",
    body:
      "Hi {{investor.first_name}}, please take two minutes to complete your risk profile questionnaire here: {{link.risk_profile}}\nThe link is valid for 21 days. Your answers help us keep your investments in line with your comfort with risk.\n\n" +
      sign(""),
    variables: [NAME, { key: "link.risk_profile", type: "url", example: "https://crm.example.com/r/AbC123xyz" }, SIGN],
  },
  {
    key: "wa_meeting_confirmed",
    name: "Meeting confirmed",
    description: "Confirms a scheduled review meeting.",
    category: "utility",
    useFor: "Review meeting scheduled",
    body:
      "Hi {{investor.first_name}}, your review meeting with {{investor.rm_name}} is confirmed for {{meeting_date}} at {{meeting_time}}. Please reply here if you need to reschedule.\n\n" +
      sign(""),
    variables: [
      NAME,
      RM,
      { key: "meeting_date", type: "string", example: "12 Nov 2026" },
      { key: "meeting_time", type: "string", example: "11:30 AM" },
      SIGN,
    ],
  },
  {
    key: "wa_meeting_reminder",
    name: "Meeting reminder",
    description: "A reminder shortly before a review meeting.",
    category: "utility",
    useFor: "Day before a meeting",
    body:
      "Hi {{investor.first_name}}, a reminder of your meeting with {{investor.rm_name}} on {{meeting_date}} at {{meeting_time}}. We look forward to speaking with you.\n\n" +
      sign(""),
    variables: [
      NAME,
      RM,
      { key: "meeting_date", type: "string", example: "12 Nov 2026" },
      { key: "meeting_time", type: "string", example: "11:30 AM" },
      SIGN,
    ],
  },
  {
    key: "wa_document_request",
    name: "Document request",
    description: "Asks the client for a specific document.",
    category: "utility",
    useFor: "A document is needed to proceed",
    body:
      "Hi {{investor.first_name}}, to complete your request we need your {{document_name}}. Please share a clear copy here or with {{investor.rm_name}}.\n\n" +
      sign(""),
    variables: [NAME, { key: "document_name", type: "string", example: "cancelled cheque" }, RM, SIGN],
  },
  {
    key: "wa_service_request_update",
    name: "Service request update",
    description: "Tells the client where their request stands.",
    category: "utility",
    useFor: "Service request or complaint status changes",
    body:
      "Hi {{investor.first_name}}, here is an update on your request {{ticket_no}}: {{request_status}}. Reply here if you need anything else.\n\n" +
      sign(""),
    variables: [
      NAME,
      { key: "ticket_no", type: "string", example: "SR-2026-00412" },
      { key: "request_status", type: "string", example: "completed" },
      SIGN,
    ],
  },
  {
    key: "wa_insurance_premium_due",
    name: "Insurance premium due",
    description: "Reminds the client of an upcoming premium.",
    category: "utility",
    useFor: "Premium due soon",
    body:
      "Hi {{investor.first_name}}, the premium of ₹{{premium_amount}} for your {{policy_name}} policy is due on {{premium_due_date}}. Paying on time keeps your cover active.\n\n" +
      sign(""),
    variables: [
      NAME,
      { key: "premium_amount", type: "string", example: "24,500" },
      { key: "policy_name", type: "string", example: "term life" },
      { key: "premium_due_date", type: "string", example: "20 Nov 2026" },
      SIGN,
    ],
  },

  // ───────────────────────────── MARKETING ─────────────────────────────
  {
    key: "wa_birthday_wishes",
    name: "Birthday wishes",
    description: "A birthday greeting.",
    category: "marketing",
    useFor: "Client's birthday",
    body:
      "Happy Birthday, {{investor.first_name}}! 🎂 Wishing you good health, happiness and a wonderful year ahead.\n\n" +
      `${RISK}\n` +
      sign(OPT_OUT),
    variables: [NAME, SIGN],
  },
  {
    key: "wa_festival_greeting",
    name: "Festival greeting",
    description: "A greeting for a festival or the new year.",
    category: "marketing",
    useFor: "Diwali, new year and other festivals",
    body:
      "Dear {{investor.first_name}}, wishing you and your family a very happy {{festival_name}}. May the year ahead bring you peace and prosperity.\n\n" +
      `${RISK}\n` +
      sign(OPT_OUT),
    variables: [NAME, { key: "festival_name", type: "string", example: "Diwali" }, SIGN],
  },
  {
    key: "wa_start_sip_invite",
    name: "Start a SIP",
    description: "Invites a client to begin or increase a SIP.",
    category: "marketing",
    useFor: "Clients with no SIP, or a SIP that could be topped up",
    body:
      "Hi {{investor.first_name}}, investing a little every month is an easy way to build a habit. A SIP lets you start with a small amount and stay regular whatever the market is doing. Message {{investor.rm_name}} if you would like to start one or increase your current SIP.\n\n" +
      `${RISK}\n` +
      sign(OPT_OUT),
    variables: [NAME, RM, SIGN],
  },
  {
    key: "wa_portfolio_review_invite",
    name: "Portfolio review invite",
    description: "Invites a client to book their periodic review.",
    category: "marketing",
    useFor: "Review due",
    body:
      "Hi {{investor.first_name}}, it is time for your periodic portfolio review. Reply to this message or call {{investor.rm_name}} to choose a time that suits you.\n\n" +
      `${RISK}\n` +
      sign(OPT_OUT),
    variables: [NAME, RM, SIGN],
  },
  {
    key: "wa_tax_saving_reminder",
    name: "Tax-saving reminder",
    description: "A nudge before the financial year closes.",
    category: "marketing",
    useFor: "January to March",
    body:
      "Hi {{investor.first_name}}, the financial year is closing on {{fy_end_date}}. If you would like to look at tax-saving options such as ELSS, speak to {{investor.rm_name}} before then.\n\n" +
      `${RISK}\n` +
      sign(OPT_OUT),
    variables: [NAME, { key: "fy_end_date", type: "string", example: "31 March" }, RM, SIGN],
  },
  {
    key: "wa_insurance_review_invite",
    name: "Insurance cover check",
    description: "Invites a client to review their insurance cover.",
    category: "marketing",
    useFor: "Clients with no recorded cover, or a policy due for review",
    body:
      "Hi {{investor.first_name}}, when did you last review your insurance cover? A quick check shows whether your life and health cover still match your family's needs. {{investor.rm_name}} is happy to help.\n\n" +
      "Insurance is the subject matter of solicitation.\n" +
      `${RISK}\n` +
      sign(OPT_OUT),
    variables: [NAME, RM, SIGN],
  },
  {
    key: "wa_referral_invite",
    name: "Introduce a friend",
    description: "Asks a happy client to introduce someone.",
    category: "marketing",
    useFor: "After a good review or milestone",
    body:
      "Hi {{investor.first_name}}, if a friend or family member could use help with their investments, you are welcome to introduce them. Reply with their name and number and {{investor.rm_name}} will get in touch, with their consent.\n\n" +
      `${RISK}\n` +
      sign(OPT_OUT),
    variables: [NAME, RM, SIGN],
  },
  {
    key: "wa_checkin_inactive",
    name: "We have not spoken in a while",
    description: "Re-opens a conversation with a quiet client.",
    category: "marketing",
    useFor: "No contact for months",
    body:
      "Hi {{investor.first_name}}, it has been a while since we last spoke. If your goals or plans have changed, {{investor.rm_name}} would be glad to go through your investments with you.\n\n" +
      `${RISK}\n` +
      sign(OPT_OUT),
    variables: [NAME, RM, SIGN],
  },
  {
    key: "wa_investor_session_invite",
    name: "Investor session invite",
    description: "Invites clients to a seminar or webinar.",
    category: "marketing",
    useFor: "Client education sessions",
    body:
      "Hi {{investor.first_name}}, you are invited to our investor session on {{session_topic}} on {{session_date}}. Reply YES to reserve your seat.\n\n" +
      `${RISK}\n` +
      sign(OPT_OUT),
    variables: [
      NAME,
      { key: "session_topic", type: "string", example: "planning for your child's education" },
      { key: "session_date", type: "string", example: "22 Nov 2026" },
      SIGN,
    ],
  },
];

export const UTILITY_COUNT = WHATSAPP_TEMPLATES.filter((t) => t.category === "utility").length;
export const MARKETING_COUNT = WHATSAPP_TEMPLATES.filter((t) => t.category === "marketing").length;

/** The sample value for every variable of a template, keyed by variable key. */
export function sampleTokens(t: CatalogueTemplate): Record<string, string> {
  return Object.fromEntries(t.variables.map((v) => [v.key, v.example]));
}
