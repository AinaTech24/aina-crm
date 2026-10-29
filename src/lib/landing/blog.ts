/**
 * The public blog (/blog) — practical articles on what Mutual Fund
 * Distributors search for week to week. Each article answers one question
 * fully, then shows where AINA CRM helps. Keep regulatory statements general
 * and point readers to AMFI / SEBI for the current rule: an article that
 * misstates a circular costs more trust than it earns traffic.
 */

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  /** ISO date, India. */
  published: string;
  readMins: number;
  category: string;
  intro: string;
  sections: { h2: string; paras: string[]; bullets?: string[] }[];
  /** Which /solutions page the article leads to. */
  solution: string;
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "how-to-prepare-for-amfi-ddq-mutual-fund-distributors",
    title: "How to Prepare for the AMFI Distributor Due Diligence (DDQ): A Practical Checklist for MFDs",
    description:
      "What the AMFI distributor due diligence looks at, the records MFDs are usually asked for, and how to keep them ready all year instead of the week before the review.",
    keywords: ["AMFI DDQ", "distributor due diligence", "DDQ checklist for MFD", "MFD compliance", "AMFI due diligence questionnaire"],
    published: "2026-10-24",
    readMins: 6,
    category: "Compliance",
    intro:
      "Every year a set of mutual fund distributors is selected for AMFI's distributor due diligence. For a firm that keeps its records in inboxes and spreadsheets, the questionnaire turns into weeks of searching. It does not have to — most of what it asks about is evidence you create in ordinary work, if you record it as you go.",
    sections: [
      {
        h2: "What the due diligence looks at",
        paras: [
          "The exercise is carried out by AMFI with the help of audit firms. It reviews how a distributor's business is organised and controlled against SEBI rules and the AMFI Code of Conduct for intermediaries — including the business model, customer processes, compliance and risk management, and whether processes such as suitability are kept apart from sales and relationship management.",
          "The questionnaire and its scoring are revised from time to time, so always work from the latest version and FAQs published on the AMFI website.",
        ],
      },
      {
        h2: "Records MFDs are commonly asked to show",
        paras: ["The exact list depends on the current questionnaire, but these areas come up again and again:"],
        bullets: [
          "Client onboarding: KYC status and the documents collected",
          "Risk profiling and suitability: a risk profile for each client, and how recommendations relate to it",
          "Client communications: what was sent, with ARN/EUIN and the required disclaimers",
          "Consent and opt-outs: who agreed to receive what, and on which channel",
          "Complaints: a register with dates, resolution and turnaround",
          "Internal controls: who in the team can see and change client data",
        ],
      },
      {
        h2: "Make the evidence a by-product of daily work",
        paras: [
          "The firms that find the DDQ easy are not the ones that prepare hardest in the final month. They are the ones whose daily tools already leave a record: a risk profile captured and confirmed by the client, every outbound message checked before it is sent, every complaint logged with its date, every change to a client record attributable to a person.",
          "If you do one thing this quarter, pick the area where your records are weakest — often complaints or communications — and move it out of personal inboxes into one shared system.",
        ],
      },
      {
        h2: "Where AINA CRM helps",
        paras: [
          "AINA CRM runs every WhatsApp, email and SMS through a compliance check before it goes out, records consent per channel, lets clients fill and confirm their own risk profile by OTP, keeps a complaint register with SLA dates, and writes an audit trail of changes. None of it guarantees an outcome — but it means the evidence already exists when you are asked for it.",
        ],
      },
    ],
    solution: "ddq-compliance-for-mutual-fund-distributors",
  },
  {
    slug: "how-to-reduce-sip-bounces-mfd",
    title: "SIP Bounced? A Simple Follow-up Process MFDs Can Use to Reduce SIP Rejections",
    description:
      "Why SIP instalments get rejected, how to spot a bounce early from your RTA data, and a follow-up routine that keeps clients invested.",
    keywords: ["SIP bounce", "SIP rejection", "SIP mandate failed", "how to reduce SIP bounces", "SIP follow-up for MFD"],
    published: "2026-10-22",
    readMins: 5,
    category: "Client servicing",
    intro:
      "A rejected SIP instalment is easy to miss. The client may not notice, the bank message gets ignored, and by the time it shows up in a statement two instalments have gone. Each missed instalment is lost compounding for the client — and a weaker relationship for you.",
    sections: [
      {
        h2: "Common reasons a SIP instalment is rejected",
        bullets: [
          "Insufficient balance on the debit date",
          "Mandate not yet registered, rejected, or with a limit lower than the SIP amount",
          "Bank account closed or changed without updating the mandate",
          "Signature or account details not matching the bank's records",
        ],
        paras: ["Most of these are fixable in one conversation — if the conversation happens quickly."],
      },
      {
        h2: "Spot it from your RTA data, not the client's complaint",
        paras: [
          "CAMS and KFintech report rejected and reversed transactions in their feeds. If you import those regularly, you can see a bounce within days instead of weeks. The key is to look at rejections as a list of people to call, not as a report to file.",
        ],
      },
      {
        h2: "A follow-up routine that works",
        bullets: [
          "Same week: the client's RM calls or messages — explain what happened, without blame",
          "Find the cause: balance, mandate, or account change",
          "Fix it: a top-up, a new mandate, or a revised debit date",
          "Confirm: check the next instalment actually went through",
          "Record it: note the reason, so repeated bounces are visible",
        ],
        paras: [],
      },
      {
        h2: "Where AINA CRM helps",
        paras: [
          "AINA CRM imports your CAMS and KFintech data, flags SIP rejections on the client, and creates a follow-up task for their RM — so a bounce becomes a named person's to-do with a date, not a line in a file. You can send compliance-checked WhatsApp and email reminders from your own accounts.",
        ],
      },
    ],
    solution: "sip-tracking-software",
  },
  {
    slug: "excel-vs-crm-for-mutual-fund-distributors",
    title: "Excel vs CRM for Mutual Fund Distributors: When Spreadsheets Stop Working",
    description:
      "Spreadsheets get most MFDs started. Here are the signs your practice has outgrown them, and what to look for in a CRM built for mutual fund distribution.",
    keywords: ["Excel vs CRM", "CRM for mutual fund distributors", "MFD CRM", "spreadsheet to CRM", "mutual fund distributor software"],
    published: "2026-10-20",
    readMins: 5,
    category: "Practice management",
    intro:
      "Almost every MFD practice starts on Excel and WhatsApp, and for a while it works. Then the client list grows, an RM joins, a second branch opens — and the spreadsheet that one person understood becomes something nobody quite trusts.",
    sections: [
      {
        h2: "Signs you have outgrown spreadsheets",
        bullets: [
          "Follow-ups depend on someone remembering",
          "Two people keep two versions of the same client list",
          "You cannot answer 'what is pending this week?' without asking around",
          "Month-end business numbers differ depending on who prepared them",
          "When a team member leaves, their client notes leave with them",
          "Daily operations still need the owner to check everything",
        ],
        paras: [],
      },
      {
        h2: "Why a generic CRM is not always the answer",
        paras: [
          "Generic CRMs are designed around a sales pipeline: a contact becomes a deal, and the deal closes. A distributor's work begins after the first investment — SIPs to watch, families to review, requests to service, compliance to keep. Fitting that into a deal pipeline usually means heavy customisation.",
        ],
      },
      {
        h2: "What to look for in an MFD CRM",
        bullets: [
          "Imports from CAMS and KFintech, matched to the right client",
          "Clients grouped into families",
          "SIP tracking, with rejections flagged",
          "Review meetings and tasks with owners and due dates",
          "Access control: each RM sees the clients they should",
          "Compliance built into client communication",
          "Dashboards that show the owner what is done and what is pending",
        ],
        paras: [],
      },
      {
        h2: "Where AINA CRM fits",
        paras: [
          "AINA CRM is built specifically for Mutual Fund Distributors — leads, clients and families, SIPs and transactions, reviews, tasks and business tracking in one system, with your registrar data imported rather than retyped.",
        ],
      },
    ],
    solution: "crm-for-mutual-fund-distributors",
  },
  {
    slug: "cams-kfintech-rta-data-guide-for-mfds",
    title: "CAMS and KFintech Data Explained: How MFDs Can Use RTA Feeds to Run Their Practice",
    description:
      "What CAMS and KFintech registrar data contains, the common problems MFDs face with it, and how to turn it into a clean client book.",
    keywords: ["CAMS KFintech", "RTA feed for MFD", "CAMS mailback", "KFintech reports for distributors", "mutual fund back office"],
    published: "2026-10-18",
    readMins: 6,
    category: "Data & back office",
    intro:
      "CAMS and KFintech are the registrars and transfer agents (RTAs) that service Indian mutual funds. For a distributor, their data is the closest thing to the truth about what clients hold and what actually happened to each transaction.",
    sections: [
      {
        h2: "What RTA data gives a distributor",
        bullets: [
          "Investor and folio details",
          "Holdings and their value",
          "Transactions — purchases, SIP instalments, redemptions, switches — and their status",
          "SIP registrations and cancellations",
          "Rejected and reversed transactions",
        ],
        paras: [],
      },
      {
        h2: "Common problems with RTA data",
        paras: [
          "The data is accurate, but it is organised around folios, not around how you serve people. The same person can appear with small differences in name across folios; a client added by your team without a PAN can end up duplicated when the registrar data arrives; and families are not linked at all.",
        ],
      },
      {
        h2: "Turning RTA data into a client book",
        bullets: [
          "Match every folio to one client, using PAN wherever it exists",
          "Merge true duplicates instead of keeping both",
          "Group clients into families with one relationship manager",
          "Import regularly, so rejections and new SIPs are seen quickly",
          "Compare what your team booked with what the RTA processed",
        ],
        paras: [],
      },
      {
        h2: "Where AINA CRM helps",
        paras: [
          "AINA CRM imports CAMS and KFintech files, matches each row to the right client by PAN, links families, and checks the business your team booked against what the registrar processed — flagging anything rejected or missing.",
        ],
      },
    ],
    solution: "mutual-fund-software-for-distributors",
  },
  {
    slug: "client-review-meetings-mutual-fund-distributors",
    title: "How MFDs Can Run Client Review Meetings That Clients Value (and Remember)",
    description:
      "A simple structure for periodic client reviews — what to prepare, what to discuss, and how to make sure every action item actually happens.",
    keywords: ["client review meeting", "portfolio review for clients", "MFD client servicing", "annual review mutual fund", "client meeting checklist"],
    published: "2026-10-16",
    readMins: 5,
    category: "Client servicing",
    intro:
      "Regular reviews are where a distributor's relationship is built — and where it quietly erodes when they slip. A review that happens on time, is well prepared and ends with clear next steps is one of the most valuable things you can offer a client.",
    sections: [
      {
        h2: "Set a review rhythm per family",
        paras: [
          "Not every client needs the same frequency. Decide a cadence — quarterly, half-yearly or annual — per family, and let the next review date follow from the last one, so nobody has to remember.",
        ],
      },
      {
        h2: "Prepare in ten minutes, not an hour",
        bullets: [
          "Current holdings and SIPs for the whole family",
          "Changes since the last review: new investments, redemptions, stopped SIPs",
          "Whether the risk profile is still current",
          "Open requests or complaints",
          "Goals and upcoming needs the client mentioned last time",
        ],
        paras: [],
      },
      {
        h2: "End every meeting with owners and dates",
        paras: [
          "The most common failure in reviews is not the conversation, it is what happens after. Every action item — update a nominee, start a SIP, send a document — needs one owner and one due date, and the client should hear back when it is done.",
        ],
      },
      {
        h2: "Where AINA CRM helps",
        paras: [
          "AINA CRM keeps review schedules per family, records meetings and attendees, and turns each action item into a task with an owner and a due date when you save — so the follow-through is tracked, not hoped for.",
        ],
      },
    ],
    solution: "crm-for-mutual-fund-distributors",
  },
];

export function postBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

export function formatPostDate(iso: string): string {
  return new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
}
