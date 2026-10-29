import type { StarterGuide } from "./types";

export const AUTOMATION_GUIDES: StarterGuide[] = [
  {
    slug: "guide-automations",
    folder: "guide-automation",
    title: "Automations — repetitive work, done for you",
    hook: "Start from a ready recipe — a birthday wish, a welcome email, a task when a SIP bounces — and switch it on.",
    minutes: 4,
    shots: [
      { file: "automations", caption: "Automations: Rules, Actions and Run history tabs." },
      { file: "automation-new", caption: "New automation: choose a recipe or start from scratch." },
      { file: "nav-automations", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `Every event in the CRM — a rejected SIP, a redemption, a birthday — can start an automation: a checked sequence of messages and tasks.

![Automations](shot:1)

## Start an automation

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Settings → Automations** and click **New automation**.
2. Pick a recipe: **Birthday wish** (email every active client a birthday greeting on the day), **Welcome email** (welcome each new client as soon as they are added), **SIP bounce follow-up** (give the client's RM a high-priority task to recover it) or **Review reminder** (a task for the RM on each client's next review date). **See all recipes** opens the full library, and **Build from scratch** starts empty.
3. A recipe is added **switched off**, so you can check the message before anything is sent. Review the steps, choose the template for each message and switch it on.

![New automation](shot:2)

## Tabs

- **Rules** — your automations.
- **Actions** — the steps available and their settings.
- **Run history** — every time an automation ran, with its outcome.

## Safe by design

Every message an automation sends goes through the same pipeline as a hand-sent one: the client's consent, the compliance checks and the template approval. A message that is blocked is logged with the reason. In-flight runs finish on the version they started with, so editing an automation never breaks a running one.`,
  },
  {
    slug: "guide-templates",
    folder: "guide-automation",
    title: "Message templates — WhatsApp, email and SMS",
    hook: "Design, approve and reuse templates with merge fields, the firm's logo and each RM's sign-off.",
    minutes: 4,
    shots: [
      { file: "templates", caption: "Message Templates by channel and approval status." },
      { file: "template-new", caption: "New template: name, channel, category and body." },
      { file: "nav-templates", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `Templates are the approved wording every message is built from.

![Message Templates](shot:1)

## Browse

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Settings → Message templates**.
2. Filter by channel (**All**, **WhatsApp**, **Email**, **SMS**) and by status (**Draft**, **Pending**, **Approved**, **Rejected**), or search by name or key.
3. Each row shows the channel, the category (utility or marketing) and when it was updated.

## Create a template

1. Click **New template**. A three-step wizard opens: **Set up**, **Design**, **Review & send**.
2. In step 1 choose how to reach the client — **Email** (a designed email with your logo and branding), **WhatsApp** or **SMS** (DLT-registered).
3. Give the **Template name**, say what it is for, and choose the **Message type** (for example Transactional: order, SIP and payment confirmations, statements) and the **Language**.
4. Pick a **starting point** — a ready-made template such as Welcome / Onboarding, SIP Confirmation or Lead — Thank You (First Touch) — or start blank. Click **Next: Design**, or **Save draft** to come back later.
5. In the designer, use merge fields such as the client's first name or the RM's name. The logo and each RM's sign-off blocks fill in from the firm's and the RM's own details.
6. WhatsApp templates are sent to Meta for approval; use **Fetch from WhatsApp** to bring approved templates in.

![New template](shot:2)

## Good to know

- Only approved templates can be sent.
- Merge values are escaped, so put plain text, not markup, in a field.
- Client-facing links use per-client tokens, never the firm's own login page.
- The firm's introduction (Settings → Email introduction) provides the "about us" fields for the new-lead welcome email.`,
  },
  {
    slug: "guide-campaigns",
    folder: "guide-automation",
    title: "Marketing campaigns",
    hook: "Log webinars, seminars and ad bursts, or schedule a broadcast, and see leads and conversions per campaign.",
    minutes: 3,
    shots: [
      { file: "campaigns", caption: "Marketing Campaigns: active campaigns, leads, meetings, conversions and spend." },
      { file: "campaign-new", caption: "New campaign." },
      { file: "nav-campaigns", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `Campaigns tie your marketing effort to the leads and clients it brings.

![Campaigns](shot:1)

## Create a campaign

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Marketing Campaigns** and click **New campaign**.
2. Choose the **Campaign type** — **WhatsApp**, **Email** or **Webinar / Seminar** — and give it a **Campaign name** and a **Theme / hook** (for example Tax Saving, SIP Power, NFO Launch, Diwali).
3. Set the **Start date** and **End date**, and describe the **Target audience** for your records.
4. For a broadcast, open **Broadcast send (optional)**: choose an approved **Template**, then the **Audience** — **All clients**, **All leads**, **By criteria** or **Specific clients** — and click **Set audience**. Recipients without a valid contact or consent are skipped automatically and audited.
5. Leave **Schedule** blank to send right after launch, or pick a date and time, and set the **Throttle (per min)**.
6. Save. Campaigns can need approval; **Pending approval** counts them.

![New campaign](shot:2)

## Measure

The tiles show **Active** campaigns and, year to date, **Leads**, **Meetings**, **Conversions** and **Spend**. The **Conversion report** shows which campaigns converted. Use **Export** to download the list.`,
  },
  {
    slug: "guide-communications",
    folder: "guide-automation",
    title: "Communications — every message, one timeline",
    hook: "Compose a message, see what was sent, delivered, read or failed, and review client responses.",
    minutes: 3,
    shots: [
      { file: "communications", caption: "Communications with Scheduled, Sent, Delivered, Read and Failed counts." },
      { file: "compose", caption: "Compose: recipient, channel, template and message." },
      { file: "nav-communications", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `Communications is the log of every WhatsApp, email and SMS the CRM has sent.

![Communications](shot:1)

## Send a message

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Settings → Communications** and click **Compose**. The **Compose email** page opens.
2. Choose the **Recipient**: **Client** (search by name, PAN or mobile) or **Email address**.
3. Write the **Subject** and the **Message**. Use {{name}} for the client's name — the MF risk disclaimer and your ARN signature are appended automatically.
4. Choose the **Category** (for example Transactional (service)), tick **Schedule for later** if you want a later time, and click **Send now**. The message passes the consent and compliance checks first; if it is blocked, the log shows why.

![Compose](shot:2)

## Follow what happened

- The tiles count **Scheduled**, **Sent**, **Delivered**, **Read** and **Failed** messages.
- The list shows recipient, subject, status and time; search by recipient, subject or template, and star a message to keep it.
- **Client responses** opens what clients replied; **Cadence (SOP)** shows the firm's contact cadence.

## The rules every send follows

An opt-out always blocks a message. Marketing messages need a recorded consent. Service and transactional messages go out unless the client has opted out. WhatsApp marketing also needs an open session window.`,
  },
];
