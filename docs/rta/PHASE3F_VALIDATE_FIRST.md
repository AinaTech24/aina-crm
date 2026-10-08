# Phase 3F — Validate-first RTA import engine (DEVELOPMENT ONLY)

Status: implemented and proven on an isolated development database. **Not
merged, not deployed, no production migration, no production posting.**
Posting is refused anywhere the gate does not pass, which includes every
production configuration.

## A. The workflow

```
upload / mail ──► worker job (same for both)
                      │  RTA_PIPELINE_MODE=validate_first  (gate must pass, else the import FAILS closed)
                      ▼
  identify ─► decode ─► STAGE every source row (rta_staging_*) ─► strict field validation
      ─► investor / folio resolution (owner.ts) ─► classification ─► duplicate & correction checks
      ─► financial reconciliation (lots, printed precision) ─► commit eligibility
      ─► ONE database transaction, behind the posting gate ─► CRM reporting
```

| Record kind | Poster | Writes |
|---|---|---|
| transaction (R2, WBR10, MFSD201) | `postTransactionBatch` | `transactions`, `sip_rejections`, `rta_posted_transactions` |
| master / holding (R9, WBR4, MFSD211, MFSD203) | `postMasterBatch` | `investors`, `folios` (+ dated legs), `families`, `folio_holders` |
| registration (WBR49, MFSD243, MFSD230) | `rebuildSipBook` | `rta_sip_registrations`, `sips` (verified only) |

The legacy importers (`processRtaFile`, the rich job's own import) are not
called in this mode — the worker test counts zero calls.

### Every record gets an outcome

`rta_staging_economic_txns.posting_outcome`:

| Outcome | Meaning |
|---|---|
| posted | new CRM transaction, ledger row written |
| matched_existing | the CRM already holds this number with the same facts — linked, not duplicated |
| rejected_recorded | a refused instruction: a rejected record with 0 units (+ `sip_rejections` for an instalment) |
| already_posted | the ledger already holds this registrar transaction (re-import, overlap, retry) |
| quarantined | identity, owner or figures not proven; or a different CRM transaction under the same number |
| unsupported | a code / event the verified samples do not define |
| correction_held | folio consolidation / registrar corrections |
| held_dependent | its folio has an identity / figures hold in the same file — the folio's history is not split |
| blocked | `partial: "none"` and the file has problems |

### Concurrency, retries, crash

- Ledger `rta_posted_transactions` UNIQUE(tenant_id, identity_key); the
  identity is `kfin.v1:<Fund>:<TxnNo>` / `cams.v1:<amc>:<trxnno>` — never a
  row number, never the number alone.
- Every posting runs under `pg_advisory_xact_lock('rta_posting:'||tenant)`
  and loads its batch `FOR UPDATE`; the SIP book under its own lock.
- A crash (tested by an injected failure after partial writes) rolls the
  whole batch back; the retry resumes the same batch and posts each
  transaction once; a further retry replays the recorded outcome.

### The gate (`posting/gate.ts`) — fail closed

All must hold: `RTA_POSTING_MODE=development`; not production by
`NODE_ENV` / `VERCEL_ENV` / `RAILWAY_ENVIRONMENT` / `APP_ENV` /
`ENVIRONMENT`; `RTA_POSTING_DATABASE` set; `DATABASE_URL` /
`APP_DATABASE_URL` host loopback or a socket; and **inside the posting
transaction** `current_database() = RTA_POSTING_DATABASE` on a loopback (or
socket) server. A test flips each condition and shows the refusal, with
nothing staged or written; another shows the in-transaction database check
refusing after the environment passed.

## B. Development posting results (real files, isolated DB `rta_verify3f`)

Twelve real files (May: R9, MFSD211, R2, MFSD201; October: MFSD211, WBR4,
MFSD203, MFSD201, WBR10, WBR49, MFSD243, MFSD230), production order:

| File | Staged rows | Committed | Held |
|---|---|---|---|
| R9 | 1,237 | 1,178 folios | 0 |
| MFSD211 May | 648 | 633 folios | 0 |
| R2 | 1,334 | 1,334 transactions | 0 |
| MFSD201 May | 819 (143 as lots) | 682 + 3 rejected records | 0 |
| MFSD211 Oct | 384 | 364 folios | 0 |
| WBR4 | 8 | 8 folios | 0 |
| MFSD203 | 1,943 | 1,792 folios | 0 |
| MFSD201 Oct | 689 (197 as lots) | 391 | 6 unsupported, 18 corrections |
| WBR10 | 10 | 0 | 10 unsupported |
| WBR49 / MFSD243 / MFSD230 | 1 / 9 / 20 | SIP Master rebuilt; 9 verified SIPs posted | — |

- 2,410 CRM transactions (2,407 posted + 3 rejected records), every one with
  a ledger row and lineage (`raw_feed_row.identityKey`, `economicTxnId`,
  `batchId`); 0 duplicate registrar numbers.
- **Idempotent**: re-importing all twelve files left `transactions`
  byte-identical (fingerprint unchanged); every transaction re-read as
  `already_posted`.
- **Order**: a firm fed transactions and registrations FIRST, then masters,
  then everything again, ends with an exact subset of production
  (2,401 of 2,410, owners included). The 9 missing are minor-row KFintech
  transactions whose folios the earlier holdings file had placed on PAN-less
  placeholders: they are HELD (visible, never filed under the placeholder).
  Masters-before-transactions remains the required order.
- **No other table written**: every non-staging table was fingerprinted
  around every file; only the intended tables changed.

## C. Eight-module matrix (production order)

| Module | Source → canonical → committed → shown |
|---|---|
| 1 Client master | 1,193 clients; 23 minors (3 with registrar-scoped provisional keys — CAMS/KFin minors matched only by guardian + name are NOT merged; 5 review items on the batches); 9 HUFs; 25 placeholders; 0 folios with two owners |
| 2 AUM | KFintech MFSD203 8 Oct full book ₹14,67,10,680.68 (1,943 positions, 329 zero); CAMS R9 18 May + WBR4 8 Oct = partial, mixed, stale → firm total withheld with reasons; live NAV AUM ₹26,63,09,198.05 shown with "Registrar statements: CAMS 18 May–8 Oct (partial, mixed dates, 143 days old) · KFintech 8 Oct" |
| 3 SIP Master | 1,935 registrations; verified: 4 active (3 KFin, 1 CAMS) + 5 pending + 1 STP active; 327 observed activity; the rest unknown (MFSD230 / WBR49 carry no status for them) |
| 4 Portfolio | 1,193 clients valued, 2,877 holdings, 2,838 with a dated registrar figure; 0 clients whose total differs from its holdings; 588 clients carry a staleness / mixed-date warning |
| 5 SIP rejections | 1 instalment refused → 1 categorised `sip_rejections` row; no SIP stopped by it |
| 6 Transactions | 2,130 SIP · 149 STP · 71 lumpsum · 50 redemption · 7 SWP processed; 15 multi-lot redemptions (340 lots) posted once each |
| 7 Rejections / corrections | 3 rejected records, 0 units, never business; 18 folio-consolidation corrections held; 0 posted |
| 8 Active SIP book | 4 SIPs, ₹9,000 a month, 3 clients — only verified registrations; 0 posted from an unverified state |

## D. Minor / HUF identity safety

- A guardian's or Karta's PAN never makes them the owner — 0 minor-row
  transactions on adults, 0 HUF-row transactions on individuals, in both
  orders.
- A minor folio held by a PAN-less placeholder holds the minor's rows
  (`placeholder_owner`) — found by the adverse-order run and fixed.
- Separate provisional identities (`MINOR:<gp>:<NAME>:<RTA>`) when the only
  link is guardian + name at another registrar; a review item says so.
- `folio_holders`: first / guardian / second / third as tokens + masks; a
  report manages only the roles its layout carries (MFSD203 has no joint or
  guardian columns and no longer closes them); an older statement never
  overrides a newer one; AUM counts the folio once.
- Manual resolution: only ownership holds; refuses a guardian for a minor,
  an individual for an HUF, a client with a different PAN, a folio on record
  under another client; posts once; audits `rta.identity.resolve`.

## E. KFintech redemptions (9 May + 6 October = 15)

Every group posted once with its lots kept: 15 groups, 340 lots, 13,286.593
units, ₹20,89,213.97 as reported. Amount = units × NAV − load (verified per
lot within printed precision); STT is reported separately, so the payout is
NOT claimed: lineage carries `amountMeaning: registrar_reported`,
`payoutVerified: false`, and the reported load / STT.

## F–H. SIP book, AUM, rejections

See the matrix. States persisted: VERIFIED_ACTIVE, OBSERVED_ACTIVITY,
PENDING, PAUSED, STOPPED, EXPIRED, REJECTED, UNKNOWN. Recent activity is
judged against the frequency (`cycleWindowDays`), never a flat 35 days, and
never makes a SIP active or stopped.

## I. Tests

- `tests/rta-validate-first-db.test.ts` (13): gate, empty firm, history
  match / conflict, multi-lot, refused instructions, corrections, partial
  independence, strict mode, crash / resume / replay, same file, overlap,
  concurrent imports, two firms, CAMS minor / HUF, lineage, manual
  resolution, joint holders, SIP book.
- `tests/rta-validate-first-worker-db.test.ts` (2): the worker jobs, gate
  refusal, retry.
- `tests/rta-rich-owner-db.test.ts`: provisional minor at a second registrar.
- `tests/rta-owner-identity.test.ts`: minor row on a placeholder folio.
- `tests/rta-aum-view.test.ts`: tile and portfolio coverage notes.
- Browser (`scripts/rta-validate-first-ui.mjs`, real Chromium against
  `next dev` on the isolated DB): 17/17 production order, 19/19 adverse order
  (Owner Dashboard AUM tile and Registrar AUM card, client portfolio
  captions and coverage line, SIP Book active count, Held transactions rows
  and buttons, a refused resolution in the browser, 375px width, no page
  errors).

## J. Remaining production blockers

1. The posting gate refuses production by design; enabling it needs a
   separate decision, a production gate design and a rollback plan.
2. Production data repair is out of scope: existing production
   transactions, placeholders and minor links are untouched.
3. A full-book CAMS statement has not been seen; CAMS AUM stays partial.
4. 1,598 registrations are UNKNOWN (no registrar status in MFSD230 / WBR49 rows,
   or evidenced only by instalments) — they stay out of the SIP book until a status report
   covers them.
5. Unsupported codes (P1FCS, IPO, NOM and others: 16 held) and folio
   consolidation corrections (18 held) need registrar documentation.
6. Order dependence for minors: holdings before masters leaves minor folios
   on placeholders; settling them needs Merge Clients, then a re-import.
7. The CAMS/KFin minors linked only by name (3) await a person's decision.
