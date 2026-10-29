import type { StarterGuide } from "./types";

export const BUSINESS_GUIDES: StarterGuide[] = [
  {
    slug: "guide-sip-book",
    folder: "guide-business",
    title: "SIP Book — every running SIP",
    hook: "See active SIPs, the monthly SIP book, additions and stoppages, and add a SIP when a client starts one.",
    minutes: 3,
    shots: [
      { file: "sips", caption: "SIP Book with the monthly SIP book and each client's SIP." },
      { file: "sip-new", caption: "Add SIP: client, scheme, amount, frequency and date." },
      { file: "nav-sips", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `The SIP Book is the register of every systematic investment plan you service.

![SIP Book](shot:1)

## Read the book

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Business → SIP Book**.
2. The tiles show **Active SIPs**, the **Monthly SIP book** (each SIP converted to its monthly equivalent), **Added this month**, **Stopped this month** and **Expiring (90 days)**.
3. The table lists investor, AMC and scheme, amount, frequency, next due date, status and RM. Search by scheme, AMC, folio or investor.
4. The tabs at the top move between **SIP Book**, **At-risk** and **Rejections**.

## Add a SIP

1. Click **Add SIP**. The **Register a SIP** form opens.
2. Search the **Client** (required) and the **Scheme** from your Scheme Master.
3. Enter the **SIP amount**, the **Frequency** (Monthly by default), the **SIP date** (day of month, 1–28) and the **Start date**.
4. Check the **Status** (Active) and the **Relationship manager**, add the **Folio no.** and any remarks, and click **Save SIP**. The monthly SIP book updates.

![Add SIP](shot:2)

## SIP payment watch

**SIP payment watch** helps you spot SIPs whose debit did not happen so you can act before the client stops. **Export** downloads the register.`,
  },
  {
    slug: "guide-sip-rejections",
    folder: "guide-business",
    title: "SIP rejections — recover every bounced SIP",
    hook: "Log a rejection, call and email the client, and watch the monthly recovery rate.",
    minutes: 4,
    shots: [
      { file: "sip-rejections", caption: "Rejections with totals, the recovery summary, reasons and ageing." },
      { file: "rejection-new", caption: "New rejection: client, scheme, amount, reason and follow-up date." },
      { file: "nav-sip-rejections", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `A SIP that bounces is money that stops flowing. This page makes sure each one is chased.

![Find it: the highlighted item opens this page.](shot:3)

![SIP Rejections](shot:1)

## Read the page

- **Total**, **Pending**, **In progress**, **SLA breached (>2d)**, **Recovered** and **Recovery rate MTD** are at the top.
- **Recovery summary — this month** shows what has been recovered against what is outstanding.
- **Why SIPs are bouncing** groups open rejections by reason, with the usual fix: mandate expired (re-register NACH), insufficient balance (nudge the client), technical (auto-retry next cycle).
- **Recovery aging** buckets open items by days; **Open recoveries by RM** shows who holds them.

## Log a rejection

1. Click **New rejection**.
2. In **Log SIP rejection**, search the **Client**, then enter the **Rejection date** and the **Amount (₹)** — both required — and choose the **Reason**.
3. Add the **Scheme**, **AMC** and **Folio no.** if you have them, and any remarks, then click **Log rejection**. A follow-up task is created for the RM.

![New rejection](shot:2)

Rejections also arrive automatically when you import the registrar's SIP rejection report.

## Work a rejection

- Change the **Status** from the row (Pending, Client contacted, Bank or mandate issue, Recovered…).
- Use **Email** on the row to send the client an email about that exact SIP, with the scheme, amount, reason and date. It goes through the compliance check and from the RM's own mailbox when connected.
- **Monthly recovery report** and **Export** give you the numbers for review.`,
  },
  {
    slug: "guide-sips-at-risk",
    folder: "guide-business",
    title: "SIP At-Risk — save SIPs before they stop",
    hook: "Find SIPs with a dead or expiring mandate, repeated failures or an imminent end date.",
    minutes: 2,
    shots: [{ file: "sips-at-risk", caption: "SIP At-Risk: at-risk SIPs, monthly inflow at risk and annual trail exposed." }, { file: "nav-sips-at-risk", caption: "Find it: the highlighted item opens this page." }],
    body: `The At-risk tab warns you about SIPs that are likely to stop.

![SIP At-Risk](shot:1)

## Use it

![Find it: the highlighted item opens this page.](shot:2)

1. Open **Business → SIP Book → At-risk**.
2. The tiles show the **at-risk SIPs** (split high and medium), the **monthly inflow at risk** and the **annual trail exposed** if they stop.
3. A SIP appears when its mandate is dead or expiring, it has repeated failures or its end date is near. Open a row to call the client and fix the cause.

When nothing qualifies, the page says "No SIPs at risk".`,
  },
  {
    slug: "guide-mf-transactions",
    folder: "guide-business",
    title: "MF Transactions — the registrar's ledger",
    hook: "Purchases, redemptions, switches and SIP instalments as reported by CAMS and KFintech.",
    minutes: 2,
    shots: [{ file: "transactions", caption: "MF Transactions, empty until the first registrar file is imported." }, { file: "nav-transactions", caption: "Find it: the highlighted item opens this page." }],
    body: `MF Transactions is the ledger of what the registrar says actually happened.

![MF Transactions](shot:1)

## Bring transactions in

![Find it: the highlighted item opens this page.](shot:2)

1. Open **Business → MF Transactions**.
2. Click **Go to RTA File Imports** to upload the CAMS or KFintech daily transaction feed, or **Import** / **Import from Excel** for a spreadsheet.
3. Search by scheme, client or folio and filter or export the result.

Processed switch, STP and SWP rows have an **Email** button that sends the client a confirmation of that exact transaction. Booked business (business entries) is separate from this ledger: the two are linked and never added together.`,
  },
  {
    slug: "guide-business-entries",
    folder: "guide-business",
    title: "Business Entries — log every closing",
    hook: "Book each piece of business the day you do it, so targets and dashboards are current before the registrar reports.",
    minutes: 4,
    shots: [
      { file: "business-entries", caption: "Business Entries, with the dashboard and liquid report one click away." },
      { file: "entry-new", caption: "New entry: client, product and the lines of business." },
      { file: "nav-business-entries", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `A business entry is the record of work operations did the day an RM asked for it — a lumpsum, SIP, switch, insurance premium, PMS or AIF.

![Business Entries](shot:1)

## Log an entry

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Business → Business Entries** and click **New entry** (or **Log your first closing**).
2. On **New business closing entry**, search the **Client** and choose the **Product type** (Mutual Fund and others), the **Platform** (for example NJ, Motilal, Piper Serica), the **Business date** and the **Relationship manager**.
3. The **Status** starts as **Draft**. Add the folio and notes if you wish.
4. Under **Schemes**, add one line per scheme: the **Scheme** from your Scheme Master, the **Type** (Lumpsum, SIP…), the **Asset class** and the **Amount (₹)**. **Add scheme** adds another line, and "Business by type" totals them.
5. Click **Save entry**. Once the entry is confirmed or emailed to the client, it counts toward targets and dashboards.

![New entry](shot:2)

## How it relates to the registrar

- **Targets count booked business** (your entries). **Incentives count what the registrar processed.**
- Each mutual-fund line is matched to the registrar's feed after every import and nightly, and shows an outcome: pending, confirmed, mismatch, rejected or not found. Filter the list by that outcome.
- A SIP line is confirmed by its first processed instalment.
- A firm with no confirmed entries sees "—" on dashboards, not ₹0.

## Reports

**Dashboard** summarises the entries, **Liquid report** covers liquid-fund business, and **Export** downloads the list.`,
  },
  {
    slug: "guide-fixed-deposits",
    folder: "guide-business",
    title: "Fixed Deposits — bank, NBFC and corporate FDs",
    hook: "Record FDs placed through the firm and get a reminder 15 days before maturity.",
    minutes: 3,
    shots: [
      { file: "fixed-deposits", caption: "Live FDs, amount deposited, and maturities in 30 and 90 days." },
      { file: "fd-new", caption: "Add FD: client, issuer, amount, rate, tenure and dates." },
      { file: "nav-fixed-deposits", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `Track every fixed deposit a client placed through you and never miss a maturity.

![Fixed Deposits](shot:1)

## Add an FD

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Business → Fixed Deposits** and click **Add FD**.
2. Under **Client**, search the client; the **Relationship manager** defaults to the client's RM.
3. Under **Deposit**, enter the **Bank or company**, the **Issuer type** (Bank, NBFC, corporate, post office), an optional scheme and FD / receipt number, the **Amount deposited (₹)** and the **Interest rate (% a year)**.
4. Under **Tenure and interest**, set the **Deposit date** and the tenure in months and days, and whether interest is cumulative or paid out.
5. Click **Save fixed deposit**. The maturity amount is calculated; if the receipt shows a different amount, type it and that figure wins.

![Add FD](shot:2)

## What happens next

- The page shows live FDs, the amount deposited, and FDs **maturing in 30 days** and **in 90 days**. Use the tabs **Live**, **Maturing in 30 days**, **In 90 days**, **All**, or search by client, bank or FD number.
- Every live FD creates an **expected inflow** and a reminder task for the RM 15 days before maturity.
- Renewing creates a new FD linked to the old one; closing early or cancelling removes the reminder.
- Booking an FD marks "FD / Bonds / NCD" as held with us on the client's cross-sell card and wins an open FD opportunity.`,
  },
  {
    slug: "guide-expected-inflows",
    folder: "guide-business",
    title: "Expected Inflows — money you can see coming",
    hook: "FD maturities and other expected cash, by month, so you can plan reinvestment conversations.",
    minutes: 2,
    shots: [{ file: "expected-inflows", caption: "Expected inflows grouped by month, with source, amount and confidence." }, { file: "nav-expected-inflows", caption: "Find it: the highlighted item opens this page." }],
    body: `Expected inflows list money a client is likely to have available, so you can talk to them before it lands somewhere else.

![Expected Inflows](shot:1)

## Read the page

![Find it: the highlighted item opens this page.](shot:2)

1. Open **Business → Expected Inflows**.
2. The tiles show the amount **expected in the next 90 days**, the **total upcoming**, inflows whose **date has passed without action**, and what has been **captured**.
3. Below, each month lists the client, the **source** (for example FD maturity), amount, date, **confidence**, owner and status.

## Add one by hand

Click **Add from a client** to record an expected inflow — a bonus, a property sale or a maturity — with an amount and date. FD maturities are added automatically from the Fixed Deposits register, each with its own reminder task.`,
  },
];
