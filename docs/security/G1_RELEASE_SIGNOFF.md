# G-1 guardian hotfix — release sign-off sheet

Prepared 2026-10-15, updated 2026-10-16. PR: https://github.com/AinaTech24/aina-crm/pull/19 (draft, unmerged, not deployed).
Nothing in this sheet has been executed against production. It is filled in by the people named in §1.

## 0. State at preparation
| Item | Value |
|---|---|
| Code commit (tested) | `82ec4b29` — merge of main `523143bc` into the hotfix, after `de7caf27` (legacy minors, `G1_GUARDIAN_HOTFIX.md` §16) |
| PR head | `82ec4b29` plus the docs-only commit that adds this sheet (the PR shows the exact head; nothing but `docs/` after `82ec4b29`) |
| Integrated `origin/main` | `523143bc` (re-check §3 step 2 at release time) |
| Migrations added by the hotfix | **None.** 0235 / 0236 / 0237 are main's, byte-identical (0236 sha256 `8a17d0dc…63e4c1`, 0237 `e7dc2b8d…2dab3`) |
| Previous blockers | Legacy minors — fixed (`G1_GUARDIAN_HOTFIX.md` §16). Main's upload / expiry conflicts — resolved (§17) |
| Local qualification | DB suite 658 / 658 (0 skipped) as `mfd_app`; build, lint, types, static checks pass; browser 52 / 52 |
| Deployable now | **Code-ready; NOT authorized.** Needs every line of §1 and the owner's written authorization |

## 1. Sign-off (every line must be complete before PR #19 is merged)
| # | Role | Check | Name | Date / time (IST) | Result / evidence ref | Signature |
|---|---|---|---|---|---|---|
| 1 | Independent technical reviewer (not an author) | Reviewed the final PR diff (file count as GitHub shows it), `G1_GUARDIAN_HOTFIX.md` §8, §10, §14–§17; CI green on the FINAL head; head contains current main | | | | |
| 2 | DBA | Ledger read (§2.2), backup + PITR (§2.3), impact SQL baseline run read-only and stored (§2.4–2.5) | | | | |
| 3 | AWS / deployment operator | Running SHA recorded (§2.1); change lock FREE (§2.6); freeze announced; nobody else changing production | | | | |
| 4 | Privacy / compliance reviewer | Read impact output; decided on suspected disclosures (§8 history / AI reads, §2 out-of-book links, §6 proposals); approved the interim policy below | | | | |
| 5 | Business owner | Approved the interim policy below; accepted that guardians without an eligible verified CRM record cannot be linked for MF purposes and that affected minors are blocked from MF proposals until linked; written authorization to merge | | | | |

**Interim policy for approval (owner + compliance):** A minor investor account must have a uniquely identified,
eligible and verified guardian relationship and its own confirmed suitability assessment before an MF proposal may
proceed. Until a separate evidence-backed external-guardian verification workflow exists, guardians must have a
suitable verified CRM record before linkage. Do not create fictitious investments or portfolios to register a
guardian (a guardian may be an ordinary client record holding only their own identity details).

## 2. DBA / operator commands (read-only; run only with authorization)
Sign in first: `aws sso login --profile aina-ops` (read-only) and, for the lock, `aws sso login --profile aina-deploy`.

2.1 **Running SHA** (anonymous health probe):
```
curl -fsS https://crm.ainatech.in/api/health | jq '{status, build, builtAt}'
```
`build` must equal the deploy run's commit (GitHub → Actions → "Deploy to AWS (EC2)" → latest run → head SHA).

2.2 **Migration ledger** (read-only role, never the master login):
```
PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -Atc \
  "SELECT count(*), max(filename), max(applied_at) FROM _applied_migrations"
```
Record the count and last filename BEFORE the merge. The hotfix adds no migration. Expected: BEFORE = whatever main's last
deploy left (if production runs `523143bc`, the last file is `0237_kyc_checks.sql`); AFTER = BEFORE, because every migration
in this release is already on main. If BEFORE ends earlier (e.g. `0235` or `0236`), production is behind main and the deploy
will also apply main's pending 0236 / 0237 — main's change, not this hotfix's; record it and confirm with the DBA before merging.
Never run a migration by hand; the deploy's own migrate step is the only writer.

2.3 **Backup and point-in-time recovery**:
```
aws rds describe-db-instances --profile aina-ops --region ap-south-1 \
  --query 'DBInstances[].{id:DBInstanceIdentifier,retentionDays:BackupRetentionPeriod,latestRestorable:LatestRestorableTime}'
aws rds describe-db-snapshots --profile aina-ops --region ap-south-1 --db-instance-identifier <id> \
  --snapshot-type automated --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[0].{id:DBSnapshotIdentifier,at:SnapshotCreateTime,status:Status}'
```
Pass: retention ≥ 1 day, `LatestRestorableTime` within the last 10 minutes, newest automated snapshot `available` and < 24 h old.

2.4 **Guardian impact baseline** (read-only):
```
PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -v ON_ERROR_STOP=1 \
  -f docs/security/g1-guardian-impact.sql > g1-impact-$(date +%Y%m%d-%H%M).txt
```
Use the file from the FINAL PR head (§9 counts legacy minors by gate state).

2.5 **Record**: date, operator, host, file name and SHA-256 of the output; copy into the change record ONLY the per-firm
counts of §1, §2, §3, §5, §7, §8, §9 and the masked ids of §4/§6 (last 6 characters). No PAN, name, contact or figure.
Any non-zero §2 `guardian_outside_actor_book_today`, any §6 row with `own_assessment_before_send = false`, and any
web-log read of `GET /api/audit?entityType=investor` or `/api/ai/qrr-commentary` by a user outside the client's book go
to the privacy/compliance reviewer (sign-off 4).

2.6 **Change lock FREE** (do NOT acquire it — the deploy job takes and releases it):
```
bash scripts/prod-change.sh status
```
Exit 3 / "held" → stop and wait.

## 3. Controlled deployment runbook (release operator)
1. Confirm the final release SHA = PR #19 head; CI green on that SHA (all `core / …` checks).
2. `git fetch origin main && git merge-base --is-ancestor origin/main <PR head>` must succeed. If not: STOP — the branch
   must be re-integrated and re-qualified (developer), then restart at step 1.
3. Sign-offs 1–5 complete; §2.2, §2.3, §2.6 pass and are recorded.
4. Mark PR #19 "Ready for review" (no deploy).
5. Merge ONLY after the owner's written authorization (sign-off 5). The merge push to `main` starts "Deploy to AWS (EC2)".
6. Watch the run: `verify` → `build` (verified artifact) → `deploy` (SSM). Success ends "Deploy OK — active colour … commit
   <sha>". A failure leaves the previous colour serving.
7. §2.1: `build` = the merge commit SHA.
8. Run §4 post-deployment validation.
9. §2.2: ledger as expected (no migration from this hotfix).
10. `bash scripts/prod-change.sh history` shows the pipeline acquired and released the lock with health 200.
**Recovery:** prefer a forward fix. A rollback to a pre-hotfix build re-opens G-1 and needs SEPARATE written risk
acceptance from the owner plus the protective containment in `docs/security/G1_RELEASE_RUNBOOK.md` §2 (and a stated end
time). No migration is reversed: the hotfix added none.

## 4. Post-deployment validation (designated test firm, data wall ON; no client data)
| # | Check | Expected |
|---|---|---|
| 1 | `GET /api/health` | 200, `build` = release SHA |
| 2 | RM A types a guardian PAN belonging to RM B's client on a new minor | 201, warning "NOT VERIFIED", no link, nothing about RM B's client in the response |
| 3 | Same minor retried | 409, one neutral sentence, still one record |
| 4 | RM A picks RM B's client as guardian by id | 400, generic message |
| 5 | MF proposal (individual) for that minor, own assessment recorded | send 412 `field: guardian`; marking it "sent" in the CRM also 412 |
| 6 | Family proposal of a family containing that minor | 412 |
| 7 | Link a valid guardian client in RM A's book; minor has no own assessment | 412 `field: riskProfile` |
| 8 | Record the minor's own assessment | MF proposal passes the minor gate |
| 9 | `POST /api/investors/<minor>/guardian-verification` (RM and owner) | 405; no "Confirm guardian" on any page |
| 10 | RM A `GET /api/audit?entityType=investor&entityId=<RM B client>` | 404 |
| 11 | Minor client page / Risk Profiles / export | the minor's own risk only; guardian's only as "Guardian's own risk profile", only to staff who may open the guardian |
| 12 | Impact SQL §2 for links made after deploy | `guardian_outside_actor_book_today` = 0 |
| 13 | Legacy minor (no guardian on record, or linked to a shared-PAN / merged / HUF record), own assessment current | MF proposal send and "mark sent" 412 `field: guardian` |
| 14 | Risk-profile upload for that minor | 409 `field: guardian`, nothing stored |
| 15 | After a valid link: upload the minor's own assessment with an Expire On | recorded on the minor; the minor's expiry = that date, not the guardian's; adult upload unchanged |
Monitor for 14 days: 5xx on `/api/investors*`, `/api/proposals/*`, `/api/audit`; volume of 412 `field: guardian`
(expected: legacy minors now blocked); daily impact SQL §2, §7, §9. Escalate suspected historical disclosures to compliance.

## 5. RTA
Candidate `44468322` stays frozen: no tag, no merge, no deploy, no production migration, no financial posting. When the RTA
release is next requalified it must include: the registrar guardian-link validation in `src/lib/rta/import.ts` (step 6),
the legacy-minor rule in `lib/investors/guardian-verification.ts`, `lib/proposals/minor-gate.ts`, and the minor-safe
risk-profile upload / expiry (`G1_GUARDIAN_HOTFIX.md` §17).
