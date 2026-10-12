# RTA Import — Phase 3B: Unified staging foundation (SHADOW)

Status: **development only.** Built on branch `claude/relaxed-mendel-01jprq`, not
merged, not deployed. Migration 0233 has been applied only to local, isolated
test databases. `RTA_PIPELINE_MODE=on` does not exist yet and is refused.

Builds on [PHASE3A_DESIGN.md](PHASE3A_DESIGN.md). Where 3B differs from that
proposal, this file says so.

---

## 1. What was built

| Piece | Where | What it does |
|---|---|---|
| Migration | `drizzle/migrations/0233_rta_staging.sql` | 5 new tables (§2), plus one unique index on `rta_file_imports (tenant_id, id)`. Additive only. |
| Drizzle schema | `src/db/schema/rta_staging.ts` | Mirrors 0233 (`check:schema` passes). |
| Feature flag | `src/lib/rta/staging/config.ts` | `RTA_PIPELINE_MODE` off / shadow (on is refused); `RTA_PIPELINE_TENANTS` allow-list. |
| PAN tokens | `src/lib/rta/staging/pan-token.ts` | `pt1:` HMAC-SHA256 tokens, keyed and tenant-separated (§5). |
| Classification (3B-A) | `src/lib/rta/staging/classify.ts` | Business class + confidence + held reason (§3). |
| Layouts | `src/lib/rta/staging/layouts.ts` | MFSD201, R2, R9, MFSD211 identified by required headers; rows normalized with exact decimals. |
| Source reader | `src/lib/rta/staging/source.ts` | The same decoders as the importer; row number = position in the file. |
| Grouping | `src/lib/rta/staging/group.ts` | Registrar transactions, redemption lots, exact sums, tolerances (§4). |
| Checks | `src/lib/rta/staging/checks.ts` | Reconciliation checks: pass / fail / unverified (§6). |
| Pipeline | `src/lib/rta/staging/pipeline.ts` | Stages, lease, advisory lock, idempotency, read-only matching and legacy comparison (§7). |
| Entry points | `src/lib/rta/staging/index.ts` | `shadowImport`, `runShadowForImport` (the worker hook, never throws), `loadBatchReport`. |
| Worker hook | `src/workers/rta-import-worker.ts` | Feed and master paths: when shadow is on, stage the same decoded file **after** the existing import has finished. |
| API (read-only) | `src/app/api/rta-staging/batches/route.ts`, `…/[id]/route.ts` | GET only, behind the RTA import access rule. |
| CLI | `scripts/rta-shadow.ts` | Stages local files. Refuses unless the mode is shadow and the database is localhost. |
| Tests | `tests/rta-staging-unit.test.ts` (35), `tests/rta-staging-db.test.ts` (15) | §8. |

The existing importer is unchanged: `process.ts`, `import.ts`, the parsers and
their classifier are untouched. Automatic placeholder reassignment stays
disabled. No existing constraint changed.

---

## 2. Database (migration 0233)

Every table has `tenant_id NOT NULL REFERENCES tenants`, `UNIQUE (tenant_id, id)`,
ENABLE + FORCE row-level security, and a `tenant_isolation` policy (same form as
every other table). Relationships between staging tables are composite
`(tenant_id, x_id) → (tenant_id, id)` foreign keys, `ON DELETE RESTRICT`. A row
therefore cannot point at another firm's batch even when RLS is bypassed (tested).
References to live CRM rows (matched investor or folio, a legacy transaction)
are soft, with no FK: a proposal never locks or cascades from a financial record.

| Table | Grain | Key columns | Constraints |
|---|---|---|---|
| `rta_staging_batches` | one file processed once | `file_checksum`, `file_ref`, `import_id`, `rta`, `report_code`, `record_kind`, `parser_version`, `identity_scheme`, `state`, `attempt`, `lease_owner`, `lease_until`, `same_file_as_batch_id`, `rerun_of_batch_id`, `row_count`, `counts`, `stage_log`, `error` | `mode` CHECK `'shadow'`; `state` CHECK (9 states); FK `(tenant_id, import_id)` → `rta_file_imports`; self-FKs for rerun and same-file |
| `rta_staging_rows` | one source row | `row_no` (position in this file), keyed `row_hash`, `state`, `rta_class`, `class_confidence`, `registrar_txn_no`, `economic_key`, normalized figures (`units`, `amount`, `nav`, `price`, `load_amount`, `stt`, `stamp_duty`, `holding_value`), dates, `pan_token`, `guardian_pan_token`, match columns, `attrs`, `validation` (issues and the source text of each figure), `exception_code`, `reason` | `UNIQUE (batch_id, row_no)`; `state` CHECK (12 states); FK to batch and to economic transaction |
| `rta_staging_economic_txns` | one registrar transaction per batch | `identity_key`, `registrar_txn_no`, `rta_class`, `class_confidence`, `direction`, `status`, reported sums, derived gross / delta / tolerance, keyed `invariant_hash` and `lot_signature`, `duplicate_of_id`, match columns, `proposed_action`, `legacy_transaction_id` | `UNIQUE (batch_id, identity_key)`; `status` CHECK (complete, quarantined, duplicate, restated, conflict); `proposed_action` CHECK |
| `rta_staging_lots` | one source lot row | `registrar_lot_id`, `lot_part`, purchase txn no / date / units / amount, `units`, `amount`, `price`, `nav`, `load_amount`, `stt` | `UNIQUE (tenant_id, row_id)`: a source row is at most one lot |
| `rta_staging_checks` | one check result | `check_code`, `scope`, `scope_ref`, `status`, `expected`, `actual`, `tolerance`, `detail` | `UNIQUE (batch_id, check_code, scope, scope_ref)`; `status` CHECK (pass, fail, unverified) |

**Changes from the 3A proposal:**
- Staging lives in its own tables. It does not add columns to `rta_file_imports`
  or `transactions`; nothing in an existing table changes shape.
- `rta_holding_statements` and `folio_holders` are not built yet (§10).

---

## 3. Classification (Phase 3B-A)

| Source | Rule | Class | Confidence | Evidence |
|---|---|---|---|---|
| CAMS | flag `(Fresh\|Additional) Purchase Systematic` | `sip_investment` | verified | R2: 1,178 rows |
| CAMS | flag `(Fresh\|Additional) Purchase`, description "Systematic … Instalment" | `sip_investment` | verified | R2 |
| CAMS | flag `(Fresh\|Additional) Purchase` | `purchase` | verified | R2: 39 rows |
| CAMS | flag `Full/Partial Redemption` + "Systematic withdrawal" | `swp_withdrawal` | verified | R2: 4 rows |
| CAMS | flag `Partial Redemption` + "Systematic … Instalment", no "withdrawal" | `redemption` + note `inferredSwp` | **inferred** | R2: 6 rows (3A counted 5; the run counts 6) |
| CAMS | flag `Full/Partial Redemption` | `redemption` | verified | R2: 25 rows |
| CAMS | flag `Switch In` / `… Switch Out` with **both** markers (description starts "Systematic" **and** `siptrxnno` present) | `stp_in` / `stp_out` | verified | R2: 40 + 42 rows |
| CAMS | switch flag with **neither** marker | `switch_in` / `switch_out` | inferred | not in the sample; plain reading of the flag |
| CAMS | switch flag with **one** marker | held: `switch_stp_ambiguous` | — | the STP rule is not generalised |
| CAMS | `reversal_code` / `original_trxnno` / "revers" | held: `reversal_unlinked` | — | none in the sample |
| CAMS | "cancel" / "reject" | held: `cancellation_unlinked` / `pre_rejection_unlinked` | — | none in the sample |
| CAMS | dividend / IDCW wording | `idcw_payout` / `idcw_reinvest`, held: `class_unverified_idcw` | inferred | none in the sample |
| CAMS | `trxnstat` not processed | held: `registrar_status_not_processed` | — | all "Y" in the sample |
| KFintech | `Transaction Type` SIN / ADD, NEW / FUL, RED / SWD / STPA / STPO | sip_investment / purchase / redemption / swp_withdrawal / stp_in / stp_out | verified | MFSD201 |
| KFintech | the code's `Transaction Head` (P or R) disagrees | held: `head_code_conflict` | — | never seen in the sample |
| KFintech | SIND / STPAD / STPOD, "pre-rejection" | `rejection`, held: `pre_rejection_unlinked` | verified | 3 rows |
| either | anything else | held: `unknown_transaction_code` | — | |

Every class maps onto today's `transactions.type` and direction
(`CLASS_META`). Each class is also marked as an external cash flow
(purchase, SIP, redemption, SWP), an internal transfer (switch, STP) or income
(IDCW). These are the same semantics `lib/metrics/business.ts` already applies.

---

## 4. KFintech redemption grouping and tolerances

- **Identity:** `kfin.v1:<Fund>:<Transaction Number>` and `cams.v1:<amc_code>:<trxnno>`.
  The row number never enters it (tested: reordering the file gives the same
  key, invariant hash and lot signature).
- **Multi-lot rule:** several KFintech rows with one transaction number, all of
  an outflow class and all carrying lot data, form **one** economic redemption.
  - Reported units, amount, exit load, STT and stamp duty are the **exact
    decimal sums** of the rows. They are printed to the precision of the input,
    using scaled integers, not floats.
  - `derived_gross_amount` (Σ units × NAV) and `arithmetic_delta` are stored
    **beside** the reported figures, never over them.
- **Every lot is its own row** in `rta_staging_lots`, linked to its source row.
  - A lot split into a load part and a no-load part is two lots of the same
    `registrar_lot_id`: `lot_part` 1 and 2.
  - Two byte-identical lot rows stay two lots (tested).
- **All or nothing:** one unreadable row, a class mismatch, a held class, rows
  that disagree on an invariant column, STT on more than one row, or a lot or
  group outside tolerance holds the **whole** group. Nothing posts partially.
- **Repeated numbers in any other shape** are held
  (`repeated_reference_unverified`): KFintech non-redemptions, and every CAMS
  case.
- **Tolerances come from the printed precision.** The test for one lot is
  `|units × NAV − load − amount| ≤ ½ulp(amount) + ½ulp(load) + ½ulp(units)·NAV + ½ulp(NAV)·units`.
  - The group tolerance is the sum of the lot tolerances.
  - "ulp" is 10^−d, where d is the **column's** precision in that file: the
    most decimals any row printed. MFSD201 prints NAV with 2, 3 or 4 decimals
    in the same column, so "328.1" is 328.1000.
  - There is no ₹1 or percentage allowance.
- **STT and payout:** STT is stored separately and excluded from the
  arithmetic. Whether the investor received Σamount or Σamount − STT is
  reported as **UNVERIFIED**.

---

## 5. Personal data

- **Never stored:** PANs, names, addresses, phone numbers, emails, bank details
  and nominees. `attrs` holds only transaction codes and wording, tax status,
  holding mode, and booleans such as "has a SIP registration".
- **PANs become tokens:** `pt1:` + HMAC-SHA256(key, `tenantId:PAN`).
  - The key is `RTA_STAGING_TOKEN_KEY` if set; otherwise HKDF-SHA256 of
    `ENCRYPTION_KEY` with a staging-only label.
  - There is no fallback key. Without one, staging refuses to run
    (`PanTokenKeyMissingError`).
  - Tokens differ per tenant.
  - Row hashes, invariant hashes and lot signatures use the same keyed
    construction, under different labels.
- **Rotation:** a new key or construction gets the prefix `pt2:`. Old batches
  keep their tokens as audit history, and tokens are compared only within one
  version.
- **Real-file proof:** every PAN, name, email and mobile value in the four
  files (4,147 distinct values) was searched for in every staging table. There
  were **0 hits**.

---

## 6. Reconciliation checks (per batch)

| Check | Blocking | Meaning |
|---|---|---|
| `rows.raw_count`, `rows.missing_source_rows`, `rows.accounted` | yes | Every data row is staged exactly once, numbered 1..N, and ends in a final state. |
| `values.dates`, `values.figures` | yes | The normalized value equals an independent reading of the source cell. |
| `rows.invalid` | no | Rows whose mandatory value could not be read, with reasons. |
| `identity.resolution` | yes | Every valid row has an identity decision. |
| `identity.conflicts` | no | Rows held for a folio-owner conflict, placeholder, merge or Trash. |
| `class.coverage` | yes | Every transaction row is classified. |
| `class.transfer_leg_pairing` | — | Always UNVERIFIED: the other leg is in another folio or file. |
| `econ.summary`, `rows.identical_in_file` | no | Counts. |
| `econ.lot_arithmetic`, `econ.group_arithmetic` | no (the group is already held) | Per transaction, against the stated tolerance. |
| `econ.group_completeness`, `econ.payout_semantics`, `econ.lot_purchase_history` | — | UNVERIFIED, with the reason. |
| `legacy.comparison` | no | Read-only comparison with the existing importer: adopt_legacy, legacy_conflict, post_new or unmatched. |
| `holding.as_of_single`, `holding.totals`, `holding.zero_positions` | totals yes | Holdings statements. |
| `holding.value_vs_nav`, `holding.vs_transactions` | — | UNVERIFIED: no NAV and no opening balance in the file. |
| `tenant.isolation` | yes | Read from the catalogue: RLS enabled, forced and a policy on all 5 tables. |

A failing **blocking** check puts the batch in `exception`. A data finding holds
only the rows it concerns.

---

## 7. Pipeline, idempotency, concurrency, recovery

```
uploaded ─identify─▶ identified ─parse+validate─▶ validated ─match─▶ matched
         ─group+reconcile─▶ ready_to_commit | exception        (any stage ─▶ failed)
```

- **Atomic stages:** each arrow is one tenant-scoped transaction. The batch's
  `state` is the last stage that committed, and `stage_log` records every
  stage, attempt and duration. A failure rolls back that stage only. The batch
  is marked `failed` with its error, and the next run resumes from the last
  committed stage (tested by injecting a failure inside the last stage). The
  same bytes are required: the checksum is verified on resume.
- **Lease:** `lease_owner` / `lease_until` (10 min) is taken at the start of a
  run, so two workers never run one batch.
- **Advisory lock:** the group stage takes a per-tenant transaction-scoped
  advisory lock, so two batches carrying the same registrar transaction are
  decided in sequence (tested with two concurrent imports of the real MFSD201:
  one `complete`, one all `duplicate`).
- **Memory:** the file is read once into memory, within the importer's existing
  size limits plus `RTA_STAGING_MAX_ROWS`, which defaults to 250,000. Writes
  are chunked at 500 rows.

| Case | Rule | Result on the real files |
|---|---|---|
| 1. The same batch again | A final state is a no-op; `(batch_id, row_no)` is unique | `ready_to_commit`, nothing added |
| 2. The same file as a new batch | `same_file_as_batch_id` is set; every transaction is `duplicate` of the first | 4 files: 1,334 / 685 econ duplicates; 1,237 / 648 rows duplicates |
| 3. Overlapping periods | Same key, same invariants and same lots as an earlier batch → `duplicate` | tested (synthetic week 1 / week 2) |
| 4. A corrected report | Same key and invariants, different lots → `restated`; different invariants → `conflict`; both are held and neither side changes | tested (a missing lot; a changed folio) |
| Transactions before masters | First run: `unmatched`, nothing created. Then a **rerun** batch (`rerun_of_batch_id`) is re-matched; the batch it reruns is set aside for duplicate detection | real R2 and MFSD201: 1,334 / 819 rows matched, `post_new` |

---

## 8. Verification

- **Unit tests** (`tests/rta-staging-unit.test.ts`, 35): CAMS and KFintech
  classification, including Switch vs STP; the four real layouts; exact values;
  grouping; identical lots; repeated references; incomplete groups;
  discrepancies; tolerances; tokens; the flag.
- **Database tests** (`tests/rta-staging-db.test.ts`, 15, real Postgres with
  RLS):
  - all four layouts;
  - groups and lots;
  - same batch and same file;
  - overlap;
  - corrections;
  - invalid and unsupported data;
  - transactions before masters;
  - failure and retry;
  - concurrency;
  - Switch vs STP;
  - discrepancies;
  - zero change to live tables;
  - tenant isolation, including a cross-tenant composite-FK insert being
    refused in system context;
  - API read-only and access gate;
  - the worker hook in off, on and shadow modes.
- **Real files:** a scratch script (not committed) ran all four mailbacks
  through shadow in a throwaway database. The results are in the Phase 3B
  report. Headline figures:
  - **Row accounting**, against independent raw counts: R2 1,334 · MFSD201 819
    · R9 1,237 · MFSD211 648.
  - **MFSD201 groups and lots:** 9 multi-lot groups holding 143 lot rows;
    23 single-lot outflows; 3 pre-rejections held.
  - **MFSD201 economic transactions:** 685 = 819 − 143 + 9.
  - **Live tables:** fingerprints of all 191 non-staging tables are identical
    before and after every shadow run.

---

## 9. Rollout and rollback (reversible, no table drops)

1. **Review** this branch: migration 0233, the code and the tests. The deploy
   job runs migrations, so 0233 reaches production only when this branch
   merges. Merge only after sign-off.
2. **After merge, the default is `RTA_PIPELINE_MODE=off`.** The migration only
   adds empty tables and one unique index on `rta_file_imports (tenant_id, id)`,
   which is unique already because `id` is the primary key. That index builds
   inside the migration's transaction (not CONCURRENTLY), so it holds a brief
   write lock on `rta_file_imports` while it builds. Run the migration outside
   import hours. Nothing reads the new tables and no behaviour changes.
3. **Pilot:** set `RTA_PIPELINE_MODE=shadow` and `RTA_PIPELINE_TENANTS=<one firm>`.
   Watch the batch reports through `/api/rta-staging/batches`. The existing
   import result is unaffected: the hook runs afterwards and cannot throw.
4. **Widen** by extending the allow-list, then removing it.
5. **Rollback** at any step: set `RTA_PIPELINE_MODE=off`. Staged data stays as
   an audit trail and no figure anywhere reads it. Removing the tables is a
   separate, signed-off step after an export. It is never part of a rollback,
   and the `RESTRICT` foreign keys refuse a casual delete.
6. **Data retention:** staging holds no PAN or contact data. Old batches can be
   archived by tenant and date. A later phase should set the retention period.

---

## 10. Not built in 3B (next phases)

- **Posting** (`RTA_PIPELINE_MODE=on`):
  - add `rta_economic_txn_id`, `exit_load` and `stt` to `transactions`
    (nullable);
  - post `complete` + `post_new` transactions in one transaction per batch
    under the advisory lock;
  - link `adopt_legacy` rows;
  - send `legacy_conflict`, `restated` and `conflict` to a review queue;
  - keep `transactions (tenant_id, order_id)` unique.

  **Migration risk:** a backfill of the link column over existing rows, and
  `order_id` collisions across AMCs. The key is not approved as universal.
- **Holdings snapshots:** `rta_holding_statements` and `rta_holding_positions`
  from R9, plus a `rta_current_positions` view. Today the R9 rows are staged
  only.
- **Linking rejections, reversals and cancellations to their originals:** held
  today.
- **Transfer leg pairing, `folio_holders` (joint / guardian), canonical AMC and
  scheme maps, and a reconciliation dashboard.**
