import type { StarterGuide } from "./types";

export const PLANNING_GUIDES: StarterGuide[] = [
  {
    slug: "guide-calculators",
    folder: "guide-planning",
    title: "Calculators and meeting packs",
    hook: "SIP, goal, retirement and protection calculators — grouped into ready-made packs for client meetings.",
    minutes: 3,
    shots: [{ file: "calculators", caption: "Meeting packs on top, then the full calculator library by category." }],
    body: `The Calculators page gives you the numbers to use in a client conversation.

![Calculators](shot:1)

## Use a meeting pack

Packs put the right calculators in the order you would use them:

- **First discovery** — Money Personality Quiz, REAL Statement (Net Worth & Cashflow), Goal Planner.
- **Win the SIP** — FD vs Equity Gap, Crorepati Countdown, Cost of Pausing a SIP.
- **Portfolio review** — Portfolio Health Score, Fund Overlap, Asset Allocation Review, Expense-Ratio Drag.
- **Retirement confidence** — FIRE Number, Will My Money Last?, Retirement Bucket Strategy, Financial-Freedom Builder.
- **Family protection** — Human Life Value, Child Education, Family Wealth Plan.

Click the first (blue) calculator to start, then follow the numbered ones.

## Find any calculator

1. Open **Planning Tools → Calculators**.
2. Type in **Search calculators by name** or scroll the categories (SIP & Wealth Building, Goals & Planning and more).
3. Click a calculator, enter the client's numbers and read the result.

## Assumptions

Click **Assumptions** (top right) to see and set the return, inflation and other defaults the calculators use, so every calculation reflects the firm's view.`,
  },
  {
    slug: "guide-goals",
    folder: "guide-planning",
    title: "Goals — plan and track client goals",
    hook: "Record a client's goal, link holdings to it and see whether the SIP is enough.",
    minutes: 3,
    shots: [{ file: "goals", caption: "Goals with target, linked value, projection, required SIP and the gap." }],
    body: `A goal turns "I want to buy a house" into a target amount, a year and a monthly SIP.

![Goals](shot:1)

## Add a goal

1. Open **Planning Tools → Goals** and click **New goal**.
2. Pick the client, the goal type (House, Child Education, Retirement…), the target amount and the target year.
3. Link existing holdings and note the existing SIP.
4. Save.

## Read the list

- **Target** is what is needed, **Linked** what is already earmarked and **Projected** what the linked money should grow to, shown as a percentage of the target.
- **Req. SIP** is the monthly SIP needed, **Existing SIP** what the client already pays, and **Gap** the shortfall.
- The status reads **On track** or **Off track**.

Use search, sort and filters to focus on clients whose goals are off track.`,
  },
  {
    slug: "guide-financial-health-check",
    folder: "guide-planning",
    title: "Financial Health Check",
    hook: "One printable document with a client's cash flow, assets, protection and goals — filled in from what the CRM already holds.",
    minutes: 3,
    shots: [{ file: "fhc", caption: "Financial Health Check list, before the first check is created." }],
    body: `A Financial Health Check shows the client where they stand in one document you can print and share.

![Financial Health Check](shot:1)

## Create one

1. Open **Planning Tools → Financial Health Check** and click **New Health Check**.
2. Pick an existing client. The check fills itself from the CRM:
   - age from the date of birth, and spouse and children from the family;
   - mutual funds by asset class and live fixed deposits as debt;
   - in-force life and health cover with premiums;
   - live goals with their current value and SIP.
3. Complete what the CRM cannot know — income, expenses and loans — and save.
4. Print or share the document with the client.

Only blanks are filled in; whatever you type stays. You can also start from a completed fact-find. Use **Export** to download the list.`,
  },
  {
    slug: "guide-proposals",
    folder: "guide-planning",
    title: "Proposals — branded recommendations for clients",
    hook: "Build a mutual fund, insurance, PMS or AIF proposal, download it as a PDF and track it until accepted.",
    minutes: 3,
    shots: [{ file: "proposals", caption: "Proposals by status: Draft, Sent, Accepted, Rejected, Expired." }],
    body: `A proposal is the branded document you give a client or prospect with your recommendation.

![Proposals](shot:1)

## Build and send

1. Open **Planning Tools → Proposals** and click **New proposal**.
2. Choose the recipient (a client or lead), the product type and add the recommendation.
3. Save as a **Draft**, download the PDF and send it. Sending moves it to **Sent**.
4. When the client decides, mark it **Accepted** or **Rejected**. Unanswered proposals become **Expired**.

## Track

- The tabs show how many proposals are in each status; **List** and **Pipeline** change the view.
- A proposal can be linked to the opportunity it answers; sending or accepting it moves that opportunity's journey on automatically.`,
  },
  {
    slug: "guide-insurance-policies",
    folder: "guide-planning",
    title: "Insurance — policies register",
    hook: "Record every life, health and general policy a client holds, with sum assured, premium and due dates.",
    minutes: 3,
    shots: [{ file: "insurance", caption: "The policy register with tabs for Policies, Renewals, Claims, Protection gap and Commission." }],
    body: `The Insurance module is one register for every policy you place or service. Its tabs cover the whole insurance process.

![Policies](shot:1)

## Add a policy

1. Open **Planning Tools → Insurance** and click **New policy**, or **Import** a list.
2. Choose the client, insurer and plan, the type (term life, health, motor…), sum assured, premium and frequency, and the start date.
3. Save. The policy appears with its status.

## Read the register

Columns include plan and insurer, type, client, sum assured, premium, frequency, start, maturity, next due, nominee and status. Search by policy number, plan, insurer or client, and filter or export.

## Other tabs

- **Renewals** — see the [renewals guide](/knowledge-base/guide-insurance-renewals).
- **Claims** — see the [claims guide](/knowledge-base/guide-insurance-claims).
- **Protection gap** — see the [protection gap guide](/knowledge-base/guide-protection-gap).
- **Commission** — see the [commission guide](/knowledge-base/guide-insurance-commission).`,
  },
  {
    slug: "guide-insurance-renewals",
    folder: "guide-planning",
    title: "Insurance renewals — never let a policy lapse",
    hook: "See what is overdue, due this week or due within 30 days, and chase it in time.",
    minutes: 2,
    shots: [{ file: "insurance-renewals", caption: "Renewals counts: overdue (in grace), due this week, due in 30 days, lapsing." }],
    body: `The Renewals tab lists policies by how close the premium is.

![Insurance renewals](shot:1)

## Work the renewals

1. Open **Planning Tools → Insurance** and choose the **Renewals** tab.
2. Read the four counts: **Overdue (in grace)**, **Due this week**, **Due in 30 days**, **Lapsing (past grace)**.
3. Click a count to list those policies, contact the client, and mark the policy renewed when the premium is paid.

Use **Export** to download the list.`,
  },
  {
    slug: "guide-insurance-claims",
    folder: "guide-planning",
    title: "Insurance claims — log and follow through",
    hook: "Record a claim, move it through each stage and keep the claim's documents in order.",
    minutes: 3,
    shots: [{ file: "insurance-claims", caption: "Claims by stage, from Claim Intimated to Settled." }],
    body: `The Claims tab tracks a claim from intimation to settlement.

![Insurance claims](shot:1)

## Log a claim

1. Open **Planning Tools → Insurance → Claims** and click **New claim** (or **Log a claim** on an empty list).
2. Pick the policy and record the claim details.
3. Save. The claim starts at **Claim Intimated**.

## Move it forward

The stage strip lists **Claim Intimated**, **File Awaited**, **File Received**, **Add Info Awaited**, **Query**, **Query Replied**, **Under Process** and the settled and rejected outcomes, each with a count. Update the status as the insurer responds. Every change is recorded.

## Documents and follow-up

Each claim has a document checklist that follows the product. A claim's next action is a task, so nothing is left without a follow-up.

**Settlement scorecard** opens the settlement performance view. **Export** downloads the list.`,
  },
  {
    slug: "guide-protection-gap",
    folder: "guide-planning",
    title: "Protection-gap radar",
    hook: "Find clients with no life or health cover, and see an indicative cover needed.",
    minutes: 2,
    shots: [{ file: "protection-gap", caption: "Clients with no life or health cover, with indicative cover needed and AUM." }],
    body: `Use this to find the conversations worth having about protection.

![Protection-gap radar](shot:1)

## Read the radar

1. Open **Planning Tools → Insurance → Protection gap**. Choose **Firm-wide** or **My book**.
2. Filter by **All gaps**, **Life gap** or **Health gap**.
3. A row shows the client, the gap (**No life**, **No health**), an indicative **Cover needed** and the client's AUM.
4. Use the icons at the end of a row to message, call or open the client.

A gap means no active or in-progress policy of that type for the client or anyone in their family. **Cover needed** is an indicative estimate by client segment, not a precise Human Life Value — confirm it with a needs analysis. Update the policy register to clear a gap.`,
  },
  {
    slug: "guide-insurance-commission",
    folder: "guide-planning",
    title: "Insurance commission",
    hook: "Premium book by insurer, commission received net of TDS and an estimate of renewal income.",
    minutes: 2,
    shots: [{ file: "insurance-commission", caption: "Commission by insurer, and the payouts you have recorded." }],
    body: `The Commission tab shows what the insurance book earns.

![Insurance commission](shot:1)

## Record a payout

1. Open **Planning Tools → Insurance → Commission**.
2. Click **Add commission** and enter the insurer, amount, TDS and date of the receipt.
3. Save. It appears under **Commission received**, with the year-to-date net.

## Read the table

**By insurer** lists the policies, active policies and premium book, the commission recorded on policies at entry (an estimate) and an estimated renewal income per year at 5% of active premium. Actual rates vary by line and insurer.`,
  },
];
