# From CRM to Back Office

**How to turn MFD Growth OS into a full MFD back-office platform — Investwell / Wealth Elite / theMFBox / IFA NOW / Wylth class — without giving up a single CRM feature.**

Research + execution plan. Written 2026-09-16.

> Companion document: [UX_AND_SWITCHING.md](UX_AND_SWITCHING.md) — competitor UI/UX
> research and the design strategy for winning switchers.

---

## 1. The strategic read

### "Back office" is not a feature list. It is a book of record.

Everything the incumbents sell — 40-report packs, capital-gains statements, brokerage
dashboards, client apps — is downstream of one thing: **a ledger that says, for every
client, every folio, every scheme, exactly how many units they hold, what those units
cost, and what they are worth today.** Get that ledger right and the reports are a
weekend of work. Get it wrong and no amount of UI saves you, because the client's own
CAS will contradict your statement and you lose the account.

So the correct framing is not "convert the CRM into a back office". It is:

> **Put a ledger underneath the CRM you already have, and an execution rail beside it.**

### This codebase was built to a different benchmark — and that is the whole insight

A repo-wide search finds **zero mentions** of WealthElite, Investwell or Redvision.
What the code *does* name, in dozens of schema headers, is **Network FP** (the Excel
template pack), **Finowise MIS**, **Sanchay** and **Zoho CRM**.

That is not an accident. This product was deliberately built to *practice-management*
parity — how an MFD firm runs itself. The back-office vendors solve the orthogonal
problem — how an MFD firm accounts for its book. **You have not half-built a back
office. You have fully built the thing none of them have, on top of about 60% of the
plumbing a back office needs.**

### Every competitor is really four products fused together

| Layer | What it does | Strongest incumbents | **You today** |
|---|---|---|---|
| **1. Book of record** | RTA reverse feeds → folios → unit ledger → daily NAV → valuation → returns → capital gains | Investwell, OFA, theMFBox | **~60%** |
| **2. Transact** | Order routing to BSE StAR MF / NSE NMF II / MFU, mandates, payments | Wealth Elite, Investwell, Wylth | **~5%** |
| **3. Revenue** | AMC brokerage ingestion, expected-vs-received reconciliation, sub-broker payouts | Investwell, theMFBox | **~40%** |
| **4. Engage** | CRM, leads, campaigns, client portal, white-label app | Wylth, Wealth Elite, IFA NOW | **ahead of all of them** |

**The gap is narrower than it looks and concentrated in two places: ledger rigour and
execution.** That is a 9–12 month build for 2–3 engineers, not a rewrite.

### The one-line answer

Keep 100% of the CRM. Add, in this order:

1. a **lot-level position ledger** that is derived, rebuildable and continuously
   reconciled against what the RTA says — Phase A;
2. **correct Indian tax maths** and the **investor-facing report pack** on top of it — Phase B;
3. a **BSE StAR MF execution rail**, then NSE, then MFU — Phase C;
4. **multi-asset holdings + licensed research data** for parity — Phase D;
5. a **real client portal and transact-enabled investor app** — Phase E, parallel from Phase B.

---

## 2. What the incumbents actually ship

Compiled from vendor documentation, September 2026.

| Capability | Investwell Mint | Wealth Elite | theMFBox | IFA NOW | Wylth | IFA-Planet | **Us today** |
|---|---|---|---|---|---|---|---|
| RTA reverse feed (CAMS + KFintech) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ **strong** |
| Portfolio valuation + XIRR/CAGR | ✅ | ✅ 40+ reports | ✅ | ✅ | ✅ | ✅ | ⚠️ live only, no history |
| Capital gains (realised + notional) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ FIFO yes, tax rules no |
| BSE StAR MF execution | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| NSE NMF II execution | ✅ | ✅ | — | ✅ | ✅ | — | ❌ |
| MF Utilities (CAN) | ✅ | ✅ | — | — | ✅ | — | ❌ |
| NACH / e-mandate registration | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ status import only |
| Brokerage reconciliation | ✅ | ✅ analytics dashboard | ✅ by AMC/txn/investor/family/branch/RM/sub-broker | ✅ | ✅ | ✅ | ⚠️ partial |
| Video KYC / digital onboarding | ✅ | ✅ | ✅ | ✅ | ✅ | — | ❌ (adapter unwired) |
| Multi-asset holdings (PMS/AIF/FD/bonds/NPS/equity) | ✅ | ✅ 20+ classes | ✅ Master Portfolio | ✅ | ✅ FD + pre-IPO | ✅ | ⚠️ insurance only |
| Research (rolling returns, overlap, quartile, factsheets) | ✅ | ✅ | ✅ **best in class** | ✅ | ✅ | ✅ | ❌ |
| Goal / financial planning | ✅ | ✅ Goal GPS | ✅ | ✅ | ✅ | — | ✅ **ahead** |
| Model portfolios + rebalancing | ✅ | ✅ | ✅ | — | ✅ | — | ❌ |
| White-label **investor** mobile app | ✅ | ✅ Advisor X | ✅ | ✅ | ✅ | ✅ | ⚠️ staff app only |
| Client web portal | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ magic link, read-only |
| Internal MIS report catalogue | ⚠️ | ⚠️ | ✅ | ⚠️ | ⚠️ | ⚠️ | ✅ **87 reports — ahead** |
| CRM / leads / campaigns | ⚠️ basic | ⚠️ basic + WA API | ⚠️ basic | ✅ | ✅ | ⚠️ | ✅ **far ahead** |
| Workflow automation engine | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **unique** |
| Non-bypassable compliance gate | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **unique** |
| SLA'd service desk + SEBI complaint register | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **unique** |

**Read the last four rows again.** Nobody in this market sells a back office that *acts* —
that notices a rejected SIP at 6am and has already messaged the client, raised the task
with an SLA, and logged the compliance trail before the MFD opens the laptop.

Market pricing is ₹25,000–₹1,00,000/year, AUM-tiered. A platform that does the back
office *and* runs the practice justifies the top of that band.

---

## 3. Honest gap map — where the code actually stands

Verdicts below are from reading the schema and engines, not the README.

### 3.1 What is genuinely strong (do not rebuild any of this)

| Area | Evidence |
|---|---|
| **RTA ingestion** | `src/lib/rta/` — 19 files. CAMS WBR2/4/9/22/49, KFintech MFSD201/203/211/307+. Header-signature dispatch that scans the first 10 rows (fixes KFintech `.xls` title banners), checksum dedupe, `SAVEPOINT` per row, bulk investor index, minor/guardian splitting, PAN-less fallback keys. Browser PUTs straight to S3 via presigned URL; parsing runs in an isolated BullMQ worker at concurrency 1 — a deliberate fix for an event-loop stall that used to 503 the whole site. |
| **Valuation + XIRR** | `src/lib/finance/xirr.ts` (Newton-Raphson with bisection fallback), `valuation.ts` (one valuation contract, bulk loads, cached), `position-key.ts` (one consistent position identity). Family valuation correctly combines raw rows rather than averaging percentages. |
| **Data-quality telemetry** | `InvestorValuation.dataQuality` already reports unpriced holdings, unknown-cost holdings, incomplete history, unmatched redemption units. `aum-persist.ts` refuses to overwrite a cached AUM with a deceptively complete zero. **No competitor surfaces this. It is a marketing asset, not just hygiene.** |
| **Three-way reconciliation** | `reconciliation_runs` + `reconciliation_exceptions`, CRM ledger vs RTA-stated units vs live NAV, 0.5-unit dust tolerance, idempotent upsert on `dedup_key` so a persistent break stays one row and a healed break auto-resolves. |
| **AMFI NAV feed** | `src/lib/finance/nav-feed.ts` — header-bound column mapping that survived the Aug-2026 AMFI column insertion, `NAV_FEED_MIN_RECORDS` circuit breaker, daily 07:00 job. |
| **Internal MIS** | 87 reports across 18 groups (50 generic SQL-registry + 34 bespoke pages), a Filter-AST custom report builder with `GROUP BY ROLLUP` summaries and scheduled e-mail delivery, daily `firm_snapshots` AUM/SIP time series, `BackOfficeDashboard` role cockpit, Command Center worklist. |
| **Servicing desk** | SLA matrix per request type, escalation, CSAT/NPS, SEBI complaint register with SCORES refs and monthly disclosure, `detectServiceIntent()` turning a free-text WhatsApp message into a typed ticket, e-mail→ticket routing. Production-grade. |
| **Onboarding blueprint** | The 30-stage `lead_to_client` engine already models `ucc_create → ucc_activated → mandate_create → mandate_activated → mandate_reject → make_transaction → transaction_successful/failed`. **The execution workflow already exists — it just has no exchange behind it.** At record level, `OnboardingWizard` walks Contact → KYC → Risk → Nominee → Bank with per-step completeness, and the mobile app has a native port of the same wizard plus camera/file document capture. |
| **UCC field capture** | `src/lib/onboarding/kyc-fields.ts` (573 lines) already mirrors the **BSE StAR MF UCC / NSE NMF II / MFU eCAN mandatory field sets** — tax status, holding nature, occupation, nationality, default bank, nominee-or-opt-out, FATCA/CRS, PEP, joint holder, with conditional `showIf`. **This makes Phase C dramatically cheaper than it looks.** |
| **Portfolio intelligence** | Asset-class allocation, AMC concentration, coverage/classified %, per-client concentration flags, and **direct-plan leakage** — trail the MFD is not earning. Genuinely differentiated. |

### 3.2 The seven defects that block back-office credibility

Ranked by how badly they hurt when a client disputes a number.

**1 — There is no NAV history table.**
`scheme_nav` is upserted in place; yesterday's NAV is overwritten. Consequence: no
as-of-date valuation, no day-change, no performance chart from your own data, no
monthly average AUM. Every incumbent has this. It also silently causes defect #5.

**2 — Two different cost bases coexist.**
`valuation.ts` computes unrealised gain on **weighted-average** cost. `tax/realized-gains.ts`
computes realised gain on **FIFO**. The portfolio statement and the capital-gains report
will not tie. A client's CA will find this.

**3 — Indian MF tax rules are largely absent from the tax engine.**
FIFO lot matching is real and good. But: grandfathering (31-Jan-2018 NAV) is not applied —
it is *disclaimed* in five separate files; the equity 12-month holding test is applied to
**every** scheme including debt and hybrid; §50AA specified-mutual-fund rules (non-equity
units bought on/after 1-Apr-2023 taxed at slab) are absent; indexation/CII exists only in
a standalone illustrative calculator with no link to the ledger; loss set-off and
carry-forward are absent. The reports carry disclaimers where logic should be.

**4 — There is no holdings table.** Positions live either in an in-memory replay of the
ledger or in a `folios.schemes` **jsonb array** — untyped, not indexable per scheme,
repriced wholesale. Every scheme-level query is a jsonb explosion.

**5 — Commission "expected" is computed from *today's* AUM for every historical period.**
`reconcilePeriod()` uses current `folios.schemes[].value × trailRate ÷ 12`. Re-running
reconciliation for March produces a different number in September. The code comment
admits the simplification. GST does not exist as a field anywhere on commission, and TDS
is stored but never computed or reconciled.

**6 — `corporate_actions` imports zero rows.** The kind is declared in `RTA_FILE_KINDS`,
catalogued in `file-types.ts` and offered in the upload UI — but `process.ts` drops it to
the `default:` branch. Bonus, split, merger and segregated-portfolio events are also
missing from the transaction type enum. **A single fund merger silently corrupts unit
balances and there is nothing that would catch it.**

**7 — The README oversells BSE.** It lists "BSE Star MF adapter — ✅ live-capable".
`src/lib/integrations/bse-star-mf.ts` contains a hand-rolled SOAP `liveBseStar` with
**zero callers anywhere in the repo** — no API route, no action handler, no UI import.
Fix this line today, before a prospect asks for a demo.

### 3.3 Secondary gaps

- **Transaction charges**: no `stamp_duty`, `stt`, `tds`, `exit_load_amount`, no
  gross-vs-net. Zero hits for stamp duty in `src/`.
- **Switch-in vs switch-out** share one enum value, disambiguated only by `direction`;
  same for STP. This already caused a FIFO corruption bug once, per the code comment.
- **RTA scheme code** is resolved to an AMFI code at import and then discarded — no
  persistent crosswalk, so a mis-resolution cannot be audited or corrected without a deploy.
- **Feed importer does not populate** `settlement_date`, `exchange`, `source_feed`,
  `scheme_category` or `raw_feed_row`, though the canonical parse type carries them.
- **Scheme attributes**: exit load is free text, lock-in is absent (no ELSS enforcement),
  expense ratio sits in a manually-keyed jsonb, direct-vs-regular is only inferable from
  the scheme-name string. Three overlapping scheme catalogs exist (`scheme_nav`,
  `mf_schemes`, `masters.scheme_master`).
- **Client portal** reads `folios.schemes[].value` (last RTA snapshot) while the RM's PDF
  reads the live valuation engine — **the client and the RM see different numbers.** No
  login, no XIRR, no gain, no units, no transaction history, no statement download.
- **Reports are internal MIS, not investor deliverables.** 87 reports is more than most
  incumbents — but `deliver.ts` explicitly marks them staff-only. The *investor-facing*
  pack (portfolio valuation, since-inception, point-to-point returns, dividend, SIP/STP/SWP,
  long-term/short-term holdings, notional gain/loss) is the thin part.
- **Multi-asset**: insurance is a real module; equity is account-count + brokerage MIS only
  (no holdings, no trades, no valuation); PMS/AIF/FD/bonds/NPS/gold/real-estate exist only
  as a sales catalogue and free-text discovery notes.
- **Research**: none. No rolling returns, overlap, quartile ranking, factsheets,
  scheme-vs-benchmark, sector/stock exposure. This is theMFBox's entire moat.
- **KYC verification** is a provider-agnostic adapter (Karza/Hyperverge/IDfy/Signzy/Digio)
  that is unwired and fails closed in production. **e-Sign is entirely absent** — it appears
  only in stage description strings.
- **No `address_update` service-request type** (address changes ride `modify_kyc`).
- **Sub-distributor payouts are derived read-only** at a blended 0.65% fallback rate and
  never persisted. No per-scheme attribution.
- **Portfolio review report and account statement are print-to-PDF HTML**, explicitly
  marked "v1, we'll move to server-rendered later".
- **Mobile app has client-servicing depth but no *firm-level* back office.** The native
  client-360 is real — a native port of the 5-step onboarding wizard, blueprint stage bar,
  document capture from camera or file picker, SIPs, service requests, and an "assign to
  ops" handoff sheet. What is missing is RTA imports, reconciliation, the reports
  catalogue, transactions, compliance/DDQ and branches. `mobile/README.md` still describes
  the retired WebView shell, and the generic `features/registry.ts` has exactly one entry.
- **`cagr()` is exported and never called.** Dead code in a financial library.
- **`MFD_FEATURES_AUDIT.md` is stale** — it still calls the CAMS reverse feed a stub and
  says there is no sub-distributor concept. Both are now false. Refresh or retire it.

---

## 4. The architecture decision everything hangs on

### Introduce a lot-level Position Ledger — derived, rebuildable, continuously asserted.

This single change fixes defects 1, 2, 3, 4, 5 and 6 at once.

#### Principle

> The ledger is **not** typed in by anyone. It is **computed** from
> (opening balances + transactions + corporate actions), and it can be **rebuilt from
> scratch at any time** and must produce identical output. A nightly rebuild that asserts
> against the RTA's stated balances is the quality moat.

The most common complaint about incumbents is that they "missed a dividend reinvestment
or a switch transaction" and the MFD spends hours hand-matching. A rebuildable ledger
with assertions turns that from a support ticket into an exception row — which you
already have a table and a UI for.

#### Target tables

```
scheme_master                 -- platform-level; unify the three existing catalogs
  amfi_code PK, isin_growth, isin_reinvest, amc_code, rta,
  sebi_category, sebi_sub_category, plan(regular|direct), option(growth|idcw_p|idcw_r),
  is_equity_taxed, benchmark_code, lock_in_days, expense_ratio_bps,
  exit_load_slabs jsonb, launch_date, close_date, successor_amfi_code

scheme_rta_code               -- the missing crosswalk: auditable, correctable, no deploy
  rta, rta_scheme_code PK, amfi_code, confidence, resolved_by, resolved_at

scheme_nav_history            -- PARTITIONED BY RANGE (nav_date), one partition per year
  amfi_code, nav_date, nav, PRIMARY KEY (amfi_code, nav_date)

txn                           -- extend today's transactions
  + txn_subtype (purchase | switch_in | switch_out | stp_in | stp_out | swp |
                 idcw_payout | idcw_reinvest | bonus | split | merger_in |
                 merger_out | segregated)
  + signed_units, gross_amount, net_amount, stamp_duty, stt, tds, exit_load_amount
  + rta_txn_id, amc_txn_id, settlement_date, source_feed, raw_feed_row

corporate_action              -- NEW: merger, bonus, split, segregation
  amfi_code, action_type, ex_date, ratio_num, ratio_den, successor_amfi_code

holding_lot                   -- DERIVED: FIFO lots — the single cost-basis truth
  position_key, acquired_on, units_acquired, units_remaining,
  cost_per_unit, source_txn_id, closed_on, lot_seq

holding_daily                 -- DERIVED: materialised valuation
  position_key, as_of_date, units, cost, nav, market_value
  (month-end forever; daily for the trailing 400 days)

folio_balance_assertion       -- what the RTA SAYS we hold, from holdings feeds
  folio_id, amfi_code, as_of_date, units, value, source_import_id

ledger_break                  -- derived vs asserted → feeds reconciliation_exceptions
```

#### Why this exact shape

- **`holding_lot` becomes the one cost basis.** The statement's unrealised gain and the
  CG report's realised gain both read it. Defect #2 disappears by construction.
- **`holding_daily` makes the expensive things cheap.** Monthly average AUM (which fixes
  commission "expected"), AUM/SIP time series at position grain, day-change,
  point-to-point returns, as-of-date statements and firm-level XIRR all become an indexed
  read instead of a full ledger replay. `firm_snapshots` stays as the daily firm rollup;
  `holding_daily` is what lets you reconstruct *why* it moved.
- **`folio_balance_assertion` + `ledger_break` makes reconciliation structural** rather
  than a batch job bolted on. The exception table already exists; this gives it real input.
- **`corporate_action` closes the silent-corruption hole.** A merger becomes a
  `merger_out` + `merger_in` pair that **preserves lot acquisition dates** — exactly what
  the tax rules require and exactly what a naive re-import destroys.
- **`scheme_rta_code`** turns an un-auditable in-memory resolution into a correctable
  mapping, so you can fix a client's portfolio from the admin UI instead of a release.

#### Migration path (non-breaking)

1. Build `scheme_master` + `scheme_nav_history` **alongside** existing tables; keep
   `scheme_nav` as a view over the latest partition so nothing breaks.
2. Backfill `scheme_nav_history` from mfapi.in (free, full history per AMFI code) once,
   then let the existing daily AMFI job append.
3. Write the lot builder as a **pure function over the same rows `loadValuationRows()`
   already returns.** Run it in shadow mode; diff against `computeInvestorValuation()`
   nightly; publish the diff as a report.
4. Flip `valuation.ts` to read lots only after the diff is clean for 30 consecutive days.
5. Delete the `folios.schemes` jsonb read path last, after the portal is repointed.

#### Infrastructure warning — read this before committing to dates

`scheme_nav_history` ≈ 18,000 schemes × ~250 trading days × 15 years ≈ **60M rows**.
`holding_daily`, fully daily, ≈ 10,000 clients × 8 positions × 400 days ≈ **32M rows per
tenant-year**.

`DEPLOYMENT.md` already targets 250M transactions by year 5 and already prescribes
range partitioning by month with `pg_partman` past 50M rows — so the pattern is
understood. But the production RDS today is a ~1GB-memory burstable instance carrying a
3.6GB database. **This plan requires a database upgrade before Phase A ships.** Budget for
it explicitly. Mitigations: range partitioning on date, month-end-only retention beyond
400 days, BRIN indexes on date columns, and the cursor pagination `DEPLOYMENT.md` already
lists as outstanding.

---

## 5. The six workstreams

### W0 — Correctness harness *(start first, never stops)*

What makes a back office trusted is that its numbers match the client's CAS.

- Golden-dataset suite: 20 real anonymised folios covering SIP + switch + STP + SWP +
  IDCW reinvest + bonus + merger + partial redemption + ELSS lock-in.
- For each, assert units, cost, XIRR and realised STCG/LTCG against the RTA statement.
- Wire into CI beside the existing `check:finance` / `check:calc` / `check:mathimports`
  scripts — the guard-script habit is already established here.

**Cheapest possible investment, and it is what lets you sell against incumbents on accuracy.**

### W1 — Ledger core
Tables above; lot builder; corporate-action handler; wire the `corporate_actions` feed
kind; nightly rebuild + assert; break report; transaction subtype split; charges columns.

### W2 — Data completeness
- NAV history backfill + daily append.
- Unify the three scheme catalogs into `scheme_master`; persist the RTA crosswalk.
- Structured exit-load slabs, lock-in days, and an `is_equity_taxed` flag that **replaces
  the regex heuristic** currently used only for tax-harvesting filtering.
- **Licence a research dataset** (see §7). Do not build this.

### W3 — Correct tax + investor report pack
- Rewrite the tax engine on lots: grandfathering, equity vs debt vs hybrid vs §50AA,
  correct holding periods, ₹1.25L exemption and 12.5% LTCG / 20% STCG equity, slab for
  specified funds, loss set-off and carry-forward. Encode as **dated rule sets**, not constants.
- Investor-facing pack: portfolio valuation, since-inception, point-to-point returns,
  scheme-wise and family XIRR, transaction, dividend/IDCW, SIP/STP/SWP, redemption,
  long-term vs short-term holdings, notional gain/loss, monthly inflow-outflow, tax package.
- Move the review report and account statement from print-to-PDF HTML to server-rendered
  `pdf-lib`, matching the ten generators that already work that way.

### W4 — Execution rail

BSE StAR MF first — widest MFD coverage, best-documented API. The published spec (v3.5,
Aug 2023) exposes exactly what is needed:

| Service | Endpoint family |
|---|---|
| Auth / password | `MFOrderEntry/MFOrder.svc/Secure` |
| Lumpsum purchase & redemption, switch, spread (overnight) | `MFOrderEntry/MFOrder.svc` |
| SIP / XSIP / ISIP registration & cancellation | `StarMFAPI/api/SIP/SIPRegistration`, `.../XSIP/XSIPRegistration` |
| SIP pause, SIP→XSIP shift | `StarMFAPI/api/Pause/PauseSIP`, `.../SIP/SIPtoXSIPShift` |
| STP | `starmfapi/api/stp/stpregistration` |
| UCC / client master registration | `StarMFCommonAPI/ClientMaster/Registration`, `BSEMFWEBAPI/api/ClientRegistration/Registration` |
| Nominee registration + nominee 2FA | `BSEMFWEBAPI/api/_2FANOMINEEController/...` |
| Mandate status, mandate shift, e-NACH auth URL | `StarMFAPI/api/Mandate/MandateShift` + mandate-status service |
| AOF / cheque / scanned-mandate image upload | `StarMFImageUpload/api/ImageUpload/ImageUploadBase64` |
| Redemption & subscription 2FA | `BSEMFWEBAPI/api/2FAAuthController/...` |
| Single integrated payment (all methods) | `StarMFSinglePaymentAPI/Single/Payment` |
| Order status, allotment statement, redemption statement | `StarMFWebService/StarMFWebService.svc` |

Demo host `bsestarmfdemo.bseindia.com` mirrors live — build and certify against it.

New tables: `order`, `order_leg`, `order_event` (state machine with idempotency keys);
extend `mandates` with registration, UMRN, e-NACH auth URL and status polling; add
`ucc_registration`. **Orders must reconcile back into the ledger — the allotment
statement is the authoritative unit/NAV source, never your order request.**

Two accelerants already in the repo: the blueprint engine's `ucc_create → mandate_create
→ make_transaction` stages, and `kyc-fields.ts` already carrying the BSE/NSE/MFU
mandatory field sets. Then NSE NMF II (`Login`, `UCC`, `FATCA`, `AOF image upload`,
`OrderEntryParam`, `SIPOrderEntryParam`, `SWPOrderEntryParam`), then MFU/CAN.

### W5 — Revenue engine
- Expected brokerage from `holding_daily` monthly-average AUM, **per folio, per period,
  snapshotted** so a re-run of March stays March.
- Per-AMC brokerage file parsers — they are all different; treat each as a plugin.
- GST and TDS as first-class computed fields.
- **SEBI (Mutual Funds) Regulations 2026, effective 1 April 2026**: TER is replaced by a
  Base Expense Ratio, with GST and statutory levies (STT, stamp duty) moved outside it,
  and **distributor commissions are now paid GST-exclusive** — roughly a 15.25% cut to
  base payouts. Brokerage maths must be period-aware across that boundary. This is a live,
  dated requirement and a very good reason for an MFD to change vendors this year.
- Persist sub-distributor payouts with per-scheme attribution, replacing the blended
  0.65% read-only derivation.

### W6 — Client surface
- Real investor login (e-mail/OTP or password + device), replacing the shared magic link.
- **Repoint the portal at the valuation engine** so the client and the RM see one number.
- Portal parity: units, cost, gain, XIRR, transactions, statements, capital gains, goals,
  service requests, document vault.
- White-label **investor** mobile app — the Expo shell, auth, offline queue, push and
  design system are all reusable from the staff app.
- Transact-from-portal once W4 lands. Video KYC + eSign onboarding.

---

## 6. Phased roadmap

Assumes 2–3 engineers. Scale proportionally.

### Phase A — Ledger & truth *(weeks 0–10)*
**Goal: your numbers are defensible.**
- W0 golden-dataset harness in CI.
- `scheme_master` unification + `scheme_rta_code` crosswalk.
- `scheme_nav_history` + backfill + partitioning + **DB upgrade**.
- `holding_lot` builder in shadow mode; nightly diff report.
- Transaction subtype split + charges columns + backfill from `raw_feed_row`.
- `corporate_action` table + wire the `corporate_actions` feed kind.
- `folio_balance_assertion` + break report into the existing exception table.
- **Fix the README BSE claim; point the readiness/stub-guard page at every adapter.**

*Exit criterion: for 20 golden folios, computed units and cost match the RTA statement
exactly, and the statement's gain uses the same cost basis as the CG report.*

### Phase B — Reporting parity & revenue *(weeks 10–24)*
**Goal: an MFD can cancel their incumbent subscription.**
- Cut valuation over to lots; delete the weighted-average path entirely.
- Rewrite the tax engine (grandfathering, asset-class rules, §50AA, set-off/carry-forward).
- `holding_daily` materialisation → day change, as-of-date, position-grain time series.
- Ship the investor-facing report pack; server-render statement and review PDFs.
- Commission: period-snapshotted expected, per-AMC parsers, GST/TDS, BER-2026 handling,
  persisted sub-broker payouts.

### Phase C — Execution *(weeks 24–38)*
**Goal: money moves through your software.**
- BSE StAR MF: UCC + FATCA + nominee, e-NACH / UPI AutoPay mandate registration, lumpsum,
  SIP/XSIP, switch, STP, SWP, redemption with 2FA, integrated payment, order status and
  allotment reconciliation into the ledger. Certify on the demo host.
- Order state machine; basket/bulk orders; bulk switch and redemption.
- Transaction-authorisation OTP, distinct from the existing login TOTP.
- Then NSE NMF II. Then MFU/CAN.
- Per-tenant credentials — `tenant_integrations.provider` has no exchange slot yet; add one.

### Phase D — Breadth *(weeks 38–50)*
- Multi-asset holdings: direct equity (holdings + trades, not just account counts), PMS,
  AIF, FD, bonds, NPS, gold, real estate — one `asset_holding` abstraction, with MF
  keeping its own optimised path.
- Research module on the licensed dataset: rolling returns, scheme-vs-benchmark, portfolio
  overlap, quartile ranking, sector/stock exposure, factsheets, fund report card.
- Model portfolios + rebalancing. **Triggered rebalancing wired into the existing workflow
  engine is a differentiator, not a me-too** — nobody else can express "when equity drifts
  8% above band, draft the switch, route for approval, message the client, log compliance".

### Phase E — Client surface *(parallel from week 14)*
Investor login → portal parity → document vault → white-label investor app →
transact-from-app → video KYC + eSign.

---

## 7. Build vs buy vs licence

| Need | Decision | Why |
|---|---|---|
| Daily NAV | **Build** — done | AMFI `NAVAll.txt` is free and your parser is already hardened |
| NAV history backfill | **Build** | mfapi.in gives free full history per AMFI code; one-time job |
| Scheme portfolios, benchmarks, ratings, fund-manager data, rolling returns | **Licence** — Accord Fintech (ACE MF Nxt), Morningstar Direct India, CRISIL, or Value Research | This is theMFBox's entire moat and it is a data-acquisition problem, not an engineering one. Rebuilding it from monthly AMC disclosure files is a permanent tax on your team. |
| CKYC / KRA lookup, PAN validation, FATCA | **Buy** — the `KYC_PROVIDER` adapter already targets Karza / Hyperverge / IDfy / Signzy / Digio. Just wire one. | Regulated plumbing, commodity pricing |
| Video KYC, eSign | **Buy** — Digio / Leegality / Signdesk | Same |
| Order execution | **Integrate directly** with BSE/NSE/MFU using each tenant's own credentials | An aggregator layer would make you a regulated intermediary. Don't. |
| Investor payments | **Route through exchange rails** (BSE single integrated payment) | You never touch client money. Keep Razorpay strictly for your own SaaS billing. |
| PDF rendering | **Keep `pdf-lib`** | Proven across ten generators; no headless-Chrome operational burden |
| Charting | **Keep Recharts** | Already a dependency |

---

## 8. Regulatory guardrails

1. **Stay a technology vendor to ARN holders.** Each tenant transacts on their own ARN,
   their own BSE member code, their own API credentials. You are software.
2. **Do not become an Execution Only Platform.** SEBI's EOP framework (circular
   13-Jun-2023, effective 1-Sep-2023) governs platforms executing **direct plans**:
   Category 1 registers with AMFI as an agent of AMCs (AMFI set a ₹1 crore net-worth
   criterion), Category 2 registers as a stock broker with an exchange deposit. **EOPs are
   barred from servicing regular plans** — which is your tenants' entire business. Serving
   regular-plan MFDs as a vendor keeps you outside that perimeter.
3. **Stamp ARN + EUIN on every order.** `transactions.executed_euin` exists, and
   per-user `euin` / `personalArn` with expiry tracking already exists on `users`. Carry
   it into the order model and make it mandatory.
4. **SEBI (MF) Regulations 2026, w.e.f. 1-Apr-2026** — BER replaces TER, GST and statutory
   levies sit outside it, commissions are GST-exclusive. Build commission maths as
   period-versioned rules from day one.
5. **Capital gains regime** (Finance (No. 2) Act 2024, unchanged for FY 2026-27): equity
   LTCG 12.5% above ₹1.25L, equity STCG 20%, 12-month equity holding test; non-equity
   units bought on/after 1-Apr-2023 are §50AA specified funds taxed at slab; pre-Apr-2023
   debt held >24 months at 12.5% without indexation; grandfathering at the 31-Jan-2018 NAV
   for pre-Feb-2018 equity.
6. **Keep the compliance gate.** Non-bypassable outbound compliance is a selling point no
   competitor can match on short notice.
7. **DPDP** — the portal login and document vault expand your personal-data surface.
   Extend the existing consent model rather than inventing a second one.

---

## 9. Risks, ranked

| Risk | Impact | Mitigation |
|---|---|---|
| **Client disputes a number against their CAS** | Account loss, reputational | W0 golden-dataset harness; ship the `dataQuality` panel to RMs **and** to the client portal — "here is what we can't price" beats silently wrong numbers |
| **Database cannot carry NAV history + daily holdings** | Phase A stalls | Size and upgrade the RDS instance *before* Phase A; partition by date; month-end-only beyond 400 days; land the cursor pagination `DEPLOYMENT.md` already flags |
| **Corporate actions corrupt balances silently** | Wrong AUM, wrong tax, no alarm | Phase A item; the nightly assert against RTA balances catches it within 24h |
| **BSE certification takes longer than planned** | Phase C slips | Start the BSE API application paperwork during Phase A — it is administrative lead time, not engineering |
| **Scope explosion into research data** | Six months lost | Licence it (§7). Non-negotiable. |
| **Two cost bases ship to production** | Silent inconsistency between statement and CG report | Phase B deletes the weighted-average path entirely; do not leave both behind a flag |
| **README / demo overclaim** | Lost deal, lost trust | Audit every ✅ in README against actual callers this week. The readiness/stub-guard page is the right tool — point it at BSE first. |
| **Stale internal docs mislead the team** | Wrong prioritisation | `MFD_FEATURES_AUDIT.md` still calls the CAMS feed a stub and denies sub-distributors exist; `rta/process.ts` header still claims synchronous in-request parsing. Refresh both. |

---

## 10. Go-to-market: the switching-cost insight

**Every back office in this market rebuilds its book from CAMS and KFintech feeds.** An
MFD's data is therefore not locked inside Investwell or Wealth Elite — it is sitting at
the RTAs, and can be re-requested as historic mailback files.

You already own the hardest part of that migration: a hardened mailback pipeline with
per-tenant e-mail forwarding, password-protected unzip, multi-format parsing and checksum
dedupe, plus generic importers that take 50,000 rows / 40 MB in 2,000-row chunks.

**Turn that into a one-click "Switch to us" onboarding:** the MFD raises a historic
mailback request with CAMS/KFintech, forwards the files, and their entire book
materialises — with the CRM, automation and compliance engine already wrapped around it.
Add importers for the CSV/Excel client-master and folio-master exports the incumbents do
offer, to cover pre-RTA gaps.

A switching story measured in days rather than quarters is worth more than any single
feature on the parity list.

**Positioning:** not "another back office", but *"the back office that runs your practice"* —
correct numbers, plus the automation, SLA'd service desk, compliance gate and AI copilot
none of the incumbents ship. Price at the top of the ₹25k–₹1L band, module-gated through
the `packages.feature_flags` mechanism that already exists.

---

## 11. The next two weeks

Concrete, ordered, no dependencies on decisions not yet made:

1. **Audit README claims against callers.** Correct the BSE StAR MF line. Point the
   readiness/stub-guard page at every integration adapter.
2. **Stand up the golden-dataset harness.** Five folios to start. Wire into `npm test`.
3. **Create `scheme_nav_history`** (partitioned) + backfill from mfapi.in + append from
   the existing daily AMFI job. Smallest change with the widest unlock.
4. **Write the FIFO lot builder as a pure function** over the rows `loadValuationRows()`
   already returns. Shadow-run nightly; publish a diff report against
   `computeInvestorValuation()`. Do not cut over yet.
5. **Wire the `corporate_actions` RTA kind** — even a minimal merger/bonus handler stops
   ongoing silent corruption.
6. **Size the production database** for Phase A and schedule the upgrade.
7. **Start the BSE StAR MF API application** with one pilot tenant's ARN. Administrative
   lead time runs in parallel with Phase A engineering.
8. **Open a licensing conversation** with Accord Fintech / Morningstar / CRISIL for scheme
   portfolio and benchmark data. Their pricing shapes the Phase D plan.
9. **Refresh `MFD_FEATURES_AUDIT.md`** or retire it — it is now actively misleading.

---

## Sources

Competitive and regulatory research, September 2026:

- [Back-Office & SaaS Platforms for MFDs: What Each One Does — Creso](https://creso.in/blog/back-office-saas-platforms-mfd)
- [Investwell Mint](https://investwellonline.com/investwell-mint/) · [pricing](https://investwellonline.com/pricing/)
- [Wealth Elite — REDVision Technologies](https://www.redvisiontechnologies.com/mutual-fund-software-for-distributors.php)
- [theMFBox — AdvisorKhoj](https://www.advisorkhoj.com/mutual-fund-software-in-india)
- [Wylth platform](https://www.wylth.com/platform) · [IFANOW end-to-end MF solutions](https://ifanow.com/solutions/endtoend-mf-solutions) · [IFA-Planet](https://www.ifaplanet.com/)
- [BSE StAR MF Web Services Structure v3.5 (Aug 2023)](https://www.bsestarmf.in/APIFileStructure.pdf)
- [NMF II Trading Member API](https://www.scribd.com/document/836588292/NMF-II-Trading-Member-API) · [MF Utilities](https://www.mfuindia.com/)
- [AMFI NAVAll.txt](https://www.amfiindia.com/spages/NAVAll.txt)
- [SEBI EOP framework — AZB analysis](https://www.azbpartners.com/bank/sebi-introduces-comprehensive-framework-on-execution-only-platforms-for-transactions-in-direct-plans-of-mf-schemes/) · [AMFI ₹1cr net-worth criterion — Business Standard](https://www.business-standard.com/amp/markets/news/amfi-sets-rs-1-crore-net-worth-criteria-for-eops-releases-guidelines-123090100961_1.html)
- [SEBI's new expense ratio framework: what changes after 1 April 2026 — Cafemutual](https://cafemutual.com/news/industry/37012-sebis-new-expense-ratio-framework-here-is-what-changes-after-april-1-2026) · [SEBI (MF) Regulations 2026 overhaul — Mondaq](https://www.mondaq.com/india/commoditiesderivativesstock-exchanges/1764634/sebis-2026-mutual-fund-regulations-overhaul-lower-ters-performance-fees-and-governance-expectations-for-amcs)
- [Mutual fund capital gains rules FY 2026-27 — Bajaj AMC](https://www.bajajamc.com/knowledge-centre/common-things-to-know-about-ltcg-on-mutual-funds)
- [ACE MF Nxt — Accord Fintech](https://www.accordfintech.com/ace-mf-nxt)
- [MFD back-office challenges — Optimum Fintech](https://www.optimumfintech.com/mfd/mutual-fund-distributor-back-office-challenges)
