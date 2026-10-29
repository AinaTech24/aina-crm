import type { StarterGuide } from "./types";

export const TEAM_GUIDES: StarterGuide[] = [
  {
    slug: "guide-team-members",
    folder: "guide-team",
    title: "Team members, roles and the org chart",
    hook: "Invite people, give them roles, and see each person's clients, AUM and targets.",
    minutes: 3,
    shots: [{ file: "employees", caption: "Team Members with roles, clients, AUM and status." }, { file: "nav-employees", caption: "Find it: the highlighted item opens this page." }],
    body: `Team Members is where you add and manage everyone who works in the CRM.

![Team Members](shot:1)

## Invite someone

![Find it: the highlighted item opens this page.](shot:2)

1. Open **Settings → Team & roles → Team Members** and click **Invite employee**.
2. Enter their name and email, choose their role (owner, branch head, relationship manager, operations, compliance, marketing…) and branch.
3. Send the invite. They set their own password when they accept. The number of seats follows your plan.

## Manage the team

- The table shows each person's roles, number of clients, AUM, target, NISM expiry and status, with search and filters.
- The row icons let you view, edit, deactivate, redistribute their clients and delete.
- **Org chart** shows who reports to whom; reporting lines drive the Team Dashboard and escalation.
- **Licensing** shows seat usage, **Import** adds people in bulk, and **Complete team profiles** fills in missing department, manager and joining date.

When someone leaves, deactivate them and redistribute their clients so no client is left without an RM.`,
  },
  {
    slug: "guide-attendance",
    folder: "guide-team",
    title: "Attendance — clock in, corrections and holidays",
    hook: "Clock in and out, review the monthly grid and fix missed punches.",
    minutes: 3,
    shots: [{ file: "attendance", caption: "Attendance with Clock in, corrections, holidays and the monthly grid." }, { file: "nav-attendance", caption: "Find it: the highlighted item opens this page." }],
    body: `Attendance records who was in and when.

![Attendance](shot:1)

## Clock in and out

![Find it: the highlighted item opens this page.](shot:2)

Open **Team → Attendance** and click **Clock in** at the start of the day and clock out at the end.

## Review and correct

- The monthly grid shows every person's day; **Export** downloads it.
- **Corrections** handles a missed punch: a team member requests it and the manager approves.
- **Holidays** sets the firm's holiday list, and **Settings** sets the working hours and rules.`,
  },
  {
    slug: "guide-leave",
    folder: "guide-team",
    title: "Leave — requests, approvals and the team timeline",
    hook: "Request leave, approve or reject it, and see who is away on the team timeline.",
    minutes: 3,
    shots: [{ file: "leave", caption: "Leave with Pending, Approved and Rejected tabs." }, { file: "nav-leave", caption: "Find it: the highlighted item opens this page." }],
    body: `The Leave module replaces leave on WhatsApp.

![Leave](shot:1)

## Request leave

![Find it: the highlighted item opens this page.](shot:2)

1. Open **Team → Leave** and click **New request**.
2. Choose the leave type and dates, add a reason and submit. The manager is notified.

## Approve

1. The manager opens the **Pending** tab, which lists requests waiting for a decision.
2. Approve or reject each one. Decisions move to **Approved** or **Rejected**.

## See who is away

Switch from **List View** to **Team Timeline** to see everyone's leave on one calendar. **Leave policy** sets the leave types and balances, and **Export** downloads the list. Approved leave also appears on the Team Dashboard's availability strip.`,
  },
  {
    slug: "guide-induction",
    folder: "guide-team",
    title: "Induction — train new joiners",
    hook: "Build training tracks and see who has completed them.",
    minutes: 2,
    shots: [{ file: "induction", caption: "Induction tracks." }, { file: "nav-induction", caption: "Find it: the highlighted item opens this page." }],
    body: `Induction gives every new team member the same training.

![Induction](shot:1)

![Find it: the highlighted item opens this page.](shot:2)

1. Open **Team → Induction**.
2. Click **New training track** to create a track with its lessons, and **Manage tracks** to edit or retire existing ones.
3. Assign a track to new joiners and follow their progress from the same page.`,
  },
  {
    slug: "guide-announcements",
    folder: "guide-team",
    title: "Announcements",
    hook: "Post a notice to the whole team, schedule it, and let it expire when it is no longer needed.",
    minutes: 2,
    shots: [{ file: "announcements", caption: "Announcements: Live, Scheduled, Drafts and Expired." }, { file: "nav-announcements", caption: "Find it: the highlighted item opens this page." }],
    body: `Announcements are the firm's notice board.

![Announcements](shot:1)

![Find it: the highlighted item opens this page.](shot:2)

1. Open **Team → Announcements** and click **Post announcement**.
2. Write the title and message, choose who should see it, and either post it now or schedule it.
3. Use the tabs **Live**, **Scheduled**, **Drafts** and **Expired** to manage them. When nothing is live the page says "Nothing is live right now."`,
  },
];
