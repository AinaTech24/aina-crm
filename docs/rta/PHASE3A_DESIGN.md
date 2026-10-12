# RTA Mailback Import — Phase 3A: Financial Data Integrity Architecture

**Status:** design for architectural review. Nothing here is migrated or deployed.
**Date:** 2026-10-08 · **Branch:** `claude/relaxed-mendel-01jprq`
**Evidence base:** the real KFintech MFSD201 (819 rows), MFSD211 (648), CAMS R2 (1,334)
and R9 (1,237) mailbacks verified in Phase 2B, re-analysed for this phase. The files are
kept outside git; this document carries only structure, counts and sums. Every claim
is labelled:

- **[VERIFIED]** — measured on the real files or the live schema.
- **[PROPOSAL]** — an engineering design choice for review.
- **[ASSUMPTION]** — a registrar-specific inference that one sample cannot prove.
  Each one names what would confirm it.

---

## 1. Root-cause findings from the four real files

| # | Finding | Evidence | Label |
|---|---|---|---|
| F1 | KFintech reports one redemption as **several rows sharing one Transaction Number**, one row per purchase lot (or part of a lot). 9 groups, 143 rows; 23 more redemptions are single-row (one lot). | Group key columns constant in all 9 groups; lot columns vary (§3) | VERIFIED |
| F2 | No row in a group is an aggregate or total row; no exact duplicate rows. The redemption is the **sum** of its rows. | For every group no row equals the sum of the others; 0 byte-identical rows | VERIFIED |
| F3 | Row arithmetic: `Amount ≈ Units × Nav − Load Amount` (165/166 redemption rows, ±₹1); `Price = Nav × (1 − Load%)`. Per group `Σ(Units × Nav) − ΣAmount = ΣLoad Amount` within ₹0.03. | §3.4 | VERIFIED |
| F4 | `Transaction ID` identifies the **purchase lot**: one value per lot, never shared across Transaction Numbers. A lot can occupy **two rows**, a load-free part and a load-bearing part (21 lots; same Transaction ID, different Units / Amount / Price / Load Amount). | §3.3 | VERIFIED (structure); ASSUMPTION (that it is the "free units" exit-load rule) |
| F5 | STT is a **transaction-level** charge printed on exactly one row of each group (the last in file order, 9/9). It is not per lot. | §3.5 | VERIFIED for this file; ASSUMPTION that row order is stable |
| F6 | Natural keys are not row-unique. `Transaction ID` / `NewUnqno` give 798 distinct for 819 rows; (txn no., folio, scheme, date, amount, units) gives 817/819, because two pairs of genuine lot rows are identical on all of those. Deduplicating on them would drop money. | Phase 2B + §3 | VERIFIED |
| F7 | CAMS R2 `trxnno` is unique on all 1,334 rows; (amc_code, trxnno) is also unique. | | VERIFIED (one file only) |
| F8 | All 82 CAMS "Switch In" / "Partial Switch Out" rows are **systematic transfers** (STP legs), not ordinary switches. Each has a description starting "Systematic … From/To <scheme> … Instalment n" and a `siptrxnno` registration reference (82/82). | §4 | VERIFIED for these 82 rows |
| F9 | 9 CAMS "Partial Redemption" rows are systematic: 4 say "Systematic withdrawal" (SWP); 5 say "Systematic – NEFT / Electronic payout … Instalment n" with no "withdrawal". | §4.3 | 4 VERIFIED SWP; 5 ASSUMPTION |
| F10 | CAMS `reversal_code` / `original_trxnno` and KFintech `RejTrnoOrgNo` are **empty on every row**. The 3 KFintech "Pre-rejection" rows cannot be linked to the transaction they reject. | | VERIFIED |
| F11 | Minor folios: R9 files the folio under the minor (no PAN, `guard_pan` set); R2 reports the minor's transactions with the **guardian's PAN** (22/22). KFintech: 7 MFSD201 rows have no PAN, and MFSD211 has a guardian PAN. | Phase 2B | VERIFIED |
| F12 | R9 carries one statement date (`rep_date`, a single value on all 1,237 rows). It lists **explicit zero positions** (19 rows, units 0 / value 0). MFSD211 carries no balances at all. | | VERIFIED |
| F13 | Folio identity is clean in these samples. Every transaction row matches its master on (AMC, folio, product); no folio number appears under two AMCs. Joint holders are present (R9: 135 rows, MFSD211: 68) and **not stored**. | | VERIFIED |
| F14 | Live schema: `transactions` has `tx_tenant_order_unique (tenant_id, order_id) WHERE order_id IS NOT NULL` and `tx_tenant_dedup_unique (tenant_id, dedup_key)`. It has no link to a source file / row / batch. `raw_feed_row`, `source_feed` and `settlement_date` are never filled by RTA imports. | `\d transactions` | VERIFIED |
| F15 | Holdings live only in `folios.schemes` (jsonb), read by valuation, AUM persistence, portfolio intelligence, MIS, the reconciliation engine and about 85 UI / API sites. There is no as-of date and no history. | grep of `src/` | VERIFIED |

The common root cause behind the remaining gaps: **the importer posts straight from a
parsed row into business tables.** No layer records what each source row was, what it
became, or why. Lots, statement dates, corrections and reconciliation all need that
layer.

---

## 2. Recommended financial data model [PROPOSAL]

Four layers, each traceable to the one before:

```
 rta_file_imports (batch)  ── existing table, extended
        │ 1:n
 rta_import_rows (source row)           every row of every file, with disposition
        │ n:1                                   │ n:1
 rta_economic_transactions                rta_holding_positions
   (one registrar transaction)              (one statement line)
        │ 1:n          │ 1:1 (when posted)      │ n:1
 rta_redemption_lots   transactions        rta_holding_statements
   (purchase-lot detail) (existing CRM row)   (one dated statement)
                                                │ derived
                                         rta_current_positions (view) ──► folios.schemes (compat projection)
```

Principles:

1. **Source rows are immutable facts.** Each file row is stored once per batch, with its
   file checksum, row number and row hash. Nothing downstream deletes it.
2. **Economic transactions are the unit of posting.** One registrar transaction (for
   example a KFintech redemption of 28 lot rows) becomes one `rta_economic_transactions`
   row and at most one `transactions` row. Lots hang off it; nothing is summed in the
   business table without its parts on record.
3. **Holdings are dated statements.** Current holdings are derived (latest as-of per
   position). `folios.schemes` becomes a projection written from that view, so its ~85
   readers keep working.
4. **Identity keys are registrar-specific and versioned** (`identity_scheme =
   'kfin.v1' | 'cams.v1'`). A collision with different invariant facts is an exception,
   never an overwrite.
5. **Existing financial rows are never rewritten by this design.** Legacy transactions
   are *adopted* (linked) when they provably match. Anything else is reported, not
   changed (§7.9, step H).

---

## 3. KFintech multi-lot redemption design

### 3.1 How the registrar represents a redemption [VERIFIED, one file]

| Role | Columns |
|---|---|
| **Group (economic transaction) identity** — constant across all rows of all 9 groups | `Fund`, `Folio Number`, `Product Code`, `Scheme Code`, `Transaction Number`, `Transaction Date`, `Process Date`, `Transaction Head`, `Transaction Description`, `Transaction Type`, `Transaction Sub`, `Transaction Flag`, `Nav`, `Nav Date`, `Load Percentage`, `Ihno`, `Branch Transaction No`, `Inward Number`, `PAN1`, `Agent Code`, `ISIN`, `EUIN` |
| **Lot identity** | `Transaction ID` (= `NewUnqno`): one per purchase lot. `Purchase Transaction No`, `Purchase Date`: the original purchase. |
| **Lot measures** | `Units` (redeemed from this lot), `Amount` (net of exit load), `Price` (net price per unit), `Load Amount`, `Purchase Units` (original lot size), `Purchase Amount` (original cost) |
| **Transaction-level charge** | `STT`: on one row per group only |

### 3.2 Sum, not repeat [VERIFIED]

- No row equals the sum of the others, and there are no byte-identical rows. Purchase
  dates in every group precede the transaction date.
- **Economic units = Σ Units, net amount = Σ Amount, exit load = Σ Load Amount,
  STT = Σ STT.**

### 3.3 Split lots [VERIFIED structure / ASSUMPTION meaning]

- 21 lots appear on two rows each, always one with load and one without. Only
  Units / Amount / Price / Load Amount differ; the Transaction ID is the same.
- In 20 of the 21, the two parts add up to the full `Purchase Units` (a whole lot
  redeemed, partly load-free); 1 is a partial lot.
- The reading "a portion of units is exempt from exit load" is plausible but unconfirmed.
  The design does not depend on the reason: it stores both parts as separate lot rows.

### 3.4 Arithmetic [VERIFIED on 166 redemption rows]

| Check | Rows passing |
|---|---:|
| `Amount ≈ Units × Price` (±₹1) | 165 |
| `Amount ≈ Units × Nav − Load Amount` (±₹1) | 165 |
| `Price = Nav` (no load on the row) | 94 |
| `Units = Purchase Units` (whole lot) | 98 · partial lot (Units < Purchase Units): 67 |
| Group: `Σ(Units × Nav) − ΣAmount − ΣLoad` | within ₹0.03 in all 9 groups |

- STT / gross is about 1e-5 (0.001 %) on group rows; up to 2e-4 on small single rows
  (rounding).
- Whether the investor's payout is `ΣAmount − STT` is **not stated** in the file
  [ASSUMPTION]. The CRM keeps posting `ΣAmount` as today (consistent with the 23
  single-row redemptions already imported) and stores STT separately.

### 3.5 Proposed representation [PROPOSAL]

- **`rta_import_rows`:** all 819 source rows, each with its own disposition. A lot row's
  disposition is `committed_as_part` of economic transaction X.
- **`rta_economic_transactions`:** one row per Transaction Number group:
  - `identity_key = 'kfin.v1:' || fund || ':' || transaction_number`;
  - `invariant_hash` = hash of the group-identity columns above;
  - `lot_signature` = hash of the sorted normalized lot rows;
  - amounts: `units = ΣUnits`, `net_amount = ΣAmount`, `exit_load = ΣLoad Amount`,
    `stt = ΣSTT`, `gross_amount = Σ(Units × Nav)` (flagged **computed**), `nav = Nav`
    (constant), `lot_count`, `row_count`.
- **`rta_redemption_lots`:** one row per source lot row (a split lot = 2 rows), with
  `registrar_lot_id` (Transaction ID), purchase transaction no., purchase date, purchase
  units, purchase amount (cost), redeemed units, amount, price, load amount and
  `source_row_id`. Nothing about the original purchase is lost; this is also the input a
  future capital-gains module needs.
- **`transactions`:** one row (type `redemption`, direction `outflow`) with
  `amount = net_amount`, `units = units`, `nav = nav`, `rta_economic_txn_id = X`,
  `source_feed = 'kfintech'`. New nullable money columns `exit_load`, `stt` (§7.4).
- **Posting rule:** a group posts only when **all** of the following hold:
  - every one of its rows in the batch passed validation;
  - the invariants are identical on every row;
  - `|Σ(Units × Nav) − ΣAmount − ΣLoad| ≤ ₹0.05 × lot_count`;
  - at most one row carries STT.

  Otherwise the whole group becomes one exception. Nothing posts partially.

### 3.6 Corrected or partially repeated files [PROPOSAL]

Re-arrival of identity key K in a later batch:

| Same key K arrives again | Action |
|---|---|
| Same `invariant_hash` and same `lot_signature` | Duplicate: rows dispositioned `duplicate_of` the committed economic transaction. No posting. |
| Same invariants, different `lot_signature` (lots added, removed or changed) | Restatement candidate: exception `restated_by_registrar`. The economic transaction is not modified. A reviewer may accept it, which posts a versioned correction (`supersedes_id`) and records it in `audit_log`. Never automatic in v1. |
| Different invariants (another folio, scheme, date or head) | Identity collision: exception `identity_conflict`. Neither side is changed. |
| A group split across two files (rows of K in both, no single file complete) | Each file's partial set fails the arithmetic check and goes to exceptions. A later "assemble across batches" action is a phase-2 option. |

### 3.7 Independent reconciliation of the two levels [PROPOSAL]

Lot level and transaction level each reconcile on their own:
- **Lots:** each lot row's `Amount ≈ Units × Price`, and `Price ≈ Nav × (1 − Load%)`
  when load > 0.
- **Transaction:** the Σ identities in §3.4.
- **Lots vs purchase history:** a lot's purchase transaction no. should exist as an
  earlier purchase in the CRM. That can only be verified when the historical feed has
  been imported; otherwise the result is **UNVERIFIED**, never failed or passed.

---

## 4. Transaction classification review

### 4.1 CAMS Switch vs STP [VERIFIED on the 82 rows]

| Indicator | Switch In (40) | Partial Switch Out (42) |
|---|---|---|
| `trxn_nature` starts "Systematic" | 40 | 42 |
| names the other scheme ("From …" / "To …") | 40 | 42 |
| "Instalment n" | 40 | 40 |
| `siptrxnno` (systematic registration ref) | 40 | 42 |
| `sys_regn_date` | 40 | 2 |
| `targ_src_scheme` | 40 | 36 |
| `swflag` | INTER | NA |
| `ticob_trtype` / `ticob_trno` (leg link) | empty | empty |
| out leg paired with an in leg in this file (folio + date + amount) | — | 0 |

**Conclusion:** every switch row in this file is a systematic transfer. No ordinary
switch was observed, so the ordinary-switch rule below is defined but **unverified**.
Leg pairing cannot be checked from this file: the counterpart legs are in other
folios / files and the `ticob_*` link columns are empty.

### 4.2 KFintech [VERIFIED codes in this file]

| `Transaction Type` | Rows | Other evidence | Class |
|---|---:|---|---|
| SIN | 617 | head P, `sipregslno` 615/617, SIP Regn Date 617 | SIP investment |
| ADD / NEW | 13 / 4 | head P | Purchase |
| FUL / RED | 91 / 56 | head R, purchase-lot columns filled | Redemption |
| SWD | 2 | head R, "Systematic Withdrawal" | SWP withdrawal |
| STPA | 17 | head P, flag SI, ToProductCode, `sipregslno` | STP In |
| STPO | 16 | head R, flag SO, ToProductCode; 15/16 have an STPA in the same folio for that target product | STP Out |
| SIND / STPAD / STPOD | 1 / 1 / 1 | "Pre-rejection"; flag opposite to the original; `RejTrnoOrgNo` empty | Rejection (unlinked) |

### 4.3 CAMS systematic redemptions

| Description | Rows | Proposed class | Basis |
|---|---:|---|---|
| "… Systematic withdrawal …" | 4 | SWP withdrawal | VERIFIED wording |
| "Systematic – NEFT PAYOUT / ELECTRONIC PAYMENT … Instalment n" | 5 | Redemption, with `class_confidence = 'inferred_swp'` | ASSUMPTION. The direction (money out) is certain and net business treats redemption and SWP the same; only SWP counts differ. Confirm with CAMS or another file. |
| "Redemption" | 25 (+1) | Redemption | VERIFIED |

### 4.4 Business classifications and mapping to existing CRM reporting [PROPOSAL]

A new `rta_class` value is stored on the economic transaction and on `transactions`.
Existing `type` / `direction` values are kept so every current report keeps working.

| `rta_class` | Posted to `transactions`? | `type` | `direction` | Net business (`lib/metrics/business.ts`) | Holdings (units) | SIP book / STP / SWP | Business-entry RTA match |
|---|---|---|---|---|---|---|---|
| purchase | yes | `lumpsum` (legacy RTA rows use it; `GROSS_TYPES` includes it) | inflow | gross | + | — | lumpsum lines |
| sip_investment | yes | `sip` | inflow | gross | + | confirms the SIP (first instalment) | SIP lines |
| redemption | yes | `redemption` | outflow | redemption | − | — | redemption lines |
| swp_withdrawal | yes | `swp` | outflow | redemption | − | SWP | — |
| switch_in | yes | `switch` | inflow | **excluded** (internal) | + | — | switch lines |
| switch_out | yes | `switch` | outflow | excluded | − | — | switch lines |
| stp_in | yes | `stp` | inflow | excluded | + | not a SIP (`markSystematicTransfers`) | STP lines |
| stp_out | yes | `stp` | outflow | excluded | − | not a SIP | STP lines |
| idcw_payout | yes | `dividend_payout` | outflow | excluded (not a redemption) | 0 | — | — |
| idcw_reinvest | yes | `dividend_reinvest` | inflow | excluded (not new money) | + | — | — |
| rejection (explicit status) | yes, status `rejected` | as classified | as classified | excluded (status) | 0 | SIP rejection module | rejected outcome |
| rejection (pre-rejection row, unlinked) | **no** | — | — | — | — | — | exception |
| reversal | **no**, until linked to its original | — | — | — | — | — | exception |
| cancellation | **no**, until linked | — | — | — | — | — | exception |
| unknown / unverified | **no** | — | — | — | — | — | exception |

Notes:
- `GROSS_TYPES` already excludes `switch` / `stp`, and `REDEMPTION_TYPES` = redemption,
  swp. So internal transfers do not count as new money or redemptions **[VERIFIED in
  code]**.
- IDCW rows were **not present** in either file. Their rules stay disabled until a sample
  confirms them.

### 4.5 Corrected classification rules [PROPOSAL; evidence in brackets]

- **CAMS:**
  - flag `Switch In` + systematic markers (nature "Systematic", `siptrxnno`) → `stp_in`
    [82/82]; flag `Switch In` without them → `switch_in` [unobserved].
  - flag `… Switch Out` + markers → `stp_out`; without → `switch_out` [unobserved].
  - flag `Partial/Full Redemption` + "Systematic withdrawal" → `swp_withdrawal` [4];
    + "Systematic … Instalment" → `redemption` / `inferred_swp` [5]; else `redemption`.
  - flag `(Fresh|Additional) Purchase Systematic` → `sip_investment`;
    `(Fresh|Additional) Purchase` → `purchase` (a "Systematic … Instalment" description
    → `sip_investment`) [8].
- **KFintech:** the `Transaction Type` code first (table 4.2), then the description.
- **Change from today:** today's code maps systematic switches to type `stp` (correct),
  but it cannot tell an ordinary switch from an STP when the flag lacks markers. The
  marker test above adds that.

---

## 5. Holdings snapshot schema [PROPOSAL]

### 5.1 Today [VERIFIED]

- `folios.schemes` is a jsonb array of legs: `{schemeCode, schemeName, units, nav,
  value, arn, isin?}`, merged in place by `import.ts` and `process.ts`.
- There is no as-of date and no history. An older statement can overwrite a newer one;
  a position missing from a later statement is never retired.

### 5.2 Tables

**`rta_holding_statements`**: one per holdings file (batch).
- `id`, `tenant_id`, `import_id` (FK `rta_file_imports`), `rta`, `report_code`
  (R9 / WBR22 / MFSD203 / MFSD310), `as_of_date` (R9 `rep_date`; NOT NULL; a file
  without one is rejected)
- `scope_arns text[]` (broker codes present), `scope_amcs text[]`,
  `coverage text CHECK IN ('full_book','arn_subset','unknown')`
- `row_count`, `total_units`, `total_value`, `created_at`
- Unique `(tenant_id, import_id)`.

**`rta_holding_positions`**: one per statement line.
- `id`, `tenant_id`, `statement_id` (FK), `source_row_id` (FK `rta_import_rows`)
- `folio_id` (FK folios, nullable until matched), `amc_code`, `folio_number`
- `registrar_scheme_code`, `isin`, `amfi_code`, `arn`
- `units numeric(20,4)`, `nav numeric(14,4)`, `registrar_value numeric(20,2)`,
  `as_of_date`
- `is_zero boolean GENERATED (units = 0)`
- Unique `(tenant_id, statement_id, source_row_id)`.
- Indexes:
  `(tenant_id, folio_number, amc_code, registrar_scheme_code, arn, as_of_date DESC)`,
  `(tenant_id, as_of_date)`.

**`rta_current_positions`** (view; materialised later if needed):
- Per `(tenant_id, amc_code, folio_number, scheme identity, coalesce(arn,''))`, the
  position from the **latest `as_of_date`**.
- Tie on the same date → the later batch, but only if the values agree; different values
  on the same date raise exception `conflicting_statements_same_date`.
- Carries `as_of_date`, `statement_id` and `stale_days`.

### 5.3 Rules

1. **Older never overwrites newer:** "current" is chosen by date, not import order. An
   older statement imported late lands in history only.
2. **Zero vs absent:**
   - An explicit zero line (R9 lists them, F12) makes the position zero as of that date.
   - A position *absent* from a newer statement is **not** zeroed unless that statement's
     `coverage = 'full_book'` for that ARN and AMC. Otherwise it stays current with its
     own (older) date and shows as stale after a firm-set number of days.
   - Coverage per report type is an **[ASSUMPTION]** until each report's semantics are
     confirmed. Default `unknown`, meaning never zero by absence.
3. **Multiple ARNs:** `arn` is part of the position key. Legs without an ARN are their own
   slice; they are never merged into an ARN slice by guesswork. This removes today's
   "missing ARN is a wildcard" merge.
4. **Registrar value vs calculated value:**
   - `registrar_value` is as reported.
   - The calculated value (units × latest `scheme_nav` NAV) is computed in a view and
     **never written back over** the registrar figure.
   - The AUM card states which one it uses, and the as-of date.
5. **Historical AUM:** positions summed by `as_of_date` give the registrar-reported AUM
   per statement date. `firm_snapshots` / `rm_snapshots` stay as they are.
6. **Backward compatibility:** `folios.schemes` stays as a **projection** of
   `rta_current_positions`, rewritten per folio after each statement commit. Legs keep
   today's keys and gain `asOf` and `statementId` (additive JSON). All ~85 readers keep
   working. `folios.aum` = Σ projected `value`.

---

## 6. Staging and idempotency architecture [PROPOSAL]

### 6.1 Batch lifecycle (`rta_file_imports.stage`)

`uploaded → identified → parsed → validated → matched → reconciled → ready_to_commit →
committed`, or `exception` / `failed` / `rejected`.

- Each stage writes a timestamp and counts into `stage_log jsonb`.
- A batch never moves backwards. A re-run creates a **new batch** that references the old
  one (`rerun_of_import_id`), so every batch's outcome is kept as it was.

### 6.2 Row lifecycle (`rta_import_rows.state`)

`parsed → validated | invalid → matched | unmatched | ambiguous → identified (economic
key assigned) → reconciled → committed | committed_as_part | duplicate | held_exception
| rejected`

Every terminal state carries `disposition_reason` and `exception_code`.

**Invariant [hard check]:** the count of rows per batch equals the file's data rows, and
every row is in exactly one terminal state.

### 6.3 Idempotency keys

| Level | Key | Uniqueness |
|---|---|---|
| Batch | `(tenant_id, file_checksum, report_code)` | Not unique: a re-run is allowed. A re-import of the same checksum flags `same_file_as` and its rows end `duplicate`. |
| Source row | `(import_id, row_no)` | Unique (PK-like) |
| Source row content | `row_hash = sha256(normalized raw row)` | Indexed, **not unique** (identical genuine rows are possible, F6) |
| Economic transaction | `(tenant_id, identity_key)` with `identity_scheme` | Unique. A collision with a different `invariant_hash` is an exception (§3.6). |
| CRM posting | `transactions.rta_economic_txn_id` | Partial unique `WHERE NOT NULL` |

Identity keys per registrar [PROPOSAL; observed unique in one file each, not proven]:
- `cams.v1`: `cams:<amc_code>:<trxnno>`.
- `kfin.v1`: `kfin:<Fund>:<Transaction Number>`.

The key is **never** derived from row position.

### 6.4 Overlapping, historical, incremental and corrected reports

- **Overlap:** the same economic key with the same signature is a `duplicate`, a no-op.
  Processing is order-independent, because identity comes from registrar fields only.
- **Historical (since-inception) files:** the same path. Legacy CRM rows posted before
  staging are *adopted*: a legacy `transactions` row with the same `order_id`, folio,
  scheme, date, amount and units gets `rta_economic_txn_id` set and **no value change**.
  Anything else is an `identity_conflict`.
- **Corrections:** §3.6. Never automatic.

### 6.5 Commit

- Commit is a separate step, run per batch in **one transaction** after `reconciled`.
- It inserts the economic transactions and lots, the `transactions` rows (one per
  economic transaction), and the holdings statement and positions. It then refreshes the
  `folios.schemes` projection for the folios touched.
- Multi-lot groups commit only as whole groups. A failure rolls the batch back to
  `ready_to_commit` with the error, and nothing is half-posted.
- The import worker stays the only writer.
- External I/O (S3) happens before the transaction opens.

### 6.6 Raw data and PII

`rta_import_rows` stores:
- `raw_ref` (S3 key + row number + `row_hash`). The file itself stays in S3, encrypted
  at rest.
- `normalized jsonb`, holding only fields the importer uses. PAN is stored as `pan_hash`
  (HMAC with a server key) plus the last 4 characters for display.
- Investor names and contact details are **not** stored in staging. They already go to
  `investors` through the master path.

Retention:
- Staging rows of a committed batch keep their lineage columns indefinitely.
- `normalized` is compacted after a firm-set period (default 400 days).
- The S3 file lifetime follows the firm's record-retention policy (owner decision;
  question in §10).

---

## 7. Proposed database migrations [PROPOSAL — not applied]

Every change is **additive**: new tables, nullable columns, new indexes. No existing row
is updated by a migration. Each new tenant table gets `ENABLE` + `FORCE ROW LEVEL
SECURITY` and the standard policy:
`tenant_isolation USING ((tenant_id = app_tenant_id()) OR app_is_platform_admin())`
with the same `WITH CHECK`. `npm run check:rls` enforces this.

To stop cross-tenant references at the database level (today only RLS does), each parent
gets a **composite unique key `(tenant_id, id)`**, built `CREATE UNIQUE INDEX
CONCURRENTLY` (a non-blocking build on live tables). New child tables reference
`(tenant_id, x_id)` pairs.

### 7.1 `rta_file_imports` (existing) — extend

| Column | Type | Purpose |
|---|---|---|
| `report_code` | text | R2 / R9 / MFSD201 / MFSD211 / WBR22 / MFSD203 … (detected) |
| `stage` | text CHECK (list §6.1) | lifecycle; NULL for legacy rows |
| `stage_log` | jsonb | per-stage timestamps and counts |
| `as_of_date` | date | holdings statements |
| `parser_version` | text | which rules produced the rows |
| `identity_scheme` | text | kfin.v1 / cams.v1 |
| `rerun_of_import_id` | uuid FK self | re-run lineage |
| `same_file_as_import_id` | uuid FK self | duplicate upload lineage |

- Rollback: drop the columns.
- Compatible: legacy code ignores them.

### 7.2 `rta_import_rows` — new

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | FK tenants |
| `import_id` | uuid NOT NULL | FK `(tenant_id, import_id)` → `rta_file_imports(tenant_id, id)` ON DELETE RESTRICT |
| `row_no` | int NOT NULL | 1-based line / row in the decoded file |
| `rta`, `report_code` | text NOT NULL | |
| `file_checksum` | text NOT NULL | copy, for cross-batch queries |
| `row_hash` | text NOT NULL | sha256 of normalized raw row |
| `raw_ref` | jsonb NOT NULL | `{fileKey,row}` — no PII |
| `normalized` | jsonb | PAN as HMAC + last 4; compacted later |
| `state` | text NOT NULL CHECK | §6.2 |
| `validation` | jsonb | per-field verdicts |
| `match` | jsonb | `{investorId, folioId, rule, ambiguous?}` |
| `identity_key` | text | economic key |
| `economic_txn_id` | uuid | FK `(tenant_id, economic_txn_id)` |
| `holding_position_id` | uuid | FK |
| `recon_status` | text | pass / fail / unverified |
| `disposition_reason`, `exception_code` | text | |
| `exception_state` | text CHECK (open, acknowledged, resolved) | |
| `resolved_by`, `resolved_at` | uuid, timestamptz | |
| `created_at`, `updated_at` | timestamptz | |

- Keys: UNIQUE `(import_id, row_no)`.
- Indexes:
  - `(tenant_id, identity_key)`;
  - `(tenant_id, row_hash)`;
  - `(tenant_id, exception_state) WHERE exception_state = 'open'`;
  - `(tenant_id, import_id, state)`.
- Size: about one row per file row. That is about 2.5M rows a year for a large firm
  receiving daily feeds; partition by month on `created_at` if volume requires.
- Rollback: drop the table (the legacy path does not read it).

### 7.3 `rta_economic_transactions` — new

- **Columns:**
  - `id`, `tenant_id`, `identity_scheme`, `identity_key`
  - `rta`, `amc_code`, `folio_number`, `folio_id` (FK, nullable), `investor_id` (FK, nullable)
  - `registrar_txn_no`, `registrar_scheme_code`, `isin`, `trade_date`, `post_date`
  - `rta_class` (CHECK, list §4.4), `class_confidence` (verified / inferred)
  - `direction`, `status`
  - `units numeric(20,4)`, `nav numeric(14,4)`, `net_amount numeric(20,2)`,
    `gross_amount numeric(20,2)`, `gross_is_computed bool`, `exit_load numeric(20,2)`,
    `stt numeric(20,2)`, `stamp_duty numeric(20,2)`
  - `lot_count`, `row_count`, `invariant_hash`, `lot_signature`
  - `systematic_registration_ref` (`siptrxnno` / `sipregslno`), `counterparty_scheme`
    (target / source scheme of a switch or STP)
  - `reversal_of_id` (FK self), `supersedes_id` (FK self)
  - `first_import_id`, `last_seen_import_id`, `transaction_id` (FK `transactions`, the CRM
    posting), `created_at`
- **Keys:**
  - UNIQUE `(tenant_id, identity_key)`.
  - Indexes `(tenant_id, folio_number, trade_date)`, `(tenant_id, investor_id, trade_date)`.
  - Partial UNIQUE `(tenant_id, transaction_id) WHERE transaction_id IS NOT NULL`.
- **Rollback:** drop. `transactions.rta_economic_txn_id` is nullable (§7.4).

### 7.4 `transactions` (existing) — extend, do not alter keys

| Column | Type | Notes |
|---|---|---|
| `rta_economic_txn_id` | uuid NULL | FK `(tenant_id, rta_economic_txn_id)`; partial UNIQUE `WHERE NOT NULL` |
| `rta_class` | text NULL | finer than `type`; reports may adopt gradually |
| `exit_load`, `stt`, `stamp_duty` | numeric(18,2) NULL | charges, stored separately |

- **Existing uniqueness:** `tx_tenant_order_unique` and `tx_tenant_dedup_unique` stay
  untouched.
- **A registrar number reused across AMCs** would collide on `order_id`. For a new posting
  whose `order_id` is already taken by a *different* economic transaction, the commit
  writes `order_id = NULL` and relies on `rta_economic_txn_id`; the collision is logged.
  No existing row is changed.
- **Note:** `ON DELETE CASCADE` from `investors` / `folios` to `transactions` already
  exists. The new economic table uses `ON DELETE RESTRICT`, so a hard delete of a client
  cannot erase the registrar record.
- **Rollback:** drop the columns.

### 7.5 `rta_redemption_lots` — new

- **Columns:**
  - `id`, `tenant_id`, `economic_txn_id` (FK, NOT NULL), `source_row_id` (FK, NOT NULL)
  - `registrar_lot_id` (Transaction ID), `lot_part` (smallint: 1, 2 for a split lot,
    assigned by `source_row_id` order within the same `registrar_lot_id`)
  - `purchase_txn_no`, `purchase_date`, `purchase_units numeric(20,4)`,
    `purchase_amount numeric(20,2)`
  - `redeemed_units numeric(20,4)`, `amount numeric(20,2)`, `price numeric(14,4)`,
    `load_amount numeric(20,2)`, `stt numeric(20,2)`
- **Keys:** UNIQUE `(tenant_id, source_row_id)`; index `(tenant_id, economic_txn_id)`.
  There is no unique key on (lot id, part): F6 shows identical genuine rows can exist.
- **Retention:** as for transactions (financial record).

### 7.6 `rta_holding_statements`, `rta_holding_positions`, view `rta_current_positions`

As specified in §5.2. Statements reference `(tenant_id, import_id)`; positions reference
`(tenant_id, statement_id)` and `(tenant_id, source_row_id)`. Rollback: drop the view,
then the tables. `folios.schemes` continues to be written by the legacy path until
cutover.

### 7.7 Reference maps (global, not tenant data)

- **`rta_amc_map`:** `(rta, registrar_amc_code)` PK → `amfi_amc_code`, `amc_name`,
  `verified_by`, `verified_at`.
- **`rta_scheme_map`:** `(rta, registrar_scheme_code)` PK → `isin`, `amfi_scheme_code`,
  `scheme_name`, `source` (`registrar_isin_column` / `amfi_master_name` / `manual`),
  `confidence`.
- No `tenant_id`, like `scheme_nav`. Write access only to the platform-admin role;
  read-only to the app.
- Populated:
  - from KFintech rows that carry `ISIN` [VERIFIED present in MFSD201];
  - CAMS R2 / R9 have no ISIN column [VERIFIED], so the CAMS product code → ISIN mapping
    needs a CAMS product master or a manual map.

### 7.8 `folio_holders` — new (joint holders, guardian)

- **Columns:** `id`, `tenant_id`, `folio_id` (FK `(tenant_id, folio_id)`), `position`
  (1..3), `role` (first / joint / guardian), `name`, `pan_hash`, `pan_last4`,
  `investor_id` (nullable link), `source_import_id`, `valid_from`, `valid_to`.
- **Key:** UNIQUE `(tenant_id, folio_id, role, position, valid_from)`.
- **History:** a change closes the old row (`valid_to`) instead of overwriting it.

### 7.9 `rta_recon_results` — new

- **Columns:** `id`, `tenant_id`, `import_id`, `check_code`, `scope` (batch / folio /
  scheme / economic_txn), `scope_ref`, `status` (pass / fail / unverified), `expected`,
  `actual`, `delta`, `detail jsonb`, `created_at`.
- **Index:** `(tenant_id, import_id, status)`.

### 7.10 Rollout, recovery, compatibility

- **Order:** 7.7 → 7.1 → 7.2 → 7.3 / 7.5 → 7.4 → 7.6 → 7.8 → 7.9. Each migration is
  standalone and reversible by `DROP`.
- **Feature flag `RTA_PIPELINE_V2` per tenant:**
  - off: the legacy path, unchanged;
  - shadow: stage + reconcile, no commit — the comparison report runs here;
  - on: staged commit.
- **Recovery:** because legacy business rows are never mutated, turning the flag off
  restores today's behaviour. Staged data is discardable.
- **Legacy data** is assessed read-only first (step H). Adoption only links rows; it never
  changes them.

---

## 8. Reconciliation rules [PROPOSAL]

Each check writes `rta_recon_results` with **pass / fail / unverified**. A commit is
blocked by any **hard** failure.

| # | Check | Scope | Severity |
|---|---|---|---|
| R1 | Raw data rows = Σ row dispositions; every row terminal | batch | hard |
| R2 | Rows `committed` + `committed_as_part` = rows linked to committed economic transactions, holdings positions or master updates | batch | hard |
| R3 | Multi-lot: ΣUnits / ΣAmount / ΣLoad / ΣSTT of the lots = the economic transaction; `Σ(Units × Nav) − ΣAmount − ΣLoad` within tolerance | economic txn | hard |
| R4 | Field fidelity: committed date, units (4 dp), amount (2 dp), NAV (4 dp) equal the normalized source; any precision loss fails | row | hard |
| R5 | Holdings: Σ positions units / value = statement totals; each position = its source line | statement | hard |
| R6 | AUM: folio and investor AUM from current positions = Σ positions; registrar vs calculated value delta reported | folio / investor | info |
| R7 | Roll-forward: opening snapshot + Σ committed unit movements between dates = closing snapshot (per folio × scheme × ARN). **Runs only when both snapshots exist AND the transaction coverage between them is complete** (feeds for every business day in range); otherwise **UNVERIFIED**. | position | warn (never auto-fix) |
| R8 | Re-import: a re-run of the same checksum creates 0 economic transactions; identity collisions listed | batch | hard |
| R9 | Reversal / cancellation / pre-rejection rows linked to originals; unlinked = open exception | row | warn |
| R10 | Tenant: every staged / committed row's tenant = its batch tenant; no FK pair crosses tenants (composite keys make this structural) | batch | hard |
| R11 | Every non-committed row has a reason and an exception state | batch | hard |

The engine **never creates synthetic transactions** to close a gap. Today's
reconciliation "Sync" inserts a synthetic purchase dated today; that action is removed in
step G.

---

## 9. Identity: clients, folios, schemes [review of current behaviour + proposal]

| Situation | Today (after Phase 2 / 2B) [VERIFIED in code / tests] | Proposal |
|---|---|---|
| One client, many folios | Folios key on (AMC, folio); client by valid PAN | Unchanged |
| Different clients, same name | Never merged; PAN-less clients key on the folio (`NOPAN:FOLIO:`) | Unchanged |
| Minor with guardian's PAN | R9 / MFSD211 create the minor (`MINOR:<guardian PAN>:<NAME>`), linked to the guardian; R2 rows with the guardian's PAN attach to the minor (`isGuardianOf`) | Add `folio_holders` role=guardian; store the minor key in a new `investors.rta_identity_key` instead of the `pan` column (additive; the `pan` value stays until reviewed) |
| One investor, many AMCs | Same PAN → same client | Unchanged |
| Folio first on a placeholder | Master import **holds** the folio (automatic reassignment is OFF, `AUTO_REASSIGN_FROM_PLACEHOLDER = false`) | Stays OFF. A reviewer action "assign folio to client" moves the folio, its transactions and its positions in one audited step, with an undo. |
| Folio with many schemes | Legs in `folios.schemes` | Positions per scheme × ARN (§5) |
| Registrar changes investor details | Master fills blanks only; never clobbers CRM-owned fields | Store a per-field diff (registrar value vs CRM value) in the staging `match` and surface it as an info exception; no silent overwrite |
| AMC code spellings differ across reports | Folio held when ambiguous | `rta_amc_map` canonical code; a new `folios.amc_id` column (nullable, additive); duplicates reported, not merged |
| Scheme identity | Registrar code; AMFI code only via the rich importer's ISIN / name match | `rta_scheme_map`; positions and economic transactions carry `isin` / `amfi_code` when mapped; unmapped → exception `scheme_unmapped` (info) |

---

## 10. Compatibility and migration risks

| Risk | Mitigation |
|---|---|
| `order_id` collisions with legacy rows (old line-number refs `cams_<n>` / `kfin_<n>`, reused numbers across AMCs) | Never overwrite: adopt only exact matches; else post with `order_id NULL` and log |
| Legacy rows misclassified before Phase 2B (systematic switch-outs stored as `sip` inflows; reversals stored as purchases) | Step H: read-only impact report. Re-derive from the S3 originals in shadow mode and diff against `transactions`. A repair is a separate, reviewed, reversible script |
| `folios.schemes` readers (~85) | Kept as a projection; same keys plus `asOf` |
| Volume: staging per row | Monthly partitions; compaction of `normalized` |
| PII in staging | No names / contacts; PAN as HMAC + last 4; raw stays in S3 |
| Order dependence (transactions before masters) | Staging matches after all batches of a business day are parsed, or re-matches held rows when a master commits ("re-evaluate held rows" job) |
| Registrar layout drift | `parser_version` per batch; required-column checks already refuse unknown layouts |
| One sample per report | Every rule tagged with its evidence; unobserved classes (ordinary switch, IDCW) stay disabled until a sample confirms them |

**Questions for the owner / registrar** (not answerable from the files):

1. Is the KFintech investor payout for a redemption `ΣAmount` or `ΣAmount − STT`?
2. Are the 5 "Systematic – NEFT / Electronic payout … Instalment" CAMS rows SWP payouts?
3. Which holdings reports list the **full book** (so absence means zero) vs an ARN or
   period subset: R9, WBR22, MFSD203, MFSD310?
4. Can the registrar send `original_trxnno` / `RejTrnoOrgNo` for reversals and
   pre-rejections, or is there a separate reversal report?
5. What record-retention period applies to raw mailback files and staging rows?
6. Is a since-inception feed available per firm (needed for roll-forward
   reconciliation R7)?

---

## 11. Implementation roadmap (Phase 3B onward)

Each step is one reviewable PR, behind `RTA_PIPELINE_V2` where it touches posting.

### A. Transaction classification and regression tests
- **Files:** `src/lib/integrations/cams-feed-parser.ts` (split into
  `src/lib/rta/classify/{cams,kfintech}.ts`), `tests/rta-real-layouts.test.ts`.
- **Migration:** none (store `rta_class` once B / D land).
- **Tests:** every observed code combination (table 4.2 / 4.5) plus negative cases;
  ordinary switch and IDCW stay "unknown" until a sample confirms them.
- **Risk:** low. Classification changes only new imports.
- **Accept:** 100 % of the real-file rows classified as in §4, the 5 inferred SWPs
  flagged, and no unknown code mapped.

### B. Staging and batch audit trail
- **Files:** `src/lib/rta/staging/{rows,batch,normalize}.ts`, the worker
  (`rta-import-worker.ts`).
- **Migrations:** 7.1, 7.2.
- **Tests:**
  - R1 / R11 on the four real-layout fixtures;
  - a re-run creates a new batch;
  - no PII in `normalized` (scan test);
  - RLS / tenant tests.
- **Risk:** medium (volume) → shadow mode first.
- **Accept:** every source row of every batch has exactly one terminal state, with
  counts equal to the file.

### C. KFintech multi-lot redemptions
- **Files:** `src/lib/rta/economic/kfintech-lots.ts`.
- **Migrations:** 7.3, 7.5.
- **Tests:**
  - the 9-group structure reproduced with synthetic data, including split lots, the STT
    row, and an arithmetic failure → exception;
  - restatement (lot added) → exception;
  - duplicate → no-op.
- **Accept:** all 143 lot rows of the real file are staged; 9 economic transactions with
  sums equal to the file; 0 partial posts.

### D. Idempotent economic transaction posting
- **Files:** `src/lib/rta/economic/post.ts`; adoption of legacy rows.
- **Migration:** 7.4.
- **Tests:**
  - A–F of Phase 2B on the new path;
  - legacy adoption (exact match → link only; mismatch → exception);
  - `order_id` collision → NULL order_id + log.
- **Risk:** high (touches `transactions`) → shadow diff report before enabling for any
  firm.
- **Accept:** re-import gives 0 new rows; shadow diff vs legacy = only the documented
  fixes.

### E. Dated holdings snapshots
- **Files:** `src/lib/rta/holdings/{statement,current,projection}.ts`;
  `lib/finance/aum-persist.ts` reads the projection.
- **Migration:** 7.6.
- **Tests:**
  - an older statement imported after a newer one → current unchanged;
  - zero vs absent;
  - two ARNs;
  - same-date conflict → exception;
  - the projection equals today's legs for an identical single statement.
- **Accept:** R9 real-layout fixture 1,237/1,237 positions and equal totals; no
  `folios.schemes` reader changes behaviour on a single statement.

### F. Canonical AMC and scheme mapping
- **Files:** `src/lib/rta/reference/{amc,scheme}.ts`.
- **Migrations:** 7.7, plus `folios.amc_id`.
- **Tests:** mapping from the KFintech ISIN column; CAMS unmapped → info exception;
  duplicate-folio report.
- **Accept:** no automatic merging of folios; the mapping coverage report per firm.

### G. Reconciliation dashboard and exception handling
- **Files:** `src/lib/rta/recon/*.ts`, `/dashboard/rta-imports/[id]` (checks tab),
  `/dashboard/rta-imports/exceptions` (state + resolve).
- **Migrations:** 7.9, 7.8.
- **Tests:**
  - R1–R11 unit tests;
  - R7 returns UNVERIFIED without coverage;
  - the synthetic "Sync" purchase removed.
- **Accept:** every batch shows its checks; an exception can be acknowledged / resolved
  with an audit entry.

### H. Historical data impact assessment and reviewed repair
- **Files:** `scripts/rta-impact-report.ts` (read-only),
  `scripts/rta-repair-<case>.ts` (one per case, each with dry-run and undo).
- **Migration:** none.
- **Tests:** on a copy of production data, never live.
- **Read-only measures:**
  - transactions with `order_id ~ '^(cams|kfin|feed)_[0-9]+$'`;
  - RTA transactions whose re-derivation from the S3 original differs (type / direction /
    amount / date);
  - folios duplicated across AMC spellings;
  - placeholders still holding folios;
  - holdings legs without an ARN beside ARN legs.
- **Accept:** a signed-off impact report per firm before any repair script runs; every
  repair reversible and audited.

---

*Evidence scripts (not committed; they read the real files from a private scratch
folder): lot analysis, switch / STP analysis, KFintech STP analysis, field-fidelity
reconciliation. They print aggregates only.*
