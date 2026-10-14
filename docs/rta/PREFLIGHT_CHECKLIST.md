# KFintech pilot — preflight execution checklist

**Production decision: NO-GO.** Nothing here authorizes a deployment, a production migration, an activation or financial posting.

This is the executable view of `docs/rta/PILOT_HANDOVER.md`. **The handover governs**: every row names the section with the full SQL, the expected results and the stop conditions. Statuses: **PASS** (verified with recorded evidence), **FAIL** (an executed check failed), **NOT VERIFIED** (not yet executed or not provable), **N/A** (excluded by the approved pilot scope). NOT VERIFIED is never PASS.

## Environment, as the repository describes it

Read from Terraform, the deploy workflow and the compose file on `main` (`terraform/*.tf`, `.github/workflows/deploy.yml`, `docker-compose.prod.yml`). The operators confirm each value in PR-1 to PR-4.

| What | Value |
|---|---|
| AWS account / region | `972971302420` / `ap-south-1` |
| Production instance | EC2 `i-059673ee0da4f877a`, app at `~/app`, `docker compose -f docker-compose.prod.yml` (blue-green web, `worker`, `redis` with AOF, Caddy) |
| Production database | RDS `mfd-growth-os-db`, PostgreSQL 16, database `mfd`, migration role `mfd_master` (only in `~/app/.env.migrate`), app role `mfd_app` (`APP_DATABASE_URL` in `~/app/.env.production`); subnet group `mfd-growth-os-db`; security group `mfd-growth-os-db` (5432 from the web security group only) |
| Buckets | uploads `mfd-growth-os-uploads-<suffix>` (versioned, AES256, public access blocked, SES may write); deploy artifacts `aina-crm-deploy-artifacts-972971302420` |
| Registrar mail | SES receipt rule set `aina-rta-inbound`, rule `crm-ainatech-in-to-s3` (recipient domain `crm.ainatech.in`, scanning on, `tls_policy = Optional`) → uploads bucket prefix `rta-inbound/` → the `mail` worker group. **Inbound mail is live in production today.** Optional TLS means a sending server may deliver unencrypted: recorded as a risk; sender proof stays DKIM / DMARC (EC-4) |
| Infra alarms | CloudWatch `aina-*` alarms → SNS `aina-crm-production-alerts` (email). They do **not** carry RTA reconciliation alerts; those are the `OPS_ALERT_*` webhooks (FS-10) |
| Deploy path | every push to `main` or `deploy/aws` deploys and **migrates** production; so does `scripts/manual-deploy.sh <commit>`. Production changes take the change lock: `scripts/prod-change.sh status / acquire / release` (on a `main` checkout) |

**Conventions.** Read-only SQL runs as `PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -Atc "…"`; `$PROD_RO`, `$COPY_ADMIN` and `$COPY_APP` are connection strings each operator keeps in their own shell — never pasted into the ticket or chat. Run the operator CLIs (`npx tsx scripts/…`) in a shell **without** `NODE_ENV=production` (or `APP_ENV` / `ENVIRONMENT=production`): the release refuses migration credentials in a production-marked process by design (FS-2), so a refusal there is expected, not a fault. Commands on the instance run in an SSM session (`aws ssm start-session --target i-059673ee0da4f877a`) and print counts or names, never values. `<firm>` is the pilot tenant id from the §6 sheet.

---

## 1. Release verification — 2026-10-12, updated 2026-10-14, from the repository

| # | Check | Result | Status |
|---|---|---|---|
| RV-1 | Remote annotated tag `rta-kfintech-pilot-candidate-2026-10-10` | tag object `2f7aab47c34ad78d5c5d45fd441e7fced40afede`, type `tag` | PASS |
| RV-2 | Peeled commit = approved SHA | `c26e67636f8bbfac3d80eed30152d7ac1af0aa4f` | PASS |
| RV-3 | Source fingerprint | tree `8ecfbc38…`; `src/` `257005da…` and `drizzle/migrations/` `73a2b7f5…` identical to `6590fe5` | PASS |
| RV-4 | Migrations vs lock | 282 files, 282 lock entries, 0 mismatches; newest `0244_session_mfa_runtime_role_recon_alerts.sql`; lock SHA-256 `5a2a3288…7c67438a7`; ledger digest `7a166d11628bc4325d58e2e73bef1ebc` | PASS |
| RV-5 | Documentation revision recorded separately | handover revision `98d5a0f`, recorded in handover §0.1 (the tag message is one line and does not name it) | PASS |
| RV-6 | No unintended code change in the candidate | `6590fe5..c26e676` changes only `docs/rta/PILOT_HANDOVER.md` | PASS |
| RV-7 | **Candidate vs production's code** | **`main` (production's deploy branch) has 36 commits the candidate lacks**; the migrations are not affected (`main`'s 270 files = the candidate's first 270, byte for byte). Trial merge conflicts in 9 files incl. `src/lib/rta/{import,kfintech,parsers,process}.ts`. Deploying `c26e676` would remove those 36 changes from production — **blocker B-1** (handover §0.1) | **FAIL** for `c26e676` — reconciled candidate in RV-8 – RV-12 |
| RV-8 | Reconciled candidate exists (handover §0.1a) | `f61d20209a4531c76cd51b9d74dc4cdba0a07387`, a merge of `main` `a16628c5` and the release head `5055a31b` | PASS (development) |
| RV-9 | Candidate contains production and the release | `a16628c5` and `c26e676` both ancestors | PASS (development) |
| RV-10 | Migrations unchanged | `git diff c26e676 f61d202 -- drizzle/` empty; tree `73a2b7f5…`; lock, concatenation and ledger digest as RV-4; a `main`-state database (270) upgrades by 12 files to the same ledger digest and an identical schema | PASS (development) |
| RV-11 | Production's deploy, change-lock, Terraform, SQL-binding and log-safe files kept | byte-identical to `main` | PASS (development) |
| RV-12 | Owner review of the candidate and its decisions I-1 – I-4 (`docs/rta/B1_INTEGRATION.md`) | integration direction accepted for development; I-1 – I-3 hold, I-4 conditional (owner, 2026-10-12) | PASS (decisions) |
| RV-13 | Stabilised candidate (handover §0.1b) | `aab763c420466b6a70a3ad62f20530f7a334153f`: `f61d202` + stabilisation + `main` `88bc0178` merged; evidence `docs/rta/B1_STABILISATION.md` | PASS (development) |
| RV-14 | Tests stable | 15 consecutive clean full-suite runs on three trees (5 on the final); `ci.yml`'s two jobs green under their own env (Node 20) | PASS (development) |
| RV-15 | Migrations | 283 = `main`'s 271 byte-identical + release 12 unchanged; upgrade from a 271-state database = fresh schema, ledger `eb49785a924cc2e31b2dc4d2e0b2b4f9` | PASS (development) |
| RV-16 | Owner review of `aab763c4` | conditionally accepted for continued qualification (owner, 2026-10-14) | PASS (conditional) |
| RV-17 | Final candidate (handover §0.1c) | `d7aa60a8f50b0947e85917b6e11de09fba4a3e08`: `main` `f563e7ac` integrated; evidence `docs/rta/B1_FINAL_QUALIFICATION.md` | PASS (development) |
| RV-18 | Real CI runs every DB-backed test | runner PostgreSQL + test admin + restricted role; 1,233 passed, 0 failed, 0 skipped (+ drill) | PASS (development) |
| RV-19 | 39 legacy differences reconciled; historical diagnostic prepared | row → group → economic transaction, 447 / 447 rows traced; `rta-legacy-impact-diagnostic.ts` + exposure SQL (not run on production) | PASS (development) |
| RV-20 | Owner approval of `d7aa60a8` and the tag `rta-kfintech-pilot-candidate-2026-10-14-b1f` | approved for development release tagging (owner, 2026-10-14); re-verified that day: `main` `f563e7ac` fully contained, fingerprints, 284 migrations = lock, CI run 305 green on the exact SHA (1,233 DB tests, 0 skipped, + drill) | PASS (approval) |
| RV-21 | Remote tag `rta-kfintech-pilot-candidate-2026-10-14-b1f` → `d7aa60a8` | the development session's tag push was refused by the remote; **no remote tag exists**. An authorized maintainer creates it with handover §0.1d and records both `ls-remote` lines | NOT VERIFIED |
| RV-22 | `main` after approval | moved five times on 2026-10-14: `f086c294` (IAM Identity Center deploy sign-in), `bee06293` (client-master dropdowns), `b795fdba` (RTA placeholder sweep), `d334b35b` (a client who holds money is never deleted — deploy run 298) and `74dc6c6e` (client-type fields; pincode only from RTA files — deploy run 299, 08:52 UTC: **production runs `74dc6c6e`**); no migration (production stays at 272). All five integrated in the candidate of RV-25 | PASS (development) |
| RV-23 | Guardian-link defect in `main`'s client master (G-1) | fixed, then hardened, in development (owner approvals 2026-10-14): `claude/g1-guardian-hotfix` head `7d0847da` = `main` `74dc6c6e` + the fix + the final hardening (a minor's risk is its own assessment on every read path; link removal clears the copy; refused typed PANs reported; the client history route scoped), standalone of the RTA engine; evidence, rollout, rollback and the owner / compliance decision note in `docs/security/G1_GUARDIAN_HOTFIX.md` §8–§9. **Not deployed** — production still runs the defect | PASS (development) · production OPEN |
| RV-24 | Updated integrated candidate (handover §0.1e) | `f7055e92` (code `ccd9e18c` + a sweep test): `d7aa60a8` + `main` `f086c294` / `bee06293` / `b795fdba` + G-1; migrations identical to `d7aa60a8`; evidence `B1_FINAL_QUALIFICATION.md` §M | superseded by RV-25 |
| RV-25 | Final candidate (handover §0.1f) | **`44468322`**: `f7055e92` + the G-1 final hardening + `main` `d334b35b` / `74dc6c6e` (two integration guards: the money-holder restore is a `derived` RTA writer; the importer's India Post fill skips validate-first batches); migrations identical to `d7aa60a8` (284); evidence `B1_FINAL_QUALIFICATION.md` §N | PASS (development) — owner review and a new tag pending |

**B-1 (2026-10-12): the reconciliation was authorized and is done in development** — first candidate `f61d202` (`docs/rta/B1_INTEGRATION.md`), stabilised as `aab763c4` (`docs/rta/B1_STABILISATION.md`, conditionally accepted) and qualified with `main` `f563e7ac` as **`d7aa60a8`** (`docs/rta/B1_FINAL_QUALIFICATION.md`). The owner approved it on 2026-10-14 (RV-20); the remote tag waits for a maintainer (RV-21). It is a development release only: none of these commits is deployed or authorized for deployment. Every check below is run on the candidate once accepted; F part 1 on `c26e676` is not evidence for it.

---

## 2. Execution order

1. **PR** — production, read-only. DBA and infrastructure engineer. **Can start now.**
2. **C** — isolated copy. Needs written authorization (handover C).
3. **A / B** — AMFI and schemes, on the copy.
4. **E** — historical diagnostics, on the copy.
5. **F1** — dry run, on the copy, with the accepted candidate (`d7aa60a8` once RV-20 is PASS).
6. **X** — emergency, recovery and alert drills, on the copy.
7. **F2** — approvals in production: only after everything above is PASS and the deployment of a reconciled candidate is authorized.

---

## 2a. First production read-only checks — operator sequence A – H (2026-10-14)

Nothing in this sequence writes, deploys, migrates, activates or repairs. Each step points at the row that holds the exact command; only the rows marked *new* were added here. Run in this order and **stop at the first stop condition** — report it, do not work around it. Production SQL always runs as `PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO"`. No development session holds production access: every step is executed by the named role.

| Step | What | Rows (exact command there) | Role | Expected | Evidence to keep | Stop if |
|---|---|---|---|---|---|---|
| A | AWS account, no change in flight, the commit production runs | PR-1, PR-2, PR-3 | Infra | `972971302420`; lock free; host / last deploy `74dc6c6e` | the three outputs | another account; a lock held by an unknown session; any other commit (the candidate is re-integrated against it first) |
| B | Migration ledger and the reverted `0240` | PR-5 (count / newest / digest, then `docs/rta/handover/b1-production-ledger-check.sql`) and `SELECT filename, checksum, applied_at FROM _applied_migrations WHERE filename = '0240_aum_month_end.sql';` | DBA | `272 \| 0234_minor_risk_from_guardian.sql \| 2ed089067e530ec25b28fb9a755cca5c`; verdict `COMPATIBLE · 272 · 12 pending`; **no `0240` row** | outputs | any `STOP` verdict; a `0240` row; a changed checksum — escalate to development, never edit a migration |
| C | `mfd_app` and RLS | PR-6, PR-7, PR-16 | DBA + Infra | role flags all false, owns nothing, member of nothing privileged; 0 tables without forced RLS; containers `app=set master=absent`; two designated operators with two-factor | outputs (ids only) | any true flag / ownership / membership; `master=PRESENT`; an operator without two-factor |
| D | Backups and restore capability | PR-4, PR-9 (a restore is proven only by C-2 / X-4 on the copy) | DBA | encrypted, not public, retention 7, deletion protection, latest restorable time within minutes, daily snapshots `available` | outputs | no snapshot in 24 h; PITR not available |
| E | Historical financial impact (read-only) | E-5 (exposure), E-7 (duplicates), E-8 (guardian links) on production; E-6 (re-read of the stored registrar files) on the copy | DBA (+ Infra for E-6's storage access) | counts recorded per firm; nothing changed | SQL outputs, `legacy-impact.json` (masked) | an error from a read-only query (report it; never retry as a writer) |
| F | Headerless RTA files | E-9 | DBA, then Infra (first lines of the listed objects) | per firm / month counts; the listed objects carry registrar headers | outputs, inspection notes (no data rows) | a firm whose AUM / SIP imports were read positionally — decided in E-4 before that firm is touched |
| G | AMFI reference and KFintech mappings | production today: `SELECT count(*), max(nav_date) FROM scheme_nav;` — the provenance and mapping tables (`amfi_feed_imports`, `scheme_registrar_map`, `registrar_amc_identity`, `scheme_rta_codes`) arrive with the release's migrations, so `relation … does not exist` is the expected answer in production. The approved KFintech mappings are verified on the copy: A-1 – A-3, B-1 – B-3 | DBA; Op 1 / Op 2 on the copy | production: counts recorded; copy: as A / B | outputs | on the copy: B (ii) ≠ 0, a code resolved by name |
| H | Security, storage, SES, Redis, alerts, reconciliation | PR-8, PR-10 – PR-15; `curl -fsS https://<CRM domain>/api/health` (200). `GET /api/health/rta-reconciliation` and the 06:30 IST reconciliation exist only in the release: X-5, X-6 on the copy | Infra + DBA | as in each row; `/api/health` 200 | outputs | as in each row |

Step E is the only one that reads client-level records; its outputs are aggregates or masked. A non-zero count is not a defect by itself: it goes to E-4 for a signed decision.

---

## 3. PR — production, read-only (start here)

| ID | Objective | Command / procedure | Role | Expected | Evidence | Risk | Stop if | Status |
|---|---|---|---|---|---|---|---|---|
| PR-1 | Right AWS account | `aws sts get-caller-identity --query '[Account,Arn]' --output text` | Infra | `972971302420`, a named human or least-privilege role (not root) | output | Low | another account | NOT VERIFIED |
| PR-2 | No production change in flight | `bash scripts/prod-change.sh status` | Infra | free, or held by a named change you know | output | Low | held by an unknown session | NOT VERIFIED |
| PR-3 | Which code production runs | `aws s3 ls s3://aina-crm-deploy-artifacts-972971302420/releases/ \| sort \| tail -3` (the SHA is in each key) and `gh run list --workflow "Deploy to AWS (EC2)" --limit 5` | Infra | newest successful deploy is `74dc6c6e` (2026-10-14 08:52 UTC, deploy run 299; after `d334b35b`, `b795fdba`, `bee06293` and `f086c294`) — 272 migrations. Also on the instance: the deployed SHA the host records (`scripts/manual-deploy.sh` deploys bypass Actions) | output | Low | any other commit, or unknown: the candidate is re-integrated against it before anything else | NOT VERIFIED |
| PR-4 | Database identity and protection | `aws rds describe-db-instances --db-instance-identifier mfd-growth-os-db --query 'DBInstances[0].{Engine:EngineVersion,Class:DBInstanceClass,GB:AllocatedStorage,MaxGB:MaxAllocatedStorage,Encrypted:StorageEncrypted,Public:PubliclyAccessible,MultiAZ:MultiAZ,Retention:BackupRetentionPeriod,Restorable:LatestRestorableTime,DeletionProtection:DeletionProtection}'` | DBA | 16.x; `Encrypted` true; `Public` false; `Retention` 7; `DeletionProtection` true; `Restorable` within minutes. `MultiAZ` false is recorded as a risk (single AZ) | output | Low | public, unencrypted, retention < 7, restorable time hours old | NOT VERIFIED |
| PR-5 | Production migration state | `SELECT count(*), max(filename), md5(string_agg(filename \|\| ':' \|\| checksum, ',' ORDER BY filename COLLATE "C")) FROM _applied_migrations;` then `docs/rta/handover/b1-production-ledger-check.sql` (both read-only) | DBA | `272 \| 0234_minor_risk_from_guardian.sql \| 2ed089067e530ec25b28fb9a755cca5c` (main `f563e7ac`, deployed 2026-10-13); 271 `9d53e5c78c2d79f7b29eea0d4d8e0065` or 270 `d81993198b6288513fe6913400b7966c` for an older main; the ledger check's verdict `COMPATIBLE`. In particular no row for `0240_aum_month_end.sql` (added and reverted on `main` on 2026-10-08): the runner refuses to migrate a ledger holding it (`--check` exit 2, nothing applied — rehearsed) | output | Low | any other value: the copy's migration plan differs — investigate before C | NOT VERIFIED |
| PR-6 | App role cannot bypass RLS / own anything | handover FS-2 step 2 (role flags, memberships, `session_replication_role`, object / database / function owners, tables without forced RLS) | DBA | `mfd_app` all flags false, member of nothing privileged, owns 0 objects; 0 tables without forced RLS | 5 outputs | Low | any true flag, ownership or membership | NOT VERIFIED |
| PR-7 | Web and worker never hold the migration login | on the instance: `cd ~/app; grep -c '^APP_DATABASE_URL=' .env.production; grep -c '^DATABASE_URL=' .env.production; stat -c '%a %U' .env.migrate`; then `for c in $(docker ps --format '{{.Names}}' \| grep -E 'web\|worker'); do echo -n "$c "; docker exec $c sh -c '[ -n "$APP_DATABASE_URL" ] && echo -n "app=set " \|\| echo -n "app=UNSET "; [ -z "$DATABASE_URL" ] && echo master=absent \|\| echo master=PRESENT'; done` | Infra | `1`, `0`, `600 ec2-user`; every web / worker container `app=set master=absent` | output | Low | `app=UNSET` or `master=PRESENT` anywhere | NOT VERIFIED |
| PR-8 | Connection and storage headroom | `SELECT setting FROM pg_settings WHERE name = 'max_connections'; SELECT usename, count(*) FROM pg_stat_activity GROUP BY 1; SELECT pg_size_pretty(pg_database_size(current_database()));` and CloudWatch `FreeStorageSpace` for `mfd-growth-os-db` | DBA | peak connections well under the `aina-rds-connections-high` alarm (135); free storage > 20 % | outputs | Low | connections near the alarm, storage < 20 % free | NOT VERIFIED |
| PR-9 | Backups exist and are restorable | `aws rds describe-db-snapshots --db-instance-identifier mfd-growth-os-db --snapshot-type automated --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[:3].[DBSnapshotIdentifier,SnapshotCreateTime,Status,Encrypted]' --output text` + PR-4 `Restorable` | DBA | daily automated snapshots `available`, encrypted; PITR within minutes | output | Low | no snapshot in 24 h | NOT VERIFIED |
| PR-10 | Uploads bucket posture (D1) | `B=$(aws s3api list-buckets --query "Buckets[?starts_with(Name,'mfd-growth-os-uploads-')].Name" --output text)`; then handover §2.1 "S3 bucket posture" and "S3 anonymous read refused", plus `aws s3api get-bucket-cors --bucket "$B"` | Infra | AES256; 4 public-access blocks true; versioning `Enabled`; policy grants only `ses.amazonaws.com` `PutObject` with the `aina-rta-inbound` SourceArn; anonymous GET 403; CORS origins only the CRM domain | outputs | Low | any public grant, encryption off | NOT VERIFIED |
| PR-11 | Instance permissions are least-privilege | `aws iam list-role-policies --role-name mfd-growth-os-ec2` · `aws iam list-attached-role-policies --role-name mfd-growth-os-ec2` · `aws iam get-role-policy --role-name mfd-growth-os-ec2 --policy-name <each>` | Infra | S3 Get/Put/Delete/List on the uploads bucket only; deploy-artifacts read; SSM core; CloudWatch agent; monitoring read | outputs | Medium | `*` actions or resources beyond those | NOT VERIFIED |
| PR-12 | Redis persistence and queue state (D3) | on the instance: `cd ~/app; docker compose -f docker-compose.prod.yml exec -T redis redis-cli INFO persistence \| grep -E 'aof_enabled\|aof_last_write_status\|rdb_last_bgsave_status'`; queue counts per handover §2.1 "Import queue state" with `docker compose … exec -T redis redis-cli` | Infra | `aof_enabled:1`, both `ok`; queue counts recorded | output | Low | AOF off or write errors | NOT VERIFIED |
| PR-13 | Registrar mail configuration (D2 / EC-4) — inspection only | `aws ses describe-active-receipt-rule-set --region ap-south-1`; `aws sesv2 get-email-identity --email-identity crm.ainatech.in --region ap-south-1 --query 'DkimAttributes.Status'`; `SELECT count(*) FILTER (WHERE is_active) FROM rta_forward_addresses WHERE tenant_id = '<firm>';` | Infra + DBA | rule set `aina-rta-inbound`, scan on, S3 action to the uploads bucket; DKIM `SUCCESS`; the firm's active alias count recorded (must be **0** before F2 — FS-6 / EC-4 step 4) | outputs | Medium | inbound rule not as described; the firm's mail cannot be stopped | NOT VERIFIED |
| PR-14 | Infra monitoring reaches a person | `aws cloudwatch describe-alarms --alarm-name-prefix aina- --query 'MetricAlarms[].[AlarmName,StateValue]' --output text` · `aws sns list-subscriptions-by-topic --topic-arn arn:aws:sns:ap-south-1:972971302420:aina-crm-production-alerts --query 'Subscriptions[].[Protocol,SubscriptionArn]' --output text` | Infra | alarms `OK`; the email subscription confirmed (not `PendingConfirmation`) | output | Low | no confirmed subscriber | NOT VERIFIED |
| PR-15 | 0244 settings prepared, posting off | on the instance (counts only): `cd ~/app; grep -cE '^(OPS_ALERT_WEBHOOK_URL\|OPS_ALERT_ESCALATION_WEBHOOK_URL\|OPS_HEARTBEAT_URL\|OPS_MONITOR_TOKEN)=' .env.production; grep -cE '^(RTA_STAGING_TOKEN_KEY\|ENCRYPTION_KEY)=' .env.production; grep -E '^RTA_(POSTING\|PIPELINE)_MODE=' .env.production \| cut -d= -f1,2` | Infra | alert keys: record the count (all 4 needed before the reconciled release is deployed); token key ≥ 1; posting / pipeline mode unset, `off` or `shadow` — never `controlled` / `validate_first` before F2 | output | Medium | posting mode set in production | NOT VERIFIED |
| PR-16 | Platform operators and their two-factor (FS-1, FS-3) | `SELECT id, status, two_fa_enabled, sessions_invalid_after FROM users WHERE roles && ARRAY['platform_admin']::text[] ORDER BY 1;` | DBA | the two designated operators `active`, `two_fa_enabled` true; every other platform admin listed and justified | output (ids only) | Medium | a designated operator without two-factor; an unexplained admin | NOT VERIFIED |
| PR-17 | Pilot firm and ARN | `SELECT id, legal_name, arn FROM tenants WHERE id = '<firm>';` | DBA | equals the §6 sheet | output | Low | mismatch | NOT VERIFIED |
| PR-18 | Import backlog for the firm (EC-2) | `SELECT status, count(*), count(*) FILTER (WHERE remarks LIKE 'Held%') FROM rta_file_imports WHERE tenant_id = '<firm>' GROUP BY 1;` | DBA | recorded; the EC-2 inventory reconciles it | output | Low | rows nobody can account for | NOT VERIFIED |

Queries on tables added by `0233`–`0244` (posting controls, activations, `amfi_feed_imports`, `scheme_rta_codes`, `ops_alerts`, `rta_posted_transactions` …) answer `relation … does not exist` in production today. That is the expected pre-migration state (FS-7 step 1: no ledger) — run them on the copy.

---

## 4. C — isolated production copy (written authorization first)

| ID | Objective | Command / procedure | Role | Expected | Evidence | Risk | Stop if | Status |
|---|---|---|---|---|---|---|---|---|
| C-1 | Authorization and lock | written approval naming account `972971302420`, source `mfd-growth-os-db`, the NEW target identifier and the rehearsal host; then `bash scripts/prod-change.sh acquire "PITR restore to NEW instance <target> (preflight C)" "<session>"`; and `aws rds describe-db-instances --db-instance-identifier <target>` → `DBInstanceNotFound` | DBA + owner | approval reference; lock held; target does not exist | all three | High | the target exists or names production | NOT VERIFIED |
| C-2 | Restore into a NEW instance | `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier mfd-growth-os-db --target-db-instance-identifier <target, e.g. mfd-growth-os-db-preflight-YYYYMMDD> --use-latest-restorable-time --db-instance-class db.t4g.small --db-subnet-group-name mfd-growth-os-db --vpc-security-group-ids <NEW preflight SG> --no-publicly-accessible --no-multi-az --deletion-protection --tags Key=purpose,Value=rta-preflight` | DBA | instance `available`; restore time recorded (feeds D6) | command, start / end UTC, the restore point | High | any parameter names `mfd-growth-os-db` as the TARGET | NOT VERIFIED |
| C-3 | Copy cannot reach or be reached by production services | the new SG admits 5432 only from the rehearsal host's SG — never the production web SG; the rehearsal host runs the tagged release with: its own `APP_DATABASE_URL` / migration URL for the copy; `WORKER_GROUPS=rta,ops` (no `mail`, `outbox`, `wf`, `sched`, `wa_sync`, `zoho`, `statements`, `market`, `feed`); **no** `RESEND_*`, `VARTIFY_*`, `MSG91_*`, AI keys or `RTA_INBOX_*`; its own empty S3 bucket and its own Redis; `OPS_ALERT_*` pointing at a test channel; `RTA_POSTING_MODE=controlled`, `RTA_PIPELINE_MODE=validate_first`, `RTA_POSTING_DATABASE=mfd_preflight` (C-5) | Infra | `env` key list (no values) shows exactly that | key list, SG rules | High | any production endpoint, bucket, Redis, mailbox or messaging key on the host | NOT VERIFIED |
| C-4 | Sensitive data | the copy holds real investor data: access only for the named DBA and operators; encrypted (inherited); outputs masked; deleted (with a final snapshot under the same access rules) when the preflight ends | DBA + compliance | access list recorded | list, deletion date | High | the copy shared outside the named people | NOT VERIFIED |
| C-5 | A name production can never match | on the copy only, connected to `postgres` with no session on `mfd`: `ALTER DATABASE mfd RENAME TO mfd_preflight;` | DBA | copy database `mfd_preflight`; the posting gate then refuses any connection whose database is not `mfd_preflight` — production's `mfd` can never match | output | Medium | run on any endpoint other than the copy's | NOT VERIFIED |
| C-6 | Source unchanged | rerun PR-5 on production; `aws cloudtrail lookup-events --lookup-attributes AttributeKey=ResourceName,AttributeValue=mfd-growth-os-db --start-time <C-2 start> --query 'Events[].[EventTime,EventName,Username]' --output text` | DBA | PR-5 identical; only the restore read / describe events, no `Modify*` / `Reboot*` on production | both outputs | Low | any change event on production | NOT VERIFIED |
| C-7 | Release migrations and checksums | on the rehearsal host, at the tag: `node scripts/check-migration-lock.mjs`; `DATABASE_URL=$COPY_ADMIN npx tsx scripts/migrate-all.ts --check` | DBA | `✓ 284 migrations match`; `272 applied, 12 pending, 0 acknowledged drift, 0 blockers` (13 / 14 pending if the copy predates `main` `f563e7ac` / `88bc0178`) | outputs | Low | any blocker | NOT VERIFIED |
| C-8 | Recovery point before migrating | `aws rds create-db-snapshot --db-instance-identifier <target> --db-snapshot-identifier <target>-pre-migrate` | DBA | `available` | id | Low | — | NOT VERIFIED |
| C-9 | Rehearse the migrations | `time DATABASE_URL=$COPY_ADMIN npx tsx scripts/migrate-all.ts`; then PR-5's query on the copy; `DATABASE_URL=$COPY_ADMIN npm run -s check:rls`; `DATABASE_URL=$COPY_ADMIN npm run -s check:schema` | DBA | `applied 12` (13 / 14 if the copy predates `main` `f563e7ac` / `88bc0178`), exit 0, duration recorded; `284 \| 0244_… \| a9bb87a582387db2697310e3e66fa895`; RLS 189 tables; schema 199 tables | outputs, duration, any error text | Medium | a failed file (never edit it — return it) | NOT VERIFIED |
| C-10 | Restricted roles on the copy (FS-2) | FS-2 step 2 queries on the copy; start the tagged worker once with `APP_DATABASE_URL` unset and once with the migration URL, `NODE_ENV=production` | DBA + Infra | role checks as PR-6; both starts exit 1 with `refusing to start`, no password printed; with the app URL: `✓ Database role 'mfd_app' verified` | outputs | Low | the worker starts on the migration role | NOT VERIFIED |
| C-11 | Recovery point after migrating | `aws rds create-db-snapshot … --db-snapshot-identifier <target>-post-migrate` | DBA | `available` | id | Low | — | NOT VERIFIED |

---

## 5. A / B — AMFI and Scheme Master (on the copy)

Development, for reference only: of all **219** KFintech registrar codes seen, **215** resolve by the registrar's ISIN (0 ambiguous, 0 conflicting) and **4** do not; the pilot manifest uses **118** of them — **114** mapped, the same **4** unresolved (`120DEGP`, `120RGGP`, `127DFGP`, `185SCRG`; one transaction, ₹99,995, already held as an unknown code). CAMS mappings are not approved.

| ID | Objective | Command / procedure | Role | Expected | Evidence | Risk | Stop if | Status |
|---|---|---|---|---|---|---|---|---|
| A-1 | Authentic AMFI file | operators 1 and 2 each download `https://portal.amfiindia.com/spages/NAVAll.txt` on the pilot host; `sha256sum NAVAll.txt` | Op 1 + Op 2 | same business date ⇒ identical hashes | URL, both UTC times, both hashes | Medium | same-date hashes differ | NOT VERIFIED |
| A-2 | File structure | `DATABASE_URL=$COPY_ADMIN ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --check` | Op 1 | exit 0; `layout: current8`; `errors: []`; `feedDate` the business date, ≤ 7 days old; `conflictingDuplicates: 0`; ≥ 1,000 schemes | JSON output | Medium | non-zero exit, stale date | NOT VERIFIED |
| A-3 | Load on the copy | `DATABASE_URL=$COPY_ADMIN ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --note "downloaded <UTC> by <name>; second by <name>, sha256 <…>"` | Op 1 | exit 0, `status: applied`; `amfi_feed_imports` row with the A-1 hash | output, row | Low | — | NOT VERIFIED |
| B-1 | Verified mappings only | after F1's MFSD211 / MFSD201 imports: handover §2.1 "KFintech mapping" and "KFintech AMC identities"; condition B (i)–(iii) | Op 1 | every resolved code `isin_verified*`, every AMC basis `isin`; B (ii) = **0** | outputs | High | B (ii) ≠ 0; a code resolved any other way | NOT VERIFIED |
| B-2 | Unresolved stay excluded | `SELECT rta_scheme_code, status, reason_code FROM scheme_rta_codes WHERE tenant_id = '<firm>' AND rta = 'kfintech' AND status NOT IN ('resolved_isin', 'confirmed');` and `SELECT count(*) FROM transactions WHERE tenant_id = '<firm>' AND source_feed = 'rta_validate_first' AND rta_scheme_code IN (<those codes>);` | Op 1; compliance reviews | the unresolved codes listed, each with a written **held** decision; posted count **0**. No approval by name — an approval needs two operators and the AMC's own scheme document | outputs, decisions | High | a posted transaction on an unresolved code | NOT VERIFIED |
| B-3 | CAMS cannot post | covered by F1-6 (a CAMS file refused under `registrars: ["kfintech"]`) | Op 1 | refused, recorded `blocked`, no batch | F1-6 output | High | any CAMS batch | NOT VERIFIED |

---

## 6. E — historical diagnostics (E-5, E-7, E-8, E-9 read-only on production per §2a — the owner's instruction of 2026-10-14; the rest on the copy)

| ID | Objective | Command / procedure | Role | Expected | Evidence | Risk | Stop if | Status |
|---|---|---|---|---|---|---|---|---|
| E-1 | Identity, ownership and duplicate findings | `DATABASE_URL=$COPY_APP ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-historical-diagnostics.ts --tenant <firm> --json diag.json` | DBA | exit 0; READ ONLY transaction; masked output. Covers PAN-less placeholders, `MINOR:` keys and guardian folios, HUF rows, folios with two owners, reused registrar transaction numbers, duplicate SIPs, stale holdings | `diag.json` (masked) | Medium | an unexplained two-owner folio; a minor / HUF finding on an in-scope folio without a decision | NOT VERIFIED |
| E-2 | Scheme Master duplicates | `DATABASE_URL=$COPY_APP ALLOW_SYSTEM_TX=1 npx tsx scripts/scheme-master-duplicates.ts --tenant <firm>` | DBA | exit 0; ends `Nothing was changed.` | output | Low | — | NOT VERIFIED |
| E-3 | Existing legacy transactions (EC-1 step 1, FS-7 step 1) | handover EC-1 step 1 queries; FS-7 step 1 | DBA | counts recorded; no ledger rows | outputs | Medium | numbers twice without explanation | NOT VERIFIED |
| E-5 *new* | Legacy KFintech exposure (production, read-only) | `PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -f docs/rta/handover/b1-legacy-impact-exposure.sql` | DBA | per firm: legacy KFintech rows, redemption-like, outflow lumpsum, zero-amount, amount on record; stored feed imports per firm. EXPOSURE only — it cannot name an affected record | output | Low | — | NOT VERIFIED |
| E-6 *new* | Legacy KFintech impact confirmed from the stored registrar files: truncated multi-lot redemptions, folio-correction legs counted as business, unrecognised codes | on the copy, at the tag, for each firm with exposure in E-5: `DATABASE_URL=$COPY_APP S3_BUCKET=<uploads bucket> npx tsx scripts/rta-legacy-impact-diagnostic.ts --tenant <firm> --imports --json legacy-impact.json` — storage credentials limited to `s3:GetObject` under `tenants/<firm>/rta/` (Infra grants, then revokes). READ ONLY transaction, restricted role | DBA + Infra | per category: transactions, rows, registrar ₹ vs CRM ₹, ≤ 3 masked examples. Development sample: 39 of 1,100 (15 truncated, 18 correction legs, 6 unrecognised). **No production figure exists until this runs** | `legacy-impact.json` | Medium | a firm with exposure and no stored file: the registrar's file for that period is needed | NOT VERIFIED |
| E-7 *new* | Duplicate economic transactions (production, read-only) | `… -f docs/rta/handover/b1-duplicate-economic-check.sql` (replace `<firm>` in part 2) | DBA | `duplicate_shaped_groups` 0; any other number is an upper bound to review, not a finding | output | Medium | — | NOT VERIFIED |
| E-8 *new* | Guardian links, defect G-1 (production, read-only) | `… -f docs/security/g1-guardian-impact.sql` | DBA; compliance reviews | per firm: links to another RM / branch; to merged, deleted or minor records; shared-PAN guardians; typed PAN ≠ linked PAN | output | High | — (a non-zero count is decided in E-4; nothing is unlinked) | NOT VERIFIED |
| E-9 *new* | Headerless AUM / SIP-book files (I-4) | `… -f docs/rta/handover/b1-headerless-impact-check.sql`; Infra then reads the first 10 lines of the listed stored objects (no data rows copied) | DBA + Infra | counts per firm / month; the header on line 1 for the files `main` read correctly | outputs, notes | Medium | — | NOT VERIFIED |
| E-4 | Signed review | operator 1 and compliance sign a decision per finding: accept / fix outside the pilot / exclude the client. **No merge, no repair** | Op 1 + compliance | every finding decided | minutes | High | an undecided in-scope finding | NOT VERIFIED |

---

## 7. F1 — KFintech dry run (on the copy, with the accepted candidate)

| ID | Objective | Command / procedure | Role | Expected | Evidence | Risk | Stop if | Status |
|---|---|---|---|---|---|---|---|---|
| F1-1 | Files and ARN | `npx tsx scripts/rta-file-manifest.ts <every file> --arn <pilot ARN> --json manifest.json` and `--calendar <start> <end>` | Op 1 | report code MFSD211 / MFSD201 only; ARN matches; exit 0 | manifest | Medium | exit 2 | NOT VERIFIED |
| F1-2 | Activate the copy (two people, MFA) | handover §5.1 on the copy's app: operator 1 files `activate` (`registrars: ["kfintech"]`, `reportCodes: ["MFSD211","MFSD201"]`, 14-day expiry) and the global `release`; operator 2 approves each from a different MFA session | Op 1 + Op 2 | both `executed`; FS-1 (c) on the copy shows MFA methods and two people | request ids, `payloadHash`, FS-1 (c) | High | either step by one person or a non-MFA session | NOT VERIFIED |
| F1-3 | Import in order | upload through the copy's `/dashboard/rta-imports`: every MFSD211, then every MFSD201; after each, `DATABASE_URL=$COPY_APP ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts reconcile --tenant <firm>` | Op 1 | per file: posted / rejected_recorded / matched_existing / held / unsupported counts; every reconcile exit 0 | counts, reconcile outputs | High | a reconcile exit 3; an unexplained hold | NOT VERIFIED |
| F1-4 | Legacy matching and collisions (EC-1, FS-7) | handover EC-1 steps 2–3 and the FS-7 breakdown query | DBA | `matched_existing` = by_registrar_code + by_approved_amfi_code + by_other_code_review_each; the other three counts 0; legacy fingerprint unchanged | outputs, decisions | High | a non-zero count without a signed explanation | NOT VERIFIED |
| F1-5 | Ownership, multi-lot, rejections, corrections | held-items screen `/dashboard/rta-imports/held` and handover §4 queries: minor / HUF holds, multi-lot redemptions as one transaction, refused instructions as rejected (0 units), folio consolidations held | Op 1 | each category counted and explained | counts | High | a minor or HUF row posted to the guardian / Karta | NOT VERIFIED |
| F1-6 | Out-of-scope refused (FS-5) | upload one CAMS file and one MFSD203 | Op 1 | both refused, recorded `blocked`, no batch | messages, import rows | High | either staged | NOT VERIFIED |
| F1-7 | Idempotency | re-import the whole manifest | Op 1 | `already_posted` only; transaction and ledger counts unchanged; reconcile 0 | counts | High | any new row | NOT VERIFIED |
| F1-8 | Rejection counts equal the ledger (FS-9) | handover FS-9 queries; the Operations dashboard Rejections tab | Op 1 | instructions and legs agree with the ledger | outputs, screenshot | Medium | a difference | NOT VERIFIED |
| F1-9 | Cancel survives a Redis restart (FS-8) | handover FS-8 procedure on the copy's Redis | Infra + Op 1 | `cancelled`, 0 staging batches, same `cancelled_at`, worker log refusal | outputs, log lines | Medium | the job runs | NOT VERIFIED |
| F1-10 | CRM shows what was posted | the client page, Transactions and the SIP Rejections register for 3 sample clients | Op 1 | figures equal the ledger counts | screenshots (masked) | Low | a mismatch | NOT VERIFIED |

---

## 8. X — emergency, recovery and alerts (on the copy)

| ID | Objective | Command / procedure | Role | Expected | Evidence | Risk | Stop if | Status |
|---|---|---|---|---|---|---|---|---|
| X-1 | Firm pause | handover §5.2 (one operator, API) during an import | Op 1 | the job parks (`Held …`), nothing written after the pause; resume needs a two-person request | rows, request ids | High | a write after the pause | NOT VERIFIED |
| X-2 | Global halt and in-flight batch | handover §5.3 while a batch posts | Op 1 | the running batch finishes or rolls back whole; later jobs park; release = two people | outputs | High | a partial batch | NOT VERIFIED |
| X-3 | Reversal and undo | handover §5.6: dry run, two-person reverse, `reconcile` 0, two-person undo, `reconcile` 0 | Op 1 + Op 2 | each step as stated; archive rows written | ids, outputs | High | reconcile ≠ 0 | NOT VERIFIED |
| X-4 | Database recovery | handover §5.7 using C-8 / C-11 snapshots (restore one into a second throwaway instance) | DBA | restore time recorded; ledger digest as at the snapshot | outputs | Medium | restore fails | NOT VERIFIED |
| X-5 | Scheduled reconciliation alert (EC-5, FS-10) | handover §2.2 "Deliberate failure" and FS-10 step 2 — the **scheduled** run, never the CLI alone | Infra + on-call owner | `rta_reconciliation_runs` row `schedule` / `catch_up`, status `discrepancy`; `ops_alerts` row `delivered`; acknowledged by the named on-call owner from their own MFA session | rows, delivery attempts, ack time | High | no delivery or no acknowledgement | NOT VERIFIED |
| X-6 | Independent monitoring | stop the copy's worker > 10 min | Infra | `GET /api/health/rta-reconciliation` 503 and the worker-down alert delivered; heartbeat service pages; restart → `catch_up` if a slot was missed | outputs, page time | Medium | no page | NOT VERIFIED |

---

## 9. Responsibility and sign-off

Use handover **§6** (sign-off sheet, "Who records which check", R1–R6, signatures). Every field is blank until the authorizer fills it: business owner; pilot firm (legal name, tenant id) and ARN; platform operators 1 and 2 (name, user id — always two people); DBA; infrastructure engineer; compliance reviewer; on-call monitoring owner; authorized pilot start and end (≤ 14 days). The pilot needs the business owner's explicit, recorded authorization after every mandatory check is PASS; a completed sheet is not that authorization.

---

## 10. GO / NO-GO — evidence available on 2026-10-14

| Condition | Status | Basis |
|---|---|---|
| Release integrity (RV-1 – RV-6) | **PASS** | §1, verified from the remote tag and git objects |
| Release = production code (RV-7) | **FAIL** for `c26e676` | blocker B-1: 36 production commits missing, 9 conflicting files |
| Reconciled candidate (RV-8 – RV-11) | PASS (development) | `f61d202`: production `a16628c5` merged, migrations unchanged, production's deploy / security files byte-identical; full regression and real-file reconciliation in `docs/rta/B1_INTEGRATION.md` |
| Owner review of the candidate (RV-12) | PASS (decisions) | I-1 – I-3 hold, I-4 conditional; integration direction accepted for development |
| Stabilised candidate (RV-13 – RV-15) | PASS (development) | `aab763c4`: `main` `88bc0178` merged, 15 clean full runs, CI green under its own env, I-6 harness 42 / 42, migrations 271 + 12 — `docs/rta/B1_STABILISATION.md` |
| Owner review of `aab763c4` (RV-16) | PASS (conditional) | accepted for continued qualification |
| Final candidate (RV-17 – RV-19) | PASS (development) | `d7aa60a8`: `main` `f563e7ac` integrated, real CI with every DB test run, 39 differences reconciled, harness 43 / 43, browser 17 / 17 — `docs/rta/B1_FINAL_QUALIFICATION.md` |
| Owner approval of `d7aa60a8` (RV-20) | PASS (approval) | owner, 2026-10-14 — development release only |
| Remote tag (RV-21) | NOT VERIFIED | session refused; maintainer per handover §0.1d |
| A. AMFI integrity and mapping | NOT VERIFIED | A-1 – A-3 not run |
| B. Schemes verified or held | NOT VERIFIED | B-1 – B-3 not run on a production copy |
| C. Migration rehearsal | NOT VERIFIED | no authorized copy yet |
| D. Infrastructure, isolation, backups, alerts | NOT VERIFIED | PR-*, X-5, X-6 not run |
| E. Diagnostics reviewed | NOT VERIFIED | E-1 – E-4 not run |
| F. Dry run + two-person approval | NOT VERIFIED (not done) | F1 not run; F2 not authorized |
| EC-1 – EC-6, FS-1 – FS-10 | NOT VERIFIED | operator evidence pending |
| G-1 guardian-link defect (RV-23) | fixed and hardened in development · production OPEN | the hotfix needs its own deployment authorization; E-8 counts (`g1-guardian-impact.sql` §1–§5) decided before a pilot firm is activated; the suitability policy for minors decided by owner / compliance (hotfix doc §9) |
| Final candidate (RV-25) | PASS (development) | `44468322`; owner review and a new tag pending |
| R1 – R6 | not met | follows from the above |

**Decision: NO-GO.** Development and rehearsal results (handover §4, FS-7, FS-8) are not production evidence. Next human actions: (1) a maintainer creates the tag (handover §0.1d, RV-21); (2) DBA and infrastructure engineer run §2a A – H now — A and B decide whether the candidate matches production; (3) the owner decides G-1 (RV-23) and authorizes C in writing; (4) the final pilot rehearsal (§11) on the copy.

---

## 11. Final pilot rehearsal — on an authorized isolated production copy (DBA-led)

**No production change is approved.** The rehearsal runs on the copy built in §4, at the tag, with the copy's own bucket, Redis and worker (C-3). It reuses the rows above; it adds no new procedure. Every item is PASS only with its evidence; one FAIL stops the rehearsal.

| # | Rehearsal item | Rows | Pass when |
|---|---|---|---|
| R-a | Migration compatibility | C-7, C-9, C-10 (+ B on the copy) | `272 applied, 12 pending`, then 284 · `a9bb87a582387db2697310e3e66fa895`; RLS 189; roles refuse privileged starts |
| R-b | Scheme Master / AMFI | A-1 – A-3, B-1, B-2 | two identical hashes; `applied`; every pilot code `isin_verified*`; B (ii) = 0; unresolved codes held |
| R-c | MFSD211 investor master | F1-1, F1-3 (MFSD211 first) | every row posted, matched or held with a reason; no client created by name |
| R-d | MFSD201 transactions on verified schemes | F1-3, F1-4 | posted only with an AMFI code; `matched_existing` explained; the other EC-1 counts 0 |
| R-e | Investor ownership | F1-5, E-8 | folio on record decides; minor / HUF rows never posted to guardian / Karta; G-1 links on in-scope clients decided |
| R-f | Multi-lot redemptions | F1-5 | one transaction per registrar number, every lot kept, amount = the registrar's |
| R-g | Rejections and corrections | F1-5, F1-8 | refused instructions recorded rejected (0 units), counts = ledger; folio corrections held |
| R-h | Import duplication prevention | F1-7, E-7 on the copy after F1 | re-import: `already_posted` only; no duplicate-shaped group created by the pilot |
| R-i | Emergency halt | X-1, X-2 | nothing written after a pause / halt; release needs two people |
| R-j | Financial reconciliation | F1-3 reconciles, X-5 | every `reconcile` 0; a scheduled run `ok`; the deliberate failure alerts and is acknowledged |
| R-k | Backup and recovery | C-8, C-11, X-3, X-4 | reversal + undo reconcile 0; a snapshot restores with the expected ledger digest |
| R-l | Out of scope stays out | F1-6, B-3 | CAMS and MFSD203 refused (`blocked`, no batch) |

MFSD203 (holdings / AUM) and MFSD243 (SIP registrations) may be added to the copy's activation **only as a separate, recorded rehearsal scope** to test AUM and SIP views; they stay outside the pilot's `reportCodes` (MFSD211 + MFSD201). CAMS financial posting stays disabled throughout.

Sign-off for the rehearsal and the pilot is handover **§6** (no second form): it already names the pilot firm and ARN, platform operators 1 and 2, DBA, infrastructure (AWS) engineer, compliance reviewer, responsible business owner, on-call monitoring owner, and the authorized start and expiry dates. **The pilot stays NO-GO until A – F, EC-1 – EC-6, FS-1 – FS-10 and R1 – R6 there are PASS with evidence. A release tag does not authorize deployment.**

