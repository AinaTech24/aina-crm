# Phase 3H — Final pilot blockers and Scheme Master integration

**Owner decision (2026-10-08):** Phase 3G accepted as a development milestone;
final pre-production corrections approved. **Nothing was merged, deployed,
migrated in production, switched on, or repaired.** Evidence comes from
disposable local databases (`rta_verify3h` — the real mailback files;
migration drill databases created and dropped by the drill script) and the
test database. Real files stay outside Git; aggregates only.

Status words used below: **PASS** (verified here, with evidence), **PARTIAL**
(verified in part; the gap is named), **FAIL** (verified not to meet the bar),
**UNVERIFIED** (could not be tested here; the operator check is named).

---

## A. The existing CRM Scheme Master — audit

One scheme reference exists, in three tables. No second master was created.

| Table | Scope / key | What it holds |
|---|---|---|
| `scheme_nav` (0034, 0151) | global; PK `scheme_code` = **AMFI scheme code** | AMFI daily NAVAll: `isin` (growth/payout; the parser falls back to the reinvest column when blank), `isin_reinvest`, `scheme_name`, `amc_name`, `scheme_type`, `scheme_category`, `nav`, `nav_date`. Overwritten daily — **no NAV history table** (history is fetched live from mfapi per request). |
| `scheme_master` (0000, 0026, 0027) | per firm; UNIQUE (tenant, `amc_code`, `scheme_code`) | The firm's copy, made by "Sync from AMFI" (`POST /api/schemes/sync`): `scheme_code` = AMFI code, `plan` regular/direct and `option` growth/idcw_* **derived from the name**, `category` / `sub_category` (both AMFI's category text), `coarse_category`, shortlist and suitability fields. **No ISIN, no NAV, no registrar code.** `amc_code` holds the AMFI AMC **name** (sync route), not a code. |
| `mf_schemes` (0088) | global; PK `scheme_code` (mfapi = AMFI code) | mfapi.in catalogue (growth ISIN only), enrichment for pickers. |
| `amc_master` | per firm; UNIQUE (tenant, code) | AMC list; no FK from `scheme_master.amc_code`. |

- **Matching functions found:**
  - `resolveSchemeIdentity` (`lib/rta/resolve-scheme.ts`, master path): ISIN, then exact normalised **name**, first match wins.
  - `lookupNav` (`lib/finance/scheme-match.ts`): code, then exact normalised name.
  - `schemeMatches` (`lib/proposals/execution.ts`): fuzzy token subset, blind to direct/regular and growth/IDCW.
  - Others: the commission reconciler, `syncable.ts` name keys, valuation's `canonFor`.
- **Screens:** `/dashboard/schemes` (Scheme Master), `/dashboard/mf-schemes` (catalogue), the shortlist report, and the `SchemeAutocomplete` pickers.
- **APIs:** `/api/schemes` (+ `[id]`, `evaluation`, `sync`), `/api/scheme-shortlist`, `/api/mf/schemes` (+ `[schemeCode]`), `/api/mf/amcs`.
- **How each table refers to a scheme today:**
  - `transactions`, `sips`, `rta_sip_registrations` and staging: text `scheme_code`. On the RTA paths this was the **registrar's product code**.
  - `sip_rejections`: `scheme_name` only.
  - Holdings legs (`folios.schemes` jsonb): AMFI code when the master path resolved it, else the registrar code.
  - The only FK to `scheme_master` anywhere is `portfolio_review_items.target_scheme_id`.
- **Duplicate / conflict risks found:**
  - A per-firm copy (~14k rows per firm).
  - The unique key includes the AMC *name*, so an AMFI AMC rename creates a second row for the same scheme code.
  - No uniqueness on ISIN or name in `scheme_nav` / `mf_schemes`.
  - `scripts/backfill-demo-nav.ts` inserted trigram-name "alias" rows into the **global** `scheme_nav` and rewrote units for every firm (fixed, §D).

**The canonical CRM scheme reference is therefore the AMFI scheme code**: the
key of `scheme_nav` and the `scheme_code` of `scheme_master`. A firm's
`scheme_master.id` is a per-firm copy of it, found by (firm, `scheme_code`), and
exists only after that firm runs "Sync from AMFI".

## B. CAMS / KFintech scheme codes — actual mapping results (real files)

| | CAMS | KFintech |
|---|---|---|
| Distinct registrar codes (AMC + product) | 164, 15 AMCs | 219, 23 AMCs |
| Codes for which the registrar printed an ISIN | **0** (R2, R9, WBR4, WBR10, WBR49 carry no ISIN column) | **219** (MFSD201 `ISIN`, MFSD203 `SchemeISIN`) |
| Codes with more than one ISIN | — | 0 |
| An ISIN on two registrar codes | — | 0 |
| A product code under two AMCs | 0 | 0 |
| Codes whose description differs between files | 0 | **31** (core name differs) + 40 (plan/option words only) |
| Plan / option stated | no | `Plan` holds registrar codes (gp, rg, ig, dp …), not direct/regular |

**Resolution to AMFI: UNVERIFIED here.** This environment's network policy
blocks `portal.amfiindia.com` and `api.mfapi.in`, so `scheme_nav` is empty. The
gated run therefore shows all 383 codes as "needs a decision".
- For the 219 KFintech codes, that is only because the feed is absent. Each has exactly one registrar ISIN, and resolves automatically once AMFI is loaded.
- For the 164 CAMS codes, it is a real gap: no core CAMS report prints an ISIN, so **a person must confirm each code once** (Scheme codes screen). The system checks a confirmation against any ISIN evidence and against the AMFI feed.

**Operator check:** load the AMFI feed (or run `scripts/refresh-nav.ts` where the
host is allowed), then count how many of the 219 KFintech codes resolve by ISIN.

**Design (smallest extension):** `scheme_rta_codes` (migration 0238).
- It is a per-firm crosswalk: (registrar, registrar AMC, registrar code) → the AMFI scheme code, with the evidence (ISINs seen, reports seen, the registrar's description) and a status (resolved_isin · confirmed · unresolved · conflict).
- It holds no names, plans, categories or NAVs of its own.
- **Never by name:** `decideScheme` (`lib/rta/scheme-resolution.ts`, pure, tested) uses only the registrar's ISIN or a person's audited confirmation. An ISIN is specific to AMC, plan and option, so this distinguishes all three.

## C. Scheme Master integration across the eight modules

| Module | Identifier before | Canonical reference now (validate-first path) | Missing / exception | Reporting effect |
|---|---|---|---|---|
| Client Master | folios: registrar AMC + folio; legs by code | legs carry `schemeCode` = AMFI code when resolved, `rtaSchemeCode`, `schemeStatus` | an unresolved leg keeps the registrar code | client identity is unaffected (folio-keyed) |
| Accurate AUM | registrar `sourceValue` (dated) + live-NAV by code **or name** | registrar value unchanged; live NAV only for resolved legs, **never by name** for an evidence-tracked leg (`revalueAllFolios`) | unresolved legs keep the registrar's dated value | the live-NAV figure excludes unresolved legs instead of mis-pricing them |
| Active SIP Book | `sips.scheme_code` = registrar code, `scheme_name` = the code | AMFI code + AMFI name + `rta_scheme_code`; with the gate on, an unresolved scheme is **not posted** to the book (`schemeUnresolved` count) | stays visible in the SIP Master | verified-only book stays verified-only |
| Client Portfolio | legs as above | as AUM | as AUM | per-scheme totals use one canonical code |
| SIP Rejection / Stop | `sip_rejections.scheme_name` only | + `scheme_code` (AMFI) + `rta_scheme_code` | — | rejections join to the scheme |
| Transactions | `scheme_code` = registrar code, `amc_name` = registrar AMC code | `scheme_code` = AMFI code, `rta_scheme_code` = registrar code, AMFI scheme and AMC names | **held** (`scheme_unresolved` / `scheme_conflict`) before writing, with the gate on | valuation / tax / statement joins on `scheme_nav` now match |
| Transaction Rejection | as Transactions | as Transactions | as Transactions | — |
| SIP Master | `rta_sip_registrations.scheme_code` (registrar) | + `amfi_scheme_code`, `scheme_status` | unresolved shown, not hidden | — |

- **The gate:** always on under `RTA_POSTING_MODE=controlled` (the pilot setting); `RTA_SCHEME_GATE=on` turns it on in development.
- **Exceptions:**
  - Scheme exceptions appear once per registrar code at `/dashboard/rta-imports/schemes`, with the number of transactions held on each code.
  - The held transactions are on `/dashboard/rta-imports/held`.
  - Confirming a code (`POST /api/rta-staging/schemes/:id/confirm`) audits `rta.scheme.confirm` and re-evaluates exactly the transactions held on that code.
- **Unchanged:** legacy firms keep their scheme behaviour. The name-based pricing and merges remain on the legacy path (reported, §L).

## D. Import entry points — matrix and fixes

| Entry point | Auth | Isolation | Controls now | Validate-first firm | Paused / halted / emergency | Test |
|---|---|---|---|---|---|---|
| Upload → queue → worker (`/api/rta-imports/upload`, reimport, rescan, retry/requeue scripts) | `transactions.execute` + unwalled book + licence | withTenant | worker regime check **before reading the file**; legacy tx re-checks inside its own transaction | validate-first only | **held**: job delayed, file kept, row says why; runs on resume | worker-db, infra 3G |
| Mail (S3 inbound, IMAP, held retry) | DKIM/DMARC + alias | alias → withTenant | same worker | same | same | infra 3G (mail) |
| Drop folder (`feed-ingest`) | operator FS | folder name must be a firm id | regime check | refused (recorded) | **file left in the inbox**, nothing recorded | controls-db, feed-and-scripts-db (no default folder, firm-id folders only) |
| SFTP ingest | env | `RTA_FEED_SFTP_TENANT_ID` must be a firm id | **fixed**: no hard-coded firm; simulation only with `RTA_FEED_SFTP_SIMULATE=1` outside production; no default `./feed-inbox` | as drop folder | as drop folder | feed-and-scripts-db (no simulation by default or in production; old hard-coded firm never written) |
| `scripts/import-rta-local.ts --commit` | DB creds | withTenant | regime check | refused | **refused (fixed: held fell through)** | — |
| Generic CSV (`/api/transactions/import/parse` + `commit`) | `transactions.execute` | withTenant | **write guard (bypass)** | **409**: upload the RTA file instead | 409 | entry-points-db |
| Reconciliation "Sync to CRM" (single, bulk) | `transactions.execute` | withTenant | **write guard (bypass)** | 409 | 409 | entry-points-db |
| Business matching (after import, nightly, script) | system | withTenant | **write guard (derived)** | runs | skipped | code path in `matchBookedBusiness` |
| Reconciliation scanner (SIP rejections from rejected txns, outbox events) | system | withTenant | **write guard (derived)** | runs (deduped) | skipped | — |
| Client merge / unmerge | owner / branch head | withTenant | **write guard (derived)** | allowed (the reviewed placeholder fix, §H) | 409 | entry-points-db |
| Manual identity resolution, scheme confirmation | `transactions.execute` + unwalled book | withTenant | posting gate | allowed | mapping saved; posting waits | validate-first-db, scheme-db |
| Reversal / undo CLI | DB creds + two people | withTenant | firm must be halted | — | required | recovery-db, drill |
| Operator controls | `platform.settings.manage` | system | one stops, two start | — | — | controls-db, entry-points-db |
| Scripts `reset-tenant-book`, `cleanup-ahpal-rta`, `repair-rta-placeholders`, `dedupe-*-sips`, `mark-sip-transfers` | DB creds | mixed (some raw pg) | **refuse when writing** for a stopped or validate-first firm (`scripts/lib/rta-script-guard.ts`) | refused | refused | feed-and-scripts-db (guard: paused and validate-first refused, explicit legacy allowed) |
| `backfill-folio-scheme-codes` (rewrites codes by NAME, all firms) | DB creds | withSystem | **skips governed firms**, refuses in an emergency | skipped | skipped | — |
| `backfill-demo-nav` | DB creds | withSystem | **fixed**: one named demo firm (`--tenant` = `DEMO_TENANT_ID`), never production, refuses a firm with registrar data | refused | refused | feed-and-scripts-db (no firm / production refused) |
| Nightly revaluation / AUM recompute | system | per firm | not RTA writes (NAV pricing); unresolved legs not priced by name | runs | runs | scheme-db |

**Not changed, reported:**
- The generic CSV import keeps working for non-pilot firms; whether it should exist at all is the firm's decision.
- Its 200-row preview vs. the full commit is a separate UI defect.

## E. Firm modes and the kill switch

| Mode | What runs | How it is set |
|---|---|---|
| **legacy** (`off`) | the existing importer | no activation (existing firms), or an explicit `off` activation — **two people**. `RTA_LEGACY_DEFAULT=deny` makes "no activation" held instead |
| **shadow** | legacy, plus staging validates the same file without posting | activation, two people |
| **validate_first** | only the new pipeline | activation with posting, two people |
| **paused** | **nothing**; jobs held, files kept | `pause` (one operator), or any revoked / expired activation |
| **firm halt** | nothing for that firm, every path | one operator halts; two release |
| **global posting halt** | the new pipeline stops (legacy firms unaffected) | installed halted; two release |
| **EMERGENCY** (`scope='emergency'`, 0237) | nothing for **any** firm — legacy, CSV, sync, scripts | one operator halts; two release |

**Held is not failed:**
- The worker puts the row back to `uploaded` with "Held — nothing was imported: … will import automatically when RTA imports resume".
- It keeps the file and re-checks every `RTA_HOLD_RECHECK_MS` (5 min).
- A configuration error (wrong ceiling, posting not enabled) is `validate_first_refused`: the import **fails visibly** and the file is kept.

**In-flight commits:**
- Every writer reads the control rows `FOR SHARE` inside its own transaction.
- A halt or emergency takes the global row `FOR UPDATE`, so it **waits for the transaction in flight and stops the next one**. Tested for a validate-first batch (controls-db) and a legacy write (emergency drill).
- A batch that the gate refuses at commit because a halt landed mid-run is held and resumes (worker).

**Tests:**
- `rta-posting-controls-db`: 12 cases — pause; revoke / expiry stays held; returning to legacy needs two people; ceiling refused; process halt held; firm halt waits for the in-flight batch; the write guard.
- `rta-validate-first-worker-db`: halted legacy firm and paused pilot firm held, file kept, run once after resume.
- `rta-emergency-drill-db`: run alone (`npm run test:emergency`, its own CI step) because it stops every firm in the database.
- `rta-entry-points-db`.

## F. Migration immutability (0233–0238)

- **Runner (`scripts/migrate-all.ts` + `scripts/lib/migration-plan.ts`):**
  - A changed applied migration or a missing applied file now **BLOCKS** (exit 2, nothing applied). The only exception is an exact, reasoned and approved pair in `drizzle/migrations/drift-acknowledged.json`, which goes through review.
  - Every attempt is logged in `_migration_runs`. A `no-transaction` file that died part-way is **PARTIAL** and blocks until `--resume <file>`.
  - `--check` is the release gate; `--until` builds an older database.
  - The ledger is never overwritten (`ON CONFLICT DO NOTHING`).
- **Repository lock:** `drizzle/migrations/checksums.lock.json` + `scripts/check-migration-lock.mjs` (in `check:migrations`, CI). A committed migration can't be edited, renamed or removed, and a new one must be locked.
- **History:** 0233 and 0234 were edited in later commits, and the dev database held earlier drafts of 0235/0236. All of this was on this unreleased branch, before any release. The new runner refused that dev database (2 blockers); it was brought in line by re-applying the committed, idempotent files.
- **Corrections in this phase are new files:** 0237 (modes), 0238 (scheme crosswalk).
- **Drill (`scripts/migration-immutability-drill.sh`, 14/14 PASS):** empty database full chain · no-op re-run · `--check` clean · kill switch installed halted · older database (up to 0232, with data) · changed checksum blocked with nothing applied · missing file blocked · partial attempt blocked then resumed · existing data unchanged by 0233+ · attempts logged · RLS and schema guards.
- **Lock risk:**
  - 0237: two constraint swaps on small control tables (one `NOT VALID`).
  - 0238: one new table, plus nullable column adds (catalogue-only), with `lock_timeout 5s`.
- **Rollback:** forward fixes only. Restore from backup for a failed release; flags off keeps the new objects unused.

## G. Financial reversal / restore drill (real files, `rta_verify3h`)

| Step | Result |
|---|---|
| Target | MFSD201 (May): 682 posted + 3 rejections recorded |
| Dependent | the same file re-delivered later: 685 "already posted" claims |
| Dry run | 685 transactions, 685 ledger rows, 1 SIP rejection; **blocked** — `laterBatchClaims 685` |
| Automatic reversal | **refused**; nothing changed (only the halt's audit row) |
| Reviewed order | re-delivery first (0 rows, 685 claims withdrawn), then the target (685 transactions, 685 ledger, 1 SIP rejection) |
| Changed by the reversal | transactions 2,410 → 1,725; ledger 2,410 → 1,725; SIP rejections 1 → 0; last-transaction dates; batch states; outcomes; audit |
| **Unchanged** | holdings and AUM (folio legs), holders, SIP registrations, SIPs, client ownership, business matches, outbox; the other 1,725 posted transactions |
| Reconciliation | 0 before, 0 after reversal, 0 after undo |
| Master-dated last-transaction dates | 713 before, 713 after reversal, 713 after undo — **the 3G defect (417 clients in that drill) does not recur** |
| Undo (target, then re-delivery) | every financial table, batch state and outcome **identical to the baseline**; only audit rows added (reverse 2, undo 2) |

**Dependencies that now block automatic reversal** (`ReversalDependencies`):
- a later unreversed batch's "already posted" claims;
- business matches decided from the batch;
- outbox events emitted for its transactions (messages may have gone);
- SIP rejections someone has worked.

**Also refused:** reversing a master or holdings batch. That is corrected by a newer statement or a restore.

**Tests (recovery-db, 10):** blocked then reviewed order; undo restores claims; outbox and worked rejections block; master batch refused; nightly reconciliation alert.

**Backup / restore:** drilled in 3G (fingerprints identical, RLS intact); unchanged here.

## H. Minor, HUF and placeholder identity

- **The nine held transactions** (adverse order): 6 SIP and 3 purchases, ₹22,998.86, on **7 folios**, all on PAN-less placeholders.
  - Why: the holdings file (MFSD203, no guardian detail) arrived before the master. The master row then matched a folio already on record, so **no minor record exists**. In production order the same folios belong to `MINOR:` clients.
  - **Manual workflow, verified on the real data:** a person records the minor's client, merges the placeholder into it (audited, 7 merges), and held transactions are re-evaluated. Result: **9 / 9 posted, 9 / 9 to the same owner as production order, hold history kept on all 9, 7 / 7 tasks closed, 7 / 7 folios on the minor.** Nothing of this runs automatically.
- **Cross-registrar minors:** 3 registrar-scoped `MINOR:` keys, each with a same-name minor at the other registrar. They are **kept separate** (0 merged) — never merged by name or guardian PAN.
- **Other identity checks:**
  - 23 `MINOR:` keys and 25 placeholders in total.
  - HUF: 9 clients, 0 Karta holder rows. A Karta is never an owner (owner.ts rules, unchanged).
  - 0 folio numbers at two AMCs.
  - 31 guardian and 196 joint current holder rows.

## I. SIP registrations — reconciled counts (mutually exclusive)

| Kind | State | Confidence | Count | Monthly ₹ | In SIP book |
|---|---|---|---|---|---|
| SIP | VERIFIED_ACTIVE | verified | 4 | 9,000.00 | 4 |
| SIP | PENDING | verified | 5 | 9,500.00 | 5 |
| SIP | OBSERVED_ACTIVITY | partial | 312 | 19,96,050.47 | 0 |
| SIP | UNKNOWN | partial | 1,547 | 78,73,510.27 | 0 |
| SIP | UNKNOWN | unverified | 14 | 34,050.00 | 0 |
| STP | VERIFIED_ACTIVE | verified | 1 | 5,000.00 | 0 |
| STP | OBSERVED_ACTIVITY | partial | 15 | 98,796.11 | 0 |
| STP | UNKNOWN | partial | 29 | 3,96,452.63 | 0 |
| STP | UNKNOWN | unverified | 4 | 29,000.00 | 0 |
| SWP | UNKNOWN | partial | 4 | 16,292.05 | 0 |
| **Total** | | | **1,935** | | **9** |

**The 52:**
- The 3G report's "verified 10" counted the STP. Its "observed 312" and "unknown 1,561" were SIPs only.
- 1,935 − (10 + 312 + 1,561) = **48 STP** (15 observed + 33 unknown) **+ 4 SWP**.
- STP and SWP amounts are never added to the SIP book.
- **Active SIP Book = 4 verified-active SIPs, ₹9,000 a month**, with the status dates and per-registrar/ARN coverage shown in the completeness panel.

**Smallest reports:**
- What exists now (MFSD243 10-01…10-07, WBR49 10-02, MFSD230 without status) covers only recent registrations.
- One run of **MFSD243 and WBR49 over the full registration range** is the smallest set that could close the status gap. A sample of each is still needed to confirm that they state a current status for old registrations.
- No other report is required.

## J. Pilot infrastructure readiness

| Item | Status | Operator validation required |
|---|---|---|
| AWS S3 bucket and access policy | **UNVERIFIED** | `docs/deploy-aws.md` uses an `AdministratorAccess` IAM user "tighten later". Before the pilot, the app role should hold only `s3:PutObject` / `GetObject` / `DeleteObject` on `tenants/*/rta/*` and `rta-inbound*/*`, plus `ListBucket` on those prefixes. Bucket: block public access, SSE (KMS or S3), versioning or lifecycle per retention. Check with IAM policy simulator. |
| SES inbound authentication and routing | **UNVERIFIED** (locally: stored MIME mail via the real poller, 3G) | A receipt rule writes to the bucket the poller reads. Our own receiving server must record `Authentication-Results`. Send one real registrar mail to the firm alias and confirm DKIM/DMARC pass, routing and import; send one from a non-registrar sender and confirm quarantine. |
| Redis and worker restarts | **PARTIAL** (local Redis: outage, restart, crash and retry, 3G) | Production Redis is on-box (no persistence settings reviewed). Confirm AOF or RDB is on, or accept job loss on box loss (`requeue-rta-files.ts` recovers uploaded rows). Restart the worker container during an import and confirm the hold / lease / retry behaviour. |
| Restricted PostgreSQL role | **PARTIAL** — gate refuses superuser / BYPASSRLS (tested); `provision-app-role.mjs` exists | On the pilot database: `\du` shows the app role without `rolsuper` / `rolbypassrls`; the workers' `DATABASE_URL` uses it. `docs/deploy-aws.md` still tells operators to run `db:push` on a fresh RDS — **stale and contrary to the repo's rule**; use `migrate:all`. |
| RLS enforcement | **PASS** locally (`check:rls` 187 tables; restore drill) / **UNVERIFIED** on RDS | Run `npm run check:rls` against the pilot database. |
| PAN-token key custody | **UNVERIFIED** | `RTA_STAGING_TOKEN_KEY` (64 hex), separate from `ENCRYPTION_KEY`, in the secret store, not in `.env` on disk. Rotation re-tokenises staging (no procedure written; tokens are not used for posting identity). Decide owner and rotation cadence. |
| Holder data permissions and retention | **PARTIAL** — `folio_holders` RLS-isolated, tokens and masks only | No retention rule exists. Decide retention for closed holder rows and staging (`rta_staging_rows` keeps masked attributes). |
| Monitoring and reconciliation alerts | **PARTIAL** — **added**: nightly `reconcilePostingFirms` (daily ops) raises `captureError` plus an audit `rta.posting.reconcile_alert` | Wire the error sink to on-call. Watch `[rta-import] job failed` and held-job age. |
| AMFI / NAV feed reachability | **FAIL here** (blocked by this environment's policy) / **UNVERIFIED** in production | Confirm the production host reaches `portal.amfiindia.com` and `scheme_nav` holds ≥ 1,000 rows (`NAV_FEED_MIN_RECORDS`) before activation. **Without it, every pilot transaction is held** (§B). |

## K. Eight-module pilot acceptance

| Module | Source data | Scheme mapping | Client / folio identity | Financial calc reconciled | API output | Browser UI | Operational data complete | Pilot ready | General release |
|---|---|---|---|---|---|---|---|---|---|
| Client Master | PASS (R9, MFSD211, MFSD203, WBR4) | PARTIAL (legs evidence-only; AMFI resolution UNVERIFIED) | PASS (0 two-owner folios; minors / HUF rules; manual path verified) | n/a | PASS (DB tests) | PASS (3F/3G) | PARTIAL (25 placeholders, 23 minors to review) | PARTIAL | FAIL |
| Accurate AUM | PASS | PARTIAL (live NAV only for resolved legs) | PASS | PARTIAL (KFintech ₹14,67,10,680.68; CAMS mixed / partial) | PASS | PASS (3G) | FAIL (no current CAMS full book) | FAIL | FAIL |
| Active SIP Book | PASS (MFSD243, WBR49, MFSD230) | PARTIAL (gate holds unresolved) | PASS | PASS (4 / ₹9,000 = book) | PASS | PASS (completeness panel) | FAIL (10 of 1,935 verified) | PARTIAL | FAIL |
| Client Portfolio | PASS | PARTIAL | PASS | PASS (0 clients differ) | PASS | PASS (3G) | PARTIAL (588 clients warned) | PARTIAL | FAIL |
| SIP Rejection / Stop | PASS | PASS (code + canonical kept) | PASS | PASS (3 refused, 0 in business) | PASS | PASS | PARTIAL (no authoritative stop source) | PARTIAL | FAIL |
| Transactions | PASS (R2, MFSD201) | **FAIL until AMFI loaded and CAMS codes confirmed** (2,410 held under the gate) | PASS | PASS (ledger = CRM; idempotent; reversal drill) | PASS | PASS (Held, Scheme codes screens) | PARTIAL (34 held: 16 unsupported, 18 corrections) | **FAIL** (blocked by scheme mapping) | FAIL |
| Transaction Rejection | PASS | as Transactions | PASS | PASS | PASS | PASS | PARTIAL (no CAMS rejection sample) | FAIL (as Transactions) | FAIL |
| SIP Master | PASS | PARTIAL (`scheme_status` recorded) | PASS | n/a | PASS | PASS | FAIL (1,561 SIPs unknown) | PARTIAL | FAIL |

## L. Exact blockers to single-tenant activation

**Data / evidence**
1. **AMFI feed on the pilot host** (`scheme_nav` loaded, ≥ 1,000 rows). Without it every transaction is held.
2. **164 CAMS scheme codes confirmed by a person** (once), or a CAMS report that prints the ISIN (none known; not invented).
3. A **current CAMS full-book statement** (R9) for every ARN, for a firm AUM total.
4. **MFSD243 and WBR49 over the full registration range** (plus one sample each to confirm they state a status).
5. A CAMS rejection sample; registrar documentation for 14 unknown codes.

**Software (open)**
6. `transactions` UNIQUE(tenant_id, order_id): a registrar number reused at another AMC cannot be stored (held, not lost). The schema change needs approval.
7. Legacy-path scheme behaviour (name fallback in `resolveSchemeIdentity` / `lookupNav` / `schemeMatches`) for non-pilot firms. Out of pilot scope; reported.
8. `scheme_master` uniqueness keyed by AMC name (duplicates on an AMC rename). A unique (tenant, scheme_code) index needs a reviewed de-duplication first.

**Historical**
9. Run `rta-historical-diagnostics.ts` read-only on the production database for the pilot firm; review placeholders, `MINOR:` keys and guardian folios with the firm.
10. Run `migrate:all --check` on a copy of production: it now blocks on any edited applied migration. Resolve by acknowledgement or forward migration, never by editing.

**Operational configuration** — §J items: S3 policy, SES rule, Redis persistence, app role, token key, alerts. Also correct `docs/deploy-aws.md`'s `db:push` step.

**Regulatory / privacy**
- PAN-token key custody and rotation.
- Retention of holder and staging data.
- Who may confirm scheme codes and merge placeholders (today: `transactions.execute` / owner or branch head).

### Pilot activation checklist (supersedes the 3G list where they differ)

1. ☐ APPROVAL — the pilot firm, dates, two named operators.
2. ☐ Backup; a restore rehearsed on a copy.
3. ☐ `migrate:all --check` on a production copy → 0 blockers.
4. ☐ Diagnostics read-only on production for the pilot firm.
5. ☐ AMFI feed loaded on the pilot host; the scheme count checked.
6. ☐ Deploy with pipeline settings unset; apply 0233–0238; `check:rls`.
7. ☐ Smoke: a non-pilot firm takes the legacy path unchanged.
8. ☐ App role without superuser / BYPASSRLS; token key in the secret store.
9. ☐ `RTA_POSTING_MODE=controlled`, `RTA_PIPELINE_MODE=validate_first`, `RTA_POSTING_DATABASE`; restart.
10. ☐ APPROVAL — activate the firm (two people); release the global posting switch (two people).
11. ☐ Masters first (R9 full book, MFSD211, MFSD203), then registrations, then transactions.
12. ☐ Scheme codes screen: KFintech resolved by ISIN; **CAMS codes confirmed by a person** — then the held transactions post.
13. ☐ Daily: nightly reconciliation alert clear; Held and Scheme codes screens worked.
14. ☐ Any doubt: `pause` (one operator) or `halt --scope <firm>`; recovery only by the reviewed reversal order.
15. ☐ APPROVAL — continue, widen, or return to legacy (an explicit `off` activation, two people).
