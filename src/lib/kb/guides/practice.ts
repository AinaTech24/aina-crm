import type { StarterGuide } from "./types";

export const PRACTICE_GUIDES: StarterGuide[] = [
  {
    slug: "guide-practice-systems",
    folder: "guide-practice",
    title: "Practice Systems — run the firm, not just work in it",
    hook: "See how documented, owned, measured and automated each of your 12 core processes is.",
    minutes: 4,
    shots: [{ file: "practice", caption: "Practice Systems map with a score for each core process." }, { file: "nav-practice", caption: "Find it: the highlighted item opens this page." }],
    body: `Practice Systems helps the owner work on the firm.

![Practice Systems](shot:1)

## The systems map

![Find it: the highlighted item opens this page.](shot:2)

1. Open **Practice → Practice Systems**. The headline says how "systemised" the practice is: pillars in place across the 12 core processes (for example Lead to client, Onboarding, SIP rejection).
2. Each process is scored on four pillars: **Documented** (an SOP linked), **Owned** (a position with a holder), **Measured** (data exists) and **Automated** (a switched-on automation).
3. A **Next step** under each process tells you what to do — link an SOP, set up positions, turn on an automation.

## The other tabs

- **Positions** — jobs, not people, each with a contract; assign holders.
- **Service promise** — the service level you promise each client tier.
- **Process measures**, **Message tests** and **Strategic objective** — measure and improve.
- **My operations manual** — see the [operations manual guide](/knowledge-base/guide-operations-manual).

Only the owner, branch heads and compliance can see this area; changes need the owner.`,
  },
  {
    slug: "guide-operations-manual",
    folder: "guide-practice",
    title: "Operations Manual — your SOP library",
    hook: "Write down how each job is done, or start from 38 ready SOPs and call scripts for an Indian MFD.",
    minutes: 3,
    shots: [{ file: "sops", caption: "The Operations Manual, with the standard manual one click away." }, { file: "nav-sops", caption: "Find it: the highlighted item opens this page." }],
    body: `An SOP is the written way a job is done, so the work is the same whoever does it.

![Operations Manual](shot:1)

## Start

![Find it: the highlighted item opens this page.](shot:2)

1. Open **Practice → Operations Manual**.
2. Click **Add the standard manual** to install 38 SOPs and lead-stage call scripts written for an Indian MFD practice. Edit them to fit your firm; one you delete is never brought back.
3. Or click **New SOP** to write your own.

## Put the SOP where the work is

An SOP can be linked to a core process, a task type, a task template, a position, a journey stage or a request type. The task page then shows "How we do this" with the right SOP, and a lead page shows the call script for its stage.

The Operations Manual is open to everyone in the firm; only people allowed to manage the practice can change it.`,
  },
  {
    slug: "guide-settings",
    folder: "guide-settings",
    title: "Settings — set up your firm",
    hook: "A map of Settings: your account, firm, team, clients and data, automation, messaging, connections and dashboards.",
    minutes: 4,
    shots: [{ file: "settings", caption: "Settings, grouped by what you want to do." }, { file: "nav-settings", caption: "Find it: the highlighted item opens this page." }],
    body: `Settings is where the firm is set up. Use the search box at the top — for example "logo", "2FA" or "WhatsApp".

![Find it: the highlighted item opens this page.](shot:2)

![Settings](shot:1)

## Your account

- **My profile** — your name, photo and signature image, used in email sign-offs.
- **Two-factor authentication** — turn it on to secure your login.

## Firm

- **Organisation profile** — the firm's name, ARN, logo and address.
- **Appearance & theme** and **Billing & subscription**.

## Team

- **Team & roles**, **Teams within a branch**, **Targets & quota** and **Auto-assignment rules**.

## Clients & data

- **Custom fields**, **Dropdown options**, **Onboarding form fields**, **Risk profile questionnaire**, **Scheme master** and **AMC empanelments**.

## Automation

- **Automations**, **Stages & journeys**, **Task templates**, **Escalation** and **QA sampling**.

## Messaging

- **Message templates**, **Email introduction** (what your firm says about itself in emails) and **Message log**.

## Connections

- **WhatsApp**, **Email** and **Integrations**. Connecting WhatsApp creates and submits the required template set to Meta for approval.

## Dashboards

- **Default dashboards** and **Dashboard thresholds**.

Most settings are for the owner; the rest follow each person's permissions.`,
  },
];
