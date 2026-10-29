# CLAUDE.md — Developer guide for this codebase

Welcome. This file is the deep-dive for engineers (and future Claude Code sessions) working in this repository. Read [README.md](README.md) first for the product overview and quick-start.

---

## Mental model

The platform is a **multi-tenant SaaS for Indian Mutual Fund Distributors (MFDs)**. Tenants are MFD firms; users inside a tenant are owner / branch_head / RM / ops / compliance / marketing / investor. The product is built around an **automation & messaging engine** that turns every domain event (rejected SIP, redemption, birthday, NIFTY drop) into a compliance-checked sequence of actions, hands-off.

The **central spine** is:

```
events_outbox  →  outbox poller  →  workflow_triggers  →  workflow_runs
                                            │
                                            ▼
                              action handlers (send_*, create_task, branch, …)
                                            │
                                            ▼
                       comms pipeline (consent → compliance gate → channel adapter)
                                            │
                                            ▼
                              AiSensy WA · Resend email · MSG91 SMS
```

If you understand that diagram you understand the codebase.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web | Next.js 15 (App Router) + React 19 + TypeScript | One repo for UI + API routes |
| DB | Postgres 16 + Drizzle ORM | RLS for multi-tenancy; type-safe queries |
| Queue | BullMQ on Redis 7 | Battle-tested, repeatable jobs, rate-limiting per queue |
| UI | shadcn/ui patterns + Tailwind + React Flow (workflow canvas) | Hireable, fast |
| Validation | Zod | Single source for forms, AST, template variables |
| Email | Resend + React Email | Sane DX, swappable to SES at scale |
| WhatsApp | AiSensy v2 API | India-native BSP, MFDs already use it |
| SMS | MSG91 (DLT-compliant) | Required in India |
| AI | Anthropic Claude API (Sonnet for compose, Haiku for classify) | Production-grade reasoning |
| Auth | NextAuth v5 (scaffolded; not fully wired) | Standard Next pattern |

---

## Directory layout

```
src/
  app/                           Next.js App Router
    api/webhooks/                AiSensy, Resend webhook handlers
    api/segments/preview/        Filter builder live-preview endpoint
    dashboard/                   Authenticated app shell
      workflows/                 Workflow list + recipe library + canvas
      segments/                  Segment list + filter builder
      templates/                 Template list + designer
      communications/            Unified inbox + outbox timeline
      compliance/                DDQ score + expiry watch + audit trail
      investors/, leads/, tasks/, settings/
  components/workflow/           React Flow canvas wrapper

  db/
    client.ts                    Drizzle pool + withTenant() / withSystem() helpers
    schema/                      One file per logical group of tables
      tenants, users, branches, families, investors, folios, transactions,
      leads, tasks, goals, workflows, segments, templates, communications,
      consents, campaigns, outbox, audit, service_requests, compliance
    seed.ts                      `npm run seed` — populates recipes

  lib/
    filter/                      Filter AST, catalog, SQL compiler, JS predicate
      ast.ts        Zod schema for FilterAST + helpers (and/or/p/not)
      catalog.ts    Per-subject field catalog (investor/lead/task/user) — drives UI + compiler
      compiler.ts   compileToSql + compileToSelect — safe parameterized SQL
      predicate.ts  compileToPredicate — in-memory matcher for event-time
    workflow/                    Workflow engine
      schema.ts     Zod schema for graphs/nodes/edges + validateGraph()
      runner.ts     startRun() + executeStep() — the orchestrator
      context.ts    RunContext + resolveExpression / resolveRecord
      actions/      One file per action handler
    comms/                       Communication pipeline
      pipeline.ts   dispatch() — the unified send funnel
      compliance.ts 11 deterministic compliance checkers
      tokens.ts     Typed variable resolver + renderTemplateText
      email_renderer.tsx  React Email block-based renderer (auto-footer)
      adapters/aisensy.ts | resend.ts | msg91.ts
    recipes/                     24 pre-built MFD automation recipes

  workers/                       BullMQ worker process (npm run worker)
    index.ts                     Entry point — starts all workers
    outbox-poller.ts             Drains events_outbox; matches triggers
    workflow-runner.ts           Executes queued workflow runs
    segment-materializer.ts      Re-materializes dynamic segments
    master-scheduler.ts          Fires schedule-kind triggers
    aisensy-template-sync.ts     Polls AiSensy for Meta approval status
    queues.ts                    BullMQ queue + Redis connection helpers

drizzle/
  migrations/
    0001_rls_policies.sql        Enables RLS + tenant_isolation policy on every domain table
```

---

## Multi-tenancy: the hard rule

**Every domain table has `tenant_id`. Every query is wrapped in `withTenant(tenantId, async (tx) => ...)`. RLS does the rest.**

```ts
// In an API route:
await withTenant(session.tenantId, async (tx) => {
  return tx.select().from(investors).where(...);  // RLS scopes automatically
});
```

`withTenant` sets the `app.tenant_id` Postgres session variable for the duration of the transaction. Every RLS policy reads it. If you forget, the query returns zero rows (RLS rejects). Never call `db.transaction()` directly outside system-context tooling.

System-level operations that legitimately need cross-tenant access (the outbox poller, the segment materializer scanning all tenants) use `withSystem()` — guarded by `ALLOW_SYSTEM_TX=1` env var.

**When you add a new table:** include `ENABLE`/`FORCE ROW LEVEL SECURITY` + a `tenant_isolation` policy in the table's own migration (every migration after 0030 does this — copy the pattern from a recent one). The static `tenant_tables` array in `0001_rls_policies.sql` is **historical/stale** — actual coverage is enforced by the dynamic backfill in `0030_rls_backfill_all_tenant_tables.sql` and verified in CI by `npm run check:rls`, which fails the build if any `tenant_id` table lacks a policy. Don't rely on editing the 0001 array.

---

## The Filter AST — one query language, three consumers

`src/lib/filter/ast.ts` defines a recursive JSON AST: groups (`AND`/`OR` with `not`) of predicates (`field op value`). Three consumers:

1. **`compileToSql(ast, subject)`** → parameterized SQL fragment for batch queries
2. **`compileToPredicate(ast, subject)`** → in-memory `(row) => boolean` for event-time matching
3. **UI filter builder** at `/dashboard/segments/new` — generates the AST visually

The **catalog** (`src/lib/filter/catalog.ts`) is the source of truth for what's queryable per subject. To add a new field: append a row to the catalog — the UI, compiler, and AI assistant auto-pick it up. The catalog enforces which operators each field supports.

**Security:** the AST can only reference catalog fields. Values are always parameterized. There is no way for user input to inject SQL.

---

## The Workflow Engine

### Graph shape

A workflow is a DAG. Nodes have a `type` (17 supported) and a typed `config`. Edges connect by `id` + optional `sourceHandle` (for branch / loop / wait_for_event multi-out).

Validation in `validateGraph()` enforces: every node id unique; every edge endpoint exists; reachability from `startNodeId`; cycles only through `loop` nodes; branch nodes have edges for every case.

### Execution model

`workflow_runs` is the state-machine table. Each row: `{ status, current_node_id, variables, paused_until, wait_predicate, ... }`. The runner (`executeStep`) loads the run, picks the current node, runs the handler, persists outcome, advances `current_node_id`. A separate worker (`src/workers/workflow-runner.ts`) drives this in a tight loop.

**Idempotency rule:** handlers must be safe to retry. Use the `(runId, nodeId, attempt)` combination as the idempotency key when writing to external systems.

**Versioning:** `workflow_versions` is append-only. `workflows.current_version_id` points at the published version. In-flight runs continue on the version they started with — editing a workflow does not break running instances.

### Adding a new action handler

1. Create `src/lib/workflow/actions/<your_action>.ts` exporting an `ActionHandler`.
2. Add the type + config Zod schema to `src/lib/workflow/schema.ts` (`NodeConfigByType` and the discriminated union).
3. Add the handler to the `handlers` map in `src/lib/workflow/actions/index.ts`.
4. (Optional) update the UI node-style table in `src/components/workflow/WorkflowCanvas.tsx`.

---

## The Comms Pipeline

`dispatch()` in `src/lib/comms/pipeline.ts` is the **only** way to send an outbound message. It runs these steps in order:

1. Resolve template + version (must be `approved`)
2. Render — resolve typed variables, format (INR, dates, etc.)
3. Consent check (per channel × scope) — one rule, `consentDecision()` in `lib/comms/consent-rule.ts` (the firm's decision of 2026-09-29): an opt-out always blocks; marketing needs a recorded granted consent; a transactional / utility message goes out unless the client opted out
4. WhatsApp session window check (for WA only)
5. **Compliance gate** — 11 deterministic rules, blocks send on any `block` finding
6. Insert `communications` row (status `queued`) with consent + compliance snapshot
7. Call channel adapter (AiSensy / Resend / MSG91)
8. Update `communications.external_id` + status + timestamp

Any skip (consent missing, compliance block, WA session not active for marketing) creates a `communications` row with a `skipped_*` status — full audit, every time.

Workflows call `dispatch()` via `send_whatsapp` / `send_email` / `send_sms` actions. Campaigns will call it via a per-recipient fan-out (TBD).

### Client-facing CTAs: never link to `system.dashboard_url`

`{{system.dashboard_url}}` resolves to the **firm's own login page**. In an
email to a CLIENT it is a dead end — they cannot sign in. Use the per-recipient
link tokens instead:

| Token | Lands on | Minted as |
|---|---|---|
| `{{link.risk_profile}}` | `/r/<token>` — the questionnaire | `risk_profile` share token, 21 days |
| `{{link.feedback}}` | `/f/<token>` — the 0–10 NPS form | `feedback` share token, 30 days |

`src/lib/comms/client-links.ts` fills these, plus the recipient's own
`risk.*` (category, score, what the band means, review date) and
`suitability.*` (equity exposure vs the profile's band, and the schemes driving
a breach). It runs inside `dispatch()` only when the template body actually
references one of those namespaces, so an ordinary send mints nothing. A live,
unused token for the same (subject, kind) is REUSED — otherwise a reminder
email would silently invalidate the link sitting in the first one.

### Branding an email: logo and sign-off

Both are automatic, from data the firm already holds:

- **Logo** — the `logo` block (or, with no such block, an auto-logo at the top)
  draws `tenants.logo_url`. The pipeline makes it absolute before sending;
  Gmail and Outlook cannot load a relative `/…` path. No logo on the tenant
  means the block renders nothing rather than a broken image.
- **Sign-off** — the `signature` block draws the RECIPIENT'S relationship
  manager: their uploaded signature image (`users.signature_url`, set in
  Settings → Profile), then name, designation, phone/email, and the firm with
  its ARN. Every line is optional and simply omitted when absent, so a user who
  has uploaded nothing still gets a clean typed sign-off. The pipeline fills
  `investor.rm_name` / `rm_designation` / `rm_email` / `rm_phone` /
  `rm_signature_url` in `loadInvestor`.

Prefer the block over hand-writing "Warm regards, {{investor.rm_name}}" in a
text block: the block also carries the image and contact details, and one
template then signs correctly for whichever RM owns the client.

### The firm's introduction: `{{firm.*}}`

Settings → Email introduction (`tenants.email_intro`, migration 0246,
`src/lib/firm/email-intro.ts`, 2026-10-26) holds what a firm says about
itself: `firm.company_intro`, `firm.services` (one per line, sent as
bullets), `firm.office_timing`, `firm.mission`, `firm.founder_name`,
`firm.founder_designation`, `firm.founder_photo_url` (an uploaded image, made
absolute on send) and `firm.founder_intro` — plus up to 20 fields the firm
names itself, each `{{firm.<slug of its name>}}` ("Awards" → `firm.awards`).
`dispatch()` fills them on every send, the designer preview uses the firm's
own values once it has any, and the designer's picker lists the firm's own
fields under "Firm introduction".

- **A blank field is absent, not empty.** Give a block `showIf: "firm.mission"`
  (the designer's "Show this block" control) and it drops out of the email —
  heading and text together — for a firm that never wrote one. An image whose
  URL resolves to nothing draws nothing.
- **The new-lead welcome uses all of it** (`leadWelcomeBody` in
  `lib/templates/starters.ts`, template keys `lead_welcome` /
  `lead_welcome_referral`, sent by the "Welcome email to a new lead"
  automation). Migration 0246 moved every firm's UNEDITED copy to it as a new
  version; a copy the firm had edited was left alone. Changing the body later
  needs its own upgrade migration in the same shape (point the drift check in
  `tests/firm-email-intro.test.ts` at it) — never edit an applied one.

Two constraints worth knowing before authoring a template:

- **Merge values are HTML-escaped.** A token carrying markup (`<li>…</li>`)
  prints its own tags to the client. Emit plain text and let the block do the
  formatting. A value typed over several lines keeps its line breaks.
- **Every public form path needs a `PUBLIC_PATH_PREFIXES` entry** in
  `src/middleware.ts`, or the link 307s the client to `/login`.

### Emailing a client about ONE record — a rejected SIP, a switch / STP / SWP

An **Email** button on SIP Rejections (rows still being worked) and on the
Transactions screen (processed switch / STP / SWP rows) posts to
`POST /api/investors/[id]/record-email` (`{ kind, recordId }`). The values come
from THAT record (`lib/comms/record-email.ts`), not the template's auto-fill,
which reads the client's most recent transaction. A value the record lacks is
sent as "—": `dispatch()` treats a blank caller variable as "not supplied" and
fills it from the newest record, which would print another record's folio.

- The emails are the designer starters `sip_rejection` and `switch_stp_swp`
  (`RECORD_EMAIL_TEMPLATE_KEYS`), installed as the firm's own approved templates
  the first time they are used (`installEmailStarters`); a template the firm
  archived is left alone. A transactional email, so it goes unless the client
  opted out, through the compliance gate, from the RM's own mailbox when
  connected. The key is stable for ten minutes, so a double click sends once.
- A switch confirmation is refused unless the transaction is processed /
  successful; a SIP-rejection email unless the rejection is open (pending,
  client contacted, bank or mandate issue).
- **A workflow's email step installs these too** (`ensureEmailStarter`, in
  `send_email`) — only these two and the old names in `EMAIL_STARTER_ALIASES`
  (the "SIP rejection follow-up" recipe once named `sip_rejection_mandate_expired_email`,
  a template that never existed; a firm's installed copy keeps that name). An
  explicit list, never "any starter": what installs here is approved with nobody's
  sign-off. The recipe now passes the triggering rejection's scheme / amount /
  reason / date.
- Recipe `defaultTemplates` are NOT installed anywhere: the recipe's WhatsApp
  templates still have to exist in the firm for its WhatsApp steps to send.

### Adding a new compliance rule

Append a function to `ALL_RULES` in `src/lib/comms/compliance.ts`. Each rule is `(ctx) => ComplianceFinding[]`. Severity `block` stops sends; `warn` shows in UI but allows; `info` is logged.

---

## Opportunities — an existing client wants another product

A LEAD is a new person. An existing client asking for insurance, a new SIP,
NPS or an FD is an **opportunity** on their client record (`client_opportunities`,
migration 0224) — never a new lead, which would duplicate the person and fail
at conversion on the PAN. Code: `src/lib/opportunities/` (products · stages ·
journey · access), APIs under `/api/investors/[id]/opportunities` and
`/api/opportunities/[id]` (+ `/advance`, `/sync`), UI `OpportunitiesPanel` on
the client page's Overview tab.

- **One open row per (client, product)**; several products can be open at
  once. Products are the Cross-sell vocabulary plus "other"; creating one marks
  the product "Interested" on the Cross-sell card, winning marks it "Held with
  us", and the owner gets a follow-up task (closed with the opportunity).
- **The journey is a blueprint** (subject_type `opportunity`, module
  `opportunities`): identified → discussion → suitability → proposal → accepted
  → the product branch (MF: transaction → review → RTA data check; insurance: proposal form →
  underwriting → issued; general: executed) → won. Lost from any open stage,
  with a reason and an optional revisit task. **KYC, UCC and mandate are not
  steps** (removed at the firm's request 2026-10-17, migration 0251 — they are
  client onboarding); do not put them back. They remain a gate on
  Transaction placed.
- **Skips**: a stage the client already satisfies (a current risk profile or
  needs analysis, a sent / accepted proposal, a recorded transaction or
  policy) is passed automatically with a history remark. The
  people steps (identified, discussion) are never skipped — except when a
  proposal has been shared, which proves they happened.
- **Gates, never bypassed**: an MF proposal needs a client-CONFIRMED risk
  profile signed in the last 12 months (a provisional, age-suggested one does
  not count); an insurance quote needs a recorded needs analysis; an MF
  transaction needs KYC, a UCC and, for a SIP, a mandate covering it.
- **Entry points**: "New opportunity" on the client page, the Cross-sell
  card's opportunity chips, and the new-lead form — `check-duplicate` also
  matches existing clients and offers "Start opportunity" (a client outside the
  viewer's book is reported only as "already a client", no name or RM).
- **Proposals**: `proposals.opportunity_id` links a proposal to the
  opportunity it answers; the proposals module calls
  `onProposalEvent(tx, tenantId, proposalId, "sent" | "accepted" | "declined")`.
- **Reporting**: the Owner Dashboard's
  Cross-sell card (`lib/metrics/opportunities.ts`) — products per client counts
  what the records prove (AUM → MF, in-force policy → its line, live FD → FD /
  Bonds / NCD) plus the card. The Pipeline Board (`/dashboard/pipeline-board`)
  was removed at the firm's request on 2026-10-02 and redirects to Leads —
  do not restore it.
- **The Opportunities module** (`/dashboard/opportunities`, sidebar Clients,
  2026-10-02): every opportunity the viewer can see — access follows the
  client (`investorScopeSql`) — on a board by journey step (the five people
  steps, then one "Processing" column for the product branch, then Won /
  Lost) or as a list, with filters and the headline figures (open, follow-ups
  overdue / today / not set, won this month). Loader `lib/opportunities/board.ts`.
  Each opens `/dashboard/opportunities/[id]`, where the journey runs: the same
  `OpportunityCard` the client page uses, plus history, details (Edit), the
  client and its tasks. "New opportunity" there picks the client.
- **Proposal approval, then transaction review** (2026-10-16, migration 0239).
  The step after "Client accepted" is gated on the client having APPROVED the
  proposal (`AFTER_ACCEPTED` in stages.ts); until then the journey waits, and
  `onProposalEvent("accepted")` moves it on by itself. An MF journey now ends
  Transaction placed → **Approve / reject transaction** (`txn_review`) → Won,
  and is never skipped or advanced generically: `decideTransaction` /
  `POST /api/opportunities/[id]/transaction-review`. Approve wins the client and
  creates a "client won" task (`meta.wonOpportunityId`, so closing does not
  complete it); reject needs a reason, returns to Transaction placed with a fix
  task, and the rejected transaction no longer counts in `loadFacts`.
- **Each step asks for what it needs** (2026-10-17, migration 0250,
  `lib/opportunities/steps.ts`, `POST /api/opportunities/[id]/step`,
  `StepActions.tsx`): Need identified → Log call (no answer stays, with a
  retry date) or Schedule meeting (made through the Meetings API, linked as
  `meeting_id`; completing it in Meetings moves the journey on); Discussion →
  Meeting done / Reschedule; Client accepted, Order placed (amount, date,
  order no.), and the insurance and general steps each record their facts in
  `step_details`. Back-office steps can be handed to an operations person
  ("Assign to operations": a task with `meta.opportunityStepOf`, not the
  follow-up). Every pop-up offers the next follow-up date and no notes box.
  Gates still apply.
- **RTA data check** (2026-10-19, migration 0240). Approving an MF transaction
  no longer wins the client: it moves to `rta_check` and creates a high-priority
  task (`meta.opportunityId` + `rtaCheck: true`) to check the transaction against
  the RTA data, assigned to whoever the approver picks in the Approve dialog
  (default the opportunity's owner; the assignee is notified) and due the day they
  choose (default tomorrow). **Won** is gated on that task being completed (`gateFor("won")`);
  the "client won" task is created at that point (`createWonTask`). The gate's link opens that
  task itself (`/dashboard/tasks/<id>`), and at the RTA data check step the card offers
  **Complete RTA data check** (`Prerequisite.completeTaskId`), which completes the task through
  the ordinary `PATCH /api/tasks/[id]` so it reads completed in the Tasks module too.
- **Follow-ups ARE tasks.** An opportunity's next follow-up is its earliest
  open task with `meta.opportunityId` — there is no column. The follow-up date
  chosen at creation is the first task's due date (10:00 IST; default two
  days), and `setFollowUp` (PATCH `followUpOn`) moves the open one or creates
  one. Completing the task clears it; an open opportunity with none reads
  "No follow-up set".
- **"Later" — the client wants it, but not yet** (2026-10-07, migration 0231,
  `lib/opportunities/later.ts` + `later-core.ts`). "After Diwali", "in three
  months", "when my FD matures": the opportunity is PARKED — still open (one
  open row per product holds; Cross-sell still says Interested) with
  `parked_at`, `revisit_on`, `parked_reason`, `park_count`. Its open tasks end
  and ONE reminder task (meta `revisit: true`) falls due 7 days before the
  revisit date for MF / other, 15 for insurance. Waiting for MONEY records an
  expected inflow (`expected_inflow_id`) whose own reminder task is that
  reminder — never two. A reminder 3 days overdue notifies the client's branch
  head once (task reminder scanner, `escalateOverdueRevisits`). Resume, moving
  the journey on, or a proposal being shared brings it back; the Opportunities
  board has a "Later" column and tile. Started from the card ("Client wants it
  later") or the New opportunity dialog (Now / Later). Diwali dates are a
  table in later-core — add the next year as the calendar rolls on.

## Fresh KYC — Online or Physical KYC

When a client needs a **fresh KYC** ("Register Fresh KYC" / the KYC Registered
step of the onboarding journey), the app asks which KYC the client will do —
**Online** (e-KYC via Aadhaar OTP / DigiLocker) or **Physical** (in-person
verification) — and creates that high-priority task in the Tasks module for the
person picked, due the date chosen (2026-10-26). **KYC Validated** asks nothing:
one click marks the KYC verified and moves on (the firm's correction — a
validated KYC has nothing left to choose).
Lead-backed journeys ask in the step pop-up (`KYC_MODES` in
`components/leads/GuidedStageActions.tsx`, on `kyc_registered`; the engine's
journey task takes the chosen title). Every other client — a direct entry or an
import, whose journey bar is read-only — opens `KycRouteDialog` from the KYC
Registered step (`components/investors/InvestorBlueprintStageBar.tsx`), which
posts the task to `/api/tasks` linked to the client.

## Date of demise — a client who has died

`investors.date_of_demise` (migration 0241), on every client type: the client
form, Add client and the inline edit on the client page. Recording one
(`lib/investors/demise.ts`, called by the investor PATCH / POST in the same
transaction) marks the client **Inactive** (not Closed / Exited — they may
still hold units pending transmission, so AUM keeps counting), **stops** their
Active / Paused / Pending SIPs (remarks "Stopped — client deceased on …") and
**cancels** orders still Pending / Submitted. Processed transactions are the
registrar's history and are never deleted. Audited as `investor.demise_recorded`.
Clearing the date returns an Inactive client to Active; SIPs stay stopped. The
RTA SIP import (`processSipBook`) does not turn a stopped SIP of a deceased
client back to Active. The client page shows a "Deceased" banner.

## Moving folios between two clients

Clients list → select exactly two → **Merge** (bulk bar) opens
`FolioTransferDialog`: pick the direction, tick the folios (their schemes are
listed), optionally move their transactions and SIPs, and confirm
(`/api/investors/folio-transfer`, `lib/investors/folio-transfer.ts`; owner /
branch head, merge scope, a PAN clash needs an explicit tick). The unit is the
folio — a folio belongs to one client, so schemes inside it travel with it. To
fold a whole duplicate record away use Merge Clients (`mergeInvestors`).

## Overdue tasks — the escalation ladder

Settings → Escalation (`/dashboard/settings/escalation`, 2026-10-24, CEO
review S4). Rules in `lib/tasks/escalation-ladder.ts`, one pass in
`lib/tasks/escalation-run.ts`, run every five minutes by the task reminder
scanner. Stored in `dashboard_settings.settings.escalationLadder` — the
dashboard-thresholds save and reset keep that key.

- **Off until the firm switches it on**, and then only tasks that fall due
  AFTER that moment (`activeSince`) climb — never the backlog.
- A rule per department / task type / priority (most specific wins, else
  "Everything else", 24 / 48 / 72 h) gives the hours overdue at which a task
  reaches: L1 the assignee's reporting manager, L2 the branch head(s) of the
  assignee's branch, L3 the owner(s). A blank hour skips that level.
- Each level is told once (`task.escalated` notification + audit) and
  recorded in `tasks.meta.escalation` (`l1`/`l2`/`l3`: at, to; `to`: everyone;
  `done` once every level is reached). The assignee is never escalated to.
- While it is on, the scanner's instant "team follow-up overdue" ping to the
  branch head is not sent — the ladder does that job at the firm's hours.
- **Escalated to me counts as my own task**: `own()` in `lib/tasks/scope.ts`,
  the task page and its comments let that person open and discuss it; the
  Tasks list has the "Escalated to me" flag (`?flag=escalated_to_me`).

## Daily habits — the cues that bring people back (2026-10-08)

Built from an Atomic Habits review of adoption: make the cue obvious, the
action easy, the result satisfying.

- **Morning cue.** The 8 am briefing (`workers/daily-briefing.ts`) is in
  `MOBILE_ALERTS`, so it reaches the phone.
- **Removed at the firm's request (2026-10-29) — do not restore:** the Daily
  Job Tracker and Next Best Action pages and sidebar items, the 6:30 pm "close
  your day" nudge, the first clock-in opening the tracker, the tracker
  reminder, the Team tracker, the weekly team pack and Settings → Daily
  tracker, and the client page's Recommended actions card (same engine,
  removed the same day). Their addresses redirect (`/dashboard/next-best-action`
  → Dashboard, `/dashboard/tasks/daily`, `/daily/team`, `/weekly-pack` →
  Tasks). Kept because other things use them: `lib/nba/engine.ts` (the AI
  client brief), `lib/daily-tracker.ts`
  + `/api/daily-tracker` + the `daily_trackers` table (the mobile app's
  Daily screen, until a mobile release drops it).
- **A call is logged in one tap.** Any Call / WhatsApp / SMS / Email launcher
  carrying `contactLogAttrs(subject)` (`lib/activities/contact-log.ts`; or
  `ContactQuickActions logFor=…`, or `announceContact` after a `window.open`)
  makes `ActivityLauncher` (mounted once in the layout) ask "How did it go?".
  One tap posts to `/api/activities`; "No answer" / "Busy" never move
  `last_contact_at`. A NEW contact launcher for a client or lead should carry
  the attributes. "Log a call" in Ctrl/Cmd+K, "+ Add" and the mobile "+" opens
  the drawer with a client / lead picker (`openLogActivity`).

## The practice as a system (2026-10-08)

Built from *The E-Myth Revisited*: help the owner work ON the firm, not just
in it. Sidebar group **Practice**: Practice Systems (owner, branch head,
compliance) and the Operations Manual (the SOP library, open to everyone).
Migration 0245; schema `db/schema/practice.ts`; code `src/lib/practice/`;
pages `/dashboard/practice/*` with `PracticeNav`; access `lib/practice/access.ts`
(`canViewPractice` to see, `canManagePractice` — owner / settings.users — to change).

- **The vocabulary is code** (`catalog.ts`): 12 core processes (each with its
  default owner position, recipes, Automations-rule modules, task / request
  types and one measure), 7 default positions with contracts, the default
  service promise per tier. Per-firm settings live in the tables.
- **Systems map** (`map.ts`, `/dashboard/practice`): each process scored on
  documented (an SOP linked to it, its task / request types or its journey
  stages), owned (a position WITH a holder), measured (`measures.ts` has data)
  and automated (an enabled recipe workflow, or an enabled `workflow_rules`
  rule on one of its modules). "Turn on" publishes a draft recipe workflow via
  `/api/workflows/[id]/publish` — flipping `enabled` alone never fires it.
- **Positions** (`positions.ts`): jobs, not people; seeding suggests holders
  by role and gives each process its default owner. Owner dependency is
  `lib/metrics/owner-dependency.ts` and an Owner Dashboard card.
- **SOPs in the work** (`sop-links.ts`, `/api/sop-links`): an SOP links to a
  process, task type, task template (tasks record `meta.templateId`),
  position, journey stage (`"<subjectType>:<stageKey>"`, e.g. `lead:call_done`)
  or request type. The task drawer's "How we do this" shows only the MOST
  specific SOPs (the task's own links, else its process's — never the
  assignee's position, which belongs in `/dashboard/practice/manual`). The
  lead page shows the script for its stage. SOP markdown renders as React
  elements (`sop-markdown.ts`), never HTML.
- **Starter manual** (`starter-manual.ts`): 30 MFD SOPs + 8 lead-stage call
  scripts, keys `mfd_*`, installed idempotently from the Operations Manual;
  a deleted one is never resurrected. Distributor wording: never "advise".
- **Service promise** (`promise.ts`), **strategic objective** (`strategy.ts`,
  money on a compound path, counts on a straight one; baseline captured on
  first save) and **message tests** (`experiments.ts`: templates grouped by key
  minus a variant suffix `_v2`/`_b`/`_alt`…, two-proportion test at ≥ 30 sends).
  Anything the CRM does not record reads "Not recorded", never 0%.
- **Route gotcha:** import the RBAC check as `import { require as requireCap }`.
  A bare `require(…)` in a route makes Next's bundler treat it as CommonJS and
  every request 500s; `check:rbac` accepts `requireCap(`.

## QA sampling — a check of completed work

Settings → QA sampling and Tasks → QA queue (`/dashboard/tasks/qa`,
2026-10-26, CEO review S7). Code `lib/qa/sampling.ts` (settings, the weekly
pass, the verdict) and `lib/qa/results.ts` (queue, pass rate).

- **Off until the firm switches it on.** Then every week (the task reminder
  scanner, any pass from Monday) a share of each person's tasks completed the
  week BEFORE (Mon–Mon IST; firm-set %, rounded up; chosen types or all) is
  picked — deterministic per week (md5 order), never twice for a person-week.
- **A check is a task** (`qa_review`, meta `qaOf` / `qaDoerId` / `qaWeek`) for
  the person's reporting manager, else their branch head, else an owner —
  never the doer. It escalates under the ladder like any task.
- **The verdict** (`POST /api/qa/reviews/[id]`, the checker or an owner):
  closes the check (meta.qa), stamps the task checked (meta.qaResult); a Fail
  needs a reason and gives the doer a `qa_correction` task. Audited
  `task.qa_reviewed`. Pass rate = passes ÷ checks with a verdict.
- Stored in `dashboard_settings.settings.qaSampling`; the thresholds save and
  reset keep it (`KEPT_KEYS` in that route — add any new key stored there).
- Not built yet: enrolling someone in an SOP's induction lesson after N fails
  on that SOP — it needs the SOP link on tasks (S1).

## Bottlenecks — where work waits

Reports → "Bottlenecks — Where Work Waits" (`/dashboard/reports/bottlenecks`,
2026-10-26, CEO review S10). Loaders `lib/reports/bottlenecks.ts`, maths
`bottlenecks-core.ts` (pure, tested).

- Two journeys keep stage history: Lead → client (`lead_stage_history`, the
  sales SOP and the onboarding) and Opportunities (`blueprint_stage_history`).
  A new journey with history needs its own branch in `loadStays`.
- Per stage: stays that FINISHED in the period give the typical (median) and
  slowest-10% wait; open stays of running cases give "in it now". A stage
  with no transition onward is never "waiting". A won lead whose onboarding
  never started IS waiting (Won Lead has onward steps).
- Person = the case's owner, branch = the lead's / client's branch; what the
  viewer sees is `resolveDataAccess` (firm / branch / team / own), as on the
  dashboards. Tasks: creation → done by type, by assignee.

## Meetings — attendees and action items

`review_meetings` (the Meetings module). Two rules since 2026-10-01:

- **Attendees are looked up**, not typed: team members, clients and leads from
  `GET /api/review-meetings/attendee-search` (client and lead results go
  through `investorScopeSql` / `leadScopeSql`), or a typed guest for someone
  outside the CRM. Each entry in the `attendees` jsonb carries `kind` + `refId`
  (`lib/review-meetings/attendee-kinds.ts`), and that is what shows the meeting
  to the person: a team member gets it in their meetings list (RM filter), the
  list API, their calendar and the RM dashboard's Upcoming 7 days, and may open
  and edit it (`hasUserAttendee`; cancelling stays with the owner). A client or
  lead sees it on their own record. Query with `attendeeIs` /
  `attendeeIsAnyUser` (`lib/review-meetings/attendees.ts`) — never read only
  `rm_id` / `investor_id` / `lead_id` for "my meetings". Older rows have no
  `kind` and read as guests.
- **An action item IS a task.** Each row has an owner (any active team member)
  and a due date, and `syncActionItemTasks` (`lib/review-meetings/sync.ts`)
  creates its task on the first save — not on completion. Editing the row edits
  the still-open task; removing the row cancels it; the row stores the task id,
  which the API returns so a second save never duplicates. Assignees are
  notified (`task.assigned`), and team attendees newly added get
  `meeting.attendee_added`.

The meeting page has no notes box and no Outcome card (removed at the firm's
request), so completing a meeting no longer creates a "write up your notes"
task. The columns and the server's outcome → lead-journey logic are untouched.

## Fixed deposits

Bank / corporate / NBFC / post-office FDs a client placed through the firm —
`fixed_deposits` (migration 0226), one row per receipt. Code:
`src/lib/fixed-deposits/` (terms · schema · form · service · hooks), APIs
`/api/fixed-deposits` and `/api/fixed-deposits/[id]`, pages
`/dashboard/fixed-deposits` (+ `/new`, `/[id]`, `/[id]/edit`), and the
`ClientFdPanel` section on the client page's Portfolio tab.

- **Maturity maths is pure** (`terms.ts`, tested): cumulative ≥ 181 days
  compounds at the deposit's frequency (quarterly for banks), shorter is simple
  interest, a payout FD returns the principal. The receipt's amount, when typed,
  wins (`maturity_amount_entered`) and may not be below the deposit.
- **Every write runs `syncFdAutomations`** (`hooks.ts`) in the same tx: a live
  FD keeps an `fd_maturity` expected inflow (amount + date owned by the FD) whose
  reminder task reaches the RM 15 days before maturity; renewed / closed early /
  cancelled / deleted cancels it. An ACTIVE FD sets Cross-sell `fd_bonds_ncd` to
  held_with_us and wins the client's open FD opportunity (`onProductBooked`);
  any FD on record passes the opportunity's "Executed" step.
- **Renewal** is `/new?renew=<id>`: the new row carries `renewed_from_id` and
  the old one becomes `renewed`.
- **Access follows the client** (`investorScopeSql` / `loadViewableInvestor`);
  writes need `investor.edit.*`. Soft delete (`deleted_at`).

## KYC status from the KRA (NSE MF Invest)

Each firm connects its OWN NSE MF Invest (NMF II) API user at Settings →
Integrations ("NSE MF Invest — KYC status", owner only): Login User ID,
member code, API Secret, API Member License Key, Live / UAT. Stored encrypted
in `tenant_integrations` (provider `nse_mf`); the secrets are write-only.
Code: `src/lib/kyc/` (nse-auth · nse-status · nse-client · credentials ·
refresh), migration 0237.

- **NSE must whitelist the server's IP** against that user (up to 4 per user;
  production's Elastic IP, shown on the card, `NSE_EGRESS_IP` overrides). A 403
  is the keys or the IP. KYC_CHECK answers only in Live.
- **Auth** (`nse-auth.ts`, protocol v1.9.6 pp. 5–6): AES-128 of
  `secret|nonce` keyed by PBKDF2(license key, salt), sent as
  `base64(iv::salt::cipher)`. The PBKDF2 iteration count (1000) and hash
  (SHA-1) are AesUtil's — the spec does not print them; they are the first
  thing to check if a correct key set gets 403 from a whitelisted IP.
- **The remark is the meaning** (`nse-status.ts`): Validated → verified,
  Registered → registered, Under process / Not available → pending, On hold →
  hold, Rejected → rejected, Deactivate / Incomplete / CVL MF KYC →
  re_kyc_required. Service down, a failed call, an unknown remark or an answer
  for another PAN NEVER changes the status — it is recorded in `kyc_checks`
  and nothing else.
- **Every answer is history**: a `kyc_checks` row; a change also writes audit
  `investor.kyc_from_kra` and the event `investor.kyc_status_changed`.
  `investors.kyc_status_remark` / `kyc_checked_at` / `kra_name` show on the
  client page ("KRA check", with Check now for whoever may edit the client).
- **Nightly** `kyc-status-refresh` (02:30 UTC = 08:00 IST): firms with the
  daily refresh on; live clients with a valid PAN, oldest check first, every
  3 days until verified then every 30; 400 a firm a night, one call at a
  time, outside any transaction; a refused login stops the firm's run.

## Website complaint form

Each firm gets one public link, `/complaint/<token>` (`tenants.complaint_form_token`,
migration 0227), to put on its own website: Service Requests → ⋯ → "Complaint
form for your website" (`/dashboard/complaints/website-form`). Code:
`src/lib/complaints/` (`submission.ts` reads the form, `web-form.ts` the rest),
`POST /api/public/complaints/[token]`, and `PATCH /api/complaints/website-form`
(owner / compliance: switch off, or replace the link — the old one dies at once).

- **A ticket starts in ONE place**: `openServiceRequest`
  (`lib/service-requests/open.ts`), shared with the CRM's own form — ticket
  number, SLA clocks (21 days for a complaint), the `complaint.created` event
  and the client acknowledgement. A website complaint is type complaint,
  channel form, source `website`.
- **It goes to the compliance officer, else the owner** — never the client's
  RM by default, since a complaint can be about the RM. The handler gets a
  notification.
- **It is linked to a client only when the email or mobile typed matches
  exactly one live client**, and the acknowledgement goes out only when it was
  the EMAIL that matched, so the form can never make the firm write to a third
  party. PAN and folio are recorded for staff, never used to link.
- **Abuse controls**: 20/hour per IP (wide on purpose — mobile networks share
  addresses), 60/hour per link, and a honeypot field answered with a fake
  success.
- The monthly complaint disclosure page was removed at the firm's request
  (2026-10-01); `/dashboard/complaints/disclosure` redirects to the register.
  Do not restore it.

## Service request form — email never opens a ticket

A client asks for a service through the firm's **service request form**
(`/service-request/<token>`, `tenants.service_form_token`, migration 0238), sent
by link or put on the website: Service Requests → ⋯ → "Service request form for
clients" (`/dashboard/service-requests/website-form`). Code:
`src/lib/service-requests/` (`web-submission.ts` reads the form, `web-form.ts`
the rest), `POST /api/public/service-requests/[token]`, and
`PATCH /api/service-requests/website-form` (`service_request.manage`: switch
off, or replace the link).

- **The service chosen opens a request** (the API still takes up to 6) through
  `openServiceRequest`, so each has its own service ID (`SR-YYYY-NNNNN`), shown
  on the thank-you page. The same client re-sending the same service within a
  day gets the open request's ID back, not a second ticket.
- **Linked to a client only when the email or mobile typed matches exactly one
  live client**; it then goes to that client's RM, else the owner (both
  notified). The acknowledgement is sent only when the EMAIL matched. The form
  asks no PAN or folio. "Other" opens a box for what the client needs. Abuse controls as the
  complaint form: 20/hour per IP, 120/hour per link, honeypot.
- **Incoming email does NOT open a service request** (the firm's decision of
  2026-10-16). It once did, and the firm's own "SIP INSTALLMENT REMINDER" mail
  — whose footer says "bank account" — opened 332 "Bank update" tickets at one
  firm (483 in ten days, 474 escalated). Do not put `imap-poller` → ticket back.
  `scripts/close-auto-email-tickets.ts` (dry run; `--tenant`, `--apply`) closes
  the ones already in a register, never one a person has touched.
  **Service Requests → "Close email requests (N)"** (`lib/service-requests/email-intake.ts`,
  `/api/service-requests/email-intake`, `service_request.manage`) closes every
  open, untouched email-opened ticket in one click, nothing deleted; it shows
  only while some exist. `tests/email-never-opens-request.test.ts` pins that the
  mailbox poller touches no ticket code and that `createServiceRequest` (the
  WhatsApp intake's) cannot be given the email channel.

## Creating a family

The New family form (`/dashboard/families/new`, `NewFamilyForm`) asks for the
head, the name and notes — nothing else (the firm's request, 2026-10-02).
`?investorId=` starts it with that client as head.

- **The name comes from the head.** `familyNameForHead`
  (`lib/families/naming.ts`) applies the firm's pattern (Family settings,
  "{head} Family"), and the API uses the same function, so the form shows what
  is saved. It stays editable for an organisation name.
- **The code is automatic.** `nextFamilyCode` (`lib/families/code.ts`) gives
  the firm's next FAM-#### under an advisory lock; a code typed in another
  shape is ignored.
- **RM, branch, category and review schedule come from the head's client
  record** (`familyDetailsFromHead`, `lib/families/from-head.ts`): the
  client's RM and branch, `segment_tag`, `review_frequency` and next review.
  With no head: the creator, their branch, the firm's default cadence. Every
  create path (this form, Map Family, the unmapped-client and suggestion
  panels) goes through `POST /api/families`, so all of them get this.
- **The family's RM is the head's RM, and members follow it by default**
  (`lib/families/head-rm.ts`, the firm's rule of 2026-10-09). Mapping a
  client into a family gives them the head's RM; making someone head gives
  every member the new head's RM; merging families gives the moved members the
  survivor head's RM; a client created straight into a family gets the head's
  RM unless an RM was chosen (an own-book-only creator keeps their own). It is
  a default, not a lock — a member's RM can be changed on their record. Only
  `rm_id` moves (as the client page and bulk Assign RM do), and each change is
  audited as `investor.rm_from_family_head`.
  A family has ONE RM (2026-10-22): changing the RM of ANY member — head or not — on
  the client's record or by bulk Assign RM gives the head and every member the same RM,
  and the family (`setFamilyRmFromClient`, reason `family_rm_changed`; clearing an RM
  does not propagate). Editing the **Family RM** in the family's Details tab
  (`PATCH /api/families/[id]`) does the same through `setFamilyRm`. The head's RM also reaches the family when a client reaches the
  **Family Mapping** step of the onboarding journey (`blueprints/engine.ts`,
  reason `family_mapping_stage`: a head's whole family, or a member alone).
- **Family mapping has its own permissions** (2026-10-19, "Family Mapping" group
  in Customize Access Permissions): `family.map.view` / `.create` / `.edit` /
  `.delete` — see families, add a client to a family, change a member's
  relationship or head, remove a client. Each is accepted ALONGSIDE the older
  household caps (`family.edit` …, `lib/families/access.ts` `MAP_CAPS`), so a
  customised user who could map before still can. Deleting a whole household
  stays `family.delete`.
  **Assigned only** (2026-10-21): `family.map.view_assigned` ("View assigned families only")
  and `family.map.edit_assigned` ("Edit assigned families only") limit a person to the
  households they are the RM of (`families.rm_id`, which follows the head's RM) — the way to
  give ~10 named people access without opening the whole book. They are opt-in (no role has
  them): tick them INSTEAD of "View family mapping" / the three mapping permissions. When
  ticked without their all-families twin they win over the older household and client caps
  (`viewsAssignedFamiliesOnly`, `mapScope`, `canMapFamily` in `families/access.ts`); the
  family list and every route go through `familyScopeSql` / `assertFamilyEditable`, so a
  household that is not theirs is not found. Starting a new household stays `family.map.create`.
- **Members take the head's address and the family's review frequency** the
  same way (`lib/families/shared-details.ts`, 2026-10-13; see "Client types").
- Do not put Category, Relationship Manager, Review frequency or First
  meeting date back on the create form.

## Client types — the client master follows the type

`investors.investor_category` is the CLIENT TYPE, and the client master asks
for what that type of investor needs (`src/lib/investors/client-types.ts`,
the firm's request of 2026-10-12; extra details in `investors.type_details`,
migration 0233). One list — keys, labels, rules — for the forms, the APIs,
the imports and every label; never copy the enum again.

| Type | Adds | Holding | Nomination |
|---|---|---|---|
| Individual · NRI · Sole proprietor · Other | personal details; NRI: country, overseas address, tax residency, foreign TIN, NRE/NRO; proprietor: business name | single / joint | **yes**, or a recorded opt-out |
| Minor | guardian (name, PAN, relation, DOB, contact); turns-18 date; DOB required, must be under 18 | single | **no** |
| HUF | Karta (name, PAN, DOB, contact), date formed, coparceners | single | **no** |
| Company · LLP · Partnership · Trust · Society/AOP/BOI (+ legacy Corporate) | date and number of incorporation / registration, nature of business, net worth, FATCA/CRS class (+GIIN), authorised signatories, beneficial owners | single | **no** |

- **Only individuals nominate** (SEBI; the firm's rule). Both APIs ignore a
  nominee list for any other type — and never delete nominees already on
  file. A type that cannot hold jointly is saved as Single; Minor sets
  `is_minor`.
- `cleanTypeDetails(type, details)` keeps only what the type uses, so a
  record switched from HUF to Individual sheds its Karta.
- An HUF's or entity's formation date lives in `type_details.entity.formedOn`,
  not `dob` — a company has no birthday.
- Registrar tax-status text becomes a type through
  `clientTypeFromTaxStatus` (CAMS, KFintech, Excel import): "Partnership
  Firm", "LLP", "Sole Proprietorship", "Society" are their own types now, not
  "company". The client book's "corporate" bucket counts company, corporate,
  LLP, partnership and society/AOP.
- `/dashboard/investors/new?type=minor` opens Add client ready for a type.
- **A minor's risk profile IS the guardian's** (2026-10-13, migration 0234).
  The minor links the guardian's client record
  (`investors.guardian_investor_id`: picked in the Guardian section, else
  found by the guardian PAN typed), and two triggers keep the category, score,
  signed date and provisional flag equal to the guardian's — on any write path.
  The forms show it read-only for a minor and never send `riskProfile`.
- **Dropdowns, not free text** (lists in client-types.ts): tax status by type
  (`taxStatusOptions`, defaulted on a type change), marital status, income
  range, household type (Individual · Family · Company · HUF). `withCurrent`
  keeps an imported value the list lacks.
- **Pincode → city / state only in RTA imports** (2026-10-14, the firm's
  call after a day of form auto-fill that overwrote typed cities with India
  Post districts): the forms never fill from the pincode. `importRtaFolios`
  completes a registrar row that has a pincode and a BLANK (or "NA" / "-")
  city or state (`lib/pincode/fill.ts`, India Post via `lookupPincode`);
  nothing written is ever replaced. Do not put form auto-fill back.
- **Each type sees only its own fields** (2026-10-14), on the client page as
  in the forms: personal fields for a person or minor, adult fields
  (marital status, occupation, employer, PAN–Aadhaar link, anniversary) for
  an individual, the type's own card (Guardian · Karta & coparceners ·
  Entity + signatories / owners · Overseas details · Business), and the
  Nomination section only where `canNominate`. Every "missing" count —
  health score, completeness, compliance gaps, data-quality cards, list
  `gaps=` filters, quick filters, family filters, data hygiene, the
  assistant — goes through `lib/investors/type-rules.ts` (`needsNomineeSql`,
  `missingDobSql`, `panAadhaarGapSql`, `missingAdultTextSql`); never write
  `nominee_name IS NULL` or `dob IS NULL` as a gap again.
- **Removed from the client master at the firm's request (2026-10-13)**: CKYC
  expiry and FATCA expiry (neither expires) and Service tier (the review
  frequency says the same). The columns stay; do not put the fields back.
- **What the family owns is not asked again** (`lib/families/shared-details.ts`):
  a member's address is the head's, and every member's review frequency is the
  family's. Applied with the head's RM (mapping, head change, merge) and when
  the head's address or the family's cadence changes; audited as
  `investor.details_from_family`. The investor PATCH ignores a member's
  address (head has one) and review frequency (family has one); the forms show
  both as "from the family".

## Financial Health Check — filled from the CRM

Picking an existing client on a NEW health check (`/dashboard/financial-plans/new`,
not an edit, not "start from a fact-find") fills it from what the firm already
holds (2026-10-17): `GET /api/financial-plans/prefill?investorId=`
(`financial_plan.view` + `loadViewableInvestor`) over
`lib/financial-plans/from-crm.ts`.

- Profiling: age from DOB; spouse's age and children from the family when the
  client is its head or the head's spouse; the risk profile.
- Assets: mutual funds summed by class — AMFI category (`withSchemeCategories`)
  read with `classifyScheme`, gold by name, hybrid as "other" — and live FDs
  as debt.
- Protection: in-force life (term, endowment, money-back, ULIP, other life) and
  health (health, critical illness, group health) sum assured + annual premium.
- Goals: live goals with the Goals module's current value and existing SIP; a
  goal kept in future rupees comes at 0% inflation (as the fact-find import).
- Only blanks are filled; a second pick swaps what the first one filled; what
  the RM typed stays. Income, expenses and loans are not CRM records.

## A client who leaves — Exited, not deleted

The firm's question of 2026-10-15: a client with no AUM or no business today
may come back, so deleting them (Trash, erased after 30 days) means typing
everything in again. Instead:

- **Mark as exited** (client page → More, or bulk "Update a field" →
  Status): the record keeps its history, family, RM, notes and documents,
  leaves the client list (`live=1`, the list's default — "N exited clients are
  hidden — show", `?exited=1`; a name search or a status filter still finds
  them) and every dashboard count (`aliveClient`). The Delete confirmation
  says so.
- **Coming back is automatic**: after every RTA import a dormant / closed /
  exited client with an inflow transaction (purchase, SIP instalment) in the
  last 45 days dated on or after the day they left is Active again, audited
  `investor.reactivated`, and their RM is told "… is back"
  (`lib/investors/client-return.ts`). Redemptions never count.
- **Dates**: a trigger (migration 0235) writes `exited_at` when a status
  becomes closed / exited and `dormant_since` for dormant, on every write
  path, and clears them when the client returns.
- **Adding the same PAN again** never makes a second client:
  `POST /api/investors` answers 409 with `existing` (`existingClientForPan`,
  merges followed; a client outside the viewer's book has no name), and Add
  client offers Reactivate (exited), Restore (in the Trash) or Open.

## Booked business vs the RTA

Operations does the work the day an RM asks and books it as a **business
entry**; the registrar's feed (CAMS / KFintech) reports what really happened
three or four days later. The two are linked, never added together:

- **Targets count BOOKED business** (business entries). **Incentives count
  what the RTA processed** (the transaction ledger, `lib/metrics/business.ts`),
  plus Operations-confirmed entries for products the RTA never reports (PMS,
  AIF, SIF, bonds …). Both are the firm's decision of 2026-10-02. Since
  2026-10-07 every dashboard's business figure is booked too (see "The
  dashboards").
- **Every mutual-fund line of a counted entry** (`confirmed` / `emailed`)
  carries its RTA outcome (`business_entry_lines.rta_*`, migration 0228):
  pending · confirmed · mismatch · rejected · not_found · not_applicable.
  `lib/business/rta-match.ts` decides it after every RTA import (the import
  worker) and nightly (`daily-ops-scanner`); the rules are pure and tested in
  `rta-match-core.ts`. A transaction settles at most one line
  (`business_entry_rta_matches`); a processed record beats a rejected one (a
  failed payment retried is still business); the scheme is compared by name
  (`schemeMatches`), never by code.
- **Not found is never "no data"**: a line is not_found only once the firm's
  wait (`rtaNotFoundDays` 7, `rtaSipNotFoundDays` 45 — a first SIP debit can be
  a month away) is over AND the imported ledger reaches past it.
- **A rejected line and targets** (`bookedRejectionMode`, Settings → Dashboard
  thresholds): `reverse` (default) keeps it on its booking date and subtracts
  it on the rejection date, so a past day never changes; `drop` removes it from
  the booking date. `lib/metrics/entries.ts` runs every figure over signed lines
  (`sign`, `eff_date`) to do this — a new entries figure must too.
- **SIPs count when booked.** The CRM's own SIP book is not RTA proof (it is
  written from entries): a SIP is confirmed by its first processed instalment
  and rejected by a rejected or bounced first debit of the same amount. A SIP
  top-up has no RTA record of its own and is not checked.
- RTA business that nobody booked counts for the client's RM.
- Business Entries shows each entry's outcome and filters by it (`?rta=`);
  backfill or re-run by hand with `tsx scripts/match-business-rta.ts`.

## RTA imports — which client a registrar row belongs to

`src/lib/rta/client-match.ts` (2026-10-08). Both import engines (`import.ts`
for masters and holdings, `process.ts` for feeds) find clients through it.
Never look a client up with a bare `WHERE pan = …`: that made a second client
for someone the firm already had (Ahpal Financial Services, whose client list
was loaded from Excel without PANs, got a registrar twin for nearly every
client).

- **A PAN resolves to its live client.** Merges are followed to the survivor,
  and an Excel-loaded row (`dedup_pan = false`) counts. That client takes the
  PAN slot (`dedup_pan` true on it, false on retired or duplicate rows), so the
  `ON CONFLICT … WHERE dedup_pan` upsert updates it from then on.
- **A PAN nobody holds may adopt a PAN-less client the firm entered**, on an
  unambiguous name only (`nameMatchKey`: any word order, honorifics dropped, at
  least two words). It needs exactly one such client, one person of that name
  in the file, no PAN client already called that, no conflicting date of
  birth, and minor matches minor.
- **History follows the folio.** When an import moves a folio to another
  client, its transactions and SIPs move too (`former-owners.ts`). An emptied
  placeholder, or a twin with the same PAN, is merged into the client that took
  the folio.
- **Duplicates already in a book**: `tsx scripts/repair-rta-duplicates.ts
  --tenant <id>` (dry run; `--apply`, `--placeholders`). It is heavy on a large
  book, so run it out of hours.
- **An empty PAN-less placeholder goes to the Trash on its own**
  (`lib/rta/placeholder-sweep.ts`, 2026-10-14): after every RTA import and in
  the nightly ops scan, a `NOPAN:` client older than an hour that holds
  nothing, that no row refers to (every `investor_id` / `subject_id` /
  `entity_id`-style column, found from the schema) and that no person ever
  edited is trashed (restorable) and loses its key. Nimesh C Shah had 130 —
  the AUM statement's spelling of clients the folio master had already
  adopted. A placeholder that holds anything stays: Merge Clients suggests
  its PAN twin under "Similar name, one without PAN" (`similarNames` in
  `lib/investors/duplicate-clusters.ts`: spaces moved, one letter off, an
  initial for a word — never a different first name), and a person merges.
- **A client who holds money with the registrar is never in the Trash**
  (`lib/investors/holds-money.ts`, 2026-10-14): a folio with a value or an
  active SIP. Delete (one or bulk) keeps them and says why — merge a
  duplicate, mark a leaver Closed / Exited; every purge (by hand, Empty Trash,
  the 30-day retention purge) skips them; after each RTA import and nightly,
  one found in the Trash is restored (audit `investor.restore`, reason
  `holds_money_with_registrar`). Nimesh's "Thakor Rushin Jitendrabhai"
  (₹28.33 L) had been bulk-deleted with his PAN-less twin.

### How a registrar transaction is stored (the 29 Oct 2026 audit)

`lib/rta/process.ts` `processTransactionFeed` + `lib/integrations/cams-feed-parser.ts`:

- **The key is the registrar's number, checked against the folio.** CAMS numbers
  transactions per AMC, so the bare number collided across AMCs and rewrote the
  first transaction (6,508 rows found pointing at another folio). The upsert now
  updates only a row of the SAME folio; a number already used by another folio
  is stored as `<number>@<folio>`. A file with no number column keys rows on
  their content (`<src>:nk:<hash>#n`), never their line number.
- **A reversal is not new money.** A purchase / SIP / reinvest row with negative
  units or amount (or the word "reversal") is stored `cancelled` with
  `reason_code` `REVERSAL`, and cancels the transaction it reverses (same folio,
  scheme, units, amount, ≤120 days before; `reason_code` `REVERSED`, kept on
  re-import). A switch / STP leg with negative units is the OUT leg (direction),
  not a reversal.
- **Folio numbers are unique only within an AMC** — `pickFolioOwner` /
  `pickFolioForScheme`: one client behind the number → it; several → the AMC
  (or, for CAMS product codes, the AMC letter) decides; still unclear → the row
  is held back with a reason, never guessed.
- **A minor's folio stays the minor's** even when the row carries the
  guardian's PAN (`chooseClient`), and a "X REP BY Y" row never stands up a
  client keyed on the guardian's PAN.
- Every transaction records its file (`rta_import_id`, migration 0252) and the
  registrar's own type / amount / units text (`raw_feed_row`).
- **Nothing is dropped quietly:** every data file in a ZIP is imported (the
  extras become their own import rows); a file with data lines but no readable
  row is `failed`, not "empty"; partial / failed files are re-run after each
  master import and nightly (`runRerunJob`; snapshots only when no newer file
  exists, ≤3 times, ≤20 MB); the password rescan includes password `failed`
  rows, newest first; a mail whose attachment could not be stored is held and
  retried, never deleted. The whole-firm passes after an import run only when
  it landed rows.

## The public website and SEO

The marketing site is `/` (`src/app/page.tsx`), `/solutions` + `/solutions/[slug]`
(one page per search phrase MFDs use — content in `src/lib/landing/solutions.ts`),
`/blog` + `/blog/[slug]` (`src/lib/landing/blog.ts`), the homepage FAQ
(`src/lib/landing/faqs.ts`) and KAIZEN (`/knowledge-base`). Header, footer and
contact details are shared (`components/landing/SiteChrome.tsx`,
`lib/landing/links.ts` `CONTACT`); structured data comes from
`lib/landing/jsonld.ts`, so every page describes the company the same way.

- **A new public page needs a middleware entry** (`PUBLIC_PATHS` /
  `PUBLIC_PATH_PREFIXES`), or crawlers and visitors are sent to `/login` — the
  generated `/opengraph-image` was, which broke every link preview.
- Add new solution pages / articles to their data file; the sitemap
  (`src/app/sitemap.ts`) picks them up. Keep every claim true of the product.
- Self-serve sign-up is closed: CTAs book a demo (`DEMO_URL`), never `/signup`.
- The site palette is fixed (`site-*` colours in `tailwind.config.ts`, the logo's
  crimson and teal) and must not follow a tenant's `--primary`. Headings are
  `font-brand` (Plus Jakarta Sans, `lib/landing/font.ts`; weight in globals.css),
  body text Inter.
- The Vartify WhatsApp chat button (`components/landing/WhatsAppWidget.tsx`)
  loads on the website pages only, never inside the CRM.

## Required WhatsApp templates — made and sent to Meta on connect

When a firm saves its Vartify key (Settings → Integrations, owner), the CRM
creates the **required template set** and sends every one to Meta for approval
(2026-10-26). Catalogue `lib/templates/whatsapp-catalogue.ts` (pure data:
UTILITY — SIP registered / rejected / debit reminder, mandate expiry, KYC,
risk-profile link, meetings, documents, service request, premium; MARKETING —
birthday, festival, start-a-SIP, review, tax-saving, insurance check, referral,
check-in, investor session). Provisioning `lib/templates/whatsapp-provision.ts`.

- **Creation is idempotent per firm**: key `wa_*`, (tenant, key, whatsapp,
  en-IN); a submission is *claimed* with one UPDATE (`external_status`
  SUBMITTING) so the connect call, the button and the worker can never send the
  same template twice; a name Vartify already has counts as sent.
- **Where it runs**: the connect POST fires it after the response
  (`POST /api/settings/integrations/vartify`); `…/vartify/templates` GET lists
  each template's state, POST (owner) creates what is missing and re-sends
  what failed. The 15-minute `vartify-template-sync` worker only RE-SENDS
  existing drafts that failed (after 6 h) — it never creates, so an archived
  template is not brought back.
- **Status is the existing one**: `templates.status` draft → pending_approval →
  approved | rejected; the version's `external_status` PENDING / FAILED and
  `rejection_reason` (Meta's, or the send error). The worker now also writes
  Meta's verdict onto the version (`approved_external` / `rejected`).
- **Rules every body follows** (pinned by `tests/whatsapp-catalogue.test.ts`,
  which also runs the compliance gate): no variable first, last or touching
  another; variables declared in order of first use (a send fills Meta's
  positional {{1}}… from that list); a real `example` for each; marketing
  carries the AMFI market-risk line and "Reply STOP to opt out"; no returns.
- **Variables are the CRM's own merge fields** (`investor.first_name`,
  `investor.rm_name`, `transaction.*`, `link.risk_profile`) plus
  `firm_sign_off` — "Legal name (ARN-123456)" from `lib/comms/firm-sign-off.ts`,
  which the pipeline now also fills as `arn_no` / `arn_name` (the recipes
  referenced them but nothing set them). Anything else (`meeting_date`,
  `document_name`…) is passed by the workflow or the compose form.
- **"Fetch from WhatsApp" keeps our variables**: a version whose body has
  `autoProvisioned` takes Meta's status from an import but keeps its named
  variables (`whatsapp-template-import.ts`).
- To add a template: append to `WHATSAPP_TEMPLATES`; firms get it from the
  panel's "Send the rest to Meta" button (existing firms are not auto-backfilled).

## Knowledge Base — the public help centre

`/knowledge-base` (2026-10-29, migration 0247) is a help centre in the shape of
a Freshdesk solutions site: **Category → Folder → Article**, all public, no
login. The super admin runs it at `/super-admin/kb-articles` (articles) and
`/super-admin/kb-articles/structure` (categories and folders); APIs under
`/api/super-admin/kb-articles` and `/api/super-admin/kb-structure`.

- **Tables** (platform-level, no tenant_id, no RLS): `kb_categories`,
  `kb_folders`, and `kb_articles.folder_id`. The old KAIZEN stories were moved
  into a "KAIZEN › KAIZEN stories" folder by the migration. Deleting a
  category or folder never deletes articles — they become unfiled.
- **Public routes**: `/knowledge-base` (home, search box, category cards),
  `/category/[slug]`, `/folder/[slug]`, `/search?q=`, and the article at
  `/knowledge-base/[slug]`. `category`, `folder` and `search` are static
  segments, so an article slug may not be one of them (`KB_RESERVED_SLUGS`).
  An empty folder or category, and anything unpublished, is not listed; an
  unfiled article is reachable by search or its own link.
- **Screenshots sit where the author puts them.** The article body is the
  Markdown subset in `components/kb/KbMarkdown.tsx`; `![caption](shot:N)` draws
  the article's Nth uploaded screenshot (1-based) via `/api/kb/image/<id>?i=N-1`.
  Uploading in the editor inserts that line at the cursor. A screenshot not
  placed in the text is shown after it. Removing one in the editor renumbers
  the later `shot:` references.
- **New content = rows, not code.** Pages are `revalidate = 60`; saves also call
  `revalidatePath("/knowledge-base", "layout")`.
- **The pages use the new landing theme** (2026-10-29): `app/knowledge-base/layout.tsx` wraps every KB route in
  the landing navbar / footer (`KbNav`, `KbFooter`) with the scoped styles in `kb.css` (`.kb-site`), never the
  old `PublicShell`. The home has two tabs — **Knowledge Base** (default: guide cards with a screenshot
  thumbnail, title and description by category → folder) and **KAIZEN** (`?tab=kaizen`).
- **Shipped guides** (`lib/kb/guides/*.ts`, aggregated in `lib/kb/starter-guides.ts`): one PUBLISHED guide per
  module (63), written from the live screens, each with its screenshots. Screenshots are JPEG files in
  `public/kb/<name>.jpg`, stored on the article as `storageKey: "/kb/<name>.jpg"` (the image route redirects
  a key starting with `/`); admin-uploaded ones still go through `/api/kb/image/<id>`. They ship by migration
  **0248** (generated: `npx tsx scripts/gen-kb-guides-migration.ts > drizzle/migrations/0248_kb_starter_guides.sql`)
  and by "Add module guides" on `/super-admin/kb-articles` (`lib/kb/install-starter.ts`). Neither overwrites a
  guide an admin edited. To add or change a shipped guide: edit its data file, add the JPEG, and — because
  migrations are append-only — ship the change in a NEW migration, or just edit it in the admin.
  `tests/kb-help-centre.test.ts` checks every shot is placed, its file exists and internal links resolve.
- The sidebar ("Articles in this folder", "You may like to read") comes from
  `loadArticleContext` in `lib/kb/help.ts`; the landing header and footer link
  to `/knowledge-base`.

## Webhook handlers

| Provider | Path | Verifies |
|---|---|---|
| AiSensy | `/api/webhooks/aisensy` | HMAC SHA-256 over raw body |
| Resend | `/api/webhooks/resend` | Svix-style signature |

Idempotency: communications updates are keyed by `(external_id, channel)` — same status delivered twice is a no-op. Inbound WhatsApp messages identify the tenant via the receiving phone number (`whatsapp_numbers` table).

**Important:** webhook handlers run in **system context** because they don't have a session. They write `events_outbox` rows that the poller picks up and routes to subscribed workflows.

---

## The dashboards

Rebuilt 2026-09-29 from the dashboard-cleanup brief (D1–D9): **one metrics
module** under every number, and **named dashboards** picked from a Zoho-style
dropdown instead of `?scope=` tabs. The dropdown holds **six role
dashboards** — Owner, Branch Head, Relationship Manager, Operations,
Insurance Team, Claims — and every one of them lives in Dashboard: none is a
report, a module tab or a page of its own (the owner's instruction after the
first cleanup moved them out).

### One definition per number — `src/lib/metrics/`

Every figure on a dashboard card, the sidebar Tasks badge, My Day's counts and
the list page a card drills into comes from `src/lib/metrics` (`index.ts`
lists the functions). If a screen needs a figure that is not there, add it
there — never write the SQL inside a widget. Each function takes a
`MetricScope` (explicit `tenantId`, then the viewer's access, then the
dashboard filters, each only narrowing). Client facts follow
`investors.rm_id` / `branch_id`; staff facts (tasks, leads) follow the person.

- **Live client** = not deleted, not merged, status not closed/exited
  (`aliveClient`). Active = live and `active`/`redemption_risk`.
- **SIP book** = Σ monthly-equivalent active SIPs of live clients
  (`sipMonthlySql`, one factor table for SQL and TS).
  `investors.active_sip_amount` is only a cache, written by
  `refreshActiveSipAmount` — call it after any SIP write.
- **New clients** = `onboarded_at` (India date) in the period, never
  `created_at`; imports never default the onboarding date to today. Targets
  are FY figures, achievement is always FY-to-date (`targets.ts`).
- **Health**: `getClientHealth` scores live AND keeps the stored score equal;
  the Clients list calls `ensureHealthFresh` (once a day per firm).
- **Leads**: the Leads board's seven columns (`LEAD_PIPELINE`, incl. the
  `proposal_sent` SOP stage from migration 0222); conversion = Won ÷ all leads
  counted; a converted or onboarding lead is Won.
- **Money that moved is BOOKED business** (the firm's decision of 2026-10-07):
  gross, redemption, net business and SIP added / stopped / net SIP on every
  dashboard — tiles, targets, trends, month on month, the FY scorecard, team
  and branch tables — come from Business Entries, every product, over signed
  lines (`lib/metrics/entries.ts` "booked business"; the RM / Branch book's
  version is `lib/dashboard/my/booked.ts`). Never read `transactions` for a
  business figure. AUM, the SIP book BALANCE and SIP rejections stay the
  registrar's, as do the Operations Dashboard's feed views and Brokerage.
- **No data is not zero**: a firm that has never confirmed a business entry
  has no booked figure (`getBookedBusiness().hasData`), so the card says "—"
  + Record business, not ₹0.

### Named dashboards — `/dashboard/[dashboardId]`

- `/dashboard` redirects to the viewer's default: their own "Set as my
  default" → a dashboard assigned to them (Settings → Dashboards) → the last
  one they opened → their role's default → the Owner Dashboard
  (`resolveDefaultDashboard`). Old `?scope=` links open the role dashboard
  that replaced each view.
- **Six system dashboards** (`src/lib/dashboards/system/definitions.ts`), one
  `dashboards` row each per firm (`is_system`, `system_key`; migration 0223
  and `ensureSystemDashboards` for new firms) so they can be linked,
  favourited and defaulted. Their content lives in code and they are always
  locked. Two kinds:
  - **widgets** — the Owner Dashboard: 16 cards from the widget library. Clone
    it to vary it.
  - **centre** — the other five: a full role dashboard built from its own
    brief, rendered under the same header by
    `components/dashboards/system/centres.tsx`, which also applies that
    view's access rule and book. A centre has no cards, so it cannot be
    cloned (the clone API refuses it).
  A system row whose key this build does not define is never shown
  (`canView`).
- **Who sees / edits / shares** — `src/lib/dashboards/platform.ts`:
  `canView`, `canEdit` (creator, `dashboards.manage`, or a share while
  unlocked), `canShare`, `canShareOrDelete` (delete), `allowedShares` (a
  branch head shares only inside their branch). Shares: all / user / role
  (+ subordinates) / branch / team (desk).
- **Sharing a role dashboard** (admins, from its ⋯ menu or Manage
  dashboards): its `'all'` row means "everyone in the roles it's for"
  (`visibleTo`, described by `audience`) and is the default; user / role /
  branch / team rows add people, and dropping the `'all'` row limits it to
  them. A person it is shared with opens the centre too — its drawer, search
  and export routes check `mayUseRoleDashboard` (open-system.ts), not just the
  capability. `ensureSystemDashboards` seeds `'all'` only on rows it creates.
- **Seeing a dashboard never widens what it counts**: every card goes through
  `resolveDataAccess` (`lib/dashboards/team.ts` over `system/access.ts`):
  firm / branch / **team** / self. Team = the viewer plus everyone under them
  in `users.reporting_manager_id` (any depth); their RM filter offers exactly
  those people, and the RM Dashboard gets a "Team member" picker
  (`?member=`). Someone nobody reports to sees only their own. In a centre the
  same rule holds: an own-clients viewer on the Branch Head Dashboard gets the
  one-on-one view of themselves (`rmLocked`), a team lead picks among their
  team (`rmAll={false}`), and the Claims Dashboard has a `self` scope (own
  clients' and own claims) for someone without claims access. The header says
  "Showing: …".
- **Widgets**: metadata in `system/catalog.ts` (sizes S/M/L, max 16, which
  filters each honours), implementations in
  `src/components/dashboards/system/widgets/*`, wired in `registry.ts`. To add
  one: a catalog row + a `{ key, render, csv? }` implementation
  (`tests/dashboard-platform.test.ts` checks every key has one). A card with
  no data returns `body: null` and is not rendered, and the half-width card
  it was paired with takes the full row (`system/sizes.ts` `effectiveSizes`).
  `EmbeddedWidgets` places library cards inside a centre (the Operations
  Dashboard's Compliance tab), on the same implementations.
- **Filters** live in the URL (`system/filters.ts`): `period` (+`from`/`to`,
  India dates, compared with the same period last year), `rm` (`me` = the
  viewer), `branch`, and up to three "+ Filter" fields. "Save filter" and a
  card's personal "Filter this card" are stored in `dashboard_user_prefs`. A
  filter a card cannot use shows "Filter not applied". Drill-down links
  (`components/dashboards/system/links.ts`) send params the list pages read
  with the SAME metric definitions, so a card's count is the list's row count.
  A custom range is read the way it was meant (`resolvePeriod`): dates
  picked backwards are swapped, the end stops at today, and a range that has
  not started falls back to the default period.
- **A filter change must show it is working.** It re-renders the dashboard on
  the server and React keeps the old page up meanwhile — seconds on a busy dev
  server, which read as "the filter does nothing". Every control that changes
  a dashboard's URL (the filter bar, the centres' pickers, period menus,
  client filters, chips) navigates with `useDashboardNav().go`
  (`system/DashboardNav.tsx`); while that is pending the body dims, Apply
  says "Applying…" and the header "Updating…". A new filter control must use
  it too. The filter bar's draft re-syncs whenever the page's filter changes
  (Back / Forward), so the bar never disagrees with the cards.
- **One render**: `DashboardGrid` loads every card (own transaction each,
  `runLimit(4)`), then renders once; `loading.tsx` is the one skeleton.
- Pages: `/dashboard/manage` (All · Created by me · Shared with me · Recently
  deleted, 30-day restore), `/dashboard/new`, `/dashboard/[id]/edit`,
  Settings → Dashboards (role and per-user defaults, `dashboard_defaults`).

### The six role dashboards

Every one reads top to bottom the same way: the headline numbers, what needs
action today, the team, then the analysis and the reviews.

| Dashboard | Default for | What it is | Was |
|---|---|---|---|
| **Owner Dashboard** | owner, compliance, marketing | widgets: KPI row (AUM, SIP book, net business, net SIP added, new clients vs target, clients, insurance premium) · needs attention · lead pipeline · team · branches · business trend · money movement · SIP health · AUM mix · client mix · top clients · brokerage · premium book · compliance gaps · expiries · automation | `?scope=firm`, Practice Overview, Reports › Practice health |
| **Branch Head Dashboard** | branch head | `BranchCommandCentre` (19 sections) | `?scope=branch`, Reports › Branch review |
| **Relationship Manager Dashboard** | RM, team member | `MyBusinessDashboard` (40 sections) | `?scope=mine`, Reports › My desk |
| **Operations Dashboard** | ops, back office, service team | `OperationsControlTower` (50 sections; tabs Queue · SLA & escalations · Team load · Rejections · Compliance) | `?scope=ops`, `/dashboard/operations` |
| **Insurance Team Dashboard** | insurance team | `InsuranceCommandCentre` (58 sections) | `?scope=insurance`, Insurance › Overview |
| **Claims Dashboard** | — (insurance team opens it from the dropdown) | `ClaimsControlCentre` (60 sections) | `?scope=claims`, Insurance › Claims desk |

- **Who sees which** is `visibleTo` in definitions.ts: an RM sees only their
  own dashboard, a branch head locked to their branch never sees the Owner
  Dashboard, the owner sees all six. Leads and compliance have no dashboards
  of their own: their cards are on the Owner Dashboard (and compliance on the
  Operations Dashboard's Compliance tab).
- **The old addresses redirect** — Reports › Branch review / My desk /
  Practice health, Insurance › Overview / Claims desk and WORK › Operations
  (`/dashboard/operations`) — through `openSystemDashboard`
  (`lib/dashboards/open-system.ts`), keeping their query string. A viewer who
  may not see that dashboard lands on their own default.
- **A centre builds every link to itself from `basePath`** (`/dashboard/<id>`),
  never a literal path, and reads its own URL params — including the old
  period keys (`mtd`, `fytd`, `pfrom`…), which `/dashboard` passes through
  untouched to a centre and translates only for a widget dashboard.
- **The Owner Dashboard's practice cards** are `lib/metrics/practice.ts`:
  `getStockHistory` (month-end AUM and SIP book as recorded — never
  recomputed), `getSipHealth`, `getAumMix`, `getClientMix`, `getBrokerage`
  (firm-wide only: a brokerage statement is the ARN's) and
  `getAutomationMonth`.

**What "mine" means is defined once** (the Relationship Manager and Branch
Head dashboards), in
[src/lib/dashboard/my/window.ts](src/lib/dashboard/my/window.ts). Everything
hangs off one spine — clients whose `investors.rm_id` is me — and business,
transactions, SIPs, queries and insurance are scoped THROUGH that spine, not
by who keyed the record. Three things are scoped to the user instead, because
they are their work rather than their book: `leads.owner_id`,
`tasks.assignee_id`, `proposals.prepared_by_user_id`. Insurance is scoped both
ways on purpose — premium booked is `sold_by_user_id`, the relationship view is
my clients' policies whoever sold them.

Loaders live in `src/lib/dashboard/my/` (window · kpis · clients · pipeline ·
desk); components in `src/components/dashboards/my/` and, for the RM desk's
action sections, `src/components/dashboards/desk/`. The spine's "live" is
lib/metrics' (not closed, not exited); **new clients** count client RECORDS
by onboarding date (`clientRecordsWhereOn` + `onboardedInSql`), the same
definition as the Owner Dashboard, so the three dashboards agree. Each band on the page is
its own `<Suspense>` so My Day paints without waiting for the forty-odd
aggregates below it — and every band's transaction goes through
`runLimit(4)` (`lib/dashboard/run-limit.ts`): unbounded, one render held ~17
of the pool's 20 connections and a few RMs opening their desk together starved
the rest of the process.

**A task reaches a client through TWO links**, and many rows fill only one:
`related_investor_id` (task form, meeting follow-ups, SIP defence) or
`subject_type = 'investor'` + `subject_id` (SIP rejections, onboarding,
documents). Never read one column alone — use `taskInvestor(alias)`,
`taskLead(alias)` or `taskIsAbout(alias, investorSql)` from `window.ts`.
Reading only `related_investor_id` detached every rejection follow-up from its
client and made redemptions look unfollowed.

### Four rules the personal cockpit encodes

- **Stock vs flow.** AUM and the SIP book are BALANCES; their month-on-month
  change is mostly the market. Everything else is money that moved in the
  period. A balance tile says "Balance today" under its name, and the row names
  the period the rest cover, because "My AUM +6.9%" read as sales is the
  classic error. (The tiles used to print "stock" / "flow"; nobody outside
  finance reads those words that way.)
- **Quiet by default.** A section's purpose and caveats sit behind the ⓘ beside
  its title (`InfoTip` in `my/Shared.tsx`), not in paragraphs on the page. A
  zero is grey, an empty comparison line is not drawn, and every cockpit's
  filters fold behind one "Filters" button (`FilterDisclosure`) with what is
  applied still shown as chips. Keep new sections to that: a title, the
  numbers, and an ⓘ if it needs explaining.
- **A null is not a zero.** `Figure` renders an em dash with a reason on hover
  and refuses to print ₹0 for an absent value. "No target set" is not 0%; "no
  ledger imported" is not ₹0 of business.
- **A blank field is a record gap, not a fact about the client.** The insurance
  matrix says "No CRM record", never "needs cover"; risk category is never
  inferred from age or holdings. This is the brief's instruction and the only
  defensible reading — turning empty columns into sales prompts is how a
  relationship tool becomes a mis-selling engine.
- **Severity budget.** Red for overdue and consequential, amber for
  approaching, neutral for everything else including every empty card. An empty
  card is never green: "0 SIP rejections" is not an achievement.

### The dashboard canvas (how the six dashboards look)

`/dashboard/[dashboardId]` wraps every dashboard in `.dash-canvas`; the block
of that name at the end of `globals.css` holds the dashboards' visual layer, so
the rest of the CRM keeps its flat look. Three things it encodes:

- **A card lifts, a tile inside a card does not.** `.card-surface` gets a soft
  shadow under `.dash-canvas`. A figure INSIDE a card is a soft fill —
  `dash-tile`, or `bg-secondary/70` with no border — never a second hairline
  box. Only a card that needs action carries a border, with a tint of its
  severity (`border-destructive/30 bg-destructive/5`, `border-warning/50
  bg-warning/5`).
- **One headline tile anatomy**: label, icon chip in the metric's hue
  (`dash-kpi-chip` + `--c`), the figure, then the facts under a hairline. The
  Owner row is `KpiTile` (business.tsx), RM and Branch `MyKpiStrip`, Insurance
  and Claims their own `Kpi`. A short last row shares the width — never one
  tile alone.
- **Lists of counts** are `dash-row` + `dash-count` (`dash-count-alarm` for
  overdue work only); share-of-whole bars are `dash-bar`; a change against the
  comparison period is a `dash-delta` pill; a person or client in a list gets
  `<Initials>` (Shared.tsx) beside the name where the column has room.
- **A row of tiles is `StatGrid`** (or `dash-stats` with `--cols-sm` /
  `--cols-lg`): flex, not grid, so a short last row shares the width and
  `balancedColumns` picks how many sit across — five asked to fit four take one
  row of five, seven in three go four then three. Never a bare `grid-cols-*`
  for a tile row.
- **One segmented control**: any "this view or that" switch (Today ·
  Tomorrow, MTD · QTD · FYTD, Weekly · Monthly) is a `dash-seg` track whose
  items carry `aria-current` / `aria-pressed`; the chosen one is the raised
  white pill. Filter CHIPS (a category, a threshold) stay tinted chips.
- **An empty list is `dash-empty`**: a soft panel and one sentence, never a
  dashed box.
- **Size to the content, not the screen.** From `lg` the sidebar takes ~250px,
  so a 1024px screen leaves a dashboard ~770px. What goes wide — the dashboard
  header (title beside the filters), the RM/Branch KPI strip (two tiles to a
  row below `xl`) — switches at `xl`, not `lg`. On a phone a card has ~300px:
  fixed-width columns must add up to less (the lead funnel narrows its columns
  below `sm`), a `dash-seg` scrolls inside its card instead of pushing the page
  sideways, and a `Section`'s action slot wraps. A tappable chip is 24px tall
  under `.dash-canvas`. Audited at 375 / 768 / 1024px on 2026-10-01: no page
  scrolls sideways at any of them.
- **A dashboard table shows every row its loader returned.** `.dash-canvas`
  removes `.table-scroll`'s 30rem cap (it cut rows off the worklist and every
  month-on-month table with no scrollbar to say so); a table that wants a cap
  sets `--table-scroll-h` and gets a visible scrollbar.
- **Charts are Recharts on `chart-palette.ts`**, including the RM/Branch trend
  and the investment flow — a hand-drawn SVG in a fixed viewBox scales its
  labels with the card width.
- **The chart set** (2026-10-29, the firm's request for distinctive charts)
  lives in `components/dashboards/charts/`, data in `lib/metrics/book-shape.ts`:
  - Owner: AUM bridge (opening → net money in, registrar-processed → market
    move → now) in Business trend; SIP book bridge (booked added / stopped /
    other) and "still running today, by start month" in SIP health; asset-class
    › AMFI-category treemap in AUM mix; concentration curve in Top clients;
    age bands in Client mix; source → outcome Sankey in Lead sources; RM
    this-period-vs-last-year dumbbell under the Team table; sparkline on Net
    business and an "expected by today" tick on the new-clients target bar;
    and the **Where clients are** card (`client_map`): India shaded by state,
    a dot per city (`lib/geo/india-map.ts` + `india-places.ts`; CC BY 4.0
    outline, pre-2019 so Ladakh draws inside J&K).
  - RM / Branch: a sparkline and a target bar with the pace tick on every KPI
    tile (`kpiSparks`, one shared `loadMyTrend`); Branch: RM growth dumbbell.
  - Operations › Rejections: the "Why SIPs bounced" fishbone
    (`lib/dashboard/ops/rejection-causes.ts`) and the SIP debit calendar.
  - Insurance Team › Renewals: the 90-day renewal bubble timeline.
  Each hides itself when its data is thin. SIP survival is "still active
  today" because the registrar's stop date is not stored — do not draw a
  month-by-month survival curve until it is.
- The centres' sticky toolbar is `dash-toolbar` (frosted); the RM jump links
  are `dash-nav`; the page opens on a soft brand wash painted as the content
  pane's background (`.dashboard-content:has(.dash-canvas)`) — never as a
  layer that needs a stacking context on the canvas, which would put the
  inline `fixed z-50` drawers under the shell's top bar.

The `dash-*` rules sit AFTER Tailwind's utilities, so a utility cannot
override a property they set — a quiet state needs its own modifier
(`dash-kpi-value-empty`, `dash-count-zero`).

### Branch Head Dashboard (was `?scope=branch`)

The Branch Business Command Centre (`BranchCommandCentre.tsx`) is the
branch head's view — 19 sections, in this order: the KPI strip; SIP
exceptions, tasks and service requests, meetings, reviews and proposals;
targets; new clients and the lead funnel, investment flow, book, insurance and
operations, data quality and risk; month on month and the FY scorecard.

**The firm took ten things off it on 2026-09-30 — do not restore them from the
brief:** the jump links, the quick-action buttons (Schedule meeting / Add
task / More), the attention centre and its header chip, the RM scoreboard and
target matrix, redemption watch, the business trend, SIP performance,
relationship opportunities, RM activity and the weekly / monthly review. Their
branch-only components (`AttentionCentre`, `RmScoreboard`, `RmTargetMatrix`,
`BranchSipPerformance`, `BranchActivity`, `BranchQuickActions`) are no longer
rendered anywhere.

- **The branch lock.** A branch head (`isBranchScoped`: branch head, not owner,
  with a branch) WITHOUT `dashboard.view.all_branches` is locked to
  `session.branchId`: the branch view is their default, `?branch=` is
  ignored, `?rm=` is honoured only for someone in that branch, and the Owner
  Dashboard is not in their dropdown. `dashboard.view.all_branches` (owner
  implicitly; grantable per user) lifts the lock and adds the branch picker.
  A branch head with no branch gets an explanation, never a silent widening to
  the firm. `dashboard.view.branch` gates the view itself. All of it is
  decided in `centres.tsx` (`BranchHead`).
- **Same loaders, branch scope.** Everything shared with the personal cockpit
  runs the `lib/dashboard/my/*` loaders with `{ kind: "branch", branchId,
  rmId? }`. Client facts follow `investors.branch_id`; staff facts follow
  everyone whose `users.branch_id` is the branch (departed people included —
  their history happened here).
- **One RM ledger per request** (`lib/dashboard/branch/rm-ledger.ts`). Every
  "by RM" table is a projection of it, and two synthetic rows ("Served from
  other branches", "No RM assigned") make each column sum to the branch figure
  above it. Staff facts read "—" on those rows, never 0.
- **Judgement thresholds are firm settings**, not code:
  `dashboard_settings` (migration 0219), edited at Settings → Dashboard
  thresholds, read with `loadDashboardThresholds(tx)` — NOT
  `getDashboardThresholds()`, which returns bare defaults. Target phasing is
  one of them: `linear` pro-rates annual targets by days, `none` means a
  month or quarter has no target ("Not phased") and the FY scorecard shows no
  "expected by today". Bands (achieved / near / short) come from
  `lib/dashboard/branch/targets.ts`; there is no overall RM score.
- **Drill-down is branch → RM → client → record.** A KPI tile opens its own
  list, an RM name opens the one-on-one view (`?rm=`), client names open the
  record. List pages read `branch=` (investors, leads, SIP rejections) so a
  count opens onto the same rows — a filter only ever NARROWS; the viewer's
  access scope still applies on top. Build list links with `clientsHref` /
  `leadsHref` from `lib/dashboard/my/window.ts`, never a literal `?mine=1`.
- **Voice.** Shared sections take a `voice` (`components/dashboards/my/voice.ts`)
  for their copy and links, so one component says "My client book" or "Branch
  client book" without knowing which page it is on.

### Relationship Manager Dashboard (was `?scope=mine`)

"My Client & Business Dashboard" (`MyBusinessDashboard.tsx`) — the RM's work
desk, client cockpit and target tracker, built from the 40-section RM brief.
Action before analytics: morning priorities → My Day → Needs my attention →
KPIs → targets → the next 7 days → meetings, reviews, book, leads, SIP, flows,
tasks, queries, insurance, risk and data quality → month on month → FY
performance.

**The firm took seven things off it on 2026-10-01 — do not restore them from
the brief:** today's client worklist table, client contact health, my key
clients, relationships requiring attention, where my relationships came from,
my scorecards (weekly / monthly) and the SIP debit health check. Their
components (`Worklist`, `MyContactGap`, `MyKeyClients`, `MyOpportunities`,
`SourceAnalysis`, `ReviewModePanel`, `SipDebitCheck`) stay in the tree for the
Branch Head Dashboard and anything else that uses them; `loadWorklist` still
feeds the morning brief's "Top actions".

- **An RM lands here** (the RM and team member role default). It only ever
  shows the viewer's own book and work, so it needs no capability of its own:
  a director or branch head who carries clients opens the same desk from the
  dropdown.
- **Owner is locked to "Me".** There is no owner picker. Client filters
  (`cat`, `ctype`, `cnew`, `cstatus`, `city`, `src`, `fam` → `BookScope.filter`)
  narrow CLIENT facts only; the RM's own tasks, leads and meetings are not
  filtered.
- **The worklist is the priority.** `loadWorklist` (desk.ts) merges meetings,
  reviews, lead and client follow-ups, tasks, queries, SIP rejections,
  proposals and renewals into one list sorted overdue → due today → category
  → time. Levels are the brief's critical / attention / normal, each row says
  why, and the morning brief's "Top actions" is simply its head — no score.
- **Nothing from another RM's book.** A task assigned over a colleague's
  client shows the name the task already carries and nothing else — no link,
  AUM, category or contact details ("Not in your book").
- **Phones get cards.** The worklist renders one card per action below `md`
  so call / WhatsApp / complete are one tap away; `order-*` classes give the
  brief's mobile order and `lg:order-none` restores the desktop rows.
- **An `sr-only` label inside a scrolling table needs a positioned cell**
  (`<th className="relative">`). `sr-only` is absolutely positioned; in an
  unpositioned `.table-scroll` it escapes the clip and widened the whole page
  to 1063px on a phone.
- **Client 360 summary** (brief §40): `ClientSummaryStrip` +
  `lib/investors/summary.ts` put family, RM, AUM, SIP, last meeting, next
  review, risk, open work and insurance at the top of the client page, with
  the same missing-data wording as the desk.

### Operations Dashboard (was `?scope=ops`)

`OperationsControlTower.tsx`, built from the 50-section operations brief:
pending work, exceptions and ageing first, analytics last. Loaders in
`src/lib/dashboard/ops/`, components in `src/components/dashboards/ops/`.

- **Who lands here.** Operations, back office and service team roles default
  to it; anyone with `dashboard.view.ops` (owner included) opens it from the
  Dashboard dropdown. It is NOT in the sidebar (the WORK → Operations item was
  removed 2026-10-01 at the user's request); `/dashboard/operations` still
  redirects to it for old links.
  Five tabs (`?tab=queue|sla|team|rejections|compliance`), only the active one
  loads. Compliance is the library's compliance gaps, complaints and expiries
  cards (`EmbeddedWidgets`), through the tower's scope.
- **A request is a task.** The CRM has no transaction-request entity, so
  `opsBase(w)` (`ops/window.ts`) derives it from `tasks`. Ops work
  (`OPS_WORK`) means an operations or back-office department, an ops task
  type, or an assignee with an ops role. `kind` comes from the task type, then
  the back-office particular, then the operations template title, else Other.
  Value is only `meta.boValue`. `pending_with` comes from the assignee's role,
  and SLA from `sla_due_at`. Query as `WITH ops AS (${opsBase(w)}) … WHERE
  ${opsFilter(w)}`. Registers (queries, SIP rejections, the transaction
  feed) scope with `clientScope(w, alias)` / `selfOnly(w)`.
- **Access is `opsAccess(session)`** (`ops/access.ts`). Scope is firm
  (`task.view.all`), branch (`isBranchScoped` without `all_branches`) or
  self. The audit trail is shown only to the owner and compliance. Contact
  details need `investor.view.*`. The drawer API (`/api/ops/items/[id]`) loads
  through `opsBase`, so an out-of-scope id is simply not found. The export
  (`/api/ops/export?kind=`) parses the same params as the page.
- **What the CRM does not record is said, never zeroed.** It has no
  "validated" or "confirmed by the platform" funnel step, no per-document
  status (there is no documents table), and no rework or internal-error
  field. "Rejected" is the RTA/exchange feed's verdict
  (`transactions.status`), not a task state.
- **Thresholds** `opsSlaWarnHours`, `opsEscalateHours`, `opsHighValue`,
  `opsNoUpdateDays` and `opsPlatformPendingDays` live in `dashboard_settings`.
  `loadQueue` derives escalation levels 0–3 from them.
- **URL state.** The shared dashboard filter bar: `period` (+`from`/`to`;
  `parseOpsPeriod` maps it onto the loaders' old keys), `rm` (csv; `me` = work
  assigned to the viewer), `st` (`open` = every unfinished state), and under
  "+ Filter" `branch exec kind prio sla pw cat`. View toggles `vh nu hv review
  eod` and `tab` are kept when a filter is applied. "Save filter" stores under
  this dashboard's prefs.

### Insurance Team Dashboard (was `?scope=insurance`)

`InsuranceCommandCentre.tsx`, built from the 58-section Insurance Head brief:
the business strip; today's priorities, attention, renewals due and pending
issuance; the team and its targets; the pipeline; then lines, product,
retention, lost business, clients, corporate, claims, data quality and the
reviews. Loaders are in `src/lib/dashboard/insurance/`
and components in `src/components/dashboards/insurance/`.

**The firm took thirteen sections off it on 2026-10-01 — do not restore them
from the brief:** renewal cycle, premium bands, year-on-year by product, the
Personal and Commercial Lines product mix, business source, MF and insurance
relationship, the corporate insurance pipeline and industry-wise commercial
business, claim ageing, claim settlement, claims needing attention, and
renewals and claims together. Their panels (`RenewalCyclePanel`, `BandsPanel`,
`YoyPanel`, `InsMix`, `CoveragePanel`, `CorporatePanel`, `ClaimAgeingPanel`,
`SettlementPanel`, `EscalationPanel`, `RenewalClaimPanel`) are no longer
rendered; the attention cards' "claims needing escalation" link now opens the
Claims Dashboard.

- **One vocabulary, in `lib/insurance/book.ts`.** The policy register
  (`/dashboard/insurance`) reads the same file, so a tile's drill-down shows
  the tile's rows. The CRM has no column for any of these:
  - *Line* is derived from `policy_type` on the firm's MIS split (the same as
    the Insurance Production report): motor, home and other general are
    Commercial.
  - *New vs renewal* comes from `details.businessType`.
  - *Booked on* is `COALESCE(risk_cover_start_date, policy_start_date)`.
  - *Issued* means not proposed, in underwriting or cancelled. *In force* is
    active, claim filed or claim settled, because a claim moves a policy off
    `active`.
  - *Business owner* is the seller when they hold a sales role, else the
    client's RM. `sold_by_user_id` defaults to whoever keyed the policy.
  - *Branch* is the client's branch. A policy's `branch_id` is the keyer's
    branch.
- **Renewal history lives only in `audit_log`.** Mark renewed writes the due
  date it cleared (`before.nextPremiumDueDate`), and retention is measured from
  it. Renewal premium is one installment per event, from the policy's second
  year (`SECOND_YEAR` in `window.ts`). Lost business is dated from the audit
  trail too; a lost policy with no audit row counts as "undated", never in a
  period.
- **Access is `insuranceAccess()`.** The view needs `dashboard.view.insurance`
  (insurance_team by default). The firm-wide book needs `insurance.view.all`
  (no role by default; tick it for the Insurance Head) or the register's
  existing manager caps. A branch-locked head sees their branch; anyone else
  sees their own book. The client drawer (`/api/insurance/command-centre/clients/:id`)
  loads through the same scope.
- **Targets** are firm-scope `annual_targets` keys (`insurance_business`,
  `insurance_personal`, `insurance_commercial`, `insurance_new`,
  `insurance_renewal`, `insurance_new_clients`, `insurance_policies`,
  `insurance_corporate_clients`). They are set at Settings → Targets →
  Insurance targets (`settings.dashboard`). A branch reads its branch
  `insurance_business`, and an RM their KRA. Under a line, product or client
  filter a target reads "Not for a filtered view" (`targetsComparable`), never
  a percentage of a target that describes the whole book.
- **Filtered out is not zero.** With the dashboard on one line, the other
  line's card, table, product mix and comparison row are hidden or say
  "Filtered out", and the sections' own Personal / Commercial switches go away
  (`lockedLine`). A new per-line section must do the same, or it prints
  "₹0 → ₹0, No change" for business nobody looked at.
- **Thresholds**: `insHighPremium`, `insIssuanceSlaDays`, `insHighClaim` and a
  now-configurable `claimSlaDays`.
- **Postgres trap:** `${date}::date - ${n}` with an untyped parameter is read
  as date − date, which is an integer. Cast the parameter (`${n}::int`), or
  comparing a date to it fails.

### Claims Dashboard (was `?scope=claims`)

`ClaimsControlCentre.tsx`, built from the 60-section claims brief: the claims
team's live queue — the headline figures; attention, the escalation centre,
the worklist, high-value and stale claims, documents and queries; the owners
and branches carrying them; then lifecycle, ageing, SLA/TAT, settlement,
rejections, lines, insurers, trends and reviews. Logic is in `src/lib/dashboard/claims/`, components in
`src/components/dashboards/claims/`.

**The firm took most of it off on 2026-10-01 — do not restore them from the
brief:** the attention cards and escalation levels, the escalation centre,
pending with, client service, insurer / TPA queries, owner workload and
workload distribution, branch-wise and RM-wise claims, the lifecycle, TAT and
SLA, TAT by claim type and by insurer, cashless and reimbursement, claimed vs
settled, settlement monitoring, grievance and legal, claim type and mode
analysis, data quality, the trend, the daily flow and today's closure, the
weekly / monthly review and the FY scorecard. What stays: the KPI strip and
value summary, the worklist, high-value, stale and no-next-action claims,
documents, the status breakdown, ageing, rejected claims, the two line panels
and insurers. The removed sections' components and analysis functions are no
longer rendered anywhere (the claim drawer and filters still use the shared
vocabulary).

- **One read, then pure functions.** `loadClaimSet` (`set.ts`) loads every
  claim the page can say anything about — open now, or intimated / closed
  since the earliest date any section looks back to — with its status
  history, next action and last client contact attached, and derives each
  claim's state for today (SLA, level, pending with, documents, flags).
  `analysis.ts` and `review.ts` compute every section from that array with no
  further queries; the drawer (`detail.ts`) loads one claim through the same
  set, so it can never disagree with the page.
- **Status history lives only in `audit_log`.** Every claim create / update
  writes the status before and after. "In this status since", query counts,
  stage timestamps and the rejection / withdrawal date all come from there;
  a claim closed with no settlement date and no status change on record is
  dated from its last edit, and says so.
- **What the claim does not record is never a figure.** There is no approval
  step or approved amount, claim number, TPA, hospital, rejection reason,
  legal stage, priority or pending-with field. Pending with is DERIVED from the
  status (`PENDING_WITH` in `lib/insurance/claims-book.ts`); claim mode
  Grievance is the only legal marker and is kept out of TAT; high value stands
  in for priority in the worklist order. Each place such a field would appear
  says "Not recorded".
- **A claim's next action is a task** with `meta.claimId`, created by
  `POST /api/insurance-claims/:id/follow-up` (insurance.write + the task
  rules). Its earliest open one is the next action; an open claim with none is
  an exception. Status, owner and settlement changes go through the claim's
  own `PATCH /api/insurance-claims/:id`.
- **The document checklist follows the product** (`lib/insurance/claim-checklist.ts`,
  shared with the claim page's `ClaimDocuments`). Keys are the stored
  `docType`; the original eight keep their spelling.
- **Access is `claimsAccess()`.** `dashboard.view.claims` (insurance_team by
  default) opens it; claims are firm-wide there, as on the claims register,
  except for a branch-locked head. The drawer and search routes
  (`/api/claims-control/…`) apply the same scope.
- **Thresholds** are firm settings: `claimSlaDays` (SLA),
  `claimSlaWarnDays`, `claimEscalateDays`, `claimDocsDays`, `claimQueryDays`,
  `claimAssessDays`, `claimNoUpdateDays`, `claimClientUpdateDays`, and
  `insHighClaim` for high value. `hv`, `nu` and `cu` presets change one view only.
- **`.table-scroll` caps a table at 30rem and hides its vertical scrollbar.**
  The worklist and every claim list use `overflow-x-auto` instead — the cap
  silently hid claims below the eighth row.

### Per-RM history (`rm_snapshots`, migration 0217)

"My AUM vs last month" is units × NAV a month ago. It cannot be recomputed —
it has to have been recorded, and `firm_snapshots` has no RM dimension. The
nightly `firm-snapshot-recorder` now writes one `rm_snapshots` row per
(tenant, RM, day) alongside the firm row. Until a month of it exists, the tile
says so rather than approximating AUM-then as AUM-now minus net flow, which
would credit the RM with every point the market moved.

### Seeing the authenticated app locally

`NO_AUTH=1` is dead — [src/middleware.ts](src/middleware.ts) explains at length
why it cannot be revived. Use `node scripts/dev-session.mjs`, which mints a
session cookie directly (signs the same JWT, writes the `user_sessions` row the
revocation check requires) with no password anywhere. It refuses to run unless
`NODE_ENV` is not production **and** `DATABASE_URL` points at localhost, and it
can only wake a user that already exists in the local database.

```bash
node scripts/dev-session.mjs            # uses DEMO_USER_ID
```

---

## The UI system

A UI audit on 2026-09-21 found the same defect in many shapes: there was no
component layer, so every screen re-decided what a button, a card, a badge, a
table and an empty state look like. 818 hand-written `btn-*` across 289 files,
179 files hand-rolling `<table>`, 474 distinct empty-state strings. These
primitives are the fix. **Reach for them before writing utility classes.**

| Use | Instead of |
|---|---|
| `<Button>` / `buttonClass()` — `@/components/ui/Button` | `className="btn-primary"` |
| `<Card>` + `<CardHeader>` — `@/components/ui/Card` | a `card-surface` div with an ad-hoc header |
| `<Badge>` — `@/components/ui/Badge` | a hand-tinted `chip` |
| `<Field>` / `<FieldSection>` — `@/components/ui/Field` | a bare `<label>` next to an input |
| `<DataTable>` — `@/components/ui/DataTable` | a hand-rolled `<table>` |
| `<EmptyState>` / `<InlineEmpty>` — `@/components/common/EmptyState` | a bespoke "No … yet." string |
| `<FormActions>` — `@/components/ui/FormActions` | a submit button at the bottom of a long form |
| `confirmDialog()` / `promptDialog()` — `@/components/ui/ConfirmProvider` | `window.confirm` / `window.prompt` |
| `formatMoney` / `formatDate` — `@/lib/format` | a local `toLocaleString` / `toLocaleDateString` (109 sites migrated 2026-09-21; the ~19 left carry a timeZone or ISO intent) |

Three rules the primitives encode, worth knowing even when you don't use them:

- **One primary action per screen.** `variant="primary"` is the thing the user
  came to do. Everything else is `secondary` or `ghost`.
- **Colour is a signal, not decoration.** `tone="neutral"` for taxonomy (channel,
  source, category); the coloured tones only for status. A lead card that paints
  its source green is spending the same ink as an overdue warning.
- **A column nothing fills is width spent on nothing.** `hideWhenEmpty` on a
  `DataTable` column drops it when no row in the current result set has a value.
  The Clients and Templates tables do this by hand for the same reason.

### Type scale

`tailwind.config.ts` re-points the scale: `2xs` 12px · `xs` 13px · `sm` 14px ·
`base` 16px. Before that, `2xs` was 11px and `xs` was Tailwind's 12px, which put
~60% of the visible text on a content screen at or below 12px. **Do not
introduce arbitrary sizes** (`text-[11px]`): they fail silently in this repo
(see the memory note on arbitrary Tailwind values) and they reopen the floor.

### Colour tokens

`--primary` is the one value a theme sets. `--brand-navy`, `--brand-cyan`,
`--nav-active-bg` and `--ring` are `var()` ALIASES of it — they had all drifted
to the same literal, so five names described one colour and a tenant override
had to set all five. **Never give an alias its own literal value**; if a surface
needs a different colour it needs a new semantic token.

`--metric-*` (ink, dark enough for text on a white tile) and `--chart-*` (fill,
lighter, for SVG geometry) are deliberately two palettes and are not
interchangeable. For Recharts the source of truth is the resolved hex in
`src/lib/dashboard/chart-palette.ts`.

### Tables

Every `<table>` under `.dashboard-content` gets the modern header, row hover
and hairline dividers by default (globals.css, "Every table in the app shell").
A table that must own its look — a calendar grid, a print sheet, a pivot —
opts out with `className="table-raw"` on the `<table>`. Author classes on
`<th>`/`<tr>` still win. This is what made 180 hand-rolled tables consistent
without migrating them; `<DataTable>` is still the right choice for NEW lists
because it also hides empty columns and renders the standard empty state.

### Hit targets

Nothing interactive under 24px. `.btn-icon` is 32px; native checkboxes and
radios have a 16px floor in CSS; the sidebar pin and task-complete controls
were raised to 24/28px. When adding a row action, use `btn-icon`, not
`p-1` + an icon — that is how 24px buttons crept in.

### Radius

Bare `rounded` is on the token too (`--radius − 4px`). Five radii on one
screen came from it being Tailwind's raw 4px; now every corner derives from
`--radius`.

### Ratchets

`npm run check:labels` and `npm run check:colors` are baseline ratchets: CI
fails only if the count GROWS. Lower the baseline when you migrate a file;
never raise it.

---

## Conventions

- **Tenant id everywhere.** Every domain table has `tenant_id`. Every API call uses `withTenant`.
- **Idempotency keys on side effects.** Workers retry; never double-send.
- **No raw SQL with user input.** Use Drizzle queries or the filter compiler. If you must `tx.execute(sql\`...\`)`, parameterize.
- **Catalog-driven UI.** New queryable fields go in the catalog, not the UI.
- **Versions are immutable.** Don't edit `workflow_versions.graph` after publish; bump the version instead.
- **Compliance is not optional.** Every outbound passes through the gate. No bypass flag exists.
- **Use the UI primitives.** See "The UI system" above. A new hand-rolled button, table or empty-state string is a regression.
- **No native dialogs.** `window.confirm` / `window.alert` / `window.prompt` are banned in app code — use `confirmDialog()` / `notify` / `promptDialog()`.
- **Never put a backtick inside a `sql\`…\`` template**, including in a `--` comment. It closes the JS literal, and the error you get names a SQL identifier ("Expected `)` but found `follow_up_task_created`"), which sends you looking at the query instead of the quoting. Write the column name bare.
- **A server component cannot CALL a function exported from a `"use client"` module.** It fails only at runtime, never in `tsc`. Helpers meant for both sides live in a plain module and are re-exported from the client one — `humanise` in `@/lib/format`, `buttonClass` in `@/components/ui/button-class`.

---

## Common tasks

### Add a new pre-built recipe
1. Create `src/lib/recipes/<your_recipe>.ts` exporting a `RecipeDef`.
2. Add it to `ALL_RECIPES` in `src/lib/recipes/index.ts`.
3. Re-run `npm run seed`.

The recipe will appear at `/dashboard/workflows/recipes/<key>`.

### Add a new schema table
1. Create `src/db/schema/<your_table>.ts` (pattern: import `id`, `tenantId`, `timestamps` from `_shared.ts`).
2. Re-export from `src/db/schema/index.ts`.
3. In the table's migration, add `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy (copy a recent migration; `npm run check:rls` fails CI otherwise). Do NOT rely on the stale `tenant_tables` array in `0001`.
4. Run `npm run db:generate` then `npm run db:migrate`.

### Fresh databases and the migration chain

`npm run migrate:all` builds a complete schema from an EMPTY database — CI's
"Migrate · RLS coverage" job depends on it (migrate → `check:rls` → DB-backed
vitest). That only became true on 2026-09-07; before that the chain was
missing what early databases had received from `drizzle-kit push`:

- `0000_base_schema.sql` — the 59 original tables, reconstructed from
  `meta/0000_snapshot.json` (the 0000 SQL was never committed).
- `0044a_financial_plans.sql` — the one table no migration ever created.
- `0151a_push_only_columns.sql` — three push-only columns
  (`subscriptions.modules_override`, `subscriptions.allowed_fields`,
  `users.permissions`).

A file whose header carries `-- migrate:skip-if-table-exists <table>` is
recorded as applied WITHOUT executing wherever that table already exists
(production, every dev DB), so those bootstrap files only run on an empty
database. Rules that follow from this:

- **Never rely on `drizzle-kit push` to ship schema.** Every table and column
  in `src/db/schema` must be created by a migration, or a fresh database
  silently lacks it. `scratch/`-style parity check: `drizzle-kit pull` the fresh
  DB and diff against `generateDrizzleJson(schema)` — no `CREATE TABLE` /
  `ADD COLUMN` may appear.
- **A migration may only reference objects that exist at its point in the
  chain.** `0001a_rls_policies.sql` skips tables that don't exist yet for this
  reason; prefer `IF NOT EXISTS` / `to_regclass()` guards over reordering
  applied history.
- Lettered suffixes (`0044a`) slot a file between two applied numbers without
  renumbering history; `check-migration-dups` accepts them.

### Add a new queryable field on investors
1. Append a `FieldDef` to `investorCatalog.fields` in `src/lib/filter/catalog.ts`.
2. The filter builder, segment compiler, and AI assistant pick it up automatically.

### Run a workflow manually for testing
```ts
import { startRun } from "@/lib/workflow/runner";

await startRun({
  tenantId: "...",
  workflowId: "...",
  triggeredBy: "manual",
  subjectType: "investor",
  subjectId: "...",
});
```

The worker process drains queued runs in a tight loop (default 500ms).

---

## Running the server

### Local dev — `npm run dev`

Wrapped by `scripts/dev-server.mjs`. The wrapper does three things that
plain `next dev` doesn't:

1. **Bounds the Node heap to 5 GB** via `--max-old-space-size` (override with
   `NEXT_HEAP_MB`). Without a bound, the dev server's HMR cache grows
   unbounded — we've seen the process at 12 GB after a long session, at which
   point Windows page-thrashes and every HTTP request hangs at "loading". With
   the bound, V8 OOM-crashes cleanly instead.

   **The bound also sets Next's own restart threshold.** Next watches the heap
   against this limit and recycles the dev server as it approaches it
   (`⚠ Server is approaching the used memory threshold, restarting...`),
   killing every in-flight request. A streaming RSC navigation cut that way
   reaches the browser as `TypeError: network error` with no stack into this
   app, so it looks like a bug in whatever page was open. At the old 3 GB it
   fired every few minutes — the server idles at 1.8–2.4 GB once the dashboard
   cockpits, reports catalog and ops tower are compiled, so one recompile spike
   tripped it. If you see that overlay, check this ceiling before debugging the
   page.
2. **Frees port 3000 before starting** — kills any stale `node.exe`
   listening on the port so a half-dead previous instance doesn't block
   the new one.
3. **Auto-restarts on crash + on `/api/health` timeout**, up to 5
   restarts inside a 5-minute window. If it crashes more than that,
   the wrapper gives up loudly — that's a real bug, not memory creep.

If you need the old behaviour (no wrapper) for debugging, use
`npm run dev:raw`.

### Verifying a production build — `npm run build:check`

**Never run a bare `next build` while `npm run dev` is up.** Both write to
`.next`, they race on the build manifest, and you lose the dev server to
`ENOENT … _buildManifest.js.tmp.*` while the build fails with a misleading
`Cannot find module for page: /api/…`. `npm run build:check` builds into
`.next-verify`, deletes it afterwards, and restores `tsconfig.json` — which
`next build` rewrites every time to add `<distDir>/types` to `include`, leaving
a dangling path that makes `tsc --noEmit` fail with TS6053.

### Production / demos / end-user delivery — `npm run start:prod`

This runs `next build && next start`. **None of the dev-server
instability applies here** — there's no HMR cache, no module
re-imports on save, no growing memory. This is what you run when
showing the CRM to a client. The build artefact in `.next/` is portable
and can be served from any Node host.

For staging or longer-lived environments, run `next start` behind a
process supervisor (pm2 / systemd / Docker `restart: unless-stopped`)
so the OS handles crash recovery for you.

### How a push reaches production — the verified artifact (2026-10-15)

The production box **never builds**. A push to `main` runs ONE workflow
(`.github/workflows/deploy.yml`, "Deploy to AWS (EC2)"):

```
CI once (ci-core.yml) → build the slim image on a standard arm64 runner
  → runtime-files gate → docker save | zstd + manifest
  → S3 verified/<commit>/<runId>-<attempt>/  (OIDC role aina-crm-github-deploy: PutObject only)
  → SSM → box: disk gate → download → artifact-verify.sh → docker load
  → migrate → schema guard → blue/green switch  (scripts/artifact-deploy.sh, run-deploy-artifact.sh)
```

- **Only CI can create a verified artifact; the box can only read it.** The GitHub
  role has `s3:PutObject` on `verified/*` (no Delete); the instance role has
  `s3:GetObject` on `verified/*` (no Put, no List). Keys carry the full commit SHA and
  run id + attempt, so a key is never reused (a re-run bumps the attempt).
- **The box refuses** a wrong commit, failed CI, shadow flag, wrong architecture, a
  stale artifact (> 14 days) or any SHA-256 mismatch — against the manifest AND
  against the digest the build job passes inside the SSM command.
- **Disk gate** (`scripts/disk-gate.sh`) aborts before any download/load; the log
  prints CURRENT FREE / REQUIRED FREE / ARTIFACT SIZE / IMAGE SIZE / SAFETY HEADROOM.
- **Every deploy measures itself** (`scripts/deploy-sampler.py`): the workflow log ends
  with `=== DEPLOY METRICS ===` (host RAM, swap, dockerd RSS, container peaks, disk,
  durations). A normal deploy takes ~1 minute on the box.
- **Anything the image needs at runtime must be IN the image.** The old on-box
  `COPY . .` silently carried untracked files (`rds-ca.pem` — the first verified
  deploy failed on it, safely). The build job has a gate for the files production
  needs; add to it when the box starts depending on another file.
- **Emergency path**: `deploy-legacy.yml` (manual) still builds on the server. Docs-,
  mobile-, terraform-, artifacts- and reports-only pushes do not deploy.
- Pushes to a branch run `ci.yml` (cancelled by a newer push); `main` is validated by
  the deploy workflow, never twice. Don't dispatch a deploy while another one is
  *pending*: GitHub keeps only the newest pending run per concurrency group and
  cancels the older one.

### Production change control — one change at a time

Since 2026-10-09 (the firm's rule) only ONE session or person changes
production at a time: a deploy, a rollback, an RDS change, a security group,
a container restart. The lock lives on the box (`scripts/prod-lock.sh`,
installed as `~/prod-lock.sh` by every deploy) and is reached from a laptop
through SSM:

```bash
bash scripts/prod-change.sh status
bash scripts/prod-change.sh acquire "Resize RDS to small" "<your session name>"
bash scripts/prod-change.sh release "<your session name>" "PASS: health ok"
bash scripts/prod-change.sh history
```

- **Check, then acquire, before any production change.** Exit code 3 means
  someone else holds it: STOP and wait — never work around it.
- **Release only after your health checks pass.** `ssm-deploy.sh` and
  `rollback-bluegreen.sh` take and release it themselves (released only when
  `/api/health` answers 200; a failed deploy releases it only if the colour
  still serving is healthy). A deploy waits up to 30 minutes for the lock.
- **No administrator key for a deploy, and no long-lived AWS key at all.**
  `manual-deploy.sh` and `prod-change.sh` use the SSO profile
  `aina-deploy` (IAM Identity Center permission set AinaDeploy, 1-hour
  credentials, MFA at login; `scripts/aws-deploy-role.sh`): upload under the
  artifacts bucket's `releases/` and SSM commands on the production instance,
  nothing else (no RDS, IAM, security groups or other buckets). Sign in first
  with `aws sso login --profile aina-deploy`. Infrastructure work uses
  `--profile aina-admin` (AinaInfraAdmin) and read-only monitoring
  `--profile aina-ops` (AinaOpsReadOnly).
- **A deploy inside a wider change**: take the lock under a space-free session
  name, then `DEPLOY_SESSION=<that name> FORCE=1 bash scripts/manual-deploy.sh
  <sha>`; `ssm-deploy.sh` sees `held-by` and deploys under it without
  releasing, so you release after your own checks.
- Every acquire / release is appended to `~/prod-change.log` with the change,
  the session and the start time. `force-release` exists for a human clearing
  a dead session's lock, and is logged as such.

### Database roles in production

The web app and the worker connect ONLY as `mfd_app` (`APP_DATABASE_URL`):
no superuser, no BYPASSRLS, so Row-Level Security is enforced on every
query. Since 2026-10-09 neither container even receives the master login.

- `mfd_master` (`DATABASE_URL`) lives in `~/app/.env.migrate` on the box
  (mode 600) and only the `migrate` compose service loads it — the deploy's
  migrate, type-check and schema-guard steps.
- A maintenance script that needs DDL or the master (anything reading
  `process.env.DATABASE_URL` directly: apply-migration, migrate-tolerant,
  check-rls, verify-rls-isolation, provision-app-role, cleanup-ahpal-rta,
  reset-tenant-book, diagnose-rta-mailback) runs as a one-off, under the
  change lock:
  `docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/<x>.ts`.
  `docker exec app-worker-1 …` gives you `mfd_app` only.
- Never add `DATABASE_URL` back to `.env.production`.

### Health check

`GET /api/health` returns 200 + a small JSON if the process and the DB
are both responsive, or 503 if the DB is unreachable. Used by
`scripts/dev-server.mjs` and by any external uptime probe.

---

## What's deferred / not yet wired

> **Note:** Auth and billing are NO LONGER deferred — both are wired end-to-end
> (see "Already built" below). This list is now the genuine roadmap.

- **BSE Star MF + NSE NMF II** — transaction execution
- **CAMS/KFintech reverse feed parser** — daily reconciliation
- **Investor mobile app** (React Native)
- **Video session suite**
- **AI assistant Tier 2 RAG** (per-tenant vector index)

These have clear hooks in the schema and architecture; pick them up in roadmap order (see README "What's left").

### Already built (commercial readiness)

- **Send durability** — every outbound goes through the delivery ledger
  (`lib/comms/durable-delivery.ts`, `communication_deliveries`), which commits
  on its OWN transaction, keyed by a key stable across retries
  (`wf:<run>:<node>:<step>` for a workflow send). A step that rolls back after
  the provider accepted the message finds "sent" on retry and never sends
  again; a send interrupted mid-call is marked "unknown" for reconciliation,
  never re-sent. Pinned by `tests/durable-delivery.test.ts`. (This was listed
  as deferred long after it shipped.)
- **Client limit vs the registrar** (the firm's decision of 2026-10-26):
  clients added by hand, CSV or lead conversion stop at `packages.maxInvestors`
  (`assertInvestorQuota`); an RTA import is NEVER cut short — the registrar's
  book is the firm's real data. After every RTA import a firm over its limit is
  told (`lib/billing/client-limit.ts`, each owner once a day,
  `plan.client_limit`) and Billing shows how far over it is.
- **Per-firm SMS sender** — Settings → Integrations → MSG91 SMS (owner only):
  the firm's own MSG91 auth key and 6-character DLT header, stored encrypted
  in `tenant_integrations` (provider `msg91`); without it SMS falls back to
  the platform's shared key and sender.

- **Authentication** — fully wired: JWT (HS256) sessions verified in Edge
  middleware with a DB revocation check, separate MFD vs platform-admin cookies,
  login / logout / forgot / reset / 2FA, and self-serve signup. The RLS
  `app.tenant_id` is set from the verified session in every `withTenant`.
- **Self-serve onboarding** — signup creates tenant + owner + HQ branch + trial
  subscription + master seeds + default recipes in one transaction, then issues
  an **email-verification** token (migration 0123; owner is logged in but
  `users.email_verified_at` is null until confirmed, and inviting a team is
  gated on the inviter being verified).
- **Team management** — email invites with set-password-on-accept, role
  assignment, seat limit (`packages.maxUsers`) enforced at invite, offboarding
  with client redistribution. `platform_admin` is never tenant-assignable.
- **Billing** — Razorpay recurring auto-debit, HMAC-verified webhook, full
  subscription lifecycle, license gate restricting lapsed tenants to billing +
  support. Client-count quota (`packages.maxInvestors`) enforced on investor
  creation; per-tenant monthly message quota via
  `packages.feature_flags.maxMessagesPerMonth` (see comms pipeline step 5c).

---

## Reading order for a new developer

1. README.md (product overview)
2. This file (developer overview)
3. [src/lib/workflow/schema.ts](src/lib/workflow/schema.ts) — the data shape of a workflow
4. [src/lib/workflow/runner.ts](src/lib/workflow/runner.ts) — how steps execute
5. [src/lib/comms/pipeline.ts](src/lib/comms/pipeline.ts) — how a send actually happens
6. [src/lib/comms/compliance.ts](src/lib/comms/compliance.ts) — the moat
7. [src/lib/filter/catalog.ts](src/lib/filter/catalog.ts) + [src/lib/filter/compiler.ts](src/lib/filter/compiler.ts) — the AST + how it becomes SQL
8. [src/lib/recipes/sip_rejection_followup.ts](src/lib/recipes/sip_rejection_followup.ts) — a representative recipe
9. [src/workers/outbox-poller.ts](src/workers/outbox-poller.ts) — the event spine

After that, the rest is fill-in-the-blanks.
