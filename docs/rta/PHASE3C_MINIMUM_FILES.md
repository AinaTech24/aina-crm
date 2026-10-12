# RTA Phase 3C — Minimum RTA files, correct client identity

> **Correction (Phase 3D, 2026-10-08):** the May MFSD201 does contain three genuine failed instalments (SIND, and one STPAD + STPOD pair; status Y, no units, the registrar's reason in Remarks). The statements below that no genuine rejection appears in the samples are superseded — see `docs/rta/PHASE3D_SOURCE_SELECTION.md` §3.

Status: **development and shadow testing only** (owner decisions of 2026-10-08).
Nothing deployed, merged, posted or changed in production data.

## 0. Evidence

Twelve real mailbacks, ARN-270604, profiled and run through shadow staging in a
throwaway database (dropped afterwards). Figures are aggregates only.

| File | Rows | Period / as-of | Scope observed |
|---|---:|---|---|
| CAMS R2 | 1,334 | trades 2026-05-04 → 05-17 | 15 AMCs |
| CAMS R9 | 1,237 | as of 2026-05-18 | 1,178 folios — 98.8 % of them transacted in the same fortnight, so **activity-scoped**, not the full book |
| CAMS WBR4 | 8 | as of 2026-10-08 | 1 AMC (IF), 8 folios, all in WBR10 |
| CAMS WBR10 | 10 | trades 2026-10-05 → 06 | 1 AMC (IF); 8 purchases + 2 non-financial (nomination, change of details) |
| CAMS WBR49 | 1 | registered 2026-10-02 | 1 AMC (IF) |
| KFin MFSD201 (May) | 819 | trades 2026-04-30 → 05-15 | 15 funds |
| KFin MFSD201 (Oct) | 689 | trades mostly Sep–Oct 2026, plus 99 re-reported 2024–25 rows | 19 funds |
| KFin MFSD211 (May / Oct) | 648 / 384 | report 2026-05-18 / 2026-10-08 | 633 / 364 folios — activity-scoped (all MFSD201 folios are in it) |
| KFin MFSD203 | 1,943 | as of 2026-10-08 | 1,792 folios, 22 funds, last transactions back to 2013 — **full book**; 329 zero positions |
| KFin MFSD230 | 20 | starts 2026-10-01 → 07 | SIP/STP whose first instalment fell in the period (PAIDINST = 1 on every row) |
| KFin MFSD243 | 9 | registered 2026-10-01 → 07 | registrations made in the period |

## A. Minimum core reports and demonstrated gaps

| Registrar | Core report | Role | Evidence and gap |
|---|---|---|---|
| CAMS | **R2** | transactions | All 1,334 rows reconcile; the existing importer agrees on all of them. **Gap:** no rejected, reversed or remarked row in 1,334 SIP-heavy rows — CAMS rejection coverage is **unverified**. |
| CAMS | **R9** | master + holdings | Has every master field (contacts, joint holders, guardian, date of birth, bank, nominee) plus units and value. It has **no NAV**. **Gap:** the sample covers only folios that transacted, so it must be requested **for all folios, as on a date** before CAMS AUM can be called complete. |
| CAMS | **WBR49** | SIP / STP registrations | Has a registration id (`auto_trno`), amount, frequency, start and end dates, **cease date** and **pause dates**. The 1899 blank-date placeholder reads as blank. The sample is one period's registrations. |
| KFin | **MFSD211** | master | Has contacts, joint holders (PAN2/3), guardian and date of birth. **Gap:** activity-scoped — 1,429 of MFSD203's 1,792 folios have no master row. A full-book MFSD211 is needed **once** at bootstrap; after that, each period's file covers the clients who changed. |
| KFin | **MFSD203** | holdings and AUM | Value = units × NAV on 1,943/1,943 rows; NAV is stated; zero positions are kept. It has **no holder-status, joint or guardian column**, so it cannot replace MFSD211. |
| KFin | **MFSD201** | transactions | Lot redemptions are reported as groups, now including Oct's 6 groups / 197 lots. **Gap:** every one of the 33 "rejection" rows (SINR / FULR / NEWR) is a **folio-consolidation reversal**, not a failed debit (§G). Genuine KFintech rejection coverage is **unverified**. |
| KFin | **MFSD243** *(instead of MFSD230 — material gap shown)* | SIP registrations | MFSD243 has a registration id (`RegSlno`, which links 8 of its 9 rows to MFSD201's `sipregslno`), `Status`, `TerminateDate` and PAN. **MFSD230 has no registration id, no status, no terminate date and no PAN.** The existing importer refuses MFSD230, and every one of its rows can only be UNKNOWN. Only 2 of 243's rows also appear in 230. |

**Not for regular import:**

- **WBR4** — its master fields are a subset of R9's; it adds no fact the 8 modules need.
- **WBR10** — weaker than R2. It has no `trxn_type_flag`, `trxn_nature`, `siptrxnno`, PAN or reversal fields, so its purchases cannot be classified to R2's standard. The existing importer imports 0 of its 10 rows, and staging holds all 10.
- **MFSD230** — see the MFSD243 row above.

**Conditional (only if the samples below show the core lacks it):**

| Report | Condition |
|---|---|
| CAMS rejection / unprocessed report (e.g. WBR46) | R2 lacks failed debits |
| KFin MFSD228 | MFSD201 lacks bounced SIP debits |
| KFin MFSD244 | SIP registration rejections are needed (a rejected registration never appears in MFSD201) |
| KFin MFSD231 / 229 | MFSD243 pulled over a long registration period does not show terminated / paused SIPs |

## B. Eight-module readiness

| Module | Status | What is missing |
|---|---|---|
| Client Master | **PARTIAL** | The identity rules run in shadow, with 0 wrong owners on the real files. **Missing:** full-book masters (bootstrap); writing holder relationships (table 0234, no writer yet); Karta data, which no registrar report carries. |
| Accurate AUM | **KFin ready (shadow) · CAMS PARTIAL** | **KFin:** MFSD203 ₹14,67,10,680.68, 1,943 positions, as of 08-Oct. **CAMS:** no full-book statement, and R9 has no NAV. **The existing CRM today shows ₹26,63,09,197.97** — May CAMS plus October KFintech added together with no date labels. |
| Active SIP Book | **PARTIAL** | The lifecycle rule exists (`sip-lifecycle.ts`). **Missing:** full-period register pulls. MFSD230 can only give UNKNOWN. **The existing CRM counts 9 active, 5 of which have not started yet** (PENDING). |
| Client Portfolio | **KFin ready (shadow) · CAMS PARTIAL** | Each of MFSD203's 1,943 positions has exactly one owner decision, so nothing is counted twice. Cost and returns are not shown: there is no complete history. |
| SIP Rejection / Stop | **MISSING evidence** | No genuine instalment rejection, registration rejection, stop, pause or expiry appears in any sample. |
| Transactions | **ready (shadow)** for the observed classes | 6 new codes are held: LTOF, CNO, CNI, IPO and the 2 consolidation-reversal shapes. |
| Transaction Rejection | **PARTIAL** | No rejected row is counted as an investment, in either engine. The meaning of a genuine rejection is unverified. |
| SIP Master | **PARTIAL** | Registration ids are present in WBR49 and MFSD243. Full history needs full-period pulls. |

## C. Client and folio matching — before and after

| Existing behaviour (legacy importer) | Problem against Decision 7 | Done in this branch |
|---|---|---|
| `InvestorDirectory.resolve`: **PAN first**, then folio | A guardian's PAN beats the folio | New `lib/rta/owner.ts` puts the folio on record first; staging uses it |
| `byFolio` falls back to the **folio number alone** across AMCs | The same folio number at another AMC can match | `owner-directory.ts`: a folio is registrar + AMC + folio, exactly |
| Feed: a CAMS minor row (guardian's PAN) with no master **attached the minor to the guardian** — 19 of 19 minor folios, 22 transactions on the real files | Wrong legal owner | **Fixed in `process.ts`:** a minor's row attaches only to the minor's folio on record, otherwise it is held back |
| Master: minor key `MINOR:<guardian PAN>:<name>` | Identity rests on a name (Decision 3.6) | **Not changed** — migrating existing keys needs approval (§I) |
| Feed placeholder key `NOPAN:FOLIO:<folio>` has no AMC | The same folio number at two AMCs would share one placeholder | Not changed. Staging proposes `FOLIO:<rta>:<amc>:<folio>` |

## D. Minor / guardian

**Rule:**

- A minor is matched by the folio on record. If there is none, the minor's **own** PAN is used (none in any sample).
- Otherwise a provisional owner is keyed `FOLIO:<rta>:<amc>:<folio>`, with the guardian as a link found by the guardian's PAN.
- The guardian's PAN never becomes the owner's.
- A minor folio found under the guardian's own record is an exception (`folio_owned_by_guardian`).

**Real-file evidence:**

- CAMS R2 prints the guardian's PAN on all 22 minor rows.
- R9 (21), MFSD211 (8 + 4), MFSD201 (7 + 5) and MFSD203 (12) leave the minor's PAN blank and name the guardian.
- In R9, 4 guardians have several minor folios, and 3 guardians hold their own folio at the same AMC as their minor.

**Shadow results, with the masters loaded:**

- The 22 R2 minor rows and the 7 May MFSD201 minor rows all land on the minor's own record.
- Overall, 62 minor rows matched a minor record and **0** went to a non-minor client.
- With no client data at all, every minor row (67) becomes a provisional minor owner — never the guardian.
- The existing importer's fixed path is tested: R2 imported before R9 now holds the row, and after the master it lands on the minor.

## E. HUF / Karta

- **HUF identification:** from the registrar's holder status. All HUF rows carry an **H-type PAN** (R9 6/6, R2 6/6, MFSD211 13/13). MFSD203 has no status column, so its 27 H-PAN positions are typed from the PAN alone, and are flagged as such.
- **An HUF row with an individual PAN:** flagged `huf_owner_pan_not_huf` and never used as the HUF's PAN. No such row appears in the samples.
- **Karta:** no registrar report has a Karta field (checked on all seven layouts). A Karta can only come from KYC or staff, as a `karta` holder row (0234) with effective dates. A Karta change closes one row and opens another; the HUF and its folios do not move.
- **Unverified:** whether any registrar report ever names the Karta.

## F. Minor-to-major and SIP lifecycle

- **Minor-to-major:**
  - A minor row whose date of birth shows 18 or older is flagged `minor_age_18_or_over`. None appears in the samples: every minor is under 18.
  - A folio owned by a minor that the registrar now reports as an individual with a PAN, or a PAN matching a minor record, is an **exception**. The identity is kept, nothing is re-owned, and staff verify.
  - `investors.majority_status` (0234) records the transition from registrar evidence only.
- **SIP status** (`sip-lifecycle.ts`):
  - ACTIVE needs a registrar "live" status, or a register with no cease date, that is fresh for the date.
  - STOPPED / PAUSED / EXPIRED / REJECTED come only from registrar facts.
  - Failed instalments never stop a SIP.
  - A passed end date with no status is UNKNOWN; a live status past the end date is an extension and stays ACTIVE.
  - **Real files as of 08-Oct:**

    | Source | Result |
    |---|---|
    | WBR49 | 1 ACTIVE |
    | MFSD243 | 3 SIPs ACTIVE, 5 SIPs PENDING (start date after 08-Oct), 1 STP ACTIVE |
    | MFSD230 | 20 UNKNOWN |

## G. Migrations (development only; tenant isolated)

- **0233 (unmerged, amended):** `record_kind` also allows `registration` on the staging batch and row tables.
- **0234:**
  - New table `folio_holders`:

    | Column | Purpose |
    |---|---|
    | folio, role | role ∈ first / second / third / guardian / karta |
    | investor link | when the holder is a CRM client |
    | as-printed PAN / name / date of birth | when the holder is not a client |
    | source | registrar / kyc / staff, plus report, batch and as-of date |
    | verified | whether the relationship is confirmed |
    | `effective_from` / `effective_to` | one *current* holder per role per folio |

    RLS is enabled and forced, with a `tenant_isolation` policy.
  - Two nullable columns on `investors`: `identity_confidence`, `majority_status`. Nothing is backfilled.
- **Checks:** `check:rls` passes on 182 tables, and `check:schema` passes.

## H. Tests

- **`tests/rta-owner-identity.test.ts` (16):** the 15 required scenarios plus owner typing.
  - **Ownership and holders:**
    - adult;
    - two minors sharing a guardian;
    - minor and guardian at one AMC, including the guardian-owned exception;
    - minors sharing contact details;
    - individual + HUF;
    - HUF PAN vs Karta PAN;
    - a Karta change;
    - minor-to-major;
    - joint holders counted once.
  - **Identification and history:**
    - the same folio number at two AMCs (also tested against Postgres);
    - a missing or wrong PAN;
    - a minor before the master;
    - holdings of different dates and ARNs;
    - a SIP stopped only by a lifecycle fact.
  - Duplicate and overlapping imports are covered in `rta-staging-db`.
- **`tests/rta-staging-unit.test.ts` (52):**
  - the 7 newer real layouts;
  - R9 vs WBR4 recognition;
  - MFSD203 zero positions;
  - the consolidation group;
  - R-code rejections;
  - WBR10 non-financial rows;
  - registration fields;
  - CAMS minor token;
  - holder facts on every holder-bearing layout.
- **`tests/rta-real-layouts.test.ts`:** updated for the corrected minor rule.
- **Full suite:** 59 files and 759 tests passed, none skipped; tsc, lint and every check pass.

## I. Smallest safe implementation sequence

1. **Approved and done here, shadow only:** the identity module, exact-AMC folios, staging layouts, the legacy CAMS-minor guard, and the 0234 schema.
2. **Request the bootstrap files:** R9 for all folios, MFSD211 for all clients, MFSD203 for all funds, as on one date; plus WBR49 and MFSD243 over the whole registration history. Run them in shadow and prove AUM completeness per registrar.
3. **Label AUM by registrar and date** (`holdings-snapshot.ts`) on the dashboards before any posting; today's unlabelled sum mixes May and October.
4. **Write `folio_holders`** from the masters (in shadow first), and replace the name-based `MINOR:` key with a folio-keyed provisional identity, under a reviewed data migration that never merges or re-owns automatically.
5. **SIP Book from registrations** with `sipStateOn`; MFSD230 is retired in favour of MFSD243.
6. **Posting gate:** a separate approval.

## J. Production readiness and blockers

- **Not production-ready.** Posting is off and nothing is merged.
- **Blockers:**
  - no full-book CAMS holdings statement;
  - no genuine rejection, stop, pause or expiry sample from either registrar;
  - the name-based minor key in existing data needs a reviewed migration;
  - Karta data has no registrar source;
  - the registration reports carry no report or as-of date, so freshness depends on the mailback date.
- **Before posting:** merging this branch also changes the legacy feed's minor rule (safer: a hold instead of a wrong owner) and applies migrations 0233 / 0234, which are additive.
