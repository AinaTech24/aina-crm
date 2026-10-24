/**
 * The /solutions pages — one page per thing MFDs search for. Each page targets
 * one search phrase (in its title, H1, URL and first paragraph) and answers it
 * with what AINA CRM actually does. Keep every claim true of the product: a
 * page that ranks and then disappoints a visitor does the firm no good.
 *
 * Search phrases come from what ranks today for MFD software in India
 * (vendor and RTA pages target "mutual fund software for distributors",
 * "CRM for mutual fund distributors", "back office software for mutual fund
 * distributors"), plus two gaps no Indian vendor page covers yet: AMFI DDQ
 * compliance and SIP-rejection follow-up.
 */

export type SolutionPage = {
  slug: string;
  /** Short label for footers and the hub. */
  navLabel: string;
  /** <title> — the search phrase first, the brand last. */
  title: string;
  description: string;
  keywords: string[];
  kicker: string;
  h1: string;
  intro: string[];
  sections: { h2: string; body: string; bullets?: string[] }[];
  faqs: { q: string; a: string }[];
};

export const SOLUTION_PAGES: SolutionPage[] = [
  {
    slug: "crm-for-mutual-fund-distributors",
    navLabel: "CRM for Mutual Fund Distributors",
    title: "CRM for Mutual Fund Distributors in India | MFD CRM Software — AINA CRM",
    description:
      "AINA CRM is a CRM built for Mutual Fund Distributors (MFDs) in India: lead management, client and family records, SIP tracking, review meetings, team tasks and business dashboards in one place.",
    keywords: ["CRM for mutual fund distributors", "MFD CRM", "mutual fund distributor CRM", "CRM for MFD", "CRM software for MFD in India"],
    kicker: "MFD CRM software",
    h1: "CRM for Mutual Fund Distributors, built around the MFD day",
    intro: [
      "Most CRMs are built for a sales pipeline: contact, deal, closed. A mutual fund distributor's work does not stop at the sale. A client's SIPs need watching, their family needs reviewing, their requests need servicing — for years.",
      "AINA CRM is a CRM for Mutual Fund Distributors that follows the whole relationship: from the first enquiry, through onboarding and SIPs, to every review meeting and service request after it — with each follow-up assigned to a person and a date.",
    ],
    sections: [
      {
        h2: "Lead management for MFDs",
        body: "Capture enquiries from your website forms and referrals, track every conversation, and move each lead through clear stages until it becomes a client — without creating duplicates of people you already serve.",
        bullets: ["Lead capture forms for your own website", "Stage-wise leads board with follow-up dates", "Existing clients asking for a new product become opportunities, not new leads"],
      },
      {
        h2: "Client and family records in one place",
        body: "Every client's details, holdings, SIPs, documents, meetings and history sit on one record, and clients are grouped into families with a single relationship manager.",
        bullets: ["Client 360 summary on every record", "Family mapping — change the family's RM once and every member follows", "The right fields for each client type: individual, minor, HUF, NRI, company, trust"],
      },
      {
        h2: "Reviews, meetings and tasks your team cannot forget",
        body: "Schedule client reviews, record attendees, and turn every action item into a task with an owner and a due date. Overdue work is visible to the people who supervise it.",
      },
      {
        h2: "Dashboards for every role",
        body: "Owners, branch heads, relationship managers and operations each open to their own dashboard — and each person only sees the clients and figures they are allowed to see.",
      },
    ],
    faqs: [
      {
        q: "What is the best CRM for mutual fund distributors?",
        a: "The best CRM for an MFD is one built around mutual fund work — RTA data from CAMS and KFintech, SIPs, families, client reviews and compliance — rather than a generic sales pipeline. AINA CRM is built specifically for Indian Mutual Fund Distributors.",
      },
      {
        q: "Can I import my existing clients into the CRM?",
        a: "Yes. Your CAMS and KFintech history — folios, transactions and SIPs — is imported and matched to the right client by PAN, so clients are not duplicated and families link as they load.",
      },
      {
        q: "Can each relationship manager see only their own clients?",
        a: "Yes. Access is set per person: the whole firm, one branch, a team, or only their own clients. Dashboards, lists and exports follow the same rule.",
      },
    ],
  },
  {
    slug: "mutual-fund-software-for-distributors",
    navLabel: "Mutual Fund Software for Distributors",
    title: "Mutual Fund Software for Distributors in India | Back Office + CRM — AINA CRM",
    description:
      "Mutual fund software for distributors that combines back office and CRM: CAMS & KFintech imports, AUM and SIP book, business tracking against the RTA, client servicing and team management.",
    keywords: ["mutual fund software for distributors", "mutual fund software in India", "back office software for mutual fund distributors", "MFD back office software", "best mutual fund software for distributors"],
    kicker: "Back office + CRM",
    h1: "Mutual fund software for distributors — back office and CRM in one",
    intro: [
      "Many MFD firms run two systems: back-office software for portfolios and reports, and spreadsheets or WhatsApp for everything the team does with clients. The gap between them is where follow-ups get missed.",
      "AINA CRM is mutual fund software for distributors that keeps both together — the registrar data your back office needs, and the leads, tasks, reviews and service requests your team works on every day.",
    ],
    sections: [
      {
        h2: "CAMS and KFintech data, matched to the right client",
        body: "Upload your RTA files and AINA CRM builds folios, transactions and SIPs, matched to clients by PAN. A client you already have is updated, not duplicated, and history follows the folio.",
        bullets: ["Folios, holdings, transactions and SIPs from RTA files", "AUM valued from daily NAVs", "Family linking as data loads"],
      },
      {
        h2: "Business tracking that agrees with the registrar",
        body: "Business your team books is checked against the CAMS and KFintech feed line by line, and anything rejected, mismatched or not found is flagged — so targets and incentives rest on facts.",
      },
      {
        h2: "SIP book and SIP exceptions",
        body: "See the live SIP book, SIPs added and stopped, and the SIP rejections that need a follow-up — each one with a task on the client.",
      },
      {
        h2: "More than mutual funds",
        body: "Track insurance policies and claims, fixed deposits with maturity reminders, and other products your clients hold with you, alongside their mutual funds.",
      },
    ],
    faqs: [
      {
        q: "What is mutual fund software for distributors?",
        a: "It is software that helps an MFD manage client portfolios, RTA data, SIPs, reports and servicing. AINA CRM combines this back-office data with a CRM for leads, tasks, reviews and team management.",
      },
      {
        q: "Does AINA CRM execute mutual fund transactions?",
        a: "No. AINA CRM is a practice-management, analytics and communication platform. Transactions are placed on your usual platforms, and AINA CRM tracks them through to the RTA.",
      },
      {
        q: "Which RTA files does it support?",
        a: "AINA CRM imports data from CAMS and KFintech, the two registrars that service Indian mutual funds.",
      },
    ],
  },
  {
    slug: "ddq-compliance-for-mutual-fund-distributors",
    navLabel: "AMFI DDQ Compliance for MFDs",
    title: "AMFI DDQ Compliance for Mutual Fund Distributors | Due Diligence Ready — AINA CRM",
    description:
      "Prepare for the AMFI distributor due diligence (DDQ) with records kept as you work: consent, client-confirmed risk profiles, a complaint register, compliance checks on every message and a full audit trail.",
    keywords: ["DDQ compliance for MFD", "AMFI due diligence for distributors", "distributor due diligence questionnaire", "MFD compliance software", "AMFI DDQ"],
    kicker: "Compliance",
    h1: "AMFI DDQ compliance for Mutual Fund Distributors — ready every day",
    intro: [
      "AMFI's distributor due diligence reviews how an MFD firm runs: its customer processes, its complaints, its compliance and risk management, and whether sales are kept apart from suitability. When the records live in inboxes and spreadsheets, preparing takes weeks.",
      "AINA CRM keeps the records a DDQ asks about as part of daily work, so the evidence is already there when it is needed.",
    ],
    sections: [
      {
        h2: "Compliance checks on every client message",
        body: "Every WhatsApp, email and SMS passes the same compliance check before it is sent — ARN and EUIN, disclaimers, return-related language, consent and opt-out. A message that fails is not sent, and the result is recorded.",
      },
      {
        h2: "Consent and suitability on record",
        body: "Consent is recorded per channel, and an opt-out always blocks. Risk profiles can be filled by the client through a secure link and confirmed with their own OTP, and each client's portfolio can be compared with their risk profile.",
      },
      {
        h2: "Complaints with their timelines",
        body: "Complaints are registered with a ticket number and a 21-day SLA, routed to the compliance officer, and can also come in through a complaint form on your own website.",
      },
      {
        h2: "An audit trail of every change",
        body: "Client edits, reassignments, messages and decisions are written to an audit trail, so you can show who did what and when.",
      },
    ],
    faqs: [
      {
        q: "What is the AMFI DDQ for mutual fund distributors?",
        a: "It is AMFI's due diligence exercise for distributors, carried out with audit firms, which reviews a distributor's organisation, customer processes, compliance, risk management and controls against SEBI rules and the AMFI Code of Conduct.",
      },
      {
        q: "How does a CRM help with DDQ compliance?",
        a: "A CRM keeps the evidence a due diligence review looks for — consent, risk profiles, complaints, communications and an audit trail — recorded as the work happens, instead of being assembled before the review.",
      },
      {
        q: "Does AINA CRM guarantee a DDQ outcome?",
        a: "No software can guarantee an outcome. AINA CRM helps you keep orderly records and consistent processes, which is what a due diligence review examines.",
      },
    ],
  },
  {
    slug: "sip-tracking-software",
    navLabel: "SIP Tracking & SIP Rejection Follow-up",
    title: "SIP Tracking Software for Mutual Fund Distributors | SIP Rejection Follow-up — AINA CRM",
    description:
      "SIP tracking software for MFDs: a live SIP book from CAMS & KFintech data, SIP rejections flagged with a follow-up task, and reminders so no bounced SIP goes unnoticed.",
    keywords: ["SIP tracking software", "SIP rejection follow-up", "SIP bounce tracking", "SIP book for MFD", "SIP management software for distributors"],
    kicker: "SIP tracking",
    h1: "SIP tracking software that catches every rejected SIP",
    intro: [
      "A bounced SIP is often found weeks later, in a statement, after the client has missed an instalment. By then it is a harder conversation.",
      "AINA CRM tracks every SIP from your CAMS and KFintech data and turns a rejection into a follow-up task on the client, assigned to their relationship manager.",
    ],
    sections: [
      {
        h2: "A live SIP book",
        body: "See active SIPs, their monthly value, and SIPs added and stopped in any period — for the firm, a branch, or one relationship manager.",
      },
      {
        h2: "SIP rejections flagged with a follow-up",
        body: "When the RTA feed reports a rejected or bounced instalment, it is flagged on the client and a follow-up task is created, so the RM knows exactly whom to call.",
      },
      {
        h2: "Reminders that reach the client",
        body: "Send compliance-checked WhatsApp and email reminders from your own accounts, using templates your team can reuse.",
      },
      {
        h2: "SIPs in every dashboard",
        body: "SIP book and SIP exceptions appear on the owner, branch head and RM dashboards, each limited to the clients that person may see.",
      },
    ],
    faqs: [
      {
        q: "How do mutual fund distributors track SIPs?",
        a: "Most MFDs rely on RTA data from CAMS and KFintech. AINA CRM imports that data, keeps a live SIP book, and highlights SIPs that were rejected or stopped.",
      },
      {
        q: "What happens when a client's SIP bounces?",
        a: "AINA CRM flags the rejection from the RTA feed and creates a follow-up task on the client for their relationship manager.",
      },
      {
        q: "Can I see SIPs for each relationship manager?",
        a: "Yes. The SIP book and SIP exceptions can be viewed for the whole firm, a branch, or a single relationship manager.",
      },
    ],
  },
];

export function solutionBySlug(slug: string): SolutionPage | undefined {
  return SOLUTION_PAGES.find((p) => p.slug === slug);
}
