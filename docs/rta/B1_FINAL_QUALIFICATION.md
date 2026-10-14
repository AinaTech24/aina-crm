# B-1 final release qualification (2026-10-14)

The owner conditionally accepted candidate `aab763c4` and asked for the named
gaps to be closed. This is the evidence. **Development only — nothing was
deployed, merged into `main`, migrated in production, posted, repaired or
merged; no tag was created or moved** (`rta-kfintech-pilot-candidate-2026-10-10`
still on `c26e676`). Real registrar files were used only on disposable local
databases and never committed; identifiers below are masked.

## A. The 16 database tests CI skipped

Under CI's own environment (no `ADMIN_DATABASE_URL`, no Redis) exactly 16
DB-backed tests skipped:

| # | Tests | Skipped because | Security / financial significance | Executed before? |
|---|---|---|---|---|
| 6 | `runtime-db-role-db` — role inspection; worker refuses superuser / BYPASSRLS / owner / member-of-owner / tooling roles; the real worker entry point refuses; web and worker checked separately; posting refuses a privileged role inside the transaction; tenant isolation for the restricted role | no `ADMIN_DATABASE_URL` | the 0244 runtime-role security patch | locally only (superset env); **never in real CI** — CI crashed at collection until `aab763c4` |
| 8 | `rta-b1-integration` (DB) — validate-first never adopts by name; a minor never adopted by name; feed name-adoption only for unheld PANs; three leg-merge rules; valuation never prices an evidence-tracked leg by name; main's repair scripts refuse `--apply` for a validate-first firm | no `ADMIN_DATABASE_URL` | ownership safeguards I-1 – I-3 and the B-1 merge semantics | locally only; never in real CI |
| 1 | `rta-cancel-import-db` — a cancelled parked import's queued job is removed from Redis | no `TEST_REDIS_URL` | cancel is final (0243) | **never** — skipped in my local runs too |
| 1 | `rta-emergency-drill-db` | runs alone by design (halts every firm) | emergency stop | yes — its own CI step |

**A larger finding.** When the real CI job was re-run, the 16 were not the
only problem: **51 posting tests failed in GitHub's runner** ("the connected
database server is not on this machine"). The development posting gate posts
only to a server that reports a loopback address; CI's Postgres ran as a
service container, which reports its Docker address. Local runs used a
loopback server, so they passed. The gate was **not** relaxed. The db job now
runs a disposable PostgreSQL 16 and Redis **on the runner**
(`scripts/ci/provision-test-db.sh`) with two roles and random, masked
passwords — `ci_admin` (test admin + migrations; superuser of the throw-away
cluster, so the runtime-role tests can create the privileged shapes they must
refuse) and `mfd_app` (restricted; RLS enforced). No production credential is
used; no URL or password is printed (checked in the real log). A new step
(`scripts/ci/assert-no-db-skips.mjs`) **fails the job if any DB-backed test is
skipped**; only the emergency drill is excepted, and it runs in its own step.
One more defect surfaced and was fixed: a posting-control test guessed a
`postgres:postgres` login; it now uses the provided test admin and asserts the
same refusal.

**Real GitHub CI, run 304 on `a1c952c1`** (all three jobs green):

| Job | Result |
|---|---|
| Migrate · RLS coverage | migrate 284 · `check:rls` 189 tables · `mfd_app` superuser=false bypassrls=false · **vitest 111 files, 1,233 passed, 0 failed, 1 skipped** (the drill) · no-skip guard ✓ · **emergency drill 1 passed** |
| per file | `runtime-db-role-db` 9/9 · `rta-b1-integration` 54/54 · `rta-cancel-import-db` 4/4 · `rta-fs8-redis-cancel-db` 1/1 · `rta-posting-controls-db` 11/11 · `rta-validate-first-db` 13/13 · `rls-isolation` 3/3 |
| Typecheck · RBAC · Calc · Tests | tsc, RBAC, migration numbering + lock, calc, colors, **as-any 3,429 = baseline**, mathimports, unit tests 974 passed (260 DB-only skipped in this job by design), lint |
| Mobile | tsc + jest pass |

All 16 previously skipped tests executed and passed in real CI. RLS
(`rls-isolation`, `check:rls`), permission boundaries (runtime-role,
two-person, capability tests) and the runtime database-role checks are among
them.

## B. Final full-suite, infrastructure and regression results

| Run | Tree | Result |
|---|---|---|
| **Real GitHub CI** (`ci.yml`, all three jobs) | `a1c952c1` (run 304) and the candidate `d7aa60a8` (run 305), identical results | DB job: **1,233 passed · 0 failed · 0 skipped** (+ emergency drill 1 passed in its own step); quality job: tsc, every ratchet, 974 unit tests, lint; mobile: pass |
| CI db job emulated locally (Node 20, only the variables the script writes) | `a1c952c1` | migrate 284, check:rls 189, 1,233 passed / 0 failed / 1 skipped (drill), no-skip guard ✓, drill ✓ |
| Local guards | `d7aa60a8` | `tsc` 0 · lint 0 · check:rbac / migrations / calc / colors / asany (3,429 = baseline) / mathimports / labels / schema / finance / spine / sql / rls all 0 · `migrate-all --check` 284 applied, 0 pending, 0 blockers · immutability drill 0 failures · `build:check` (production `next build`, Dockerfile build placeholders) 0 |
| **Infrastructure harness** — real `next dev`, real Chromium, S3 emulator, Redis, separate killable worker processes, synthetic labelled fixture | `d7aa60a8` | **43 / 43** (table below) |
| **Browser check** — validate-first screens, real Chromium, the 3L firm with the MFSD203 statement | `d7aa60a8` | **17 / 17**: Owner AUM tile states what it rests on and warns (mixed dates; ₹ at AMFI NAV of 7 Oct · ₹ at registrar statement value, 8 Oct); Registrar AUM card; holdings carry the registrar's dated figure (13); Active SIPs = 3 = verified registrations only; Held transactions 24 rows, "Choose client" only where settleable (0); no sideways scroll at 375px; no page errors |
| FS-7 copy rehearsal | merged runtime (no `src/` change since) | identical to the FS-7 baseline (only per-build random ids differ; the collision firm's 6 altered rows are all held, none linked or re-posted) |
| P0 rehearsal | same | **21 / 21 figures identical** — incl. 15 multi-lot redemptions / 340 lots (₹20,89,213.97) posted as 15 |
| Phase 3L harness | same | **32 / 32 figure groups identical** to the B-1 and original 3L baselines: AMFI 14,357 / 14,116; **215 KFintech codes verified, 4 unresolved and held**; MFSD203 1,938 legs = units × AMFI NAV (₹14,66,10,685.69, registrar − CRM ₹0.01) and 1 unmapped leg at the registrar's value — two figures, never added; SIP book active 3 + pending 5 (unverified excluded from the Active SIP Book); CAMS R2 / R9 refused for the KFintech-only activation; re-import idempotent |
| Legacy importer, nine real files | same | identical to `aab763c4` on every figure. Against `main` f563e7ac: the reviewed release rules only (39 KFintech holds, 3 rejected instructions, +10 folio-keyed placeholders, +3 minors kept separate); categories differ because the candidate files 4 H-PAN clients as HUF (not individual) and no-PAN placeholders as "other" (not individual) |
| Re-import and crash recovery | `d7aa60a8` | harness: worker killed mid-batch → 20,000 / 20,000 once, reconcile 0; connection killed mid-posting → 0 visible, re-import 5,000 / 5,000 once; Redis / S3 / database outages; emergency halt + two-person resume |
| Migration drills | `a1c952c1` | fresh = upgrade from 272; 3 concurrent fresh builds ×2 and 3 concurrent upgrades: each file applied once |

Reconfirmed: 215 observed KFintech schemes verified against the authentic AMFI
file, 4 unresolved held; the 15 multi-lot redemptions correct; registrar AUM and
independently valued AUM kept distinct; unverified SIPs out of the Active SIP
Book; CAMS scheme-dependent posting off (CAMS codes need a person's
confirmation, and CAMS reports are outside the KFintech-only activation); no
regression of `main`'s features (its own tests pass in real CI; client types,
compliance-guarantee, suitability note, mobile call workflow).

**Residual unsupported formats and codes** (held, never guessed): KFintech
`LTOF`, `IPO`, `CNO`, `CNI` (unrecognised — 6 in the real files); folio
corrections `FULR` / `NEWR` / `SINR` groups (18, held as corrections);
headerless AUM / SIP files (refused); CAMS reports for posting (out of scope;
CAMS codes need confirmation); MFSD230 (conditional, attaches only);
IDCW, reversals, cancellations and pre-rejections (held, from earlier phases).

Infrastructure harness, check by check (`d7aa60a8`):

| # | Check | Result |
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
| 17 | after the crash every transaction is posted exactly once | PASS — +20000 of 20000, ledger 20008, reconcile 0 in 193 ms |
| 18 | Redis down: the upload is refused or recorded as not queued — never a silent loss | PASS — HTTP 503, row failed |
| 19 | Redis back: the same file imports normally | PASS — completed |
| 20 | S3 unreachable: the import fails with a recorded reason (BullMQ retried it), nothing posted | PASS — failed |
| 21 | S3 unreachable: the uploaded file is kept for the retry | PASS —  |
| 22 | S3 back: re-import of the kept file completes | PASS — HTTP 200, completed |
| 23 | database unreachable then back: the job is retried and posts once | PASS — completed, 1, worker restarts 2 |
| 24 | database lost during posting: the posting transaction rolls back whole | PASS — 1 posting connection(s) terminated, 0 rows visible |
| 25 | database lost during posting: the retry posts every transaction exactly once | PASS — completed via operator re-import, 5000 of 5000 |
| 26 | failed import recovery: visibly failed with a reason, nothing posted, file kept; the re-import is audited; a second re-import is refused | PASS — before recovery: failed, reason shown true, file kept true, 0 posted outcomes, 0 ledger rows · re-import audit rows 1 · second re-import HTT |
| 27 | emergency halt: a file arriving during the halt is parked and nothing is written | PASS — uploaded: Held — nothing was imported: posting is halted for all firms: infra ch |
| 28 | resume: after a two-person release the parked file imports by itself, once | PASS — completed, 1 |
| 29 | a user without the import capability cannot get an upload URL | PASS — HTTP 403 |
| 30 | another firm's import is not found | PASS — HTTP 404 |
| 31 | an upload naming another firm's storage key is refused | PASS — HTTP 403 |
| 32 | a firm owner cannot use the operator controls | PASS — HTTP 401 |
| 33 | a user without the import capability cannot resolve held transactions | PASS — HTTP 403 |
| 34 | mail: the poller read all three stored mails from S3 | PASS — {"processed":3,"held":2,"failed":0} |
| 35 | mail: the trusted registrar mail is routed by alias to its firm and imported through the queue | PASS — 1 posted |
| 36 | mail: forged and unroutable mail are held (kept, retried), never imported | PASS — 2 held |
| 37 | privacy: no PAN in worker or server logs | PASS — 0 found, 63133 bytes scanned |
| 38 | privacy: staging holds no PAN (keyed tokens only) | PASS — input PANs found 0, PAN-shaped values outside keyed columns 0 |
| 39 | privacy: import remarks and errors are PAN-masked | PASS — 0 |
| 40 | every import reached a final status (none left parsing / queued) | PASS — [{"status":"failed","n":3},{"status":"completed","n":16}] |
| 41 | no wrong-client posting: every transaction belongs to its folio's owner, and folio 98000001's to PAN holder a1 | PASS — 0 off-owner, 0 of 25012 on another PAN |
| 42 | no unexpected tenant modification: firm two unchanged by everything firm one did after its own imports | PASS — {} |
| 43 | ledger reconciles for both firms: five checks 0, ledger = transactions, no registrar number twice | PASS — firm one 25013/25013, firm two 2/2 |


## C. The 39 legacy transaction differences — exact reconciliation

Legacy importer on the two real KFintech MFSD201 files (after the masters):
`main` 1,100 transactions, candidate 1,061 — **39 in `main` only, 0 in the
candidate only**. Validate-first (the pilot path) on the same four files: the
P0 clean firm. Script: row → registrar transaction (Fund + Transaction Number)
→ staged economic transaction → ledger → CRM transaction.

**1–3. Why 16 groups and 343 rows, and the earlier 15 / 340.** The candidate's
legacy importer holds every registrar number reported in more than one row as
"multi-lot" unless an R-coded reversal row marks it a folio correction; 16
numbers fall in that class. It does not look at the code. Validate-first
classifies the same 16 by code: **15 are redemptions** (FUL / RED, 340 lots,
₹20,89,213.97) and **1 is code `LTOF`** (3 lots, ₹4,43,389.29), a code no
registrar document defines, so it is held `unsupported`. 15 + 1 = 16 groups;
340 + 3 = 343 rows; ₹20,89,213.97 + ₹4,43,389.29 = ₹25,32,603.26. The extra
three rows are group **G16** (registrar no. …7000). Populations and the amount
definition are identical: the registrar amount is Σ |Amount| of the
transaction's rows in its file; no number appears in both files (no double
counting).

**4–5. Posted vs held, per group** (full table below):

| Groups | Registrar codes | Validate-first | Candidate legacy path |
|---|---|---|---|
| G01–G15 (15) | FUL, RED | **posted once each**, all lots, ₹20,89,213.97 | held (multi-lot) |
| G16 (1) | LTOF | held `unsupported` (₹4,43,389.29 not posted) | held |
| G17–G34 (18) | NEW/NEWR, FUL/FULR, SIN/SINR | held `correction_held` (folio consolidation) | held |
| G35–G38 (4) | CNO, CNI (₹0) | held `unsupported` | held |
| G39 (1) | IPO | held `unsupported` | held |

**6. Successful economic transactions.** `main` posted 39 records for these
numbers (₹4,84,711.96 in total). The candidate's legacy path posts none of them
(all held with a recorded reason). Validate-first posts **15 canonical
transactions** (₹20,89,213.97), and holds 24.

**7. Replaced, not omitted.** On the pilot path the 15 redemptions are
**replaced** by correctly grouped canonical transactions — one per registrar
number, full amount, every lot kept (`rta_staging_lots`), lineage to the
staged rows. The 24 others are held on the Held transactions / Exceptions
screens, never silently dropped. On the legacy path all 39 are held with
reasons (Exceptions page: `txn_conflict`, `registrar_correction`,
`unsupported_txn`).

**8. Business calculations.** Corrections and unknown codes create no
`transactions` row, so they reach no business figure (incentives read the
transaction ledger; targets read booked business entries). `main` counted
them: 18 correction groups as purchases / SIPs / redemptions and LTOF as a
₹59,005 "lumpsum" outflow.

**9. STT / payout.** Unchanged and stated: all 15 posted redemptions carry
`amountMeaning: registrar_reported`, `payoutVerified: false` (15 / 15). The
registrar's amount is recorded, not the investor's payout; STT is not netted.

**10. Traceability.** All **447** source rows of the 39 numbers are linked to
staged rows (447 / 447); each posted transaction carries its identity key,
batch and economic-transaction id.

`main`'s error was the **amount and type**, never the client: its owner equals
the candidate's folio owner in 39 / 39.

Masked reconciliation (registrar number and folio by their last digits; posted
transaction by the last 6 characters of its id):

| Group | In the 39 | Registrar no. | Folio | Source rows (May / Oct) | Codes | Registrar amount ₹ | Legacy `main` stored | Candidate (legacy path) | Validate-first (pilot path) |
|---|---|---|---|---|---|---|---|---|---|
| G01 | yes | …5701 | …62 | 15 / 0 | FUL | 12,49,876.47 | ₹1,07,992.81 redemption | multi-lot (held) | posted once — 15 lots, ₹12,49,876.47 (txn …4b1469) |
| G02 | yes | …5213 | …73 | 28 / 0 | FUL | 1,98,384.71 | ₹10,394.34 redemption | multi-lot (held) | posted once — 28 lots, ₹1,98,384.71 (txn …57bac8) |
| G03 | yes | …2010 | …85 | 19 / 0 | FUL | 1,76,578.49 | ₹9,441.33 redemption | multi-lot (held) | posted once — 19 lots, ₹1,76,578.49 (txn …e7cc62) |
| G04 | yes | …3435 | …06 | 5 / 0 | RED | 89,990.9 | ₹20,501.1 redemption | multi-lot (held) | posted once — 5 lots, ₹89,990.9 (txn …863131) |
| G05 | yes | …5996 | …05 | 5 / 0 | RED | 78,767.79 | ₹17,531.36 redemption | multi-lot (held) | posted once — 5 lots, ₹78,767.79 (txn …f680b8) |
| G06 | yes | …6790 | …16 | 0 / 3 | FUL | 73,227.43 | ₹16,535.58 redemption | multi-lot (held) | posted once — 3 lots, ₹73,227.43 (txn …482e87) |
| G07 | yes | …1132 | …43 | 24 / 0 | RED | 58,000.58 | ₹2,541.6 redemption | multi-lot (held) | posted once — 24 lots, ₹58,000.58 (txn …6d6dac) |
| G08 | yes | …0958 | …91 | 0 / 168 | FUL | 39,964.12 | ₹50.2 redemption | multi-lot (held) | posted once — 168 lots, ₹39,964.12 (txn …349aeb) |
| G09 | yes | …7367 | …32 | 20 / 0 | RED | 31,000.31 | ₹2,250.77 redemption | multi-lot (held) | posted once — 20 lots, ₹31,000.31 (txn …51bcdb) |
| G10 | yes | …5593 | …73 | 17 / 0 | FUL | 25,562.88 | ₹2,748.6 redemption | multi-lot (held) | posted once — 17 lots, ₹25,562.88 (txn …3828ca) |
| G11 | yes | …8467 | …54 | 10 / 0 | FUL | 24,745.43 | ₹2,659.95 redemption | multi-lot (held) | posted once — 10 lots, ₹24,745.43 (txn …792c30) |
| G12 | yes | …6762 | …16 | 0 / 16 | FUL | 23,539.5 | ₹2,619.3 redemption | multi-lot (held) | posted once — 16 lots, ₹23,539.5 (txn …9468b9) |
| G13 | yes | …3563 | …11 | 0 / 6 | RED | 11,592.73 | ₹1,854.85 redemption | multi-lot (held) | posted once — 6 lots, ₹11,592.73 (txn …87161d) |
| G14 | yes | …3099 | …11 | 0 / 2 | RED | 5,000.05 | ₹574.58 redemption | multi-lot (held) | posted once — 2 lots, ₹5,000.05 (txn …6a07fe) |
| G15 | yes | …9370 | …16 | 0 / 2 | FUL | 2,982.58 | ₹2,681.61 redemption | multi-lot (held) | posted once — 2 lots, ₹2,982.58 (txn …5f53e9) |
| G16 | yes | …7000 | …86 | 0 / 3 | LTOF | 4,43,389.29 | ₹59,005.26 lumpsum | multi-lot (held) | unsupported (unknown_transaction_code); 3 rows staged |
| G17 | yes | …9683 | …01 | 0 / 3 | NEW NEWR | 2,99,985 | ₹99,995 lumpsum | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G18 | yes | …6242 | …01 | 0 / 48 | FUL FULR | 71,623.26 | ₹1,339.84 redemption | folio correction (held) | correction_held (folio_consolidation); 48 rows staged |
| G19 | yes | …6388 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G20 | yes | …7347 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G21 | yes | …8208 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G22 | yes | …2228 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G23 | yes | …6201 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G24 | yes | …9745 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G25 | yes | …0173 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G26 | yes | …8866 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G27 | yes | …3696 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G28 | yes | …7697 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G29 | yes | …0327 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G30 | yes | …8548 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G31 | yes | …4238 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G32 | yes | …3178 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G33 | yes | …0536 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G34 | yes | …1017 | …01 | 0 / 3 | SIN SINR | 4,499.79 | ₹1,499.93 sip | folio correction (held) | correction_held (folio_consolidation); 3 rows staged |
| G35 | yes | …7029 | …01 | 0 / 1 | CNO | 0 | ₹0 lumpsum | folio correction (held) | unsupported (unknown_transaction_code); 1 rows staged |
| G36 | yes | …7030 | …85 | 0 / 1 | CNI | 0 | ₹0 lumpsum | folio correction (held) | unsupported (unknown_transaction_code); 1 rows staged |
| G37 | yes | …7031 | …01 | 0 / 1 | CNO | 0 | ₹0 lumpsum | folio correction (held) | unsupported (unknown_transaction_code); 1 rows staged |
| G38 | yes | …7032 | …85 | 0 / 1 | CNI | 0 | ₹0 lumpsum | folio correction (held) | unsupported (unknown_transaction_code); 1 rows staged |
| G39 | yes | …5481 | …72 | 0 / 1 | IPO | 99,995 | ₹99,995 lumpsum | unknown code (held) | unsupported (unknown_transaction_code); 1 rows staged |


## D. Production historical-impact diagnostic (prepared, NOT executed on production)

The legacy importer kept one CRM row per registrar number and stored **no
source row, code, source tag or remark**, so the database alone shows
exposure, never impact. Two read-only tools:

1. **Exposure** — `docs/rta/handover/b1-legacy-impact-exposure.sql` (DBA,
   read replica or `default_transaction_read_only=on`): per firm, legacy-written
   KFintech transactions by shape (redemption-like, lumpsum outflow,
   zero-amount) and which stored KFintech feed files exist. Counts only. It
   **does not say any record is wrong**.
2. **Confirmation** — `npx tsx scripts/rta-legacy-impact-diagnostic.ts --tenant
   <id> --imports --json out.json` (restricted app role, RLS on, every query in
   a READ ONLY transaction; reads the stored files from object storage). It
   re-reads each MFSD201 file with the release's verified parser and compares
   each registrar transaction with the CRM row: `confirmed_multi_lot_truncated`,
   `confirmed_correction_posted`, `confirmed_unrecognised_posted` (proved by
   the registrar's file), `potential_amount_differs` (a person looks),
   `consistent`, `not_in_crm`. Counts, sums and at most three masked examples.

Validated in development (both from local files and through the S3 emulator):
on legacy `main`'s records — **15 confirmed truncated (CRM ₹2,00,377.98 of
₹20,89,213.97), 18 confirmed correction groups (CRM ₹1,25,333.72), 6 confirmed
unrecognised codes (CRM ₹1,59,000.26), 0 potential, 1,061 consistent**; on the
candidate's records — 0 confirmed, 1,061 consistent, 39 not on record. A firm
with exposure but no stored file cannot be confirmed from the database; the
registrar's file for that period would be needed. Nothing is repaired from
either result without a separate, reviewed decision.

## E. Migrations — deterministic verification

`main` advanced again (F), adding `0234_minor_risk_from_guardian.sql`, which
shares its prefix with the release's `0234_folio_holders.sql` — exactly as
`0233` did.

| Check | Result |
|---|---|
| Unique filenames, immutable checksums | 284 files, 284 lock entries, 0 mismatches; both `0233` and both `0234` pairs have distinct names; `main`'s 272 files byte-identical in the candidate; the release's 12 unchanged since `c26e676`; lock gained 2 entries (`0233_client_type_details 1231d8f2e440972a`, `0234_minor_risk_from_guardian 33869550c6da1ca6`), none changed |
| Prefix collisions | `0233` and `0234` grandfathered in `check-migration-dups` with their rationale (renaming either side would re-run an applied file or break the lock) |
| Deterministic order | the runner sorts filenames by code unit (`client_type_details` < `rta_staging`; `folio_holders` < `minor_risk_from_guardian`). The two `0234` files are independent (triggers + an index on `investors` vs a new table + two nullable columns): fresh order (folio_holders first) and the production upgrade order (minor_risk already applied) build identical schemas |
| Both files in the ledger | after the upgrade: `0233_client_type_details`, `0233_rta_staging`, `0234_folio_holders`, `0234_minor_risk_from_guardian` all recorded |
| Fresh (284) vs upgrade from `main` f563e7ac (272 + 12) | identical `pg_dump --schema-only`; identical ledger digest `a9bb87a582387db2697310e3e66fa895`; `check:rls` 189 / 189 on both |
| Concurrent deployments | **defect found and fixed**: the runner had no cross-process lock, so two runs could plan the same pending list (the ledger insert is `ON CONFLICT DO NOTHING`). It now serialises on a polling advisory lock (a blocking wait held a snapshot that `CREATE INDEX CONCURRENTLY` waited on — seen in the first drill and corrected). Drills: 3 concurrent fresh builds ×2, and 3 concurrent upgrades from a 272-state database: exactly one applies, the others wait and find nothing to do, no file attempted twice |
| Unexpected ledger entries | runner: a ledger holding `0240_aum_month_end.sql` → `--check` and apply both exit 2, "nothing was applied" |
| Client-type functionality | `client-types.test.ts` (incl. f563e7ac's additions) passes in real CI; the merged tax-status mapping agrees with the release's owner rules (test) |
| Immutability drill | 0 failures (§B) |

Ledger digests: `main` a16628c5 (270) `d81993198b6288513fe6913400b7966c` ·
88bc0178 (271) `9d53e5c78c2d79f7b29eea0d4d8e0065` · **f563e7ac (272)
`2ed089067e530ec25b28fb9a755cca5c`** · candidate (284)
`a9bb87a582387db2697310e3e66fa895`.

**The reverted `0240_aum_month_end.sql` — DBA command (read-only).**

```sql
-- 1. The one row that must not exist:
SELECT filename, checksum, applied_at FROM _applied_migrations
 WHERE filename = '0240_aum_month_end.sql';
-- 2. The whole ledger against the candidate (verdict COMPATIBLE or STOP):
\i docs/rta/handover/b1-production-ledger-check.sql
```

Run as the DBA with `PGOPTIONS='-c default_transaction_read_only=on'`. Any row
from (1), or a `STOP` from (2), stops the deployment; migration history is
never amended or deleted. Tested verdicts (every change inside a rolled-back
transaction): 272 → `COMPATIBLE · 272 · 12 pending`; 271 → `COMPATIBLE · 13`;
270 → `COMPATIBLE · 14`; 272 + a `0240_aum_month_end.sql` row → `STOP`; a
`main` file with another checksum → `STOP`; a release file already applied →
`STOP`.

## F. Current `main` compatibility

Re-fetched 2026-10-14:

| Ref | SHA |
|---|---|
| `origin/main` | `f563e7ac2cf4e21767e48b28e4e75d47f4d21d5f` (deployed: "Deploy to AWS (EC2)" run for it succeeded 2026-10-13 11:39 UTC — the actual host SHA remains NOT VERIFIED) |
| `origin/deploy/aws` | `0d924d772e08d87db79bb68bad2571a57120fade` (2026-09-02; not an ancestor of `main`; unchanged) |
| baseline of `aab763c4` | `88bc0178` |

Six commits after the baseline: `a1c84d6f`, `7e0cc118` (proposals: suitability
note), `9103e5ab` (compliance: a disclaimed guarantee is not a promise),
`909cfb84` (published a shared working tree — it rolled 31 files back to older
copies, removing "own book only" access checks), `2675712a` (put those 31 back),
`f563e7ac` (client master: family-owned details, a minor's risk = the
guardian's via migration 0234 triggers, dropdowns, pincode lookup). 76 files:
mobile app, landing page, proposals, client master, compliance scan, two APIs
(pincode, activities) and one migration.

- **Security:** the 31 restored files are byte-identical to `9103e5ab` (checked
  file by file); the net diff `88bc0178..f563e7ac` removes no access check. The
  new pincode route requires a session.
- **Finance / RTA:** no change under `src/lib/rta`, `src/db`, `src/lib/auth`,
  `src/lib/sql`, `src/middleware.ts`.
- **Data model:** migration `0234_minor_risk_from_guardian` (additive: an index,
  two triggers). **Observation, not changed** (main's code): the new guardian
  link looks a guardian up by PAN and, if two live records share that PAN,
  takes one (`ORDER BY dedup_pan DESC LIMIT 1`). The RTA engine's guardian
  check reads that link. *Superseded by §L (2026-10-14): the link is also not
  scoped to the user's book — blocker G-1.*
- **Deployment / infrastructure:** none (`deploy.yml`, scripts, `terraform/`
  unchanged).

**Minimum required action: integrate it** — production now very likely runs
`f563e7ac` with `0234_minor_risk_from_guardian` applied; a candidate without
it would remove those changes from production and STOP at the ledger check.
Integrated in `a5f65b66` (no conflicts), kept as a separate merge commit so it
can be reviewed or rejected on its own. **Any further push to `main` must be
merged and re-qualified before deployment.**

## G. Failed imports — operational safety and recovery

What happens when the connection is lost during posting (proved by the
infrastructure harness, §B, check "failed import recovery …", on real worker
processes, Next, S3 emulator and Redis):

| Requirement | Result |
|---|---|
| visibly FAILED or HELD | the import is `failed` with its reason in Imports; a halted / paused firm's file is `uploaded` with "Held — …" |
| no partial economic transaction | posting is one transaction: 0 rows visible after the kill; 0 posted staged outcomes; 0 ledger rows for the import |
| source file kept | the stored file stays (`file_key`); the re-import reads it |
| the operator can identify it | Imports list status + reason; the import id |
| re-import cannot duplicate | ledger `UNIQUE (tenant, identity_key)` under a per-firm lock: the re-import posted exactly 5,000 of 5,000; a second re-import of the completed import is refused (HTTP 409), records unchanged |
| audited | `rta_import.reimport` audit row (before / after status), exactly one |
| a stopped or paused firm cannot fall back to the legacy engine | the worker resolves the firm's mode first: held → parked, never the legacy importer (`rta-validate-first-worker-db` "paused / halted … the job is HELD … never the existing importer"; harness emergency-halt check) |
| no bypass of scheme or ownership validation | a re-import re-enters `validateFirstImport` — the same gate, scheme gate, owner resolution and report scope (re-checked at re-run: `intakeRefusal`); manual resolution settles only ownership holds and re-checks guardian / Karta / PAN / folio |

**Procedure for the Exceptions / Imports team** (no automatic retry; none is
needed — the failure is recorded, nothing is half-written):

1. **Find it.** RTA Imports → status **Failed** (or **Held** if posting is
   stopped). Note the import id and the reason.
2. **Check the cause is gone.** Database / worker back (`/api/health` 200,
   `/api/health/rta-reconciliation` 200). If the reason is a halt or pause, do
   nothing — the file is parked and runs by itself after a two-person release.
3. **Re-import once.** Open the import → **Re-run import** (needs the RTA
   import capability). Do not upload the file again. The action is audited.
4. **Confirm.** Status **Completed**; the posted / already-posted / held counts
   are on the import; Held transactions shows anything still needing a person.
   A second re-run is refused — that is expected.
5. **If it fails again with the same reason**, stop and raise it with the
   platform operators (do not loop). Never edit the CRM by hand to "finish" an
   import.

## H. Final release candidate and fingerprints

| Item | Value |
|---|---|
| **Candidate commit** | `d7aa60a8f50b0947e85917b6e11de09fba4a3e08` (branch `claude/relaxed-mendel-01jprq`; later commits may change `docs/` only) |
| Integrated `main` | `f563e7ac2cf4e21767e48b28e4e75d47f4d21d5f` (ancestor; so are `88bc0178`, `a16628c5` and the release `c26e676`) |
| Whole tree | `f0f2bba2852a832d84a30b0f15a7277ad41c14fd` |
| `src/` | `5ef95f6ab8c0e5765ca846b66025d2e2c4ab4d50` |
| `drizzle/migrations/` | `5781e010b734e74dbf191256d72b61c9523716d6` |
| `tests/` · `scripts/` | `180976710dca1ab7f7047b834580024a7e039400` · `eac8cdb376ba3d4436249bb8aad6632d65bec718` |
| Migrations | **284**; lock SHA-256 `025d640cfb1f88c280641bd1dd9f058d482de6f927b71c375aac798b910c72e8`; concatenation `25a08833c8dbd39f9e3114fbb07016d904177860f29c24ce3bedd434181ed472`; ledger digest **`a9bb87a582387db2697310e3e66fa895`** |
| Real CI on the candidate | run 305 (`38512095893`) **success**, all three jobs: migrate 284, check:rls 189, `mfd_app` superuser=false bypassrls=false, **DB tests 1,233 passed · 0 failed · 0 skipped** (no-skip guard ✓), emergency drill 1 passed; unit tests 974, as-any 3,429 = baseline, lint; mobile. No credential in either log |
| Proposed tag (**not created**) | `rta-kfintech-pilot-candidate-2026-10-14-b1f`, annotated, on `d7aa60a8`; `rta-kfintech-pilot-candidate-2026-10-10` stays on `c26e676` |

Commits since the conditionally accepted `aab763c4`:

| Commit | What |
|---|---|
| `a5f65b66` | merge of production `main` `f563e7ac` (6 commits, no conflicts); `0234` prefix grandfathered; 18 release casts typed (as-any union) |
| `f31d68fe` | CI db job on a runner PostgreSQL with two roles; no-skip guard |
| `a1c952c1` | migration runner lock (polling); posting test uses the test admin |
| `d7aa60a8` | legacy-impact diagnostic + exposure SQL; recovery check in the harness; browser AUM check aligned; ledger check for 272; CLAUDE.md |

Behaviour changes since `aab763c4`: `main`'s six commits (proposals' suitability
note, the compliance scan's disclaimed-guarantee rule, the client master by type
with family-owned details and guardian risk, pincode lookup, mobile call
logging, landing page) and `migrate:all` waiting for another run. No RTA,
posting, identity, scheme or auth logic changed. Production's own files
(`deploy.yml`, deploy / change-lock scripts, `terraform/`, `src/lib/sql`,
`log-safe.ts`, `middleware.ts`, `Dockerfile`) equal `main`'s; `ci.yml` differs
by the release's drill step and the new db job; `docker-compose.prod.yml` by
one comment line (fresh-database instructions: `migrate:all`, never `db:push`).

**Financial differences from the accepted baselines: none** (§B). Against
legacy `main`'s importer: the 39 KFintech transactions of §C, 3 refused
instructions recorded as rejected, +10 folio-keyed placeholders, +3 minors kept
separate, and the client-category filing of §B — all release rules already
reviewed.

## I. Remaining issues requiring development

None blocks the KFintech pilot. Known and recorded:

1. **`main` keeps moving.** Any push after `f563e7ac` must be merged and
   re-qualified before deployment; **new migrations on `main` must be numbered
   from 0245** (0233 and 0234 already collide; 0235–0244 would too).
2. **Unrecognised KFintech codes** `LTOF`, `IPO`, `CNO`, `CNI` stay held until
   a registrar document or sample defines them (LTOF carried ₹4,43,389 in the
   sample). Folio corrections stay held until the folio moves are posted.
3. **STT / investor payout** on redemptions is not verified (the registrar's
   amount is recorded and labelled as such).
4. **No automatic retry** after a connection loss during posting — by design;
   the operator procedure (§G) is the recovery.
5. **`main`'s guardian link** — assessed in §L (2026-10-14): a production
   access and data-integrity defect in `main`'s client master, reported as
   blocker **G-1**, separate from the pilot; correction proposed, not applied.
6. **Historical data**: `main`'s importer is proven (on the sample) to have
   truncated multi-lot redemptions, posted correction legs and unrecognised
   codes. Whether production firms are affected needs §D's diagnostic; any
   repair is a separate, reviewed decision.

## J. Checks that need authorized AWS / DBA operators

| # | Check | Expected | Status |
|---|---|---|---|
| J1 | Production host SHA (running containers) | `f563e7ac` or an ancestor of `d7aa60a8` | NOT VERIFIED |
| J2 | `SELECT … WHERE filename = '0240_aum_month_end.sql'` (read-only) | no row | NOT VERIFIED |
| J3 | `docs/rta/handover/b1-production-ledger-check.sql` (read-only) | `COMPATIBLE · 272 · 12 pending` (or 271 / 270) | NOT VERIFIED |
| J4 | `mfd_app` runtime role (0244 checks); `APP_DATABASE_URL` on web + worker; no `DATABASE_URL` in `.env.production` | passes; web / worker start | NOT VERIFIED |
| J5 | `b1-headerless-impact-check.sql` + first-line inspection of listed stored files | counts recorded | NOT VERIFIED |
| J6 | `b1-legacy-impact-exposure.sql`, then `rta-legacy-impact-diagnostic.ts --imports` per exposed firm | counts recorded; no repair | NOT VERIFIED |
| J7 | Handover PR-1 – PR-18, A–F, FS-1 – FS-10 on THIS candidate (F part 1 in particular) | per handover | NOT VERIFIED |
| J8 | Production change lock held for every step; nothing outside it | lock history | NOT VERIFIED |
| J9 | `b1-duplicate-economic-check.sql` (read-only; preflight E-7) | `duplicate_shaped_groups` 0, else reviewed | NOT VERIFIED |
| J10 | `docs/security/g1-guardian-impact.sql` (read-only; preflight E-8, §L) | counts recorded; each finding decided by the owner / compliance | NOT VERIFIED |
| J11 | Remote tag created by an authorized maintainer (handover §0.1d) | `^{}` = `d7aa60a8f50b0947e85917b6e11de09fba4a3e08` | NOT VERIFIED |

The operator order for J1 – J10 is `PREFLIGHT_CHECKLIST.md` §2a (A – H).

## K. Recommendation

- **Development release qualification: GO** — every development gate passes:
  all critical financial and security tests executed and passing in real CI
  (no skips), the 39 source-to-transaction differences reconciled row by row,
  migrations verified (fresh = upgrade, concurrency-safe, unexpected ledger
  entries stop), current `main` integrated, one definitive candidate
  `d7aa60a8`.
- **Production pilot: NO-GO** until the owner approves `d7aa60a8` and its tag,
  and J1 – J8 pass. Nothing here authorizes deployment, migration, activation,
  posting, repair or merging.

## L. Guardian-PAN relationship risk (operational preflight Task 4b, 2026-10-14)

**Verdict: unsafe — production blocker G-1 (access + data integrity), in
`main`'s client master, separate from the RTA pilot.** It is live in
production today if production runs `f563e7ac` (PR-3). The candidate
`d7aa60a8` carries the same code unchanged (it integrates `main`); nothing in
the freeze was changed for it. A correction is proposed, not applied.

**The code** (`main` `f563e7ac`, `src/app/api/investors/route.ts` POST and
`src/app/api/investors/[id]/route.ts` PATCH): a minor's guardian link
(`investors.guardian_investor_id`) is either the `guardianInvestorId` sent by
the client, accepted if it is any non-deleted record **in the firm**, or the
first live record whose PAN equals the typed guardian PAN
(`ORDER BY dedup_pan DESC LIMIT 1`). Neither path applies the user's client
scope (`investorScopeSql`), excludes a merged record (explicit id) or a minor,
or refuses an ambiguous PAN. Migration `0234_minor_risk_from_guardian` then
copies the linked record's risk category, score, signed date and provisional
flag onto the minor and keeps them in step. The minor's edit page reads the
guardian's name and risk profile with no scope check; the Risk Profiles page
and export print the guardian's name.

**Targeted development test** (local PostgreSQL 16, all 284 migrations, the
real route handlers with a mocked session; the firm's data wall
`restrict_user_data_scope` on, then off):

| # | Case | Result on `main`'s code |
|---|---|---|
| 1 | RM A (own book only) creates a minor and types the PAN of RM B's client G as the guardian PAN. RM A cannot open G (`GET` → 403) | **linked to G**; the minor (RM A's) carries G's risk `aggressive`, score, signed date; `GET` of the minor returns G's id; the edit page shows **G's name and risk** |
| 2 | RM A sends `guardianInvestorId` = G's id | **accepted** (201), linked, G's risk copied |
| 3 | Two live records share a PAN: X (RM B, holds `dedup_pan`, `conservative`) and Y (RM A, Excel-loaded, `aggressive`) | links **X** — the other RM's record — not RM A's own; with neither holding `dedup_pan` the pick is arbitrary (one run picked X 4 of 4 times, another Y 4 of 4) |
| 4 | Owner sends `guardianInvestorId` of a MERGED (retired) record | **accepted**; the minor takes the retired record's risk and does **not** follow the survivor's later change |
| 5 | RM A edits their own minor (`PATCH`) and types G's PAN | **linked to G** |
| 6 | RTA `InvestorDirectory.isGuardianOf(G, minor)` after case 1 | **true** |

With the wall off (the firm's shared-book default) the RM can already list
every client, so case 1 is not a new disclosure there — but 3, 4 and 6 hold
either way. By inspection, merging a guardian does not repoint the minors'
links either: the merge moves `investor_id` columns only, so a minor keeps a
link to the retired record (case 4's state).

**Answers.**
- *Incorrect guardian relationship?* **Yes** — a typo or a guessed PAN links
  a stranger silently; PAN twins link whichever record sorts first; a merged
  record can be linked; a minor can be linked as a guardian (explicit id).
- *Reveal another client's information?* **Yes, at a firm with the data wall
  on (or a customised user)**: a PAN typed on one's own minor returns the
  out-of-book client's **name** (edit page, Risk Profiles page / export) and
  **risk category, score and signed date** (on the minor). Within one firm
  only — every query is tenant-scoped and RLS holds; no cross-firm exposure.
- *Ownership outside the RTA engine?* **No folio, transaction, RM, family or
  AUM moves** because of the link. What it does change outside RTA is the
  minor's **risk profile**, which drives suitability: an MF proposal's gate
  ("client-confirmed risk profile signed in the last 12 months") is passed
  with another person's profile, and `risk.*` merge tokens in the minor's
  emails print it. Inside the RTA engine: a row naming the linked adult's PAN
  on the minor's folio is attributed to the folio's owner of record instead
  of being held for review (identity.ts `ownerOf` / legacy `process.ts`), the
  guardian holder recorded in `folio_holders` follows the link, and the
  adult's own new-folio CAMS rows are held as "a recorded guardian" (fail
  closed). The KFintech pilot (MFSD211 + MFSD201; a minor's PAN is blank in
  KFintech files) is not exposed to the first two.

**Fixed in development (owner approval of 2026-10-14, "URGENT G-1 SECURITY FIX").**
The fix, its tests, the read-only impact SQL and the production hotfix plan
are in `docs/security/G1_GUARDIAN_HOTFIX.md` (branch `claude/g1-guardian-hotfix`,
commit `0c4f9e7e`, based on `main` `f086c294`; not merged, not deployed). It
supersedes the proposed patch and the first E-8 query of this section (both
removed). The candidate integrates it (handover §0.1e).

**Effect on the pilot decision:** G-1 is a production defect independent of
the pilot. Its fix is ready in development; its production deployment needs
the owner's separate authorization (G1_GUARDIAN_HOTFIX.md §6), and E-8 is run
and decided before any pilot firm is activated.


## M. Updated candidate `f7055e92` — current `main` + the G-1 fix (2026-10-14)

Owner instruction "URGENT G-1 SECURITY FIX AND FINAL RTA RELEASE UPDATE".
`d7aa60a8` stays the approved development release (its tag waits for a
maintainer, §0.1d); `f7055e92` (code `ccd9e18c` + one test) is the next
candidate, not approved, not tagged.

**`main` moved three times after `d7aa60a8` was approved** (none adds a migration):

| Commit | What | Code / infra / deploy | Production |
|---|---|---|---|
| `f086c294` | laptop deploy sign-in by IAM Identity Center (`aina-deploy` profile); `mfd-deploy` removed from the Terraform state-bucket policy | deploy tooling + Terraform bootstrap + CLAUDE.md | deployed (Deploy to AWS run success) |
| `bee06293` | client-master dropdowns for the remaining free-text fields | application (client forms, `client-types.ts`, places / pincode) | deployed (success) |
| `b795fdba` | empty PAN-less registrar placeholders go to the Trash after imports and nightly; Merge Clients "similar name, one without PAN" | application + RTA worker + daily ops scanner | deployed (Deploy to AWS run 297 success, 05:46 UTC) — production runs it unless PR-3 says otherwise |

**Integration** (non-deploying branch `claude/relaxed-mendel-01jprq`):
`b4aeadd4` (merge `f086c294`, no conflict; the deploy script and Terraform file
byte-identical to `main`), `7ed48d2d` (merge the G-1 fix; one import conflict in
`src/lib/investors/merge.ts`, kept both), `2f26bb1b` (merge `b795fdba`;
`CLAUDE.md` conflict, kept both; **`lib/rta/placeholder-sweep.ts` now asks the
RTA write guard as a `derived` writer**, so a paused / halted / ended / emergency
firm is never touched — the release's rule for every writer on registrar data),
`ccd9e18c` (merge the typed G-1 fix), `f7055e92` (a DB test for the sweep's
guard: `tests/rta-placeholder-sweep-db.test.ts`, 2 / 2, and it fails with the
guard removed). No file under `src/lib/rta/posting`,
`staging`, `identity` or `owner` changed; migrations identical to `d7aa60a8`.

**Results on `ccd9e18c` (code identical to `f7055e92`):**

| Run | Result |
|---|---|
| **Real GitHub CI** run 316 (all three jobs) | DB job (runner PostgreSQL, restricted role): **1,266 passed · 0 failed**, the drill alone in its own step 1 / 1, no-skip guard ✓ — includes `guardian-link-db.test.ts` 16 / 16; quality job: tsc, every ratchet (as-any 3,425 ≤ 3,429), **991** unit tests, lint; mobile ✓ |
| Local guards | `tsc`, lint and 12 ratchets / checks 0; `migrate-all --check` 284 applied, 0 pending, 0 blockers; emergency drill 1 / 1; migration immutability drill 0 failures |
| Local full DB suite | 1,265 passed, 2 skipped (the drill, run alone, and the one local-only skip seen on every local run since B-1; real CI skips none) + the sweep test 2 / 2 |
| FS-7, P0, 3L, legacy nine files | identical to the `d7aa60a8` baseline: FS-7 legacy fingerprint unchanged before / after, collision firm 6 quarantined / 1,055 matched (split between the two files follows the per-build random ids); P0 legacy / clean / scope identical (21 / 21 figures); 3L identical (ids and times aside); the nine-file legacy run identical — and `main` `b795fdba` gives the same legacy figures as `f563e7ac` (that harness uses the direct importer, so main's worker-side sweep is covered by the DB test above) |
| Infrastructure harness | **43 / 43** (real Next, Chromium, S3 emulator, Redis, killable workers, crash / outage / halt drills) |
| Browser (validate-first screens) | **17 / 17** — same figures as before (3 active SIPs = verified registrations, 13 registrar captions, 24 held, 0 resolvable) |
| G-1 browser check (`scripts/g1-guardian-ui.mjs`) on the hotfix head `c046ecfc` | 21 / 21 |

**Effect of the G-1 merge on the RTA figures, measured separately** (the
financial harnesses on `7ed48d2d` = `d7aa60a8` + `f086c294` + G-1): FS-7, P0
21 / 21, 3L and the nine-file legacy run identical to the `d7aa60a8` baseline
(only per-build random ids differ; the FS-7 collision firm's 6 altered rows are
picked by id order, so which file they fall in varies, total 6 quarantined,
1,055 matched, legacy fingerprint unchanged before / after).
