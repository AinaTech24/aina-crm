# 06 — Copy-Paste Design Prompts

Ready for **Google Stitch**, **Claude**, **v0**, **Figma Make** or **Lovable**.

**How to use:** paste `PROMPT 0` first to set the visual language for the
session. Then paste screen prompts one at a time, in order. Start with `A1` —
every other screen sits inside that shell.

Each prompt is self-contained, so if the tool loses context you can re-paste a
single one and still get a usable result.

---

## PROMPT 0 — Global style (paste this first, every session)

```
You are designing a premium B2B SaaS web application called "Aina CRM".

WHAT IT IS
A complete operating system for Indian Mutual Fund Distributor firms — small
financial advisory businesses that manage investments for retail clients.
It handles client records, investment portfolios, compliance registers, staff
management and automated client messaging. 303 screens total.

WHO USES IT
- Firm owners, aged 40-60, low technical skill, log in for 10 minutes a day
- Relationship managers, 25-40, live in the client detail screen
- Back-office operations staff who scan dense financial tables for hours
- Compliance officers preparing for regulatory audit
The hardest user is a 55-year-old owner who has never used modern SaaS.
If they cannot find something in five seconds, it is in the wrong place.

VISUAL DIRECTION
Premium, calm, trustworthy — it should feel like private banking software,
not a startup dashboard. It must look worth ₹60,000 per year. Competitors
(WealthElite, InvestWell, IFA-Planet) all look dated — dense grey tables and
2010-era blue gradients. Beat them on craft, not on decoration.

HARD RULES — do not break these
1. LIGHT MODE ONLY. Never design a dark variant. No theme toggle.
2. ONE ACCENT COLOUR, used only for actions and the active state. It must be a
   single variable, because each customer firm gets its own brand hue at
   runtime. Never build a design that only works in one specific colour.
   Use a deep crimson (#B71A20) as the placeholder.
3. Semantic colours are FIXED and never re-hued:
   green #288B5F success · amber #F59E0B warning · red #E8453C error ·
   blue #1E90C8 info
4. Chart colours are a FIXED 6-colour ramp that must never collide with the
   accent: #1E7FA8 blue, #1D7A54 green, #B0700A amber, #6B5CA5 violet,
   #2A8F8A teal, #8593A0 slate
5. SMALLEST TEXT IS 11px. Never smaller. Staff read ID numbers all day.
6. NO ANIMATION beyond 150ms colour fades. No parallax, no scroll reveals,
   no shimmer, no slide-ins. Static and instant.
7. Indian financial formatting: ₹ currency, lakh and crore (₹1.25 L,
   ₹634.98 Cr) — never $ or M/K. Dates DD-MM-YYYY.
8. Desktop-first at 1440x900, must hold down to 1280px.

FOUNDATIONS
- Typeface: Inter. Body 14px. Page titles 24px bold.
  (Proposing a second display typeface for headings is welcome.)
- Page background #EFF3F4, cards pure white. Keep a visible step between them —
  a previous version made them nearly equal and every panel dissolved.
- Corner radius 12px base, 16px on cards.
- Shadows soft, cool-tinted, low opacity. Cards at rest are nearly flat.
- Body text #16262A (charcoal-teal, not pure black), secondary #63757B.
- Borders #E1E8EA.
- All numbers use tabular figures so columns align.

WHAT TO FIX — the current design's real weaknesses
- Every screen is white cards on grey. No other structural device. It reads
  flat and identical across all 303 screens.
- Only one typeface; headings are just bold body text. No personality.
- Stat cards are a label and a number in a box — the most-repeated component
  in the app and the least designed.
- Tables are visually undifferentiated: a 16-column financial grid looks the
  same as a 4-column list.
- Empty states are inconsistent, often a bare line of grey text.
- No hierarchy between navigation items used 30 times a day and twice a year.

Acknowledge these rules, then wait for the screen brief.
```

---

## PROMPT A1 — App shell ⭐ *do this first*

```
Design the application shell for Aina CRM (see the style rules above).

LEFT SIDEBAR — 256px wide, dark tinted surface, full height
- Firm logo and firm name at the top (each customer firm shows its own logo)
- Nine collapsible groups, about 50 items total, in this order:
  1. Today — My Day, Tasks, Meetings, Service Requests, Client Feedback
  2. Clients — Leads, Clients, Family Mapping, Client Discovery, Risk Profile
  3. Advice — Calculators, Goal Planning, Financial Plans, Proposals, Insurance
  4. Operations — MF Transactions, SIP Book, Business Entries, Expected
     Inflows, RTA File Imports, Reconciliation, Activity Log
  5. Insights — Reports & MIS, Portfolio Intelligence, Practice Finances,
     Commission Reconciliation, Aina CRM Copilot
  6. Automation — Workflow Rules, Workflow Actions, Automation Monitor,
     Templates, Communications, Marketing Campaigns, Content Library
  7. Compliance — Compliance Center, DDQ Readiness, Circular Digest,
     SOP Library, Documents, Audit Log, Legal Registrations, Sub-Distributors
  8. People — Employees, Attendance, Leave Applications, Induction,
     Announcements
  9. Setup & data — Scheme Master, Products & Services, AMC Empanelments,
     Find Duplicates, Merge Clients, Trash
- Each item: 16px line icon plus label
- Active item is a solid accent-coloured pill with white text and icon
- Collapsible to 64px showing icons only with tooltips
- Groups ordered by daily frequency: daily work at top, configuration at bottom

THE KEY PROBLEM TO SOLVE
Right now all 50 items look equally important. Give me clear visual hierarchy
so the five screens someone opens every day stand out from the ones they open
twice a year. This is the single biggest improvement available.

TOP BAR
- Global search with a Ctrl+K command palette hint
- Notifications bell with unread count
- A help icon (it explains financial jargon like ARN, KYC, NAV, XIRR to
  non-specialist users)
- User avatar menu

CONTENT AREA
Max width 1280px, 16px side gutter, 20px vertical rhythm between blocks.
Show it containing a simple placeholder page so the proportions read correctly.
```

---

## PROMPT A2 — My Day (home)

```
Design "My Day" — the landing screen after login for Aina CRM.

It answers exactly one question: what needs me today?

The firm owner opens this for ten minutes each morning. It must be scannable
in ten seconds.

CONTENT BLOCKS
- Today's tasks
- Meetings scheduled today
- Failed SIP payments to chase (SIP = a monthly investment instalment; when
  one fails the client must be called)
- Service requests awaiting a reply
- Client birthdays and investment anniversaries
- Compliance alerts (KYC expiring, nomination missing)
- New leads that came in

RULES
- Every item must be actionable — clicking goes straight to the thing
- A strict severity budget: only genuinely urgent items may use the alert
  colour. If everything is red, nothing is.
- Also design the EMPTY state — "nothing needs you today" is a real, good and
  frequent outcome and deserves a proper design, not a grey line.

Page header pattern: 24px bold title with an icon, and beneath it one line of
plain English explaining the screen.
```

---

## PROMPT A3 — Clients list ⭐ *the density benchmark*

```
Design the Clients list for Aina CRM. This is the most-used screen in the
product — staff spend hours here. It must handle 8,000+ rows.

TABLE COLUMNS
Client name · Client ID · PAN (a 10-character government tax ID, e.g.
ABCDE1234F) · Category · Segment · Tier · KYC status · Status · AUM (money
managed, shown as ₹1.25 Cr) · Assigned manager · Actions

ALSO ON SCREEN
- Search field
- Filter bar with multiple dropdowns
- Saved segments / views
- Bulk row selection with a bulk-action bar
- Column chooser
- Export to CSV
- "Add client" primary button
- Pagination

RULES
- Dense but calm. This screen sets the density standard for the whole app.
- Status and KYC are badge columns and must be distinguishable at a glance
  WITHOUT relying on colour alone — add shape, icon or weight
- PAN is read constantly: use monospace or generous letter-spacing
- Obvious row hover; clicking a row opens that client
- Right-align all money, use tabular figures
- Sticky table header
```

---

## PROMPT A4 — Client detail (360 view)

```
Design the client detail screen for Aina CRM — everything about one investment
client on one page. This is the densest screen in the product and where
relationship managers spend their day.

HEADER
Client name, client ID, PAN, category and tier badges, assigned manager,
total money managed. Quick actions: call, email, WhatsApp, new task,
new meeting.

SECTIONS TO ORGANISE
Personal details · Contact and address · Bank account · KYC records with expiry
dates · Compliance status · Messaging consent grid (per channel) · Investment
holdings · Transaction history · Active SIPs · Financial goals · Financial
plans · Insurance policies · Family members · Activity timeline · Documents ·
Tasks · Service requests · Client health score · Churn-risk score ·
Birthday and anniversary dates

RULES
- This is far too much for one scroll. Give it real in-page navigation —
  tabs, a sticky sub-nav, or a structured accordion. Show your recommendation.
- The two scores (health, churn risk) are INSIGHTS and should feel visually
  different from the factual record sections
- Must print cleanly — managers take this into client meetings
```

---

## PROMPT A5 — Holdings table *(hardest layout in the app)*

```
Design a 16-column financial data table for Aina CRM showing one client's
investment holdings. This is the most extreme density case in the product —
if the design survives here it survives everywhere.

COLUMNS
Scheme name (fund names run to 60+ characters) · Folio number · Units ·
Average NAV · Latest NAV · NAV date · Invested cost · Current value ·
Unrealised gain · Realised gain · Dividend · Absolute return % · XIRR % ·
Scheme weight % · Start date · Average days held

RULES
- All numerals tabular and right-aligned
- Gains and losses: green for positive, red for negative, AND an explicit
  + or − sign. Never colour alone.
- Long fund names must stay unambiguous — do not truncate into confusion
- Horizontal scroll with the scheme-name column frozen
- A totals row at the bottom
- Must stay readable at 1280px viewport width

Show it embedded inside a card on a client detail page.
```

---

## PROMPT A6 — Reports catalogue + report shell

```
Design two related screens for Aina CRM.

SCREEN 1 — Reports catalogue
A browsable grid of 44 business reports in 8 categories: Business & revenue,
Clients & risk, SIP & transactions, Taxation, Schemes & products, Insurance,
Team & compliance, Custom.
Each report is a card with an icon, its name, and one line of plain English
describing what it tells you.
It must be findable by someone who does not know the report's name — include
search and category filtering, with clear visual separation between categories.

SCREEN 2 — The shared report shell
One frame reused by all 44 reports, so it deserves disproportionate care:
- Page title plus a plain-English subtitle
- Filter bar: date range, branch, relationship manager, category
- An optional chart area (use the fixed 6-colour chart ramp; the accent colour
  must NOT appear as a data series, because red has to keep meaning "problem")
- A data table
- Export buttons for CSV and PDF
- A footnote line explaining data caveats

Show the shell filled with a realistic example: a "SIP Health" report with a
trend line and a table.
```

---

## PROMPT A7 — Workflow automation canvas

```
Design the visual workflow builder for Aina CRM.

Users build automations as a flowchart: "when a client's SIP payment fails,
wait 1 day, then send a WhatsApp message, and create a task for their
relationship manager."

CANVAS
- Draggable nodes connected by edges
- 17 node types across four families: triggers, conditions, branches and
  loops, and actions (send WhatsApp / send email / send SMS / create task /
  wait / branch)
- A configuration panel on the right for the selected node
- Zoom and pan controls, and a minimap

RULES
- The four node families must be instantly distinguishable at a glance
- Must stay readable with 20+ nodes on screen
- Validation errors must show ON the canvas at the offending node, not hidden
  in a side panel
- Remember: the user is a financial advisor, not an engineer. This must not
  look like developer tooling.

Also design the companion RUN MONITOR screen: a list of automation executions
with per-step status (success, failed, waiting, skipped) and timing.
```

---

## PROMPT A8 — Client-facing risk questionnaire ⭐ *completely different register*

```
Design a public, mobile-first questionnaire for Aina CRM. IGNORE the desktop
app styling — this is a separate visual register.

WHO SEES IT
An ordinary investor, often 60+ years old, who received a personal link by
email or WhatsApp and opened it on their phone. They may never have filled in
a web form like this. They will use it once. It concerns their life savings.

WHAT IT IS
Eight questions about their attitude to investment risk, then a result screen
showing their assigned risk category.

REQUIREMENTS
- ONE QUESTION PER SCREEN. Never a scrolling wall of questions.
- Touch targets at least 56px tall; body text 18px or larger
- Visible progress indicator ("Question 3 of 8")
- Every question is written in the SECOND PERSON, addressing the investor
  directly: "How would you feel if your investment fell 20% in a month?"
  Never "How would the client feel?"
- Branded with the ADVISORY FIRM's logo and their regulatory number shown as
  "ARN-90577" — not the software vendor's branding
- No navigation, no sidebar, no login, no menu
- A result screen explaining their risk category in plain, reassuring language,
  with a way to request a change
- It must feel official, safe and calm — like a bank, not an app

Design for a 390px wide phone screen. Show three states: a question, the
progress through the set, and the result screen.
```

---

## PROMPT A9 — Core component library

```
Design the core component set for Aina CRM as a single sheet, using the style
rules given earlier. These repeat across all 303 screens, so they carry the
whole design.

1. PAGE HEADER — 24px bold title with a 24px icon, plus one line of plain
   English beneath it explaining the screen. Every page in the app has this.

2. STAT CARD — label, large number, optional change indicator. This is the
   most-repeated component in the product and currently the least designed.
   Show at least three weights: hero, standard, compact. Money is shown as
   ₹1.25 Cr with tabular figures.

3. DATA TABLE — sticky header, hover row, badge cell, right-aligned numeric
   cell, row actions. Show two density tiers: comfortable and compact.

4. BADGES / CHIPS — for status, category, tier and KYC state. Must be
   distinguishable WITHOUT colour alone.

5. BUTTONS — primary (solid accent), secondary, ghost, destructive, icon-only.
   Include hover, focus-visible, disabled and loading states.

6. FORM FIELDS — text input, select, multi-select, date picker, with label
   above, helper text, and inline error.

7. EMPTY STATE — currently the weakest thing in the app. Design one reusable
   pattern: illustration or icon, a headline, one explanatory line, and a
   primary action.

8. FILTER BAR — search, dropdowns, date range, saved views, clear-all.

9. TOAST — success and error, bottom-right.

10. MODAL and RIGHT-SIDE DRAWER — the drawer inspects a table row without
    leaving the list.

Every component must work with ANY accent hue, since each customer firm sets
its own brand colour at runtime.
```

---

## Extra prompts — use when you need them

<details>
<summary><b>A10 — Communications inbox</b></summary>

```
Design the Communications screen for Aina CRM: a unified inbox and outbox
across WhatsApp, email and SMS.

Each message shows its channel, recipient, content preview, timestamp and
delivery status: queued, sent, delivered, read, failed, or SKIPPED.
A skipped message must clearly show WHY it was skipped — consent missing,
blocked by a compliance rule, or the WhatsApp session window had closed.
That explanation is a regulatory feature, not an error message.

Also design a response tracker: a four-stage funnel per campaign showing
sent → link opened → action taken → evidence recorded.
```
</details>

<details>
<summary><b>A11 — RTA import wizard</b></summary>

```
Design a multi-step import wizard for Aina CRM.

Users upload data files from Indian mutual fund registrars (CAMS, KFintech)
containing tens of thousands of investor and transaction rows.

Steps: choose source → upload file → preview parsed rows → resolve conflicts
and map fields → confirm → result summary.

Rules: progress must be visible because imports take several minutes; errors
must be per-row and actionable ("row 412: PAN missing") rather than a wall of
red; the confirm step changes live client data and needs a clear, calm
confirmation; the result summary must state exactly what was created, updated
and skipped.
```
</details>

<details>
<summary><b>A12 — Merge duplicate clients</b></summary>

```
Design a duplicate-client merge screen for Aina CRM.

Left utility nav with five options and count badges: Merge Client, Separate a
Merge, All Merged Clients, Suggested Duplicates, Merged Automatically.

The merge screen itself is a side-by-side comparison of two client records
where the user picks, field by field, which value survives. It shows a preview
of exactly what will change before committing, warns prominently when the two
records have different PAN numbers, and makes clear that the merge can be
reversed.

This is a high-stakes destructive-feeling action on real client data. The
design must make the user feel in control.
```
</details>

<details>
<summary><b>A13 — Login, signup and plan selection</b></summary>

```
Design the authentication screens for Aina CRM: login, signup, forgot password,
and a plan-selection step.

Signup is self-serve and creates an entire advisory firm account. The
plan-selection screen shows four pricing tiers as cards — Starter, Growth
(marked Most Popular), Professional, Enterprise — each with a monthly and
yearly price in rupees, a client limit and a staff-seat limit.

These are the first screens a prospective customer sees, so they carry the
premium positioning. Trustworthy, financial, calm.
```
</details>

---

## After you get the designs back

Bring me any of: Figma link, exported PNGs, or just the new token values.

**The cheap path:** if the redesign is expressed as new values for the tokens in
`02-DESIGN-TOKENS.md` — colours, type scale, radius, shadows, spacing — then
most of it lands in two files (`globals.css`, `tailwind.config.ts`) and all 303
screens re-skin at once.

**The expensive path** is layout change, which is per-screen. That's fine and
often right — just know that A1 (shell), A4 (client 360) and A8 (report shell,
×44 uses) are where layout changes pay off most, and that a layout change to a
one-off settings page mostly doesn't.

Tell me which screens you want restructured versus merely restyled, and I'll
sequence the work accordingly.
