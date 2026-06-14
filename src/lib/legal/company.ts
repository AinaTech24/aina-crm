/**
 * Company / legal-entity details rendered on the public legal pages
 * (/terms, /privacy, /refund) and printed on GST invoices/receipts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ⚠️  ACTION REQUIRED BEFORE COMMERCIAL LAUNCH
 *  Replace every value marked `TODO` below with your REGISTERED legal-entity
 *  details, then have the resulting Terms / Privacy / Refund pages reviewed by
 *  a lawyer. The text on those pages is a professional starting point for an
 *  India-based B2B SaaS — it is NOT legal advice and must be reviewed before
 *  you rely on it commercially.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const LEGAL = {
  /** Product / brand name shown to users. */
  brand: "Aina",
  /** Registered legal entity that operates the platform. */
  legalEntity: "AinaTech", // TODO: e.g. "AinaTech Technologies Private Limited"
  /** Registered office address (single line is fine). */
  address: "India", // TODO: full registered office address
  /** Public support / contact email. */
  email: "support@ainatech.in", // TODO
  /** Support / grievance phone (optional — leave "" to hide). */
  phone: "", // TODO
  /** GST registration number — printed on invoices. */
  gstin: "", // TODO
  /** CIN, if a company. */
  cin: "", // TODO
  /**
   * Grievance Officer — naming one is required under India's DPDP Act 2023
   * and the IT (Intermediary Guidelines) Rules. Use a real, monitored inbox.
   */
  grievanceOfficer: "Grievance Officer", // TODO: a named individual
  grievanceEmail: "grievance@ainatech.in", // TODO
  /** Governing-law city for dispute jurisdiction. */
  jurisdiction: "Mumbai, Maharashtra, India", // TODO
  /** Canonical product URL. */
  url: "https://crm.ainatech.in",
  /**
   * Shown as "Last updated" on each legal page. This is intentionally a fixed
   * string (not the render date): a legal document's effective date should
   * only change when you actually revise the text. Bump it when you edit.
   */
  lastUpdated: "14 June 2026",
} as const;

/**
 * Third-party sub-processors the platform relies on. Disclosed in the Privacy
 * Policy (DPDP transparency) and useful for a customer DPA. Keep in sync with
 * the adapters in src/lib/comms/adapters and the storage/billing config.
 */
export const SUBPROCESSORS: ReadonlyArray<{ name: string; purpose: string; region: string }> = [
  { name: "Amazon Web Services (AWS)", purpose: "Application hosting, database & encrypted file storage", region: "Mumbai (ap-south-1), India" },
  { name: "Razorpay", purpose: "Subscription billing & payment processing", region: "India" },
  { name: "Resend", purpose: "Transactional & campaign email delivery", region: "United States / EU" },
  { name: "AiSensy", purpose: "WhatsApp Business messaging (BSP)", region: "India" },
  { name: "MSG91", purpose: "DLT-compliant transactional SMS", region: "India" },
  { name: "Anthropic", purpose: "AI assistance (message drafting & classification)", region: "United States" },
] as const;
