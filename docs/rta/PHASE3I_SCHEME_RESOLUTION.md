# Phase 3I — Scheme Master resolution and final pilot readiness

**Status:** development and evidence only. Nothing was merged or deployed, no production data was touched, and no firm was activated.

**Decision asked for:** whether the existing Scheme Master can reliably resolve registrar schemes, and what the first pilot must satisfy before it starts.

**Short answer:**
- The resolution machinery is built and tested end to end.
- **No real registrar code is verified against AMFI yet**: this environment cannot reach AMFI (§A).
- The recommendation is **NO-GO for activation today**. A **conditional GO** applies to a narrow, time-bounded KFintech-only transaction pilot once the release conditions in §J are met.

Evidence sources:
- Real files: the twelve RTA files of Phases 2B–3H, in the scratch area. They are never committed, and only aggregates are reported.
- Isolated database: `rta_verify3i`, built from an empty database by `migrate:all` (278 files).
- DB tests: run on the development database under the non-superuser `mfd_app` role.
- Synthetic fixtures: in AMFI's and the registrars' published layouts, used in tests only — never as reference data.

---

## A. AMFI feed compatibility

**Network: BLOCKED.** From this environment:
- `https://portal.amfiindia.com/spages/NAVAll.txt` → the egress proxy refuses the tunnel (`CONNECT … 403`).
- `www.amfiindia.com` (both the NAV download page and `/spages/NAVAll.txt`) → the same.
- `api.mfapi.in` → the same.

**No AMFI file was read in Phase 3I.** None was invented or substituted from a third party. Every AMFI-dependent result below is therefore **NOT VERIFIED**.

To unblock, one of these:
- Allow `portal.amfiindia.com` in the environment's network settings (Network access → Allowed domains).
- Supply an unmodified download as a file:
  `ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --note "<who downloaded it, when, from where>" --check`
  then the same command without `--check`.

**What the reader does now** (`src/lib/finance/nav-feed.ts`, `analyseNavAll` / `importNavAll`):

| Check | Behaviour | Test |
|---|---|---|
| Decoding | UTF-8 only; a byte-order mark is stripped; `amfi-import.ts` refuses a file with replacement characters | `rta-scheme-mapping-3i.test.ts` |
| Header and columns | The header must be one of AMFI's two published layouts, column for column: **current8** (`Scheme Code; ISIN Div Payout/ ISIN Growth; ISIN Div Reinvestment; Scheme Name; Plan; Option; Net Asset Value; Date`) or **legacy6** (without Plan / Option). Anything else — reordered, renamed, missing — accepts **nothing**. A data row with the wrong column count is counted as malformed, never shifted | pure + DB |
| Both ISIN columns | Kept exactly as printed: `isin_payout_growth` and `isin_reinvest`. Each is format-checked (`IN` + 9 + check digit); a bad one is dropped and counted. The compatibility `isin` column keeps its old meaning (payout / growth, else reinvestment) | pure + DB |
| Scheme code, plan, option | Explicit `plan` / `option_name` columns are stored when the layout prints them (null for legacy6 — never guessed). The composite `scheme_name` is unchanged for existing readers | pure + DB |
| NAV value and date | Stored as printed with the scheme's own date. `N.A.` is "no NAV": the identity is recorded in `amfi_feed_imports.unpriced` and never priced. The **feed date** is the newest date printed, never "today" | pure + DB |
| Old NAV is not current | `RTA_NAV_MAX_AGE_DAYS` (default 7). A file older than that is refused unless `--allow-stale` (a deliberate historical load). **Even then an older file never overwrites a newer NAV or identity** (row-level `nav_date <=` guard). Validate-first transactions and evidence-tracked holdings are valued only at a NAV inside the window (`valuation.ts`, `aum-persist.ts`) | DB |
| Inactive / historical | `first_seen_feed` / `last_seen_feed` per scheme. A scheme absent from the latest applied feed is **inactive**: its mapping stays valid for history (`isin_verified_historical`), and its NAV is not current. A scheme listed **without** a NAV is still listed, not inactive | DB |
| Duplicates / ambiguity | A code printed twice identically is read once. Printed twice with different ISINs, plan, option or NAV, the whole file is refused. An ISIN printed for two codes is reported, and any registrar code carrying that ISIN is held as `isin_ambiguous` | pure + DB |
| AMC name changes | AMC names are compared without legal suffixes (`Mutual Fund`, `Asset Management Company Limited` …). A scheme keeps the AMC name of the last feed that listed it | pure |
| Provenance | Every attempt — applied or refused — is a row in `amfi_feed_imports` with source, file reference, **SHA-256**, bytes, header, layout, feed date, counts, refusal reason, operator and note. AMFI publishes no signature: the hash and the operator's note are the audit trail | DB |
| Backward compatibility | The daily worker (`refreshNav`) and *Sync from AMFI* (`/api/schemes/sync`) now go through the same validated path. A refused feed **throws / answers 502** instead of writing nothing quietly | typecheck + suite |
| Re-deciding | After an applied feed, every firm's registrar codes are re-decided against it (`redecideEverywhere`) | DB |

**Unverified until a real file is read:**
- AMFI's exact header punctuation. The reader accepts `ISIN Div Payout/ ISIN Growth` with or without the spaces. Anything else is refused visibly, never misread.
- AMFI's exact Plan / Option vocabulary.

## B. Scheme Master integration changes

**No new Scheme Master.** The one scheme reference stays the **AMFI scheme code**:
- `scheme_nav` is the platform AMFI reference.
- Each firm's `scheme_master` is keyed by it.

Additions, all additive (migrations **0239** and **0240**; 0233–0238 untouched; both locked in `checksums.lock.json`):

| Object | What it is | Not |
|---|---|---|
| `scheme_nav` + `isin_payout_growth`, `plan`, `option_name`, `first_seen_feed`, `last_seen_feed` | AMFI's columns as printed | no new scheme rows, no renamed codes |
| `amfi_feed_imports` (platform) | provenance of each AMFI file | not reference data |
| `scheme_registrar_map` + `_events` (platform, events append-only) | registrar code → AMFI scheme code, the same for every firm: **verified** by the registrar's own ISIN, or **approved** by two platform operators (CHECK: different people, note ≥ 10 characters). No firm id, no names, no NAVs | not a scheme list |
| `scheme_rta_codes` + `reason_code`, `review_state`, `review_note`, `reviewed_by/at`, `rejected_candidates`, `evidence_source` (per firm, RLS) | the review trail | — |
| 0240: `scheme_rta_codes_confirm_ck` | also accepts `confirmed` with `reason_code = 'platform_approved'` (the approval lives in the platform tables) | every firm confirmation still needs person, time and note |

Preserved, as required:
- Internal ids, every existing record, and AMC relationships.
- Transactions and holdings: nothing is rewritten retroactively. "No automatic historical repair" is tested: revoking a mapping leaves posted rows as they are.
- Historical NAV references and tenant isolation.

The one in-place change is to **holdings legs** stamped by the validate-first path. When a code's decision changes, its legs follow:
- A resolved leg takes the AMFI code.
- An unresolved leg returns to its registrar code and the registrar's own stated value and NAV.
- The registrar fields (`rtaSchemeCode`, `sourceUnits`, `sourceValue`, `sourceAsOf`) are never touched.

**AMC-rename duplicates — proposed, not done:**
- `scheme_master` is unique on `(tenant, amc_code, scheme_code)`, and *Sync from AMFI* fills `amc_code` with AMFI's AMC **name**. An AMC rename therefore adds a second row for the same scheme code.
- `scripts/scheme-master-duplicates.ts` (**read-only**) lists the duplicates per firm. It proposes as survivor the row whose AMC name is AMFI's current one, and lists shortlist / IC-scorecard data a cleanup must carry over.
- It never pairs rows by name.
- It found 0 here: the development database has no `scheme_master` rows, so **not measured**. Run it on a production read replica.

## C. KFintech — the 219 codes

The rule (`src/lib/rta/scheme-evidence.ts`, pure, 17 tests). A code resolves only when ALL of these hold:
- The registrar printed exactly one ISIN for it.
- That ISIN is on exactly one AMFI scheme, in either column.
- The AMFI scheme's AMC is the registrar AMC's, as its other codes establish it.
- No explicit Direct/Regular, Growth/IDCW or IDCW payout/reinvestment word the registrar printed contradicts AMFI's. AMFI's explicit columns are used first, and the ISIN column decides payout vs reinvestment. Words that are part of the scheme's own name ("Regular Savings", "Growth Opportunities", "Dividend Yield") are ignored.
- No platform mapping says otherwise.

A clean result is recorded once for the platform (`verified`), so another firm whose file prints no ISIN for the same code resolves too (`global_isin`).

Real files — **results against AMFI: NOT VERIFIED** (no feed, §A):

| Category | Codes | Basis |
|---|---|---|
| verified | **0** | no AMFI feed |
| already approved | 0 | — |
| ambiguous | 0 known (unknowable until the feed is read) | — |
| missing reference | **219** (`isin_not_in_feed`) | the feed is empty here |
| conflicting | 0 known | — |
| historical / inactive | 0 known | — |

What the deterministic rule will have to work with, measured on the real files without AMFI:
- **219 / 219** codes carry exactly one ISIN; 0 carry none or several; 0 malformed; 0 ISINs shared by two codes.
- **22** registrar AMCs in the staged data (3H's raw-file count of 23 came from a counting artefact).
- **17** of them print ISINs from one issuer prefix.
- **5** (AMC codes 105, 118, 129, 176, 178; **43 codes**, 101 economic transactions, ₹1,40,55,242.72 source-reported AUM) print ISINs from **two** issuer prefixes. This is normal when an AMC was merged or renamed. If AMFI then names two AMCs, every code under that registrar AMC is held as `amc_mismatch` for a two-operator platform approval.
- Explicit words in the registrar description: plan on 96 codes, option on 72, payout / reinvestment on 0. These are cross-checked, never used to choose.

**Do not assume all 219 will succeed.** The expected outcome is a large majority verified, with the five multi-issuer AMCs and any AMFI-side ambiguity held. That expectation is unproven until the feed is read.

## D. CAMS — the 164 codes and manual reviews

CAMS prints no ISIN in R2, R9, WBR4, WBR10 or WBR49 (0 of 164 codes). Evidence considered, as the brief asks:

| Source | Finding |
|---|---|
| Historical mappings | The legacy path matched CAMS schemes **by name** (`scheme-match`) — not evidence; not used |
| Verified internal references | No CRM column relates a CAMS product code to an AMFI code |
| Official registrar-code relationships | None in the files held; no new report is requested (no demonstrated need beyond the review below) |
| Admin-approved mappings | The platform approval route now exists; none made |
| Codes unused in the pilot scope | **3** of 164 carry no money (no transaction, no holding value, no live SIP); **159** are currently held or live |

All 164 are `unresolved / no_isin` and wait on a person. To keep that work small:
- **35 codes cover 80 %** of the CAMS money (transaction amount + registrar holding value); **78 cover 95 %**; 161 carry any money.
- Codes are grouped by CAMS AMC (15 AMCs) on the Scheme codes screen, ordered by held transactions.
- **One** platform approval per code serves every firm.

The Scheme codes screen (`/dashboard/rta-imports/schemes`) now has, per code:
- The registrar's evidence: description, ISIN or "no ISIN printed", held transactions, and the registrar AMC's established AMFI AMC (or "not established yet").
- **Candidates**, evidence first: platform mapping → same ISIN → name suggestions. Name suggestions are drawn **only from the established AMC**, filtered by explicit plan / option words, labelled "Name suggestion — check a document", and never applied.
- Warnings on each candidate: inactive, AMC differs, plan / option contradiction, already mapped from another code, stale NAV.
- Three decisions:
  - **Approve**, with an evidence source (AMC scheme list, registrar statement, client CAS, factsheet / SID, other) and a note.
  - **Reject a candidate**: it is never proposed again for that code.
  - **Defer**, saying what is awaited; the transactions stay held.
- Each decision is in the firm's audit log (`rta.scheme.confirm` / `reject_candidate` / `defer` / `undefer`).
- Conflict detection: the server refuses an approval that the registrar's ISIN, a platform mapping, the registrar AMC's identity or explicit words contradict.

Browser check on the real-file database (`rta_verify3i`), at 1280 and 375 px:
- 383 rows: 164 "No ISIN printed" and 219 "ISIN not in the AMFI feed".
- The review card opens full width with the AMFI search, evidence select, note, Approve (disabled until complete) and Defer.
- 0 page errors, 0 console errors, no sideways scroll.

Platform approval is `POST /api/super-admin/scheme-mappings`:
- Approve needs a requester who is a different active operator. Revoke needs one operator.
- Both write append-only events, re-decide every firm holding the code, and re-evaluate their held transactions.

## E. Mapping completeness — amount, transactions, holdings, SIPs (real files, gate on)

The controlled pilot setting (`RTA_POSTING_MODE=controlled`, the scheme gate always on), production file order, **empty AMFI feed**:

| Registrar | AMC code | Codes (mapped / unmapped) | Source rows | Economic txns (held on scheme) | Amount held on scheme | SIP registrations | Holdings legs | Source-reported AUM (unmapped) |
|---|---|---|---|---|---|---|---|---|
| CAMS | B | 10 (0 / 10) | 23 | 12 (12) | ₹54,366.68 | 10 | 11 | ₹15,63,250.30 |
| CAMS | D | 12 (0 / 12) | 91 | 46 (46) | ₹4,46,980.18 | 43 | 45 | ₹51,94,896.29 |
| CAMS | FTI | 5 (0 / 5) | 20 | 12 (12) | ₹19,60,348.93 | 3 | 8 | ₹20,00,575.74 |
| CAMS | G | 7 (0 / 7) | 82 | 42 (42) | ₹1,65,850.02 | 39 | 40 | ₹22,58,040.81 |
| CAMS | H | 28 (0 / 28) | 526 | 277 (277) | ₹19,14,166.76 | 239 | 249 | ₹2,21,66,952.14 |
| CAMS | HLS | 2 (0 / 2) | 8 | 4 (4) | ₹11,499.43 | 4 | 4 | ₹2,48,544.50 |
| CAMS | IF | 2 (0 / 2) | 27 | 14 (4) | ₹2,11,989.40 | 4 | 10 | ₹7,63,977.67 |
| CAMS | K | 17 (0 / 17) | 197 | 102 (102) | ₹11,64,840.74 | 94 | 95 | ₹1,06,92,411.57 |
| CAMS | L | 18 (0 / 18) | 184 | 92 (92) | ₹10,45,248.86 | 88 | 92 | ₹90,01,133.91 |
| CAMS | MM | 3 (0 / 3) | 18 | 9 (9) | ₹25,598.73 | 9 | 9 | ₹3,77,274.97 |
| CAMS | O | 4 (0 / 4) | 16 | 8 (8) | ₹19,999.01 | 7 | 8 | ₹6,24,504.13 |
| CAMS | P | 32 (0 / 32) | 608 | 317 (317) | ₹24,21,827.92 | 274 | 291 | ₹2,83,19,858.65 |
| CAMS | PP | 4 (0 / 4) | 307 | 156 (156) | ₹16,34,199.06 | 150 | 151 | ₹2,19,24,280.55 |
| CAMS | T | 9 (0 / 9) | 55 | 28 (28) | ₹75,696.25 | 28 | 27 | ₹15,78,531.49 |
| CAMS | Y | 11 (0 / 11) | 428 | 225 (225) | ₹17,07,017.27 | 196 | 203 | ₹1,28,84,284.57 |
| KFintech | 101 | 15 (0 / 15) | 170 | 42 (42) | ₹16,44,054.65 | 28 | 64 | ₹82,72,941.81 |
| KFintech | 102 | 1 (0 / 1) | 1 | 0 (0) | ₹0.00 | 0 | 1 | ₹5,616.84 |
| KFintech | 105 | 5 (0 / 5) | 31 | 7 (7) | ₹38,498.08 | 6 | 17 | ₹6,09,798.85 |
| KFintech | 108 | 8 (0 / 8) | 28 | 5 (5) | ₹71,496.43 | 3 | 17 | ₹19,10,210.37 |
| KFintech | 116 | 4 (0 / 4) | 15 | 1 (1) | ₹2,499.88 | 3 | 10 | ₹2,27,655.87 |
| KFintech | 117 | 17 (0 / 17) | 431 | 112 (112) | ₹7,47,999.04 | 73 | 189 | ₹1,50,76,250.02 |
| KFintech | 118 | 14 (0 / 14) | 246 | 59 (59) | ₹6,08,470.52 | 38 | 128 | ₹66,65,035.61 |
| KFintech | 120 | 19 (0 / 19) | 239 | 64 (63) | ₹13,12,734.42 | 46 | 104 | ₹71,85,554.77 |
| KFintech | 123 | 1 (0 / 1) | 1 | 0 (0) | ₹0.00 | 0 | 1 | ₹66,960.72 |
| KFintech | 125 | 4 (0 / 4) | 10 | 1 (0) | ₹0.00 | 0 | 5 | ₹6,56,769.46 |
| KFintech | 127 | 23 (0 / 23) | 639 | 173 (173) | ₹9,35,746.27 | 120 | 293 | ₹2,27,38,932.45 |
| KFintech | 128 | 19 (0 / 19) | 93 | 14 (14) | ₹1,07,996.16 | 10 | 64 | ₹40,89,593.77 |
| KFintech | 129 | 2 (0 / 2) | 17 | 4 (4) | ₹9,999.50 | 2 | 9 | ₹11,05,917.18 |
| KFintech | 152 | 2 (0 / 2) | 18 | 3 (3) | ₹12,999.60 | 2 | 10 | ₹4,35,666.81 |
| KFintech | 166 | 11 (0 / 11) | 198 | 35 (13) | ₹1,88,990.67 | 8 | 66 | ₹34,25,602.19 |
| KFintech | 172 | 1 (0 / 1) | 7 | 2 (2) | ₹22,998.85 | 2 | 3 | ₹1,84,623.22 |
| KFintech | 176 | 17 (0 / 17) | 101 | 25 (25) | ₹1,59,992.53 | 19 | 53 | ₹51,25,231.88 |
| KFintech | 178 | 5 (0 / 5) | 24 | 6 (6) | ₹39,998.00 | 4 | 12 | ₹5,49,259.20 |
| KFintech | 185 | 2 (0 / 2) | 19 | 2 (2) | ₹5,499.73 | 2 | 13 | ₹3,17,486.58 |
| KFintech | 188 | 3 (0 / 3) | 6 | 1 (1) | ₹7,499.63 | 1 | 4 | ₹3,09,493.16 |
| KFintech | 189 | 10 (0 / 10) | 528 | 134 (134) | ₹5,09,571.54 | 90 | 244 | ₹1,16,51,939.50 |
| KFintech | RMF | 36 (0 / 36) | 1,690 | 410 (410) | ₹38,12,694.98 | 290 | 638 | ₹5,61,00,140.42 |
| **CAMS total** | 15 AMCs | 164 (0 / 164) | 2,590 | 1,344 (1,334) | ₹1,28,59,629.24 | 1,188 | 1,243 | ₹11,95,98,517.29 |
| **KFintech total** | 22 AMCs | 219 (0 / 219) | 4,512 | 1,100 (1,076) | ₹1,02,39,740.48 | 747 | 1,945 | ₹14,67,10,680.68 |

Also held, for reasons other than the scheme:
- CAMS: 8 unknown transaction codes (₹56,997.16) and 2 non-financial events.
- KFintech: 18 folio-consolidation corrections (₹1,47,868.30) and 6 unknown codes (₹5,43,384.29).

Posted under the gate: **0 transactions, 0 SIPs, 0 SIP rejections**. Masters posted 1,193 clients and 2,978 folios, because masters do not depend on the scheme. Every scheme-dependent record is a visible held exception — nothing was attached to an unrelated scheme or NAV.

Verified SIP amount (registrations whose lifecycle is verified): CAMS ₹1,500, KFintech ₹12,500. The SIP-registration completeness gaps of Phase 3H are unchanged.

## F. Eight-module consistency (one verified scheme identity)

`tests/rta-scheme-mapping-3i-db.test.ts` (10 cases, synthetic AMFI and registrar rows in the real layouts). One KFintech code resolved by ISIN carries the same AMFI code — with the registrar code kept beside it — in:

| Module | Where |
|---|---|
| Transactions | `transactions.scheme_code` / `rta_scheme_code` |
| Transaction Rejection | the refused-instruction row (status rejected, 0 units) |
| SIP Rejection / Stop | `sip_rejections.scheme_code` / `rta_scheme_code` |
| SIP Master | `rta_sip_registrations.amfi_scheme_code` (+ registrar `scheme_code`) |
| Active SIP Book | `sips.scheme_code` / `rta_scheme_code` |
| Client Master (holdings legs) | leg `schemeCode` / `rtaSchemeCode` |
| Accurate AUM | the leg priced **by code** at the current NAV; the registrar's `sourceValue` kept beside it |
| Client Portfolio | `loadValuationRows` / `computeInvestorValuation`: one position for the scheme, current NAV |

Also proven:
- An unknown scheme never attaches to an unrelated scheme or its NAV — even an AMFI scheme with **exactly** the registrar's name, or the same name at another AMC.
- An unmapped holding keeps the registrar's units, value and date, labelled `unresolved`, and is never priced.
- A quarantined transaction has no CRM row and no ledger row, so it is not counted as posted.

## G. Historical / inactive schemes and NAV correctness

- An inactive scheme resolves by ISIN (`isin_verified_historical`): its history posts correctly. Its March-2025 NAV is **not** used as current — `latest_nav` is null in valuation and the leg keeps the registrar's value (DB test).
- A file older than the window is refused. Allowed as historical, it changes nothing newer (`written 0, keptNewer 2`).
- A future date is refused.
- A scheme listed without a NAV keeps its old NAV with its old date, and its `last_seen_feed` advances (DB test).
- Renamed scheme: the registrar's old name does not matter; the ISIN decides (DB test). Renamed AMC: §A / §B.

## H. Mapping exceptions and operator approval

| Exception (`reason_code`) | Where it shows | Who resolves |
|---|---|---|
| `no_isin`, `isin_not_in_feed`, `isin_unpriced` | Scheme codes → Review | firm person (approve with evidence / reject / defer) or platform approval |
| `isin_ambiguous`, `isins_differ` | Scheme codes (Conflict) | platform approval after review; a firm cannot confirm it away |
| `amc_mismatch`, `plan_option_mismatch` | Scheme codes (Conflict), reason shown | platform approval (two operators) |
| `global_conflict`, `confirm_contradicts_*` | Scheme codes (Conflict) | revoke the wrong mapping (one operator), then decide again |
| held transactions | Held screen, per code | post automatically when the code resolves (re-evaluation) |

Tested:
- Two operators are required (the function and a database CHECK).
- An operator cannot approve over a verified mapping ("revoke it first").
- A firm cannot confirm against a platform mapping.
- The events are append-only.
- Revocation returns every firm's code to unresolved and holds new imports, but repairs nothing.
- A firm's own confirmation stays the firm's; it is never promoted to the platform.
- Firm B never sees firm A's codes, candidates or ids (RLS and a 404).

## I. Production infrastructure and migration readiness (rechecked)

| Item | Status | Evidence / what is still needed |
|---|---|---|
| S3 (RTA file store) | **NOT VERIFIED** | No production access. The emulator integration test (3G) passes. Needs the bucket policy and encryption checked on the pilot account |
| SES (registrar mail) | **NOT VERIFIED** | No production access. `mail-trust` DKIM / DMARC rules tested (3G). Needs the receipt rule and the registrar sender domains |
| PostgreSQL RLS + worker role | **PASS (development)** | `check:rls` passes, and the suite runs as `mfd_app` (non-superuser, NOBYPASSRLS). Production `\du` not seen |
| Redis | **PARTIAL** | The producer refuses to buffer when Redis is down (3G test). Persistence and eviction policy on the pilot host are not verified |
| Migration checksums | **PASS** | 278 files locked. The immutability drill passes **14 / 14** on the full chain through 0240 (blocks an edited or missing applied file; detects a partial attempt; `--resume`; old data unchanged). 0239 / 0240 are new and additive; 0240's `VALIDATE` takes SHARE UPDATE EXCLUSIVE |
| Identity conflicts | **unchanged from 3H** | 0 folios with two owners; minor / HUF / guardian rules; 25 placeholders and 23 MINOR keys to review with the firm |
| Transaction reference uniqueness across AMCs | **PASS on the samples** | 0 registrar transaction numbers reused across AMCs in either registrar's files; 0 CRM `order_id` collisions. `transactions` UNIQUE(tenant, order_id) is unchanged — a reuse would be held, not lost; the schema change still needs approval if one appears |
| Holder and PAN-token handling | **unchanged** | `pt1:` HMAC tokens; staging refuses to run without a key; no PAN in clear in staging or `folio_holders`. 3I adds no PAN anywhere (platform mapping tables hold no person data) |
| Nightly reconciliation | **PASS (development)** | `reconcilePostingFirms` raises an error and an audit row on any difference (3H). Alert routing on the pilot host is not verified |
| Backup and recovery | **PARTIAL** | Batch reversal and undo drilled on the real files (3H). Production backup / PITR restore not tested here |
| Deployment instructions | **FIXED** | `docs/deploy-aws.md`, `docker-compose.prod.yml` and `README.md` told operators to run `db:push`. Now: `migrate:all` (proven on an empty database, 278 files), then `db:provision-app-role`; `db:push` is never to be used on a shared database |

Production verification is **not claimed** for anything marked NOT VERIFIED or PARTIAL.

## J. Smallest safe pilot

One firm, **14 days** (the activation's expiry is set; renewal needs two operators). It is a **transaction pilot for mapped KFintech schemes — not a validation of the eight-module CRM.**

| | |
|---|---|
| Mandatory reports | KFintech MFSD211 (masters) → MFSD203 (full-book holdings) → MFSD201 (transactions) → MFSD243 (registrations), in that order. CAMS R9 / R2 / WBR49 may be imported validate-first: masters post; every CAMS scheme-dependent record stays **held** (visible) until its code is approved. No new report types |
| AMCs / schemes in scope | KFintech codes that resolve `isin_verified` against a verified AMFI feed (≤ 7 days old, applied through `amfi-import` / the worker with its SHA-256 recorded). The five multi-issuer AMCs (43 codes) are in scope only for codes that pass the AMC check; the rest wait for platform approval |
| Scheme-dependent posting | Only on a resolved code (gate on under `RTA_POSTING_MODE=controlled`); everything else is held |
| Verified modules (for the pilot's KFintech scope) | Transactions, Transaction Rejection, SIP Rejection, Client Master |
| Partial modules — not to be presented as validated | Accurate AUM (registrar-dated; firm total withheld without full-book statements for every scope), Client Portfolio, SIP Master, Active SIP Book (registration completeness), anything CAMS-dependent |
| Operator exceptions | Held screen; Scheme codes screen (approve / reject / defer, with evidence); platform mappings (two operators); daily reconciliation alert |
| Halt | One operator: firm pause, firm halt, or EMERGENCY (every RTA write for every firm). Files are kept; jobs are parked and re-checked |
| Recovery | Dependency-aware batch reversal (newest first), undo, re-evaluation (3H drill) |
| Two-operator controls | Activation, release of any halt, platform mapping approval |

**Release conditions — all testable, all required:**
1. An authentic AMFI NAVAll applied on the pilot host. `amfi_feed_imports` shows `applied`, `current8`, a feed date ≤ 7 days old, ≥ 1,000 schemes, and the SHA-256 compared with a second independent download.
2. Every KFintech code in the pilot firm's files decided. **0 `unresolved` among codes with money in scope**; every `conflict` reviewed (approved or deliberately left held, with a note).
3. `migrate:all --check` on a copy of production shows 0 blockers, then 0239 and 0240 are applied.
4. The S3, SES, Redis, app-role, PAN-token key and alert items of §I verified on the pilot account, by someone with access.
5. The read-only historical diagnostics and `scheme-master-duplicates.ts` run on production for the pilot firm, and their findings reviewed with the firm.
6. A dry run on a copy of the firm's real data: the reconciliation monitor shows 0 differences after every import.

## K. GO / NO-GO

**NO-GO for activating any firm today.** Unresolved blockers:
1. **AMFI not verified here** — network blocked; 0 of 383 registrar codes verified against AMFI.
2. **CAMS: 164 codes need a person's approval** (161 carry money; 35 cover 80 %). Until then every CAMS transaction is held — ₹1,28,59,629.24 across 1,334 transactions in the samples.
3. **Infrastructure not verified on the pilot account**: S3, SES, Redis persistence, production role, backups / PITR, alert routing.
4. Inherited from 3H: no current CAMS full-book statement (firm AUM total withheld); SIP registration completeness; 14 unknown transaction codes; the `transactions` order_id uniqueness change if a cross-AMC reuse appears.

**Conditional GO** for the §J KFintech-only transaction pilot once release conditions 1–6 hold. It must be reported as "mapped KFintech transactions posted and reconciled", never as the eight-module CRM validated.

---

### Files

- **Migrations:** `0239_amfi_feed_and_verified_mappings.sql`, `0240_scheme_platform_confirmation.sql`.
- **Code:**
  - `src/lib/finance/nav-feed.ts` (strict reader + provenance import; the lenient parser removed) and `nav-age.ts` (the NAV-age rule, no DB imports).
  - `valuation.ts` and `aum-persist.ts` (stale-NAV rule).
  - `src/lib/rta/scheme-evidence.ts` (the pure rule) and `scheme-resolution.ts` (context, platform map, re-decide everywhere, leg restamp, confirm / reject / defer, candidates, platform approve / revoke).
- **APIs:**
  - `/api/rta-staging/schemes/[id]/candidates`, `/review`, `/confirm` (now with evidence source).
  - `/api/super-admin/scheme-mappings`.
  - `/api/schemes/sync` (now the validated import).
- **UI:** `SchemeCodesTable.tsx`.
- **Scripts:** `scripts/amfi-import.ts`, `scripts/scheme-master-duplicates.ts`.
- **Tests:** `tests/rta-scheme-mapping-3i.test.ts` (17), `tests/rta-scheme-mapping-3i-db.test.ts` (10), `tests/amfi-feed-import-db.test.ts` (4), `tests/scheme-map-cleanup.ts`.
- **Docs:** `docs/deploy-aws.md`, `docker-compose.prod.yml`, `README.md` (`db:push` → `migrate:all`).

**Regression:**
- `tsc` and `eslint` clean.
- All 12 `check:*` scripts pass.
- Vitest: **928 passed, 1 skipped** (80 files, run as `mfd_app`), plus `test:emergency` 1 / 1.
- Migration immutability drill 14 / 14.
- PII scan over the diff: 0 hits against 10,782 identifiers from the real files.
