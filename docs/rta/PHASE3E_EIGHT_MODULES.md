# RTA Phase 3E — Eight-module business correctness

Status: **development only.** Nothing is merged or deployed and no production
migration has run. Live posting stays off.

Every figure below comes from one of three sources:

- the real mailbacks, read in memory, aggregates only;
- an isolated database (`rta_verify3e`), loaded through the CRM's own import
  path in production order (masters → holdings → transactions →
  registrations), each file followed by its shadow staging run, exactly as the
  worker does;
- synthetic tests.

No real file, PAN, name or folio is committed.

## A. Code changes

| Area | Files | Behaviour now |
|---|---|---|
| Folio-correction proof | `src/lib/rta/consolidation.ts` (new) | An R-coded KFintech group (SINR, FULR, NEWR …) is a folio correction only when the figures prove it. Four conditions: (1) the original plus an exact negation in one folio; (2) an equal re-post in exactly one other folio; (3) one scheme; (4) lot sums for redemptions. The remark is never required and never enough. |
| Event categories | `src/lib/rta/staging/classify.ts`, `group.ts`, `layouts.ts`, `pipeline.ts` | Every non-posting row carries one category: `failed_sip_instalment`, `failed_stp_leg`, `sip_registration_rejection`, `purchase_rejection`, `redemption_rejection`, `reversal_cancellation`, `folio_correction` or `unknown`. Categories come from codes, status, units, amount and group figures. A CAMS "Rejection" phrase is `unknown` (no CAMS rejection has been seen). The category is persisted on the staged row; MFSD201 rows also keep `switchRef` and `sipRegistrationId`. |
| Legacy feed: refused instructions | `src/lib/integrations/cams-feed-parser.ts`, `src/lib/rta/process.ts` | KFintech SIND / STPAD / STPOD in the verified shape (processed, 0 units, an amount, no original named) are no longer dropped. Each becomes a rejected `transactions` row (0 units, never business), keeping the registrar's number, category, minimised reason and switch reference. A refused SIP also opens one `sip_rejections` record linked to it. These rows attach only to a folio on record. They never create a folio or a client, and never stop a SIP. |
| Legacy feed: folio corrections | the same files | A proved correction group is held with the reason "folio correction … not a rejection and not a new transaction". |
| Import status | `src/lib/rta/process.ts`, `src/workers/rta-import-worker.ts` | A row already recorded exactly as the file states it is `rowsUnchanged`, not "imported". Re-importing a file reports 0 imported and N unchanged, and the import status counts those as landed. |
| Dated AUM on legs | `src/lib/rta/import.ts`, `kfintech.ts`, `cams.ts`, `types.ts` | Every holdings leg carries `sourceUnits`, `sourceValue`, `sourceNav` (null when the registrar printed none: R9), `sourceAsOf`, `sourceReport` and `sourceArn`. An older statement never replaces a newer one's leg. A stated 0 balance stays 0; before this, the MFSD203 parser turned 0 into "unknown". Revaluation leaves these keys alone. |
| Portfolio | `src/lib/finance/valuation.ts`, `src/components/investors/HoldingsTable.tsx` | Each holding carries `registrar {units, value, asOf, report}`. The statement date is the snapshot date. The table shows "Registrar ₹x · date" under the live value; the two figures are never merged. |
| AUM metric and card | `src/lib/metrics/registrar-aum.ts` (new), `src/lib/rta/aum-view.ts`, `widgets/registrar.tsx` (new), catalog, owner layout, KPI-tile info | **Registrar AUM** card: one row per registrar × ARN, with date, age, full-book flag and nil, unvalued and older positions. It shows **mixed dates as a range**: staleness is judged on the oldest part and the firm total is withheld. Coverage is checked against processed transactions. The firm total prints only when complete. The live-NAV AUM tile says it is a different figure. |
| SIP Master | `src/lib/rta/sip-master.ts` | New fields: owner (resolver), status effective date, last successful instalment, operating flag, registrar lifecycle events, and confidence (verified / partial / unverified). Registrations known only from instalments are held as **evidenced** entries: never merged, never in the book. The book reports them beside it (operating vs not). |
| Owner rules, rich importer | `src/lib/rta/import.ts`, `identity.ts`, `kfintech.ts` | The rich importer (R9, WBR4, MFSD211, MFSD203) now follows the owner rules: an HUF row with an individual (Karta's) PAN is held, and a minor's folio on record reported with the recorded guardian's PAN stays the minor's. A new folio under a recorded guardian's PAN, with no stated holder type, is held — **except** in KFintech MFSD201 / MFSD203, which leave a minor's PAN blank (verified 12/12 each). MFSD203's holder category comes from the PAN's 4th letter, not a hard-coded "individual". |
| `folio_holders` (0234, undeployed) | migration + schema | No PAN in clear: a keyed `pt1:` token plus a `******1234` mask, both CHECKed. One current role per person per folio (by client and by token). An append-only trigger means a holder is closed and replaced, never edited. New columns: `closed_reason`, `created_by`, `closed_by`. |
| Impact report | `scripts/rta-identity-key-impact.ts` (new) | READ ONLY: counts what hangs off `MINOR:` and `NOPAN:FOLIO:` keys. |

## B. Eight-module accuracy (real files, isolated database)

| # | Module | Verdict | Source → canonical → CRM → screen, and reconciliation |
|---|---|---|---|
| 1 | Client Master | **PARTIAL** | 1,190 live clients: 20 minors, 9 HUF, 25 folio placeholders. Identity errors: minor rows on adults **0**, minor transactions on adult guardians **0**, folios with two owners **0**; every HUF row goes to its folio's owner (65). **Missing:** the masters are activity-scoped (bootstrap full-book R9 / MFSD211 needed); 20 name-based `MINOR:` keys (3 span both registrars); `folio_holders` has no writer. |
| 2 | Accurate AUM | **KFintech PASS · CAMS UNVERIFIED** | MFSD203: 1,943 positions (329 nil), ₹14,67,10,680.68. The legs carry the same total and the card shows the same figure, dated 8 Oct, full book, **0 coverage gaps**. CAMS: R9 of 18 May (1,235 legs) plus WBR4 of 8 Oct (8). Shown as a range, stale and partial. The firm total is **withheld**, with 3 reasons. |
| 3 | Active SIP Book | **Legacy FAIL · Master PARTIAL** | Legacy book: 9 active, **5 of them not started**; it refuses MFSD230. Master: **4** verified active; 5 pending; 14 unknown (MFSD230-only); 49 STP and 4 SWP beside it; 312 KFintech SIPs operating but known only from instalments, kept out. The book is not complete until `coverage.missingFromMaster = 0`. |
| 4 | Client Portfolio | **KFintech PASS · CAMS PARTIAL** | 1,190 clients valued: 2,872 holdings, 2,838 carrying registrar figures. **Every client total equals its holdings (0 mismatches).** Each folio is counted once (0 two-owner folios), and a joint holder adds nothing (DB test). Rendered table: 39 registrar captions for 39 open holdings, across 25 clients. CAMS figures are dated May. |
| 5 | SIP Rejection / Stop | **Rejection PASS (KFintech) · Stop UNVERIFIED** | 1 refused SIP (KYC invalid) → 1 SIP Rejection, linked to its rejected transaction. **0 SIPs stopped by it.** No stop, pause or registration rejection appears in any sample. CAMS rejection: no sample. |
| 6 | Transactions | **Shadow PASS · legacy PARTIAL** | R2: 1,334 / 1,334. Staged complete **2,407** = legacy processed **2,392** + **15** multi-lot redemptions the legacy importer holds, with **0** other differences either way. Unknown codes are held: 8 October (Consolidation In/Out, Initial Allotment) and WBR10's 8 purchases without a type flag, plus 2 non-financial rows. |
| 7 | Transaction Rejection | **KFintech PASS · CAMS UNVERIFIED** | 3 rejected rows, 0 units, **0 counted as business**. The STP pair counts as **1 instruction**. The 33 October "Rejection" rows (99 rows in 18 groups) are folio corrections in both engines, never rejections. |
| 8 | SIP Master | **PARTIAL** | 1,936 entries: 10 verified, 1,908 partial (registrar id, not described), 18 unverified (MFSD230). Each entry has an owner. Coverage: KFintech 7 / 728 described; CAMS 0 / 1,187. |

"PASS" is limited to what the samples contain. It is never claimed from a
parser passing.

## C. SIP Master and Active SIP Book — unmatched references

The October MFSD201 sample covers **30 Sep – 7 Oct** (one week). The May
files cover two weeks. A monthly SIP can miss either window without having
stopped.

| Registrar | Category | Count | What establishes it, at minimum |
|---|---|---:|---|
| KFintech (729) | Described by MFSD243 | 8 | — |
| | Active or potentially active (instalment in the last 35 days) | 327 | Nothing new for *operation*: the daily MFSD201 proves it. Amount, frequency and end date need one **MFSD243 pull over the registration dates these refs carry** (2023–2026, 37 distinct months), not full history. |
| | Closed (the position is nil in MFSD203) | 19 | None |
| | Historical only (folio-correction re-report) | 1 | None |
| | Unmatched by identity (attributes match MFSD243 under another id) | 0 | — |
| | Status unknown (no instalment in the sampled week, position open) | 374 | **One full cycle (35 days) of the daily MFSD201.** Only those still silent after a cycle need a lifecycle report (MFSD231 / MFSD229), and only for them. |
| CAMS (1,189) | Instalment in R2's May fortnight | 1,179 | Status in October unknown. One **WBR49 pull by registration date 2023–2026** describes 1,176 (98.9%); older: 8, undated: 5. |
| | Closed (nil in R9) | 2 | None |
| | Status unknown | 8 | As above |
| | R2 `siptrxnno` ↔ WBR49 `auto_trno` | 0 of 1 matches, even on attributes | Not linked. Needs one overlapping WBR49 + R2 sample, or CAMS's confirmation |

- **No registration is merged without a shared registrar id.**
- **PENDING:** 4 of the 5 PENDING SIPs already had an instalment at
  registration ("New Purchase with SIP"). They remain PENDING until their
  start date, as the rule says.

## D. AUM reconciliation

| Registrar | ARN | As of | Source AUM | Projected (card) | Discrepancy |
|---|---|---|---:|---:|---|
| KFintech | ARN-270604 | 2026-10-08 | ₹14,67,10,680.68 (MFSD203 Σ AUM) | ₹14,67,10,680.68 | none; 0 coverage gaps |
| CAMS | ARN-270604 | 2026-05-18 → 2026-10-08 | ₹11,94,00,802.05 (R9) + ₹3,63,836.63 (WBR4) | ₹11,95,98,517.29 | mixed dates, partial, stale (143 days): firm total withheld |
| CRM live-NAV AUM | — | today | — | ₹26,63,09,198.05 | Shown separately and labelled. In the isolated DB there is no NAV table, so it equals the statement values summed across two dates — exactly the mixing the card refuses. |

- **The R9 difference:** R9's ₹11,94,00,802.05 (1,237 positions) vs
  ₹11,92,34,680.66 on May-dated legs (1,235) is not a loss. WBR4 (the R9
  layout, dated 8 Oct) restated 2 of those positions, and the newer statement
  correctly replaced them.
- **The 2 undated legs** are KFintech master-only legs with no holdings
  statement.
- **The two KFintech folios absent from MFSD203** held **no units** on
  8 Oct, so neither is a coverage gap:
  - one folio's only transaction is the refused SIND instalment (nothing
    allotted);
  - the other's SIP was registered on 7 Oct with no instalment yet.

## E. Transaction and SIP rejections — evidence

| Rows | Proof from source fields | Result |
|---|---|---|
| May SIND ×1 | Status Y; head P; units 0; amount > 0; `RejTrnoOrgNo` empty; `sipregslno` empty; remark "Primary KYC Invalid…". No other row with the same number. | Failed SIP instalment. One rejected transaction plus one SIP Rejection; never business; SIP not stopped. |
| May STPAD + STPOD | The same, plus the same folio, date, amount, `Switch_Ref. No.` and Ihno; the out-leg's `ToProductCode` = the in-leg's scheme | One failed STP instruction: 2 rejected legs, counted once |
| Oct SINR ×16, FULR ×16 (lot by lot), NEWR ×1 | All **18** groups: (1) old-folio rows net to exactly zero units and amount; (2) re-posted exactly into **one** other folio, which appears in MFSD211; (3) the old folio's MFSD203 balance is 0; (4) one old folio maps to one new folio | Folio correction (non-financial). Held, never a rejection |
| Processed STP legs | `Switch_Ref. No.` repeats across instalments and the legs' dates and amounts differ, so it is not an instruction key. Processed legs stay two internal movements. | No double count: internal cash flow |

## F. Investor identity — tests

| Scenario | Test |
|---|---|
| A guardian's PAN never takes a minor's rejection, SIP, holding or transaction | `rta-legacy-owner-db`, `rta-rich-owner-db`, `rta-real-layouts` (CAMS R2 minor) |
| An HUF row with the Karta's PAN is held; an HUF with an H-PAN is the owner | `rta-rich-owner-db`, `rta-legacy-owner-db` |
| A folio is never matched by number alone when an AMC is given; a weak number-only match does not override another client's PAN | `rta-legacy-owner-db`, `rta-import-db` |
| A placeholder is never displaced by a PAN (reassignment off) | `rta-legacy-owner-db`, `rta-import-db` |
| A joint holder adds nothing to AUM | `rta-dated-aum-db` |
| `folio_holders`: no PAN in clear, no duplicate, append-only, tenant-bound, safe on purge | `rta-migrations-0233-0234-db` |
| On the real files: minor rows on adults 0; minor transactions on guardians 0; two-owner folios 0 | harness |

**Merges:** `mergeInvestors` re-points `folio_holders.investor_id` like every
other `investor_id` table. If two current rows for the same person on one
folio collide, that table is skipped and listed, and the loser keeps the link
(its `merged_into_id` leads to the survivor). Deleting a client sets the link
to NULL and keeps the row.

**Legacy keys (read-only report, real-file DB):**

- **`MINOR:`:** 20 clients, 31 folios, 31 transactions, 0 without a guardian
  link. **3 span both registrars**: one name-based key joins CAMS and KFintech
  holdings by name, which needs review.
- **`NOPAN:FOLIO:`:** 25 placeholders and 25 folios. None has a folio number
  at several AMCs, and none is also under another client.

No historical repair was run.

## G. Import safety

- **Shadow mode changed nothing outside staging:** every one of the 12 real
  files was fingerprinted around its shadow run across **all 192 non-staging
  tables** (row count + content hash). **12 / 12 unchanged.**
- **What the legacy path guarantees today:**
  - A file that cannot be read safely writes nothing (`RtaLayoutError`).
  - A multi-lot redemption is held whole: 15 groups, 337 rows, none posted.
  - A retry duplicates nothing: unique registrar number; `ON CONFLICT` on
    refused instructions; `sip_rejections` dedup.
  - An unverified number collision is held.
  - Import status now counts only created or changed records.
- **Future flow (designed, posting still off): validate and resolve owners
  BEFORE any financial write.**
  1. The worker stages the file first. Mode `gate` would sit beside `off` and
     `shadow`; `on` stays refused.
  2. Only economic transactions in state `complete` with an owner decision
     `existing_folio_owner` / `owner_by_pan` may post. They post in **one
     database transaction per batch**, keyed on the identity key
     (`kfin.v1:<Fund>:<No>`, `cams.v1:<amc>:<No>`), so a retry is a no-op.
  3. A multi-lot transaction posts all its lots or none.
  4. A `conflict` / `duplicate` / `restated` transaction never posts.
  5. The import's status is written from what that one transaction committed.
  6. The legacy feed path for that tenant is switched off in the same release.

  Until approved, the gate is design only.

## H. Minimal file strategy

| Use | CAMS | KFintech |
|---|---|---|
| **Daily operations** | R2 (transactions) | MFSD201 (transactions) |
| **Periodic** | R9 **all folios as on a date** (holdings + master; the only CAMS full-book statement in the set); WBR49 for the period's new registrations | MFSD203 (full-book holdings, verified); MFSD211 for changed clients; MFSD243 for new registrations |
| **Bootstrap, once** | R9 all folios; WBR49 by registration date **2023–2026** (98.9% of live references) | MFSD211 full book; MFSD243 by registration date **2023–2026** |
| **Reconciliation, conditional** | — | MFSD230 (paid / pending counts; retired once `missingFromMaster = 0` and statuses agree for a cycle) |
| **Exception-only** | A rejection / unprocessed report — **code to confirm with CAMS**; requested once a rejection is expected but not seen | MFSD231 / MFSD229 only for SIPs silent beyond one cycle; MFSD228 only if bank bounces must be shown before the RTA feed carries them; MFSD244 only for registration rejections |
| **Not needed** | WBR4: the R9 layout for one AMC (8 positions, 2 of which restated R9 with a newer date), so an all-folio R9 covers it. WBR10: a transaction report like R2 but without `trxn_type_flag`. On this sample nothing in it could be posted (8 purchases held, 2 non-financial events). It is redundant only if R2 covers the same period, which is **unverified**: no overlapping sample. | — |

## I. Automated tests

```
npx tsc --noEmit -p .                       # clean
npm run lint                                # clean
npm run check:rls / check:schema / check:sql / check:labels / check:colors /
  check:rbac / check:migrations / check:asany / check:mathimports /
  check:calc / check:finance / check:spine  # all pass
TEST_DATABASE_URL=postgres://mfd_app:…@localhost:5432/mfd npx vitest run
# 67 files, 817 tests, 0 failing
```

- **Fresh empty database:** 272 migrations, then `check:rls` and
  `check:schema` pass.
- **New suites:**
  - `rta-consolidation`
  - `rta-legacy-rejections-db`
  - `rta-dated-aum-db`
  - `rta-rich-owner-db`
  - `rta-aum-view` (mixed dates)
  - `rta-sip-master` (Phase 3E fields)
  - `rta-migrations-0233-0234-db` (`folio_holders` protections)
- **They fail on the old code:** the rich-owner tests fail against the
  previous importer (4 / 4).
- **Limitations:**
  - **Screens:** the dashboard card and the holdings table were rendered
    server-side from the real-file database, but not in a browser session.
  - **No sample exists** for CAMS rejections, any stop / pause /
    registration rejection, a CAMS full-book statement or an R2 ↔ WBR49
    overlap. Those modules say UNVERIFIED rather than use synthetic
    stand-ins.

## J. Production readiness

**Blockers:**

1. **Full-book CAMS statement.** None exists, so firm AUM cannot be complete.
2. **Bootstrap registration pulls** (C). The SIP Master stays partial without
   them.
3. **CAMS rejection evidence.**
4. **A legacy lot-redemption path.** 15 groups are held; they need the gate
   (G) or staging-backed posting.
5. **Two key migrations need review** (`MINOR:`, `NOPAN:FOLIO:`).
6. **No `folio_holders` writer** yet.

**Migration risks:**

- **0233:** a brief lock on `rta_file_imports` for one index.
- **0234:** a catalogue-only ALTER on `investors` (NOT VALID CHECKs); a new
  table with triggers.
- Both run under `lock_timeout` 5s.

**Rollback:** `RTA_PIPELINE_MODE=off`. New tables and columns are left in
place; nothing reads them in production.

**The new behaviours are all additive:**

- legs gain `source*` keys;
- refused instructions add rejected rows;
- re-imports report `unchanged`.

Reverting the code leaves those values inert.

**Minimum next actions:**

1. Request the bootstrap pulls.
2. Run one 35-day cycle of daily feeds in shadow and re-run this harness.
3. Approve the gate design.
4. Review the key migrations.
