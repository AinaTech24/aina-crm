import type { StarterGuide } from "./types";

export const DATA_GUIDES: StarterGuide[] = [
  {
    slug: "guide-rta-imports",
    folder: "guide-data",
    title: "RTA file imports — CAMS and KFintech",
    hook: "Upload the registrar's files, or let the CRM read them from your mailbox, and keep every number in step.",
    minutes: 4,
    shots: [{ file: "rta-imports", caption: "RTA File Imports: what to do next, data trust score and each file type." }],
    body: `RTA file imports bring the registrars' data — clients, folios, holdings, transactions, SIPs and brokerage — into the CRM.

![RTA File Imports](shot:1)

## Upload a file

1. Open **Data & Admin → RTA File Imports**.
2. Click **Upload file**, or **Sync Mailbox Now** if the CRM reads the registrar's emails.
3. Choose the file type and upload. The import runs in the background and tells you when it is done.

## Read the page

- **What to do next** lists the files to upload first: the daily transaction feed, the SIP rejection report, the redemption report and NACH mandate status.
- **Data trust score** is how much you can rely on downstream totals; it rises as files arrive on schedule.
- The tiles show **file types configured**, **up to date**, **late** and **row exceptions**.
- Each file type's card shows its cadence (for example every business day, monthly by the 7th), when it was last received and when the next is expected.

## What an import does

An import matches each registrar row to your client by PAN (following merges), keeps folios and their history together, fills blank city and state from the pincode, and never cuts short because of a client limit. After each import the booked business is matched to the registrar's records.`,
  },
  {
    slug: "guide-holdings-reconciliation",
    folder: "guide-data",
    title: "Holdings reconciliation",
    hook: "Compare the CRM's units with the registrar's feed and fix every break.",
    minutes: 2,
    shots: [{ file: "reconciliation", caption: "Holdings Reconciliation with open breaks, severity and exposure." }],
    body: `Reconciliation shows where the CRM and the registrar disagree.

![Holdings reconciliation](shot:1)

1. Open **Data & Admin → Holdings Reconciliation** and click **Run reconciliation** (after importing a registrar or CAS feed).
2. The tiles show **Open breaks**, **High severity**, the **exposure** (absolute value difference) and **Resolved**.
3. Each row shows the client, scheme and folio, the kind of break, CRM units against feed units and the difference in units and value.
4. Fix a break from the row, or click **Sync all to CRM** to accept the registrar's figures.`,
  },
  {
    slug: "guide-brokerage-reconciliation",
    folder: "guide-data",
    title: "Brokerage reconciliation",
    hook: "Compare the trail you expected with what the AMCs paid, and chase the shortfall.",
    minutes: 3,
    shots: [{ file: "commission-reconciliation", caption: "Brokerage Reconciliation by period." }],
    body: `Brokerage reconciliation catches trail that the AMCs under-paid.

![Brokerage Reconciliation](shot:1)

1. Open **Data & Admin → Brokerage Reconciliation** and choose the **Period**.
2. Expand **Import AMC payout statement**, paste the lines and click **Recompute reconciliation**.
3. Read the tiles: **Expected**, **Received**, **Recoverable shortfall**, **Anomalies** and **Unexplained surplus**, plus the year-to-date figures.
4. The scheme-wise lines show the variance for each scheme.

Expected trail is the empanelment rate times average folio AUM. A variance over 2% is flagged as an anomaly: chase the AMC, fix the ARN mapping or write it off.`,
  },
  {
    slug: "guide-find-duplicates",
    folder: "guide-data",
    title: "Find duplicates and merge clients",
    hook: "Spot two records for the same person and merge them without losing history.",
    minutes: 3,
    shots: [
      { file: "duplicates", caption: "Find Duplicates: duplicate clients, shared contact details and families." },
      { file: "merge-clients", caption: "Merge Clients: suggested duplicates, merge by search and merge history." },
    ],
    body: `A client entered twice splits their history and inflates your numbers.

![Find Duplicates](shot:1)

## Find them

1. Open **Data & Admin → Find Duplicates**.
2. The tabs list **Duplicates** (the same PAN, or a name nothing else tells apart), **Shared contact details** and **Families**.

## Merge them

1. Open **Merge Clients** (from Find Duplicates, or the clients list with two rows ticked and **Merge**).
2. **Suggested duplicates** lists records the CRM thinks are the same person: compare them and merge, or mark them as not duplicates. **Merge by search** lets you pick two yourself, and **Merge history** shows what was merged.
3. Confirm the merge. Folios, transactions, SIPs, tasks and notes move to the surviving client.

![Merge Clients](shot:2)

To move only some folios between two clients, use **Merge** on the clients list and tick the folios.`,
  },
  {
    slug: "guide-activity-log",
    folder: "guide-data",
    title: "Activity log — calls, visits and follow-ups",
    hook: "Log a call, visit or check-in against a client or lead and see the day's activity.",
    minutes: 2,
    shots: [{ file: "activities", caption: "Activity Log with calls today, visits this week and follow-ups due." }],
    body: `The Activity Log records the touchpoints behind a relationship.

![Activity Log](shot:1)

1. Open **Data & Admin → Activity Log** and click **Log activity**, or use **Check In** or **Log activity** from a client or lead page.
2. Choose the type (call, visit, WhatsApp, email), the person and the outcome, add notes and a follow-up date, and save.
3. The tiles show activities, **calls today**, **visits this week** and **follow-ups due**.

When you call or message a client from the CRM, it asks "How did it go?" so a call is logged in one tap. "No answer" and "Busy" never move the last-contact date.`,
  },
  {
    slug: "guide-scheme-master",
    folder: "guide-data",
    title: "Scheme master and AMC empanelments",
    hook: "Load the AMFI scheme universe, shortlist schemes and record each AMC's empanelment.",
    minutes: 3,
    shots: [
      { file: "schemes", caption: "Scheme Master with Sync from AMFI." },
      { file: "amc-empanelments", caption: "AMC Empanelments by status." },
    ],
    body: `Two masters feed pricing, trail and recommendations.

![Scheme Master](shot:1)

## Scheme master

1. Open **Settings → Scheme master** and click **Sync from AMFI** to pull the full scheme universe, or **New scheme** to add one by hand.
2. The tiles show **Schemes (regular plans)**, **Shortlisted (buy-list)**, **Active / open** and **IC-evaluated**.
3. Tick rows to shortlist several schemes at once for the investment committee.

## AMC empanelments

1. Open **Settings → AMC empanelments** and click **Add empanelment**.
2. Record the AMC, status and trail terms. The status chips are **Empanelled**, **Under review**, **Suspended** and **Terminated**.

![AMC Empanelments](shot:2)

Empanelment rates drive the expected trail in brokerage reconciliation.`,
  },
  {
    slug: "guide-products-offered",
    folder: "guide-data",
    title: "Products and services offered",
    hook: "List what your firm offers, with its status, for proposals and the website.",
    minutes: 2,
    shots: [{ file: "product-offerings", caption: "Products & services offered, by status." }],
    body: `Keep the firm's list of products and services.

![Products and services](shot:1)

1. Open **Products & services** and click **Add offering** (or **Add the first offering**).
2. Describe the offering and set its status.
3. Filter by **Active**, **Paused**, **Discontinued** or **All**, and **Export**.`,
  },
  {
    slug: "guide-trash",
    folder: "guide-data",
    title: "Trash — restore deleted records",
    hook: "Deleted clients, tasks and employees stay for 30 days and can be restored exactly as they were.",
    minutes: 1,
    shots: [{ file: "trash", caption: "Trash." }],
    body: `Nothing is lost the moment you delete it.

![Trash](shot:1)

1. Open **Trash** to see deleted clients, tasks and employees.
2. Restore an item to bring it back exactly as it was.
3. After 30 days items are removed for good, and permanent deletion cannot be undone.

A client who holds money with the registrar is never in the Trash: delete refuses, and one found there after an import is restored. To remove a duplicate, merge it; to say a client has left, mark them exited.`,
  },
];
