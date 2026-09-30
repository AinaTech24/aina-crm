# 04 — Screen Specs

Specs for the **16 screens that define the design language**. Get these right
and the remaining ~287 follow, because they reuse the same patterns.

Each spec says what the screen is *for*, what's on it, and what's wrong with it
today.

---

## A1 — App Shell ⭐ *design this first*

The frame every staff screen sits inside. Everything else depends on it.

**Left sidebar — 256px expanded / 64px collapsed**
- Firm logo + name at top (tenant's own logo, not Aina's)
- 9 collapsible groups (see `03-INFORMATION-ARCHITECTURE.md`), ~50 items total
- Active item = **solid accent pill**, white label + icon
- Each item: 16px Lucide icon + label. Collapsed state shows icon only + tooltip
- Users can reorder their own sidebar
- Pin/collapse toggle, state saved per user
- Dark-tinted surface, scoped so the sidebar keeps its own palette

**Top bar**
- Global search (Ctrl+K command palette)
- Notifications bell
- Help & glossary (explains ARN, KYC, NAV, XIRR to non-specialists)
- User menu + firm switcher

**Content area** — `max-w-7xl`, 16px gutter, 20px vertical rhythm.

> **Today's problem:** all 50 nav items look equally important. A screen opened
> 30× a day sits beside one opened twice a year with identical weight. The
> biggest single win available is visual hierarchy inside the sidebar.

---

## A2 — My Day ⭐ *the landing page*

First screen after login. **Optimised for the owner who spends 10 minutes here.**

Answers one question: *what needs me today?*

Contains: today's tasks · meetings scheduled · failed SIPs to chase · service
requests awaiting reply · birthdays/anniversaries · alerts (KYC expiring,
nomination missing) · new leads.

**Design constraints**
- Must be scannable in 10 seconds
- A **severity budget** applies: only genuinely urgent things may use the alert
  colour. If everything is red, nothing is.
- Every item is actionable — clicking goes straight to the thing
- Must read well both when full and when empty ("nothing needs you today" is a
  real and good state, and deserves a proper design)

---

## A3 — Clients list ⭐ *most-used screen in the app*

The book of business. Staff live here.

**Table columns:** Client name · Client ID · PAN · Category · Segment · Tier ·
KYC status · Status · AUM · Assigned RM · Actions

**Also on screen:** search, multi-filter bar, saved segments, bulk selection +
bulk actions, column chooser, CSV export, "Add client" CTA, pagination
(books run to 8,000+ clients).

**Design constraints**
- Dense but scannable — this is the density benchmark for the whole app
- Status and KYC are badge columns; they must be distinguishable at a glance
  **without relying on colour alone**
- PAN is a 10-character alphanumeric read constantly → monospace or generous
  letter-spacing
- Row hover must be obvious; row click opens the client
- Must survive 8,000 rows

---

## A4 — Client 360 ⭐ *where RMs live*

Everything about one client on one page. The single densest screen in the product.

**Header:** name, client ID, PAN, category/tier badges, assigned RM, AUM,
quick actions (call, email, WhatsApp, new task, new meeting).

**Sections:** Client details · Contact & address · Bank account · KYC data +
CKYC number/expiry · Compliance status · Consent matrix (per channel × scope) ·
**Holdings** (see A5) · Transactions · SIPs · Goals · Financial plans ·
Insurance policies · Family members · Activity timeline · Documents ·
Tasks · Service requests · **Client health score** · **Churn-risk scorecard** ·
Birthday/anniversary + gift budget.

**Design constraints**
- Needs real navigation *within* the page — tabs, a sticky sub-nav, or an
  accordion. A single scroll is not usable at this length.
- Health score and churn risk are the two "insight" elements; they should feel
  different from the "record" elements
- Must print / export cleanly (RMs take this into meetings)

---

## A5 — Holdings table *(the density extreme)*

A 16-column financial table embedded in A4 and elsewhere.

`Scheme name · Folio · Units · Avg NAV · Latest NAV · NAV date · Inv. cost ·
Curr value · Unrealised gain · Realised gain · Dividend · Abs ret % · XIRR % ·
Sch wgt % · Start date · Avg days`

**Design constraints**
- Every number `tabular-nums`, right-aligned
- Gains: green positive, red negative, **plus a sign** — never colour alone
- Scheme names are long (60+ chars) and must not be truncated into ambiguity
- Horizontal scroll with a **frozen first column**
- Totals row
- This is the hardest table in the app. **If the design system survives this
  screen, it survives everything.**

---

## A6 — Command Center

Operational overview: what's flowing through the firm right now. KPI tiles,
trend charts, queues needing action, team activity.

Uses the 6-colour chart ramp. **Red must stay available to mean "problem"** —
so no series may use the accent hue.

---

## A7 — Reports catalogue

3-column card grid, 44 reports in 8 categories. Each card: icon, name,
one-line plain-English description.

**Design constraints:** must be browsable by someone who doesn't know the
report's name; needs search/filter; categories need clear visual separation.

---

## A8 — Report shell *(one design, 44 uses)*

Shared frame: page title + subtitle · filter bar (date range, branch, RM,
category) · optional chart · data table · export (CSV / PDF) · a footnote
explaining data caveats.

The **Taxation** cluster adds a 5-tab strip and FY chips
(Realised CG · Notional CG · Dividend/IDCW · FY-wise · Tax Package) that
preserve the selected financial year when switching tabs.

**This single spec covers 44 screens. It deserves disproportionate attention.**

---

## A9 — Workflow rules canvas

Visual DAG builder (React Flow). Drag nodes, connect edges, configure each node
in a side panel. 17 node types: triggers, conditions, branches, loops, waits,
and actions (send WhatsApp / email / SMS, create task, …).

**Design constraints:** node types must be instantly distinguishable; the canvas
must stay readable at 20+ nodes; validation errors must be visible on the canvas,
not hidden in a panel.

**Also needs:** a recipe library (24 pre-built automations) and a run monitor
showing live + historical executions with per-step status.

---

## A10 — Communications

Unified inbox + outbox across WhatsApp, email and SMS. Per-message status
(queued / sent / delivered / read / failed / skipped) with the **reason** a
message was skipped — consent missing, compliance block, WhatsApp session closed.

Includes a **response tracker**: a 4-stage funnel per send —
*sent → link opened → action taken → evidence recorded*.

---

## A11 — Template designer

Block-based editor for email / WhatsApp / SMS templates. Blocks: text, logo,
button, signature, table, spacer. Live preview beside the editor. A variable
picker (`{{investor.name}}`, `{{link.risk_profile}}`) with validation. Approval
status — WhatsApp templates need Meta approval before use.

---

## A12 — RTA import wizard

Multi-step: choose source (CAMS / KFintech) → upload file → preview parsed rows
→ map / resolve conflicts → commit → result summary.

**Design constraints:** files contain tens of thousands of rows; errors must be
actionable ("row 412: PAN missing"), not a wall of red; progress must be visible
because imports take minutes; the commit step is destructive-ish and needs a
clear confirmation.

---

## A13 — Merge Clients hub

Left utility nav, 5 fixed options with count badges: *Merge Client · Differ
Clients · View All Merged · Unmerged Suggestions · Merged By System*.

The merge screen itself is a **side-by-side field-level comparison** where the
user picks which value survives per field. It shows a dry-run preview before
committing, warns loudly on PAN mismatch, and every merge is reversible.

**A good pattern to study — it's the most carefully designed screen in the app.**

---

## A14 — Settings

22 screens behind a sub-navigation. Mostly forms. Needs a settings-specific
layout: section nav, form groups, save/discard affordances, and clear feedback
on what a setting actually affects.

---

## B1 — Risk-profile questionnaire ⭐ *public, mobile-first*

**A completely different register. Read `01-PRODUCT-BRIEF.md` §6 before designing.**

An investor opens a personal link from an email on their phone and answers 8
questions about their risk appetite. They may be 65 years old and have never
used a web form like this.

**Requirements**
- **One question per screen.** Never a scrolling wall.
- Large touch targets (56px minimum), large type (18px+ body)
- Visible progress ("Question 3 of 8")
- Every question is in the **second person** — "How would you react if your
  investment fell 20%?" — never "How would the client react?"
- Branded with the **firm's** logo and `ARN-XXXXX`, not Aina's
- No navigation chrome, no sidebar, no login
- Result screen explains the assigned category in plain language
- Must feel safe and official — this is about their life savings

**Same register applies to:** `/f/` feedback, `/p/` portfolio statement,
`/d/` document signing, `/onboarding/` client onboarding.

---

## B2 — Login / Signup

Login, signup, forgot/reset password, accept-invite, 2FA, choose-plan.

Signup is **self-serve** and creates a whole firm in one transaction, so the
plan-selection step matters commercially. Choose-plan shows 4 tiers as pricing
cards with client/seat limits.

---

## Patterns that repeat across all 303 screens

Design these once and most of the app is covered:

| Pattern | Notes |
|---|---|
| **Page header** | `.page-title` (24px bold + icon) + `.page-subtitle` (one plain-English line). **Every single page has this.** |
| **Stat card** | Label + big number + optional delta. The most-repeated component in the app and currently the least designed. |
| **Data table** | Sticky header, hover row, badge cells, right-aligned numerals, row actions |
| **Filter bar** | Search + dropdowns + date range + saved views + clear-all |
| **Empty state** | Currently inconsistent — some designed, many a bare muted line. Needs one pattern. |
| **Badge / chip** | Status, category, tier, KYC. Must work without colour alone. |
| **Form** | Label above input, helper text, inline validation |
| **Modal** | Confirm dialogs, quick-add forms |
| **Detail drawer** | Right-side sheet for inspecting a row without leaving the list |
| **Toast** | Bottom-right, success/error |
| **Loading** | Skeletons — static, no shimmer |
| **Tab strip** | Used on Client 360, Taxation, Merge hub |
