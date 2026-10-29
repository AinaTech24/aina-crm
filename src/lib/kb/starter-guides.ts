/**
 * Starter help-centre content: one process guide per CRM module, written from
 * how the product behaves (CLAUDE.md) — NOT from screenshots. They install as
 * DRAFTS (`installStarterGuides`), so the super admin reads each, adds the
 * screenshots and publishes it. Keep every claim true of the product.
 *
 * Add a guide by appending to GUIDES; installing again only adds what is
 * missing (a guide is matched by slug, and an edited one is never overwritten).
 */

export type StarterFolder = { slug: string; name: string; description: string };
export type StarterGuide = {
  slug: string;
  folder: string; // StarterFolder.slug
  title: string;
  hook: string;
  minutes: number;
  body: string;
};

export const STARTER_CATEGORY = {
  slug: "aina-crm-user-guide",
  name: "Aina CRM user guide",
  description: "Step-by-step guides for every module of Aina CRM.",
};

export const STARTER_FOLDERS: StarterFolder[] = [
  { slug: "guide-home", name: "Home & dashboards", description: "Dashboards and your daily starting point." },
  { slug: "guide-work", name: "Work", description: "Tasks, the daily tracker, meetings and service requests." },
  { slug: "guide-clients", name: "Clients & leads", description: "Leads, clients, families, opportunities and risk profiles." },
  { slug: "guide-planning", name: "Planning tools", description: "Financial health check, fixed deposits and more." },
  { slug: "guide-business", name: "Business", description: "SIPs, rejections and business entries." },
  { slug: "guide-automation", name: "Automation & messaging", description: "Automations, templates and WhatsApp." },
  { slug: "guide-data", name: "Data & admin", description: "Imports, KYC checks and settings." },
];

export const GUIDES: StarterGuide[] = [
  {
    slug: "using-dashboards",
    folder: "guide-home",
    title: "Using your dashboards",
    hook: "Six role dashboards, one dropdown: pick the view that matches your job.",
    minutes: 4,
    body: `**Path:** Sidebar > Home > Dashboard

## What you see

The Dashboard opens on your own default. Use the dropdown at the top to switch between the dashboards you are allowed to see: Owner, Branch Head, Relationship Manager, Operations, Insurance Team and Claims. A relationship manager sees only their own desk; the owner sees all six.

## Steps

1. Open **Dashboard** from the sidebar.
2. Open the dashboard dropdown and choose the dashboard you want.
3. Use the filter bar to change the **period**, the **RM** or the **branch**. Extra filters sit under **+ Filter**. While a filter is applying, the page dims and the button says "Applying…".
4. Click any figure to open the list behind it. The list shows the same rows the figure counted.
5. To make a dashboard open first every time, choose **Set as my default**.

## Good to know

- A dashboard never counts more than you are allowed to see: it follows your access (firm, branch, team or your own clients).
- Business figures (gross, redemption, net business, SIP added and stopped) come from **Business Entries**. AUM and the SIP book balance come from the registrar's files.
- A dash (—) means there is no data yet; it is not a zero.
- Owners and admins can manage and share dashboards from **Manage dashboards**.`,
  },
  {
    slug: "managing-tasks",
    folder: "guide-work",
    title: "Managing tasks, follow-ups and escalations",
    hook: "Create, assign and complete tasks, and see how overdue work escalates.",
    minutes: 5,
    body: `**Path:** Sidebar > Work > Tasks

## Create and assign a task

1. Open **Tasks** and choose to add a new task.
2. Give it a title, an assignee and a due date. Link it to a client or lead if it is about one.
3. Save. The assignee is notified.

## Work a task

1. Open the task to see its details and discussion.
2. If the firm has linked a procedure to this kind of task, a **How we do this** panel shows the steps to follow.
3. Complete the task when it is done.

## Overdue work and escalation

If your firm has switched on the escalation ladder (Settings > Escalation), a task that stays overdue is raised in turn to the assignee's reporting manager, then the branch head, then the owner, at the hours the firm has set. Each level is told once. A task escalated to you counts as your own task: you can open it and discuss it, and the Tasks list has an **Escalated to me** filter.

## Quality checks

If QA sampling is on (Settings > QA sampling), a share of each person's completed tasks is picked every week and a checking task goes to their manager. The checker records Pass or Fail; a Fail needs a reason and gives the doer a correction task. Find them in **Tasks > QA queue**.`,
  },
  {
    slug: "daily-job-tracker",
    folder: "guide-work",
    title: "Filling in the Daily Job Tracker",
    hook: "A one-minute end-of-day habit: the tracker fills most of itself in.",
    minutes: 3,
    body: `**Path:** Sidebar > Work > Daily Tracker

## What fills itself in

For the day before, the tracker already shows the tasks you finished and carried over, the meetings you held and the follow-ups you logged.

## What you add

1. Open **Daily Tracker**.
2. Write today's **focus**. If your plan is empty, the tracker offers the top three items from your worklist; accept them in one tap.
3. Add what you **learned** and any **breakdown** of how the day went.
4. Save. A day counts as submitted once it has a focus item or a reflection.

## Reminders and managers

- Your first clock-in of the day opens the tracker.
- If your firm has set a reminder time (Settings > Daily tracker), people who have not filled in get one reminder, Monday to Saturday, except on firm holidays.
- Managers can open the **Team tracker** and the **Weekly team pack** for the people they can see.`,
  },
  {
    slug: "meetings-and-action-items",
    folder: "guide-work",
    title: "Scheduling meetings and tracking action items",
    hook: "Pick attendees from your team, clients and leads; every action item becomes a task.",
    minutes: 4,
    body: `**Path:** Sidebar > Work > Meetings

## Schedule a meeting

1. Open **Meetings** and add a new meeting.
2. Choose the date, time and purpose.
3. Add **attendees** by searching: team members, clients and leads are looked up from the CRM. For someone outside the CRM, type a guest.
4. Save. Team members you add see the meeting in their list and calendar and are notified.

## Action items

1. In the meeting, add an **action item** with an owner (any active team member) and a due date.
2. Saving creates the task straight away, not when the meeting is completed.
3. Editing the row edits the open task; removing the row cancels it. The owner is notified.

A client or lead you add as an attendee sees the meeting on their own record.`,
  },
  {
    slug: "service-requests-and-complaints",
    folder: "guide-work",
    title: "Handling service requests and complaints",
    hook: "How a ticket is opened, who receives it and what the client is sent.",
    minutes: 5,
    body: `**Path:** Sidebar > Work > Service Requests

## How requests arrive

- **Inside the CRM:** use the new request form. Each request gets a service ID (SR-YYYY-NNNNN) and its response clocks start.
- **Service request form for clients:** a public link you can send or put on your website (Service Requests > ⋯ > Service request form for clients). Each service the client picks opens its own request.
- **Complaint form for your website:** a separate public link (⋯ > Complaint form for your website). A complaint goes to your compliance officer, or the owner if there is none, and has a 21-day clock.
- **WhatsApp** requests are opened by the WhatsApp intake.

Incoming email does **not** open a service request.

## Linking to a client

A request is linked to a client only when the email or mobile typed matches exactly one live client. The acknowledgement email is sent only when the email matched.

## Close a batch of email-opened tickets

If old email-opened tickets exist, **Close email requests** closes every open one nobody has touched. Nothing is deleted.`,
  },
  {
    slug: "leads-pipeline",
    folder: "guide-clients",
    title: "Working the leads pipeline",
    hook: "From a new lead to a won client: the board, the stages and the duplicate check.",
    minutes: 5,
    body: `**Path:** Sidebar > Clients > Leads

## Add a lead

1. Open **Leads** and add a new lead.
2. As you type, the form checks for duplicates. If the person is already a client, it offers **Start opportunity** instead: an existing client wanting another product is an opportunity on their record, not a new lead.
3. Save. A welcome email can go out automatically through the "Welcome email to a new lead" automation.

## Move it along

The Leads board shows the pipeline as columns. Open a lead to see the next step for its stage, including the call script your firm has linked to that stage. Move the lead as the conversation progresses.

## Winning a lead

A converted or onboarding lead counts as **Won**. Conversion needs the PAN, so a duplicate person can never slip in. After a win, the onboarding journey takes over (KYC, UCC, mandate and so on).

Conversion rate on the dashboards is Won divided by all leads counted.`,
  },
  {
    slug: "adding-a-client",
    folder: "guide-clients",
    title: "Adding a client (by client type)",
    hook: "The form asks only for what that type of investor needs.",
    minutes: 5,
    body: `**Path:** Sidebar > Clients > Clients > Add client

## Steps

1. Open **Clients** and choose **Add client**.
2. Pick the **client type** first. The form then shows the right fields:
   - **Individual, NRI, Sole proprietor, Other:** personal details. NRI adds country, overseas address and tax residency.
   - **Minor:** guardian details and date of birth (must be under 18). A minor's risk profile is the guardian's.
   - **HUF:** Karta, date formed, coparceners.
   - **Company, LLP, Partnership, Trust, Society/AOP/BOI:** registration details, nature of business, FATCA/CRS class, authorised signatories and beneficial owners.
3. Enter the PAN. If a client with that PAN already exists, the CRM never creates a second one: it offers to **Reactivate** (an exited client), **Restore** (one in the Trash) or **Open** the existing record.
4. Save.

## Rules to remember

- Only individuals have **nominees**; other types never ask for them.
- A family member's address and review frequency come from the family, so they are not asked again.
- Your plan's client limit applies to clients added by hand, by CSV or by lead conversion. An RTA import is never cut short.`,
  },
  {
    slug: "merging-duplicate-clients",
    folder: "guide-clients",
    title: "Merging duplicate clients and moving folios",
    hook: "Fold a duplicate record away, or move specific folios between two clients.",
    minutes: 5,
    body: `**Path:** Sidebar > Data & Admin > Find Duplicates / Merge Clients

## Merge a duplicate client

1. Open **Find Duplicates**. Suggested pairs are grouped, including "Similar name, one without PAN".
2. Review a pair and choose which record survives.
3. Confirm the merge. The survivor keeps the history, and the merged record is no longer listed.

## Move folios between two clients

1. Open **Clients**, tick exactly **two** clients, and choose **Merge** from the bulk bar.
2. Pick the direction, then tick the folios to move. Schemes inside a folio travel with it.
3. Optionally move the folios' transactions and SIPs too.
4. If the two clients have different PANs you must tick an explicit confirmation.
5. Confirm.

Only an owner or branch head with merge access can do this. To fold a whole duplicate record away, use Merge Clients instead of moving folios one by one.`,
  },
  {
    slug: "creating-a-family",
    folder: "guide-clients",
    title: "Creating a family and mapping members",
    hook: "Group clients under a head; the family's RM and details follow the head.",
    minutes: 4,
    body: `**Path:** Sidebar > Clients > Families > New family

## Steps

1. Open **Families** and choose **New family**.
2. Choose the **head**. The family name fills in from the head using your firm's pattern, and you can edit it for an organisation name. The family code is automatic.
3. Add notes if you wish and save.
4. Add members from the family page or by mapping a client into the family.

## What follows the head

- The family has **one** relationship manager, the head's. Mapping a client into the family gives them the head's RM; changing the RM of any member changes it for the whole family.
- Members use the head's address and the family's review frequency.

Access to family mapping can be limited per person (view, create, edit, delete, or "assigned families only") in the access permissions.`,
  },
  {
    slug: "client-opportunities",
    folder: "guide-clients",
    title: "Tracking an opportunity for an existing client",
    hook: "When a client wants another product, start an opportunity, not a new lead.",
    minutes: 6,
    body: `**Path:** Sidebar > Clients > Opportunities (or the client page > Overview)

## Start one

1. From the client page choose **New opportunity**, or use the Cross-sell card's chips, or **Start opportunity** from the new-lead duplicate check.
2. Choose the product and when the client wants it (**Now** or **Later**).

There is one open opportunity per client and product, and the owner gets a follow-up task.

## The journey

Identified, discussion, suitability, proposal, accepted, then the product steps (mutual fund: KYC, UCC, mandate, transaction; insurance: proposal form, underwriting, issued), then won. Stages the client already satisfies are passed automatically with a remark.

## Gates that are never skipped

- A mutual fund proposal needs a client-confirmed risk profile signed in the last 12 months.
- An insurance quote needs a recorded needs analysis.
- A mutual fund transaction needs KYC, a UCC and, for a SIP, a covering mandate.
- After the client accepts a proposal, the journey waits until they approve it. A transaction is then approved or rejected by a reviewer, and an RTA data check task must be completed before the opportunity is won.

## Not yet

If the client wants it later, park it: choose **Client wants it later**, give a revisit date, and one reminder task is created ahead of that date.`,
  },
  {
    slug: "risk-profiles",
    folder: "guide-clients",
    title: "Taking a client's risk profile",
    hook: "Send the questionnaire link; the result is recorded against the client.",
    minutes: 3,
    body: `**Path:** Sidebar > Clients > Risk Profiles

## Steps

1. Open **Risk Profiles** or the client's page.
2. Send the client their questionnaire link (emails can use the \`{{link.risk_profile}}\` token, which gives each client their own link, valid for 21 days).
3. When the client completes it, the category and score are saved with the date.

## Good to know

- A provisional, age-suggested profile does not count as confirmed. Proposals need a client-confirmed profile signed within the last 12 months.
- A **minor's** risk profile is the guardian's; it is shown read-only on the minor.
- The CRM never infers a risk category from age or holdings.`,
  },
  {
    slug: "client-exit-and-demise",
    folder: "guide-clients",
    title: "When a client leaves or passes away",
    hook: "Mark as exited instead of deleting, and record a date of demise correctly.",
    minutes: 4,
    body: `**Path:** Sidebar > Clients > Clients > (client) > More

## A client who leaves

1. Open the client and choose **More > Mark as exited**, or use bulk **Update a field > Status**.
2. The record keeps its history, family, RM, notes and documents. It leaves the default client list and the dashboard counts; use the exited filter to see them.

If the client comes back, an RTA import that shows a new purchase or SIP instalment reactivates them automatically and tells their RM.

A client who holds money with the registrar (a folio with value or an active SIP) is never put in the Trash.

## A client who has passed away

1. Enter the **date of demise** on the client form or the inline edit.
2. The client becomes **Inactive** (their units may still be pending transmission, so AUM keeps counting), their active SIPs are stopped, and orders still pending are cancelled. Processed transactions are never deleted.
3. The client page shows a "Deceased" banner. Clearing the date returns the client to Active; stopped SIPs stay stopped.`,
  },
  {
    slug: "financial-health-check",
    folder: "guide-planning",
    title: "Running a Financial Health Check",
    hook: "Pick a client and the plan fills from what the CRM already holds.",
    minutes: 4,
    body: `**Path:** Sidebar > Planning Tools > Financial Health Check > New

## Steps

1. Open **Financial Health Check** and start a new one.
2. Pick an existing client. The plan fills with what the CRM already knows:
   - **Profile:** age, spouse and children (from the family), risk profile.
   - **Assets:** mutual funds by class, and live fixed deposits as debt.
   - **Protection:** in-force life and health cover.
   - **Goals:** the client's live goals.
3. Enter what the CRM does not hold: income, expenses and loans.
4. Review, adjust and save.

Only blanks are filled and anything you typed stays. Picking a different client swaps what the first pick filled.`,
  },
  {
    slug: "fixed-deposits",
    folder: "guide-planning",
    title: "Recording a fixed deposit",
    hook: "Track FDs placed through the firm, with maturity reminders for the RM.",
    minutes: 4,
    body: `**Path:** Sidebar > Business > Fixed Deposits (or the client's Portfolio tab)

## Record an FD

1. Open **Fixed Deposits** and choose to add one, or use the FD panel on the client's Portfolio tab.
2. Choose the client, issuer, principal, rate, start and maturity details.
3. If the receipt shows a maturity amount, type it: your figure is used, and it can't be below the deposit.
4. Save.

## What happens automatically

- A live FD creates an expected inflow for its maturity, and a reminder task reaches the RM 15 days before.
- The client's Cross-sell card shows FDs, Bonds and NCDs as held with you, and an open FD opportunity is won.

## Renew

Use **Renew** on the deposit: the new FD links to the old one and the old one is marked renewed.`,
  },
  {
    slug: "sip-rejections",
    folder: "guide-business",
    title: "Following up a rejected SIP",
    hook: "Work the rejection, email the client from the record and close it out.",
    minutes: 4,
    body: `**Path:** Sidebar > Business > SIP Rejections

## Steps

1. Open **SIP Rejections**. Rows still being worked show an **Email** button.
2. Open a rejection to see the scheme, amount, reason and date. Record that you contacted the client, and note any bank or mandate issue.
3. Choose **Email** to send the client a message about that specific rejection. The values come from that record, and a transactional email goes out unless the client has opted out.
4. Update the status as the case moves, until it is resolved.

An automation can also follow up a rejection for you (the "SIP rejection follow-up" recipe).

A rejection email can only be sent while the rejection is still open (pending, client contacted, bank or mandate issue).`,
  },
  {
    slug: "business-entries",
    folder: "guide-business",
    title: "Booking business and matching it to the RTA",
    hook: "Targets count what you book; the registrar's feed confirms it days later.",
    minutes: 5,
    body: `**Path:** Sidebar > Business > Business Entries

## Book an entry

1. Open **Business Entries** and add the entry the day the work is done.
2. Add its lines (scheme or product, amount, type).
3. Operations confirms the entry. Confirmed entries count for targets and for the dashboards' business figures.

## RTA outcome

A day or two later the CAMS and KFintech files arrive. Each mutual fund line of a counted entry is matched to them and shows an outcome: pending, confirmed, mismatch, rejected, not found or not applicable. Filter the list by outcome.

- A line is "not found" only after the firm's waiting period (7 days; 45 for a first SIP debit) and only if the imported files reach past it.
- A SIP is confirmed by its first processed instalment.
- By default a rejected line is subtracted on its rejection date; the other mode removes it from the booking date.

Incentives use what the RTA processed, plus confirmed entries for products the RTA never reports.`,
  },
  {
    slug: "automations-and-templates",
    folder: "guide-automation",
    title: "How automations, templates and compliance fit together",
    hook: "An event triggers a workflow; every message passes consent and the compliance gate.",
    minutes: 6,
    body: `**Path:** Sidebar > Automation > Automations / Message Templates

## The flow

An event (a rejected SIP, a redemption, a birthday) triggers an automation. The automation runs steps such as sending a WhatsApp, email or SMS, creating a task, or branching. Every message goes through the same path:

1. The template must be **approved**.
2. Its variables are filled in.
3. **Consent** is checked. An opt-out always blocks. Marketing needs a recorded consent; a transactional or service message goes out unless the client opted out.
4. For WhatsApp, the session window is checked.
5. The **compliance gate** runs its rules; any blocking finding stops the send.
6. The message is recorded and then sent.

If a message is skipped, the Communications screen still shows it with the reason.

## Turn on an automation

Open **Automations**, choose a ready-made recipe, review it and publish it. A draft does nothing until it is published.

## Templates

Create or edit templates in **Message Templates**. Use the picker for merge fields, and a "Show this block" condition to hide an email block when a value is blank. Client emails should link to the per-recipient tokens, such as the risk profile link, never to your own login page.`,
  },
  {
    slug: "whatsapp-templates",
    folder: "guide-automation",
    title: "Connecting WhatsApp and the required templates",
    hook: "Save your Vartify key and the required template set is sent to Meta for you.",
    minutes: 4,
    body: `**Path:** Settings > Integrations > Vartify (owner only)

## Steps

1. Open **Settings > Integrations** and enter your Vartify key.
2. Save. The CRM creates the required set of WhatsApp templates and sends each to Meta for approval. The set includes service messages (SIP registered or rejected, debit reminder, mandate expiry, KYC, risk profile link, meetings, documents, premium) and marketing messages (birthday, festival, start a SIP, review, tax saving, referral and more).
3. Open the Vartify panel to see the state of each template: pending, approved or rejected, with Meta's reason when rejected.
4. Use **Send the rest to Meta** to create anything missing or re-send what failed.

Templates failing to send are retried automatically after six hours. An archived template is never brought back by the worker.`,
  },
  {
    slug: "importing-rta-files",
    folder: "guide-data",
    title: "Importing CAMS and KFintech files",
    hook: "How the registrar's rows find the right client, and what happens to duplicates.",
    minutes: 5,
    body: `**Path:** Sidebar > Data & Admin > RTA File Imports

## Steps

1. Open **RTA File Imports** and upload the registrar file (folio master, holdings, transactions or SIP book).
2. Wait for the import to finish and review the summary.

## How rows find their client

- A PAN resolves to its live client; merged records are followed to the survivor.
- A PAN nobody holds may adopt a PAN-less client you entered, but only when the name matches unambiguously.
- When a folio moves to another client, its transactions and SIPs move with it.
- An empty PAN-less placeholder is moved to the Trash automatically after an import. A placeholder that holds anything stays, and the duplicate finder suggests its PAN twin.

## After every import

- Booked business entries are matched to the new data.
- Clients who came back are reactivated.
- If your firm is over its client limit, the owners are told once a day. An import is never cut short.`,
  },
  {
    slug: "kyc-status-check",
    folder: "guide-data",
    title: "Checking KYC status from the KRA",
    hook: "Connect your NSE MF Invest user once; statuses update on their own.",
    minutes: 4,
    body: `**Path:** Settings > Integrations > NSE MF Invest — KYC status (owner only)

## Connect

1. Enter your Login User ID, member code, API secret and API member license key, and choose Live or UAT. The secrets are saved encrypted and are write-only.
2. Ask NSE to whitelist the server IP shown on the card against your user. A 403 means the keys or the IP are wrong.

## Use it

- On a client page, the **KRA check** shows the latest remark and date. Choose **Check now** to refresh it (if you may edit the client).
- Each answer maps to a status: Validated is verified; Registered is registered; Under process is pending; On hold, Rejected and the re-KYC remarks have their own statuses.
- A failed call, an unknown remark or an answer for another PAN never changes a client's status; it is only recorded.
- If the daily refresh is on, firms are refreshed overnight: every 3 days until verified, then every 30.`,
  },
  {
    slug: "email-introduction-and-signature",
    folder: "guide-data",
    title: "Setting up your email introduction and signature",
    hook: "Tell clients about your firm once; every email uses it.",
    minutes: 3,
    body: `**Path:** Settings > Email introduction, and Settings > Profile

## Email introduction

1. Open **Settings > Email introduction**.
2. Fill in the company introduction, services (one per line), office timing, mission, and the founder's name, designation, photo and introduction. Add up to 20 fields of your own, for example "Awards".
3. Save. Emails that use these fields, such as the new-lead welcome, now introduce your firm. A field you leave blank simply drops out, together with its heading.

## Signature

Each relationship manager can upload a signature image in **Settings > Profile**. Emails use the client's own RM: the signature image, name, designation, contact details and the firm with its ARN. Anything left blank is omitted.

Your firm logo is taken from the tenant settings and appears at the top of emails.`,
  },
];
