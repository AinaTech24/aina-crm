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
3. Consent check (per channel × scope) — `transactional` consent is required for utility; `marketing` for marketing
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

Two constraints worth knowing before authoring a template:

- **Merge values are HTML-escaped.** A token carrying markup (`<li>…</li>`)
  prints its own tags to the client. Emit plain text and let the block do the
  formatting.
- **Every public form path needs a `PUBLIC_PATH_PREFIXES` entry** in
  `src/middleware.ts`, or the link 307s the client to `/login`.

### Adding a new compliance rule

Append a function to `ALL_RULES` in `src/lib/comms/compliance.ts`. Each rule is `(ctx) => ComplianceFinding[]`. Severity `block` stops sends; `warn` shows in UI but allows; `info` is logged.

---

## Webhook handlers

| Provider | Path | Verifies |
|---|---|---|
| AiSensy | `/api/webhooks/aisensy` | HMAC SHA-256 over raw body |
| Resend | `/api/webhooks/resend` | Svix-style signature |

Idempotency: communications updates are keyed by `(external_id, channel)` — same status delivered twice is a no-op. Inbound WhatsApp messages identify the tenant via the receiving phone number (`whatsapp_numbers` table).

**Important:** webhook handlers run in **system context** because they don't have a session. They write `events_outbox` rows that the poller picks up and routes to subscribed workflows.

---

## The dashboards

`/dashboard` serves **three** cockpits, chosen by `?scope=`:

| scope | What it answers | Default period |
|---|---|---|
| `firm` (default) | "How is the business doing?" — every branch, every RM | FY to date |
| `branch` | "Is my branch on target, which RM, what needs me?" — one branch | Month to date |
| `mine` | "Whom do I contact today, what is pending, how is my business going?" — the RM desk, only the signed-in user's own book. The DEFAULT for an RM | Today for actions, month to date for business |

They are deliberately separate views rather than one page with a filter. A
director who also carries clients wants both, and merging them makes both
worse: firm-wide overdue tasks bury the four that are actually theirs, and a
personal AUM figure inside a firm cockpit reads as the firm's. The switch is
`DashboardScopeSwitch`, which preserves every other query param except the
ones that change meaning between views (`rm`, `tab`, the branch view's
toggles). WHICH scopes a viewer may open is decided in
[src/app/dashboard/page.tsx](src/app/dashboard/page.tsx), never by the switch.

**What "mine" means is defined once**, in
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
action sections, `src/components/dashboards/desk/`. Each band on the page is
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
  period. Every tile says which it is, because "My AUM +6.9%" read as sales is
  the classic error.
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

### The branch command centre (`?scope=branch`)

The Branch Business Command Centre (`BranchCommandCentre.tsx`) is the
branch head's view: KPIs, targets, the RM scoreboard and target matrix, SIP /
redemption / review / task / query desks, the attention centre, weekly and
monthly review modes and the FY scorecard — 32 sections.

- **The branch lock.** A branch head (`isBranchScoped`: branch head, not owner,
  with a branch) WITHOUT `dashboard.view.all_branches` is locked to
  `session.branchId`: the branch view is their default, `?branch=` is
  ignored, `?rm=` is honoured only for someone in that branch, and
  `?scope=firm` falls back to the branch. `dashboard.view.all_branches`
  (owner implicitly; grantable per user) lifts the lock and adds the branch
  picker. A branch head with no branch gets an explanation, never a silent
  widening to the firm. `dashboard.view.branch` gates the view itself.
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
- **Drill-down is branch → RM → client → record.** A KPI tile opens the RM-wise
  view, an RM name opens the one-on-one view (`?rm=`), client names open the
  record. List pages read `branch=` (investors, leads, SIP rejections) so a
  count opens onto the same rows — a filter only ever NARROWS; the viewer's
  access scope still applies on top. Build list links with `clientsHref` /
  `leadsHref` from `lib/dashboard/my/window.ts`, never a literal `?mine=1`.
- **Voice.** Shared sections take a `voice` (`components/dashboards/my/voice.ts`)
  for their copy and links, so one component says "My client book" or "Branch
  client book" without knowing which page it is on.

### The RM desk (`?scope=mine`)

"My Client & Business Dashboard" (`MyBusinessDashboard.tsx`) — the RM's work
desk, client cockpit and target tracker, built from the 40-section RM brief.
Action before analytics: morning priorities → My Day → Needs my attention →
KPIs → targets → today's worklist + 7 days → meetings, reviews, book, leads,
SIP, flows, tasks, queries, relationships → scorecards → FY performance.

- **An RM lands here.** `rmHome` in `app/dashboard/page.tsx`: no firm,
  compliance, marketing or ops cockpit but `dashboard.view.rm` → scope
  `mine`, and so do `?scope=firm` and a branch view they may not open. A
  director or branch head who carries clients opens the same desk from the
  switch.
- **Owner is locked to "Me".** There is no owner picker. Client filters
  (`cat`, `ctype`, `cnew`, `cstatus`, `city`, `src`, `fam` → `BookScope.filter`)
  narrow CLIENT facts only; the RM's own tasks, leads and meetings are not
  filtered. They and `day` / `eod` are `MINE_ONLY_PARAMS`, dropped by the
  scope switch on the way out.
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

## Conventions

- **Tenant id everywhere.** Every domain table has `tenant_id`. Every API call uses `withTenant`.
- **Idempotency keys on side effects.** Workers retry; never double-send.
- **No raw SQL with user input.** Use Drizzle queries or the filter compiler. If you must `tx.execute(sql\`...\`)`, parameterize.
- **Catalog-driven UI.** New queryable fields go in the catalog, not the UI.
- **Versions are immutable.** Don't edit `workflow_versions.graph` after publish; bump the version instead.
- **Compliance is not optional.** Every outbound passes through the gate. No bypass flag exists.

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

1. **Bounds the Node heap to 2 GB** via `--max-old-space-size=2048`. Without
   this, the dev server's HMR cache grows unbounded — we've seen the
   process at 12 GB after a long session, at which point Windows
   page-thrashes and every HTTP request hangs at "loading". With the
   bound, V8 OOM-crashes cleanly instead.
2. **Frees port 3000 before starting** — kills any stale `node.exe`
   listening on the port so a half-dead previous instance doesn't block
   the new one.
3. **Auto-restarts on crash + on `/api/health` timeout**, up to 5
   restarts inside a 5-minute window. If it crashes more than that,
   the wrapper gives up loudly — that's a real bug, not memory creep.

If you need the old behaviour (no wrapper) for debugging, use
`npm run dev:raw`.

### Production / demos / end-user delivery — `npm run start:prod`

This runs `next build && next start`. **None of the dev-server
instability applies here** — there's no HMR cache, no module
re-imports on save, no growing memory. This is what you run when
showing the CRM to a client. The build artefact in `.next/` is portable
and can be served from any Node host.

For staging or longer-lived environments, run `next start` behind a
process supervisor (pm2 / systemd / Docker `restart: unless-stopped`)
so the OS handles crash recovery for you.

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
- **Per-tenant SMS (MSG91/DLT) self-serve config** — the comms pipeline reads a
  per-tenant `msg91` integration but there's no settings UI/API to set it, so
  every tenant falls back to the shared env DLT key. DLT registration is
  per-entity in India, so this needs a settings page before SMS scales per-firm.
- **RTA bulk-import client-count quota** — `assertInvestorQuota` is enforced on
  the interactive create paths (manual / CSV commit / lead-convert), but the RTA
  master importer (`src/lib/rta/import.ts`) creates investors mid-pipeline with
  folio/family linking and is NOT yet capped; enforce there carefully so the
  linkage isn't broken.
- **Workflow send durability (outbox)** — `dispatch()` still performs the
  external adapter call inside the workflow step's DB transaction. A rollback
  after a successful send can't be recorded, so a re-run may double-send. The
  `startRun` active-subject unique index (migration 0124) removes the most
  common duplicate-run source; the full fix is to commit the `queued` row, send
  OUTSIDE any open tx, then commit status (the campaign dispatcher already does
  this — mirror it in the runner).

These have clear hooks in the schema and architecture; pick them up in roadmap order (see README "What's left").

### Already built (commercial readiness)

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
