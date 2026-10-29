import type { StarterGuide } from "./types";

export const COMPLIANCE_GUIDES: StarterGuide[] = [
  {
    slug: "guide-documents",
    folder: "guide-compliance",
    title: "Documents — one place for every file",
    hook: "Upload client and firm documents, tag them, and watch expiry dates.",
    minutes: 2,
    shots: [{ file: "documents", caption: "Documents with total, expiring-in-30-days and expired counts." }],
    body: `The Documents module keeps files in one searchable library instead of in email and folders.

![Documents](shot:1)

## Upload

1. Open **Compliance → Documents** and click **Upload document**.
2. Choose the file, give it a name and category, link it to a client if it belongs to one, and add an expiry date if it has one.
3. Save.

## Find and track

- The tiles show **Total documents**, **Expiring (30d)** and **Expired**.
- Search by document name, description or client, or filter by **Category**.
- **Export** downloads the list.`,
  },
  {
    slug: "guide-ddq-readiness",
    folder: "guide-compliance",
    title: "DDQ readiness — the AMFI audit checklist",
    hook: "A score out of 100 for your AMFI Due Diligence Questionnaire readiness, with expiry watch and an audit trail.",
    minutes: 3,
    shots: [{ file: "ddq", caption: "Compliance & DDQ readiness: the score, its seven parts and the expiry watch." }],
    body: `This page tells you how ready the firm would be for an AMFI due-diligence audit, and what to fix first.

![DDQ readiness](shot:1)

## Read the score

1. Open **Compliance → DDQ readiness**. The **DDQ readiness score** is out of 100; click **Recalculate score** to refresh it.
2. The seven parts each show a score: **NISM validity**, **ARN renewal**, **KYD docs**, **Complaint register**, **Empanelment docs**, **SOP sign-off**, **Audit trail** and **Consent ledger**. A part near zero is your next task.
3. **Expiry watch** lists upcoming ARN, NISM, EUIN, CKYC and empanelment expiries. **Pending approvals** lists templates awaiting compliance approval, and a **Recent audit trail** sits below.

## Checklists

- **AMFI DDQ audit checklist** (Open checklist) walks the questionnaire item by item.
- **DDQ compliance registers** (Open registers) holds the registers an auditor asks for.`,
  },
  {
    slug: "guide-nomination-compliance",
    folder: "guide-compliance",
    title: "Nomination compliance",
    hook: "Find individual clients with no nominee on record and fix them, starting with the largest AUM.",
    minutes: 2,
    shots: [{ file: "nomination-tracker", caption: "Nomination Compliance: coverage, missing nominees and AUM exposed." }],
    body: `Nomination is a SEBI requirement for individual investors.

![Nomination compliance](shot:1)

1. Open **Insights → Reports → Nomination compliance**.
2. The tiles show **Clients**, **Coverage** (the share with a nominee), **Missing nominee** and the **AUM exposed**.
3. The list "Missing nominee — top by AUM" shows each client, segment, KYC status, RM and AUM. Click **Add nominee** to open the client and record one.

Only individual clients (including NRIs and sole proprietors) nominate. Minors, HUFs and entities are not counted as missing, and an individual can have a recorded opt-out.`,
  },
  {
    slug: "guide-audit-log",
    folder: "guide-compliance",
    title: "Audit log",
    hook: "A record of who did what and when, kept for seven years, with PII access flagged.",
    minutes: 2,
    shots: [{ file: "audit-log", caption: "Audit log filters and the most recent events." }],
    body: `The audit log records the important actions in the CRM.

![Audit log](shot:1)

1. Open **Compliance → Audit log**.
2. The tiles show the events in the window, **PII access events**, the window (7 days by default) and the **retention** (7 years).
3. Filter by actor type, user, period and action text (for example "investor"), or tick **PII only**, then click **Apply**.
4. Click the arrow on a row to see the details of the change.
5. **Export CSV** downloads the result.

Each row shows when, who and what: for example lead.update, insurance.create or goal.create, with the record concerned.`,
  },
  {
    slug: "guide-legal-registrations",
    folder: "guide-compliance",
    title: "Legal registrations and expiry",
    hook: "Track ARN, EUIN, NISM, empanelments and other registrations with renewal dates.",
    minutes: 2,
    shots: [{ file: "legal-registrations", caption: "Legal registrations with renewal and expiry counts." }],
    body: `Keep every registration the firm and its people depend on in one list, so none lapses unnoticed.

![Legal registrations](shot:1)

1. Open **Compliance → Legal registrations** and click **Add registration** (or **Add the first registration**).
2. Choose the type, enter the number, the issuing body and the validity dates and save.
3. The tiles show **Total**, **Active**, **Pending renewal**, **Expiring ≤ 60d** and **Expired**. The chips filter the list.
4. Upcoming expiries also feed the **Expiry watch** on the DDQ readiness page.`,
  },
  {
    slug: "guide-sub-distributors",
    folder: "guide-compliance",
    title: "Sub-distributors",
    hook: "Register the sub-brokers and referrers who work with your ARN.",
    minutes: 2,
    shots: [{ file: "sub-distributors", caption: "Sub-distributors by status." }],
    body: `Maintain a register of the sub-distributors you work with.

![Sub-distributors](shot:1)

1. Open **Compliance → Sub-distributors** and click **Add sub-distributor** (or **Register the first sub-distributor**).
2. Enter their details and registration, and save.
3. Filter the register by **Active**, **Inactive**, **Terminated** or **All**, and **Export** it.`,
  },
];
