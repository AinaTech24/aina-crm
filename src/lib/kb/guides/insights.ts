import type { StarterGuide } from "./types";

export const INSIGHT_GUIDES: StarterGuide[] = [
  {
    slug: "guide-reports",
    folder: "guide-insights",
    title: "Reports — 96 reports in 18 groups",
    hook: "Find the right report fast, star your favourites and build custom reports.",
    minutes: 3,
    shots: [{ file: "reports", caption: "The Reports hub: most used, favourites and every group." }],
    body: `Reports is the library of ready-made reports for every part of the practice.

![Reports](shot:1)

## Find a report

1. Open **Insights → Reports**.
2. **Most used** shows the reports you open often (AUM Movement, Active SIP Book, Net Business, SIP Rejected, Realised Capital Gain, Review Pending).
3. Search the whole library — try "capital gains" or "brokerage" — or open a group: Growth MIS, Sales & Business, SIP Tracker, Team & Branch, Branch & RM Business, Lead Blueprint, Clients, Retention & Tax, Practice Intelligence, Taxation, Complaint Register (SEBI), Family Mapping, Goal Planning, Marketing Campaigns, Insurance, Back Office, Compliance, Practice & Finances.
4. Click the **star** on a report to keep it under **Favourites**.

## Open and export

Open a report, set its period and filters, and export it. **Custom Reports** (top right) lets you build your own.

## Special reports

Some analyses have their own pages: the churn-risk radar, tax-harvesting, cross-sell and trail forecast — see their guides.`,
  },
  {
    slug: "guide-trail-forecast",
    folder: "guide-insights",
    title: "Trail Forecast and revenue at risk",
    hook: "Project the trail income your AUM will earn and how much is at risk.",
    minutes: 2,
    shots: [{ file: "trail-forecast", caption: "Trail Forecast & Revenue-at-Risk, shown here before any AUM has been imported." }],
    body: `The forecast turns the AUM on your book into projected trail income.

![Trail forecast](shot:1)

1. Open **Insights → Reports → Trail Forecast & Revenue-at-Risk**.
2. If the page says "No AUM on the book yet", click **Import RTA file** — the forecast appears once folios with AUM are imported from the registrar or a transaction feed.
3. Read the projected trail and the revenue at risk from SIPs likely to stop and clients likely to leave.`,
  },
  {
    slug: "guide-portfolio-insights",
    folder: "guide-insights",
    title: "Portfolio Insights",
    hook: "How your clients' money is spread across AMCs, schemes and asset classes — firm-wide or just your book.",
    minutes: 2,
    shots: [{ file: "portfolio-intelligence", caption: "Portfolio Insights summary tiles and breakdowns." }],
    body: `Portfolio Insights analyses the holdings behind your AUM.

![Portfolio Insights](shot:1)

1. Open **Insights → Portfolio Insights**.
2. Choose **Firm-wide** or **My book**.
3. The tiles show **Book AUM**, the number of **Folios**, **AMCs** and **Asset classes**. Below them, the breakdowns show where the money sits.

Holdings flow in from your RTA or CAS imports; the page says "No folio holdings to analyze yet" until folios carry AUM.`,
  },
  {
    slug: "guide-churn-risk",
    folder: "guide-insights",
    title: "Churn-risk radar",
    hook: "See which clients are drifting — no SIP, no contact, no recent investment — and call them first.",
    minutes: 2,
    shots: [{ file: "churn-risk", caption: "Churn-risk radar with a risk score and the top reasons for each client." }],
    body: `The churn-risk radar scores each client on signals that someone may leave.

![Churn-risk radar](shot:1)

1. Open **Insights → Reports** and choose **Churn-risk radar**.
2. The tiles show **High risk**, **Watch**, **Total scored** and the **AUM at risk**.
3. Each row shows the client, the risk band and score, the top reasons (for example "No active SIP", "No contact recorded", "No investment on record"), the RM and AUM.
4. Click **Call** to contact the client straight away.`,
  },
  {
    slug: "guide-tax-harvesting",
    folder: "guide-insights",
    title: "Tax-harvesting opportunities",
    hook: "Find clients with long-term equity gains that could be harvested before 31 March.",
    minutes: 2,
    shots: [{ file: "tax-harvesting", caption: "Tax-harvesting opportunities with a countdown to 31 March." }],
    body: `Use this report in the months before the financial year ends.

![Tax-harvesting](shot:1)

1. Open **Insights → Reports** and choose **Tax-harvesting**.
2. The tiles show clients with an opportunity, the total harvestable gain, the estimated tax saved and the days left to 31 March.
3. Opportunities appear once clients hold equity funds for over a year with an unrealised gain. Transactions must be imported with AMFI scheme codes so gains can be priced.

It is an estimate for planning only: FIFO cost basis from imported transactions, excluding exit load, STT and pre-1-Feb-2018 grandfathering. Confirm exact figures from the client's CAS before transacting.`,
  },
  {
    slug: "guide-cross-sell",
    folder: "guide-insights",
    title: "Cross-sell radar",
    hook: "See how many clients have an open opportunity for another product and the AUM they hold.",
    minutes: 2,
    shots: [{ file: "cross-sell", caption: "Cross-sell opportunities by product and top clients." }],
    body: `The cross-sell radar shows the product conversations still to be had.

![Cross-sell](shot:1)

1. Open **Insights → Reports** and choose **Cross-sell Radar**.
2. The tiles show **clients with opportunities**, the **AUM in play** and the **coverage** of the book.
3. **Opportunities by product** counts them by product; **Top clients by open opportunities** lists who to talk to first.

The data comes from the cross-sell card on each client — mark what a client holds with you and what interests them. Start an opportunity to run the journey.`,
  },
  {
    slug: "guide-practice-finances",
    folder: "guide-insights",
    title: "Practice Finances",
    hook: "Your own firm's expenses, profit and loss, targets and ten-year projection.",
    minutes: 3,
    shots: [{ file: "finances", caption: "Practice Finances: expense ledger, P&L, monthly progress, projections and checklist." }],
    body: `Practice Finances is for running your own firm as a business.

![Practice Finances](shot:1)

1. Open **Insights → Practice Finances**.
2. Choose a card:
   - **Expense ledger** — record and categorise every business expense, month by month.
   - **P&L statement** — commission income minus expenses gives net profit, by financial year.
   - **Monthly progress** — annual targets against live actuals: clients, AUM, SIP, lumpsum.
   - **Business projections** — project AUM and commission income over the next 10 years.
   - **Finance checklist** — the daily to annual bookkeeping, tax and compliance cadence.
3. Add expenses in the ledger and import commission payouts to light up the live P&L.`,
  },
  {
    slug: "guide-ai-copilot",
    folder: "guide-insights",
    title: "Aina Copilot — ask your data",
    hook: "Ask questions about your firm in plain English and get answers from your live data.",
    minutes: 2,
    shots: [{ file: "ai-assistant", caption: "Aina Copilot with suggested questions." }],
    body: `Aina Copilot (beta) answers questions about your own firm.

![Aina Copilot](shot:1)

1. Open **Insights → Aina Copilot**.
2. Click a suggested question — "What's my total AUM?", "Top 10 clients by AUM", "AUM by RM", "How many clients are KYC-pending?", "How many open tasks are overdue?", "How many new clients this month?" — or type your own in the box and send.
3. **New chat** starts a fresh conversation; **Chats** and **Archived** list the earlier ones.

Answers use your live data and can be imperfect; the assistant is read-only and only covers Aina CRM. You only see what your own access allows.`,
  },
];
