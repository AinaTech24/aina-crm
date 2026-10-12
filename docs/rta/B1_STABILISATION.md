# B-1 stabilisation and final release qualification (2026-10-12)

The owner accepted the B-1 integration direction (candidate `f61d202`) for
development and asked for stabilisation before any release-candidate decision.
This records what was changed, what was proved, and what is still open.
**Development only. Nothing was deployed or migrated in production. No live
posting, no historical repair, no investor merge, no tag moved or created.**

Real registrar files were used only on disposable local databases and were
never committed. Figures are aggregates; no PAN, name or folio is printed.


## A. Owner decisions I-1 – I-4: verified on the candidate

| Decision | What the code does | Proof |
|---|---|---|
| **I-1 PAN-less placeholder folio** — hold | `AUTO_REASSIGN_FROM_PLACEHOLDER = false`; a master naming a PAN for a folio held by an import placeholder is held with category *identity_review* ("import placeholder — needs review"), the folio and its history untouched. A person resolves it by merging the placeholder into the client (Merge Clients — audited, `investor_merges` row); the retry then imports with no exception and a re-run adds nothing. | `tests/rta-ownership-resolution-db.test.ts` (I-1) |
| **I-2 Duplicate live PANs** — hold | Two live clients with one PAN: the row is held ("2 different clients"), neither is chosen, nothing is merged. After a person merges them, the retry posts once, to the survivor. Minor / guardian and HUF / Karta keep their own rules (a guardian's or Karta's PAN never makes them the owner — unchanged release rules, tests in 3E–3H). | same file (I-2) |
| **I-3 Folio filed under another real client** — refuse | Held on every re-run, feed and master alike; the folio's owner and its transactions unchanged; nothing assigned to the other client. Resolution is a person's (correct the record, then re-import). | same file (I-3) |
| **I-4 Headerless AUM / SIP files** — conditional | See §E. No registrar defines a headerless layout; the candidate refuses such a file with `RtaLayoutError` (import `failed` with its reason, file kept). It also reads a real file whose header is NOT on line 1, which `main` silently imported as 0 rows. | `docs/rta/handover/b1-headerless-impact-check.sql`; §E |

All three identity holds reach the Exceptions page in an actionable category
(`identity_review`), with the client and folio shown to staff and the PAN
masked; `tests/rta-b1-integration.test.ts` checks each message's category.

**Defect found and fixed:** the 99 real KFintech folio-correction rows fell
into the "technical" category (no action). They now land in
`registrar_correction` ("held, nothing posted — no re-upload needed").

## B. I-6 — infrastructure harness: **42 / 42 meaningful passes on the final tree**

`scripts/rta-infra-check.ts` now seeds a clearly labelled synthetic fixture —
"Infra Synthetic Mutual Fund (TEST FIXTURE)", two schemes with synthetic ISINs,
a synthetic AMFI feed row (`amfi_feed_imports.note` says it is not AMFI data) —
and verifies the CAMS AMC and scheme mapping through the real two-person
control requests. It runs a real `next dev`, real Chromium, a moto S3 store,
Redis and separate worker processes (killable). Each check records what was
exercised, expected vs actual committed rows, database deltas, reconciliation
and evidence in a JSON report; **no check can pass with zero rows posted**
(every posting check asserts its exact count, e.g. +20,000 of 20,000).

Added beyond the original 35: database lost DURING posting (the posting
connection terminated mid-INSERT → 0 rows visible → re-import posts exactly
5,000 of 5,000), emergency halt and two-person resume (the parked file imports
once), no wrong-client posting, firm two unchanged by firm one's activity, both
firms' ledgers reconciled (five checks 0, ledger = transactions, no registrar
number twice).

| # | Check | Result (last run) |
|---|---|---|
| 1 | browser: the upload dialog sends the file through presign → S3 → queue → worker → database | PASS — HTTP 200, import completed |
| 2 | browser: the dialog shows the outcome | PASS — 4 outcome elements |
| 3 | browser: no uncaught page errors | PASS —  |
| 4 | CSV (KFintech MFSD201) posts through the queue | PASS — completed, 3 |
| 5 | XLSX (CAMS R9 master) is read as a workbook and posts | PASS — completed Validate-first: 1 folio(s) committed, 0 held (see the staging exceptions). Counts are folios, not file rows. |
| 6 | XLS (CAMS R2 BIFF8) posts | PASS — completed, 1 |
| 7 | password-protected ZIP opens with the supplied password and posts | PASS — completed, 1 |
| 8 | a ZIP holding two data files is refused, never half-read | PASS — failed: The archive holds 2 data files (MFSD201_zip.csv, second.csv) — this importer reads one file per uplo |
| 9 | the same file again adds nothing | PASS — completed, imported 0 |
| 10 | an overlapping file posts only what is new | PASS — completed, imported 1 |
| 11 | two firms in parallel: firm one posts | PASS — completed |
| 12 | two firms in parallel: firm two holds its transactions (no master yet) — same numbers, no cross-firm effect | PASS — failed, Validate-first: 0 committed, 0 already in the CRM, 2 held (see the staging excep |
| 13 | master after transactions: its arrival posts the held transactions (no re-upload) | PASS — completed, T2 transactions 2 |
| 14 | tenant isolation: firm two sees only its own rows | PASS — 0 cross-firm rows |
| 15 | crash drill: the worker was killed mid-staging | PASS — leased true, status parsing |
| 16 | after the crash the queue retries, the lease expires, the batch resumes and completes | PASS — completed Validate-first: 20000 committed, 0 already in the CRM, 0 held (see the staging e |
| 17 | after the crash every transaction is posted exactly once | PASS — +20000 of 20000, ledger 20008, reconcile 0 in 207 ms |
| 18 | Redis down: the upload is refused or recorded as not queued — never a silent loss | PASS — HTTP 503, row failed |
| 19 | Redis back: the same file imports normally | PASS — completed |
| 20 | S3 unreachable: the import fails with a recorded reason (BullMQ retried it), nothing posted | PASS — failed |
| 21 | S3 unreachable: the uploaded file is kept for the retry | PASS —  |
| 22 | S3 back: re-import of the kept file completes | PASS — HTTP 200, completed |
| 23 | database unreachable then back: the job is retried and posts once | PASS — completed, 1, worker restarts 2 |
| 24 | database lost during posting: the posting transaction rolls back whole | PASS — 1 posting connection(s) terminated, 0 rows visible |
| 25 | database lost during posting: the retry posts every transaction exactly once | PASS — completed via operator re-import, 5000 of 5000 |
| 26 | emergency halt: a file arriving during the halt is parked and nothing is written | PASS — uploaded: Held — nothing was imported: posting is halted for all firms: infra ch |
| 27 | resume: after a two-person release the parked file imports by itself, once | PASS — completed, 1 |
| 28 | a user without the import capability cannot get an upload URL | PASS — HTTP 403 |
| 29 | another firm's import is not found | PASS — HTTP 404 |
| 30 | an upload naming another firm's storage key is refused | PASS — HTTP 403 |
| 31 | a firm owner cannot use the operator controls | PASS — HTTP 401 |
| 32 | a user without the import capability cannot resolve held transactions | PASS — HTTP 403 |
| 33 | mail: the poller read all three stored mails from S3 | PASS — {"processed":3,"held":2,"failed":0} |
| 34 | mail: the trusted registrar mail is routed by alias to its firm and imported through the queue | PASS — 1 posted |
| 35 | mail: forged and unroutable mail are held (kept, retried), never imported | PASS — 2 held |
| 36 | privacy: no PAN in worker or server logs | PASS — 0 found, 64619 bytes scanned |
| 37 | privacy: staging holds no PAN (keyed tokens only) | PASS — input PANs found 0, PAN-shaped values outside keyed columns 0 |
| 38 | privacy: import remarks and errors are PAN-masked | PASS — 0 |
| 39 | every import reached a final status (none left parsing / queued) | PASS — [{"status":"failed","n":3},{"status":"completed","n":16}] |
| 40 | no wrong-client posting: every transaction belongs to its folio's owner, and folio 98000001's to PAN holder a1 | PASS — 0 off-owner, 0 of 25012 on another PAN |
| 41 | no unexpected tenant modification: firm two unchanged by everything firm one did after its own imports | PASS — {} |
| 42 | ledger reconciles for both firms: five checks 0, ledger = transactions, no registrar number twice | PASS — firm one 25013/25013, firm two 2/2 |

**Application defect found and fixed (necessary safety scope):**
`reconcilePosting`'s "validate-first transaction without a ledger row" probe
did not name the firm inside its `NOT EXISTS`, so Postgres could not use
`(tenant_id, transaction_id)`; at 20,000 rows it took 6 s and grew
quadratically, past the 30 s `statement_timeout` — the nightly reconciliation
would have failed on a production-sized firm. The probe now names the firm; the
same check reads 207–226 ms after 20,000 rows. A static test asserts every ledger
probe in `reconcilePosting` names `p.tenant_id`.

**Behaviour recorded, not changed:** a posting connection killed mid-batch
rolls back whole and the import is recorded `failed` with its reason; the
operator's re-import posts it once. There is no automatic retry for that case
(BullMQ's retry covers a worker that dies; the validate-first commit treats a
lost transaction as a failure to report). The harness also models the
production restart policy (`restart: unless-stopped`): a worker that refuses to
start while the database role cannot log in is restarted, and the job posts
once when the database returns.

Harness defect fixed: a run that crashed left its worker processes running
(one kept running against the scratch database for 30 minutes); the harness now kills
every worker it spawned on exit.

## C. I-7 — intermittent tests: **fixed; 5 consecutive clean full-suite runs on each of three successive trees (15 in all), and the CI configuration green**

**Cause (exact shared state).** `loadDecisionContext`
(`src/lib/rta/scheme-resolution.ts`) read a firm's registrar codes with no
`ORDER BY`. Applying an AMFI feed or an operator approval re-decides every
firm's codes (`redecideEverywhere`), which rewrites `scheme_rta_codes` rows of
OTHER test files; the rewritten rows move in the heap, the unordered read
returns them in a different order, and the "same top suggestion" warning listed
the codes in that order. Three DB test files write the global AMFI reference
(`amfi_feed_imports`, `scheme_nav`, `scheme_registrar_map`,
`registrar_amc_identity`) in parallel.

**Fix.** (1) The read is ordered (`rta, rta_amc_code, rta_scheme_code`) —
product code, a deterministic warning for operators too. (2) The three files
hold one session advisory lock for their whole run
(`tests/helpers/global-amfi-lock.ts`), so they run one after another while the
rest of the suite stays parallel; a crashed file releases it with its
connection. (3) The AMC-identity test now updates the two rows (moving them in
the heap) and asserts the warning text is identical — with the `ORDER BY`
removed, this assertion fails deterministically (mutation-checked).

Two further intermittent failures surfaced during the repeated runs and were
fixed the same way:

- `rta-reconciliation-alerts-db` picked a random year (2031–2090) for its
  reconciliation slots; two runs on one database drew the same year and
  collided with the previous run's recorded slots (5 failures in one run). It
  now starts after the newest slot already recorded.
- `rta-fs8-redis-cancel-db` picked a random port in 6300–6899 for its
  private Redis, which could hit a Redis already listening (6390 here). It now
  asks the OS for a free port.

**CI's own configuration found two more failures** that the superset
environment hid (it sets `ADMIN_DATABASE_URL`): the `as any` ratchet
(`main` 3,385 and the release 3,421 are each under the 3,429 baseline, the
union was 3,435 — seven casts in release code typed, baseline not raised) and
`tests/runtime-db-role-db.test.ts`, which parsed the database URLs in its
`describe.skipIf` body; vitest runs that body to collect it, so without
`ADMIN_DATABASE_URL` the file crashed — also on the tagged release. Both fixed
in `aab763c4`.

No test was skipped or disabled and no timeout was raised.

| Run | Result |
|---|---|
| earlier attempt, before the two extra fixes · runs 1–5 | 4 passed; run 4: 5 failures in `rta-reconciliation-alerts-db` (slot-year collision, fixed) |
| stabilised tree `fb3d4c66` · run 1 | pass — 107 files (1 skipped: the emergency drill, run alone) · 1,135 tests passed, 2 skipped |
| stabilised tree `fb3d4c66` · run 2 | pass — 107 files (1 skipped: the emergency drill, run alone) · 1,135 tests passed, 2 skipped |
| stabilised tree `fb3d4c66` · run 3 | pass — 107 files (1 skipped: the emergency drill, run alone) · 1,135 tests passed, 2 skipped |
| stabilised tree `fb3d4c66` · run 4 | pass — 107 files (1 skipped: the emergency drill, run alone) · 1,135 tests passed, 2 skipped |
| stabilised tree `fb3d4c66` · run 5 | pass — 107 files (1 skipped: the emergency drill, run alone) · 1,135 tests passed, 2 skipped |
| stabilised tree `fb3d4c66` · emergency | pass |
| merged tree `d15e61aa` · run 1 | pass — 108 files (1 skipped: the emergency drill, run alone) · 1,190 tests passed, 2 skipped |
| merged tree `d15e61aa` · run 2 | pass — 108 files (1 skipped: the emergency drill, run alone) · 1,190 tests passed, 2 skipped |
| merged tree `d15e61aa` · run 3 | pass — 108 files (1 skipped: the emergency drill, run alone) · 1,190 tests passed, 2 skipped |
| merged tree `d15e61aa` · run 4 | pass — 108 files (1 skipped: the emergency drill, run alone) · 1,190 tests passed, 2 skipped |
| merged tree `d15e61aa` · run 5 | pass — 108 files (1 skipped: the emergency drill, run alone) · 1,190 tests passed, 2 skipped |
| merged tree `d15e61aa` · emergency | pass |
| final tree `aab763c4` · run 1 | pass — 108 files (1 skipped: the emergency drill, run alone) · 1,190 tests passed, 2 skipped |
| final tree `aab763c4` · run 2 | pass — 108 files (1 skipped: the emergency drill, run alone) · 1,190 tests passed, 2 skipped |
| final tree `aab763c4` · run 3 | pass — 108 files (1 skipped: the emergency drill, run alone) · 1,190 tests passed, 2 skipped |
| final tree `aab763c4` · run 4 | pass — 108 files (1 skipped: the emergency drill, run alone) · 1,190 tests passed, 2 skipped |
| final tree `aab763c4` · run 5 | pass — 108 files (1 skipped: the emergency drill, run alone) · 1,190 tests passed, 2 skipped |
| final tree `aab763c4` · emergency | pass |
| CI configuration (`ci.yml`, Node 20.20.0, only the workflow's env), final tree | quality: tsc, check:rbac, check:migrations, check:calc, check:colors, check:asany, check:mathimports, `npm test` (932 passed, 260 skipped — no database), lint: **all exit 0**; db-checks on a fresh database: migrate:all (283), check:rls (189 tables), provision-app-role, `npx vitest run` **108 files, 1,176 passed, 16 skipped**, test:emergency **pass** |
| CI configuration, first attempt (merged tree before `aab763c4`) | **failed twice — both fixed in `aab763c4`** (see below) |
| Guards and builds, final tree | `tsc` 0 errors; lint, check:rbac / rls / migrations / schema / colors / asany (3,428 ≤ 3,429) / mathimports / calc / finance / spine / sql / labels all exit 0; `migrate-all --check` 283 applied, 0 pending, 0 blockers; immutability drill 0 failures; `build:check` (production `next build`, with the Dockerfile's build-time placeholders) exit 0 |

## D. The 39 KFintech transactions `main` posts and the candidate holds

Legacy importer, the two real KFintech MFSD201 files (May, Oct) after the
masters, `main` vs candidate on fresh databases: `main` 1,100 transactions,
candidate 1,061; **39 missing from the candidate, 0 extra**.

| Category | Txns | Source rows | Clients | Folios | Registrar amount | `main` stored | Dates | Registrar codes | Exceptions page |
|---|---|---|---|---|---|---|---|---|---|
| Multi-lot redemption (one registrar number reported lot by lot) | 16 | 343 | 10 | 14 | ₹25,32,603.26 (48,469.24 units) | ₹2,59,383.24 (20,624.81 units) | 05-May – 07-Oct-2026 | FUL, LTOF, RED | `txn_conflict` |
| Folio correction (original, R-coded reversal, re-post) | 22 | 103 | 1 | 2 | ₹1,47,868.30 (2,472.13 units) | ₹1,25,333.72 (1,485.55 units) | 29-Jan-2024 – 01-Oct-2026 | CNI, CNO, FUL, FULR, NEW, NEWR, SIN, SINR | `registrar_correction` (was "technical") |
| Unknown transaction code | 1 | 1 | 1 | 1 | ₹99,995 | ₹99,995 | 06-Oct-2026 | IPO | `unsupported_txn` |
| **Total** | **39** | **447** | **12** | **17** | | **₹4,84,711.96** | | | |

- **Identity**: 1 minor (a multi-lot redemption), 0 HUF, 0 PAN-less, 0
  placeholder, 0 conflicting owner. `main`'s owner equals the candidate's
  folio owner in **39 / 39** — `main` did not assign any of them to a wrong
  client. What `main` got wrong is the AMOUNT: it keyed rows by registrar
  number, so the last lot of a redemption overwrote the others (₹2.59 lakh
  stored for ₹25.33 lakh redeemed), and it posted a correction's reversal legs
  as ordinary business.
- **Nothing disappears silently**: every source row is accounted for —
  May 819 = 676 unchanged + 143 held, Oct 689 = 385 + 304, each held row with
  its recorded reason (143 + 304 reasons). Source files are kept.
- **Under validate-first** (the pilot path) the 15 multi-lot redemptions in the
  pilot manifest post as ONE transaction each with all 340 lots kept; the
  corrections are `correction_held`; the unknown code is `unsupported` on the
  held-transactions screen.
- **Resolution**: multi-lot — none needed under validate-first; on the legacy
  path they stay held (never merged on amount / units). Corrections — wait for
  the registrar's folio move to be posted (no action, no re-upload). Unknown
  code — Operations confirms the transaction with the registrar; a code meaning
  is added only from a registrar document or a real sample.
- No posting, merging or repair was done.

## E. Headerless AUM / SIP reports — `main` vs candidate

`main`'s readers take line 1 as the header only when it names a folio, PAN or
mandate column; otherwise every line is read by a fixed column order
(`DEFAULT_SIP_BOOK_MAP`, `DEFAULT_AUM_STATEMENT_MAP`, added 2026-09-28 in
`252e10b7` with no registrar source). The candidate finds the header by alias
in the first 10 lines and refuses a file without one.

| Report | Source definition | Header in real file | `main` with header | `main` header removed | `main` title line(s) above header | Candidate | Safe positional parse? | Disposition |
|---|---|---|---|---|---|---|---|---|
| CAMS WBR49 SIP registrations | CAMS mailback; header row | yes (line 1) | 1 row ₹1,500 | 1 row, amount ₹0 | **0 rows, completed** | 1 row ₹1,500 in every case with a header; refused without | no | header required |
| KFintech MFSD243 SIP/STP/SWP registrations | KFintech MIS; header row | yes | 9 rows ₹22,000 | 9 rows on 1 folio, amount ₹30,76,80,77,63,221 (≈ ₹3 lakh crore) | **0 rows, completed** | 9 rows ₹22,000; refused without | no | header required |
| KFintech MFSD230 SIP/STP report | KFintech MIS; header row | yes | 20 rows ₹68,050 | ARN read as folio 20/20, 17 zero amounts | **0 rows, completed** | 20 rows ₹68,050; refused without | no | header required |
| AUM statement (CAMS-style row) | registrar statements carry headers | yes | correct | folio = product code, wrong PAN, value 100.5 for ₹50,250 | — | refused without | no | header required |
| The CRM's own positional order (PAN, folio, code, name, amount …) | none — invented in `252e10b7` | n/a | — | 1 row ₹5,000 | — | refused | not independently validated | hold (refuse with reason) |

**No genuine headerless layout exists to preserve.** The only file `main`
reads correctly without a header is one in the CRM's own invented order, which
no registrar is documented to produce; every real file read without its header
is corrupted (and `main`'s own comments record two such incidents). Real files
with a title line above the header — which `main` imports as zero rows while
reporting success — are read correctly by the candidate.

**Impact on firms and automated imports** cannot be measured from this
sandbox: production's `rta_file_imports` and stored files are needed.
`docs/rta/handover/b1-headerless-impact-check.sql` (read-only, counts and firm
ids only) lists every AUM / SIP-book import per firm, source (upload / mail)
and month, and the folio symptoms a positional mis-read leaves (ARN-, PAN- or
code-shaped folio numbers); infra then checks the first 10 lines of those
stored objects. Mail-routed SIP / AUM reports go through the same readers, so
an automated feed without a header would now be recorded `failed` with its
reason instead of imported.

## F. Migrations and the reverted 0240 ledger entry

**`main` moved during stabilisation.** `88bc0178` (client master by client
type) was pushed to `main` — which deploys — at 14:28 IST on 2026-10-12, with
migration `0233_client_type_details.sql`. A candidate without it would remove
that feature from production and fail the ledger check, so it was merged
(`d15e61aa`; two import-line conflicts, §I).

| Check | Result |
|---|---|
| `main`'s 271 migration files in the candidate | byte-identical (`git diff origin/main HEAD -- drizzle/migrations/` adds 12 release files and the lock, changes nothing) |
| Release migrations `0233_rta_staging` – `0244` | unchanged since `c26e676`; the only migration change since then is the added `0233_client_type_details.sql` |
| `checksums.lock.json` | one entry added by `--add` (`0233_client_type_details.sql 1231d8f2e440972a`), no entry changed; 283 files match |
| Duplicate prefix `0233` | both files must keep their names (one is applied in production, the other is locked); grandfathered in `check-migration-dups` with its rationale, as `0195` was. Fresh order: `client_type_details` (adds a column to `investors`) then `rta_staging` (new tables) — independent |
| Upgrade from a `main` 88bc0178-state database (built by `main`'s own runner: 271) | `migrate:all --check` exit 0, 12 pending, 0 blockers; upgrade applied 12 |
| Fresh database (candidate) | 283 applied |
| Fresh vs upgraded | schema dumps identical (only `pg_dump`'s session nonce differs); ledger digest equal `eb49785a924cc2e31b2dc4d2e0b2b4f9`; 791 indexes each; `check:rls` 189 tenant tables, all enabled + forced + policy |
| Ledger digests | `main` a16628c5 (270) `d81993198b6288513fe6913400b7966c` · `main` 88bc0178 (271) `9d53e5c78c2d79f7b29eea0d4d8e0065` · candidate (283) `eb49785a924cc2e31b2dc4d2e0b2b4f9` |
| Fingerprints (final tree) | lock SHA-256 `9a2fb53fbab7967a4dc6f304bcd5ba542a91de0dc7a74d172d6e80581fe3ef49`; all `.sql` concatenated `b2b6d0269139bd1efc3e6b63d55ad09323b1a8336cac88221774634c8c450e23`; `drizzle/migrations` tree `4a66501e6aa6f6a64724eff26a23687e6cfd872b` |

**The reverted `0240_aum_month_end.sql`.** It was added to `main` and removed
on 2026-10-08; a production database that ran it in between carries a ledger
row for a file no tree ships. The candidate's runner refuses such a ledger
(missing file → blocker, `migrate:all --check` exit 2). The DBA query
`docs/rta/handover/b1-production-ledger-check.sql` is **read-only** (reads
`_applied_migrations`, writes nothing) and prints one verdict:

| Production ledger | Verdict (tested on disposable copies, every change inside a rolled-back transaction) |
|---|---|
| `main` a16628c5 (270) | `COMPATIBLE · 270 · 13 pending` |
| `main` 88bc0178 (271) | `COMPATIBLE · 271 · 12 pending` |
| 271 + a `0240_aum_month_end.sql` row | `STOP` — "applied in production but not shipped by the candidate" |
| a `main` file with a different checksum | `STOP` — "checksum differs from the reviewed file" |
| a release migration already applied (e.g. the 283-file CI database) | `STOP` — "production is not at main's 270 / 271" |

Any `STOP` stops the deployment. Migrations and ledger rows were not edited.

## G. Financial regression

All on disposable local databases, the real sample files (never committed)
and the authentic AMFI NAVAll of 07-Oct-2026. Final tree `aab763c4`
(runtime-identical to `d15e61aa`; the later commit is type-only and a test).

| Rehearsal | Result vs baseline |
|---|---|
| **FS-7 copy rehearsal** (pilot manifest MFSD211 ×2 + MFSD201 ×2, legacy firm then validate-first) | **identical** to the FS-7 baseline of `c26e676` on every figure: legacy 1,061 transactions (3 rejected, ₹81,50,526.51) → 1,061 matched by every fact, 15 posted, 18 folio corrections held, 6 unknown codes unsupported; re-run 1,076 already posted, 0 new; reconcile five checks 0; legacy rows unchanged within the run. Collision firm: 6 altered rows → 6 identity holds, 0 linked, 0 re-posted (identical); the 6 split 4 + 2 across the two files instead of 3 + 3 because the harness picks them by random id (`ORDER BY id LIMIT 6`) |
| **P0 rehearsal** (legacy firm, clean pilot, out-of-scope files) | **all 21 recorded figures identical**: 1,076 transactions / ledger, 501 clients, 762 folios, 1 SIP rejection; **15 multi-lot redemptions, 340 lots** (₹20,89,213.97) posted as 15 transactions; MFSD203 / MFSD243 / MFSD230 / CAMS R2 / R9 / WBR49 refused for the pilot firm, CRM unchanged |
| **Phase 3L harness** (AMFI, Scheme Master, MFSD203 AUM, SIP book, re-import) | **all 32 figure groups identical** to the B-1 and the original 3L baselines (only ids, timestamps and the activation's `reportCodes` differ): AMFI 14,357 schemes / 14,116 written; **215 KFintech codes verified, 4 unresolved** (`isin_not_in_feed` 1, `no_isin` 3); MFSD203 1,938 mapped legs = units × AMFI NAV (₹14,66,10,685.69; registrar − CRM ₹0.01), 1 unmapped leg at the registrar's ₹99,995, labelled "Mixed dates"; CAMS R2 / R9 refused for a KFintech-only activation; 1,076 transactions on an approved identity with the folio's owner; SIP book active 3 (₹7,500) + pending 5 (₹9,500); re-import idempotent |
| **Legacy importer, all nine real files** (production's path today) | **every figure identical** to the pre-merge candidate and to the earlier B-1 candidate: 1,193 live clients (1,168 PAN-keyed, 23 minors, 25 no-PAN placeholders, 0 PAN twins), 2,972 folios / 3,182 legs / folio AUM ₹26,61,11,482.73, 2,392 processed (₹2,09,98,155.75), 3 rejected (₹12,000), 8 active SIPs (₹17,000), 1 SIP rejection. **One intended change from `88bc0178`:** 4 clients the registrars call "Partnership Firm" / "Sole Proprietorship" are now `partnership` (3) and `sole_proprietor` (1) instead of `company` |

Differences from `main` (unchanged from B-1 and reviewed there): KFintech rows
held instead of guessed (39 transactions, §D), refused instructions recorded
as rejected with 0 units, no-PAN placeholders keyed by folio (+10), a minor at
the other registrar kept separate (+3).

**Client-type mapping vs identity rules.** On every holder-status value in
the real CAMS R2 / R9 / WBR4 / WBR10 and KFintech MFSD211 files (25 distinct
values, 2,400+ rows), `main`'s new `clientTypeFromTaxStatus` reads minor, HUF,
NRI and individual exactly as before; only partnership and sole
proprietorship change, and the release's owner rules (`statusOwnerType`) read
the registrar status directly — a partnership is never a person, a sole
proprietorship is its proprietor. A test pins that agreement.

## H. Security and privacy regression

| Area | Result |
|---|---|
| Production's own files (`deploy.yml`, deploy / change-lock scripts, `terraform/`, `src/lib/sql/`, `log-safe.ts`, `middleware.ts`) | byte-identical to `main` 88bc0178; `ci.yml` differs only by the release's emergency-drill step |
| MFA on the session, step-up, two-person START, runtime role checks (0243 / 0244) | their DB suites pass in every full run (superset env); `runtime-db-role-db` now also collects under CI's env, where its 6 DB checks skip for lack of `ADMIN_DATABASE_URL` (§J) |
| Tenant isolation | infra harness: firm two sees 0 cross-firm rows; another firm's import 404; a foreign storage key 403; firm two unchanged by everything firm one did; RLS 189 / 189 |
| Authorization | user without import capability: upload URL 403, resolve 403; firm owner on operator controls 401 |
| Privacy | 0 PANs in 60 kB+ of worker / server logs; staging holds keyed tokens only; remarks and errors PAN-masked; the new exceptions text carries no PAN (tested); every report here is aggregates only |
| Emergency stop | one-operator global halt parks a file with nothing written; release needs two people; `test:emergency` passes alone |
| Mail trust | forged and unroutable mail held, only the aligned-DKIM registrar mail imported |

## I. Commits and fingerprints

Branch `claude/relaxed-mendel-01jprq` only (non-deploying). `main`, `deploy/aws`
and every tag untouched; `rta-kfintech-pilot-candidate-2026-10-10` still on
`c26e676` (tag object `2f7aab47`).

| Commit | What |
|---|---|
| `fb3d4c66` | stabilisation: infra harness, reconcile probe fix, I-7 fixes, exceptions category, I-1 – I-3 test, DBA queries |
| `d15e61aa` | merge of `main` `88bc0178` (client types, `0233_client_type_details.sql`); parent 1 `fb3d4c66`, parent 2 `88bc0178` |
| **`aab763c4`** | CI green under `ci.yml`'s own env (as-any ratchet by typing, a collection-time test crash) — **proposed candidate (application code)** |
| later commits | `docs/` only (this report, handover pin) |

**Proposed candidate**

| Item | Value |
|---|---|
| Commit | `aab763c420466b6a70a3ad62f20530f7a334153f` |
| Baseline `main` | `88bc0178f8b8bd0eff4f3bbf97492ccf5b98961c` (an ancestor; so are `a16628c5` and the release `c26e676`) |
| Whole tree | `67c67e834b7e00e055d07076daf0e83ce69f08cb` |
| `src/` | `88816411a6791aea05dbb7723597d7c4e20c9e84` |
| `drizzle/migrations/` | `4a66501e6aa6f6a64724eff26a23687e6cfd872b` (lock SHA-256 `9a2fb53f…ef49`, 283 files, ledger `eb49785a924cc2e31b2dc4d2e0b2b4f9`) |
| `tests/` · `scripts/` | `103bd00be0c962241083348313ce66d310f60023` · `75d05942315434fa15360e42a33f48963e3465f2` |
| Changes since `f61d202` outside `docs/` | `main`'s `88bc0178` (22 files; in `cams.ts` / `kfintech.ts` the import lines were resolved by hand) plus 18 files of this stabilisation: `src/lib/rta/` exceptions, reversal (reconcile probe + types), scheme-resolution (ORDER BY + types), intake-scope / cancel-import (types); `scripts/rta-infra-check.ts`, `scripts/check-migration-dups.mjs`, the migration lock, `CLAUDE.md`; 8 test files + 1 helper. No other file. |
| Behaviour changes vs `f61d202` | (1) `main`'s client types (partnership / LLP / proprietor / society are their own types; nomination for individuals only; `type_details`); (2) reconciliation's ledger probe names the firm (same answer, bounded time); (3) registrar warnings list codes in a stable order; (4) folio corrections show as `registrar_correction` on the Exceptions page |
| Proposed tag (NOT created) | `rta-kfintech-pilot-candidate-2026-10-12-b1s`, annotated, on `aab763c4`, only on the owner's approval |

Verify: `git rev-parse aab763c4^{tree} aab763c4:src aab763c4:drizzle/migrations`;
`git merge-base --is-ancestor 88bc0178 aab763c4 && git merge-base --is-ancestor c26e676 aab763c4 && echo ok`;
`git diff --name-only aab763c4 <deployed> -- . ':(exclude)docs'` prints nothing.

## J. Remaining defects and open items

1. **CI does not run 16 DB checks.** `ci.yml`'s db job sets no
   `ADMIN_DATABASE_URL`, so the admin-gated DB tests skip there (runtime role ×6,
   global AMFI / platform mapping cleanup and similar). They pass locally in
   every superset run. Proposed (not done — a CI change is the owner's call):
   add `ADMIN_DATABASE_URL: postgres://postgres:postgres@localhost:5432/mfd` to
   the db job.
2. **No automatic retry after a connection lost mid-posting.** The batch rolls
   back whole and is recorded `failed` with its reason; an operator re-imports
   (posts once). Acceptable for the pilot; documented in the runbook.
3. **Headerless impact unknown** until the DBA / infra query (§E) runs on
   production.
4. **I-1 / I-2 / I-3 holds will appear** in production firms' Exceptions pages
   where today `main` moves or guesses silently; each needs a person
   (merge clients, correct the record) — no historical repair is authorized.
5. **`main` keeps moving.** This candidate contains `main` up to `88bc0178`.
   Any later push to `main` must be merged and re-qualified before deployment
   (check: `git merge-base --is-ancestor origin/main <candidate>`).
6. Operational checks A–F, FS-1 – FS-10, PR-1 – PR-18 remain **NOT VERIFIED**
   (§K).

## K. AWS / DBA checks (not verifiable from development)

Not verifiable from development; each needs AWS / DBA access under the change
lock (read-only unless stated):

1. **Production SHA** — the running commit is `main` 88bc0178 or older and is an
   ancestor of the candidate.
2. **Ledger** — run `docs/rta/handover/b1-production-ledger-check.sql`; expect
   `COMPATIBLE` (270 + 13 or 271 + 12). Any `STOP` (the reverted
   `0240_aum_month_end.sql` above all) stops the deployment.
3. **Runtime role** — `mfd_app` passes the 0244 checks (not superuser /
   BYPASSRLS / CREATEROLE, owns nothing, no TRIGGER / TRUNCATE / REFERENCES on
   protected tables); otherwise web and worker refuse to start after deploy.
   `APP_DATABASE_URL` set on both containers, no `DATABASE_URL` in
   `.env.production`.
4. **Headerless impact** — run `docs/rta/handover/b1-headerless-impact-check.sql`
   and, for the imports it lists, record whether line 1 / lines 1–10 hold a
   header (never copy a file off the box).
5. Handover PR-1 – PR-18, A–F and FS-1 – FS-10 on THIS candidate (F part 1 in
   particular), not on `c26e676` or `f61d202`.

## L. Recommendation

- **Release-candidate approval (development): GO is recommended**, for the
  owner's decision — I-6 and I-7 fixed with evidence, I-1 – I-4 verified,
  financial results identical to every baseline, production's latest commit
  integrated, CI green under its own configuration, no regression of the
  production security files.
- **Production: NO-GO.** Deployment needs the owner's approval and tag, then
  the §K checks (ledger verdict COMPATIBLE, runtime role, production SHA) and
  the operational preflight on this candidate. Nothing here authorizes
  deployment, migration, activation, posting, merging or repair.
