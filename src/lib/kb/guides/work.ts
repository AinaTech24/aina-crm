import type { StarterGuide } from "./types";

export const WORK_GUIDES: StarterGuide[] = [
  {
    slug: "guide-tasks",
    folder: "guide-work",
    title: "Tasks — create, assign and finish work",
    hook: "Every follow-up, call and document chase lives as a task with an owner and a due date.",
    minutes: 4,
    shots: [
      { file: "tasks", caption: "The Tasks list with tabs for All open, Overdue, Today, Upcoming and Completed." },
      { file: "tasks-new", caption: "New task: title, client or lead, due date, priority and assignee." },
    ],
    body: `Tasks keep the firm's follow-ups from living in anyone's head. Tasks also appear on your dashboard, calendar and the client's page.

![The Tasks list](shot:1)

## Find your work

1. Open **Work → Tasks**.
2. Use the tabs: **All open**, **Overdue**, **Today**, **Upcoming**, **Completed**.
3. Search by title or description, and switch between **List** and **Board** at the top right. **All tasks** lets you narrow to your own or your team's.
4. The **Source** column shows whether a task was created by hand (**Manual**) or by an automation (**Automation**) — for example the call you get after a SIP rejection.

## Create a task

1. Click **New task**.
2. Under **For client** (optional) search the client the task is about. Type **What needs doing** — for example "Call Ramesh about the SIP top-up".
3. Choose the **Type of task** (General, Financial or Non-financial), the **Due** date (pick a date, or tap Today, Tomorrow, 3 days or 1 week) and who to **Assign to** — leave it as Me for yourself.
4. Set the **Priority**: Low, Normal, High or Urgent. **More options** adds a description, reminder, repeat, links and sub-tasks.
5. Click **Create task** (or press Ctrl + Enter). The assignee is notified.

![New task](shot:2)

## Complete, edit or reassign

- Click the round tick at the start of a row to complete the task.
- Use the pencil to edit, or the **⋯** menu for more actions.
- The task page has comments and a "How we do this" panel when your Operations Manual has an SOP for that kind of task.

## Board view

Switch to **Board** to see tasks as columns by status and move them along.

## QA queue

**QA queue** (top right) is the firm's sampling check of completed work. It is off until the owner switches it on in QA settings; then a share of each person's completed tasks is picked every week for their manager to pass or fail.

## Overdue tasks and escalation

When the owner turns on the escalation ladder (Settings → Escalation), a task that stays overdue is told first to the assignee's manager, then the branch head and finally the owner, at the hours the firm chooses.`,
  },
  {
    slug: "guide-meetings",
    folder: "guide-work",
    title: "Meetings — schedule, attend and follow up",
    hook: "Book client and review meetings, invite team members and clients, and turn action items into tasks.",
    minutes: 3,
    shots: [
      { file: "meetings", caption: "Upcoming meetings on top, past meetings below." },
      { file: "meetings-new", caption: "Add Meeting: client or lead, date and time, attendees." },
    ],
    body: `The Meetings module keeps every review and client conversation in one place and links it to the client or lead.

![Meetings](shot:1)

## Schedule a meeting

1. Open **Work → Meetings** and click **Add Meeting**.
2. The **Schedule review meeting** page opens. Type a **Subject**, then choose **Who is the meeting with?** — **Client**, **Lead** or **Family** — and search for them by name or PAN.
3. Choose the **Meeting type** (for example Review Meeting) and the **Mode** (for example Online), the **Date**, **Time** and **Duration (minutes)**, and the **Initial status**.
4. Pick the **Assigned RM**, and a joint meeting partner if someone else attends. Add attendees further down the form: search for team members, clients and leads, or type a guest who is not in the CRM.
5. Save. Team attendees see the meeting in their list and calendar.

![Add Meeting](shot:2)

## Work the list

- **Upcoming meetings** is the expandable band at the top; **Past meetings** lists completed ones with notes.
- Use **Table** or **Kanban** at the top right.
- Search, sort and filter with the icons beside the search box.

## Action items are tasks

Every action item has an owner and a due date. When you save, a task is created for the owner automatically and they are notified. Editing the item edits the open task; removing it cancels the task.

## Completing a meeting

Mark a meeting done and it moves to **Past meetings**.`,
  },
  {
    slug: "guide-calendar",
    folder: "guide-work",
    title: "Calendar — everything due, in one view",
    hook: "Tasks, follow-ups, meetings, reviews, SIP dates, campaigns and compliance dates on a month or week calendar.",
    minutes: 2,
    shots: [{ file: "calendar", caption: "Month view with coloured chips for each kind of event." }],
    body: `The calendar collects every dated item you are responsible for.

![Calendar](shot:1)

## Use the calendar

1. Open **Work → Calendar**. It opens on the current month.
2. Use **← Sept** and **Nov →** to move between months, or switch **Month View** and **Week View**.
3. The coloured chips (**Task**, **Follow-up**, **Meeting**, **Review due**, **SIP**, **Campaign**, **Compliance**) show how many of each fall in the month. Click a chip to show or hide that kind.
4. Click an item on a day to open it.

## Sync to your own calendar

Click **Sync to Calendar** to connect these items to your own calendar app.`,
  },
  {
    slug: "guide-service-requests",
    folder: "guide-work",
    title: "Service requests — track every client ask",
    hook: "Log a client's request, set the clock, and see it through to closed — with a public form clients can use themselves.",
    minutes: 3,
    shots: [
      { file: "service-requests", caption: "Open, Escalated, Waiting on client and Closed tabs with a ticket number for each request." },
      { file: "service-new", caption: "New request: client, request type, subject and due date." },
    ],
    body: `A service request is any ask from a client that needs tracking: a statement, a nominee update, a bank change, a complaint. Each one gets its own ticket number such as SR-2026-00002 and a service clock.

![Service Requests](shot:1)

## Log a request

1. Open **Work → Service Requests** and click **New request**.
2. Search the **Investor** by name, PAN or phone — or leave it blank for a general request.
3. Choose the **Type** (for example KYC update, Statement Request, Nominee Update) and the **Priority**, then write a **Subject** — what the client needs in a few words, which is what the team sees in the list — and a **Description**.
4. Choose the **Channel** the request came in on (Phone, for example) and who it is **Assigned to** (it defaults to you). The due date follows the type's service clock; a complaint has a 21-day clock.
5. Click **Create request**. The ticket appears under **Open**.

![New request](shot:2)

## Work a ticket

- Tabs show **Open**, **Escalated**, **Waiting on client** and **Closed** with counts.
- Click a ticket to add notes, change its status or reassign it. Overdue tickets are escalated automatically.
- Use search to find by ticket number, subject or client.

## The service form for clients

Click **Service form** to get the firm's public link (or put it on your website). A client picks the service they need and submits; each service becomes its own ticket. It is linked to a client only when the email or mobile typed matches exactly one client, and goes to that client's RM.

Email never opens a ticket on its own.

## Complaints

A complaint is a request of type complaint. Website complaints from the firm's complaint form go to the compliance officer, else the owner.`,
  },
];
