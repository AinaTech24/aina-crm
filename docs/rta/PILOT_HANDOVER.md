# KFintech transaction pilot — operational handover package

**For:** the authorized infrastructure engineer, DBA, the two platform operators and the compliance reviewer.

**Authorization status:** **there is NO authorization for production deployment, migration, activation or financial posting. Production authorization is NO-GO.** This package lets authorized people decide whether the restricted 14-day KFintech pilot may begin. Nothing in it has been run against production, and no condition below is marked PASS.

**Development is frozen** at commit `8523a01` (accepted). No further feature work is authorized. What remains is operational evidence: release conditions A–F (§3) and the final security checks FS-1 – FS-10 (§2.5), each recorded by the role named for it.

**Final security patch before production preflight (migration 0244) — the one authorized exception to the freeze.** Three weaknesses found after `f7e26b0` are fixed in software (§7.3): MFA is enforced on the authenticated **session** (FS-1); the web and worker never fall back to a privileged database role (FS-2); the nightly reconciliation is recorded, monitored and its alerts are persisted until acknowledged (FS-10). FS-7 and FS-8 were rehearsed on an isolated copy (results in each check). Not deployed, not migrated in production; nothing posted. **No release condition and no FS check changes status because of it.**

**This is the single operational document.** Supporting material:
- `docs/rta/handover/kfintech-pilot-scheme-codes.csv` — the 118 pilot-scope KFintech scheme codes, with processed and rejected business kept apart.
- `docs/rta/handover/kfintech-pilot-totals.csv` — the reconciliation totals the CSV must add up to (checked by `tests/pilot-handover-csv.test.ts`).
- `scripts/rta-file-manifest.ts` — read-only, no database: the per-file manifest and the daily MFSD201 calendar (§1.3, §5.9).
- `docs/rta/PILOT_PREFLIGHT.md` — the development evidence report.

**Development results are not production outcomes.** Every count in §1 and §4 comes from the real sample files, imported into **isolated development databases** (`rta_handover`, then `rta_final` for the corrections round, built from empty at migration 0242; then `rta_p0` for the final security patch, at migration 0243; then `rta_fs7` for the 0244 patch, built from empty — each with the authentic AMFI file of 07-Oct-2026). Production files, dates and counts will differ; the pilot is judged on its own evidence.

**Final security patch (migration 0243).** The five defects of §7 are fixed in software, not held by process: two-person starts are requests filed and approved by two separately signed-in operators (§5.1, EC-6); the activation names the report types it covers — MFSD211 + MFSD201 for this pilot — and every entry point enforces them (EC-2, §5.4); a legacy row is linked only when every fact, scheme identity included, agrees (EC-1); the Operations dashboard counts rejected instructions and legs separately (§4.1); a parked import is cancelled with an explicit, final status (§5.4).

**How to use this package:**
1. Open one change ticket.
2. For every step, paste the command, its output and the operator's name into the ticket.
3. A condition is PASS only when that evidence is in the ticket.
4. Stop at the first stop condition.

---

## 0. Release pin and operational runbook

**Owner decision (2026-10-10):** the development handover is accepted and operational preflight starts. **Development stays frozen**; a code change needs an actual blocker or defect and a separate approval. **Production deployment, production migration, activation and financial posting are NOT authorized.** No historical repair or client merge is approved. A completed checklist does not authorize deployment (§6).

### 0.1 Pinned release

| Item | Pinned value | How to verify |
|---|---|---|
| Release commit (application code) | `c26e67636f8bbfac3d80eed30152d7ac1af0aa4f` (`c26e676`, branch `claude/relaxed-mendel-01jprq`). Its code is identical to `6590fe5` (migration 0244); `c26e676` changed this document only. | `git rev-parse c26e676^{commit}` prints the full hash above |
| Deployed tree = release code | Commits after `c26e676` may change `docs/` only | `git diff --name-only c26e676 <deployed commit> -- . ':(exclude)docs'` prints nothing |
| Frozen artifact (git content hashes; any change to any file changes them) | whole tree `8ecfbc383b26e4a01ce47ff35d1c5b006bc4e92f`; `src/` `257005dadb838e6ee1952e7c6a6ce17fb01cf068`; `drizzle/migrations/` `73a2b7f56d8a1e4f056ebf4e6628d0ba6a13107a` — `src/` and `drizzle/migrations/` identical to `6590fe5` | `git rev-parse c26e676^{tree} c26e676:src c26e676:drizzle/migrations`; on a deployed checkout, `git rev-parse HEAD:src HEAD:drizzle/migrations` gives the same two values |
| Migration files | **282**, newest `0244_session_mfa_runtime_role_recon_alerts.sql` | `ls drizzle/migrations/*.sql \| wc -l` → 282 |
| Lock file | `drizzle/migrations/checksums.lock.json`, SHA-256 `5a2a3288206ed319006fd18c1d3bd62374d35b885edea7144e2825d7c67438a7` | `sha256sum drizzle/migrations/checksums.lock.json`; `node scripts/check-migration-lock.mjs` → `✓ 282 migrations match` |
| All migration files, concatenated in byte order | SHA-256 `b8a1d6181b0917131e24eaf08d116b9e09e8e05744d8f4064882c9b5ebfb949f` | `(cd drizzle/migrations && LC_ALL=C ls *.sql \| LC_ALL=C sort \| xargs cat \| sha256sum)` |
| `0243_rta_control_requests.sql` | SHA-256 `339fed21516203949eea20e7527cf54f68ca462a442f89d1ff573977b564d935` (lock / ledger value `339fed2151620394`) | `sha256sum <file>` |
| `0244_session_mfa_runtime_role_recon_alerts.sql` | SHA-256 `587632dc121ef3d85aded4b5c198528865096c6efd63b842fd758c917d8b4f28` (lock / ledger value `587632dc121ef3d8`) | `sha256sum <file>` |
| Ledger digest after a full migration (the copy in C, later production) | `7a166d11628bc4325d58e2e73bef1ebc` over 282 rows | `SELECT count(*), md5(string_agg(filename \|\| ':' \|\| checksum, ',' ORDER BY filename COLLATE "C")) FROM _applied_migrations;` (checked on a development database at 0244: 282 · `7a166d11628bc4325d58e2e73bef1ebc`) |

A mismatch anywhere in this table is a stop: the environment is not the reviewed release.

*Correction:* the development reply of 2026-10-09 cited the release as `ee1fd2e`. That hash does not exist; the pushed commit is `c26e676`. **The owner confirmed on 2026-10-10 that the acceptance applies to `c26e67636f8bbfac3d80eed30152d7ac1af0aa4f`; `ee1fd2e` is not a valid release reference.** The acceptance covers the development handover and this runbook only — not deployment, migration, historical repair or posting. Any later code or migration change needs a new review and a new release pin.

**Blocker B-1 (found 2026-10-12): the release candidate does not contain production's current code.** `main` — the branch production deploys — has **36 commits that `c26e676` lacks** (RTA parser fixes, valuation, privacy, a SQL-binding security fix, deploy tooling and the production change lock, Terraform). Their migrations are not the issue: `main`'s 270 files are byte-identical to the release's first 270, and the release adds `0233`–`0244`. Deploying `c26e676` as it is would **remove those 36 changes from production**. A trial merge (`git merge-tree`, nothing written) conflicts in 9 files: `CLAUDE.md`, `src/lib/comms/imap.ts`, `src/lib/finance/aum-persist.ts`, `src/lib/finance/valuation.ts`, `src/lib/rta/import.ts`, `src/lib/rta/kfintech.ts`, `src/lib/rta/parsers.ts`, `src/lib/rta/process.ts`, `src/workers/rta-inbox-poller.ts`. Resolving them is a code change: it needs the owner's separate authorization, a full regression and FS-7 / FS-8 re-run, and a **new** review, pin and tag. Until then: C (migrations — the set is unchanged), A, B, D, E and the production read-only checks may proceed; F part 1 run on `c26e676` is provisional evidence that must be repeated on the reconciled candidate.

**B-1 status (2026-10-12): integrated in development, awaiting the owner's review.** Authorized by the owner ("RTA PRODUCTION BLOCKER B-1: SAFE CODEBASE INTEGRATION"). The reconciled candidate below merges `main` `a16628c5` into the release; report, conflict decisions, regression and real-file reconciliation: `docs/rta/B1_INTEGRATION.md`. Until the owner approves it and a new tag is pushed, **`c26e676` stays the accepted pin and neither commit may be deployed.** Decisions the owner is asked to confirm before approval: I-1 – I-4 in that report (placeholder folio moves held, same-PAN twins held, a folio filed under another client held, headerless files refused).

**B-1 stabilisation (2026-10-12): `f61d202` is superseded by `aab763c4` (§0.1b).** The owner accepted the integration direction for development and asked for stabilisation; `main` meanwhile gained `88bc0178` (client types, migration `0233_client_type_details.sql`), which is now merged too. Evidence A–L: `docs/rta/B1_STABILISATION.md`. Still not accepted, not tagged, not deployable.

**B-1 final qualification (2026-10-14): `aab763c4` (conditionally accepted) is superseded by `d7aa60a8` (§0.1c).** `main` advanced to `f563e7ac` (deployed 2026-10-13, migration `0234_minor_risk_from_guardian`), now integrated; real CI runs every DB-backed test (no skips). Evidence A–K: `docs/rta/B1_FINAL_QUALIFICATION.md`. 

**Owner decision (2026-10-14, "APPROVE FINAL DEVELOPMENT RELEASE CANDIDATE & START OPERATIONAL PREFLIGHT"):** `d7aa60a8` is approved for development release tagging; integrated `main` baseline `f563e7ac`. **Development release qualification: GO. Production deployment and pilot activation: NO-GO.** Development is frozen again: no software change unless a concrete new defect or release-blocking compatibility issue is found; no push to `main` or `deploy/aws`; no deployment of code or Terraform; no production migration; no financial posting. The tag authorizes nothing beyond the tag.

#### 0.1c Approved development release (owner, 2026-10-14) — remote tag pending an authorized maintainer

| Item | Value | How to verify |
|---|---|---|
| Candidate commit (application code) | `d7aa60a8f50b0947e85917b6e11de09fba4a3e08` | `git rev-parse d7aa60a8^{commit}` |
| Contains production and the release | `main` `f563e7ac2cf4e21767e48b28e4e75d47f4d21d5f`, `88bc0178`, `a16628c5` and `c26e676` are ancestors | `for c in f563e7ac 88bc0178 a16628c5 c26e676; do git merge-base --is-ancestor $c d7aa60a8 \|\| echo MISSING $c; done` prints nothing |
| Deployed tree = candidate code | later commits change `docs/` only | `git diff --name-only d7aa60a8 <deployed commit> -- . ':(exclude)docs'` prints nothing |
| Frozen artifact | tree `f0f2bba2852a832d84a30b0f15a7277ad41c14fd`; `src/` `5ef95f6ab8c0e5765ca846b66025d2e2c4ab4d50`; `drizzle/migrations/` `5781e010b734e74dbf191256d72b61c9523716d6` | `git rev-parse d7aa60a8^{tree} d7aa60a8:src d7aa60a8:drizzle/migrations` |
| Migrations | 284 = `main`'s 272 byte for byte + the release's 12; lock SHA-256 `025d640cfb1f88c280641bd1dd9f058d482de6f927b71c375aac798b910c72e8`; concatenation `25a08833c8dbd39f9e3114fbb07016d904177860f29c24ce3bedd434181ed472`; ledger digest `a9bb87a582387db2697310e3e66fa895` fresh and after upgrading a 272-state database | `node scripts/check-migration-lock.mjs` |
| Production ledger check | `docs/rta/handover/b1-production-ledger-check.sql`: `COMPATIBLE · 272 · 12 pending` expected (271 / 270 also compatible); `STOP` on `0240_aum_month_end.sql`, a changed checksum or an applied release file | DBA, read-only |
| Release tag | `rta-kfintech-pilot-candidate-2026-10-14-b1f`, annotated, on `d7aa60a8` — approved 2026-10-14. Created in the development session (tag object `d60979ccbb91810f22f9bcfb58a65d1fa42006b2`, peels to `d7aa60a8`), but **the push of the tag ref was refused by the remote** (`send-pack: unexpected disconnect … the remote end hung up`, 5 attempts; branch pushes from the same session succeed): the session may not create tags. **The remote has no such tag — an authorized maintainer creates it** (§0.1d). `rta-kfintech-pilot-candidate-2026-10-10` stays on `c26e676`, untouched | `git ls-remote origin 'refs/tags/rta-kfintech-pilot-candidate-2026-10-14-b1f*'` → the `^{}` line is `d7aa60a8f50b0947e85917b6e11de09fba4a3e08` |
| Re-verified at approval (2026-10-14) | `origin/main` = `f563e7ac` at verification, 0 of its commits missing from `d7aa60a8`; all five fingerprints above; 284 files = 284 lock entries, lock and concatenation SHA-256 as above, `check-migration-lock` and `check-migration-dups` pass; CI run 305 (`ci.yml`, head `d7aa60a8`) success: DB vitest 1,233 passed / 0 failed / 0 skipped + the separate emergency drill 1 passed; the tag did not exist remotely | `B1_FINAL_QUALIFICATION.md` §A, §E, §H |
| Documentation revision | this handover, `PREFLIGHT_CHECKLIST.md`, `B1_FINAL_QUALIFICATION.md` §L and `docs/rta/handover/*` at the branch head that records this row (docs only after `d7aa60a8`: `git diff --name-only d7aa60a8 <head> -- . ':(exclude)docs'` prints nothing) | `git log --oneline d7aa60a8..origin/claude/relaxed-mendel-01jprq` |
| `main` after approval | **`f086c294`** (2026-10-14 10:17 IST, "the laptop signs in with IAM Identity Center"): `scripts/aws-deploy-role.sh`, `terraform/bootstrap/main.tf`, `CLAUDE.md` only — no `src/`, no migration (still 272). Its "Deploy to AWS (EC2)" run started 04:47 UTC. Trial merge with `d7aa60a8`: no conflict. Not integrated (freeze): the tag stays on `d7aa60a8`; **a deployable artifact must first merge `main`'s head** (else it would put back the retired assume-role deploy script) | `git merge-tree --write-tree --name-only d7aa60a8 origin/main` prints a tree id only |

Valid only if production runs `f563e7ac`, `f086c294` (same application code and migrations) or an ancestor (PR-3 / J1). A later push to `main` must be merged and re-qualified first; `main`'s new migrations must be numbered from 0245.

#### 0.1d Creating the release tag — for an authorized maintainer

The development session could not push the tag (above). A maintainer with tag permission runs, from any clone, nothing else:

```bash
git fetch origin
git cat-file -t d7aa60a8f50b0947e85917b6e11de09fba4a3e08                 # commit
git rev-parse d7aa60a8f50b0947e85917b6e11de09fba4a3e08^{tree}           # f0f2bba2852a832d84a30b0f15a7277ad41c14fd
git ls-remote origin 'refs/tags/rta-kfintech-pilot-candidate-2026-10-14-b1f*'   # must print nothing
git tag -a rta-kfintech-pilot-candidate-2026-10-14-b1f d7aa60a8f50b0947e85917b6e11de09fba4a3e08 \
  -m "AINA CRM KFintech pilot development release (B-1 final). Approved by the owner 2026-10-14. Integrated main f563e7ac. Tree f0f2bba2852a832d84a30b0f15a7277ad41c14fd; 284 migrations, lock sha256 025d640cfb1f88c280641bd1dd9f058d482de6f927b71c375aac798b910c72e8; CI run 305 green. Evidence docs/rta/B1_FINAL_QUALIFICATION.md. NOT authorized for deployment, migration, activation or posting."
git push origin refs/tags/rta-kfintech-pilot-candidate-2026-10-14-b1f
git ls-remote origin 'refs/tags/rta-kfintech-pilot-candidate-2026-10-14-b1f*'   # the ^{} line must be d7aa60a8f50b0947e85917b6e11de09fba4a3e08
git ls-remote origin 'refs/tags/rta-kfintech-pilot-candidate-2026-10-10*'       # unchanged: 2f7aab47… → c26e67636f8bbfac3d80eed30152d7ac1af0aa4f
```

Never `git push --tags`, never `-f`, never touch the 2026-10-10 tag. Record the two `ls-remote` outputs as RV-21 evidence.

#### 0.1b Stabilised candidate (superseded by §0.1c — kept for the record)

| Item | Value | How to verify |
|---|---|---|
| Candidate commit (application code) | `aab763c420466b6a70a3ad62f20530f7a334153f` (`aab763c4`, branch `claude/relaxed-mendel-01jprq`) | `git rev-parse aab763c4^{commit}` |
| Contains production and the release | `main` `88bc0178f8b8bd0eff4f3bbf97492ccf5b98961c`, `a16628c5` and `c26e676` are all ancestors | `for c in 88bc0178 a16628c5 c26e676; do git merge-base --is-ancestor $c aab763c4 \|\| echo MISSING $c; done` prints nothing |
| Deployed tree = candidate code | commits after `aab763c4` may change `docs/` only | `git diff --name-only aab763c4 <deployed commit> -- . ':(exclude)docs'` prints nothing |
| Frozen artifact | whole tree `67c67e834b7e00e055d07076daf0e83ce69f08cb`; `src/` `88816411a6791aea05dbb7723597d7c4e20c9e84`; `drizzle/migrations/` `4a66501e6aa6f6a64724eff26a23687e6cfd872b` | `git rev-parse aab763c4^{tree} aab763c4:src aab763c4:drizzle/migrations` |
| Migrations | 283 files = `main`'s 271 byte for byte + the release's 12 (`0233_rta_staging` – `0244`, unchanged); lock SHA-256 `9a2fb53fbab7967a4dc6f304bcd5ba542a91de0dc7a74d172d6e80581fe3ef49` (one entry added, none changed); concatenation `b2b6d0269139bd1efc3e6b63d55ad09323b1a8336cac88221774634c8c450e23`; ledger digest `eb49785a924cc2e31b2dc4d2e0b2b4f9`, reached both fresh and by upgrading a `main` 88bc0178-state database (271) by 12 files, identical schema | `node scripts/check-migration-lock.mjs`; `git diff --name-status origin/main aab763c4 -- drizzle/migrations/` shows only additions |
| Production ledger check | `docs/rta/handover/b1-production-ledger-check.sql` (read-only): `COMPATIBLE` at 270 + 13 pending or 271 + 12 pending; `STOP` on the reverted `0240_aum_month_end.sql`, a changed checksum or an already-applied release file | run by the DBA (PR-5) |
| Production's own files kept byte for byte | as §0.1a, against `main` `88bc0178` | `git diff --stat 88bc0178 aab763c4 -- terraform .github/workflows/deploy.yml scripts/ssm-deploy.sh scripts/manual-deploy.sh scripts/prod-change.sh scripts/prod-lock.sh src/lib/sql src/lib/observability/log-safe.ts` prints nothing |
| Proposed tag (not created) | `rta-kfintech-pilot-candidate-2026-10-12-b1s`, annotated, on `aab763c4` — only on the owner's approval; `rta-kfintech-pilot-candidate-2026-10-10` stays on `c26e676` | — |

The candidate is valid only if production runs `main` `88bc0178` or an ancestor of it (PR-3). A later push to `main` must be merged and re-qualified first.

#### 0.1a Reconciled candidate (superseded by §0.1b — kept for the record)

| Item | Value | How to verify |
|---|---|---|
| Candidate commit (application code) | `f61d20209a4531c76cd51b9d74dc4cdba0a07387` (`f61d202`, branch `claude/relaxed-mendel-01jprq`) — a merge: first parent `main` `a16628c5ba16d7da3cb222b970c467a54521d220`, second parent the release head `5055a31b` (= `c26e676` + docs) | `git rev-parse f61d202^{commit} f61d202^1 f61d202^2` |
| Contains production and the release | both `a16628c5` and `c26e676` are ancestors | `git merge-base --is-ancestor a16628c5 f61d202 && git merge-base --is-ancestor c26e676 f61d202 && echo ok` |
| Deployed tree = candidate code | commits after `f61d202` may change `docs/` only | `git diff --name-only f61d202 <deployed commit> -- . ':(exclude)docs'` prints nothing |
| Frozen artifact | whole tree `fe9785b45ad04d73071ed12c32731d70be11566d`; `src/` `e9978d26e4fc41ecc8d649089b76c67b0dc3f19c`; `drizzle/migrations/` `73a2b7f56d8a1e4f056ebf4e6628d0ba6a13107a` (**identical to `c26e676`**) | `git rev-parse f61d202^{tree} f61d202:src f61d202:drizzle/migrations` |
| Migrations, lock, concatenated files, 0243 / 0244, ledger digest | **unchanged** — every value in the §0.1 table above holds for the candidate (282 files; lock `5a2a3288…38a7`; concatenation `b8a1d618…949f`; ledger `7a166d11628bc4325d58e2e73bef1ebc`, also reached by upgrading a `main`-state database by its 12 pending files) | `git diff --quiet c26e676 f61d202 -- drizzle/ && echo identical`, then the §0.1 commands |
| Production's own files kept byte for byte | `.github/workflows/deploy.yml`, deploy / change-lock scripts, `terraform/`, `src/lib/sql/`, `log-safe.ts` equal `main`'s | `git diff --stat a16628c5 f61d202 -- terraform .github/workflows/deploy.yml scripts/ssm-deploy.sh scripts/manual-deploy.sh scripts/prod-change.sh scripts/prod-lock.sh src/lib/sql src/lib/observability/log-safe.ts` prints nothing |
| Proposed tag (not created) | `rta-kfintech-pilot-candidate-2026-10-12-b1`, annotated, on `f61d202` — created only on the owner's approval; `rta-kfintech-pilot-candidate-2026-10-10` stays on `c26e676` | — |

The candidate is valid only if production runs `a16628c5` (PR-3). If production runs anything else, the integration is repeated against it.

*Verified against the pinned commit's own git objects (2026-10-10):* the commit exists on `origin/claude/relaxed-mendel-01jprq`; its only difference from `6590fe5` is this document; 282 migration files, 282 lock entries, 0 checksum mismatches, no lock entry without a file, newest `0244_…`; the lock-file, concatenated-files, 0243 and 0244 SHA-256 and the ledger digest are the values in the table above.

### 0.2 Rules that hold for every step

1. **Restricted credentials first (FS-2).** Before any deployment attempt — production or the copy's application — every web and worker host has `APP_DATABASE_URL` naming the restricted application role, and **no** `DATABASE_URL` with the migration role and no `DB_TOOLING` in its environment. Migration credentials live only with the DBA's migration tooling. The web and worker each log `database role '<role>' verified` at start. Record the §2.1 role output and both start lines.
2. **Isolated copy only.** Migration rehearsals (C), reversal and undo tests (§5.6), failure simulations (the broken ledger row, Redis stop, worker kill, EMERGENCY drill, cancel drill — FS-8), the dry run (F part 1) and the alert test run on the **authorized isolated production copy**, never on the live financial database. Before each such step, paste `SELECT current_database(), inet_server_addr(), now();` and the copy's authorization reference into the ticket. **Stop** if it names the production database or server.
3. **The alert test is the scheduled path.** EC-5 / FS-10 pass only with: a `schedule` or `catch_up` row in `rta_reconciliation_runs` with status `discrepancy`; its `ops_alerts` row `delivered` with its `ops_alert_deliveries` attempts; and an acknowledgement by the named on-call monitoring owner through `POST /api/super-admin/ops-alerts` from their own MFA session. Running the `reconcile` CLI alone does not count.
4. **KFintech-only scope.** The activation is `registrars: ["kfintech"]`, `reportCodes: ["MFSD211","MFSD201"]`, 14-day expiry. Report definitions (§1.1, checked against the code's layout definitions in `lib/rta/staging/layouts.ts`: MFSD201 `transaction`, MFSD211 `master`, MFSD203 `holding`, MFSD243 `registration`): **MFSD201 = Transactions · MFSD211 = Investor Master · MFSD203 = Holdings · MFSD243 = Systematic registrations (SIP / STP / SWP)**; MFSD230 (instalment status) is also out of scope. No CAMS file is imported. Unresolved schemes, identity and ownership exceptions and every other held record **stay held**; a held item is released only by its documented decision (B, E), never to make a count clean.
5. **Evidence standard.** Every entry in the ticket carries: who ran it; the UTC and IST start and end times; the host and database (`current_database()`, never a password or connection string with credentials); the exact command; its complete output; and the exit code. Logs are masked (no PAN, client name, phone, email, token, session id or credential) — the CRM masks PANs in its own messages; anything pasted from elsewhere is masked by hand. Store: the §0.1 checksum outputs, every reconcile output, the database query outputs, the control-request ids with their `payloadHash`, and the signed approvals. Evidence that cannot be produced is a FAIL, not a pass.
6. **A failure is returned, not worked around.** Record it with its evidence, mark the condition FAIL, stop, and return it for review.
7. **Nothing reaches the production deploy path.** `.github/workflows/deploy.yml` deploys every push to `main` or `deploy/aws` to the production instance and runs the migrations (build → migrate → schema guard → blue-green). `scripts/manual-deploy.sh <commit>` does the same for any commit. Until deployment is authorized: no push or merge of the release into `main` or `deploy/aws`, and never `manual-deploy.sh` with the release tag or commit. Any AWS change for the preflight (the restore in C, a security group) first takes the production change lock (`scripts/prod-change.sh acquire …` on a `main` checkout) and releases it after its checks.

### 0.3 Run-sheets by role

The same steps as one executable table (command, role, environment, expected result, evidence, risk, stop condition, status) with the production resource names from the repository's Terraform and deploy files: `docs/rta/PREFLIGHT_CHECKLIST.md`. Where the two differ, this document governs.

Each line names the section with the exact commands, expected results and stop conditions. Run in this order; a later step uses the earlier one's output.

**DBA**
1. §0.1: verify the pinned commit, lock file and checksums on the deployment checkout.
2. **C** — restore the authorized backup into a new isolated instance; `check-migration-lock.mjs`, `migrate-all.ts --check`, `migrate-all.ts`, `check:rls`, `check:schema`; the newest is `0244_…`; the §0.1 ledger digest equals `7a166d11…` over 282 rows.
3. **FS-2** (database half) — role flags, ownership, memberships, `session_replication_role`, forced RLS (§2.5); provision the restricted role on the copy (`db:provision-app-role`).
4. **FS-3** (database half) — named holders of privileged access, their logging.
5. **FS-4** step 1 — the activation, kill-switch and starts-without-request queries.
6. **E** — `rta-historical-diagnostics.ts` and `scheme-master-duplicates.ts` on the read replica; **EC-1** step 1; **FS-7** step 1 (`count(*) FROM rta_posted_transactions` = 0 in production).
7. **F part 1** (with platform operator 1, on the copy) — the dry run, **EC-1** steps 2–3, **FS-7** step 2 (the breakdown query), every `reconcile` = 0.
8. **FS-1** step 3 — the four session / audit queries for both operators (with the compliance reviewer).
9. §5.6 / §5.7 on the copy — reversal dry run, a two-person reversal and undo, reconcile 0 after each.

**Infrastructure engineer**
1. §0.2 rule 1 — `APP_DATABASE_URL` on every web and worker host, no migration credentials there; both start lines.
2. **D1** S3 posture and synthetic put / get / delete; **D5** the PAN-token key only in the secret store.
3. **D2 / EC-4** — authenticated registrar mail header; a non-registrar mail quarantined; **FS-6** mail for the pilot firm stopped.
4. **D3** — Redis persistence; restart Redis then the worker; an upload with Redis stopped answers 503 and makes no job; **FS-8** on the copy (with platform operator 1).
5. **D6** — backup retention, PITR, C's restore time.
6. **D7 / EC-5 / FS-10** — `OPS_ALERT_WEBHOOK_URL` and `OPS_ALERT_ESCALATION_WEBHOOK_URL` on worker and web; `OPS_HEARTBEAT_URL` on the worker with its dead-man's switch armed; an external uptime check on `GET /api/health/rta-reconciliation` (`OPS_MONITOR_TOKEN`); the worker log line `reconciliation daily at 06:30 Asia/Kolkata`; the scheduled-alert test (§0.2 rule 3); worker stopped > 10 min → 503 and a page.
7. **FS-1** step 4 — access-log corroboration of each operator session (paths, status, times; no cookies).
8. **FS-3** (hosts) and **FS-4** step 3.

**Platform operator 1** — A (first download), B, F part 1 (with the DBA), FS-4 step 2, FS-5, FS-8, FS-9; the §5.3 emergency halt and release drill on the copy; files every start request.
**Platform operator 2** — A (second download); reviews and approves start requests from a different MFA session.
**Compliance reviewer** — reviews and signs E, F, FS-1, FS-3, FS-4, FS-5, FS-7, the held-item decisions and §6.
**On-call monitoring owner** — receives and acknowledges the test alert (EC-5 / FS-10); owns the uptime and heartbeat alerts for the 14 days.

---

## 1. Pilot file manifest

### 1.1 Report codes (KFintech Distributor Services manual; checked against the files' own headers)

| Report | What it is | Pilot role | Import order |
|---|---|---|---|
| **MFSD211** | Investor Master | **required** — folio owners on record | **first** |
| **MFSD201** | Transactions | **required** — the transactions | **second** |
| MFSD203 | Holdings | **not in pilot scope** | — |
| MFSD243 | Systematic registrations (SIP / STP / SWP) | **not in pilot scope** | — |
| MFSD230 | SIP instalment status | **not in pilot scope** | — |

**The pilot validates transactions only.** Optional MFSD203 or MFSD243 imports must not be used to claim that holdings, AUM, the SIP Book, the SIP Master or any other module has been validated.

### 1.2 Files used in the development rehearsal (the sample manifest)

| # | Report | Masked file identifier | SHA-256 | Data rows | Dates in the file |
|---|---|---|---|---|---|
| 1 | MFSD211 | `MFSD211_WBMST87*****_10*****_2.csv` | `8a5f06685133747a9ffba0f78e6d6a03d07e15813be43e5d442b5ea5e1559452` | 648 | Report Date 18-May-2026 |
| 2 | MFSD211 | `MFSD211.csv` (renamed by the uploader) | `ed905fdc110543e87c8d8a1e3ba61a185ef88dbf3d9af698c5f48082acfb881f` | 384 | Report Date 08-Oct-2026 |
| 3 | MFSD201 | `MFSD201_WBTRN28******_69****_2.csv` | `14948afbfe0cda101ee9e15a1712f1b4e9751187bd5b6ed7b95c679b62c3a9de` | 819 | Transaction Date 30-Apr → 15-May-2026; Report Date 18-May-2026 |
| 4 | MFSD201 | `MFSD201.csv` (renamed by the uploader) | `d5fdf75029390fd372a8ce8c1af99190ba93e339d6de7974017ce5772628fe85` | 689 | Transaction Date 29-Jan-2024 → 07-Oct-2026 (pre-October dates are folio-consolidation re-reports); Report Date 08-Oct-2026 |

**ARN in the sample:** every row of all four files carries one distributor code, masked `ARN-****04` (Broker Code in MFSD211, Agent Code in MFSD201).

### 1.3 Pilot ARN and coverage requirements (the production manifest)

| Requirement | Check |
|---|---|
| **One ARN.** The pilot ARN is the firm's own, recorded on the sign-off sheet (§6). Every file's Agent / Broker Code must equal it | Count the distinct codes per file. A file with any other code is out of scope; do not import it |
| **MFSD211 covers every folio the pilot's MFSD201 rows touch** | One full-book MFSD211 at the start, then each day's MFSD211. A transaction on a folio missing from MFSD211 is held (`owner_not_on_record`), never posted — that is safe, but it is a coverage gap to report |
| **One MFSD201 delivery for every KFintech business day of the 14-day window** | Judged from each delivered file's **own Report Date** with `npx tsx scripts/rta-file-manifest.ts <files…> --calendar <start> <end>`. Every weekday is `present` or recorded as a registrar holiday / a gap confirmed with KFintech. **Never** inferred from the span of Transaction Dates: one file can carry many trade dates (the October sample spans 29-Jan-2024 → 07-Oct-2026 in one file), and a day with no file has none at all |
| **No CAMS file and no other report type** | Enforced by the software since the final security patch: the activation names `registrars: ["kfintech"]` and `reportCodes: ["MFSD211","MFSD201"]`; a CAMS, MFSD203, MFSD243 or MFSD230 file is refused at every entry point and recorded `blocked`, nothing staged or posted (§5.4). Controls kept: the firm's mail alias is inactive for the pilot (EC-4 step 4), uploads come from the signed inventory, and the daily check (§5.9 #2) shows nothing else |
| **Every file recorded before import** | `npx tsx scripts/rta-file-manifest.ts <file> --arn <pilot ARN>` output in the ticket: report code, SHA-256, data rows, Report Date, Transaction Date range, masked ARN. Exit 2 = an unexpected ARN or an unrecognised file — do not import |

### 1.4 The 118 pilot-scope KFintech scheme codes

The full list is `docs/rta/handover/kfintech-pilot-scheme-codes.csv`. For each code it gives:
- the registrar AMC and code, status and reason;
- the registrar's ISIN;
- the AMFI code, name, AMC and NAV date;
- the reports it appears in;
- `registrar_transactions` (economic records in the files) and `recorded_transactions` (CRM rows in the posting ledger);
- **`processed_transactions` / `processed_amount_inr`** — successful business only;
- **`rejected_transactions` / `rejected_gross_leg_amount_inr`** — refused instructions recorded as rejected, 0 units, never business; split by leg role (`rejected_sip_instalments`, `rejected_stp_source_legs`, `rejected_stp_destination_legs`);
- **`rejected_instructions_counted_here` / `rejected_instruction_amount_inr`** — each failed instruction once: a SIP instalment on its scheme, a failed STP on its SOURCE scheme only (its two legs share the registrar's switch reference), so the destination leg is never counted again;
- the first and last processed trade date.

**Totals (verified against the posting ledger of the isolated rehearsal, not only against expectations):**

| Figure | Value |
|---|---|
| `recorded_transactions` | **1,076** |
| `processed_transactions` / `processed_amount_inr` | **1,073** / **₹1,02,27,740.48** |
| `rejected_transactions` / `rejected_gross_leg_amount_inr` | **3 legs** / **₹12,000.00** |
| Rejected instructions / instruction amount | **2** (1 SIP instalment ₹2,000 + 1 STP ₹5,000) / **₹7,000.00** |
| Ledger rows with any other status | 0 |

The previous version of the CSV had one `posted_transactions` column (1,076; ₹1,02,39,740.48) that added the ₹12,000 of rejected legs to successful business. It is replaced; no database record was changed to correct it.

Summary:

| | Codes | Detail |
|---|---|---|
| **Seen in the sample manifest** | **118** | 20 KFintech AMCs; 115 appear in both MFSD201 and MFSD211, 3 only in MFSD211 |
| **Mapped** (`resolved_isin`, reason `isin_verified`) | **114** | Each by the registrar's own ISIN to exactly one AMFI scheme; every AMFI NAV is dated 07-Oct-2026 (none historical); 112 of them carry posted transactions |
| **Unresolved** | **4** | listed below; none has a posted transaction |

| Unresolved code | Reason | Registrar ISIN | In | Registrar transactions | Effect |
|---|---|---|---|---|---|
| `120DEGP` | `isin_not_in_feed` — the registrar printed an ISIN the 07-Oct AMFI file does not carry | `INF205KA1CD5` | MFSD201 + MFSD211 | 1 (registrar type `IPO`, 06-Oct-2026, ₹99,995) | held; also an unknown transaction code (§1.5) |
| `120RGGP` | `no_isin` | — | MFSD211 only | 0 | nothing to post |
| `127DFGP` | `no_isin` | — | MFSD211 only | 0 | nothing to post |
| `185SCRG` | `no_isin` | — | MFSD211 only | 0 | nothing to post |

### 1.5 Financial exclusions and held-event counts (development)

| Category | Registrar transactions | Source rows | Amount | Posted? |
|---|---|---|---|---|
| Folio-consolidation corrections | **18** | 99 | ₹1,47,868.30 | no — held, no posting path |
| Unknown transaction codes | **6** | 8 | ₹5,43,384.29 | no — held until registrar documentation |
| Refused instructions | **2 instructions = 3 legs** | 3 | ₹7,000 per instruction; ₹12,000 gross over the legs | recorded as **rejected**, 0 units, never business |
| Transactions on an unresolved scheme | 1 (the `120DEGP` event, counted once under unknown codes) | — | ₹99,995 | no |
| CAMS files | all | — | — | refused whole by the activation scope |
| Holdings / AUM, SIP registrations | — | — | — | out of pilot scope; no claim |

**The 18 corrections**, one held event each:
- 16 × `166QMGP`, registrar types `SIN` + `SINR`: one per month, 29-Jan-2024 → 12-May-2025, ₹1,499.93 each, 3 rows each;
- 1 × `166QMGP`, `FUL` + `FULR`, 02-Jun-2025, ₹23,874.42, 48 rows (a lot-by-lot redemption);
- 1 × `166IBGP`, `NEW` + `NEWR`, 18-Aug-2026, ₹99,995, 3 rows.

Each is an original, its exact reversal and a re-post into the surviving folio.

**The 6 unknown-code events:**

| Registrar type | Scheme | Date | Rows | Amount |
|---|---|---|---|---|
| `LTOF` | `125SCGP` | 01-Oct-2026 | 3 | ₹4,43,389.29 |
| `CNI` | `166IBGP` | 01-Oct-2026 | 1 | ₹0 |
| `CNO` | `166IBGP` | 01-Oct-2026 | 1 | ₹0 |
| `CNI` | `166QMGP` | 01-Oct-2026 | 1 | ₹0 |
| `CNO` | `166QMGP` | 01-Oct-2026 | 1 | ₹0 |
| `IPO` | `120DEGP` | 06-Oct-2026 | 1 | ₹99,995 |

No meaning is assigned to these codes without a registrar document.

**The 2 refused instructions (3 recorded legs):**

| Instruction | Leg | Registrar type | Scheme | Direction | Date | Leg amount | Units |
|---|---|---|---|---|---|---|---|
| 1. failed SIP instalment (₹2,000) | the instalment | `SIND` | `166HYGP` → AMFI 104513 | inflow | 11-May-2026 | ₹2,000 | 0 |
| 2. failed STP (₹5,000) | source leg | `STPOD` | `176ABRG` → AMFI 149552 | outflow | 04-May-2026 | ₹5,000 | 0 |
| | destination leg | `STPAD` | `176MGGP` → AMFI 149667 | inflow | 04-May-2026 | ₹5,000 | 0 |

The two STP legs share one registrar switch reference: one instruction of ₹5,000, not two of ₹5,000. The SIP instalment also created one SIP-rejection record. None stops a SIP.

---

## 2. Safe preflight commands

**Conventions:**
- `$PROD_RO` — a read-only connection to production or a read replica, opened with `PGOPTIONS='-c default_transaction_read_only=on'`.
- `$COPY_ADMIN` / `$COPY_APP` — the isolated copy, as its owner role and as the application role.
- `$PROD_APP_RO` — production (or the replica) as the application role, read-only.
- `<firm>` — the pilot firm's tenant id.

Run every command from the repository at the release commit. **Never put a password, PAN or session cookie in the ticket.**

### 2.1 SAFE — read-only inspection (production read replica or the copy)

Each was run on the isolated rehearsal database and wrote **0 rows** (measured by `pg_stat_user_tables` before and after).

**Production is not yet at 0244.** Production deploys from `main`, whose newest migration is `0232_physical_rta_route.sql`. Until the release is migrated there, every table added by `0233`–`0244` is absent in production: `amfi_feed_imports`, `scheme_rta_codes`, `registrar_amc_identity`, `rta_pipeline_activations`, `rta_posting_controls`, `rta_posted_transactions`, `rta_control_requests`, `rta_reconciliation_runs`, `ops_alerts` and the `rta_staging_*` tables. A production query on one of them answers `relation … does not exist`: record it as the expected pre-migration state (for FS-7 step 1 it means no ledger rows), not as a failure, and run the query on the migrated copy (C) instead.

| Purpose | Command | Expected |
|---|---|---|
| AMFI file integrity | `sha256sum NAVAll.txt` (on each of the two downloads) | same business date ⇒ same hash |
| AMFI file validation | `DATABASE_URL=$COPY_ADMIN ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --check` | exit 0; `layout: current8`; `errors: []`; `feedDate` = the business date, ≤ 7 days old; `conflictingDuplicates: 0`. Rehearsal: feedDate 2026-10-07, 14,357 schemes, 14,116 with NAV, errors [] |
| Applied AMFI file | `psql "$PROD_RO" -Atc "SELECT feed_date, sha256, schemes, written, status FROM amfi_feed_imports ORDER BY imported_at DESC LIMIT 1"` | the hash recorded at A |
| KFintech mapping | `psql "$PROD_RO" -Atc "SELECT status, reason_code, count(*) FROM scheme_rta_codes WHERE tenant_id = '<firm>' AND rta = 'kfintech' GROUP BY 1, 2"` | every resolved code is `isin_verified` / `isin_verified_historical` |
| KFintech AMC identities | `psql "$PROD_RO" -Atc "SELECT basis, status, count(*) FROM registrar_amc_identity WHERE rta = 'kfintech' GROUP BY 1, 2"` | basis `isin` only |
| Migration file checksums | `node scripts/check-migration-lock.mjs` | `✓ 282 migrations match checksums.lock.json.` |
| Migration ledger vs files | `DATABASE_URL=$COPY_ADMIN npx tsx scripts/migrate-all.ts --check` | `0 blockers`; lists pending files. On a copy of a production database at `0232`: 270 applied, **12 pending** (`0233` – `0244`) before C's apply; `282 applied, 0 pending` after. Development from empty: `282 applied, 0 pending, 0 acknowledged drift, 0 blockers` |
| RLS coverage | `DATABASE_URL=$COPY_ADMIN npm run -s check:rls` | `✓ all 189 tenant-scoped table(s) have RLS enabled + forced + tenant_isolation policy` (development at 0244) |
| Schema parity | `DATABASE_URL=$COPY_ADMIN npm run -s check:schema` | `✓ Schema guard: 199 ORM tables, every modelled column present in the DB.` (development at 0244) |
| Application role | `psql "$PROD_RO" -Atc "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '<app role>'"` | `<app role>\|f\|f` |
| Role owns nothing | `psql "$PROD_RO" -Atc "SELECT count(*) FROM pg_tables WHERE tableowner = '<app role>'"` | `0` |
| Web and worker connect as that role | on each host: `node -e 'const v=process.env.APP_DATABASE_URL; if(!v){console.log("APP_DATABASE_URL UNSET");process.exit(1)} const u=new URL(v);console.log(u.username,u.hostname,u.pathname)'` | `<app role>`, the production host and database; no password printed. `UNSET` is a stop: since 0244 the web and worker refuse to start without it (FS-2) |
| Worker sees itself as non-superuser | `psql "$PROD_APP_RO" -Atc "SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)"` | `<app role>\|f\|f` |
| Posting controls | `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts status --tenant <firm>` | before F: no activation, or paused; global halt installed |
| Every firm's latest activation | `psql "$PROD_RO" -Atc "SELECT DISTINCT ON (tenant_id) tenant_id, mode, posting_enabled, registrars, expires_at FROM rta_pipeline_activations ORDER BY tenant_id, created_at DESC"` | no firm with posting enabled before F |
| Kill switches | `psql "$PROD_RO" -Atc "SELECT scope, posting_halted, reason, changed_at FROM rta_posting_controls"` | `global` halted before F; `emergency` absent or released |
| Historical identity diagnostics | `DATABASE_URL=$PROD_APP_RO ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-historical-diagnostics.ts --tenant <firm> --json diag.json` | exit 0; runs in a READ ONLY transaction; masked output only |
| Scheme Master duplicates | `ALLOW_SYSTEM_TX=1 npx tsx scripts/scheme-master-duplicates.ts --tenant <firm>` | exit 0; ends `Nothing was changed.` |
| Reconciliation (any time) | `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts reconcile --tenant <firm>` | exit 0, `reconciled: every check is 0`; **exit 3** = failure (§5.5) |
| Import queue state | `redis-cli -u "$REDIS_URL" --no-auth-warning ZCARD bull:rta.import:delayed` · `LLEN bull:rta.import:wait` · `LLEN bull:rta.import:active` · `ZCARD bull:rta.import:failed` | counts only |
| Import rows held | `psql "$PROD_RO" -Atc "SELECT status, count(*) FILTER (WHERE remarks LIKE 'Held%') held, count(*) FROM rta_file_imports WHERE tenant_id = '<firm>' GROUP BY 1"` | — |
| Redis persistence | `redis-cli -u "$REDIS_URL" --no-auth-warning INFO persistence` (and `CONFIG GET appendonly` where the provider allows `CONFIG`) | `aof_enabled:1`, or RDB snapshots per the provider's policy |
| S3 bucket posture | `aws s3api get-bucket-encryption --bucket "$S3_BUCKET"` · `aws s3api get-public-access-block --bucket "$S3_BUCKET"` · `aws s3api get-bucket-policy --bucket "$S3_BUCKET"` · `aws s3api get-bucket-versioning --bucket "$S3_BUCKET"` | encryption on; all four public-access blocks `true`; no public principal |
| S3 anonymous read refused | `curl -s -o /dev/null -w "%{http_code}\n" "https://$S3_BUCKET.s3.$AWS_REGION.amazonaws.com/tenants/<firm>/rta/<an existing key>"` | `403` |
| Mail routing configuration | on the worker host: `env \| grep -E '^RTA_INBOX_(HOST\|PORT\|USER\|SECURE\|DOMAIN)=' \| sed 's/=.*@/=***@/'` · `psql "$PROD_RO" -Atc "SELECT count(*) FROM rta_forward_addresses WHERE tenant_id = '<firm>'"` | inbox configured; the firm has its alias |
| SES identities (if SES receives the mail) | `aws ses describe-active-receipt-rule-set` · `aws sesv2 get-email-identity --email-identity <receiving domain>` | the rule delivers to the RTA inbox; DKIM `SUCCESS` |
| Alert sink configured | on the worker and web hosts: `env \| grep -cE '^(OPS_ALERT_WEBHOOK_URL\|OPS_ALERT_ESCALATION_WEBHOOK_URL\|OPS_HEARTBEAT_URL\|OPS_MONITOR_TOKEN)='` (counts only, never values) | `4` on the worker (`OPS_HEARTBEAT_URL` is the worker's), at least `3` on web. With none set, alerts are only recorded in `ops_alerts` and the health endpoint answers 503 (FS-10) |
| Alerts already raised | `psql "$PROD_RO" -Atc "SELECT at, after FROM audit_log WHERE tenant_id = '<firm>' AND action = 'rta.posting.reconcile_alert' ORDER BY at DESC LIMIT 5"` | none before the pilot |
| Backups (RDS example; use the provider's equivalent) | `aws rds describe-db-instances --db-instance-identifier <id> --query 'DBInstances[0].{Retention:BackupRetentionPeriod,LatestRestorable:LatestRestorableTime}'` | retention ≥ the agreed period; latest restorable within minutes |

### 2.2 ISOLATED COPY ONLY — these write, but only to the authorized copy

Each was rehearsed on `rta_handover`. Run them only with `DATABASE_URL` / `ADMIN_DATABASE_URL` naming the copy, and `RTA_POSTING_DATABASE=<copy name>`.

| Purpose | Command |
|---|---|
| Apply pending migrations | `DATABASE_URL=$COPY_ADMIN npx tsx scripts/migrate-all.ts` |
| Apply the AMFI file | `DATABASE_URL=$COPY_ADMIN ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --note "downloaded <UTC> by <name>; second download by <name>, sha256 <…>"` |
| Activate the pilot firm on the copy | the §5.1 request (operator 1, signed in) and approval (operator 2, signed in) against the copy's app |
| Import the manifest | upload through the copy's app (`/dashboard/rta-imports`), with the copy's web and worker processes, a **non-production** S3 bucket and Redis. Order: MFSD211, then MFSD201 |
| Deliberate failure, for the alert test | break one ledger row on the copy only, then let the copy's scheduled reconciliation run. There is one scheduled run per IST date, so either break the row before the copy's worker first starts that IST day (the monitor then runs the day's slot at start — after 06:30 IST as a `catch_up`, with a `missed` warning as well), or, on a day whose slot has not run yet, set `RTA_RECON_TIME_IST` on the **copy's** worker a few minutes ahead (`HH:MM`, IST) and restart it. Confirm `rta_reconciliation_runs` shows `discrepancy` and the alert arrives (FS-10). The `reconcile` CLI (§2.1) only confirms the counts (exit 3) — it raises no alert |

### 2.3 MODIFIES AN ENVIRONMENT — not part of the preflight; only with written authorization

| Action | Who | Where |
|---|---|---|
| `migrate-all.ts` (apply), `amfi-import.ts` (apply) on production | DBA / operator | production — after F only |
| Activation, release of a kill switch | two platform operators, each signed in: a request, then a DIFFERENT operator's approval (§5.1) | production — F only |
| Halt, pause, emergency (§5) | one platform operator | production — at any time, to stop |
| Reversal and undo of a batch (§5.6) | two platform operators, each signed in: `reverse` / `undo` requests (§5.1). The CLI cannot commit either | production — recovery only |
| S3 synthetic put / get / delete under `tenants/<firm>/rta/preflight-…` | infra engineer | production bucket — D1 |
| Test mails from a registrar domain and from a non-registrar domain | infra engineer | the live inbox — D2 (creates import records) |
| Redis and worker restart | infra engineer | production — D3, in an agreed quiet window |
| Point-in-time restore into a NEW instance | DBA | production account — C (creates a resource; never restore over production) |
| Cancelling an unapproved parked import (EC-2) | one platform operator, signed in, with the firm halted: `cancel_import` (§5.4) | production — only for an import NOT on the approved inventory |
| Stopping RTA mail for the pilot firm (EC-4 step 4) | the firm pauses its own mailbox forwarding rule; or the DBA, under the ticket, runs `UPDATE rta_forward_addresses SET is_active = false WHERE tenant_id = '<firm>' AND is_active` (the app has no "deactivate" button; re-enabling after the pilot is "regenerate address" in Settings) | production — before F part 2 |

### 2.4 Evidence checks added in the corrections round (EC-1 – EC-6)

Each is part of a release condition (named in brackets). Every SQL here is read-only. Run it with `PGOPTIONS='-c default_transaction_read_only=on'`.

**EC-1 — Existing legacy-imported transactions: idempotent matching and collision handling** *(E, and F part 1 on the production copy)*

Before activation, a firm's existing transactions came from the legacy importer. When validate-first meets the same registrar transaction number, it **links** the existing row (`matched_existing`) only when **every** fact agrees (`lib/rta/posting/legacy-match.ts`, final security patch):
- the registrar (of the folio the row is filed under), the client, the AMC (or a registrar AMC code verified as its successor), the folio;
- the **scheme identity**: the registrar's own product code, or the AMFI code an approved mapping gives it, or another code of the same registrar that an approved mapping ties to the same AMFI scheme (a historical identifier). With the mapping unresolved or in conflict, only the registrar's own code can prove the scheme — an AMFI code on the CRM row is then unverifiable and the transaction is held;
- the date, the transaction type, the direction, the status (processed, or rejected for a refusal), the amount and the units.

Otherwise it **holds** it: `quarantined`, reason `identity_conflict: … (differs in: <the facts>)`, shown on the Held screen with the next step. Neither row is ever changed; nothing is merged.

1. **Before** (production read replica):
   ```sql
   SELECT coalesce(source_feed, 'legacy') AS source, status, count(*), min(order_date), max(order_date)
     FROM transactions WHERE tenant_id = '<firm>' GROUP BY 1, 2 ORDER BY 1, 2;
   SELECT count(*) FROM (SELECT amc_code, order_id FROM transactions WHERE tenant_id = '<firm>' GROUP BY 1, 2 HAVING count(*) > 1) z;  -- expect 0
   SELECT count(*) FROM transactions WHERE tenant_id = '<firm>' AND order_id ~ '^(cams|kfintech|kfin)_[0-9]+$';            -- line-keyed rows (E diagnostics)
   ```
2. **On the copy, after F part 1's imports:**
   ```sql
   WITH l AS (SELECT DISTINCT ON (identity_key) * FROM rta_staging_economic_txns
               WHERE tenant_id = '<firm>' AND rta = 'kfintech' AND posting_outcome IS NOT NULL ORDER BY identity_key, created_at DESC)
   SELECT posting_outcome, split_part(coalesce(posting_reason, ''), ':', 1) AS why, count(*), round(sum(abs(coalesce(reported_amount, 0))), 2)
     FROM l GROUP BY 1, 2 ORDER BY 1, 2;
   -- cross-check (the matcher itself now compares scheme identity, so this must be 0 by construction)
   SELECT count(*) FILTER (WHERE t.scheme_code IS DISTINCT FROM e.scheme_code AND t.scheme_code IS DISTINCT FROM c.amfi_scheme_code) AS scheme_differs,
          count(*) FILTER (WHERE c.status IS DISTINCT FROM 'resolved_isin') AS on_unresolved_code
     FROM rta_posted_transactions p JOIN transactions t ON t.id = p.transaction_id JOIN rta_staging_economic_txns e ON e.id = p.economic_txn_id
     LEFT JOIN scheme_rta_codes c ON c.tenant_id = p.tenant_id AND c.rta = 'kfintech' AND c.rta_amc_code = e.amc_code AND c.rta_scheme_code = e.scheme_code
    WHERE p.tenant_id = '<firm>' AND p.kind = 'matched_existing';
   ```
3. Re-run the §5.7 fingerprint over the legacy rows (`source_feed IS NULL`) before and after: it must not change.

**Expected:**
- `matched_existing` + `posted` + `rejected_recorded` + held = the copy's economic records.
- `scheme_differs` = 0. `on_unresolved_code` lists matched legacy rows whose registrar code is still unresolved (linked on the registrar's own code); each has a written decision (in the rehearsal: 0).
- Every `identity_conflict` has a written decision, investigated against the registrar file — never "fixed" by editing either row.
- The legacy fingerprint is unchanged.
- No registrar number appears twice.

**Rehearsed again with the scheme-aware matcher (`rta_p0`, security patch), legacy then validate-first on the same four files:**
- The legacy importer (`scripts/import-rta-local.ts --commit`, the legacy engines) wrote 1,061 rows: 1,058 processed (₹81,38,526.51) + 3 rejected legs (₹12,000.00). It held the 15 lot-by-lot redemptions back. Its rows carry the KFintech product code in `scheme_code`.
- The firm was activated by two signed-in operators (request + approval) for `kfintech`, `MFSD211 + MFSD201`.
- Validate-first then linked **1,061** as `matched_existing` — every fact including the scheme agreed — and wrote only the **15** multi-lot redemptions. It held the same 18 corrections and 6 unknown codes. **`identity_conflict`: 0.**

  | Ledger (1,076) | Linked to the legacy row | Newly inserted by validate-first | Total |
  |---|---|---|---|
  | Processed | **1,058** · ₹81,38,526.51 · 0 multi-lot | **15** · ₹20,89,213.97 · all 15 multi-lot (340 lots) | **1,073** · ₹1,02,27,740.48 |
  | Rejected legs | **3** · ₹12,000.00 | **0** | **3** · ₹12,000.00 (2 instructions, ₹7,000.00) |

  Why 1,061 + 15 = 1,076, and 1,073 processed: the legacy firm already held 1,058 processed + 3 rejected = 1,061 of the 1,076 registrar transactions; the only ones it lacked are the 15 multi-lot redemptions it holds back. 1,058 + 15 = 1,073 processed; the 3 rejections are the legacy firm's own 3 rows, linked, not re-inserted. A clean firm with no legacy rows (`rta_p0`, firm P) inserts all 1,073 + 3 itself, to the same totals.
- Ledger 1,076; 0 numbers twice; reconcile 0 (all five counts); a second pass posted nothing (`already_posted` 685 + 391, the cross-tab unchanged).
- **Same number, different scheme** (`tests/rta-legacy-match-db.test.ts`): a legacy row under the same registrar number but another scheme is held `identity_conflict … (differs in: scheme)`, the legacy row unchanged and nothing written; so are a different client, type, AMC, folio, date, direction, status, amount or units, and an AMFI code an approved mapping does not name. A historical registrar code tied by an approved mapping to the same AMFI scheme is linked.
- **Collision drill:** two legacy rows altered on the copy (one amount + ₹1, one date − 1 day). Both were held as `identity_conflict`; the legacy rows were byte-identical afterwards (hash unchanged); nothing was duplicated; reconcile 0.
- **Note:** matched legacy rows keep their legacy scheme code (the registrar product code) and get no AMFI code — no historical repair is done. They are legacy records, not pilot outcomes. B's query (ii) counts only `source_feed = 'rta_validate_first'`.

**Stop if:** any number appears twice; `scheme_differs` ≠ 0; an `on_unresolved_code` row without a written decision (the registrar's own code matched but its AMFI mapping is unresolved); the legacy fingerprint changes; an `identity_conflict` without a decision.

**EC-2 — Parked or delayed import jobs, and the approved file inventory before resuming** *(F, and every resume in §5)*

A paused, halted, expired or EMERGENCY firm **parks** every queued import, and the parked jobs run **by themselves on resume**. So, before any activation, release or resume:

1. **Inventory** (read-only):
   ```bash
   # every job in the import queue, with its firm, import row and file name (no file contents)
   for k in "ZCARD bull:rta.import:delayed" "LLEN bull:rta.import:wait" "LLEN bull:rta.import:active" "LLEN bull:rta.import:paused"; do echo "$k = $(redis-cli -u "$REDIS_URL" --no-auth-warning $k)"; done
   for id in $(redis-cli -u "$REDIS_URL" --no-auth-warning ZRANGE bull:rta.import:delayed 0 -1); do
     echo "$id $(redis-cli -u "$REDIS_URL" --no-auth-warning HGET bull:rta.import:$id data | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tenantId"), d.get("importId"), d.get("filename"), d.get("key"))')"; done
   redis-cli -u "$REDIS_URL" --no-auth-warning LRANGE bull:rta.import:wait 0 -1
   ```
   ```sql
   SELECT id, source, kind, file_name, file_checksum, status, left(remarks, 80), created_at
     FROM rta_file_imports WHERE tenant_id = '<firm>' AND status IN ('uploaded', 'parsing') ORDER BY created_at;
   ```
   For each parked file, `aws s3 cp "s3://$S3_BUCKET/<key>" - | sha256sum` (read-only).
2. **Approved inventory:** compliance and operator 1 sign a list of the files allowed to import: report code (MFSD211 / MFSD201 only), file name, SHA-256 (from `rta-file-manifest.ts`), and Report Date.
3. **Every parked import must be on that list.** An import not on it is **cancelled** while the firm is still halted, by one signed-in operator through the API (§5.4 — `cancel_import`, with the reason and the ticket). No Redis command is used:
   - the row becomes `cancelled` (never `failed`, never "worker crash") with who, when and why, plus an `rta.import.cancel` audit row;
   - the queued / delayed job is removed from Redis by the same call (`jobsRemoved`, `queueChecked`);
   - the file and the row's provenance are kept;
   - the cancellation is final: the database refuses any later status change, the worker refuses to claim a cancelled import (a surviving retry or delayed job does nothing), and the re-run button refuses it. An approved file is uploaded again instead, through every intake check.
4. Re-run the inventory: only approved files remain. Then resume (two operators).

**Report types are also enforced in software now** (0243): a CAMS, MFSD203, MFSD243 or MFSD230 file is refused at upload, at mail dispatch, on re-run and — from its content — in the worker and inside the posting transaction, and is recorded as `blocked` (§5.4). The inventory is still the control for which approved MFSD211 / MFSD201 files run.

**Rehearsed:** `tests/rta-cancel-import-db.test.ts` — with a real Redis, a parked delayed job was removed by the cancel (`jobsRemoved` 1) and the row read `cancelled` with the operator, time and reason; with Redis unreachable, the cancel still completed (`queueChecked: false`) and the worker refused the surviving job; a firm owner, an operator without two-factor, a revoked session and a running import were refused.

**Stop if:** any parked or queued import for the firm is not on the signed inventory and not cancelled; a `cancel_import` answered `queueChecked: false` and the job is still listed (re-run the cancel once Redis is reachable — the worker refuses it meanwhile).

**EC-3 — Completeness of daily MFSD201 deliveries** *(F, and daily during the pilot — §5.9)*

Run `npx tsx scripts/rta-file-manifest.ts <every MFSD201 delivered so far> --calendar <pilot start> <today> --arn <pilot ARN>`. It is read-only and needs no database.

- Every weekday prints `present` with the SHA-256 of the file whose **Report Date** is that day, or `MISSING`.
- Each `MISSING` weekday gets a written answer: a KFintech holiday, or a gap confirmed with KFintech (request the file).
- Transaction-date spans are printed but labelled "NOT evidence of daily completeness". On the sample, the October MFSD201's single Report Date (08-Oct) covered one day, although its trade dates span 2024 → 2026.

**Stop if:** a `MISSING` business day without an answer for more than one business day; exit 2 for an unexpected ARN.

**EC-4 — Authenticated registrar mail domains** *(D2)*

1. From one real KFintech mailback in the RTA inbox, the infra engineer records the raw `Authentication-Results` header written by **our** receiving server:
   - authserv-id `amazonses.com` for SES, or the value of `RTA_IMAP_AUTHSERV_ID`;
   - `dkim=pass header.d=<domain>`;
   - `dmarc=pass header.from=<domain>`.

   The visible From address is not evidence.
2. The `header.d` / `header.from` domain must be in `REGISTRAR_DOMAINS` (`src/lib/rta/mail-trust.ts`), and the firm owner confirms it is KFintech's signing domain.
3. What the importer decided (read-only):
   ```sql
   SELECT outcome, substring(reason from 'authenticated as ([^ ·]+)') AS authenticated_domain, count(*), max(received_at)
     FROM rta_inbound_messages WHERE tenant_id = '<firm>' AND received_at > now() - interval '30 days' GROUP BY 1, 2 ORDER BY 1;
   ```
   Every `imported` row names a registrar domain. A non-registrar test mail shows as `quarantined`.
4. **For the pilot itself, no mail is imported for the firm.** Out-of-scope reports arriving by mail are now blocked by the software (0243), but an in-scope MFSD211 / MFSD201 arriving by mail would import without passing the signed file inventory (EC-2). So either the firm's forwarding rule is paused, or the alias is deactivated (§2.3). `SELECT count(*) FROM rta_forward_addresses WHERE tenant_id = '<firm>' AND is_active` is recorded, and from the pilot start the step-3 query shows no `imported` row. Every pilot file is uploaded from the signed inventory (EC-2).

**Stop if:** no authenticated header can be shown; a signing domain outside `REGISTRAR_DOMAINS`; an `imported` row without an authenticated domain; any mail imported for the pilot firm after F part 2.

**EC-5 — Alert delivery to a real on-call destination** *(D7)*

1. `OPS_ALERT_WEBHOOK_URL` (falls back to `OBSERVABILITY_WEBHOOK_URL` / `ERROR_WEBHOOK_URL`) and `OPS_ALERT_ESCALATION_WEBHOOK_URL` are set on the **worker and web** hosts (FS-10). The infra engineer names the system and rota each posts to.
2. On the copy: break one ledger row and let the scheduled reconciliation run (§2.2 "Deliberate failure" — one scheduled run per IST date). It writes `rta.posting.reconcile_alert` and a critical `rta.reconciliation.discrepancy` ops alert. The `reconcile` CLI alone raises no alert.
3. **A named on-call person acknowledges the alert** in the on-call tool. A message in an unwatched channel does not count.

**Evidence:**
- the incident or alert id;
- time sent, time acknowledged and by whom;
- the audit-log row: `SELECT at, after FROM audit_log WHERE action = 'rta.posting.reconcile_alert' ORDER BY at DESC LIMIT 1`;
- the alert row and its delivery attempts: `SELECT id, kind, status, delivery_state, delivered_at, escalated_at, acknowledged_at, acknowledged_by FROM ops_alerts WHERE kind = 'rta.reconciliation.discrepancy' ORDER BY first_seen_at DESC LIMIT 1` and `SELECT channel, attempt, at, outcome, http_status FROM ops_alert_deliveries WHERE alert_id = '<id>' ORDER BY at`.

**Stop if:** no acknowledgement within the agreed response time; the webhook is unset; the alert reaches only the audit log.

**EC-6 — Server-verified identities and separate approvals of the two platform operators** *(F)*

**What the software enforces now** (final security patch, migration 0243, `lib/rta/posting/approvals.ts`):
- Every START — an activation (other than a pause), a kill-switch release, a reversal, an undo, a platform scheme or AMC approval — is a **control request**. Operator 1 files it from their own signed-in platform session; the server takes the requester from the verified session and refuses any body naming an operator id (400). The request is immutable: action, firm, scope, payload, change reference, reason and expiry (≤ 24 h, default 2 h); the database computes its `payload_hash`.
- Operator 2 approves it from a **different** signed-in session, quoting the `payloadHash` they reviewed. The action runs in the same transaction as the approval.
- Refused: approving your own request (403, also with a second session of the same person; a database CHECK too); a request already decided (409 — a request is used once); an expired request (409, and the database refuses it); a hash that differs from the stored request (409); a requester or approver who is not an active `platform_admin` with two-factor on (403) or whose session is signed out or revoked (401); a requester who lost that standing before the approval (403).
- The database refuses a start that does not cite a request of that action **executed in the same transaction**, whose people and payload match — a direct SQL activation, release, reversal or undo, or a replay of an old request id into a later transaction, another firm or another action, all fail.
- **The CLI cannot start anything:** `rta-posting-recovery.ts release`, `undo` and `reverse --commit` exit 2. `reverse` is a dry run only; `requests` lists requests read-only. CLI `halt` still works (a stop) but is recorded `actor_source = 'cli'` with "operator identity not server-verified".
- One operator still halts, pauses, revokes and triggers EMERGENCY, immediately (API `halt` / `pause`, recorded `actor_source = 'session'`).

**Controls that remain for the pilot:**
1. Both operators have active platform accounts with two-factor authentication on:
   ```sql
   SELECT id, status, roles, two_fa_enabled FROM users WHERE id IN ('<op 1>', '<op 2>');
   ```
   The flag alone is **not** proof that the sessions used passed MFA — FS-1 (§2.5) is the check.
2. The change ticket records the request id and its `payloadHash` (from operator 1's request response) and operator 2's approval response.
3. After every two-person action:
   ```sql
   SELECT r.id, r.action, r.scope, r.change_ref, r.status, r.requested_by, r.approved_by, r.requested_by <> r.approved_by AS two_people,
          r.requested_at, r.decided_at, r.expires_at, r.payload_hash,
          (SELECT count(*) FROM audit_log l WHERE l.entity_id = r.id AND l.action = 'rta.control.request' AND l.actor_user_id = r.requested_by) AS request_audit,
          (SELECT count(*) FROM audit_log l WHERE l.entity_id = r.id AND l.action = 'rta.control.execute' AND l.actor_user_id = r.approved_by) AS execute_audit,
          (SELECT a.id FROM rta_pipeline_activations a WHERE a.control_request_id = r.id) AS activation_id
     FROM rta_control_requests r WHERE r.tenant_id = '<firm>' OR r.scope IN ('global', 'emergency') ORDER BY r.requested_at DESC LIMIT 5;
   ```
   Expected: `status` executed; `two_people` true; both audit counts 1 (a release of `global` / `emergency` has no firm, so its audit rows are the control-history rows instead: `SELECT * FROM rta_posting_control_events WHERE control_request_id = '<id>'`); the ids and hash match the ticket.

**Rehearsed** (`tests/rta-two-person-db.test.ts`, 11 tests; the `rta_p0` real-file rehearsal and drill): impersonation through the API (a body naming another operator → 400; the old one-call `activate` / `release` → 410), same-person approval (403 and the database CHECK), replay (an executed request approved again → 409; an executed request cited by a later SQL insert → refused; a release request reused as an activation → refused), expiry (409 and the database), unauthorized operators (no platform role, no two-factor, disabled, revoked or made-up session), direct SQL bypass (activation, release, reversal without a request → refused), CLI (`release`, `undo`, `reverse --commit` → exit 2), one-person halt and two-person release.

**Stop if:**
- either account lacks two-factor authentication;
- a start without an executed request, or with `requested_by = approved_by`;
- the request id or hash in the database differs from the ticket.

### 2.5 Final security checks before pilot authorization (FS-1 – FS-10)

Added at the development freeze (commit `8523a01` accepted). **Each one is NOT VERIFIED until the named role records the evidence in the ticket**, from production (read-only) or from the authorized isolated production copy (C). Every SQL here is read-only (`PGOPTIONS='-c default_transaction_read_only=on'`), except where a step says "on the copy". `<firm>`, `<op 1>`, `<op 2>`, `<app role>`, `<worker role>`, `<start>` and `<end>` are filled in from the §6 sheet. The queries were checked for syntax as the development app role in a read-only transaction; that is not evidence for production.

| # | Check | Responsible role | Feeds condition | Status |
|---|---|---|---|---|
| FS-1 | Operators' live sessions passed real MFA | Infrastructure engineer (logs) + DBA (queries); compliance reviews | F (and EC-6) | NOT VERIFIED |
| FS-2 | App and worker roles cannot bypass RLS; not owner, not superuser | DBA + infrastructure engineer | D4 | NOT VERIFIED |
| FS-3 | Privileged database and emergency-CLI access restricted and audited | DBA + infrastructure engineer; compliance reviews | D | NOT VERIFIED |
| FS-4 | No alternate activation path (API, script, CLI, database write) | DBA + platform operator 1; compliance reviews | F | NOT VERIFIED |
| FS-5 | MFSD211 / MFSD201 restriction at upload, queue and commit | Platform operator 1 (on the copy); compliance reviews | F | NOT VERIFIED |
| FS-6 | Pilot email ingestion disabled | Infrastructure engineer + the firm's owner; platform operator 1 daily | D2 / EC-4 | NOT VERIFIED |
| FS-7 | Every legacy match checked for canonical scheme identity | DBA (runs) + platform operator 1 (reviews); compliance signs | E / F (EC-1) | NOT VERIFIED |
| FS-8 | A cancelled import cannot resume after Redis recovery | Infrastructure engineer + platform operator 1 (on the copy) | F (EC-2) | NOT VERIFIED |
| FS-9 | Unique SIP / STP rejection counting equals the ledger | Platform operator 1 (daily); compliance spot-checks | F, then daily | NOT VERIFIED |
| FS-10 | Nightly reconciliation runs and its alert reaches an accountable person | Infrastructure engineer (sink, rota) + platform operator 1; the named on-call person | D7 (EC-5) | NOT VERIFIED |

**FS-1 — The operators' live sessions satisfied the actual MFA requirement**

*What the software enforces (migration 0244):*
- Every session row records **how it was created**: `user_sessions.auth_method` (`password_totp`, `password_backup_code`, `step_up_totp`, `step_up_backup_code` — the MFA methods; `password`, `password_reset`, `signup`, `invite`, `reissue` — not MFA) and `mfa_verified_at`, set only when a completed challenge creates the session. The database refuses raising, back-dating or relabelling a session's MFA afterwards.
- A **password reset** signs the user in with `auth_method = password_reset` and no MFA; that session cannot request or approve anything until the operator completes `POST /api/super-admin/step-up` (TOTP or one backup code), which revokes it and issues a new MFA session.
- A **security change** — password, TOTP secret, two-factor on/off, sign-out-everywhere — stamps `users.mfa_changed_at` and downgrades every session of that user (audit `auth.mfa.sessions_downgraded`). A session from before enrolment therefore never qualifies.
- Every START (activation, release, reversal, undo, platform approvals) needs **both** people on a live, unrevoked session verified within **12 hours** and after the operator's last security change — in the API (`verifyOperator`) and in the database (`rta_operator_ok`). `cancel_import` and alert acknowledgement need the same. Stops (halt, pause, revoke) need only a live platform session.
- Audit: `auth.session.created` (method, MFA yes/no), `auth.2fa.failed`, `auth.mfa.sessions_downgraded`, and each control request's `requesterAuthMethod` / `requesterMfaVerifiedAt` / `approverAuthMethod` / `approverMfaVerifiedAt`. No password, code, session id or token is recorded.

The database is the primary evidence; the access log is corroboration only.

*Procedure* (before F part 2, and again before every two-person action during the pilot):
1. Each operator, already enrolled in two-factor, uses **Sign out everywhere** (`POST /api/me/sign-out-everywhere`). Record the time.
2. Each signs in fresh: password, then a **TOTP code**. A backup code is an exception, recorded in the ticket with the reason.
3. The DBA runs:
   ```sql
   -- (a) per operator: enrolment, last security change, sign-out-everywhere
   SELECT u.id, u.status, u.roles, u.two_fa_enabled, u.mfa_changed_at, u.sessions_invalid_after,
          jsonb_array_length(coalesce(u.two_fa_backup_codes, '[]'::jsonb)) AS backup_codes_left,
          (SELECT max(r.consumed_at) FROM password_resets r WHERE r.user_id = u.id) AS last_password_reset_at
     FROM users u WHERE u.id IN ('<op 1>', '<op 2>');
   -- (b) every live or recent session, with how it was authenticated
   SELECT s.user_id, s.created_at, s.auth_method, s.mfa_verified_at, s.revoked_at, s.ip_address
     FROM user_sessions s WHERE s.user_id IN ('<op 1>', '<op 2>')
      AND (s.revoked_at IS NULL OR s.created_at > now() - interval '30 days') ORDER BY s.user_id, s.created_at;
   -- (c) the sessions that filed and approved each executed control request
   SELECT r.id, r.action, r.requested_at, r.decided_at,
          rs.auth_method AS requester_method, rs.mfa_verified_at AS requester_mfa_at,
          aps.auth_method AS approver_method, aps.mfa_verified_at AS approver_mfa_at,
          r.requested_by <> r.approved_by AS two_people
     FROM rta_control_requests r
     JOIN user_sessions rs ON rs.session_id = r.requester_sid
     LEFT JOIN user_sessions aps ON aps.session_id = r.approver_sid
    WHERE r.status = 'executed' AND (r.tenant_id = '<firm>' OR r.scope IN ('global', 'emergency'))
    ORDER BY r.requested_at;
   -- (d) the authentication audit trail of both operators since the sign-out
   SELECT at, actor_user_id, action, after FROM audit_log
    WHERE actor_user_id IN ('<op 1>', '<op 2>') AND action IN ('auth.session.created', 'auth.2fa.failed', 'auth.mfa.sessions_downgraded')
      AND at > '<sign-out time>' ORDER BY at;
   ```
4. The infrastructure engineer, as corroboration, pulls from the access log for each session in (c) the `POST /api/auth/2fa/verify` (or `/api/super-admin/step-up`) answered 200 at the session's `created_at` (path, status, time, client IP; never the cookie or token).

*Expected:*
- (c): every requester and approver method is `password_totp` or `step_up_totp` (a `*_backup_code` only as a recorded exception), `mfa_verified_at` within 12 hours before `decided_at`, and `two_people` true.
- (a)/(b): each session used was created after the sign-out-everywhere and after `mfa_changed_at`; no other session of either operator is live.
- (d): an `auth.session.created` with `mfaVerified: true` for each session used; any `auth.2fa.failed` is explained.

*Development evidence* (`tests/auth-mfa-session-db.test.ts`, 7 tests, real login / 2fa / reset / step-up routes):
- **Bypass 1, password reset — before:** the 0243 rule accepted the reset session. **After:** the API answers 403 ("did not complete a two-factor challenge (it came from a password reset)"), the database refuses the request row, and only a TOTP step-up session can file it; a wrong step-up code is 401 and audited without the code.
- **Bypass 2, pre-enrolment session — before:** accepted. **After:** 403; a fresh password + TOTP sign-in succeeds.
- A password change and a secret change downgrade live sessions (audited); a revoked session is 401; a session verified 13 hours ago is refused; a backup code counts once; forged, raised, back-dated or relabelled MFA is refused by the database; the same person on two MFA sessions still cannot approve their own request.

*Stop if:* any session used for a request is not an MFA method, is older than 12 hours at the decision, predates the operator's sign-out or last security change, or the requester and approver are the same person. The database should make this impossible — if one is found, **NO-GO** and report it as a defect.

**FS-2 — The production app and worker database roles cannot bypass RLS and are neither owner nor superuser**

*What the software enforces (migration 0244, `src/db/runtime-role.ts`):*
- In production the web and the worker connect **only** with `APP_DATABASE_URL`. Unset → they refuse to start (exit 1); there is no fallback to `DATABASE_URL`. A process with `DB_TOOLING=1` (the migration runner's marker) refuses to start as web or worker. `ALLOW_SUPERUSER_DB` has no effect in production.
- At start (worker: before any job or timer; web: the server start hook) and again **inside every posting transaction**, the connected role is refused when it is SUPERUSER, BYPASSRLS or CREATEROLE; owns the database or any table, view, sequence or function in `public` (directly or through membership); can assume a role that does; may set `session_replication_role`; or holds TRIGGER / TRUNCATE / REFERENCES on a financial or control table.
- The refusal names role@host/database and the reasons — never a password. A healthy start logs `✓ Database role '<role>' verified for the worker` / `[web] database role '<role>' verified`.

*Procedure:*
1. **Infrastructure engineer**, on the web host and on every worker host, prints only the user name, host and database:
   `node -e 'for (const k of ["APP_DATABASE_URL","DATABASE_URL"]) { const v = process.env[k]; if (!v) { console.log(k, "UNSET"); continue; } const u = new URL(v); console.log(k, u.username, u.hostname, u.pathname); }'`
   Never print the password.
2. **DBA:**
   ```sql
   SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
          (SELECT string_agg(g.rolname, ',') FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid) AS member_of,
          has_parameter_privilege(r.rolname, 'session_replication_role', 'SET') AS can_skip_triggers
     FROM pg_roles r WHERE r.rolname IN ('<app role>', '<worker role>');
   SELECT pg_get_userbyid(c.relowner) AS owner, count(*) AS objects
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') GROUP BY 1 ORDER BY 1;
   SELECT pg_get_userbyid(d.datdba) AS database_owner FROM pg_database d WHERE d.datname = current_database();
   SELECT pg_get_userbyid(p.proowner) AS function_owner, count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' GROUP BY 1;
   SELECT count(*) AS tenant_tables_without_forced_rls
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped);
   ```
   Then `npm run check:rls` on the copy.
3. **Infrastructure engineer:** restart the web and the worker on each host and keep the start lines above (or, for a refusal, the diagnostics). On the copy, start the worker once with `APP_DATABASE_URL` unset and once with the migration role, and record both refusals (exit 1).

*Expected:*
- `APP_DATABASE_URL` is set on every web and worker host and names a role other than the migration role.
- For the app and worker roles, every flag is false, `member_of` is empty, and `can_skip_triggers` is false.
- Neither role owns any object, the database or any function.
- `tenant_tables_without_forced_rls` is 0, and `check:rls` passes.

*Development result:* `mfd_app` all false, owns nothing (the 213 objects, 49 functions and the database belong to the migration role), 8 guard triggers enabled, 0 tables without forced RLS. `tests/runtime-db-role-db.test.ts` (9): in production mode the worker and web refuse to start — exit 1, no password printed — with `APP_DATABASE_URL` missing, a superuser, a BYPASSRLS role, a table owner, a member of the owner role, a CREATEROLE role and `DB_TOOLING=1`; the real worker entry point with the owner role exits before "Worker process up"; the restricted role starts; web and worker start with different restricted credentials; the posting gate refuses owner, member, BYPASSRLS and TRIGGER-holding roles; as the restricted role, tenant isolation holds, `ALTER TABLE … DISABLE TRIGGER` is refused ("must be owner") and `SET session_replication_role` is refused. That is not production evidence.

*Stop if:* `APP_DATABASE_URL` is unset on any host; either role is superuser, BYPASSRLS or an owner, is a member of a privileged role, or can set `session_replication_role`.

**FS-3 — Privileged database and emergency-CLI access is restricted and audited**

*Procedure:*
1. **DBA**, every privileged role and the logging that would record its use:
   ```sql
   SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcanlogin, r.rolvaliduntil
     FROM pg_roles r WHERE (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole) AND r.rolname NOT LIKE 'pg\_%' ORDER BY 1;
   SELECT name, setting FROM pg_settings WHERE name IN ('log_connections', 'log_disconnections', 'log_statement', 'log_line_prefix', 'shared_preload_libraries') ORDER BY 1;
   SELECT extname, extversion FROM pg_extension WHERE extname = 'pgaudit';
   ```
   On a managed database, also export the provider's audit settings and the list of IAM principals that can reset the master password or restore.
2. **DBA and infrastructure engineer**, the access list (names, not secrets):
   - who can read the migration-role and master credentials in the secret store;
   - who can reach the database network, and from where;
   - who can open a shell on a worker host. The recovery CLI runs there, with `ALLOW_SYSTEM_TX=1` and a database URL.
3. **Break-glass rule**, written and signed: privileged access is named, time-limited, logged, and reviewed the next business day. The CLI is used only for `status`, `requests`, the `reverse` dry run, `reconcile`, and a `halt` when the API is unreachable (recorded "operator identity not server-verified").
4. **A witnessed test:** one privileged sign-in on the copy, then show its log entry with user, time and source.

*Expected:* every privileged role is named, with an owner, and either has no login or is held by named people only. Privileged connections and statements are logged where the reviewer can read them. The test entry is found.

*Stop if:* an unnamed or shared holder of owner / superuser / master credentials; no record of privileged connections; shell access to worker hosts beyond the named people.

**FS-4 — The pilot cannot be activated through any alternate API, script, CLI or database-write path**

*What exists (development):*
- **API:** the only start path is `POST /api/super-admin/rta-pipeline` (and `/api/super-admin/scheme-mappings` for scheme / AMC approvals), as a request plus a different operator's approval (§5.1). The old one-call `activate` / `release` answer 410.
- **CLI:** `release`, `undo` and `reverse --commit` exit 2. The library calls `activateTenant` (any mode but a pause), `setPostingHalt` (release), `reversePostingBatch` (commit) and `undoReversal` throw.
- **Database:** 8 guard triggers refuse a start without a request executed in the same transaction. Only the table owner or a superuser can disable a trigger or set `session_replication_role` (FS-2, FS-3).
- **Local-only tools:** `scripts/dev-session.mjs` and `scripts/rta-infra-check.ts` refuse a non-local database.

*Procedure:*
1. **DBA**, production read-only:
   ```sql
   SELECT c.relname AS table_name, t.tgname, t.tgenabled
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND t.tgname IN ('rta_control_requests_guard', 'rta_file_imports_cancel_guard',
          'rta_pipeline_activations_append_only', 'rta_pipeline_activations_request_guard', 'rta_posting_control_events_immutable',
          'rta_posting_controls_request_guard', 'rta_posting_reversals_append_only', 'rta_posting_reversals_request_guard')
    ORDER BY 1, 2;
   SELECT a.id, a.created_at, a.mode, a.posting_enabled, a.registrars, a.report_codes, a.expires_at, a.revoked_at,
          a.control_request_id, r.status AS request_status, r.requested_by <> r.approved_by AS two_people
     FROM rta_pipeline_activations a LEFT JOIN rta_control_requests r ON r.id = a.control_request_id
    WHERE a.tenant_id = '<firm>' ORDER BY a.created_at;
   SELECT scope, posting_halted, changed_by, approved_by, control_request_id, changed_at FROM rta_posting_controls ORDER BY scope;
   SELECT count(*) AS starts_without_request FROM rta_pipeline_activations WHERE mode <> 'paused' AND control_request_id IS NULL
      AND created_at > (SELECT applied_at FROM _applied_migrations WHERE filename = '0243_rta_control_requests.sql');
   ```
2. **Platform operator 1, on the copy:** try each path and record the refusal:
   - as the app role, a SQL `INSERT` of a validate-first activation and an `UPDATE` releasing a halt: refused, naming the control request;
   - the CLI `release`: exit 2;
   - the old one-call API `activate`: 410;
   - a request approved by its own requester: 403.
3. **Infrastructure engineer:** on the deployed build, list every file that writes the control tables:
   `grep -rlE "INSERT INTO rta_pipeline_activations|UPDATE rta_posting_controls|INSERT INTO rta_posting_reversals" <deployed app dir>`.
   Expected: only the compiled `lib/rta/posting` modules. Then confirm `dev-session.mjs` and `rta-infra-check.ts` are absent from production hosts, or refuse there.

*Expected:*
- 8 triggers, each `tgenabled = 'O'`.
- Before F: no activation for the firm. After F: every non-pause row has an executed, two-person request.
- `starts_without_request` = 0, and every refusal in step 2 as stated.

*Stop if:* a trigger is missing or not `O`; a start without a request; any step-2 attempt succeeds; an unexpected writer appears in the deployed build.

**FS-5 — The KFintech MFSD211 / MFSD201 restriction holds at upload, queue and commit** *(on the copy, the firm activated with `reportCodes: ["MFSD211","MFSD201"]`)*

*Procedure (platform operator 1):*
1. **Upload** through the copy's app:
   - MFSD211 and MFSD201 are accepted (200, queued);
   - MFSD203, MFSD243, MFSD230 and one CAMS file each get **422**, are recorded `blocked`, and are never queued.
2. **Queue (content):** upload an MFSD203 renamed to look like an MFSD201, under *Daily transaction feed*. It passes the name filter. The worker must then block it from its header: row `blocked`, "Blocked — … a MFSD203 file is refused".
3. **Re-run** each blocked import: 422, still `blocked`.
4. **Commit:**
   ```sql
   SELECT b.report_code, b.rta, count(*) FROM rta_staging_batches b WHERE b.tenant_id = '<firm>' GROUP BY 1, 2 ORDER BY 1;
   SELECT f.status, f.source, f.kind, count(*), left(min(f.remarks), 120) AS example_remark
     FROM rta_file_imports f WHERE f.tenant_id = '<firm>' AND f.status IN ('blocked', 'cancelled') GROUP BY 1, 2, 3;
   ```

*Expected:* only `MFSD211` / `MFSD201` (`kfintech`) batches; every refused file appears as `blocked`, with its file kept.

*Development evidence:* `tests/rta-report-scope-db.test.ts` (7 cases) and the `rta_p0` run of the six real out-of-scope files. Not production evidence.

*Stop if:* any out-of-scope file is queued, staged or posted, or is not recorded.

**FS-6 — Pilot email ingestion stays disabled** *(until separately verified — EC-4 — and authorized in writing)*

The inbox poller is platform-wide (the worker's `mail` group) and keeps serving other firms. For the pilot firm, the switch is its alias: mail to an inactive alias is not routed to the firm.

*Procedure (infrastructure engineer; the firm's owner pauses their own forwarding rule):*
```sql
SELECT id, is_active, verified_at, created_at FROM rta_forward_addresses WHERE tenant_id = '<firm>';
SELECT outcome, count(*), max(received_at) FROM rta_inbound_messages WHERE tenant_id = '<firm>' AND received_at >= '<start>' GROUP BY 1;
```

*Expected:* no active alias; from `<start>`, no `imported` row; the owner's confirmation that forwarding is paused. Platform operator 1 repeats the second query daily (§5.9 #3).

*Stop if:* an active alias, or any `imported` row for the firm. Re-enabling mail is a separate written decision, after EC-4 evidence.

**FS-7 — Every legacy transaction match is checked for canonical scheme identity**

1. **Production, before F:** `SELECT count(*) FROM rta_posted_transactions;` must be 0. No validate-first posting has run there, so every future match is made by the 0243 matcher, which compares scheme identity before linking.
2. **On the copy, after F part 1** (DBA runs; platform operator 1 reviews):
   ```sql
   WITH m AS (
     SELECT t.scheme_code AS crm_code, t.rta_scheme_code AS crm_rta_code, e.rta, e.amc_code, e.scheme_code AS registrar_code, c.status AS mapping_status,
            CASE WHEN c.status IN ('resolved_isin', 'confirmed') THEN c.amfi_scheme_code END AS approved_amfi_code
       FROM rta_posted_transactions p
       JOIN transactions t ON t.id = p.transaction_id
       JOIN rta_staging_economic_txns e ON e.id = p.economic_txn_id
       LEFT JOIN scheme_rta_codes c ON c.tenant_id = p.tenant_id AND c.rta = e.rta AND c.rta_amc_code = e.amc_code AND c.rta_scheme_code = e.scheme_code
      WHERE p.tenant_id = '<firm>' AND p.kind = 'matched_existing')
   SELECT count(*) AS matched_existing,
          count(*) FILTER (WHERE crm_code = registrar_code)                                                 AS by_registrar_code,
          count(*) FILTER (WHERE crm_code <> registrar_code AND crm_code = approved_amfi_code)               AS by_approved_amfi_code,
          count(*) FILTER (WHERE crm_code <> registrar_code AND crm_code IS DISTINCT FROM approved_amfi_code) AS by_other_code_review_each,
          count(*) FILTER (WHERE crm_rta_code IS NOT NULL AND crm_rta_code <> registrar_code)                AS registrar_column_differs,
          count(*) FILTER (WHERE crm_code IS NULL AND crm_rta_code IS NULL)                                  AS no_scheme_on_crm_row,
          count(*) FILTER (WHERE crm_code <> registrar_code AND mapping_status NOT IN ('resolved_isin', 'confirmed')) AS amfi_match_on_unverified_mapping
     FROM m;
   ```

*Expected:*
- `matched_existing` = `by_registrar_code` + `by_approved_amfi_code` + `by_other_code_review_each`.
- `registrar_column_differs`, `no_scheme_on_crm_row` and `amfi_match_on_unverified_mapping` are 0.
- Each `by_other_code_review_each` row is a historical code with the approved mapping that ties it to the same AMFI scheme, listed and signed.
- Every `identity_conflict` has a written decision (EC-1).

*Development evidence (isolated copy `rta_fs7`, built from empty at 0244, AMFI 07-Oct-2026; the four real KFintech files; aggregates only):*

| Firm | What was done | Result |
|---|---|---|
| L | legacy importer (`import-rta-local.ts --commit`): 1,061 rows (1,058 processed, 3 rejected legs, ₹81,50,526.51); then two-person activation (MFA sessions, MFSD211 + MFSD201) and the same four files through validate-first | `matched_existing` **1,061** = `by_registrar_code` **1,061** + 0 + 0; `registrar_column_differs`, `no_scheme_on_crm_row`, `amfi_match_on_unverified_mapping` all **0**; folio, date and amount equal on 1,061 / 1,061; 15 lot-by-lot redemptions the legacy importer held back posted new; 18 folio corrections held; 6 unknown codes unsupported; reconcile all 0 |
| L, second run | the same four files again | `already_posted` 1,076; no new transaction or ledger row; the breakdown unchanged; reconcile all 0 |
| L | the legacy rows (financial and scheme fields, hashed) before, after run 1, after run 2 | **unchanged** (no historical mutation) |
| X (collision drill) | the same legacy build, then **6** processed legacy rows given the code of **another scheme of the same AMC**; then activation and validate-first | the 6 → **`identity_conflict` holds**, 0 linked, 0 re-posted as new; the other 1,055 matched by registrar code; breakdown counts 0; a second run held the same 6 again and duplicated nothing; legacy rows unchanged; reconcile all 0 |

That is not production evidence; run the query on the production copy.

*Stop if:* any count above is non-zero without a signed explanation; a production ledger row exists before F.

**FS-8 — A cancelled import cannot resume after Redis recovery** *(on the copy, with a non-production Redis)*

*Procedure (infrastructure engineer stops and starts Redis; platform operator 1 runs the rest):*
1. Halt the firm. Upload an approved-format file that is **not** on the inventory. It parks: row `uploaded`, a delayed job in Redis.
2. **Stop Redis.** Cancel the import (`cancel_import`, §5.4). The call answers 200 with `queueChecked: false`, and the row reads `cancelled`.
3. **Start Redis.** Wait longer than `RTA_HOLD_RECHECK_MS` (5 minutes by default) so the delayed job fires. Then release the firm (two operators) so the job would run if it could.
4. Check:
   ```sql
   SELECT f.id, f.status, f.cancelled_at, f.cancelled_by, f.cancel_reason, f.file_key IS NOT NULL AS file_kept,
          (SELECT count(*) FROM rta_staging_batches b WHERE b.import_id = f.id) AS staging_batches,
          (SELECT count(*) FROM audit_log a WHERE a.entity_id = f.id AND a.action = 'rta.import.cancel') AS audit_rows
     FROM rta_file_imports f WHERE f.tenant_id = '<firm>' AND f.status = 'cancelled';
   ```
   - The worker log shows "was cancelled by an operator — not run".
   - The queue no longer lists the job.
   - The re-run button answers 409.
   - On the copy, as the app role: `UPDATE rta_file_imports SET status = 'uploaded' WHERE id = '<id>'` is refused ("a cancelled RTA import is final").
5. Repeat steps 1–2 with Redis up: `jobsRemoved: 1`.

*Expected:*
- `status` stays `cancelled`, with the same `cancelled_at`.
- `staging_batches` 0, `audit_rows` 1, `file_kept` true.
- No transaction is written.

*Development evidence:* the COMPLETE sequence as ONE test, `tests/rta-fs8-redis-cancel-db.test.ts` (real Postgres, a real `redis-server` with AOF persistence that the test stops and restarts, the real BullMQ worker, the real cancel route): (1) import queued; (2) firm paused → the worker parks it (`Held …`, delayed job); a second copy of the job queued, delayed; (3) Redis stopped; (4) cancelled by an MFA-verified operator in 1.5 s → 200, `queueChecked: false`, `jobsRemoved: 0`; (5) Redis restarted — both delayed jobs still queued; (6) firm resumed by a two-person request; the parked job, the delayed copy and a fresh retry **all ran** and each logged "was cancelled by an operator — not run" (3 refusals, 0 failed jobs); an un-cancelled control import queued afterwards was staged by the same worker (the test is not vacuous); (7) the cancelled import: 0 staging batches, 0 transactions, 0 ledger rows, file kept; (8) status `cancelled`, `cancelled_at` unchanged from step 4, one `rta.import.cancel` audit row, activations `paused → validate_first`. Passed on repeated runs.

*Found by the combined run and fixed:* with Redis down, the cancel's queue sweep (on the buffering connection) was replayed when Redis returned and silently removed the still-delayed job. The sweep now uses the producer connection (no offline buffer) and starts only when it is connected, so `queueChecked: false` means exactly that: the job is still queued and the worker refuses it.

*Stop if:* the row changes from `cancelled`; any staging batch or transaction for the import; the job runs.

**FS-9 — Unique SIP / STP rejection counting stays consistent with the financial ledger** *(platform operator 1, at F and every pilot day)*

1. **From the ledger**, for the pilot window:
   ```sql
   SELECT count(*) FILTER (WHERE t.status = 'rejected') AS rejected_legs,
          round(coalesce(sum(abs(t.amount)) FILTER (WHERE t.status = 'rejected'), 0), 2) AS rejected_leg_amount,
          count(DISTINCT CASE WHEN t.status = 'rejected' THEN CASE WHEN t.type = 'stp' AND nullif(btrim(t.raw_feed_row->>'switchRef'), '') IS NOT NULL
                THEN concat_ws('|', 'stp', t.investor_id, t.folio_number, t.order_date, abs(t.amount), btrim(t.raw_feed_row->>'switchRef')) ELSE t.id::text END END) AS rejected_instructions,
          (SELECT round(coalesce(sum(x.v), 0), 2) FROM (
             SELECT max(abs(t2.amount)) AS v FROM rta_posted_transactions p2 JOIN transactions t2 ON t2.id = p2.transaction_id
              WHERE p2.tenant_id = '<firm>' AND t2.status = 'rejected' AND t2.order_date BETWEEN '<start>' AND '<end>'
              GROUP BY CASE WHEN t2.type = 'stp' AND nullif(btrim(t2.raw_feed_row->>'switchRef'), '') IS NOT NULL
                THEN concat_ws('|', 'stp', t2.investor_id, t2.folio_number, t2.order_date, abs(t2.amount), btrim(t2.raw_feed_row->>'switchRef')) ELSE t2.id::text END) x) AS rejected_instruction_amount,
          (SELECT count(*) FROM rta_posted_transactions p3 WHERE p3.tenant_id = '<firm>' AND p3.sip_rejection_id IS NOT NULL) AS sip_rejection_records
     FROM rta_posted_transactions p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.tenant_id = '<firm>' AND t.order_date BETWEEN '<start>' AND '<end>';
   ```
2. **The Operations dashboard**, Rejections tab, firm-wide, period = custom `<start>` – `<end>`: read *Rejected instructions* and *Rejected legs*.
3. **The export** (`/api/ops/export?kind=rejected`, same period): the line count, and the number of distinct values in the `Instruction` column.

*Expected:*
- The dashboard's instructions and legs (count and amount) equal the ledger query.
- The export has one line per leg; its distinct `Instruction` values equal `rejected_instructions`.
- `sip_rejection_records` equals the rejected SIP instalments.

The dashboard reads every transaction of the firm in the period. For a firm with legacy rows that the ledger has not linked, compare the same period after EC-1 shows every legacy row in the window linked or held.

*Development evidence:* 2 instructions / ₹7,000.00 and 3 legs / ₹12,000.00, equal on both `rta_p0` firms and in the totals CSV.

*Stop if:* any figure differs from the ledger.

**FS-10 — Nightly reconciliation runs, and its alert reaches an accountable operator**

*What the software does (migration 0244, `lib/rta/posting/recon-schedule.ts`, `lib/ops/alerts.ts`):*
- **Schedule: 06:30 Asia/Kolkata (IST, UTC+05:30) every day** — `RTA_RECON_TIME_IST`, default `06:30`. The slot is computed in IST explicitly, never from the host's time zone (a UTC host used to run the old 06:30 job at 12:00 IST). It no longer runs inside `daily-ops-scanner`.
- A monitor in the worker's `ops` group ticks every minute (`RTA_RECON_TICK_MS`); it does not use Redis. Each tick: records its heartbeat (`scheduler_state` `rta-reconciliation-monitor`); marks a run whose heartbeat stopped for 15 minutes (`RTA_RECON_STALE_SEC`) `incomplete` with a **critical** alert; runs the due slot (on time within 15 minutes as `schedule`, later as `catch_up` with a `missed` alert); delivers due alerts; pings `OPS_HEARTBEAT_URL` (an external dead-man's switch).
- **Every run is recorded** in `rta_reconciliation_runs` (slot date, scheduled time, time zone, trigger, start, heartbeat, completion, outcome `ok` / `discrepancy` / `failed` / `incomplete`, firms checked) with one `rta_reconciliation_run_firms` row per firm (counts, error). The database allows one scheduled or catch-up run per slot, so two workers never both run it.
- **Alerts are persisted** in `ops_alerts` before anyone is notified: a discrepancy (per firm), a firm that could not be checked, a failed, missed or incomplete run, a stopped worker. One open alert per condition — a repeat counts an occurrence and sends nothing new. Delivery to `OPS_ALERT_WEBHOOK_URL` (else `OBSERVABILITY_WEBHOOK_URL` / `ERROR_WEBHOOK_URL`) carries an `Idempotency-Key`; a failure is retried with bounded backoff (1, 2, 4 … ≤ 60 minutes, 8 attempts), then `undeliverable`. An undeliverable alert, or a delivered one not acknowledged within 60 minutes, is sent once to `OPS_ALERT_ESCALATION_WEBHOOK_URL`. Every attempt is in the append-only `ops_alert_deliveries`. An alert closes only when a named platform operator, on an MFA-verified session, acknowledges it (`POST /api/super-admin/ops-alerts`); that is final and audited. Alerts carry kind, severity, counts, ids and times — PANs and URL credentials are masked before storage; no client name or figure.
- **Independent monitor:** `GET /api/health/rta-reconciliation` (web process, database only; `Authorization: Bearer <OPS_MONITOR_TOKEN>`) answers **503** when the monitor's heartbeat is older than 10 minutes, the day's slot has not run, a run failed or stopped part-way, an alert is undeliverable, or a critical alert is unacknowledged — and itself raises and delivers the worker-down alert, because a dead worker cannot.
- The existing audit row `rta.posting.reconcile_alert` and the error monitor are still written.

*Procedure:*
1. **Infrastructure engineer:**
   - `WORKER_GROUPS` on the worker host contains `ops`; the worker log shows `[rta-recon] monitor armed — reconciliation daily at 06:30 Asia/Kolkata (IST, UTC+05:30)`;
   - `OPS_ALERT_WEBHOOK_URL` and `OPS_ALERT_ESCALATION_WEBHOOK_URL` set on the worker **and** web hosts; `OPS_HEARTBEAT_URL` set on the worker host and configured to page when pings stop for 10 minutes;
   - an external uptime monitor polls `GET /api/health/rta-reconciliation` with `OPS_MONITOR_TOKEN` every 5 minutes and pages on 503;
   - name the alert system, the rota, the accountable on-call person and their platform account.
2. **On the copy (EC-5):**
   - `POST /api/super-admin/ops-alerts {"action":"test","note":"<ticket>"}` — the named on-call person receives it and acknowledges it (`{"action":"acknowledge","id":…,"note":…}`) from their own MFA-verified session;
   - stop the worker for longer than 10 minutes → the uptime monitor pages (503) and the heartbeat service alerts; start it → a `catch_up` run if the slot was missed;
   - break one ledger row → the next run records `discrepancy` and the critical alert is delivered, escalated if not acknowledged, then acknowledged.
3. **Daily, platform operator 1:**
   ```sql
   SELECT slot_date, trigger, status, scheduled_for, started_at, completed_at, firms_checked, firms_with_discrepancy, error
     FROM rta_reconciliation_runs ORDER BY started_at DESC LIMIT 5;
   SELECT kind, severity, status, delivery_state, occurrences, first_seen_at, escalated_at, acknowledged_at, acknowledged_by
     FROM ops_alerts WHERE status = 'open' OR acknowledged_at > now() - interval '2 days' ORDER BY first_seen_at DESC;
   ```
   Then the manual `reconcile` (§5.9 #4) and `GET /api/health/rta-reconciliation` (200).

*Expected:*
- A `schedule` run for today's slot at 06:30 IST, `ok`, every validate-first firm checked.
- No open alert, or each open one being handled; the test alert delivered and acknowledged by the named person.
- The health endpoint answers 200; the manual reconcile exits 0.

*Development evidence* (`tests/rta-reconciliation-alerts-db.test.ts`, 11 tests): successful run recorded once per slot (three racing workers → one run); discrepancy → one critical alert, audit row, a repeat counted not re-sent; a check that throws → `failed` with the firm recorded and the error PAN-masked; webhook down then recovered → retried with backoff and delivered on attempt 3 under one Idempotency-Key; webhook stays down → 3 bounded attempts, `undeliverable`, escalated once, health 503; an unacknowledged delivered alert escalated once; concurrent deliverers send once; worker stopped → the web route answers 503 and delivers the worker-down alert itself, and on restart the slot is caught up with a `missed` alert; worker killed (SIGKILL) mid-run → `incomplete`, a critical alert, a catch-up run completes the slot; Redis pointing nowhere → the monitor and run complete; acknowledgement through the API by an MFA session (refused for a reset-only session), recorded, audited, final. Not production evidence.

*Stop if:* no run recorded for the day; an alert not acknowledged in the agreed time; the alert or escalation webhook unset; the health endpoint not monitored externally; no named accountable person.

---

## 3. Six release conditions

**Current status: none is PASS. Every production-dependent condition is NOT VERIFIED; F is NOT DONE.** A condition becomes PASS only when an authorized operator has recorded actual evidence from production (read-only) or from the authorized isolated production copy, in the ticket. Development, test or rehearsal results never make a condition PASS.

| Condition | GO / NO-GO today | What would make it PASS |
|---|---|---|
| A. AMFI integrity and mapping | **NO-GO** (not verified) | the two-download evidence and mapping queries on the pilot host |
| B. Schemes verified or held | **NO-GO** (not verified) | B (ii) = 0 on the copy; a decision for each unresolved code |
| C. Migration rehearsal | **NO-GO** (not verified) | 0 blockers and both checks on an authorized copy |
| D. Infrastructure, isolation, backups, alerts | **NO-GO** (not verified) | D1–D7, including EC-4 (authenticated mail), EC-5 (acknowledged alert), **FS-2** (database roles), **FS-3** (privileged access), **FS-6** (pilot mail off) and **FS-10** (nightly reconciliation alert) |
| E. Diagnostics reviewed | **NO-GO** (not verified) | signed review, including EC-1 step 1 (legacy transactions) and **FS-7** step 1 |
| F. Dry run + two-person approval | **NO-GO** (not done) | the clean dry run including EC-1 – EC-3, **FS-5**, **FS-7** step 2, **FS-8** and **FS-9**; then EC-2, EC-4 step 4, EC-6, **FS-1** and **FS-4** before a signed approval |

| | **A. Official AMFI file integrity and mapping validation on the pilot host** |
|---|---|
| Responsible | Platform operator 1 downloads; platform operator 2 downloads independently and checks |
| Exact test | 1. Both download `https://portal.amfiindia.com/spages/NAVAll.txt` on the pilot host; record the UTC times. 2. `sha256sum` both. 3. `amfi-import.ts --check` (§2.1). 4. On the copy (§2.2), apply the file, then run the mapping and AMC-identity queries (§2.1) after the dry-run imports |
| Expected | Same business date ⇒ identical hashes; `--check` exit 0, `layout: current8`, `errors: []`, ≥ 1,000 schemes, `feedDate` = the business date and ≤ 7 days old; every resolved KFintech code `isin_verified*`; every KFintech AMC identity basis `isin` |
| Evidence | URL, both UTC times, both hashes, both names; the `--check` JSON; the `amfi_feed_imports` row; both query results |
| Status | **NOT VERIFIED** |
| Stop if | Non-zero exit; a business date older than 7 days; same-date hashes differ; any KFintech code resolved other than by ISIN |

| | **B. Every in-scope KFintech scheme verified or explicitly held** |
|---|---|
| Responsible | Platform operator 1; compliance reviews the held list |
| Exact test | After the copy's dry-run imports (F part 1): (i) `SELECT c.rta_amc_code, c.rta_scheme_code, c.status, c.reason_code, c.amfi_scheme_code FROM scheme_rta_codes c WHERE c.tenant_id = '<firm>' AND c.rta = 'kfintech' ORDER BY c.status, c.rta_scheme_code`; (ii) `SELECT count(*) FROM transactions t WHERE t.tenant_id = '<firm>' AND t.source_feed = 'rta_validate_first' AND NOT EXISTS (SELECT 1 FROM scheme_rta_codes c WHERE c.tenant_id = t.tenant_id AND c.rta_amc_code = t.amc_code AND c.rta_scheme_code = t.rta_scheme_code AND c.status IN ('resolved_isin','confirmed') AND c.amfi_scheme_code = t.scheme_code)`; (iii) compare (i) with `kfintech-pilot-scheme-codes.csv` |
| Expected | (ii) = 0. Each unresolved code has a written decision: **held**, or approved by two operators **with the AMC's own scheme document**. Never by name |
| Evidence | Both query outputs; the decision per unresolved code; the differences from the CSV |
| Status | **NOT VERIFIED** (development: 114 / 118 mapped, 4 held, (ii) = 0) |
| Stop if | (ii) ≠ 0; an unresolved code without a decision; an approval citing only a name match |

| | **C. Migration rehearsal on an authorized, isolated copy of production** |
|---|---|
| Responsible | DBA |
| Exact test | 1. Written authorization for the copy. 2. Restore the latest backup into a NEW isolated instance (§2.3) that no application uses. 3. `check-migration-lock.mjs`; `migrate-all.ts --check`; `migrate-all.ts`; `check:rls`; `check:schema` (§2.1 / §2.2). 4. `SELECT filename FROM _applied_migrations ORDER BY filename DESC LIMIT 4` |
| Expected | `0 blockers`; the apply exits 0; both checks pass; the newest is `0244_session_mfa_runtime_role_recon_alerts.sql` |
| Evidence | Authorization reference; backup id and time; restore duration; every output; `SELECT * FROM _migration_runs ORDER BY started_at DESC LIMIT 5` |
| Status | **NOT VERIFIED** (development, final security patch: 282 applied from empty, 0 blockers, RLS 189 tables, schema 199 tables; immutability drill 14 / 14) |
| Stop if | Any blocker (an edited or missing applied migration), a partial attempt, or a failed check. Never edit an applied migration — a correction is a new migration |

| | **D. Infrastructure security, worker recovery, tenant isolation, backup and alerts** |
|---|---|
| Responsible | Infra engineer (D1–D3, D5, D7); DBA (D4, D6) |
| Exact test | **D1 S3:** §2.1 posture + anonymous 403; synthetic put / get / delete (§2.3). **D2 Mail:** §2.1 configuration and **EC-4**: the authenticated `Authentication-Results` header of a real KFintech mailback (our server's authserv-id, `dkim=pass`, `dmarc=pass`, a domain in `REGISTRAR_DOMAINS` confirmed by the owner); a non-registrar test mail is quarantined; mail for the pilot firm stopped for the pilot. **D3 Redis and worker:** persistence (§2.1); restart Redis, then the worker; a synthetic job completes; with Redis stopped an upload answers 503 and creates no job. **D4 Isolation:** role, ownership and connection checks (§2.1); `check:rls` on the copy. **D5 PAN-token key:** `RTA_STAGING_TOKEN_KEY` (or `ENCRYPTION_KEY`) only in the secret store; access list; rotation procedure. **D6 Backups:** retention and PITR (§2.1); C's restore time. **D7 Alerts:** **EC-5** — the sink on the worker host, the deliberate failure on the copy, and a named on-call person's acknowledgement |
| Expected | Each row as stated; nothing public; the app role is neither superuser nor BYPASSRLS; the alert arrives at the on-call channel |
| Evidence | Per row: command outputs, policy JSON (no secrets), message ids, worker log lines, alert id and time |
| Status | **NOT VERIFIED** (development: emulator and infrastructure tests of Phase 3G only) |
| Stop if | Any row fails; no alert sink; no on-call acknowledgement; no authenticated registrar header |

| | **E. Read-only production diagnostics reviewed by the responsible operator and compliance** |
|---|---|
| Responsible | DBA runs; platform operator 1 and the compliance reviewer review and sign |
| Exact test | `rta-historical-diagnostics.ts --tenant <firm> --json diag.json` and `scheme-master-duplicates.ts --tenant <firm>` (§2.1) on the read replica; **EC-1 step 1** (the firm's existing legacy transactions, numbers twice, line-keyed rows). Review: PAN-less placeholder clients; `MINOR:` keys and guardian folios; HUF rows; folios with two owners; reused registrar numbers; duplicate SIPs; Scheme Master duplicates |
| Expected | Both exit 0 and write nothing. Every finding has a signed decision: accept / fix outside the pilot / exclude the client. In development the same script found 9 `MINOR:` keys (MEDIUM, for review) and 791 masters-only folio legs with no statement date (expected without a holdings file); every other finding was 0 |
| Evidence | Both outputs (masked) and the signed review minutes |
| Status | **NOT VERIFIED** |
| Stop if | An unexplained two-owner folio, or a minor / HUF finding on an in-scope folio without a decision |

| | **F. Clean reconciliation dry run, then written two-person approval of a time-limited pilot** |
|---|---|
| Responsible | DBA and platform operator 1 (dry run); platform operators 1 and 2 plus the compliance reviewer (approval) |
| Exact test | **Part 1 — on the C copy** (it holds the firm's real legacy transactions): env `RTA_POSTING_MODE=controlled`, `RTA_PIPELINE_MODE=validate_first`, `RTA_POSTING_DATABASE=<copy>`. Run `rta-file-manifest.ts --arn` on every file (EC-3). Activate the firm on the copy with `registrars: ["kfintech"]` and `reportCodes: ["MFSD211","MFSD201"]` (§5.1, a request and a second operator's approval); release the copy's global halt the same way. Import the signed manifest: every MFSD211, then every MFSD201. After each file, `reconcile`. Then **EC-1 step 2–3** (legacy matching and collisions). Send one CAMS file and one MFSD203: each must be refused and recorded `blocked`. Re-import the whole manifest once. Run B. **Part 2 — approval:** **EC-2** inventory of the production queue and import rows (nothing unapproved), **EC-4 step 4** (no mail for the firm), **EC-6** controls; compliance signs §6 with every field complete; operator 1, signed in, files the §5.1 activation and release requests; operator 2, signed in, approves them; then `status` and the EC-6 query |
| Expected | Every `reconcile` exit 0. EC-1 as stated (matched legacy rows linked, not duplicated; every collision held with a decision; legacy fingerprint unchanged). CAMS: `covers kfintech only; a cams record is refused — nothing is posted`; MFSD203: `covers report types MFSD201 + MFSD211 only; a MFSD203 file is refused`; no batch written for either. Re-import: `already_posted` only, transaction count unchanged. B (ii) = 0. The production queue holds no unapproved job for the firm. `status`: `validate_first`, `postingEnabled: true`, `registrars: ["kfintech"]`, `reportCodes: ["MFSD201","MFSD211"]`, expiry = start + 14 days; the EC-6 query: executed requests, two people, both audit rows |
| Evidence | Per file: the manifest output, posted / rejected_recorded / matched_existing / held / unsupported counts, the reconcile output; the EC-1 query results and collision decisions; the CAMS and MFSD203 refusals; the re-import counts; the EC-2 inventory and any cancellations; the EC-4 alias / forwarding state; the request ids and payload hashes; the activation id, both operator ids, the ticket, the compliance signature, the `status` and EC-6 outputs |
| Status | **NOT DONE** — needs explicit written authorization |
| Stop if | Any reconcile ≠ 0; an EC-1, EC-2, EC-4 or EC-6 stop; the CAMS or MFSD203 file is not refused; the re-import adds a row; an unexplained held transaction; any operator's doubt |

---

## 4. Financial verification (DEVELOPMENT results — not production outcomes)

The sample manifest in §1.2, imported in the isolated database under the controlled gate with `registrars: ["kfintech"]`.

### 4.1 Rows → registrar transactions → outcomes

| | MFSD201 (May) | MFSD201 (Oct) | Total |
|---|---|---|---|
| Source data rows | 819 | 689 | **1,508** |
| Staged rows | 819 | 689 | 1,508 (0 rows without a transaction) |
| Unique registrar transactions (economic records) | 685 | 415 | **1,100** (0 in both files) |

| Outcome (each economic record exactly one) | Records | Source rows | Amount |
|---|---|---|---|
| Posted, processed | **1,073** | 1,398 | ₹1,02,27,740.48 |
| Recorded rejections — 2 refused instructions, 3 legs | **3** | 3 | ₹12,000.00 gross over the legs (₹7,000.00 per instruction) |
| Held corrections (folio consolidation) | **18** | 99 | ₹1,47,868.30 |
| Held unknown-code events | **6** | 8 | ₹5,43,384.29 |
| **Total** | **1,100** | **1,508** | |

The posting ledger holds **1,076 recorded transactions**:
- **1,073 processed** (₹1,02,27,740.48) — the only successful business;
- **3 rejected legs** (₹12,000.00), which are **2 refused instructions** (₹7,000.00). A failed STP is one instruction recorded as two legs that share the registrar's switch reference.

Rejections are recorded for the audit trail, with 0 units, and are excluded from business. Overlaps between categories: only the `120DEGP` event, which is both an unknown code and on an unresolved scheme, counted once.

**Verified against the ledger** (the `rta_final` rehearsal, read-only), the same query an operator runs on the copy:
```sql
SELECT count(*) AS recorded,
       count(*) FILTER (WHERE t.status = 'processed') AS processed, round(sum(abs(t.amount)) FILTER (WHERE t.status = 'processed'), 2) AS processed_amount,
       count(*) FILTER (WHERE t.status = 'rejected') AS rejected_legs, round(sum(abs(t.amount)) FILTER (WHERE t.status = 'rejected'), 2) AS rejected_leg_amount,
       count(DISTINCT CASE WHEN t.status = 'rejected' THEN CASE WHEN t.type = 'stp' AND nullif(btrim(t.raw_feed_row->>'switchRef'), '') IS NOT NULL
             THEN concat_ws('|', 'stp', t.investor_id, t.folio_number, t.order_date, abs(t.amount), btrim(t.raw_feed_row->>'switchRef')) ELSE t.id::text END END) AS rejected_instructions,
       count(*) FILTER (WHERE t.status NOT IN ('processed', 'rejected')) AS other_status
  FROM rta_posted_transactions p JOIN transactions t ON t.id = p.transaction_id WHERE p.tenant_id = '<firm>';
```
Result: 1,076 · 1,073 · 10227740.48 · 3 · 12000.00 · 2 · 0. The scheme CSV's column sums equal these figures (`tests/pilot-handover-csv.test.ts`).

The registrar's STP switch reference is a short number (one digit in the sample), unique only within one client's folio, date and amount — so an instruction is keyed on all of them, never on the reference alone.

**The Operations dashboard now shows the same split** (final security patch): its *Rejected transactions* card has **Rejected instructions** (2 · ₹7,000.00) and **Rejected legs** (3 · ₹12,000.00 gross) side by side, and every table row of an STP says which leg it is ("source leg, 1 of 2"). The per-kind counts, the value table, the monthly trend and the per-branch / per-RM counts count instructions, so a failed STP is never two rejections. The export (`/api/ops/export?kind=rejected`) keeps one line per leg with its `Instruction` reference, `Legs in instruction` and `Leg`. Checked on both rehearsal firms of `rta_p0` (the legacy-imported L and the clean P) against this ledger query, and by `tests/ops-rejected-instructions-db.test.ts` (dashboard, API, and two clients sharing the same one-digit reference).

### 4.2 Each recorded transaction against its registrar source (all 1,076 checked)

| Check | Differences |
|---|---|
| Transaction date = the registrar's Transaction Date | **0** |
| Original registrar scheme code (`rta_scheme_code`) = the file's Product Code | **0** |
| AMFI scheme code = the approved mapping of that registrar code | **0** |
| Scheme not approved (`resolved_isin` / `confirmed`) | **0** |
| Folio and AMC = the file's | **0** |
| Registrar transaction number = the file's | **0** |
| Amount = the registrar's reported amount | **0** |
| Status: `processed` for every economic record; `rejected` only for refused instructions | **0** wrong status (1,073 processed, 3 rejected) |
| A rejection carrying units | **0** |

### 4.3 Status and dates by type

| Status | Type | Count | Amount | Trade dates | Registrar codes |
|---|---|---|---|---|---|
| processed | SIP | 952 | ₹55,01,358.94 | 30-Apr-2026 → 07-Oct-2026 | 93 |
| processed | Lumpsum | 32 | ₹18,88,605.58 | 30-Apr-2026 → 06-Oct-2026 | 20 |
| processed | Redemption | 19 | ₹22,52,186.63 | 30-Apr-2026 → 07-Oct-2026 | 11 |
| processed | STP | 67 | ₹4,80,589.28 | 30-Apr-2026 → 07-Oct-2026 | 24 |
| processed | SWP | 3 | ₹1,05,000.05 | 04-May-2026 → 01-Oct-2026 | 2 |
| rejected | SIP | 1 leg = 1 instruction | ₹2,000.00 | 11-May-2026 | 1 |
| rejected | STP | 2 legs = 1 instruction (₹5,000) | ₹10,000.00 over the legs | 04-May-2026 | 2 (source `176ABRG`, destination `176MGGP`) |

**By month:**
- 2026-04: 9 processed.
- 2026-05: 673 processed + 3 rejected.
- 2026-09: 14 processed.
- 2026-10: 377 processed.

Per scheme code (processed and rejected separately, with leg roles and instruction amounts), see the CSV.

### 4.4 Duplicates, multi-lot and re-import

| Check | Result |
|---|---|
| A registrar identity in the ledger twice | **0** |
| A transaction in the ledger twice | **0** |
| A registrar transaction number twice for one AMC | **0** |
| A transaction without a ledger entry | **0** |
| Multi-lot redemptions | **15** posted, 340 lots, 13,286.593 units, ₹20,89,213.97; units ≠ lots **0**, amount ≠ lots **0** |
| Re-import of all four files | `already_posted` 685 + 391; transaction fingerprint identical (`f8a87458…`, 1,076); client, folio, ledger and SIP-rejection counts unchanged |
| Reconciliation (5 counts) | 0 after import, after the reversal drill, after undo, after re-import |

---

## 5. Emergency operations

**Disabling posting is not a financial-data rollback.** A pause, halt or expiry stops FUTURE writes only. Everything already posted stays exactly as it is until a two-person reversal (§5.5). Every procedure below was rehearsed on the isolated database; the observed result is noted.

**Who:** any ONE platform operator may stop (pause, halt, emergency). Starting again always needs TWO different operators.

### 5.1 Calls used below

Every control is on the API. Each operator uses their OWN platform session (the `aina_session` cookie of their own sign-in, with two-factor). Never paste a cookie into the ticket, and never use another person's session.

```bash
API=https://<app host>/api/super-admin/rta-pipeline
call() { curl -sS -X POST "$API" -H 'content-type: application/json' -b "aina_session=$AINA_SESSION" -d "$1"; echo; }

# START, step 1 — operator 1, signed in, files the request (no operator id is ever sent):
call '{"action":"request","control":{"action":"activate","tenantId":"<firm>","mode":"validate_first","postingEnabled":true,"registrars":["kfintech"],"reportCodes":["MFSD211","MFSD201"],"expiresAt":"<start + 14 days, ISO 8601>","changeRef":"<ticket>","reason":"<scope summary>"}}'
#   → 201 { request: { id, payloadHash, expiresAt, … } }  — paste id and payloadHash into the ticket
# START, step 2 — operator 2, signed in with their own session, reviews and approves exactly that request:
curl -sS "$API?view=requests&status=pending" -b "aina_session=$AINA_SESSION"
call '{"action":"approve","requestId":"<id>","payloadHash":"<payloadHash>","note":"<what was checked>"}'
# Either operator may withdraw / refuse a pending request:
call '{"action":"reject","requestId":"<id>","note":"<why>"}'
```

The other START requests have the same two steps:
- release a halt: `{"action":"release","scope":"<firm>|global|emergency","changeRef":"…","reason":"…"}`;
- reverse a batch: `{"action":"reverse","tenantId":"<firm>","batchId":"<batch id>","changeRef":"…","reason":"…"}`;
- undo a reversal: `{"action":"undo","tenantId":"<firm>","reversalId":"<reversal id>","changeRef":"…","reason":"…"}`.

A request expires (default 2 hours, at most 24) and is used once. The one-call `activate` / `release` of earlier versions answer 410.

STOPS are one operator, immediately:
- `call '{"action":"halt","scope":"<firm>|global|emergency","reason":"…"}'` (preferred: recorded with the signed-in operator);
- `call '{"action":"pause","tenantId":"<firm>","reason":"…"}'`, `call '{"action":"revoke","tenantId":"<firm>","reason":"…"}'`;
- `call '{"action":"cancel_import","tenantId":"<firm>","importId":"<import id>","reason":"…"}'` (§5.4);
- the CLI halt, when the API is unreachable: `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts halt --scope <firm>|global|emergency --by <operator id> --reason "…"` — recorded as "operator identity not server-verified".

The CLI cannot start anything: `release`, `undo` and `reverse --commit` exit 2. `status`, `requests` (read-only) and `reverse` (dry run) remain.

### 5.2 Pausing the pilot (one operator)

1. `call '{"action":"pause","tenantId":"<firm>","reason":"<why, ≥ 10 characters>"}'` — or `halt` the firm (§5.1).
2. Confirm: `rta-posting-recovery.ts status --tenant <firm>` shows the paused activation or the firm halt.
3. Resume (two operators, after EC-2): an `activate` request (§5.1) or a `release` request for `<firm>`, each approved by the other operator.

**Rehearsed:** paused → mode `held`; resumed by a two-person request → `validate_first`; a same-person approval was refused (403).

### 5.3 Emergency global halt (one operator)

- Every RTA write for every firm, legacy importer included: `call '{"action":"halt","scope":"emergency","reason":"…"}'` (or the CLI halt, §5.1).
- Posting only, all firms: `"scope":"global"`.
- A running batch finishes first; the halt waits for it, then stops every later one.
- Release (two operators): a `release` request for `emergency` by operator 1, approved by operator 2 (§5.1).

**Rehearsed** (`rta_p0`, signed-in operator sessions): emergency by one operator → `held` ("EMERGENCY SHUTDOWN of all RTA imports"); the requester approving their own release → 403; the other operator's approval → `validate_first`.

### 5.4 Handling queued jobs

While a firm is paused, halted, expired or under EMERGENCY:
- every queued import is **parked**;
- the worker checks before reading the file, so nothing is written;
- the file stays in storage;
- the import row returns to `uploaded` with the remark "Held — nothing was imported: …";
- the job re-checks every 5 minutes (`RTA_HOLD_RECHECK_MS`) and runs by itself on resume.

**No unapproved backlog may post automatically.** Parked jobs run by themselves the moment the firm resumes, so **every resume, release or new activation is preceded by EC-2**:
1. inventory every queued job and every `uploaded` / `parsing` import row of the firm;
2. compare them with the signed, approved file inventory (report code, file name, SHA-256, Report Date);
3. **cancel** each import not on it, with the firm still halted: `call '{"action":"cancel_import","tenantId":"<firm>","importId":"<import id>","reason":"not on the approved inventory, <ticket>"}'`. The row becomes `cancelled` (who, when, why; final), the queued / delayed job is removed from Redis, the file is kept. No Redis command by hand. A running (`parsing`) import cannot be cancelled: halt the firm, wait for it to park, then cancel;
4. re-inventory, then resume (two operators).

**Report types outside the activation are blocked by the software** (0243), wherever the file comes from — upload, authenticated registrar mail, re-run, a queued or resumed job, a retry: the import row is recorded `blocked` ("Blocked — this firm's activation covers report types MFSD201 + MFSD211 only; a MFSD203 file is refused — nothing is staged or posted"), the file is kept as its audit record, and nothing is staged or posted. Upload and mail decide from the registrar, kind and file name; the worker and the posting transaction decide from the file's CONTENT (its header layout), so a renamed or mislabelled file is blocked too.

**Do not:**
- re-upload a parked file — the same file posts once anyway;
- import parked files with `import-rta-local.ts`, which refuses a validate-first firm.

`failed` imports: read the row's `remarks`. `validate_first_refused` is a configuration error — fix the configuration and re-upload. It never falls back to the legacy importer. `blocked` is a report type or registrar outside the activation. `cancelled` is an operator's decision (§5.4 step 3).

### 5.5 Investigating a failed reconciliation

**Trigger:** `reconcile` exits 3; a `rta.posting.reconcile_alert` appears; or an ops alert `rta.reconciliation.discrepancy` / `firm_failed` / `failed` / `incomplete` arrives. Acknowledge the alert (`POST /api/super-admin/ops-alerts`, `{"action":"acknowledge","id":…,"note":…}`) only after step 1, naming what was done.

1. **Halt the firm immediately:** `halt` with `scope` = the firm (§5.1).
2. **Capture state:**
   - `reconcile --tenant <firm>` (which counts are non-zero);
   - `status --tenant <firm>` (recent batches);
   - `psql "$PROD_RO" -Atc "SELECT id, report_code, file_checksum, posting_state, posting_counts, posted_at FROM rta_staging_batches WHERE tenant_id = '<firm>' ORDER BY created_at DESC LIMIT 10"`.
3. **Map the counts to their meaning:**
   - `ledgerWithoutTransaction` — a ledger entry whose CRM row is gone;
   - `validateFirstTransactionWithoutLedger` — a pipeline-posted row with no ledger entry;
   - `postedOutcomeWithoutLedger` — a staged record marked posted with no ledger;
   - `ledgerIdentityTwice` — one registrar transaction posted twice;
   - `rejectedWithUnits` — a rejection carrying units.
4. **Find the batch** that introduced the difference: the newest batch posted after the last clean reconcile.
5. **Decide in writing:**
   - fix the cause outside the pilot (no hand edits of financial rows); or
   - reverse the batch (§5.6).
6. **Resume only** when `reconcile` exits 0, and only with a two-person `release` request.

### 5.6 Reversing a bad batch (two people)

The firm must be halted first. Reversal goes newest first; a batch others depend on is refused.

1. **Dry run** (read-only, either operator):
   ```bash
   ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts reverse --tenant <firm> --batch <batch id> --reason "…"
   ```
   Check `blocked: false`, the counts, and every `dependencies` value = 0.
2. **Commit:** operator 1 files a `reverse` request (§5.1); operator 2 approves it. Every removed row is archived whole in the append-only `rta_posting_reversals` (with the request id), with an audit-log row. The CLI cannot commit.
3. **Confirm:** `reconcile` exits 0. The transaction and ledger counts fall by exactly the dry run's counts.
4. **If the reversal itself was wrong:** an `undo` request for the reversal id, approved by the other operator. The firm must still be halted. Then `reconcile`.
5. **Resume:** a two-person `release` request, then re-import the corrected file.

**Rehearsed** (`rta_p0`, the clean firm P, the May MFSD201 batch, signed-in operator sessions):
- the firm halted by one operator → `held`;
- the dry run: 685 transactions, 685 ledger entries, 1 SIP-rejection record, `blocked: false`, nothing changed;
- the requester approving their own `reverse` request → 403;
- the other operator's approval reversed it: 1,076 → 391 transactions, reconcile 0;
- an `undo` request, approved by the other operator, restored 685 + 685 + 1: 1,076 transactions, the same amount total, reconcile 0;
- a two-person `release` → `validate_first`.

### 5.7 Confirming a database recovery

After any reversal, undo or restore:
1. `reconcile` exits 0.
2. `rta-posting-recovery.ts status` — the expected activation and halts.
3. Transaction count and fingerprint equal the expected values: `SELECT count(*), md5(string_agg(concat_ws(',', amc_code, folio_number, order_id, status, type, amount::text, units::text, order_date::text, scheme_code, rta_scheme_code), '|' ORDER BY order_id, amc_code)) FROM transactions WHERE tenant_id = '<firm>' AND source_feed = 'rta_validate_first'` (record it after each clean batch so there is something to compare with).
4. `check:rls` and `migrate-all.ts --check` on a restored database.
5. A database restore from backup is a DBA action into a NEW instance; it is never done over production, and never "fixed" by editing rows.

### 5.8 Expiring the pilot after 14 days

- The activation's `expiresAt` ends posting by itself. From that moment the firm is **held** ("this firm's RTA activation ended (revoked or expired); it stays paused …"). Its files park, and it **never** returns to the legacy importer by itself.
- **Within one business day of expiry:**
  1. Run `reconcile` and `status`; record the final counts and fingerprint.
  2. One operator records the end explicitly: `call '{"action":"pause","tenantId":"<firm>","reason":"14-day pilot ended <date>; awaiting review"}'`.
  3. Compliance and both operators review the pilot evidence.
- Extending, widening (another report type or registrar) or returning to the legacy importer (`mode: "off"`) are each a new two-person `activate` request. Returning to legacy is NOT a rollback of what was posted.

**Rehearsed:** an activation set to expire in 4 seconds read `validate_first` before and `held` after; the explicit pause record read `held`.

### 5.9 Daily pilot controls (every business day of the 14 days)

| # | Check | Command | Expected | Stop if |
|---|---|---|---|---|
| 1 | Yesterday's MFSD201 arrived | `npx tsx scripts/rta-file-manifest.ts <all pilot MFSD201 files> --calendar <start> <today> --arn <pilot ARN>` (EC-3) | every weekday `present`, or answered in the ticket | an unanswered `MISSING` business day for more than one business day; exit 2 for an ARN |
| 2 | Only approved report types reached the firm (enforced by the software since 0243; this checks it) | `SELECT report_code, rta, count(*) FROM rta_staging_batches WHERE tenant_id = '<firm>' AND created_at >= '<start>' GROUP BY 1, 2`, and `SELECT status, count(*) FROM rta_file_imports WHERE tenant_id = '<firm>' AND created_at >= '<start>' AND status IN ('blocked', 'cancelled') GROUP BY 1` | only `MFSD211`, `MFSD201` (`kfintech`) batches; each `blocked` import explained (who sent it) | any other report code or registrar in a batch → halt the firm (§5.2), then investigate with §5.5 |
| 3 | No mail imported for the firm | the EC-4 step 3 query since `<start>` | no `imported` row | any `imported` row |
| 4 | Every batch reconciles | `rta-posting-recovery.ts reconcile --tenant <firm>` | exit 0 | exit 3 → §5.5 |
| 5 | Processed vs rejected, from the ledger | the §4.1 ledger query | `other_status` 0; rejected legs carry 0 units | `other_status` ≠ 0 or a rejection with units |
| 6 | Held items are actionable | the Held screen (`/dashboard/rta-imports/held`); the four unresolved codes still listed on the Scheme codes screen | each held item has an owner and a next step | a held item nobody owns for two business days |
| 7 | Backlog | EC-2 inventory | nothing unapproved | any unapproved import not cancelled |
| 8 | The nightly reconciliation ran (FS-10) | the FS-10 `scheduler_state` and `reconcile_alert` queries | `last_run_at` today, status ok; any alert acknowledged by the named on-call person | no run recorded for the day; an unacknowledged alert |
| 9 | Rejections agree with the ledger (FS-9) | the FS-9 ledger query and the dashboard's Rejections tab for the pilot window | instructions and legs equal | any difference |
| 10 | Operator sessions (FS-1) | before any two-person action that day: the FS-1 queries and access-log pair | every session used came from login + 2fa/verify | a session without the pair; a password reset or session re-issue for an operator |

---

## 6. GO / NO-GO sign-off sheet

Every field is blank on purpose. Complete it in ink or in the ticket; do not pre-fill from development values.

| Field | Entry |
|---|---|
| Release commit verified (§0.1): full hash, lock-file SHA-256, ledger digest on the copy | |
| Pilot organization (legal name) | |
| Tenant id | |
| ARN (must equal the Agent / Broker Code in every file) | |
| Registrar scope | KFintech only — `registrars: ["kfintech"]` |
| Report-type scope | MFSD211 + MFSD201 only — `reportCodes: ["MFSD211","MFSD201"]` |
| Authorized pilot dates: start (date, time IST) — set by the business owner's written authorization | |
| Authorized pilot dates: end = `expiresAt` (start + 14 days at most) | |
| Approved file scope: per file, report code (MFSD211 / MFSD201 only), file name, SHA-256, data rows, Report Date (`rta-file-manifest.ts` output reference) | |
| Approved backlog inventory before activation (EC-2): reference, and imports cancelled | |
| RTA mail for the firm stopped for the pilot (EC-4 step 4): how, and by whom | |
| On-call destination that acknowledged the test alert (EC-5): system, rota, alert id | |
| Activation request (EC-6): request id, `payloadHash`, filed at (operator 1's session), approved at (operator 2's session) | |
| Global-halt release request (EC-6): request id, `payloadHash` | |
| Database app role and worker role (FS-2), as named in `APP_DATABASE_URL` on each host | |
| Reconciliation schedule (FS-10): `RTA_RECON_TIME_IST` value (default 06:30 IST; the host's zone does not matter) and the worker log line confirming it | |
| On-call monitoring owner (FS-10): name, platform user id, rota, alert system, uptime and heartbeat monitors | |
| Named holders of privileged database / emergency-CLI access (FS-3) | |
| First platform operator (requester): name, user id | |
| Second platform operator (approver): name, user id | |
| DBA: name | |
| Infrastructure engineer: name | |
| Compliance reviewer: name | |
| Responsible business owner who authorizes the pilot: name, role | |

**Who records which check** (names are filled in by the authorizer; a person may hold more than one role, but platform operator 1 and platform operator 2 are always two different people):

| Role | Name | Checks owned |
|---|---|---|
| DBA | | C; E; FS-2, FS-3 (database), FS-4 step 1, FS-7 |
| Infrastructure engineer | | D1–D7; FS-1 step 4 (access logs), FS-2 step 1, FS-3 (hosts), FS-4 step 3, FS-6, FS-8 (Redis), FS-10 step 1 |
| Platform operator 1 (requester) | | A (first download); B; F part 1; FS-4 step 2, FS-5, FS-8, FS-9, FS-10 (daily) |
| Platform operator 2 (approver) | | A (second download); the approvals in F part 2 |
| Compliance reviewer | | review and signature of E, F, FS-1, FS-3, FS-4, FS-5, FS-7 and the §6 sheet |
| On-call monitoring owner | | acknowledgement in EC-5 / FS-10; the uptime and heartbeat alerts during the pilot |
| Responsible business owner | | the written pilot authorization, after every row below is PASS |

| Condition | Result (PASS / FAIL / NOT VERIFIED) | Evidence reference (ticket / document) | Initials |
|---|---|---|---|
| A. AMFI integrity and mapping | NOT VERIFIED | | |
| B. Schemes verified or held | NOT VERIFIED | | |
| C. Migration rehearsal on an isolated copy | NOT VERIFIED | | |
| D. Infrastructure, isolation, backups, alerts | NOT VERIFIED | | |
| E. Diagnostics reviewed | NOT VERIFIED | | |
| F. Dry run clean + two-person approval | NOT DONE | | |
| EC-1 legacy matching and collisions (in E / F) | NOT VERIFIED | | |
| EC-2 approved backlog inventory (in F) | NOT VERIFIED | | |
| EC-3 daily MFSD201 completeness (in F, then daily) | NOT VERIFIED | | |
| EC-4 authenticated registrar mail domains (in D) | NOT VERIFIED | | |
| EC-5 alert acknowledged by real on-call (in D) | NOT VERIFIED | | |
| EC-6 operator identities and separate approvals (in F) | NOT VERIFIED | | |
| FS-1 operators' live sessions passed MFA (in F) | NOT VERIFIED | | |
| FS-2 app / worker roles cannot bypass RLS; not owner or superuser (in D) | NOT VERIFIED | | |
| FS-3 privileged database and emergency-CLI access restricted and audited (in D) | NOT VERIFIED | | |
| FS-4 no alternate activation path (in F) | NOT VERIFIED | | |
| FS-5 MFSD211 / MFSD201 restriction at upload, queue and commit (in F) | NOT VERIFIED | | |
| FS-6 pilot email ingestion disabled (in D) | NOT VERIFIED | | |
| FS-7 every legacy match checked for canonical scheme identity (in E / F) | NOT VERIFIED | | |
| FS-8 cancelled import cannot resume after Redis recovery (in F) | NOT VERIFIED | | |
| FS-9 rejection counting consistent with the ledger (in F, then daily) | NOT VERIFIED | | |
| FS-10 nightly reconciliation alert reaches an accountable person (in D) | NOT VERIFIED | | |
| G-1 guardian links: E-8 counts reviewed and the fix decided (`B1_FINAL_QUALIFICATION.md` §L) | OPEN | | |

**Release rule (owner, 2026-10-10).** No firm is activated unless ALL of these hold, each with its evidence in the ticket:

| # | Requirement | Evidence | Met (yes / no) | Initials |
|---|---|---|---|---|
| R1 | Every required test passed with recorded evidence: A–F, EC-1 – EC-6, FS-1 – FS-10 above | the rows above, all PASS | | |
| R2 | Two separate MFA-verified platform operators approved the activation | FS-1 (c) and EC-6 queries: two people, MFA methods, verified < 12 h before the decision | | |
| R3 | Compliance signed off | the compliance signature below | | |
| R4 | The responsible business owner explicitly authorized the pilot, with its dates | the written authorization (reference) and the authorized dates above | | |
| R5 | Emergency halt and recovery verified | §5.3 halt + two-person release, §5.6 reversal + undo, §5.7, on the copy; FS-8 | | |
| R6 | Financial reconciliation clean | every `reconcile` in F = 0; a `schedule` / `catch_up` run `ok` in `rta_reconciliation_runs`; B (ii) = 0 | | |

**A completed checklist does not by itself authorize deployment or activation.** Deployment, the production migration and the activation each need their own written authorization.

**Final authorization:**
- ☐ **GO** for the 14-day KFintech transaction-only pilot. Every condition and check above (A–F, EC-1 – EC-6, FS-1 – FS-10) is PASS with evidence recorded by its named role, and R1–R6 are met.
- ☐ **NO-GO.** Reason: ________

The pilot validates verified KFintech transactions only. It makes no claim about AUM, holdings, the SIP Book, the SIP Master, CAMS or any other module.

| Signature | Name | Date |
|---|---|---|
| Platform operator 1 | | |
| Platform operator 2 | | |
| Compliance reviewer | | |
| Responsible business owner (pilot authorization) | | |

**Recommendation from development:** **NO-GO until A–E are PASS with production evidence, EC-1 – EC-6 and FS-1 – FS-10 are evidenced, and F is signed.** The five software defects of §7.1 (migration 0243) and the three weaknesses of §7.3 (migration 0244) are fixed in development and tested on isolated databases; none of that is production evidence. The residual risks in §7.2 remain and are held by the stated controls.

---

## 7. Software defects — fixed in the final security patches (migrations 0243 and 0244)

**7.1 The five defects found in the corrections round.** Fixed in development and tested on isolated databases only; not deployed, not migrated in production.

| # | Defect | Fix | Evidence (development) |
|---|---|---|---|
| 1 | The Operations dashboard counted each rejected STP **leg** as a rejection and added both legs | Rejected **instructions** and **legs** shown separately; every other rejection count on the dashboard counts instructions; an instruction is keyed on client, folio, date, amount and the registrar's reference; the export keeps one line per leg with its instruction | `tests/ops-rejected-instructions-db.test.ts` (4); both `rta_p0` firms: 2 · ₹7,000.00 and 3 · ₹12,000.00 (§4.1) |
| 2 | The activation was scoped by registrar only; MFSD203 / MFSD243 / MFSD230 could post | `rta_pipeline_activations.report_codes` (required with posting); refused at upload, mail dispatch and re-run (recorded `blocked`), and from the file's content before staging, in the worker (incl. retries and resumed jobs) and inside the posting transaction | `tests/rta-report-scope-db.test.ts` (7); `rta_p0`: the six real out-of-scope files refused, 0 batches, CRM unchanged |
| 3 | Two-person approval authenticated only the approver; the CLI trusted flags | Immutable two-person control requests: requester and approver are separate signed-in two-factor platform sessions; payload hash, expiry, single use; the database refuses a start not cited by a request executed in the same transaction; CLI starts disabled | `tests/rta-two-person-db.test.ts` (11); every control test migrated to requests; `rta_p0` activation, releases, reversal and undo by request |
| 4 | Legacy matching ignored the scheme | Every fact compared, scheme identity through approved mappings (historical codes, verified AMC successors); mismatches held `identity_conflict` naming what differs; legacy rows never changed | `tests/rta-legacy-match-db.test.ts` (10); `rta_p0`: 1,061 linked, 0 conflicts (EC-1) |
| 5 | A removed parked job was later marked `failed` "worker restarted mid-parse" | `cancel_import`: one signed-in operator; status `cancelled` with who / when / why, audit row; job removed from Redis by the same call; final in the database; the worker and re-run refuse it | `tests/rta-cancel-import-db.test.ts` (4, incl. real Redis) |

**7.3 The three weaknesses found after the freeze — fixed in migration 0244** (development and isolated databases only; not deployed, not migrated in production):

| # | Weakness | Fix | Evidence (development) |
|---|---|---|---|
| 1 | MFA was read from the user (`two_fa_enabled`); a password-reset session and a pre-enrolment session passed every operator check | MFA recorded on the session at creation (`auth_method`, `mfa_verified_at`), immutable in the database; reset / signup / invite / re-issued sessions are not MFA; security changes downgrade every session; admin step-up re-issues an MFA session; both participants of every start (and cancel, acknowledgement) need a live session verified within 12 h and after the last security change, in the API and the database; audit without secrets | `tests/auth-mfa-session-db.test.ts` (7): both bypasses before (accepted) and after (refused), revocation, staleness, downgrades, forgery refused |
| 2 | Without `APP_DATABASE_URL` the web and worker ran as the migration role; the posting gate did not refuse a table owner | Production requires `APP_DATABASE_URL` (no fallback); `DB_TOOLING` isolates migration credentials; role inspection (superuser, BYPASSRLS, CREATEROLE, ownership incl. membership, privileged memberships, trigger skipping, dangerous grants) at worker start, web start and inside every posting transaction; non-secret diagnostics | `tests/runtime-db-role-db.test.ts` (9); `tests/rta-feed-and-scripts-db.test.ts` (a production script now refuses at the database layer without `APP_DATABASE_URL`) |
| 3 | The reconciliation alert was one fire-and-forget POST; a run that could not run, crashed or was missed was only in the console; the schedule followed the host clock | Recorded runs per slot and firm; persisted, deduplicated alerts with bounded retries, escalation and named acknowledgement; missed / crashed / incomplete detection; a worker-independent health endpoint and an external heartbeat; explicit 06:30 Asia/Kolkata | `tests/rta-reconciliation-alerts-db.test.ts` (11); `tests/rta-recovery-db.test.ts` (reconcile alert still audited) |

Also fixed while rehearsing FS-8: a cancel made while Redis was down replayed its queue sweep when Redis returned (see FS-8).

**7.2 Residual risks (not defects of this patch; held by controls):**

| Risk | Control |
|---|---|
| Anyone holding the production database owner / superuser credentials can disable triggers and write rows directly; no application control can stop that | DBA access is break-glass, logged and reviewed (D4); the app role is neither superuser nor BYPASSRLS |
| The platform scheme / AMC approvals are two-person in the API (control requests), but the database does not refuse a direct write to `scheme_registrar_map` / `registrar_amc_identity` without a request | Same as above; those tables are reviewed in A / B |
| The CLI `halt` names its operator on the command line (recorded "not server-verified") | Use the API halt when it is reachable; a halt only stops |
| ~~MFA read from the user; reset and pre-enrolment sessions passed~~ — **fixed in 0244** (§7.3). Remaining: a backup code is a valid second factor by design | FS-1: backup-code use is a recorded exception |
| ~~Privileged database fallback~~ — **fixed in 0244** (§7.3). Remaining: the role check runs at start and before posting; a grant added to the running role later is caught at the next posting transaction or restart, not instantly | FS-2 on every host; DBA change control on grants (D4) |
| ~~Fire-and-forget reconciliation alert~~ — **fixed in 0244** (§7.3). Remaining: alerts reach people only through the configured webhooks and the external monitors; with none configured they are recorded and the health endpoint answers 503, but nobody is paged | FS-10 step 1: both webhooks, the heartbeat service and the uptime monitor configured; the named on-call person acknowledges the test alert |
| A run checks firms one by one; a single firm taking longer than `RTA_RECON_STALE_SEC` (15 min) between heartbeats is marked `incomplete` and caught up | Alert names it; raise the setting if real firms need longer |
| An in-scope MFSD211 / MFSD201 arriving by mail is imported without the signed inventory | Mail for the firm stopped for the pilot (EC-4 step 4) |
| A cancel while Redis is unreachable cannot remove the job (`queueChecked: false`) | The job stays queued and the worker refuses it when it fires (FS-8, rehearsed end to end); re-run the cancel when Redis is back to remove it (EC-2) |

---

## Appendix — rehearsal notes

- All rehearsal steps ran on `rta_handover` and then `rta_final`, isolated databases dropped afterwards.
- Corrections round (`rta_final`): ledger-based CSV export; the §4.1 ledger query; the legacy-then-validate-first rehearsal and the collision drill (EC-1); the operator-identity query (EC-6). The queue inventory and removal commands (EC-2) ran against a local Redis with real BullMQ jobs, and `rta-file-manifest.ts` against the four sample files (EC-3).
- One code change in the corrections round: `lib/rta/posting/gate.ts` now loads its database controls inside the posting check rather than at module load. This lets the read-only `rta-file-manifest.ts` run without a database; posting behaviour is unchanged.
- Final security patch (`rta_p0`, built from a copy of the development schema at 0243, AMFI 07-Oct-2026 applied): the legacy firm L built with `import-rta-local.ts --commit` (1,061 rows), then validate-first by two-person activation (EC-1 cross-tab); the clean firm P (1,073 + 3); the six out-of-scope real files refused; the recovery and EMERGENCY drill with signed-in operator sessions (§5.3, §5.6); the Operations dashboard read on both firms (§4.1). Regression on a database built from empty (`mfd_ci`, 281 migrations): every check script, 991 tests passed (1 skipped: the emergency drill, run on its own and passing), the immutability drill 14 / 14.
- Final security patch 0244 (`rta_fs7`, built from empty with 282 migrations, the restricted app role, AMFI 07-Oct-2026): the FS-7 rehearsal on legacy firm L and collision firm X (§2.5 FS-7). FS-8 as one combined test against a dedicated `redis-server`. Regression on a database built from empty (`mfd_ci`): every check script, the full test suite, the emergency drill on its own, the migration immutability drill (results in the patch report).
- The rehearsal operators were synthetic test users (two-factor flag on; in 0244 rehearsals, sessions inserted as MFA-verified, which the database accepts only within a minute of creation and only for an enrolled user) in isolated databases only; no production identity was created or used.
- The rehearsal firm's activation and operators were synthetic.
- **Observation (not a defect in the production path):** calling the import library directly while a firm is paused still writes a staging batch (staging tables only) before the gate refuses posting. The worker, the only production path, checks the regime first and parks the job without reading the file.
- **Operator items found while preparing this package:**
  1. The owner must confirm the DKIM `d=` domains the registrars sign with (D2).
  2. Alert channels must be set (`OPS_ALERT_WEBHOOK_URL`, `OPS_ALERT_ESCALATION_WEBHOOK_URL`, `OPS_HEARTBEAT_URL`) and `/api/health/rta-reconciliation` monitored externally, or alerts are only recorded (D7, FS-10).
  3. Every control is on the API, so each operator needs their own platform session with two-factor (§5.1).
