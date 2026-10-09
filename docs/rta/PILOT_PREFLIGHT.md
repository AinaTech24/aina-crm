# KFintech pilot — final preflight and CAMS mapping quality

**Status:** development evidence only. Nothing was merged or deployed, no production migration ran, nothing posted live and nothing was repaired.

**Evidence base:**
- The authentic AMFI NAVAll (business date 07-Oct-2026, SHA-256 `f85adeeb…9b3f`), applied only to an isolated database (`rta_verify3k`, built from empty, 279 migrations).
- The twelve real RTA sample files; aggregates only.

**Operator runbook:** `PILOT_PREFLIGHT_RUNBOOK.md`.

**Recommendation:** **NO-GO for production activation now.** Software is ready for a narrowly scoped KFintech-only transaction pilot once runbook conditions A–F are PASS and the pilot is explicitly authorized.

---

## 1. CAMS candidate-screen safety fixes and test results

The three bad suggestions in the 3J queue had three causes:
- **K108** (Kotak → SBI Large & Midcap) and **OFIVFG** (HSBC Value → Sundaram Consumption): name suggestions were drawn across every AMC when the registrar AMC had no established identity.
- **P121** (ICICI Multicap → ICICI FMCG): "Multicap" and "Multi-Cap" tokenized differently, so an unrelated scheme won on shared words.

Fixes:

| Required | Change |
|---|---|
| Verified AMC-identity crosswalk | Migration **0241** `registrar_amc_identity` (+ append-only events), platform-wide. A row is recorded **automatically from ISIN evidence** only when every ISIN-verified code under a registrar AMC points to one AMFI AMC (all 22 KFintech AMCs on the real files). Otherwise **two platform operators** record it with an evidence note — the only route for CAMS, which prints no ISIN. The AMC must be one the AMFI feed names. One live primary per registrar AMC |
| Candidates only from the verified AMC (+ documented successors) | Name suggestions are drawn only from the verified AMC set. **No verified AMC → no name suggestions at all.** Successor AMCs (mergers, renames) are separate `role = successor` rows, each with two operators and evidence; a successor without a live primary counts for nothing |
| Similarity is not proof | Every name suggestion is labelled "check it against the AMC's scheme list; similarity is not proof". The ranker treats joined and split words alike (Multicap / Multi-Cap, Midcap / Mid Cap), for ranking only |
| Plan and option compatibility | Contradicting candidates are removed and refused (Direct vs Regular, Growth vs IDCW, payout vs reinvestment). Where either side does not state the plan or option, the candidate and the approval carry an explicit "confirm the plan / option on the document" warning |
| Several codes suggesting the same AMFI scheme | Each candidate warns "also the top suggestion for registrar code X — at most one of them can be this scheme", and "already mapped from registrar code X" |
| No wrong-AMC approval | A firm confirmation and a platform scheme approval are **refused** unless the registrar AMC has a verified identity and the AMFI scheme belongs to it (or to a documented successor). A crosswalk mismatch on an ISIN-resolved code is a conflict |
| Decision history | The candidates API returns every decision on the code — firm audit, platform scheme events, AMC-identity events — oldest first. All three stores are append-only or audit-only |
| Order by exposure | The Scheme codes list orders unresolved codes by registrar-reported holding value plus held transaction amount, then held transactions, then SIP registrations, and shows the exposure column |
| One approval never approves others | Recording an AMC identity approves no scheme; confirming one code leaves its siblings unresolved and their transactions held (tested; on the real files all 164 CAMS codes stayed unresolved after the simulated AMC approvals) |

Operator API: `POST /api/super-admin/scheme-mappings` with `approve_amc` (two operators) and `revoke_amc` (one operator); `GET ?view=amc` lists the crosswalk with its history.

**Real-file check:**
- I produced proposals for the 15 CAMS AMCs from the descriptions; every proposal was unanimous.
- I recorded them as a **simulation in the isolated development database**. They are not evidence, and production needs the operators' own documents.
- Then I regenerated the queue (`cams-review-queue-simulated.csv`, scratch):

| Result | Value |
|---|---|
| Codes | 164 (all still `unresolved` — no scheme approved by the AMC step) |
| Suggestions outside the verified AMC | **0** |
| K108 | Kotak Large & Mid Cap Fund — Regular Plan — Growth (Kotak Mahindra Mutual Fund) |
| P121 | ICICI Prudential Multi Cap Fund — Regular Plan — Growth |
| OFIVFG | HSBC Value Fund — Regular Plan — Growth (HSBC Mutual Fund) |
| Codes whose top suggestion is shared with another code | 2 (warned) |
| Codes whose registrar description states no Direct / Regular | 39 (warned) |
| Exposure order (top 5) | PP001RG · P15 · H02 · K108 · PDFG |

**Tests (new or changed):**
- `rta-amc-identity-db.test.ts`, 9 tests: no suggestions or approvals without a verified AMC; two operators; AMFI-named AMC only; append-only history; cross-AMC lookalike and Direct variant excluded; shared-suggestion warning; wrong-AMC refusal; siblings stay unresolved; plan / option warnings and refusal; successor needs two operators; exposure order; revoke stops approvals.
- `aum-composition-db.test.ts`, 2 tests.
- The P121 ranking case.
- ISIN-derived AMC identity unanimous only (3I DB test).
- The CAMS platform approval now requires the AMC identity first.

## 2. KFintech NAV-date verification (the 07-Oct AMFI file)

| Source | Effective date of its NAV | Comparison | Result |
|---|---|---|---|
| MFSD201 transactions | its own `Nav Date` column (= trade date on all 1,073 processed rows) | exact, only where the registrar's Nav Date equals AMFI's NAV date (07-Oct) | **51 / 51 equal**, 0 different; the other 1,022 have no same-date AMFI NAV in a one-day file and are **not compared** (no claim made) |
| MFSD203 holdings | no NAV-date column; report date 08-Oct; the NAV printed is the latest declared NAV | registrar NAV vs AMFI NAV of 07-Oct (the business day before the report) | **1,938 / 1,938 equal**; plus 1 historical scheme whose AMFI NAV is dated 21-Mar-2025, also equal |

Also verified:
- All **1,076** posted transactions are on approved AMFI identities (`isin_verified`); 0 on a registrar code; 0 not in AMFI.
- **15 multi-lot redemptions** (340 lots, 13,286.593 units, ₹20,89,213.97) are posted whole, each equal to the sum of its lots. 1 multi-lot correction (32 lots) and 1 unknown-code group (3 lots) stay held.
- **No unrelated NAV:** 0 of 1,073 valued transactions and 0 of 1,940 valued holdings carry a NAV that is not their own scheme's; 0 unresolved holdings are priced.
- **Re-import:** identical fingerprint; the ledger is unchanged; the reconciliation monitor is 0 / 0 / 0 / 0 / 0 before and after.
- **The live-NAV tile** (fixed): `getAumComposition` splits the AUM figure into three parts. The AUM KPI tile says "Mixed dates" with that split, and the Registrar AUM card lists it. "Today" appears only when everything is at today's NAV. On the real files:

| Part | Value | Holdings | Dated |
|---|---|---|---|
| At today's NAV (mapped KFintech) | ₹14,66,10,685.69 | 1,613 | 07-Oct |
| At registrar statement value (CAMS + 4 unmapped KFintech) | ₹11,96,98,512.29 | 1,225 | 18-May → 08-Oct |
| At an older NAV | ₹0 | 0 | — |

**Provenance fix:** WBR4 holdings were labelled `R9`, because WBR4 is read by the R9 parser. They now carry `WBR4` (verified on the real files: 1,235 R9 legs dated 18-May, 8 WBR4 legs dated 08-Oct), so CAMS shows as two dated statements instead of one mixed one.

## 3. CAMS queue count reconciliation

**Transactions — 1,344 vs 1,334.** The queue counts every CAMS registrar transaction staged under a CAMS code: **1,344**.
- **1,334** are R2 transactions held only for the scheme (`scheme_unresolved`, ₹1,28,59,629.24).
- The other **10** are WBR10 rows that would be held even with a mapped scheme:
  - 8 unknown transaction codes (₹56,997.16);
  - 2 non-financial events.
- 1,334 + 8 + 2 = 1,344.

**Holdings legs vs source reports:**

| Registrar | Source rows | Distinct positions | Legs | Why |
|---|---|---|---|---|
| CAMS | R9 1,237 + WBR4 8 = 1,245 | 1,243 | **1,243** | 2 positions appear in both files; the newer WBR4 (08-Oct) statement replaces R9 (18-May) for them. 19 R9 rows are nil balances |
| KFintech | MFSD203 1,943 | 1,943 | **1,945** | 1,943 from MFSD203 (1,939 mapped + 4 unmapped; 329 nil) plus 2 positions known only from MFSD211 / MFSD201 / MFSD243 with no holdings statement (no units, no value) |

## 4. Six release-condition operator checklist

Detailed steps, roles, expected results, evidence and stop conditions: `PILOT_PREFLIGHT_RUNBOOK.md`.

| # | Condition | Development evidence | Production status |
|---|---|---|---|
| A | Official AMFI source on the pilot host, two downloads, hash and business date | the reader verified on the official file; `--check` clean | **NOT VERIFIED** |
| B | `migrate:all --check` on a production copy | chain verified on empty and old databases (immutability drill) | **NOT VERIFIED** |
| C | S3, SES, Redis, Postgres role / RLS, PAN-token key, backups, alerts | emulator and infra tests (3G); RLS check passes | **NOT VERIFIED** |
| D | Read-only diagnostics reviewed with the firm | scripts exist, read-only | **NOT VERIFIED** |
| E | Reconciliation dry run on the production copy | PASS on the real sample files (G, minimal M, re-import) | **NOT VERIFIED** |
| F | Two-person activation and signed 14-day scope | controls tested (two people to start, one to stop) | **NOT DONE** — needs explicit authorization |

## 5. Exact 14-day pilot scope

One firm, KFintech only, gate on (`RTA_POSTING_MODE=controlled`). Activation by two operators with a 14-day expiry.

**Files:** the smallest set, verified.
- **MFSD211** (masters: folio owners on record) + **MFSD201** (transactions) are sufficient. The minimal run on the real files produced exactly the same 1,076 transactions (identical fingerprint) as the full twelve-file run, with 0 held for owner identity.
- Optional:
  - **MFSD203** — registrar holdings and the KFintech Registrar AUM card; its ISINs also resolve holding-only codes.
  - **MFSD243** — the only source that puts a SIP in the Active SIP Book as verified.
- Not needed: MFSD230, every CAMS file. If CAMS files are imported, their masters post and every scheme-dependent record stays held.

**Categories, as the screens report them** (real sample figures):

| Category | Count | Amount | Treatment |
|---|---|---|---|
| Verified KFintech transactions | 1,076 (1,073 processed + 3 refused instructions) | ₹1,02,39,740.48 | posted on AMFI codes |
| Quarantined: folio-consolidation corrections | 18 | ₹1,47,868.30 | held (Held screen) |
| Quarantined: unknown transaction codes | 6 | ₹5,43,384.29 | held until registrar documentation |
| Unmapped KFintech schemes | 4 codes (`120DEGP`, `176BAGP`, `176TPDP`, `RMFRIRG`) | ₹99,995 holding | excluded; held at registrar value; listed on Scheme codes |
| Registrar holdings (partial AUM) | 1,943 KFintech positions, full book, 08-Oct | ₹14,67,10,680.68 | shown per registrar × ARN; the firm total is withheld while CAMS is not full-book / current |
| SIPs with verified status | 3 active (₹7,500 / month) + 5 pending (₹9,500) in the book; 1 verified STP (₹5,000, not a SIP) | — | Active SIP Book |
| SIPs with unknown / observed status | 402 unknown (₹19,54,087.47); 312 observed activity (₹19,96,050.47) | — | reported beside the book, never in it |
| CAMS imports | 1,334 transactions held + 10 unsupported; 1,243 holdings at registrar value; 1,188 registrations unresolved | ₹1,28,59,629.24 held | held, visible; not part of the pilot |

**Never posted:** a scheme that is not `resolved_isin` / `confirmed`, or a transaction whose owner is not on record (`owner_not_on_record`). The gate holds both before any write.

**Report it as** "verified KFintech transactions posted and reconciled". It is **not** a validation of the eight-module CRM: AUM, Client Portfolio, SIP Master and the Active SIP Book stay partial while CAMS is unmapped and SIP registration coverage is incomplete.

## 6. Remaining blockers

**Software:**
- Nothing open blocks the KFintech-only pilot. Fixed in this round: the cross-AMC suggestions, wrong-AMC approval, shared suggestions, compound-word ranking, the live-NAV tile and the WBR4 provenance label.
- Not blocking the pilot, still open:
  1. `transactions` UNIQUE(tenant, order_id) cannot hold a registrar number reused across AMCs (0 in the samples; a reuse is held, not lost). The schema change needs approval.
  2. KFintech folio-consolidation corrections (18) have no posting path; they stay held.
  3. No CAMS rejection sample exists yet; CAMS "Rejection" wording stays `unknown`.
  4. `scheme_master` duplicates after AMC renames: the audit is read-only, and the cleanup is not built.
  5. Legacy (non-validate-first) firms keep name-based scheme behaviour.

**Operator / environment:**
1. Runbook A–F on the pilot account and a production copy.
2. CAMS (outside the pilot): record 15 AMC identities with documents, then approve schemes in exposure order (36 codes cover 80 % of CAMS money).
3. Registrar documentation for the 14 unknown transaction codes.
4. A current CAMS full-book statement, for a firm AUM total.
5. Approve or exclude the 4 unmapped KFintech codes from the AMC's own scheme list.

## 7. Final GO / NO-GO

**NO-GO for production activation today.** The software evidence supports the KFintech-only transaction pilot:
- KFintech transactions post on verified identities, with exact NAV agreement wherever dates align.
- Reconciliation is zero, re-import is idempotent, and every exception is held and visible.
- The minimal two-file set is sufficient.

But A–E are unverified in production and F is not authorized. **GO for the 14-day KFintech pilot only when** A–E are recorded PASS by the named roles **and** two platform operators plus compliance authorize F in writing.
