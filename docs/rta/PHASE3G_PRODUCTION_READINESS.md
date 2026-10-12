# Phase 3G — Production readiness and controlled-pilot preparation

**Owner decision (2026-10-08): pre-production hardening approved, NOT production
deployment.** Nothing in this phase was merged, deployed, migrated in
production, or switched on for a production firm. No historical data was
repaired. Every figure below comes from disposable local databases
(`rta_verify3g` — the real mailback files, `rta_infra3g` — synthetic data
through real services, `rta_restore3g` — a restored backup), or from the test
database. Real files stay outside Git; this document carries aggregates only.

Phases 3B–3F (shadow staging → validate-first engine) are in
`PHASE3B_SHADOW.md` … `PHASE3F_VALIDATE_FIRST.md`.

---

## A. Architecture and gates

### Three switches, all of which must agree

| Layer | Where | Who changes it | Default |
|---|---|---|---|
| Process ceiling | `RTA_PIPELINE_MODE` (off · shadow · validate_first), `RTA_POSTING_MODE` (unset · development · controlled), `RTA_POSTING_DATABASE`, `RTA_POSTING_HALT` | deployment | unset = no posting, legacy importer as today |
| Firm activation | `rta_pipeline_activations` (migration 0236) — append-only; the newest effective, unexpired, unrevoked row is current; none = off | two platform operators (`/api/super-admin/rta-pipeline`, requester ≠ approver) | no row = **off** |
| Kill switch | `rta_posting_controls` — a `global` row and optional per-firm rows | halt: one operator; release: two | **installed halted** |

`resolvePipelineMode(tenantId)` (`lib/rta/staging/config.ts`) decides per
import, reading the database every time:

- **`RTA_POSTING_MODE=controlled`** (the pilot setting). The firm's activation
  decides; the env mode is only a ceiling.
  - No activation, or activation `off` → **off** — the existing (legacy)
    importer runs exactly as today. **No firm is switched automatically.**
  - `shadow` → shadow if the ceiling allows it, else off.
  - `validate_first` but the ceiling is lower, posting not enabled, the
    gate refuses, or the kill switch is on → **`validate_first_refused`**:
    the import fails with the reason, nothing is staged or written, and it is
    **never** sent to the legacy importer.
- **`development`** (Phase 3F behaviour): env decides, but a firm with a
  validate-first activation is still never sent to the legacy importer.

### The posting gate (`lib/rta/posting/gate.ts`) — fail closed

Process checks: posting kind set; `RTA_POSTING_DATABASE` named;
`RTA_POSTING_HALT` not `1`; development kind refuses production markers and
non-loopback URLs. **Inside the posting transaction**, every batch:
`current_database()` = `RTA_POSTING_DATABASE`; the role is neither superuser
nor BYPASSRLS; `app.tenant_id` = the firm; the global and firm kill-switch
rows read `FOR SHARE` and released; (controlled) the activation read
`FOR SHARE` is validate_first + posting enabled. Halting takes the global row
`FOR UPDATE`, so it **waits for an in-flight batch and stops the next one**
(tested: `rta-posting-controls-db`).

### Restricted role, tenant isolation, concurrency, idempotency

- Posting runs as the application role under RLS (the gate refuses a
  superuser / BYPASSRLS role). New tables in 0236 carry
  `ENABLE` + `FORCE ROW LEVEL SECURITY` and `tenant_isolation`
  (`rta_posting_controls` and its events are platform-scoped, no tenant id).
- One posting at a time per firm: `pg_advisory_xact_lock(rta_posting:<tenant>)`;
  batches are leased (`RTA_STAGING_LEASE_MS`, default 10 min). A job that
  meets a held lease is **delayed** (`RetryLaterError` → BullMQ
  `moveToDelayed`), not failed.
- One registrar transaction posts once: `rta_posted_transactions`
  UNIQUE(tenant, identity_key). Re-import of the same files: 0 rows changed
  (fingerprint identical, `rta_verify3g`).

### Audit trails

| What | Where |
|---|---|
| File | `rta_file_imports` (status, counts, remarks — PAN-masked), `rta_staging_batches` (checksum, parser version, posting_state, posting_counts) |
| Transaction | `rta_staging_economic_txns.posting_history` (jsonb, append): every outcome with when, who, via `batch` / `reevaluation` / `manual_resolution` / `reversal`, batch id |
| Operator | `rta_posting_control_events` (append-only), `rta_pipeline_activations` (append-only, single revoke), `rta_posting_reversals` (append-only, single undo), `audit_log` actions `rta.pipeline.activate|revoke`, `rta.posting.halt|release|batch|masters|reevaluate|reverse|reverse_undo`, `rta.identity.resolve` |

### Worker and queue failure recovery

- Upload / re-import jobs: `attempts: 3`, exponential backoff from 5 s.
- Request paths enqueue through `addWithin` on a **producer connection with
  the offline buffer off** (`producerQueue`, `src/workers/queues.ts`): Redis
  down → HTTP 503 and the import row says so; the job does not exist and can
  never run later behind the user's back. (The infrastructure check found the
  earlier shared connection delivering a "failed" upload once Redis returned.)
- A killed worker: the lease expires, BullMQ retries, the batch resumes from
  its staged rows; every transaction posts once (crash drill, §G).

### Which paths can still run the legacy importer (verified)

| Path | Mode check | Behaviour for a validate-first firm |
|---|---|---|
| Browser upload, re-import, retry scripts, mail poller (all enqueue `rta.import`) | worker: `resolvePipelineMode` | validate-first or refused — never legacy |
| Drop-folder feed ingest (`workers/feed-ingest.ts` → `lib/rta/ingest.ts`) | **added in 3G** | refused (recorded as a failed ingest) |
| `scripts/import-rta-local.ts --commit` | **added in 3G** | refused |
| Firm outside `RTA_PIPELINE_TENANTS` (development kind) | config | off → legacy (by design) |
| `/api/transactions/import/commit` (generic CSV, not RTA) | none | writes `transactions` regardless — **reported, not changed** (blocker J-4) |

Other findings, not changed: the feed-ingest default root `./feed-inbox`
and an SFTP mock with a hard-coded tenant id (J-4).

---

## B. Out-of-order recovery — the nine held transactions

`reprocessHeldTransactions` (`lib/rta/posting/reprocess.ts`) runs after every
master / holdings batch and after a manual resolution, for the batch's folios
and for held rows whose staged owner token matches an owner the batch
created. It re-runs ownership (registrar + canonical AMC + folio, then the
owner's own PAN token), validations and reconciliation; promotes only an
unambiguous result through the same commit path; records every outcome in
`posting_history`; bounded to 3 passes (a promotion can open a folio for the
next). Identity exceptions get **one manual task per folio** (`meta.rtaHold`),
closed automatically when the hold settles. `owner_not_on_record` alone does
not taint a folio and does not open a task (the master is simply not here yet).

Adverse order (all transactions before any master, no re-import):

| Stage | Result |
|---|---|
| Before masters | 2,444 held: 2,410 owner not on record, 16 unsupported, 18 corrections |
| MFSD203 arrives | 1,064 promoted + 2 rejections recorded |
| WBR4 | 2 promoted |
| R9 | 1,332 promoted |
| MFSD211 (May) | 1 rejection recorded |
| **Final** | **2,401 posted = an exact subset of the production-order result, owners included**; 0 differences |

**The nine: 0 resolve automatically; 9 remain held** (`placeholder_owner`),
6 SIP (₹10,999.46) and 3 purchases (₹11,999.40). All are KFintech rows of a
minor whose folio sits on a PAN-less placeholder (`NOPAN:FOLIO:`). They are
correctly held: the only link to the minor is name + guardian PAN, which
must never merge automatically. 7 manual tasks are open (one per folio). The
resolution is a person merging the placeholder into the minor's record (or
confirming it), then `POST /api/rta-staging/economic/:id/resolve`, which
re-checks the guardian / Karta / PAN rules, posts once and audits.

Never done automatically (tests in `rta-reprocess-db`): merging minors across
registrars by name or guardian PAN; assigning an HUF row to its Karta; moving
a folio between two real clients.

---

## C. Read-only historical diagnostics

`scripts/rta-historical-diagnostics.ts --tenant <id>` — `SET TRANSACTION READ
ONLY`, aggregates plus masked examples, a risk level and a **proposed,
reversible** repair per finding; it executes nothing.

| Finding | Built with today's legacy importer (sample firm) | Proposed repair (not executed) |
|---|---|---|
| `MINOR:` keys | 23 (3 registrar-scoped) | review each; keep separate unless a person confirms the same child |
| `NOPAN:FOLIO:` placeholders | 25 (₹4,66,800.39) | import masters first; a person merges into the real client |
| Guardian PAN used as owner | 0 | move the folio to the minor (archive + audit) |
| Same folio number at two AMCs on one row | 0 | split by AMC |
| Registrar reference collisions | 0 | — |
| Line-keyed references (`<rta>_<line>`) | 0 | re-key from staging |
| Switch / STP misclassified | 0 | reclassify from `trxn_type_flag` |
| Bad amounts / dates | 0 | — |
| Holdings older than their scope's statement | 1,235 | import a current full-book statement |
| Duplicate SIPs | 0 | — |

**Limitation:** the sample firm was built by today's importer, which already
carries the Phase 2 fixes. Defects of the OLD importer exist only in the real
production database, so **the script must be run there, read-only, before a
pilot** (J-3). MFSD230 is refused by the legacy importer (unrecognised layout).

---

## D. SIP Master and the Active SIP Book — completeness

`getSipBookCompleteness` (`lib/metrics/sip-completeness.ts`), shown on the SIPs
page (`SipCompletenessPanel`) and as a footnote on the SIP book tile:

| | Count | Monthly |
|---|---|---|
| Registrations known | 1,935 | |
| Verified status | 10 | |
| — verified active (all in the book) | 4 | ₹9,000 |
| — verified pending | 5 | ₹9,500 |
| — verified active STP | 1 | |
| Observed activity, status unverified | 312 | ₹19,96,050 |
| Unknown | 1,561 | |

By registrar / ARN: CAMS 1,188 (ARN not stated by WBR49); KFintech 738 with no
ARN on record + 9 under ARN-270604. Last status report: CAMS 2026-10-02,
KFintech 2026-10-07. Periods: MFSD243 2026-10-01…10-07 (9 rows), WBR49
2026-10-02 (1 row), MFSD230 2026-08-29…10-05 (20 rows, no status).

**The 4 active SIPs are not the book**: the panel says "Registrar-verified
only: 10 of 1,935 registrations have a verified status" and `complete: false`
with reasons. A successful instalment is shown as *observed*, never active; a
missing instalment never stops a SIP.

**Smallest authoritative report that closes the gap:** MFSD243 (KFintech) and
WBR49 (CAMS) are period reports of NEW registrations. One run of each over the
**full registration date range** (from the firm's first SIP to today), then
the usual incremental run. Whether those reports carry a current status for
old registrations must be confirmed with one sample of each before relying on
it (J-2).

---

## E. AUM and Portfolio

| Check | Result |
|---|---|
| MFSD203 staged vs committed | ₹14,67,10,680.68 = KFintech card, 1,943 positions (329 zero units, kept as 0) |
| R9 | ₹11,94,00,802.05 staged, 1,237 positions, 19 zero, **as of 2026-05-18** |
| CAMS card | ₹11,95,98,517.29 = R9 legs ₹11,92,34,680.66 (1,235) + WBR4 ₹3,63,836.63 (8, newer, replaced 2 R9 positions) |
| ARNs | ARN-270604 on both registrars |
| Undated legs | 2 (shown, never counted as dated) |
| Joint / guardian folios | 194 joint, 31 guardian; folios counted twice: 0 |
| Portfolio vs AUM | ₹26,63,09,198.12 vs ₹26,63,09,198.05 (rounding); 0 clients differ; 588 clients carry a warning |
| Firm headline | **withheld**: CAMS is partial, mixed-dated (05-18 → 10-08), 143 days old |
| Registrar vs live NAV | kept apart, each dated; equal here only because no NAV refresh ran |

The KFintech figure (₹14,67,10,680.68) is preserved. **A current CAMS
full-book statement is required** before a firm AUM total can be shown (J-2).

---

## F. Rejections and corrections

| Case | Outcome | Success totals | SIP stopped | Ownership moved | Re-import |
|---|---|---|---|---|---|
| SIP instalment refused (SIND) | `transactions` rejected, 0 units + `sip_rejections` row | unchanged | no | no | no duplicate |
| STP refused (STPAD / STPOD) | rejected record; the pair counts once | unchanged | no | no | no duplicate |
| Purchase / redemption rejection (KFintech R-codes) | held — folio consolidation unless proven otherwise | unchanged | no | no | no duplicate |
| Pre-rejection | held | unchanged | no | no | — |
| Folio consolidation (original + negation + re-post) | `correction_held` | unchanged | no | no | — |
| Unlinked reversal / cancellation | held | unchanged | no | no | — |
| Unsupported code | `unsupported` | unchanged | no | no | — |

Real files: **18 corrections** — 16 SIN groups (48 rows, ₹23,998.88), 1 NEW
group (3 rows, ₹99,995.00), 1 FUL rejection group (48 rows, ₹23,874.42); all
36 folio legs are on record and in all 18 both folios belong to the same
client, so no ownership question arises. **16 unsupported** — WBR10 unknown
codes 8 rows (₹56,997.16), MFSD201 unknown codes 6 transactions / 8 rows
(₹5,43,384.29), WBR10 non-financial 2. Rejected records in business: 0. SIPs
stopped by a rejection: 0. (`rta-rejection-matrix-db`.)

---

## G. Infrastructure integration (real services, synthetic data)

`scripts/rta-infra-check.ts` drives the running system: `next dev` (HTTP
routes), Chromium (the upload dialog), an S3-compatible store (moto server,
presigned PUTs), BullMQ on a real Redis, **separate worker processes** that it
kills and restarts, and Postgres as the application role. Synthetic PANs only
(`ZZZP…`); it refuses any non-local URL.

**Result: 35 / 35 PASS** (final run; two earlier runs found the defects
below, fixed in code, and four fixture mistakes, fixed in the script).

| Area | Checks |
|---|---|
| Browser | the real upload dialog → presign → S3 PUT → upload API → queue → worker → database; the outcome shown; no page errors |
| Formats | CSV (MFSD201), XLSX (R9 master, a real OOXML workbook), XLS BIFF8 (R2), password-protected ZIP; a ZIP with two data files refused |
| Duplicates / overlap | the same file again: 0 new; an overlapping file: only the new transaction |
| Two firms at once | two worker processes, two firms in parallel, no cross-firm effect; firm two's transactions held, then posted by its master's arrival (no re-upload) |
| Crash | worker SIGKILLed mid-staging (20,000 rows); restarted; lease expiry + BullMQ retry; completed; every transaction posted exactly once |
| Redis down | upload → HTTP 503, row `failed` with the reason, **no job** (it never runs later); Redis back → the same file imports once |
| S3 down | the job fails after retries with a recorded reason, nothing posted, file kept; S3 back → re-import completes |
| Database down | the job is retried and posts once |
| Permissions | no import capability → 403 (upload URL, resolve); another firm's import → 404; another firm's storage key → 403; a firm session on the operator controls → 401 |
| Mail | the S3 inbound poller reads three stored mails; the DKIM/DMARC-aligned registrar mail routed by alias to its firm and imported through the queue; the forged and the unroutable mail held, never imported |
| Privacy | no input PAN in worker or server logs (68 KB scanned); none in staging (keyed tokens only); remarks and errors masked |
| Final states | every import reached completed / failed — none left parsing or queued |

Defects found by this check and fixed: S-1, S-2 (§J). Fixture mistakes
(not product defects): the custom file-type picker was not driven, so a master
went up as a daily feed; a BIFF8→XLSX round trip lost the date format (the
importer rightly refused a bare serial); an RM holds the import capability by
default, so "a user without it" is now a marketing user; a base64url row hash
happened to contain a PAN-shaped run (1 in ~25,000) — the check now looks for
the input PANs everywhere and PAN shapes outside keyed columns.

**Not tested here** (and not claimed): a managed AWS S3 bucket and IAM
policy, a real mail provider's inbound pipeline (mails were stored in the
bucket as the provider would), Redis cluster / failover, production network
policy, and load beyond one 20,000-row file.

---

## H. Migrations 0233–0236, backup, recovery

### What each migration does

| Migration | Effect | Lock risk |
|---|---|---|
| 0233 staging | new `rta_staging_*` tables; FK to `rta_file_imports` ON DELETE SET NULL; small unique index on `rta_file_imports` | new tables; the index on an existing (small) table takes a brief SHARE lock |
| 0234 folio holders | new `folio_holders` + cross-tenant trigger | new table only |
| 0235 posting | `rta_posted_transactions`, staging posting columns, `rta_sip_registrations`, index `rta_staging_rows_econ_idx` | new tables / columns with constant defaults (catalogue-only in PG 16) |
| 0236 controls | `rta_posting_controls` (global row **halted**), events, activations, reversals; `posting_history`, `arn`; posting-state/outcome checks `NOT VALID` | new tables; `ADD COLUMN … DEFAULT` constant; checks `NOT VALID` (no scan); `lock_timeout 5s` |

None alters `transactions`, `investors`, `folios`, `sips` or their unique
constraints. All are re-runnable (`IF NOT EXISTS`, `DROP … IF EXISTS` before
re-create): 0236 was re-applied over an earlier draft in three databases
without error. With `RTA_PIPELINE_MODE` / `RTA_POSTING_MODE` unset the
application behaves exactly as before them (no activation rows = off).

**Lesson recorded:** the migration runner only WARNS when an applied file's
checksum changes. Three disposable databases had an earlier draft of 0236
(without the reversal objects) and the first recovery drill failed on them.
Before a release, compare `_applied_migrations.checksum` with the files.

### Release order

1. Backup (below). 2. Deploy code with `RTA_PIPELINE_MODE` and
`RTA_POSTING_MODE` **unset**. 3. Apply 0233 → 0234 → 0235 → 0236 in one
`migrate:all` run, off-peak. 4. `check:rls`, `check:schema`, checksum
comparison. 5. Smoke test: an import for any firm still takes the legacy path.
6. Only then, per firm, the activation checklist.

### Backup / restore — drilled

`pg_dump -Fc` of `rta_verify3g` (12 MB, 1.2 s) → `pg_restore` into a fresh
database (3.9 s, exit 0). Fingerprint (row count + md5 of every row, ordered)
of transactions, ledger, clients, folios, holders, SIPs, SIP rejections,
staging, registrations, controls, activations, audit, plus RLS-forced tables
(187), policies (197), triggers and applied migrations (274): **identical**.
On the restored copy the application role still sees 0 transactions without
a firm and only that firm's 2,410 with one.

### Recovery from an incorrect batch — drilled on the restored copy

`scripts/rta-posting-recovery.ts` (operator CLI over `lib/rta/posting/reversal.ts`):

1. `halt --scope <firm>` — reversal is refused while the firm can post (verified).
2. `reverse … ` — dry run first: 685 transactions, 1 SIP rejection, 685 ledger rows.
3. `reverse … --commit` — two people (same person refused, verified); every
   row archived whole in `rta_posting_reversals`, then removed; outcomes
   `reversed`; audit row. Transactions 2,410 → 1,725.
4. `reconcile` — all five checks 0.
5. Either import the corrected file (posts afresh — `rta-recovery-db`) or
   `undo` (refused a second time; the archive cannot be deleted — verified).
6. After undo: transactions, ledger, SIP rejections, folios and SIPs
   **byte-identical to the backup**; every client's last-transaction date
   identical; `reconcile` 0.
7. `release --scope <firm>` — two people.

The drill found and fixed a defect: the reversal recomputed each client's
last-transaction date from the remaining transactions and the undo did not
restore it, losing a date the registrar master had supplied (417 clients in
the drill). The reversal now lowers it only when the batch set it, archives
the prior value, and the undo restores it (`rta-recovery-db`).

Masters (clients, folios, holdings legs) are not reversed by the CLI: a wrong
master is corrected by importing the right statement (an older one never
overwrites a newer one) or by restoring the backup.

**A feature-flag rollback is not a financial-data rollback.** Revoking an
activation or halting stops future writes; it does not undo past ones — that
is the reversal above, or the restore.

### Disabling writes, fastest first

1. `halt --scope <firm>` or `--scope global` (one operator; takes effect at
   the next batch and waits for the running one). An activated firm's imports
   then fail as `validate_first_refused` — no writes at all.
2. `RTA_POSTING_HALT=1` on the workers (process level, same effect).

The kill switch stops the NEW pipeline only. Firms that were never activated
keep today's importer, as before 3G. **Superseded in Phase 3H:** a revoked or
expired activation now leaves the firm PAUSED (held, nothing written) — it
never returns to the existing importer by itself; that takes an explicit `off`
activation by two people. There is also an EMERGENCY scope that stops every
firm, legacy included. See `PHASE3H_PILOT_BLOCKERS.md` §E.

### Reconciliation after recovery (and nightly in a pilot)

`reconcile --tenant <id>`: ledger without transaction, validate-first
transaction without ledger, posted outcome without ledger, ledger identity
twice, rejected record with units — all must be 0. Then the eight-module
figures of §I against the previous day's.

---

## I. Pilot-readiness matrix (eight modules)

Statuses kept separate on purpose. "Production release approved" is **No**
everywhere: that is the owner's decision, not this phase's.

| Module | Parser verified | Financial values reconciled | UI verified | Operational data complete | Production release approved |
|---|---|---|---|---|---|
| Client Master | Yes — R9, MFSD211, MFSD203, WBR4 real files | n/a; 1,193 clients, 0 folios with two owners, 0 minor/HUF rows on adults | Yes (3F browser run) | Partial — 25 placeholders, 23 minors to review | No |
| Accurate AUM | Yes — R9, MFSD203, WBR4 | KFintech yes (₹14,67,10,680.68); CAMS partial | Yes — firm total withheld with reasons | **No** — CAMS full-book statement missing | No |
| Active SIP Book | Yes — MFSD243, WBR49, MFSD230 | 4 verified active ₹9,000 = book | Yes — completeness panel | **No** — 10 of 1,935 verified | No |
| Client Portfolio | Yes (holdings legs) | Yes — portfolio = AUM, 0 clients differ | Yes | Partial — 588 clients warned (CAMS dates) | No |
| SIP Rejection / Stop | Yes — SIND / STPAD / STPOD | Yes — 3 refused, ₹12,000, 0 in business | Yes | Stops: no authoritative source (not inferred) | No |
| Transactions | Yes — R2, MFSD201 | Yes — 2,407 + 3, ledger = CRM, idempotent | Yes | Partial — 34 held (16 unsupported, 18 corrections) | No |
| Transaction Rejection | Yes | Yes — rejected never counted | Yes (held screen) | Partial — CAMS rejection wording has no sample | No |
| SIP Master | Yes | n/a (registrations, not money) | Yes | **No** — status unknown for 1,561 | No |

---

## J. Blockers before a pilot

### Software defects (found in 3G)

| # | Item | State |
|---|---|---|
| S-1 | Upload hung while Redis was down; a timed-out enqueue was later delivered | **fixed** (producer connection, 503) |
| S-2 | Upload jobs had one attempt | **fixed** (3, backoff) |
| S-3 | Reversal / undo lost a master-supplied last-transaction date | **fixed** |
| S-4 | Drop-folder ingest and the local import script ignored the mode | **fixed** |
| S-5 | `transactions` UNIQUE(tenant_id, order_id): a registrar number reused at another AMC cannot be stored | **open — schema change needs approval**; such rows are held, not lost |
| S-6 | Generic CSV import (`/api/transactions/import/commit`) writes transactions without the RTA gate | open — decide whether a validate-first firm may use it |
| S-7 | Feed-ingest default root `./feed-inbox`; SFTP mock hard-codes a tenant | open — configuration hygiene |
| S-8 | Migration runner only warns on a changed checksum | open — make it fail in CI/release |

### Missing RTA evidence

- CAMS full-book statement (R9 / WBR22) for every ARN, current date.
- MFSD243 + WBR49 over the full registration range; one sample of each to
  confirm a status column for old registrations.
- A CAMS rejection / reversal sample (wording is `unknown` until then).
- Registrar documentation for the 14 unknown transaction codes.

### Historical migration

- Run `rta-historical-diagnostics.ts` read-only on the production database;
  review placeholders, `MINOR:` keys and guardian-owned folios with the firm.
- The nine placeholder-minor transactions need a person's merge decision.
- No automatic placeholder reassignment (stays off).

### Operational configuration

- An application role without BYPASSRLS for the workers (gate refuses otherwise).
- `RTA_POSTING_DATABASE`, `RTA_STAGING_TOKEN_KEY` (or `ENCRYPTION_KEY`), `REDIS_URL`, S3.
- Two named platform operators; a change reference for the activation.
- Nightly `reconcile` + the eight-module comparison; alert on non-zero.
- `RTA_STAGING_LEASE_MS` sized to the largest file.

### Regulatory / privacy review

- Staging stores keyed PAN tokens (`pt1:`) and masks; confirm the key custody
  and rotation plan.
- Holder records for joint holders, guardians and Kartas (`folio_holders`):
  confirm retention.
- Manual identity resolutions are audited; confirm who may perform them.

---

## Minimum file plan (Task 10)

Minimum set (Phase 3D): **CAMS** R2, R9, WBR49 · **KFintech** MFSD201,
MFSD203, MFSD211, MFSD243. Conditional: MFSD230 (the only source of paid /
pending instalment counts; never sets status), WBR4 (a partial CAMS holdings
statement — dated, never a full book), MFSD228 (bank bounces, unevidenced),
MFSD244 (registration rejections, unevidenced), a CAMS rejection report (code
to be confirmed with CAMS). Facts no listed report carries — a SIP's pause,
stop or expiry where no lifecycle report states it, a bank bounce reason, a
Karta — are shown as unknown / not recorded, never inferred.

### Schedule A — initial setup (per firm, in this order)

| Step | CAMS | KFintech | Range | Why first |
|---|---|---|---|---|
| 1 Masters + holdings | R9 **full book**, every ARN | MFSD211 full, MFSD203 **full book**, every ARN | as of one date, as recent as possible | owners on record before any transaction; one dated AUM statement per registrar × ARN |
| 2 SIP registrations | WBR49 | MFSD243 | from the firm's first SIP to today | the SIP Master needs every registration, not the latest period |
| 3 Instalment counts (optional) | — | MFSD230 | same range | paid / pending counts only |
| 4 Transactions | R2 | MFSD201 | from the earliest date the firm wants history for (or inception) to today | posts to owners already on record; anything else is held and re-evaluated, never guessed |
| 5 Check | | | | held screen, `reconcile`, SIP completeness panel, registrar AUM cards |

Out of order still works (§B), but the held list is longer until masters arrive.

### Schedule B — ongoing synchronisation

| Cadence | CAMS | KFintech | Feeds |
|---|---|---|---|
| Daily (business days) | R2 | MFSD201 | Transactions, refused instalments / STP, SIP Rejection |
| Weekly | WBR49 | MFSD243 (+ MFSD230 if used) | SIP Master, Active SIP Book — new registrations and any status the report states |
| Monthly (or before any AUM review) | R9 full book | MFSD203 full book | AUM statement and portfolio; an older statement never replaces a newer one |
| On change (or monthly) | — (R9 carries it) | MFSD211 | new folios, holders, tax status |

A missed day is caught up with an overlapping range: re-imports are
idempotent and an overlap posts only what is new (§G).

## Pilot deployment checklist (for review — not executed)

**Before (owner approval required at each ☐ marked APPROVAL)**

1. ☐ APPROVAL — the pilot firm, its dates, and two named platform operators.
2. ☐ Backup taken and a restore rehearsed on a copy (fingerprint compared).
3. ☐ `rta-historical-diagnostics.ts` run read-only on production for the pilot
   firm; findings reviewed with the firm.
4. ☐ Masters current: R9 (or WBR22) full book for every ARN, MFSD211 + MFSD203.
5. ☐ Deploy code with `RTA_PIPELINE_MODE` and `RTA_POSTING_MODE` unset.
6. ☐ Apply 0233–0236 (`migrate:all`); `check:rls`; checksum comparison.
7. ☐ Smoke: an import for a non-pilot firm takes the legacy path unchanged.
8. ☐ Workers' DB role: not superuser, not BYPASSRLS (`\du`).
9. ☐ Set `RTA_POSTING_MODE=controlled`, `RTA_PIPELINE_MODE=validate_first`,
   `RTA_POSTING_DATABASE=<name>`; restart web and workers. The global kill
   switch is still halted, no firm activated → nothing changes.

**Activation**

10. ☐ APPROVAL — activate the pilot firm: `validate_first`, `postingEnabled`,
    reason, change reference, requester + different approver, expiry date.
11. ☐ APPROVAL — release the global kill switch (two operators).
12. ☐ First file: a small daily feed. Check the batch, the ledger, `reconcile`
    = 0, the held screen, the eight-module figures.

**Running**

13. ☐ Daily: `reconcile`; held screen worked; SIP completeness and AUM cards read.
14. ☐ Any doubt: `halt --scope <firm>` (one operator) and investigate.
15. ☐ Recovery only by the §H procedure (halt → dry run → reverse with two people → reconcile).

**Exit**

16. ☐ APPROVAL — continue, widen, or revoke (`revoke`; firm returns to off).
