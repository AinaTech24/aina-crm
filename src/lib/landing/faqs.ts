/**
 * Homepage FAQ — the questions MFDs search for when they look for practice
 * software. Rendered visibly on the homepage and as FAQPage structured data,
 * so the two can never disagree.
 */
export const HOME_FAQS: { q: string; a: string }[] = [
  {
    q: "What is the best CRM for mutual fund distributors in India?",
    a: "The right CRM for an MFD is one built around mutual fund work — CAMS and KFintech data, SIPs, families, client reviews, team tasks and compliance — not a generic sales pipeline. AINA CRM is built specifically for Indian Mutual Fund Distributors.",
  },
  {
    q: "What is mutual fund software for distributors?",
    a: "It is software that helps a distributor manage client data, portfolios, SIPs, transactions, reports and servicing. AINA CRM combines this back-office data with a CRM for leads, meetings, tasks and business tracking.",
  },
  {
    q: "Do I have to type my existing clients in again?",
    a: "No. Your CAMS and KFintech history — folios, transactions and SIPs — is imported and matched to the right client by PAN, so clients are not duplicated and families link as the data loads.",
  },
  {
    q: "Can each relationship manager see only their own clients?",
    a: "Yes. Access is set per person: the whole firm, one branch, a team, or only their own clients. Dashboards, lists and exports all follow the same rule.",
  },
  {
    q: "How does AINA CRM help with AMFI DDQ compliance?",
    a: "Every WhatsApp, email and SMS passes a compliance check before it is sent, consent is recorded per channel, clients can confirm their risk profile by OTP, complaints are logged with their SLA, and changes are kept in an audit trail — the records a due diligence review asks about.",
  },
  {
    q: "How do I track SIP bounces and rejections?",
    a: "AINA CRM reads SIP rejections from your CAMS and KFintech data, flags them on the client, and creates a follow-up task for the client's relationship manager.",
  },
  {
    q: "Can I send WhatsApp and email messages to clients from the CRM?",
    a: "Yes. Messages go out from your own connected WhatsApp, email and SMS accounts, and each one is compliance-checked before it is sent.",
  },
  {
    q: "Does AINA CRM execute mutual fund transactions?",
    a: "No. AINA CRM is a practice-management, analytics and communication platform. You transact on your usual platforms, and AINA CRM tracks each transaction through to the RTA.",
  },
  {
    q: "Is my clients' data secure?",
    a: "Each firm's data is isolated at the database level, access is controlled per person, sign-in supports two-factor authentication, and application data is hosted in India.",
  },
  {
    q: "How much does AINA CRM cost?",
    a: "AINA CRM is priced per user per year, with no fees linked to your AUM. Book a demo and we will share the plan that fits your team.",
  },
];
