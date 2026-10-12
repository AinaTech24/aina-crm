# RTA Phase 3D — Final source selection and safety review

Status: **development and shadow testing only.** Nothing here is deployed or
merged, and no production data has changed. Live posting stays off
(`RTA_PIPELINE_MODE` accepts only `off` / `shadow`).

The evidence comes from the same real mailbacks as Phase 3C:

- May: CAMS R2 / R9, KFintech MFSD201 / MFSD211.
- October: CAMS WBR4 / WBR10 / WBR49, KFintech MFSD201 / MFSD203 / MFSD211 /
  MFSD230 / MFSD243.

The files were read in memory only. Every figure below is an aggregate. No
real file, PAN, name or contact detail has been committed.

---

## 1. The SIP Book (Task 1)

### 1.1 Registration identity

| Registrar | Registration id | Evidence | Master key |
|---|---|---|---|
| KFintech | MFSD243 `RegSlno` = MFSD201 `sipregslno` | 8 of 9 MFSD243 ids appear as `sipregslno` in October MFSD201. The 9th starts after the file date. Both STP legs carry their registration's id (16/16). Ids are 7–8-digit (older) or 15-digit (date-coded). The date prefix equals the registration date on only 3 of 9, so it is **never parsed**. | `reg:kfintech:<Fund>:<RegSlno>` |
| CAMS | WBR49 `auto_trno` | 6-digit; 1 row in the sample | `reg:cams:<amc_code>:<auto_trno>` |
| CAMS R2 | `siptrxnno` | 1,189 distinct, 6–8 digits; `sys_regn_date` 2012–2026. **No evidence links it to `auto_trno`.** | Its own namespace (`sipref:cams:…`); never merged into a WBR49 registration |

MFSD243 `Fund Code` equals MFSD201 / MFSD203 `Fund` on every folio they share
(8/8; the 9th folio appears in no other file). It is therefore the same AMC
namespace.

### 1.2 Which file does what

| Question | Answer |
|---|---|
| Creates a registration | MFSD243 (KFintech) and WBR49 (CAMS) — each row has an id. MFSD230 can describe a registration but cannot key one: it has no id. |
| Establishes current status | MFSD243 `Status` / `TerminateDate` (KFintech). WBR49 `cease_date`, `pause_from_date`, `pause_to_date` (CAMS; no status column). A status is valid only for 35 days after its report date (`sip-lifecycle.ts`); after that the state is UNKNOWN. |
| Instalments | MFSD201: processed `SIN` / `STPA` / `STPO` / `SWD`, plus failed `SIND` / `STPAD` / `STPOD` (§3), linked to their registration by `sipregslno`. CAMS R2 instalments carry only `siptrxnno`, whose link to WBR49 is not established. |
| Paid / pending instalment counts | Only MFSD230 has them (`PAIDINST`, `PENDINST`, `INSTALNO`; paid + pending = total on 20/20). |

### 1.3 Is MFSD243 history the full population?

**Not as sampled.** Run over the real files, the master
(`src/lib/rta/sip-master.ts`) holds:

- **28 registrations:**
  - 10 keyed: 9 from MFSD243 and 1 from WBR49.
  - 18 unkeyed, from MFSD230.
- 2 of MFSD230's 20 rows attach to an MFSD243 registration on an exact unique
  match.
- **Coverage against instalments:**
  - KFintech: the transaction feeds reference 727 registrations; the master
    describes 7 of them; **720 are missing.**
  - CAMS: R2 references 1,187; **all 1,187 are missing.**

  Those registrations were made between 2018 and 2026 (KFintech) and between
  2012 and 2026 (CAMS). The sampled MFSD243 and WBR49 cover one week of new
  registrations.

To fill the master:

- **Bootstrap**, once: pull MFSD243 for registration dates from 2018 (or the
  ARN's first registration) and WBR49 from 2012.
- **Ongoing**: pull both weekly or monthly for the new period.
- **The master reports this gap itself** (`coverage.missingFromMaster`). The
  book is not complete until that number is 0.

### 1.4 Terminations, pauses and expiry

None of these appear in any sample:

- MFSD243: every row is "Live SIP" or "Live STP", with no `TerminateDate`.
- WBR49: `cease_date` and both pause dates are blank on the one row.

**Whether a long-history MFSD243 lists terminated registrations is unverified.**

- If it does, a periodic full-history MFSD243 establishes current status.
- If it does not, MFSD231 / MFSD229 (or the registrar's cancellation report)
  becomes required.

The master is built so that either source works:

- The latest lifecycle report wins.
- A registration whose last lifecycle report is older than 35 days reads
  UNKNOWN, never ACTIVE.

### 1.5 Rules the master enforces (tests: `tests/rta-sip-master.test.ts`, 17)

- **One registration per key, across overlapping files.**
  - Attributes come from the latest dated observation.
  - The earliest registration date is kept.
  - A contradiction in AMC, folio or scheme raises the exception
    `registration_attribute_conflict`.
- **SIP vs STP vs SWP** comes from the registrar's code:
  - Verified: KFintech `SIP` / `STP`, CAMS `P`.
  - Documented earlier: CAMS `SO` / `R` / `DTP`.
  - Anything else is `unknown` and excluded from the book.
- **Frequency** is read only from the codes and words this code recognises. An
  unreadable frequency is never assumed monthly: the registration is set aside
  (`activeWithUnknownFrequency`).
- **State** comes from `sipStateOn`:
  - A future start is PENDING (5 of MFSD243's 9).
  - No lifecycle report gives UNKNOWN (every unkeyed MFSD230 row).
  - **A failed instalment is counted (`instalments.rejected`) and never changes
    the state.**
- **Matching an unkeyed MFSD230 row:**
  - It attaches only on a unique exact match of registrar, AMC, folio, scheme,
    amount, frequency and start date.
  - Two or more matches raise `unkeyed_ambiguous`, and it attaches to none.
  - MFSD230 never changes lifecycle facts.
- **An STP's two legs on one date count as one instalment.**
- **Active SIP Book** = kind SIP and state ACTIVE, with a known frequency and
  amount. PENDING, UNKNOWN, STP, SWP, paused and stopped registrations are
  reported **beside** the book, not in it.
- **Real files:** the master's Active SIP Book counts **4** active SIPs, with
  **5 pending, 14 unknown and 5 STPs reported beside it**. The legacy importer
  counts 9 active, 5 of which have not started.

## 2. AUM and portfolio presentation (Task 2)

`src/lib/rta/aum-view.ts` (pure; tests `tests/rta-aum-view.test.ts`, 8) builds
on `holdings-snapshot.ts`.

- **One card per registrar × ARN.** Each card shows:
  - the registrar-reported value;
  - the as-of date and the age in days;
  - stale (more than 7 days old, configurable);
  - whether the statement is the full book;
  - positions, zero positions and unvalued positions;
  - the number of AMCs;
  - **coverage gaps**: folios another file proves the firm holds, on or
    before the statement's date, that the statement does not list.
- **Firm-wide AUM is printed only when** every required scope has a full-book
  statement, none is stale, none has a gap and no position is unvalued.
  Otherwise the value is `null` with every reason listed. The cards still show.
- **One position, two valuations.**
  - The registrar's value (with its statement date) and units × the CRM's
    latest NAV (with the NAV date) are both kept, and each is labelled.
  - A live NAV older than the statement never replaces the statement's value.
  - No value and no NAV shows as unknown, never as ₹0.
  - A nil balance is ₹0 and is still a position.

**MFSD203 coverage, checked rather than assumed:**

- 1,943 positions, 329 of them at zero units.
- 22 funds and a single ARN.
- Dated 2026-10-08.
- **2 folios that other KFintech files evidence are missing:**
  - one older folio seen in May MFSD201 / MFSD211;
  - one new folio in October MFSD211 and MFSD243, whose first instalment had
    not yet been allotted.

Row count does not prove full-book coverage, and the headline stays withheld
until both are explained. CAMS has no full-book statement in the samples, so
firm-wide AUM is withheld on that ground as well.

**Preserving the source value in live data (proposed — §J, step 3):**

- `revalueAllFolios` (`src/lib/finance/aum-persist.ts`) rewrites each leg as
  `{...leg, nav, value}`. It therefore keeps any key it does not set. The
  registrar's figures can live beside it as `sourceUnits`, `sourceValue`,
  `sourceNav`, `sourceAsOf` and `sourceReport`.
- Those keys would be written by the AUM-statement importer, and revaluation
  would never touch them.
- That needs the statement's as-of date, which the legacy AUM parser does not
  yet read. Holding the change back keeps live tables unchanged in this phase.

## 3. Rejection reconciliation (Task 3) — correction to Phase 3C

Phase 3C said "no genuine rejection events" in the samples. **That was wrong
for the May MFSD201.**

| Rows | Codes | What they are | Evidence | Classification now |
|---|---|---|---|---|
| 3 (May) | SIND ×1, STPAD + STPOD ×1 pair | **Genuine failed instalments** | Status Y, units 0, positive amount. Remarks: "Primary KYC Invalid (KYC Modification not Done)" (SIP); "Required amount not available in source fund" (the STP pair: same folio, amount and date). `RejTrnoOrgNo` and `sipregslno` are empty. | `rejection` with `instalment_rejected`. The registrar's reason is kept with digits and PANs masked (`attrs.rejectionReason`). These rows go to the SIP Rejection register, are never posted as transactions, are never counted in investment totals, and never stop a SIP. A row that names an original, carries units or has no amount stays `pre_rejection_unlinked`. |
| 16 (Oct) | SINR "SIP Rejection" | **Not rejections — folio-consolidation reversals** | Remark "Trxn triggered now due to consolidation of folios". Negative amount and units. The same transaction number as the original, with a re-post in the surviving folio. The old folio nets to 0 units and MFSD203 shows it at 0. Trades 2024-01 → 2025-05. | `folio_consolidation` (held). Shown as a registrar correction, never as a rejection. |
| 16 (Oct) | FULR "Redemption Rejection" | the same, for redemptions (trades 2025-06) | as above | as above |
| 1 (Oct) | NEWR "Purchase Rejection" | the same, for a purchase (trade 2026-08) | as above | as above |
| 0 | CAMS R2 | — | No rejected, reversed or remarked row in 1,334 rows | CAMS rejection coverage is **unverified** |

The source wording ("SIP Rejection") is kept as the row's description and is
never taken as its status. A row's effect comes from the status, the units,
the sign and the remarks together.

The **legacy** importer still holds SIND / STPAD / STPOD as "reversal /
rejection / cancellation" rows on the Exceptions page. Routing them into
`sip_rejections` is §J step 2.

## 4. Ownership across every import path (Task 4)

**Rule** (`InvestorDirectory.ownerOf`, `src/lib/rta/identity.ts`; the same
order as `owner.ts`):

1. **The folio on record decides.**
   - It is matched on AMC + folio when the row names an AMC. The number alone
     is used only when every folio under it has one live client.
   - The row's PAN must be the owner's own, or the recorded guardian's of a
     minor owner.
   - A PAN naming **another** client holds the row. The exception: when the
     number-only match is weak (every folio under that number is at a
     different, non-blank AMC), the row is that client's own folio at another
     AMC.
   - A PAN-less (provisional) owner is never displaced by a PAN.
2. **No folio on record:** the row's PAN is taken as the owner's own PAN, with
   three exceptions:
   - a row the registrar marks minor;
   - an individual PAN on an HUF row (the Karta's);
   - a PAN whose client is the recorded guardian of a minor, when the report
     does not state the holder type.

   Each of these is **held** with its reason.
3. Otherwise there is no owner. The processor reports the row, or (AUM
   statement, transaction feed) creates its existing folio-keyed placeholder.

| Entry point | Before | Now |
|---|---|---|
| Transaction feed (`processTransactionFeed`) | PAN first; the CAMS minor guard (3C) | `ownerOf` (plus the 3C minor guard) |
| SIP rejection report | `resolve` — PAN first, no AMC: **a guardian's PAN attached a minor's rejection to the guardian** | `ownerOf`, reading `AMC_CODE` / `FUND CODE` and `TAX_STATUS` |
| SIP register (WBR49 / MFSD243 via the legacy path) | folio by number only; a PAN fallback when the folio has no client | `ownerOf` reading `amc_code` / `Fund Code`; a SIP is never hung on another AMC's folio |
| AUM statement | grouped by folio **number**: one number at two AMCs was one folio | grouped by AMC + folio; `ownerOf` |
| Folio master dump | PAN only | `ownerOf`: a minor's folio stays the minor's; an HUF row with a Karta PAN is held |
| Rich master import (`import.ts`) and mail ingestion | — | Unchanged. Mail and upload both enqueue the same worker job, so every rule above applies to both. |
| NACH mandate status | PAN | Unchanged: a mandate is PAN-bound and owns no folio |

- **Joint holders are valued once:** a folio has one owner
  (`folios.investor_id`); joint holders go in `folio_holders` (no writer).
- **Nothing is repaired retroactively.** No existing row is moved by these
  rules. Placeholder reassignment stays off.

**Still open (named, not changed):**

- The minor key `MINOR:<guardian PAN>:<name>` (name-based).
- The folio-only placeholder key `NOPAN:FOLIO:<folio>` (no AMC).

Both need a reviewed data migration.

Tests: `tests/rta-legacy-owner-db.test.ts` (4 scenarios, 16 rows). All four
fail against the previous processors and pass now. The rest of the RTA suite
still passes.

## 5. Minimum file set, per module (Task 5)

**CAMS: R2 + R9 + WBR49 · KFintech: MFSD201 + MFSD203 + MFSD211 + MFSD243**

| Module | CAMS | KFintech |
|---|---|---|
| Client Master | R9. **Condition:** one all-folio R9 at bootstrap (the sample is activity-scoped) | MFSD211. **Condition:** one full-book pull at bootstrap (1,429 of 1,792 folios had no master row) |
| Accurate AUM | R9 `rupee_bal` as of `rep_date`. **Condition:** all-folio R9 "as on date"; R9 has no NAV | MFSD203 (full book). **Condition:** the 2 coverage gaps explained |
| Active SIP Book | WBR49. **Condition:** a full-history bootstrap (2012→). The R2 `siptrxnno` ↔ `auto_trno` link is unproven | MFSD243 + MFSD201. **Condition:** a full-history bootstrap (2018→), plus proof that it lists terminated registrations (else MFSD231 / 229) |
| Client Portfolio | R9 + R2 | MFSD203 + MFSD201 |
| SIP Rejection / Stop | **Unverified:** R2 carried no rejection. A CAMS rejection report is needed (its code to be confirmed with CAMS) | MFSD201 SIND / STPAD / STPOD (verified: KYC and source-fund failures). Bank bounces are not evidenced (MFSD228 is conditional); registration rejections need MFSD244 |
| Transactions | R2 | MFSD201 |
| Transaction Rejection | Unverified (as above) | MFSD201 (verified failed instalments; R-coded rows are consolidation corrections) |
| SIP Master | WBR49 (+ R2 instalments, unlinked) | MFSD243 + MFSD201 `sipregslno`; MFSD230 for instalment counts |

**MFSD243 vs MFSD230:**

- MFSD243 is the preferred registration source.
- **MFSD230 is retained conditionally**, as the owner decided. It is the only
  source of paid and pending instalment counts, and the master uses it only on
  an exact unique match.
- It can be retired only when both of these are shown:
  - a full-history MFSD243 covers every registration the MFSD201 instalments
    reference (`coverage.missingFromMaster = 0`);
  - MFSD243's status agrees with the instalment evidence for a full cycle.

## 6. Migrations 0233 / 0234 (Task 6)

| Check | 0233 `rta_staging_*` | 0234 `folio_holders` + 2 `investors` columns |
|---|---|---|
| Relationships | Composite `(tenant_id, id)` foreign keys between staging tables. **Fixed:** the import FK was RESTRICT, and the two RTA-import purge routes hard-delete `rta_file_imports`, so they would have failed. It is now `ON DELETE SET NULL (import_id)`: the shadow batch and its history survive and lose only the link. | **Fixed:** `folio_id` is CASCADE (a holder row describes its folio and goes when the folio is purged). `investor_id` is SET NULL (purging a client keeps what the registrar printed). Client purge (`lib/investors/purge.ts`, the daily scanner) and the reset scripts are therefore not blocked. |
| Tenant isolation | RLS ENABLE + FORCE + `tenant_isolation` on all five tables; composite tenant FKs | RLS as 0233. **Added:** a tenant-consistency trigger refuses a row whose folio or client belongs to another firm, even in system context. Composite FKs would need a new unique key on `folios` / `investors` (a lock on two large tables), so a trigger is used instead. |
| Duplicates | Unique per (tenant, batch, row); identity keys are indexed | One current holder per (tenant, folio, role) |
| Nullable / compatibility | Additive; no existing column changes | Two nullable columns, no default (a catalogue-only change). **Fixed:** their CHECKs are `NOT VALID`, so no full scan runs under the ALTER lock. Existing rows are NULL. |
| Locks | **Added:** `SET LOCAL lock_timeout = '5s'`. The only lock on an existing table is the brief one for the `rta_file_imports (tenant_id, id)` unique index (a small table). | `lock_timeout` 5s; ALTER on `investors` takes a brief ACCESS EXCLUSIVE lock (no rewrite) |
| Rollback | `RTA_PIPELINE_MODE=off`; tables stay. Dropping them is a signed-off step after export. Re-running 0233 over existing tables is a no-op (verified). | Nothing reads them yet; the columns and empty table can stay |
| Financial rewrites | None | None; no backfill |
| Minor / HUF | Staging stores keyed PAN tokens only | Guardian and Karta are relationship rows; a Karta is never the owner. `majority_status` is set only from registrar evidence. |

- **Verified on the dev database:**
  - realigned 0233 / 0234;
  - `check:rls` passes (182 tables) and `check:schema` passes;
  - a fresh empty database migrates the full chain (272 files) and passes
    both checks.
- **Behaviour is proved** by `tests/rta-migrations-0233-0234-db.test.ts` (4):
  - purging an import keeps its batch;
  - a cross-tenant holder row is refused on insert and on update;
  - purging a client keeps the holder row, and purging the folio removes it;
  - the CHECK values are enforced.
- **Residual risk:** `folio_holders.holder_pan` / `holder_name` hold personal
  data in clear, like `investors`. The writer, when approved, must store only
  what the registrar printed.

## J. Smallest remaining implementation plan

1. **Full-history pulls.** No code change. Request one bootstrap each of:
   - CAMS: all-folio R9 as on a date, and WBR49 from 2012;
   - KFintech: full-book MFSD211, and MFSD243 from 2018.

   Then re-run `scripts/rta-shadow.ts` and the SIP Master coverage. Done when
   `missingFromMaster = 0` for both registrars. This also settles whether
   MFSD243 lists terminations.
2. **Legacy SIP-rejection routing.** In `src/lib/rta/process.ts`
   (transaction feed), route KFintech SIND / STPAD / STPOD rows in the verified
   shape to `sip_rejections`:
   - owner from `ownerOf`;
   - reason from Remarks;
   - dedup key from fund + transaction number;
   - never into `transactions`.

   Tests: extend `tests/rta-legacy-owner-db.test.ts` and
   `tests/rta-real-layouts.test.ts`.
3. **Source value in live legs.**
   - `src/lib/rta/parsers.ts`: read the AUM statement's report date
     (`REP_DATE`, `Report Date`).
   - `src/lib/rta/process.ts` (`processAumStatement`) and
     `src/lib/rta/import.ts`: write `sourceUnits`, `sourceValue`, `sourceNav`,
     `sourceAsOf` and `sourceReport` on each leg.
   - `revalueAllFolios` is unchanged (it already preserves them).

   Tests: an AUM import followed by revaluation keeps both.
4. **AUM screen.** Feed `registrarAumCards` and `firmAumHeadline` from the
   folio legs' `source*` keys and the per-statement evidence. This touches
   `lib/metrics` (one definition), the Owner Dashboard AUM tile and the
   client portfolio.
5. **SIP Master into the SIP book.** Shadow first: materialise the master per
   tenant from staged registration and transaction batches
   (`src/lib/rta/staging/`), and compare it against `sips` on the
   Exceptions page. Only then switch `lib/metrics/sip.ts`.
6. **Key migrations** (separate review):
   - `NOPAN:FOLIO:<folio>` → `FOLIO:<rta>:<amc>:<folio>`;
   - `MINOR:<guardian PAN>:<name>` → a folio-keyed provisional identity.
7. **`folio_holders` writer** from R9 / MFSD211 (joint, guardian), behind
   shadow, after review.
