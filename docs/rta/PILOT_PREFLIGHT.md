# KFintech pilot — final preflight, corrections and operator sign-off

**Status:** development evidence only. Nothing was merged or deployed, no production migration ran, nothing posted live and nothing was repaired.

**Evidence base:**
- The authentic AMFI NAVAll (business date 07-Oct-2026, SHA-256 `f85adeebb6bbca9862a0c0b928527d8c46f095da99131429f95ceed2d1449b3f`), applied only to an isolated database (`rta_verify3l`, built from empty, 280 migrations).
- The real RTA sample files; aggregates only — no PAN, name or folio is printed here, ARNs are masked.

**Operator handover (the single operational document):** `PILOT_HANDOVER.md`.

**Corrections to the previous report:**
- The previous chat summary swapped two KFintech report codes. Per KFintech's Distributor Services manual, and as the code, tests and earlier documents already had it: **MFSD201 = Transaction Report; MFSD211 = Investor Master Information**; MFSD203 = Holdings / AUM; MFSD243 = SIP / STP / SWP registrations. Every guide and checklist in this folder now carries the matrix below.
- "Only these four files" meant four physical files of two report types: an MFSD211 and an MFSD201 from May, and an MFSD211 and an MFSD201 from October. Their manifest is in §1. The pilot was re-run on exactly that manifest.
- The earlier figure of 402 unknown SIPs (₹19,54,087.47) does not reproduce from the declared manifest. It is superseded by §4.

---

## 1. KFintech input-file matrix

| Report | What it is | Pilot | Order |
|---|---|---|---|
| **MFSD211** | Investor Master Information — folio owners, holders, tax status | **required** | 1st |
| **MFSD201** | Transaction Report | **required** | 2nd |
| MFSD203 | Holdings / AUM statement | optional — only to validate registrar holdings and the KFintech AUM card | 3rd |
| MFSD243 | SIP / STP / SWP registrations | optional — only to validate SIP registration status | 4th |

**The declared pilot manifest (the four files the simulation used, in this order):**

| # | Report | Masked file identifier | SHA-256 | Data rows | Dates in the file | ARN scope |
|---|---|---|---|---|---|---|
| 1 | MFSD211 | `MFSD211_WBMST87*****_10*****_2.csv` | `8a5f06685133747a9ffba0f78e6d6a03d07e15813be43e5d442b5ea5e1559452` | 648 | Report Date 18-May-2026 | one ARN, `ARN-****04` (648 / 648) |
| 2 | MFSD211 | `MFSD211.csv` (renamed by the uploader) | `ed905fdc110543e87c8d8a1e3ba61a185ef88dbf3d9af698c5f48082acfb881f` | 384 | Report Date 08-Oct-2026 | `ARN-****04` (384 / 384) |
| 3 | MFSD201 | `MFSD201_WBTRN28******_69****_2.csv` | `14948afbfe0cda101ee9e15a1712f1b4e9751187bd5b6ed7b95c679b62c3a9de` | 819 | Transaction Date 30-Apr → 15-May-2026; Report Date 18-May-2026 | `ARN-****04` (819 / 819) |
| 4 | MFSD201 | `MFSD201.csv` (renamed by the uploader) | `d5fdf75029390fd372a8ce8c1af99190ba93e339d6de7974017ce5772628fe85` | 689 | Transaction Date 29-Jan-2024 → 07-Oct-2026 (pre-October rows are folio-consolidation re-reports); Report Date 08-Oct-2026 | `ARN-****04` (689 / 689) |

**Optional files, used only for §2 and §4:**

| Report | Masked file identifier | SHA-256 | Data rows | Dates | ARN scope |
|---|---|---|---|---|---|
| MFSD203 | `MFSD203.csv` | `fd668e118af4dd33f6377b4cb4fc2eec1070b9bcbe6287c7c9164f0088117ffa` | 1,943 | Report Date = To Date = 08-Oct-2026, report time 11:22:19 | `ARN-****04` (1,943) |
| MFSD243 | `MFSD243.csv` | `4a207b16f22863e536b00822bbf5179b063896c45ff9c1fa0563156a2afabd09` | 9 | Registration Date 01 → 07-Oct-2026 | `ARN-****04` (9) |

**Sufficient source scope for a real pilot:**
- MFSD211 must cover every folio the pilot's MFSD201 rows touch. A full-book MFSD211 once at the start, then each day's changes. In the sample, MFSD211 covered all of them: 0 transactions were held for owner identity.
- MFSD201 is needed for every business day of the 14-day window, for the pilot ARN.
- A transaction whose folio is not in MFSD211 is held (`owner_not_on_record`), never posted.

## 2. NAV effective-date analysis

**AMFI file:**
- 07-Oct-2026 business date.
- NAV dates: 8,612 schemes dated 07-Oct; 41 dated 30-Sep to 06-Oct; 1 dated after 07-Oct; 5,462 older (closed or matured schemes).

**MFSD203 (08-Oct statement):**
- MFSD203 prints **no NAV-date column**. Its Report Date and To Date are 08-Oct on all 1,943 rows, generated at 11:22:19.
- It prints the NAV with trailing zeros dropped: 4 decimals on 1,256 rows, 3 on 493, 2 on 194.

| MFSD203 positions | AMFI NAV of the mapped scheme | Registrar NAV vs AMFI NAV | Non-zero | Registrar value | CRM value |
|---|---|---|---|---|---|
| 1,938 mapped | dated 07-Oct | **exactly equal** (numeric equality, max difference 0.0000 — no tolerance used) | 1,613 | ₹14,66,10,685.68 | ₹14,66,10,685.69 |
| 1 mapped | historical (AMFI NAV dated 21-Mar-2025) | exactly equal | 0 (nil) | ₹0 | ₹0 |
| 4 unmapped | none (ISIN not in the AMFI feed) | not compared | 1 (`120DEGP`) | ₹99,995 | ₹99,995 — the registrar's value, never priced |

**Findings:**
- **The registrar valued its 08-Oct statement at the 07-Oct NAV.** Two pieces of evidence:
  - all 1,938 comparable positions equal AMFI's 07-Oct NAV exactly;
  - the report was generated at 11:22 IST on 08-Oct, before AMFI publishes 08-Oct NAVs that evening.
- The positions' effective NAV dates are 07-Oct for 1,938 and 21-Mar-2025 for the one historical (nil) position. The statement date is 08-Oct.
- The registrar's value equals units × its NAV to the paisa: the absolute difference summed over 1,943 rows is ₹0.01.
- **Comparing with the 08-Oct AMFI NAV: NOT VERIFIED.** No 08-Oct AMFI file is available here, and this sandbox cannot reach AMFI.
  - Expected effect: the CRM valuation moves to the 08-Oct NAV, while the registrar statement keeps its 07-Oct-based value. They then differ by 08-Oct's market move. Neither is relabelled, and the two are never added together.
  - Operator check, on the pilot host after A: load the 08-Oct file and count the comparable positions whose `sourceNav` still equals the scheme's NAV. Expected: only schemes whose NAV did not change on 08-Oct.
    ```sql
    SELECT count(*) FILTER (WHERE (leg->>'sourceNav')::numeric = n.nav) AS still_equal, count(*) AS comparable
      FROM folios f CROSS JOIN LATERAL jsonb_array_elements(f.schemes) leg JOIN scheme_nav n ON n.scheme_code = leg->>'schemeCode'
     WHERE f.tenant_id = '<firm>' AND leg->>'sourceReport' = 'MFSD203' AND (leg->>'sourceNav')::numeric > 0 AND n.nav_date = '2026-10-08';
    ```
- **Historical schemes:** "historical" comes from AMFI's own NAV date. A NAV more than 7 days old is never "current"; a holding valued at one counts as "at an older NAV" with its date. The one historical position here is nil.
- **The dashboard did mislabel it, and that is fixed:**
  - Before: the AUM tile said "Today" whenever every holding was at an AMFI NAV up to 7 days old, so a 07-Oct NAV on 09-Oct read "Today".
  - Now it says "NAV of 07 Oct" (or the date range), and "Mixed dates" with the split whenever any part is at a registrar value or an older NAV.
  - The Registrar AUM card says "statement of 08 Oct" and explains that a statement prints no NAV date.
  - The client holdings tooltip no longer says "today's NAV".
- **Registrar AUM vs CRM valuation stay separate.** With MFSD203 imported:
  - registrar statement ₹14,67,10,680.68 (1,943 positions, 08-Oct);
  - CRM valuation ₹14,66,10,685.69 at AMFI NAV of 07-Oct (1,613 holdings), plus ₹99,995 at registrar value (1 holding), labelled "Mixed dates".
  - Without MFSD203 — the pilot manifest — the CRM has no holdings and says "No holdings". The pilot claims no AUM.

## 3. Final transaction and exception reconciliation (the declared manifest)

**Source rows → registrar transactions:**

| | MFSD201 (May) | MFSD201 (Oct) | Total |
|---|---|---|---|
| Source data rows | 819 | 689 | **1,508** |
| Rows staged | 819 (673 single + 143 lot rows + 3 refused instructions) | 689 (385 single + 197 lot rows + 107 held) | 1,508 — 0 rows without a transaction |
| Unique registrar transactions (`kfin.v1:<Fund>:<Transaction Number>`) | 685 | 415 | **1,100** |
| In both files | | | 0 |

**Every unique transaction, one exclusive outcome:**

| Outcome | Transactions | Source rows | Amount | Treatment |
|---|---|---|---|---|
| Posted (processed) | **1,073** | 1,398 | ₹1,02,27,740.48 | on an ISIN-verified AMFI scheme, to the folio's owner on record |
| Refused instructions recorded | **3** | 3 | ₹12,000 | 1 failed SIP instalment (₹2,000) + 2 failed STP legs (₹10,000). Rejected, 0 units, never business; 1 SIP-rejection record |
| Folio-consolidation corrections | **18** | 99 | ₹1,47,868.30 | held (Held screen); no posting path |
| Unknown transaction codes | **6** | 8 | ₹5,43,384.29 | unsupported, held until registrar documentation |
| **Total** | **1,100** | **1,508** | | ledger = 1,073 + 3 = **1,076** |

**Overlaps, by unique identity:**
- Corrections ∩ unknown codes = **0**.
- Corrections ∩ unmapped schemes = **0**.
- Unknown codes ∩ unmapped schemes = **1**: the ₹99,995 transaction on `120DEGP`. It is counted once, under unknown codes; it would stay held even if the scheme were mapped.
- Posted ∩ any exception = **0**.
- Refused ∩ any other category = **0**.

**Unmapped KFintech codes** (both runs: 4 unresolved; none of them carries a posted transaction):
- Pilot manifest, 118 codes seen, 114 resolved by ISIN, 4 unresolved:
  - `120DEGP` — the one unknown-code transaction above;
  - `120RGGP`, `127DFGP`, `185SCRG` — appear only in MFSD211, with 0 transactions; they resolve by ISIN once MFSD203 is imported.
- With MFSD203, 219 codes, 215 resolved, 4 unresolved:
  - `120DEGP` (₹99,995 holding);
  - `176BAGP`, `176TPDP`, `RMFRIRG` — the ISIN the registrar printed is not in the AMFI feed; nil holdings, 0 transactions.

**Posted, by type:**

| Type | Processed | Amount |
|---|---|---|
| SIP | 952 | ₹55,01,358.94 |
| Lumpsum | 32 | ₹18,88,605.58 |
| Redemption (15 of them multi-lot) | 19 | ₹22,52,186.63 |
| STP | 67 | ₹4,80,589.28 |
| SWP | 3 | ₹1,05,000.05 |

Plus rejected: SIP 1 (₹2,000), STP 2 (₹10,000).

**Checks:**

| Check | Result |
|---|---|
| Scheme identity | 1,076 / 1,076 on an approved AMFI identity; 0 on a registrar code |
| Ownership | 0 without an owner; 0 posted to anyone but the folio's owner on record |
| Multi-lot redemptions | 15, 340 lots, 13,286.593 units, ₹20,89,213.97; 0 differ from their lots |
| Reconciliation | 0 / 0 / 0 / 0 / 0 after the manifest and after the re-import |
| Re-import of the manifest | identical transaction fingerprint (1,076); clients, folios, ledger and SIP-rejection counts unchanged |
| CAMS R2 and R9 sent to the pilot firm | both refused ("covers kfintech only; a cams record is refused"); 0 CAMS batches, folios, clients or transactions |

## 4. SIP counts

**Pilot manifest (MFSD211 + MFSD201 only)** — 727 registrations inferred from instalments, none registrar-verified:

| Kind | State | Count | Amount | In the Active SIP Book |
|---|---|---|---|---|
| SIP | observed activity | 318 | ₹20,09,549.81 | no |
| SIP | unknown | 388 | ₹19,20,037.47 | no |
| STP | observed activity | 16 | ₹1,03,796.11 | no |
| STP | unknown | 4 | ₹69,998.00 | no |
| SWP | unknown | 1 | ₹5,000.05 | no |

**Active SIP Book: 0.** The pilot makes no SIP-book claim.

**With MFSD243 added** — 729 registrations: the 727 plus 2 registered 01–07 Oct with no instalment yet. MFSD243's 9 rows (8 "Live SIP", 1 "Live STP") verify:

| Kind | State | Count | Amount | In the Active SIP Book |
|---|---|---|---|---|
| SIP | verified active | 3 | ₹7,500 | **yes** |
| SIP | pending (registered, first instalment not yet processed) | 5 | ₹9,500 | **no** — `sips.status = pending`; the book counts `active` only (`lib/metrics/sip.ts`) |
| STP | verified active | 1 | ₹5,000 | no — not a SIP |
| SIP | observed activity | 312 | ₹19,96,050.47 | no |
| SIP | unknown | 388 | ₹19,20,037.47 | no |
| STP | observed activity | 15 | ₹98,796.11 | no |
| STP | unknown | 4 | ₹69,998.00 | no |
| SWP | unknown | 1 | ₹5,000.05 | no |
| | paused / stopped / terminated / historical | **0** | | none reported — the MFSD243 sample lists only live registrations |

**Active SIP Book = 3 SIPs, ₹7,500 a month.** It is not the firm's whole book: 703 SIP registrations have no registrar status.

## 5. CAMS mapping safety

| Requirement | Evidence |
|---|---|
| All 164 CAMS codes stay unresolved until approved | Real files in an isolated firm activated for CAMS (not a pilot): 164 codes across 15 CAMS AMCs, all `unresolved` (`no_isin`). 0 CAMS transactions posted (R2's 1,334 held `scheme_unresolved`; WBR10's 10 unsupported: 8 unknown codes + 2 non-financial events). 0 SIPs from WBR49 (1,188 registrations not posted) |
| An AMC identity is required before any scheme approval | Confirming the top-exposure code `PP/PP001RG` to a real, current PPFAS scheme was **refused**: "the AMC behind registrar code PP is not verified yet …". 0 CAMS AMC identities exist; the review screen shows no candidates without one. Tests: `rta-amc-identity-db` 1, `rta-scheme-mapping-3i-db` (CAMS platform approval) |
| Approving an AMC identity approves no scheme | `rta-amc-identity-db` 2. In the earlier simulation all 15 AMCs were recorded; all 164 codes stayed unresolved |
| Cross-AMC candidates need verified successor / merger evidence | Suggestions only from the verified AMC; a wrong-AMC approval is refused; a successor needs two operators and a document (`rta-amc-identity-db` 3, 5, 7) |
| Every approval and revocation is audited | Firm audit log, append-only `scheme_registrar_map_events` and `registrar_amc_identity_events`, shown as one history on the review screen (`rta-amc-identity-db` 2, 9) |
| CAMS files cannot post through a KFintech-only activation | **Gap found and fixed in this round.** Activations had no registrar scope, so a CAMS master or holdings file sent to the pilot firm would have posted clients and folios. Migration **0242** adds `rta_pipeline_activations.registrars`: required when posting is enabled; it cannot be edited after the fact; the database CHECK allows only `cams` / `kfintech`. An out-of-scope file is refused before anything is staged. Every posting path — batch, held-transaction re-evaluation, SIP book, manual resolution — refuses it again inside the posting transaction. Test: `rta-registrar-scope-db` (5); on the real files R2 and R9 were refused with nothing written |
| Exposure-ordered queue | Kept. Top 5 on the real files: `PP001RG` ₹2,33,76,080.87 · `P15` ₹79,41,801.02 · `H02` ₹76,28,263.79 · `K108` ₹61,91,171.34 · `PDFG` ₹52,95,893.92 |
| No approval from name similarity | Names only rank candidates and are labelled "similarity is not proof". No code path approves on a name |

## 6. Final pilot definition (for authorized completion)

**A 14-day, one-firm, KFintech transaction-only pilot.** The fields below are blank on purpose. The firm, the operators and compliance complete them in the change ticket.

| Field | Value |
|---|---|
| Firm (legal name and tenant id) | ________ |
| Pilot ARN (must equal the ARN printed in the manifest's files) | ________ |
| Registrar scope | `registrars: ["kfintech"]` (fixed) |
| Input-file manifest: report code, file name, SHA-256, data rows, date range, ARN, for every file | ________ (MFSD211 first, then MFSD201; MFSD203 / MFSD243 only if listed) |
| Start (date, time, IST) | ________ |
| End = activation `expiresAt` = start + 14 days | ________ |
| Operator 1 (requester) | ________ |
| Operator 2 (approver, a different person) | ________ |
| Compliance signatory | ________ |
| Change ticket / approval reference | ________ |
| Halt contacts (any one may stop) | ________ |

**How each pilot requirement is enforced:**

| Requirement | Enforced by |
|---|---|
| Post only fully verified economic transactions | Validate-first: every row staged, checked and grouped before any write. The scheme gate needs an ISIN-verified AMFI scheme; the owner must be on record or found by the client's own PAN |
| Keep rejects, corrections and unsupported records as actionable exceptions | Refused instructions are recorded as rejections (0 units) plus a SIP-rejection record. Corrections and unknown codes stay held and visible on the Held screen; an ownership hold also opens a task for its folio |
| No duplicate imports, no wrong ownership | `rta_posted_transactions` UNIQUE(firm, registrar identity) under a per-firm lock (re-import verified). A guardian's or Karta's PAN never makes them the owner |
| Immediate emergency halt | One operator: pause the firm, halt the firm, or EMERGENCY for all. Posting holds the control row FOR SHARE, so a halt waits for the running batch and stops the next |
| Preserve financial source lineage | Every posted row links to its staging rows, file checksum and batch. Holdings legs carry `sourceReport` / `sourceAsOf` / `sourceNav` / `sourceValue` |
| Reconcile every committed batch | `rta-posting-recovery.ts reconcile` after each import (five counts, all 0); the nightly monitor alerts on any non-zero count |
| No claim of complete AUM or SIP Book coverage | The firm AUM total is withheld while any registrar statement is partial or stale; the AUM tile shows its NAV dates and parts; the SIP book shows verified / observed / unknown coverage. Report the pilot only as "verified KFintech transactions posted and reconciled" |
| Registrar scope | Activation `registrars: ["kfintech"]`; a CAMS file is refused whole (0242) |

## 7. Six release conditions

Steps, evidence and stop conditions are in `PILOT_HANDOVER.md` §3. No condition is PASS: none has production evidence.

| # | Condition | Development evidence | Production result |
|---|---|---|---|
| A | Official AMFI file integrity and mapping validation on the pilot host | strict reader verified on the authentic 07-Oct file; KFintech codes resolved by ISIN only | **NOT VERIFIED** |
| B | Every in-scope KFintech scheme verified or explicitly held | on the sample: 114 / 118 resolved by ISIN, 4 unresolved and held; 0 posted transactions off an approved identity | **NOT VERIFIED** |
| C | Migration rehearsal on an authorized, isolated copy of production | chain applies from empty (280); immutability drill passes | **NOT VERIFIED** |
| D | Infrastructure security, worker recovery, tenant isolation, backup and alerts | emulator and infrastructure tests (3G); RLS check passes | **NOT VERIFIED** |
| E | Read-only production diagnostics reviewed by the operator and compliance | read-only scripts exist | **NOT VERIFIED** |
| F | Clean reconciliation dry run and written two-person approval | dry run clean on the sample manifest (§3); controls tested | **NOT DONE** — needs explicit written authorization |

## 8. Remaining blockers

**Software:**
- Nothing open blocks the KFintech-only transaction pilot.
- Fixed in this round:
  - the activation's missing registrar scope (0242);
  - the AUM tile's "Today" on a previous-day NAV;
  - the registrar card's date wording.
- Open, not blocking the pilot:
  1. `transactions` UNIQUE(firm, order_id) cannot hold a registrar number reused across AMCs. There are 0 in the samples, and a reuse is held, not lost.
  2. Folio-consolidation corrections (18) have no posting path; they stay held.
  3. No CAMS rejection sample exists yet; CAMS "Rejection" wording stays `unknown`.
  4. `scheme_master` duplicates after AMC renames: the audit is read-only.
  5. Legacy (non-validate-first) firms keep name-based scheme behaviour.

**Operator / environment:**
1. Runbook A–F with production evidence.
2. The 08-Oct (or later) AMFI file on the pilot host, and the §2 check.
3. Decisions on the 4 unresolved KFintech codes (held, or approved from the AMC's scheme list).
4. Registrar documentation for the 6 unknown KFintech codes.
5. Outside the pilot (CAMS):
   - 15 AMC identities with documents;
   - scheme approvals in exposure order;
   - a current CAMS full-book statement.

## 9. GO / NO-GO

**NO-GO for production activation today.** The software evidence supports a 14-day, one-firm, KFintech transaction-only pilot, on these grounds:
- 1,073 transactions post on verified identities, with every exception held and reconciled to the source rows.
- Re-import changes nothing.
- CAMS files are refused by the activation's scope.
- NAV dates are labelled as they are.

A–E have no production evidence, and F is not authorized. **GO only when** A–E are recorded PASS by the named roles with the evidence listed, **and** two platform operators and compliance sign F in writing, with every §6 field completed. That approval covers the KFintech transaction pilot only. It says nothing about AUM, the SIP Book, CAMS or the other modules.
