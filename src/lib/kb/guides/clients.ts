import type { StarterGuide } from "./types";

export const CLIENT_GUIDES: StarterGuide[] = [
  {
    slug: "guide-leads",
    folder: "guide-clients",
    title: "Leads — from first enquiry to client",
    hook: "Capture every prospect, move them across the pipeline and convert them into a client without retyping.",
    minutes: 4,
    shots: [
      { file: "leads", caption: "The pipeline board: New, Contacted, Meeting Scheduled, Meeting Done, Proposal Sent and onward." },
      { file: "leads-new", caption: "New lead: name, phone, source and owner." },
      { file: "nav-leads", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `A lead is a new person who might become a client. (An existing client asking for another product is an **opportunity**, not a lead.)

![Leads pipeline](shot:1)

## Add a lead

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Clients → Leads** and click **New lead**.
2. Enter the **Name** (required), **Phone** and **Email**, and pick the **Source** (Manual entry by default; Google, Website, Client Referral, Seminar, Walk-in, Webinar and more).
3. **Assign RM** — leave it blank and the lead goes to the next RM by round-robin.
4. Set a **Follow-up date** and time: it sets the next follow-up and creates a task for the RM "so nobody forgets".
5. Open **Add full details** for a photo, city, products, amounts and more, then click **Create lead**.
6. As you type, the form checks for duplicates. If the person is already a client it offers **Start opportunity** instead of creating a duplicate.

![New lead](shot:2)

You can also bring leads in with **Import** (a spreadsheet) and take them out with **Export**.

## Move the lead along

- Each card shows the source, how long it has been in the stage and the next action. **Drag a card** to the next stage as the conversation progresses.
- Switch between **Kanban** and **List** at the top right.
- Use **My leads**, **Overdue follow-up** and **Source** to filter, or the search box to find by name, phone or email.

## Convert to a client

When a lead is won, convert it. The lead's details carry over to a new client record and the onboarding journey (KYC, UCC, mandate and the first investment) starts. Conversion needs a PAN, so a person who is already a client cannot be converted twice.

Conversion counts toward the "Won" figure on the dashboards.`,
  },
  {
    slug: "guide-clients",
    folder: "guide-clients",
    title: "Clients — add, find and manage",
    hook: "The client master: search the book, add a client of any type, import from your registrar and keep every record complete.",
    minutes: 5,
    shots: [
      { file: "clients", caption: "The Clients list with AUM, SIP, KYC, health score and status." },
      { file: "client-new", caption: "Add client: the form asks for what that type of client needs." },
      { file: "nav-clients", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `Everything about a client — profile, family, holdings, SIPs, policies, goals, tasks, documents and communication — hangs off one record.

![Clients list](shot:1)

## Find a client

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Clients → Clients**.
2. Search by name, PAN or phone. The result count shows beside the search box.
3. Use the filter, sort and column icons to narrow the list. Switch between list and card view.
4. Columns show **AUM**, **SIP / month**, **KYC** status, the **Health** score, **Profile** completeness and **Status**.
5. Click a name to open the client page.

Exited clients are hidden by default; the page tells you how many and lets you show them.

## Add a client

1. Click **Add client**.
2. Choose the client type first. The form then asks only for what that type needs: Individual, NRI, Minor (with a guardian), HUF (with a Karta), or a Company, LLP, Partnership, Trust or Society.
3. Fill in the PAN and contact details and save. If the PAN already exists, the form offers to reactivate, restore from the Trash, or open the existing client instead of creating a second one.

![Add client](shot:2)

Only individuals have nominations. A minor's risk profile is the guardian's.

## Import and export

**Import** loads a spreadsheet; **Export** downloads the list. Most firms bring their book in through **Data & Admin → RTA File Imports** instead, which keeps AUM and transactions in step with the registrar.

## More actions

The **More** button and the row **⋯** menu offer actions such as **Mark as exited** (the record keeps its history and leaves the active list; it comes back automatically if a new purchase or SIP instalment arrives) and **Delete** (to the Trash, restorable for 30 days). A client who holds money with the registrar cannot be deleted.

## Bulk actions

Tick several rows to assign an RM, update a field, or merge: select exactly two clients and use **Merge** to move folios from one to the other.

## KYC status from the KRA

On the client page the **KRA check** shows the KYC status read from the registry, with **Check now** for anyone who may edit the client. A firm that connects its NSE MF Invest user in Settings → Integrations also gets a nightly refresh. A failed or unclear answer never changes the status; it is only recorded in the history.

## A client who has died

Enter the **Date of demise** on the client form or the client page. The client is marked Inactive (their units may still be pending transmission, so AUM keeps counting), their Active, Paused and Pending SIPs are stopped, and pending orders are cancelled. Processed transactions are never deleted. The page shows a "Deceased" banner.

## The client page

The page opens with a summary strip (family, RM, AUM, SIP, last meeting, next review, risk and open work) and tabs for Overview, Portfolio, and more. The Overview holds the opportunities panel and the KRA check; the Portfolio tab holds folios, SIPs, policies and fixed deposits.`,
  },
  {
    slug: "guide-opportunities",
    folder: "guide-clients",
    title: "Opportunities — sell another product to a client",
    hook: "When an existing client wants insurance, a new SIP, NPS or an FD, run it as an opportunity with its own journey and follow-ups.",
    minutes: 4,
    shots: [
      { file: "opportunities", caption: "The Opportunities module (shown before the first opportunity is created)." },
      { file: "opps-new", caption: "New opportunity: pick the client and the product." },
      { file: "nav-opportunities", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `An opportunity is an existing client wanting another product. It keeps the person as one client record instead of creating a duplicate lead.

![Opportunities](shot:1)

## Start an opportunity

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Clients → Opportunities** and click **New opportunity**, or use **New opportunity** on the client's page.
2. Search for the **Client** by name, PAN or mobile, pick the **Product** and who it is **Assigned to**. An **Expected amount** is optional.
3. Choose **Now** to start the journey, or **Later** if the client wants it but not yet. Steps already on file (KYC, UCC, mandate) are skipped.
4. Set the **Follow-up date** — the owner gets a task due that day — and note what the client said.
5. Click **Start opportunity**.

![New opportunity](shot:2)

There is one open opportunity per client and product.

## The journey

An opportunity moves through identified → discussion → suitability → proposal → accepted, then the product's own steps (for a mutual fund: KYC, UCC, mandate, transaction; for insurance: proposal form, underwriting, issued) → won. A step the client has already satisfied is passed automatically with a remark.

- A mutual-fund proposal needs a client-confirmed risk profile signed in the last 12 months.
- An insurance quote needs a recorded needs analysis.
- A mutual-fund transaction is approved or rejected by a reviewer, then checked against the registrar's data before the opportunity is won.

## Board and list

The module shows every opportunity you can see on a board by journey step, or as a list, with headline figures (open, follow-ups overdue, won this month). Open one to run the journey, see its history and tasks.

## Later, lost and follow-ups

- **Later** parks the opportunity with a revisit date and one reminder task before it.
- **Lost** needs a reason.
- The next follow-up is simply the earliest open task linked to the opportunity.`,
  },
  {
    slug: "guide-families",
    folder: "guide-clients",
    title: "Families — group clients into households",
    hook: "Map clients into a family, see combined AUM and give the household one RM.",
    minutes: 3,
    shots: [
      { file: "families", caption: "The Families list with combined AUM, SIP and review dates." },
      { file: "families-new", caption: "New family: pick the head and the notes — the rest fills from the head." },
      { file: "nav-families", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `A family groups related clients so you can see the household's combined position and review them together.

![Families](shot:1)

## Create a family

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Clients → Families** and click **New family**.
2. Choose the **head** of the family. The name follows the firm's pattern (for example "Sharma Family") and can be edited; the family code (FAM-0001…) is automatic.
3. Add notes if you wish and save. The family's RM, branch, category and review schedule come from the head's client record.

![New family](shot:2)

## Map clients

- The **Unmapped clients** card shows how many clients belong to no family; click **Map clients** to add them.
- Open a family to add or remove members and set each member's relationship.
- Members take the head's relationship manager and address, and the family's review frequency.

## Tidy up

- **Merge duplicates** combines families created twice.
- **Family settings** sets the relationship types and the defaults for new families.
- The category tiles (All, Super HNI, HNI, Upper Middle, Middle) filter the list.`,
  },
  {
    slug: "guide-risk-profiles",
    folder: "guide-clients",
    title: "Risk profiles — assess and record every client",
    hook: "Send the questionnaire, or complete it with the client, and keep each client's risk category current.",
    minutes: 3,
    shots: [
      { file: "risk-profiles", caption: "Risk Profiles with Not profiled, Due for review, Current, Expired and Awaiting client confirmation." },
      { file: "risk-new", caption: "A new risk profile: start the questionnaire for a client." },
      { file: "nav-risk-profiles", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `A risk profile records how much risk a client can and wants to take. It is also the gate for mutual-fund proposals.

![Risk Profiles](shot:1)

## See who needs one

![Find it: the highlighted item opens this page.](shot:3)

Open **Clients → Risk Profiles**. The tabs show **Not profiled**, **Due for review**, **Current**, **Expired** and **Awaiting client confirmation**, each with a count.

## Profile a client

- **Start** opens the questionnaire so you can complete it with the client.
- **Send link** emails the client a personal link; the client answers on their phone and the result comes back to you. Tick several rows and use **Send link to selected**, or **Send to all not profiled**.
- **New Risk Profile** opens "Start a new risk profile": search for a client by name or PAN and pick them to begin. **Upload Risk Profile** attaches a signed form.
- **Bulk assign by age** gives clients a provisional, age-suggested category — it is clearly marked and does not count as confirmed.

![New risk profile](shot:2)

## Keep it current

Profiles have a next review date. Clients due for review show under **Due for review**, and the client page shows the category, score and signed date. A minor's profile is the guardian's.`,
  },
  {
    slug: "guide-discovery",
    folder: "guide-clients",
    title: "Discovery (fact-find) — know the client first",
    hook: "Capture a client's or lead's goals, income, assets and concerns in one structured fact-find.",
    minutes: 2,
    shots: [
      { file: "discovery", caption: "Discovery (Fact-find) list." },
      { file: "discovery-new", caption: "New discovery for a client or lead." },
      { file: "nav-discovery", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `The fact-find records what you learn in the first conversations so the advice and proposal that follow rest on facts.

![Discovery list](shot:1)

## Start a discovery

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Clients → Discovery (Fact-find)** and click **New discovery**.
2. In "Start a financial discovery", type at least two letters of a name, or a PAN, mobile or email, to find the client or lead the fact-find is for. Use the arrow keys to move, **Enter** to start and **Esc** to close.
3. Fill in the sections as the conversation goes; you can come back and complete it later. Search the list by client, lead or title and export it.

![New discovery](shot:2)

A completed fact-find can be used to start a Financial Health Check.`,
  },
  {
    slug: "guide-client-feedback",
    folder: "guide-clients",
    title: "Client feedback (NPS)",
    hook: "Send a 0–10 feedback survey to clients and see the Net Promoter Score and every response in one place.",
    minutes: 2,
    shots: [{ file: "client-feedback", caption: "Client Feedback: Net Promoter Score, promoters, passives and detractors." }, { file: "nav-client-feedback", caption: "Find it: the highlighted item opens this page." }],
    body: `Feedback helps you see who is happy and who is at risk.

![Client Feedback](shot:1)

## Read the page

![Find it: the highlighted item opens this page.](shot:2)

1. Open **Clients → Client Feedback**.
2. The tiles show the **Net Promoter Score** (it needs at least 5 responses), and the **Promoters (9–10)**, **Passives (7–8)** and **Detractors (1–6)** with their share of all responses.
3. **Client Feedback Submissions** lists every response with its score and comment.

## Ask for feedback

- Click **Send NPS survey** to email clients the survey. It uses the **Feedback / NPS Survey** email template; the link opens a short 0–10 form that works without a login and expires after 30 days.
- Click **Feedback link** to copy a link you can share yourself.
- **Download PDF** and **Export** give you the results to share.`,
  },
];
