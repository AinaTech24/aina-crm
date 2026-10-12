# B-1 — integrating production (`main`) into the RTA release

**Status: DEVELOPMENT ONLY. Not deployed, not migrated anywhere but disposable
databases, nothing posted, no historical repair run, no tag created or moved.
Production remains NO-GO.**

Authorization: owner, "RTA PRODUCTION BLOCKER B-1: SAFE CODEBASE INTEGRATION"
(2026-10-12). Branch: `claude/relaxed-mendel-01jprq` (CI only — the deploy
workflow runs on `main` and `deploy/aws` alone). The candidate's commit and
tree hashes are recorded in `PILOT_HANDOVER.md` §0.1, in the docs-only commit
that follows this one (a commit cannot carry its own hash).

---

## A. Ancestry (verified 2026-10-12 from the remote)

| Ref | SHA | Note |
|---|---|---|
| `origin/main` | `a16628c5ba16d7da3cb222b970c467a54521d220` | production's deploy branch (`deploy.yml`: push to `main` / `deploy/aws`) |
| `origin/deploy/aws` | `0d924d772e08d87db79bb68bad2571a57120fade` | **no merge base with `main`** — an unrelated history; not used here |
| release tag `rta-kfintech-pilot-candidate-2026-10-10` | peels to `c26e67636f8bbfac3d80eed30152d7ac1af0aa4f` | unchanged, not moved |
| release head merged | `5055a31b65b2c561da4cd28a9ad8df8e6d663e40` | = `c26e676` + 4 commits that change `docs/` only (`git diff c26e676 5055a31b` touches `docs/rta/PILOT_HANDOVER.md`, `docs/rta/PREFLIGHT_CHECKLIST.md`) |
| merge base (`main`, release) | `9a895cfb03675190274207fcce1b299fd76178fe` | |
| commits only on `main` | **36** | listed in B |
| commits only on the release | 29 (25 to `c26e676`, 4 docs) | |

**Production SHA: NOT VERIFIED.** The last successful GitHub Actions deploy
(run `37924630302`, 2026-10-09 11:49 UTC) shipped `a16628c5`, which is
`origin/main`. `scripts/manual-deploy.sh` can deploy any commit without
Actions, so what runs on `i-059673ee0da4f877a` is known only from the host
(`/opt/aina-crm/.deployed-sha` or the image label) — an operator check
(checklist PR-1). This integration assumes production = `a16628c5` and must be
re-based if the host says otherwise.

Conflicts in the merge: 9 files (C). Deploy triggers: unchanged — the merged
`deploy.yml` is byte-identical to `main`'s; `ci.yml` gains only the release's
emergency-drill step.

## B. The 36 production commits — impact and how each is preserved

Columns: area · what it changes · how it reached the candidate (**clean** = no
conflict, the file is `main`'s; **merged** = in a conflicting file, both sides
kept; **guarded** = kept, plus the release's RTA write guard added) · evidence.

| Commit | Area | Change | In the candidate | Evidence |
|---|---|---|---|---|
| `9eab7eb6` | RTA identity | `client-match.ts`: a PAN finds the live client (Excel-loaded `dedup_pan=false`, merges followed), PAN-less firm clients adopted on an unambiguous name; `former-owners.ts` history follows a moved folio | **merged** — legacy importer only; never validate-first; never a minor (C-8, C-9) | `rta-client-match.test.ts` (7 DB cases), `rta-b1-integration.test.ts` |
| `65a1e5b3` | script (read-only) | duplication diagnostic | clean | read-only, not run |
| `cc25f003` | RTA identity / AUM | a no-PAN holdings row never takes a real client's folio (`keptOwner`); PAN/mobile column aliases (KFintech) | **merged** (C-6, C-8) | `rta-client-match.test.ts` ("no PAN never takes a folio"), integration test (alias PAN through `validPan`) |
| `a26ecd80` | script | folio-owner repair projection | **guarded** | not run |
| `6d01b7bb` | deploy | Docker build retry, cancelled-deploy message | clean (byte-identical) | `git diff origin/main -- .github scripts/ssm-deploy.sh` empty |
| `a6a5df31` | valuation | price a registrar-coded holding by scheme name (`scheme-name-key.ts`) | **merged** — never for an evidence-tracked row (C-4) | `scheme-name-key.test.ts`, integration test (valuation) |
| `c9a79fd7` | AUM | one unpriced holding no longer freezes a client's AUM | **merged** (C-5) | `valuation-scheme-identity.test.ts` |
| `b9f3ff80` | portfolio | Book AUM = dashboard AUM | clean | full suite |
| `9ba3fc54` | AUM / valuation | value from registrar statements; folio-owner union (no double count) | **merged** (C-4, C-5) | `valuation-scheme-identity.test.ts` |
| `96e09156` | AUM | recompute in batches of 50 | clean (inside `aum-persist.ts`, kept) | full suite |
| `0bc257ff` | RTA holdings | leg merge: units rule for nameless legs, `"0"`/`NOT PROVIDED` = no ARN; dedup + SIP repair scripts | **merged** (C-8: gated by `rtaSchemeCode`) · scripts **guarded** | `rta-leg-merge.test.ts`, integration tests (3 leg cases) |
| `da905e62` | script | close silent SIPs | **guarded** | not run |
| `e3ec3f44` | AUM | nothing to value → AUM 0 | clean | full suite |
| `e8f6e679` | duplicates UI | Find Duplicates by name/email/phone/PAN | clean | `duplicate-clusters.test.ts` |
| `e4055543` | valuation | statement NAV tells same-named schemes apart | **merged** (C-5: `lookupNav` hint) | `scheme-name-key.test.ts` |
| `0cb101d1` | script | merge certain duplicate clients; SIP check | **guarded** | not run |
| `83eae894` | SIP script / deploy | CAMS SIP ↔ instalments; deploy disk | clean / **guarded** | not run |
| `a3e3c3b7` + `1980510e` | AUM (added + reverted) | month-end AUM table `0240_aum_month_end.sql` added then removed | net zero — the file is absent | see E: a ledger that recorded it blocks |
| `c131bee3` | search | fail fast, abort abandoned searches | clean | full suite |
| `79ffd54d` | dashboards | every business figure from Business Entries | clean (`business.tsx` auto-merged with the release's AUM-composition footer) | full suite, `tsc` |
| `8a178981` | ops dashboard | Booked vs RTA panel | clean | full suite |
| `84997db4`, `4c6f0e7f` | deploy | manual deploy, production change lock, least-privilege deploy role | clean (byte-identical) | diff empty |
| `87decfbf` | IMAP | one email cannot block a mailbox | clean (`imap-poller.ts`, `inbound-ingest.ts`) | `inbound-ingest.test.ts` |
| `4a3e2159` | **security** | bind every SQL value (Support page, five array builders, `sql/bound-array.ts`) | clean (byte-identical) | `sql-parameterization.test.ts` |
| `12b59805` | **security** (DB) | web/worker no longer get the master login; `.env.migrate` only for `migrate` | clean (`docker-compose.prod.yml` auto-merged with the release's doc line) | consistent with 0244 runtime-role refusal |
| `ab17a062`, `0240d6e6` | Terraform | state in a locked S3 bucket; code reconciled with production | clean (byte-identical). **Not planned, not applied** — `terraform` is not installed here | diff empty |
| `206486b6` | **privacy** | inbox logs carry hashes / codes, never addresses, file names or URLs | **merged** (C-2, C-3); the release's new log lines converted too | `log-safe.test.ts`, integration test (poller log lines) |
| `adb8f4e7` | parser | KFintech MFSD230 aliases | **merged** (C-7) | `rta-sip-book-kfin-mfsd230.test.ts` (adapted to the `Parsed` result) |
| `04c1e8cf` | parser | CAMS FOLIOCHK / PAN_PEKRN; unknown header refused | **merged** (C-7) | `rta-parsers-cams-c-layout.test.ts` (headerless case now a refusal — I-4) |
| `8c33d726` | families | members take the head's RM | clean | full suite |
| `2de0e938` | financial plans | save no longer fails | clean | `financial-plan-payload.test.ts` |
| `f8388cf9`, `a16628c5` | SIP | registrar status recorded and shown as a LABEL, never a closure | **merged** (C-7, C-9) | `sip-registrar-status.test.ts`, integration test (optional columns) |

## C. The nine conflicts — both sides read, decision and rationale

| # | File | `main` brought | The release brought | Decision |
|---|---|---|---|---|
| C-1 | `CLAUDE.md` | "RTA imports — which client a registrar row belongs to" | Phase 2 – 3J and the security-patch sections | Both kept; a note in `main`'s section says name adoption is a legacy-importer rule and that the folio on record / own PAN still decide. |
| C-2 | `src/lib/comms/imap.ts` | `errorRef(e)` in the failure log (privacy) | `failed = true` on a fetch error (the mail is not marked processed) | Both: the flag and the log-safe line. |
| C-3 | `src/workers/rta-inbox-poller.ts` | `addressRef` / `fileRef` / `urlRef` / `safeError` | intake scope (`intakeRefusal`, blocked import), `admitAndIngest`, download-skip error count | Both. The release's two new log lines (blocked report type, ingest failure) printed a file name and a raw error — converted to `fileRef` / `safeError`. Static test pins it. |
| C-4 | `src/lib/finance/valuation.ts` | folio-owner UNION (a transaction counts under the folio's owner), name/fuzzy NAV fallback `priceByName` | validate-first rows never take a NAV older than `RTA_NAV_MAX_AGE_DAYS`; legs with `schemeStatus` take AMFI NAV only when resolved and current | `main`'s query structure + the release's CASE rules + an `evidence_tracked` column; `priceByName` skips evidence-tracked rows. An evidence row is never priced by name (Phase 3H/3I rule); ordinary rows keep `main`'s fallback. Test: one leg of each kind against the same NAV row. |
| C-5 | `src/lib/finance/aum-persist.ts` | `lookupNav(..., statement NAV hint)` | evidence-tracked legs keep the registrar's dated value unless resolved + current | Release rule for evidence legs; `main`'s hinted lookup for every other leg. |
| C-6 | `src/lib/rta/kfintech.ts` | PAN / mobile column aliases | strict readers (`validPan`, `readDate`) | `main`'s aliases, read through the release's `validPan` (placeholder text is "no PAN"). Test. |
| C-7 | `src/lib/rta/parsers.ts` | MFSD230 / CAMS-C aliases, registrar status / end date / remark columns, `UnknownRtaLayoutError`, headerless positional read | strict `readLayout` (no positional fallback), `Parsed<T>` result with rejects | Release structure; `main`'s aliases added; the three registrar columns are **optional** (never make a row "short", an unreadable end date leaves the label empty, never rejects the SIP). `UnknownRtaLayoutError` is an alias of `RtaLayoutError`. **Behaviour change I-4**: a headerless AUM / SIP file is refused. |
| C-8 | `src/lib/rta/import.ts` | client-match (slot claim, merges, name adoption, no-PAN `keptOwner`), leg-merge units rule + ARN normalisation | `InvestorDirectory` + owner rules (guardian / HUF holds, Trash, merge lifecycle), folio-keyed no-PAN keys, placeholder moves HELD, leg identity by `rtaSchemeCode`, older statement never replaces newer | Release identity first; `main`'s resolver after it. Name adoption: legacy importer only (`sourceBatchId` → none), never a `MINOR:` key. A key whose client was merged away: the survivor also takes the PAN slot (`main`'s test). `keptOwner` kept. Leg merge: same code OR same registrar code; `main`'s name / units rules only toward a leg without a registrar code; ARN `"0"` / `NOT PROVIDED` = none; `olderThanKeep` kept. |
| C-9 | `src/lib/rta/process.ts` | `resolveInvestorId` / `buildInvestorIndex` via client-match with name adoption; registrar SIP label; AUM-statement units rule | `InvestorDirectory` throughout (owner rules), restructured `processSipBook` (folio on record, AMC-exact folio) | Release resolver kept. `adoptUnknownPansByName`: offers name adoption only for PANs the directory finds NOBODY holding (a held PAN is never re-decided). `main`'s SIP label code kept inside the release's `processSipBook` (registrar status = label; only a cease date stops). AUM units rule skips legs carrying a registrar code. |

Additional integration fixes (not textual conflicts):

- **Write guard on `main`'s repair scripts.** `repair-rta-duplicates`, `repair-folio-owners`, `close-silent-sips`, `dedupe-folio-legs`, `close-sips-by-feed-window`, `repair-client-duplicates`, `revalue-tenant-aum` now call `refuseIfRtaWritesStopped` before `--apply` (the release's Phase 3H rule for every RTA-rewriting script). Without it they could rewrite a validate-first, paused or halted firm. Test spawns all seven against a validate-first firm: each exits 1, nothing written.
- **`main`'s tests adapted to the release API**: three parser tests read `.rows`; the CAMS headerless case asserts refusal (I-4); the placeholder-move case asserts the hold (I-1). Each change carries a comment naming the decision — none was loosened to pass.

## D. New candidate

Recorded in `PILOT_HANDOVER.md` §0.1 by the docs-only commit after this one:
commit, tree, `src/`, `drizzle/migrations/`, baseline `main` = `a16628c5`.
Migration count and checksums are unchanged from `c26e676` (E).

## E. Migration compatibility (disposable databases only)

| Check | Result |
|---|---|
| `main`'s 270 files vs the candidate | **270 / 270 byte-identical** (git blob hashes) |
| Candidate migrations vs `c26e676` | `git diff c26e676 -- drizzle/` empty: 282 files, lock SHA-256 `5a2a3288…38a7` unchanged |
| `check-migration-lock` / `check-migration-dups` | ✓ 282 match · no new duplicate prefixes |
| Order 0233 → 0244 | 12 files, in order, after `0232_physical_rta_route.sql` |
| Fresh database (empty → 282) | applied 282; `check:rls` 189 tables ✓; `check:schema` 199 tables ✓ |
| **Upgrade of a `main`-state database** (built by `main`'s own runner: 270) | `--check`: 270 applied, **12 pending, 0 blockers** → applied 12 → 282 applied, 0 pending; `check:rls` ✓, `check:schema` ✓; **`pg_dump --schema-only` identical** to the fresh build (only pg_dump's random `\restrict` token differs) |
| A ledger that recorded `main`'s reverted `0240_aum_month_end.sql` | `--check` exits 2: "recorded as applied but no such file exists" — **nothing applied**. Operators confirm the production ledger has no such row (PR check). |
| Immutability drill | exit 0, 0 failures |

Not done: production ledger and checksums (operator, read-only — checklist PR).

## F. Security and production-feature regression

| Control | Result |
|---|---|
| SQL binding (`main` `4a3e2159`) | files byte-identical to `main`; `sql-parameterization.test.ts` pass |
| RLS | `check:rls` ✓ (189 tables) on fresh and upgraded DBs; RLS isolation suites in the full run pass |
| Restricted runtime role (0244) / `main`'s master-login removal | `runtime-db-role-db.test.ts` pass; compose keeps `.env.migrate` for `migrate` only — consistent |
| PAN / PII | `log-safe.test.ts`; poller log lines test; PAN alias through `validPan` |
| MFA on session | `auth-mfa-session-db.test.ts`, `security-session-boundary.test.ts` pass |
| Two-person control, kill switch, EMERGENCY | `test:emergency` pass; P0 rehearsal identical to baseline |
| Rate limits, change lock, deploy | `main`'s files byte-identical; deploy workflow unchanged |
| Alerting / reconciliation monitor | `rta-reconciliation-alerts-db.test.ts` pass |
| Worker retry / Redis (FS-8) | `rta-fs8-redis-cancel-db.test.ts` pass (local Redis); infra check: Redis down → refused, never lost; worker killed mid-staging (the resume-and-post half is blocked by I-6) |
| Write guard on scripts | 7 of `main`'s scripts now guarded (C), test pass |
| Terraform | unchanged from `main`; **not validated** (no terraform binary), **not applied** |

Nothing here is a production AWS validation: Redis, S3 and Postgres were local.

## G. Financial reconciliation — before and after

All on disposable databases with the real sample files (never committed; aggregates only) and the authentic AMFI NAVAll of 07-Oct-2026 (SHA-256 `f85adeeb…b3f`).

**1. Validate-first, pilot manifest (FS-7 rehearsal, merged code vs the FS-7 baseline of `c26e676`)** — identical:
legacy firm 1,061 transactions (3 rejected, ₹81,50,526.51) → 1,061 matched by every fact (all by registrar code), 15 posted, 18 folio corrections held, 6 unknown codes unsupported; re-run: 1,076 already posted, 0 new; reconcile five checks all 0; legacy rows unchanged (fingerprint equal before / after within the run — the hash differs from the baseline's only because it includes each rebuild's random ids). Collision firm: 3 + 3 quarantined, never linked.

**2. P0 rehearsal (legacy firm, clean pilot, out-of-scope files)** — all 21 recorded figures identical to the P0 baseline: 1,076 transactions / ledger, 501 clients, 762 folios, 1 SIP rejection; **15 multi-lot redemptions with 340 lots** (₹20,89,213.97) posted as 15 transactions; MFSD203 / MFSD243 / MFSD230 / CAMS R2 / R9 / WBR49 refused for the pilot firm with the CRM unchanged.

**3. Phase 3L harness, run on `c26e676` AND on the candidate (fresh DB each)** — every figure group identical between the two and with the original 3L baseline (only the activation record differs: it now carries `reportCodes`, from 0243):
AMFI feed 14,357 schemes / 14,116 written; 215 KFintech codes verified, 4 unresolved (`isin_not_in_feed` 1, `no_isin` 3); MFSD203: 1,938 mapped legs exactly equal to units × AMFI NAV of 07-Oct (₹14,66,10,685.69; registrar − CRM = ₹0.01), 1 unmapped leg at the registrar's ₹99,995; AUM label "Mixed dates"; CAMS R2 / R9 refused for a KFintech-only activation; 1,100 staged identities, 0 in both files; 1,076 transactions all on an approved identity with the folio's owner; SIP book (X) active 3 (₹7,500) + pending 5 (₹9,500); re-import idempotent.

**4. Legacy importer (production's path today), all nine real files** — `main` vs `c26e676` vs candidate:

| Figure | `main` | `c26e676` | candidate |
|---|---|---|---|
| live clients | 1,180 | 1,193 | 1,193 |
| … with PAN key / minors / no-PAN placeholders | 1,165 / 20 / 15 | 1,168 / 23 / 25 | 1,168 / 23 / 25 |
| folios / legs / folio AUM | 2,972 / 3,182 / ₹26,61,11,482.73 | same | same |
| transactions processed | 2,434 (₹2,14,94,867.71) | 2,392 (₹2,09,98,155.75) | 2,392 (₹2,09,98,155.75) |
| transactions rejected | 0 | 3 (₹12,000) | 3 (₹12,000) |
| active SIPs | 8 (₹17,000) | 8 | 8 |
| SIP rejections | 0 | 1 | 1 |

**Candidate = `c26e676` on every figure.** Every difference from `main` is a release rule already reviewed in Phases 2–3E, not a merge effect: KFintech rows held instead of guessed (multi-lot groups, folio corrections, unknown codes — 143 + 304 rows, 39 fewer transactions), refused instructions recorded as rejected with 0 units, no-PAN placeholders keyed by folio instead of name (+10), a minor at the other registrar kept as a separate provisional client (+3). Investor-level AUM roll-up differs by ₹0.02 between `main` and the release (folio AUM identical) — rounding in the release's per-client recompute.

Not run: production data; CAMS posting (out of the pilot's scope by design); a production-sized book.

## H. Tests

| Run | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `npm run lint` | exit 0 |
| `check:rbac`, `check:rls`, `check:migrations`, `check:schema`, `check:colors`, `check:asany`, `check:mathimports`, `check:calc`, `check:finance`, `check:spine`, `check:labels`, `check:sql` | all exit 0 |
| `migrate-all --check` (fresh 282) | 282 applied, 0 pending, 0 blockers |
| full vitest on a fresh DB (restricted role), final tree | **4 full runs: 3 passed — 106 files, 1 skipped (the emergency drill, run alone) · 1,125 tests passed, 2 skipped; 1 run had one intermittent failure** (I-7): `rta-amc-identity-db.test.ts` › "two registrar codes whose top suggestion is the same AMFI scheme are both warned" listed a third code in the warning. It passes 6 / 6 alone on the candidate and 6 / 6 on `c26e676`; the cause is the global `amfi_feed_imports` table, which `amfi-feed-import-db` and `rta-scheme-mapping-3i-db` write while it runs in parallel. No file involved was changed by `main` or by this integration. Also 3 runs without the new test file: 1,104 passed each. An earlier full run before the script-guard edit: 1,117 passed. |
| new `tests/rta-b1-integration.test.ts` | 21 passed (incl. 7 static guard checks and the 7-script refusal run) |
| `test:emergency` | pass |
| immutability drill | pass |
| `build:check` (production `next build` into `.next-verify`) | exit 0; one warning, `jose` in the Edge runtime (unchanged from `main`) |
| `scripts/rta-infra-check.ts` — real `next dev`, real Chromium, S3 emulator, Redis, separate worker processes (synthetic data) | **21 / 35 on the candidate and 21 / 35 on `c26e676`, the same checks passing and failing.** Pass: the browser upload dialog (presign → S3 → queue → worker → DB, outcome shown, no page errors), XLSX master, two-file ZIP refused, tenant isolation, the crash drill's kill, Redis down refused (no silent loss), S3 down recorded and file kept, capability / cross-firm / operator refusals, forged and unroutable mail held, no PAN in logs, staging or remarks. Fail (14, pre-existing — I-6): every check that needs a synthetic transaction to POST — the harness seeds no AMFI scheme mapping, so since the Phase 3H scheme gate each one is held `scheme_unresolved` (20,016 holds, no other reason). |

## I. Remaining blockers and decisions for the owner

1. **I-1 Placeholder folio moves (production behaviour changes).** `main` moves a folio off an import placeholder onto the PAN client a master names, with its history, and folds the placeholder. The release holds it for review (owner instruction 2026-10-08, `AUTO_REASSIGN_FROM_PLACEHOLDER = false`). The candidate keeps the hold; production firms will see "import placeholder — needs review" exceptions where today the move happens silently. **Owner to confirm.**
2. **I-2 Same-PAN live twins already in a book.** `main` picks the PAN-slot holder (then the oldest); the candidate holds such rows as ambiguous until the twins are merged by a person (`repair-rta-duplicates.ts` exists, is now guarded, and has not been run). **Owner to confirm**; historical repair is not authorized.
3. **I-3 Folio filed under a different real client.** `main` overwrote the folio's owner; the candidate holds it (release Phase 2 rule).
4. **I-4 Headerless AUM / SIP files are refused** (`main` read them by column position). A firm whose registrar sends such a file gets a layout error instead of an import.
5. **I-5 Production SHA, ledger and role are NOT VERIFIED** (checklist PR): the running commit, the 270-row ledger (no `0240_aum_month_end.sql`), and that `mfd_app` passes the 0244 runtime-role checks — otherwise the web and worker refuse to start after deployment.
6. **I-6 (pre-existing, not from this merge) the infra harness cannot post.** `scripts/rta-infra-check.ts` predates the scheme gate and seeds no AMFI mapping; 14 of its 35 checks fail identically on `c26e676`. The posting paths those checks would cover are exercised by the DB suites (FS-8, validate-first, reprocessing) and the real-file rehearsals in G, but the end-to-end resume-after-crash and database-outage-then-post checks through real worker processes are **not demonstrated** on either tree. Fixing the harness (seed a verified mapping for its synthetic scheme) is test-only work, not done here.
7. **I-7 (pre-existing) one intermittent DB test** — see H. A suggestion's warning text, not a decision (suggestions never post or map anything), but CI can fail on it until the three test files stop sharing the global AMFI feed table.
8. All operational checks (A–F, FS-1 – FS-10, PR, C) remain **NOT VERIFIED**; F part 1 must be run on this candidate, not on `c26e676`.

## J. Tag

Proposed (not created, not pushed): **`rta-kfintech-pilot-candidate-2026-10-12-b1`**
on the candidate commit, annotated. `rta-kfintech-pilot-candidate-2026-10-10` stays
on `c26e676`, unchanged.

## K. GO / NO-GO

**NO-GO for production.** The candidate is ready for the owner's code review and,
after approval and a new tag, for the existing operational preflight. Nothing in
this change authorizes deployment, migration, activation, posting or repair.
