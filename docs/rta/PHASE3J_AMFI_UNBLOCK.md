# AMFI reference data unblock and pilot decision

**Status:** development evidence only. Nothing was merged or deployed, no production data was touched, and nothing was posted live or repaired historically. The AMFI file was applied only to the isolated development database `rta_verify3j`, built from empty by `migrate:all` (278 files).

**Inputs:**
- `NAVAll.txt`, supplied by the firm owner as an official AMFI download.
- The twelve real RTA sample files used since Phase 2B (scratch area; never committed). Only aggregates and public scheme identifiers are reported.

**Result:**
- **215 of 219 KFintech registrar codes resolve automatically by ISIN.** 0 ambiguous, 0 conflicting, 4 absent from AMFI.
- For every mapped KFintech holding — **1,939 of 1,939** — the registrar's own NAV equals AMFI's NAV for the mapped scheme exactly. This is independent proof the mapping is right.
- CAMS stays a manual review queue.
- The recommendation (§I) is **CONDITIONAL GO** for the 14-day KFintech-only pilot. Production go-live is **NO-GO** until the three NOT VERIFIED release conditions are verified on the pilot account.

---

## A. Official AMFI file verification

| Check | Result |
|---|---|
| File | 1,518,873 bytes; SHA-256 `f85adeebb6bbca9862a0c0b928527d8c46f095da99131429f95ceed2d1449b3f`; UTF-8 with CRLF line endings; no BOM; no replacement characters |
| Source evidence | Supplied by the firm owner as downloaded from amfiindia.com; recorded in `amfi_feed_imports` with the hash and the note. **Not** cross-checked against a second, independent download: this sandbox cannot reach AMFI (proxy 403). The content corroboration below is strong, but a second-download hash comparison is still a release step (§I, condition 1) |
| Header | `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date` — AMFI's current eight-column layout, column for column |
| Rows | 18,089 lines; **14,357 schemes**; 0 malformed rows (every data row has 8 columns); 55 AMCs from the section lines |
| `--check` mode | Run first (`scripts/amfi-import.ts --check`): 0 errors; exit 0. Only then applied |
| Duplicate codes | **0** (none identical, none conflicting) |
| ISINs on two codes | **5**, all on long-matured Nippon / Reliance fixed-term funds (NAV dates 2017–2022). Any registrar code carrying one would be held as `isin_ambiguous`; none of the samples do |
| ISIN cells | 10,592 placeholders (`-` 10,583, `Redeemed` 9) — **"no ISIN", not an error**; 1 non-ISIN value (`HDFCNIVODG` in a reinvestment column, dropped and counted); every other ISIN well-formed |
| Plan / Option | Plan stated on 8,648 rows (`Direct Plan` 4,315, `Regular Plan` 4,333); Option on 8,643 (Growth / IDCW / Bonus variants, e.g. "Monthly IDCW Option", "IDCW Reinvestment Option"); blank on older schemes and ETFs — read as unknown, never guessed |
| NAV | 14,116 positive NAVs; 241 schemes listed at `0` / `0.0000` — no NAV (identity only, never priced) |
| NAV dates | **The file's business date is 07-Oct-2026** (8,720 schemes). One ETF row is dated 08-Oct-2026. **5,595 schemes carry historical NAV dates** (mostly more than a year old: matured, wound-up or merged schemes AMFI still lists) |

**Reader corrections the real file required** (all in `src/lib/finance/nav-feed.ts`, with tests):
1. `-`, `Redeemed`, `N.A.` and `Nil` in an ISIN column are placeholders, counted separately — not invalid ISINs.
2. The feed date is the **business date** (the date most schemes carry), not the newest single row. Historical NAV dates on individual schemes **never reject the file**. A file is stale only if its business date is more than 7 days old; it is "in the future" only if any NAV is dated after tomorrow.
3. **"Historical" now comes from AMFI's own NAV date**: more than 7 days before the latest file's business date. It no longer comes from a scheme's absence from a file. A scheme missing from one daily file keeps its status (tested). Reason code renamed to `isin_verified_historical`.
4. A zero NAV is no NAV.

Applied to `rta_verify3j`:
- `written 14,116`, `kept_newer 0`.
- Plan stored for 8,530 priced schemes and Option for 8,542.
- 8,654 schemes with a current NAV, 5,462 historical.
- Production Scheme Master: untouched.

## B. KFintech mapping — actual results

Rule unchanged from Phase 3I: one ISIN → exactly one AMFI scheme (either column), AMC consistent with the registrar AMC's other codes, no explicit plan / option contradiction.

| Result | Codes | Transactions (amount) | Posted under the gate | Holdings legs (registrar-reported AUM) | SIP registrations |
|---|---|---|---|---|---|
| **Source codes** | **219** | 1,100 (₹1,09,30,993.07) | 1,076 (₹1,02,39,740.48) | 1,945 (₹14,67,10,680.68) | 747 |
| Verified automatically | **215** (98.2 %) = 214 current + 1 historical | 1,099 (₹1,08,30,998.07) | 1,076 — every scheme-dependent one | 1,941 (₹14,66,10,685.68 — **99.93 %**) | 747 (100 %) |
| Previously approved | 0 | — | — | — | — |
| Ambiguous | 0 | — | — | — | — |
| Missing from AMFI | **4** | 1 (₹99,995.00 — also held as an unknown transaction code, "IPO") | 0 | 4 (₹99,995.00) | 0 |
| AMC / ISIN conflicts | 0 | — | — | — | — |
| Plan / option conflicts | 0 | — | — | — | — |
| Manual approval required | **4** (the missing four) | 1 | — | 4 (₹99,995.00) | 0 |

Also held on verified codes, for non-scheme reasons (unchanged from 3H):
- 18 folio-consolidation corrections (₹1,47,868.30);
- 5 unknown transaction codes.

The **4 missing codes** (ISIN absent from AMFI's file, checked by exact search):
- `120DEGP` (`INF205KA1CD5`) — an NFO / IPO holding of ₹99,995 held at the registrar's value.
- `176BAGP` (`INF903JA1IT6`) and `176TPDP` (`INF903J01900`) — ex-Principal schemes under Sundaram; no money.
- `RMFRIRG` (`INF204K01AM3`) — Nippon; no money.

Approve them by platform mapping when the AMC's scheme list shows them, or leave them excluded.

**The 43 multi-issuer codes are explained.** Each of the five registrar AMCs prints ISINs from two NSDL issuer prefixes, and AMFI places **both prefixes under one AMC** — successor issuer codes after mergers and renames:

| Registrar AMC | Codes | Issuer prefixes | AMFI AMC | Outcome |
|---|---|---|---|---|
| 105 | 5 | 192K, 137A | JM Financial Mutual Fund | 5 verified |
| 118 | 14 | 754K, 843K | Edelweiss Mutual Fund | 14 verified |
| 129 | 2 | 663L, 223J | PGIM India Mutual Fund | 2 verified |
| 176 | 17 | 173K, 903J (ex-Principal) | Sundaram Mutual Fund | 15 verified, 2 missing from AMFI |
| 178 | 5 | 955L, 251K | Baroda BNP Paribas Mutual Fund | 5 verified |

The AMC check therefore passed for all 41 that AMFI carries. No AMC conflict exists in the samples.

**Correctness evidence (independent of the rule):**
- **Holdings:** the registrar's NAV on its 08-Oct statement equals AMFI's NAV exactly (to 4 decimals) for **1,939 / 1,939** mapped legs. The other 2 legs carry no NAV (zero balance).
- **Transactions:** AMFI's 07-Oct NAV ÷ the registrar's trade NAV (trades 30-Apr to 07-Oct-2026) lies between 0.8 and 1.25 for all 1,073 processed transactions: 1,019 within ±10 %, 52 between 1.10 and 1.25 (the oldest, from April), 2 between 0.80 and 0.90. **0 outliers.** A Growth / IDCW or Direct / Regular swap would show as a step.
- 215 mappings were recorded once for the platform (`scheme_registrar_map`, basis `isin`, status `verified`, no firm id).

## C. CAMS mapping-review priority

The minimum-file strategy is preserved: **no new CAMS report is requested.**
- Verified internal references and administrator-approved mappings: **none exist** (0). CAMS prints no ISIN in R2, R9, WBR4, WBR10 or WBR49.
- All 164 CAMS codes stay `unresolved / no_isin`. Their 1,334 transactions (₹1,28,59,629.24) stay **held** — visible, not posted.
- **The KFintech pilot does not depend on any CAMS mapping.**

**Review queue** (generated from the real files: `cams-review-queue.csv` in the session scratch area — not committed):
- Ordered by registrar-reported holding value, then transaction amount, then SIP registrations.
- Each code shows its registrar description and money, plus up to three suggestions.
- **10 codes cover 50 % of the CAMS money, 36 cover 80 %, 78 cover 95 %.** 161 of 164 carry money.

| CAMS AMC | Codes | Holding value | Transaction amount | SIP regs | Highest-value code |
|---|---|---|---|---|---|
| P (ICICI Prudential) | 32 | ₹2,83,19,858.65 | ₹24,21,827.92 | 274 | P15 |
| H (HDFC) | 28 | ₹2,21,66,952.14 | ₹19,14,166.76 | 239 | H02 |
| PP (PPFAS) | 4 | ₹2,19,24,280.55 | ₹16,34,199.06 | 150 | PP001RG |
| Y (WhiteOak) | 11 | ₹1,28,84,284.57 | ₹17,07,017.27 | 196 | Y1035 |
| K (Kotak) | 17 | ₹1,06,92,411.57 | ₹11,64,840.74 | 94 | K108 |
| L (SBI) | 18 | ₹90,01,133.91 | ₹10,45,248.86 | 88 | L036G |
| D (DSP) | 12 | ₹51,94,896.29 | ₹4,46,980.18 | 43 | D15 |
| G (Bandhan) | 7 | ₹22,58,040.81 | ₹1,65,850.02 | 39 | G340 |
| FTI (Franklin) | 5 | ₹20,00,575.74 | ₹19,60,348.93 | 3 | FTI410 |
| T (Tata) | 9 | ₹15,78,531.49 | ₹75,696.25 | 28 | TMAG |
| B (Aditya Birla SL) | 10 | ₹15,63,250.30 | ₹54,366.68 | 10 | B92 |
| IF (360 ONE) | 2 | ₹7,63,977.67 | ₹2,68,986.56 | 4 | IFMAFRG |
| O (HSBC) | 4 | ₹6,24,504.13 | ₹19,999.01 | 7 | OFIVFG |
| MM (Mahindra Manulife) | 3 | ₹3,77,274.97 | ₹25,598.73 | 9 | MMMHERG |
| HLS (Helios) | 2 | ₹2,48,544.50 | ₹11,499.43 | 4 | HLSHFCRG |

(AMC names in brackets are the reviewer's reading of the descriptions; the system does not assume them.)

**Suggestions are never evidence.**
- 159 codes get suggestions. For 117 the top suggestion's name matches the registrar description exactly (score 1.0).
- But Kotak's K108 gets an *SBI* scheme as top suggestion while no Kotak code is established. And descriptions without a plan word ("… - Growth") do not settle Direct vs Regular.
- Only one code (IFMAFRG) has numeric corroboration: the registrar's implied NAV on 08-Oct equals the suggestion's AMFI NAV. The other CAMS statements are dated 18-May-2026, when AMFI's file gives no NAV.

Recommended order:
1. **One anchor per CAMS AMC first** — its highest-value code, approved against the AMC's scheme list (15 approvals). Each anchor establishes the AMC, so every sibling's suggestions narrow to that AMC and contradictions are flagged.
2. Then by money until 80 % (36 codes in total) or 95 % (78).

Approvals:
- Done once on the platform (two operators, `/api/super-admin/scheme-mappings`; evidence note and append-only events), or per firm on Scheme codes → Review (evidence source + note, audited).
- Either releases the held transactions automatically.

Code change: the Review panel now also shows name suggestions when the registrar AMC is not yet established, warned "AMC not established — check the AMC on the document". It previously showed none for every CAMS code.

## D. Financial-value coverage (real samples, after mapping)

| | Registrar-reported holdings | Transaction amount | SIP registrations |
|---|---|---|---|
| KFintech mapped | ₹14,66,10,685.68 (99.93 % of KFintech) | ₹1,08,30,998.07 (99.09 %) | 747 / 747 |
| KFintech unmapped | ₹99,995.00 | ₹99,995.00 (1 txn, also an unknown code) | 0 |
| CAMS mapped | ₹0 | ₹0 | 0 / 1,188 |
| CAMS unmapped | ₹11,95,98,517.29 | ₹1,29,16,626.40 | 1,188 |
| **Firm (both registrars)** | **55.05 % mapped** of ₹26,63,09,197.97 | **45.42 % mapped** of ₹2,38,47,619.47 | 747 / 1,935 |

## E. Impact on the eight CRM modules (controlled setting, gate on, `rta_verify3j`)

| Module | KFintech after mapping | CAMS | Checks |
|---|---|---|---|
| Transactions | **1,076 posted on AMFI codes**, registrar code kept in `rta_scheme_code`; 0 on a registrar code; 0 not matching a resolved code | 1,334 held (`scheme_unresolved`) | Every processed transaction's NAV = the registrar's printed NAV (1,073 / 1,073). 15 multi-lot redemptions (340 lots, 13,286.593 units, ₹20,89,213.97) posted whole on AMFI codes; 1 multi-lot correction and 1 unknown code held |
| Transaction Rejection | 3 refused instructions (SIP 1, STP 2; 0 units, ₹12,000) on AMFI codes | — | never business |
| SIP Rejection / Stop | 1 rejection with an AMFI code | — | never a stop |
| SIP Master | 747 registrations with `amfi_scheme_code` (`resolved_isin`) | 1,188 `unresolved` | states unchanged from 3H (1,561 unknown overall) |
| Active SIP Book | 3 active (₹7,500 / month) + 5 pending in the book, AMFI codes | the one verified CAMS SIP (₹1,500) withheld until its code is mapped | `getSipBook` = ₹7,500 / month, 3 SIPs |
| Client Master | 1,193 clients, 2,978 folios (unchanged); 1,941 KFintech legs canonical | 1,243 legs on registrar codes, `unresolved` | 0 resolved legs on another code |
| Accurate AUM | KFintech registrar card ₹14,67,10,680.68, dated 08-Oct, full book, 0 gaps; live-NAV value of mapped legs = registrar value (± ₹0.01 over ₹14.66 cr) | ₹11,95,98,517.29 at registrar value, dates mixed (18-May → 08-Oct) | firm total withheld (correctly: CAMS mixed / stale) |
| Client Portfolio | 2,864 holdings over 1,193 clients; 2,838 priced, 26 unpriced | unresolved holdings keep the registrar value | 0 clients whose total differs from its holdings; **0 holdings carrying another scheme's NAV** |

**No loss, no duplication:**
- Baseline firm P (gate off) staged the same 2,444 registrar transactions as the gated firm G, with identical KFintech outcomes. The only difference is CAMS: posted in P, held in G.
- G: transactions = ledger = 1,076; 0 transactions without a ledger row; 0 duplicate order ids.
- A full re-import changed nothing (same fingerprint; ledger 1,076 → 1,076).
- The nightly reconciliation monitor reports **0** on all five counts for both firms.

Caveat to keep visible: the live-NAV AUM tile (₹26,63,09,198.05) adds KFintech at AMFI NAV to CAMS at its registrar-stated values (unresolved, partly May-dated). It is not a firm-wide live valuation until CAMS is mapped. The Registrar AUM card already withholds the firm total for this reason.

## F. Scheme and NAV correctness tests

New or changed:
- **Real-file shapes (pure):** placeholders, the business date versus one newer row, historical NAV counts, zero NAV.
- **Absence from a file is not inactivity (DB):** a scheme with a current NAV but missing from the latest file still resolves `isin_verified`.
- Historical NAV labelled and never current.
- Existing Phase 3I matrix: ambiguous ISIN, Direct / Regular, Growth / IDCW, payout / reinvestment, AMC mismatch, renames, stale NAV, unmapped holding, held transaction, repeated import, conflicting mappings, two firms, tenant access, operator approval and audit.

Regression:
- `tsc` and `eslint` clean.
- All 12 `check:*` scripts pass.
- Vitest: **929 passed, 1 skipped** (run as the non-superuser `mfd_app`), plus `test:emergency` 1 / 1.
- PII scan over the diff: 0 hits against 10,782 identifiers from the real files.

## G. Production deployment blockers

1. **Production migration rehearsal** on a copy of the production database (`migrate:all --check`, then 0239–0240). Rehearsed only on empty and old-chain development databases (drill 14 / 14).
2. **Infrastructure** on the pilot account: S3 policy and encryption, SES receipt rule and registrar domains, Redis persistence, the production app role (`\du`: no superuser / BYPASSRLS), PAN-token key custody, backups / PITR restore, alert routing. None is verifiable from this sandbox.
3. **Read-only production diagnostics** for the pilot firm (`rta-historical-diagnostics.ts`, `scheme-master-duplicates.ts`), reviewed with the firm.
4. AMFI source: re-apply on the pilot host from a fresh download (or this file with its hash matched to a second download).
5. Inherited and not blocking the KFintech pilot: CAMS codes (§C), no current CAMS full-book statement, SIP registration completeness, unknown transaction codes, the `transactions` order_id uniqueness change if a cross-AMC reuse ever appears (0 in the samples).

## H. The smallest safe 14-day pilot

| | |
|---|---|
| Firm | one; activation by two operators with a 14-day expiry; scheme gate on (`RTA_POSTING_MODE=controlled`) |
| Files | KFintech MFSD211 → MFSD203 → MFSD201 → MFSD243 (MFSD230 optional). CAMS R9 / R2 / WBR49 may be imported: masters post, every CAMS scheme-dependent record stays held and visible. No new report types |
| Posting scope | KFintech transactions, refused instructions, SIP rejections and verified SIP registrations on the 215 verified codes. The 4 missing codes are excluded and listed on Scheme codes with their ₹99,995 holding kept at the registrar's value |
| Daily | apply AMFI (worker or `amfi-import.ts`, hash recorded) → imports → reconciliation monitor (must be 0) → Held and Scheme codes screens reviewed |
| Report it as | "mapped KFintech transactions posted and reconciled" — **not** the eight-module CRM validated. AUM, Portfolio, SIP Master and the Active SIP Book stay partial while CAMS is unmapped |
| Halt / recovery | one operator: pause or halt the firm, or EMERGENCY; dependency-aware batch reversal and undo (3H drill) |
| Exit criteria | 14 days of monitor = 0; no unreviewed Scheme-code conflict older than 2 days; every held KFintech transaction explained; the firm signs off the posted KFintech transactions against its own registrar statements |

## I. Final GO / NO-GO

| # | Release condition | Result | Evidence |
|---|---|---|---|
| 1 | Authentic, verified AMFI reference data | **PASS** (development) | The official eight-column layout; `--check` clean; hash recorded; registrar NAV = AMFI NAV for 1,939 / 1,939 mapped holdings. Re-apply on the pilot host, hash-matched to a second download |
| 2 | Every pilot-scope KFintech scheme resolved or explicitly excluded, with complete exception accounting | **PASS** | 215 resolved, 4 excluded (₹99,995 holding, 1 transaction already held as an unknown code, 0 SIPs). Every other KFintech hold accounted: 18 corrections, 6 unknown codes |
| 3 | Production migration rehearsal on a safe copy | **NOT VERIFIED** | no production copy available here |
| 4 | Real infrastructure security and recovery checks | **NOT VERIFIED** | no access to the pilot account |
| 5 | Reviewed read-only production diagnostics | **NOT VERIFIED** | not run on production |
| 6 | Clean reconciliation dry run | **PASS** on the real sample files (isolated DB) / **NOT VERIFIED** on a copy of the firm's production database | monitor 0 / 0 / 0 / 0 / 0; ledger = transactions; re-import idempotent; G and P agree |

**Decision:**
- The scheme-mapping blocker is resolved for KFintech: **GO on the data.**
- The pilot is **CONDITIONAL GO**: it starts only when conditions 3, 4 and 5 — and the production-copy run of 6 — are verified by someone with access to the pilot account and its database.
- Until then, **NO-GO** for activating any firm.
- CAMS is outside the pilot and follows the review queue.
