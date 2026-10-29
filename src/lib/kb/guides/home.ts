import type { StarterGuide } from "./types";

export const HOME_GUIDES: StarterGuide[] = [
  {
    slug: "guide-dashboards",
    folder: "guide-home",
    title: "Dashboards — your daily home screen",
    hook: "Open the dashboard made for your role, pick a period, and click any number to see the records behind it.",
    minutes: 4,
    shots: [
      { file: "dashboard", caption: "The Owner Dashboard: headline numbers first, then what needs action today." },
      { file: "manage-dashboards", caption: "Manage dashboards lists the six role dashboards and any you create." },
    ],
    body: `Every person lands on the dashboard built for their role. It answers three questions in order: how is the business doing, what needs me today, and where is the team.

## Open a dashboard

1. Click **Dashboard** in the left menu. You land on your default dashboard — the owner sees the **Owner Dashboard**, a branch head the **Branch Head Dashboard**, an RM the **Relationship Manager Dashboard**.
2. Use the dashboard name at the top to switch to another one you are allowed to see. The six built-in dashboards are Owner, Branch Head, Relationship Manager, Operations, Insurance Team and Claims.

![The Owner Dashboard](shot:1)

## Change the period and filters

1. Pick a period (this month, last 30 days, this FY, or a custom range). Dates are India dates, and the dashboard also compares with the same period last year.
2. Use **+ Filter** to narrow by relationship manager, branch or other fields. The filter stays in the page address, so you can bookmark or share the exact view.
3. While the cards reload the page dims and the button says "Applying…" — that is normal.

## Drill into a number

Click any tile, count or name. You land on the list page behind it with the same filter, so the count on the card equals the number of rows you see.

## Set your own default

Open the dashboard you like and choose **Set as my default**. The owner can also assign defaults per role or per person in Settings → Default dashboards.

## Create, share and manage dashboards

1. Go to **Manage dashboards** (Dashboard → Manage). Tabs: **All**, **Created by me**, **Shared with me**, **Recently deleted** (restorable for 30 days).
2. Click **New dashboard** to build one from the card library, or **Clone** the Owner Dashboard and change the cards.
3. Click **Share** on a row to share with everyone, a role, a branch, a team or named people.
4. **Defaults** sets which dashboard each role opens first.

![Manage dashboards](shot:2)

The built-in role dashboards are locked, so everyone sees the same trusted numbers; you can clone the Owner Dashboard to make your own variation.`,
  },
  {
    slug: "guide-team-dashboard",
    folder: "guide-home",
    title: "Team Dashboard and Scorecard",
    hook: "See what is open, what happened today and what was achieved across your team — and score each person against targets.",
    minutes: 3,
    shots: [
      { file: "team-dashboard", caption: "The Team Dashboard in three columns: Open, Periodic and Result." },
      { file: "team-scorecard", caption: "The Team Scorecard ranks people on a KRA score." },
      { file: "nav-team-dashboard", caption: "Find it: the highlighted item opens this page." },
    ],
    body: `The Team Dashboard is for owners, branch heads and team leads. It shows the work of the people who report to you.

## Read the dashboard

![Find it: the highlighted item opens this page.](shot:3)

1. Open **Home → Team Dashboard**.
2. Choose **Viewing → Whole team** or one person, and a period: **This month**, **Last 30 days**, **This FY** or **Custom**.
3. Read the three columns:
   - **Open — pending right now**: overdue tasks, overdue follow-ups, tasks due today, open leads, upcoming meetings, open service requests, SIP rejections to fix, insurance renewals in 30 days and activity follow-ups due.
   - **Periodic — today**: leads added, tasks completed and created, meetings, calls logged, field visits and new clients today.
   - **Result — the period**: leads converted and lost, new clients, tasks and meetings completed.
4. Click any card to open the list behind it.

![Team Dashboard](shot:1)

The **Team availability** strip at the top tells you who is present or on leave today, with links to Attendance and the Leave board.

## Team Scorecard

1. Click **Scorecard** at the top of the dashboard.
2. Pick **Month to date**, **Quarter to date**, **FY to date**, **Last month** or a **Since** date.
3. Each person has a **KRA score** blended from business (mutual funds and insurance), clients, conversions and service measures. Sales and operations teams are listed separately.
4. Click **Set targets** to give each person a target; the score then compares actual against the pro-rated target.

![Team Scorecard](shot:2)`,
  },
];
