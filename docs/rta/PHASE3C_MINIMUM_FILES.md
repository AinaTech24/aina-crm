# RTA Phase 3C — Minimum RTA files for eight reliable CRM modules

Status: **analysis for approval.** No database, import-engine or production
change was made in this phase. Date: 2026-10-08.

## 0. Evidence base — read this first

| Evidence | Status |
|---|---|
| CAMS R2, CAMS R9, KFintech MFSD201, KFintech MFSD211 (the four mailbacks verified in Phases 2B / 3B) | **Real files, verified.** |
| CAMS WBR4 / WBR49 / WBR10; KFintech MFSD203 / MFSD230 / MFSD243 and the newer MFSD201 / MFSD211 | **Not received.** They are not attached to this session. Every statement about them below is **UNVERIFIED**. Figures quoted for them are the user's observations, not mine. No synthetic file was used in their place. |
| Registrar report definitions | KFintech's Distributor Services Manual and CAMS pages are unreachable from this environment (DNS refused). Definitions are taken from search excerpts of those documents and an AMC handbook, cited in the report. They are not authoritative for field layouts. |

### Facts measured on the four real files (aggregates only)

| | CAMS R2 | CAMS R9 | KFin MFSD201 | KFin MFSD211 |
|---|---|---|---|---|
| Rows · columns | 1,334 · 80 | 1,237 · 101 | 819 · 87 | 648 · 129 |
| Period / as-of | trade 2026-05-04 → 05-17; report date 05-18 | as of 2026-05-18 (one date) | trade 2026-04-30 → 05-15; report date 05-18 | report date 2026-05-18 |
| ARN scope | 1 broker code | 1 broker code | 1 agent code | 1 broker code |
| AMCs · folios | 15 · 1,164 | 15 · 1,178 | 15 · 625 | 16 · 633 |
| Holdings | — | `clos_bal` units and `rupee_bal` value on 1,237/1,237 rows; **no NAV column**; 19 zero-unit rows | — | **no units, value or NAV column at all** |
| SIP fields | `siptrxnno` (1,189 distinct), `sys_regn_date`. No amount, frequency, end date or status. | — | `sipregslno` (618 distinct), `SIP Regn Date`. No amount, frequency, end date or status. | — |
| Status / rejection | `trxnstat` = Y on 1,334/1,334; `reversal_code`, `original_trxnno`, `rev_remark` and `remarks` all empty | — | `Transaction Status` = Y on 819/819; 3 pre-rejection codes (SIND / STPAD / STPOD); `RejTrnoOrgNo` empty | — |
| Master fields | name 1,237; PAN 1,216; joint PAN 135 / 2; guardian 21; email 1,225; mobile 1,235; bank, nominee, tax status | name 648; PAN 640; PAN2 68; guardian 8; email 646; mobile 645; CKYC 630; tax status | — | (same row as master fields) |

**Scope finding (critical for AUM).** Both "master / holdings" samples cover almost exactly the folios that transacted in the same short window:

- **CAMS:** 1,164 of R9's 1,178 folios (98.8 %) appear in the 11-day R2 feed. Only 14 R9 folios have no transaction.
- **KFintech:** 625 of MFSD211's 633 folios (98.7 %) appear in MFSD201.
- **Interpretation:** it is implausible that 99 % of a whole book transacted in two weeks. These samples are almost certainly **period / activity-scoped**, not full-book.
- **Corroboration:** the user's observation that the newer MFSD211 has 384 rows against MFSD203's 1,943 scheme-folio rows points the same way.
- **Consequence:** **neither sample can prove firm-wide AUM, and a master import must never be read as "clients absent from it no longer exist".**

## 1. Report roles (provisional where marked)

### CAMS

| Report | Role for the eight modules | Classification | Evidence |
|---|---|---|---|
| **R2 (WBR2-format transactions)** | Transactions; SIP instalments (via `siptrxnno`) | **CORE**, recurring | Verified. 1,334/1,334 rows staged and reconciled. The legacy importer agrees on all 1,334. |
| **R9 (WBR9 static + unit balance)** | Client master; holdings (units, value, as-of) | **CORE**, but only when **requested as a full-book, as-on statement** | Fields verified. The sample's scope looks activity-scoped, so full-book scope is **UNVERIFIED**. It has no NAV column: NAV = value ÷ units is a *derived* value and is undefined for zero units. |
| WBR4 | Investor / holding fields (user: 8 rows) | **UNVERIFIED**. A REDUNDANT candidate if a full-book R9 is taken. | Not received. With 8 rows it cannot be a full book. |
| WBR10 | Transactions (user: 10 rows) | **UNVERIFIED**. A REDUNDANT candidate. | Not received. It is redundant only if every one of its transactions is in R2 for the same window. That must be checked against the file, not assumed from similar columns. |
| WBR49 | SIP / STP registrations | **CORE candidate, UNVERIFIED** | R2 has no SIP amount, frequency, dates or status, so the CAMS SIP Master needs a registration source. One handbook names WBR49 "SIP/STP procured for the period". If so, it is a *period* report of new registrations, not a status register. |
| CAMS SIP cessation / non-operational report (the user names WBR50) | SIP stop / expiry | **CONDITIONAL → probably required** | No verified CAMS file gives SIP status. Without it, CAMS SIPs can only be ACTIVE-by-registration or UNKNOWN. |
| CAMS transaction / SIP rejection source | Transaction rejection, SIP instalment rejection | **MISSING evidence** | R2 carried **zero** rejected, reversed or remarked rows in 1,334 SIP-heavy transactions over 11 days. That suggests R2 as delivered excludes failed debits. The user's WBR46 is described as unprocessed transactions. It is unverified whether that is the rejection source. |

### KFintech

| Report | Role | Classification | Evidence |
|---|---|---|---|
| **MFSD201** | Transactions; redemption lots; transaction rejections | **CORE**, recurring | Verified on the original sample (819 rows, 9 groups / 143 lots). The newer sample's rejection codes (SINR / FULR / NEWR) are **UNVERIFIED** (§5). |
| **MFSD203** | Holdings / AUM (+ "master details of active clients" per the manual) | **CORE**, required | MFSD211 has **no holdings columns** (verified), so KFintech AUM cannot come from any other verified file. Layout and scope are UNVERIFIED (user: 1,943 rows, 329 zero-unit, as of 08/10/2026). |
| **MFSD211** | Client master (contacts, joint holders, guardian, bank, nominee, KYC) | **CORE** until MFSD203's master columns are verified. INITIAL plus each period's new clients after that. | Fields verified. Scope is activity-scoped (above). Whether MFSD203 carries joint holders, guardian and contacts is UNVERIFIED. |
| **MFSD230** | SIP / STP register | **CORE candidate, UNVERIFIED** | Manual: "insights about your SIPs/STPs". User: 20 rows (16 SIP + 4 STP). Whether it lists terminated / paused / expired SIPs with dates decides whether 231 / 229 are needed. |
| MFSD243 | SIPs / STPs / SWPs registered in a period | **REDUNDANT candidate, UNVERIFIED** | Manual: "registered during the selected period". User: 9 rows, all Live, no termination dates. If MFSD230 is an as-on register, 243 adds only registration-date detail. |
| MFSD231 (termination / pause), MFSD229 (closed) | SIP stop, pause, expiry | **CONDITIONAL**. Required if MFSD230 lacks status and dates. | Manual descriptions only. |
| MFSD244 (registration rejections) | SIP registration rejected | **CONDITIONAL**. Required for that event. | A rejected registration produces no transaction, so MFSD201 cannot report it. |
| MFSD228 (SIP transaction-level rejections) | SIP instalment rejected | **REDUNDANT if** MFSD201's SINR rows prove complete | UNVERIFIED (§5). |

## 2. Eight-module accuracy matrix (from verified evidence only)

| Module | Status | Why |
|---|---|---|
| 1 Client Master | **PARTIAL** | All needed fields are present in R9 / MFSD211, but both samples are activity-scoped, so "complete client list" is unproven. **Defect found:** a minor's folio missing from the master is attached to the guardian (§6.2). |
| 2 Right AUM | **CAMS PARTIAL · KFin MISSING** | **CAMS:** R9 units and value as of one date, with 19 zero rows kept; staged Σ = source Σ (2,245,676.925 units; ₹119,400,802.05). Full-book scope is unproven and the file has no NAV. **KFin:** no verified holdings file (MFSD203 not received). |
| 3 Right SIP Book | **MISSING** | No verified file carries SIP amount, frequency, status or end date. The transaction feeds only *imply* registrations (1,189 CAMS and 618 KFin references seen in the window). An unexpired registration is not proof of ACTIVE. |
| 4 Client Portfolio | **CAMS PARTIAL · KFin MISSING** | Same as AUM. Folio-level sums reconcile (Phase 2B: R9 1,237/1,237 legs matched on units and value). Cost, gains and XIRR are **not derivable**: only a 2-week transaction window exists. |
| 5 SIP Rejection / Stop | **MISSING** | **CAMS:** none of the 1,334 R2 rows is rejected, reversed or remarked. **KFin:** 3 pre-rejections, unlinked. No stop, pause or expiry event in any verified file. |
| 6 Transactions | **COMPLETE for the observed classes** (shadow) | Every row is accounted for. The classes are SIP, purchase, redemption, SWP and STP in/out. Multi-lot redemptions are 9 groups, not 143. Overlapping periods are counted once (§6.4). IDCW, ordinary switches and reversals are unobserved and held. |
| 7 Transaction Rejection | **PARTIAL / UNVERIFIED** | **KFin:** pre-rejections held; the newer sample's SINR / FULR / NEWR not verified. **CAMS:** no rejection evidence at all. |
| 8 SIP Master | **MISSING** | Needs a registration source (WBR49 / MFSD230). Unverified. |

## 3. Business acceptance tests (defined; what ran)

| # | Test: "the CRM shows exactly what the selected files say" | Ran on real data? |
|---|---|---|
| T1 | Client Master: every (AMC, folio) in the master and holdings files maps to exactly one client by PAN, folio or guardian rule. No client is identified by name or phone. Clients absent from a partial master keep their folios and holdings. | Partly: the identity rules ran (2,124 folio+PAN, 22 folio+guardian, 7 folio-only matches, 0 conflicts). The minor defect reproduced (§6.2). |
| T2 | AUM: Σ(latest full-book position value) per RTA equals the source total, with as-of dates shown per RTA. Zero rows are kept. An older statement never replaces a newer one. | CAMS sums equal the source. Full-book scope cannot be tested (no full-book file). |
| T3 | SIP Book: every ACTIVE SIP has a registration row with an authoritative live status as of date D. Anything else is UNKNOWN. | Blocked: no registration file. |
| T4 | Portfolio: Σ scheme values per client equals Σ source values for that client's folios. No cost or return is shown without full history. | CAMS reconciled in Phase 2B. KFin blocked. |
| T5 | SIP Rejection / Stop: each event type maps to its distinct meaning. One failed instalment never stops a SIP. | Blocked: no event file. |
| T6 | Transactions: one economic event per registrar transaction. Lots are kept. Overlaps are deduplicated. | **Ran**: R2 1,334 → 1,334; MFSD201 819 rows → 685 transactions (9 groups / 143 lots). Overlap split counted once. The legacy importer matches all 1,334 R2 transactions and 669 MFSD201 ones. |
| T7 | Rejection never inflates investment: a rejected row is never counted as gross purchase or SIP. | Staging: yes (held). **Legacy: at risk** (§5). |
| T8 | SIP Master preserves registration history: one row per registration ID and an append-only lifecycle. | Blocked: no registration file. |

## 4. SIP Book and SIP Master design (one dataset, two views)

- **`sip_registrations`:** one row per (RTA, AMC, registration ID).
  - Columns: folio, scheme, kind (SIP / STP / SWP), amount, frequency, start, end, the registrar's status text, and `status_as_of`.
  - Every field is source-reported, with the batch and row it came from.
- **`sip_lifecycle_events`** (append-only), with these event types:
  - `registered` (registration report);
  - `registration_rejected` (MFSD244, or the CAMS equivalent);
  - `instalment_processed` / `instalment_rejected` (transaction feeds, keyed by `siptrxnno` / `sipregslno`);
  - `paused` / `resumed` / `terminated` / `closed` (MFSD231 / 229, or the CAMS cessation report);
  - `expired`: a state reached when the end date has passed and the registrar's status is no longer live. It is never recorded on the date arithmetic alone.
- **Status on date D** is derived from the latest authoritative status event on or before D:

| Status | Rule |
|---|---|
| ACTIVE | A registrar status of "live" / "active" as of a date not older than the register's freshness limit, with no later stop, pause or termination. |
| PAUSED / STOPPED / EXPIRED | The corresponding authoritative event. |
| REJECTED | `registration_rejected`. |
| PENDING | Registered with a future start and no processed instalment. |
| UNKNOWN | Everything else: a registration seen only through instalments, or a stale status. **Never shown as ACTIVE.** |

- **A rejected instalment is an event, not a status.** Only a registrar stop or termination changes status. A "n consecutive failures" rule would be a *flag*, never a stop.
- **Views:** the SIP Book is `status = ACTIVE as of D`; the SIP Master is all registrations with their history. Both read the same two tables.

## 5. Rejection coverage

- **CAMS R2:** no rejection data in the verified sample (§0). Whether rejected and bounced SIP debits appear in R2 at all is the largest open CAMS question.
- **KFintech MFSD201:** carries rejection *rows*. The 3 pre-rejections are verified. The newer sample's SINR / FULR / NEWR are reported by the user with `Transaction Status = Y`.
  - **Code test (no real file):** the existing importer reads MFSD201's `Transaction Head` (P/R) and description, never the `Transaction Type` code.
    - A rejection row whose description does **not** say "rejection" is **booked as a successful SIP, redemption or purchase**.
    - A row whose description does say it is held.
  - Staging holds SINR / FULR / NEWR as unknown codes. That is safe, but they don't yet reach the rejection module.
  - The newer sample decides which case applies.

## 6. Shadow-architecture review (Part 6)

1. **Shadow runs after the legacy importer.** Legacy writes therefore happen regardless; shadow cannot block them today.
   - **Future gate:** per (tenant, report type), exactly one writer.
   - Under "on", staging runs **first**, and the legacy write path is not called.
   - Posting happens only from `complete` transactions. A batch with a failing blocking check posts nothing.
   - Switch one report type at a time, with the legacy path kept as the rollback.
2. **Minor folio attached to the guardian — CONFIRMED defect (real files).** Scenario: the master contains every folio except the 19 minor folios.
   - **Existing importer:** put **all 19 minor folios (22 transactions) on adult-PAN client records**. It either created a client from the guardian's PAN or used the existing guardian.
   - **Staging:** proposed `pan_only` for 4 of the 22 rows (the rest were unmatched).
   - **Fix:** a row whose own tax status says minor (R2 `tax_status` "On Behalf of Minor"; KFin `Status` MINOR / "MINOR THROUGH GUARDIAN"; or a guardian PAN present) is **never resolved by PAN**. With no folio match it is held, or it gets a folio-keyed minor placeholder. It is never attached to the guardian.
3. **Redemption tolerances are justified.**
   - Across 165 real lots: max |Δ| ₹0.7008; median ₹0.0024.
   - The largest is 0.000491 units × NAV ₹1,428, inside the half-unit (0.0005) bound of 3-decimal units.
   - Max Δ / tolerance is 0.968; p95 is 0.355. 5 lots exceed half their tolerance, every one explained by units rounding at a high NAV.
   - Groups: |Δ| ≤ ₹0.036.
   - The tolerance is a derived bound. It is not loosened, and it has thin headroom by design.
4. **Repeats across different report periods were tested on real data.**
   - **MFSD201:** split by trade date into two windows sharing 5 days and 450 rows. Result: 685 distinct transactions counted once. Window B had 338 duplicates (including 6 redemption groups) and 125 new.
   - **R2:** split the same way, with 637 shared rows. Result: 1,334 counted once.
   - **Open posting risk:** a lot group split *across* two files would post the first part as complete. In the real data a group shares its trade and process dates, so date-windowed files keep a group whole. Posting must still hold a later `restated`.
5. **Failure visibility: GAP.**
   - A failed or exception batch is recorded on its row (state, error, stage log) and in the checks, and is readable only through `GET /api/rta-staging/batches`.
   - The worker discards the hook's result. A failure is a `console.warn` only: there is no admin screen and no notification.
6. **Unrecognised mode: GAP.**
   - A typo or `on` falls back to `off`, which is safe, with a `refused` message that nobody reads.
   - It should be a configuration error raised at worker start, and reported by the health check.

## 7. Minimum file sets (provisional until the samples are verified)

- **Minimum recurring set:**
  - CAMS: **R2 · R9 (full-book) · WBR49** + one CAMS SIP status / cessation source + one CAMS rejection source (the last two pending evidence).
  - KFin: **MFSD201 · MFSD203 · MFSD230** + MFSD211 (new clients) + MFSD231 / 229 only if 230 lacks status.
- **Minimum initial set:**
  - Full-book R9 and MFSD203 as on one date, and a full-book master.
  - The current SIP register (WBR49 for the full period / MFSD230).
  - Transaction history only as far back as the modules shown need. Without full history, no cost or return is displayed, by design.
- **Frequency** (the sample windows are ~2 weeks, report-dated the next day):
  - Transactions weekly, with ≥ 3 days of overlap (duplicates are proven safe).
  - Holdings full-book month-end, plus weekly if AUM freshness is required.
  - SIP register and stop reports weekly.
  - Registration rejections weekly.

## 8. Smallest development plan

| Priority | Change | New tables? |
|---|---|---|
| P0 safety | Minor / guardian rule in legacy + staging (§6.2); MFSD201 must read the `Transaction Type` code and hold R-suffix rejection codes (§5); mode misconfiguration raises an error (§6.6); failed shadow batches visible on the Imports page (§6.5) | No |
| P1 | Recognise the received layouts in staging (one layout entry + normalizer each); run shadow; measure scope and overlap | No |
| P2 | Holdings snapshots: statement (RTA, ARN, as-of, full-book flag, source batch) + positions. AUM and Portfolio read the latest full-book statement per RTA. | 2 (required by modules, not per report) |
| P3 | SIP registrations + lifecycle events (§4). SIP Book and SIP Master are views. | 2 |
| P4 | Posting gate (§6.1): a separate approval | Columns only |

## 9. Missing evidence (only what blocks an essential module)

1. **The eight new samples themselves.** They are not in this session. They are required for every UNVERIFIED cell above.
2. **One full-book holdings statement per RTA**: R9 for all folios as on a date, and MFSD203 for all funds. These prove AUM completeness. The newer MFSD203 may already be one.
3. **CAMS:** one sample that shows SIP cessation / non-operational status, and one that shows rejected SIP debits. These are needed only if WBR49 and R2 do not carry them.
4. **KFintech:** MFSD231 (or 229), only if MFSD230 lacks terminated / paused status; MFSD244, only if SIP registration rejections must be shown.
