# G-1 hotfix — release runbook (NOT executed; for the authorized operators)

Replaces §13 of `G1_GUARDIAN_HOTFIX.md`, which described the old deploy pipeline. Updated 2026-10-16 against
`origin/main` 523143bc (integrated into the PR); the PR head SHA is in the pull request and in `G1_RELEASE_SIGNOFF.md`,
which is the sheet the operators fill in. Nothing here may be run without the owner's written authorization.

## 0. How a deploy happens now (main's verified-artifact pipeline)
A push to `main` (not docs / `*.md` / mobile / terraform / reports only) runs CI → builds an arm64 image once →
uploads it to `s3://aina-crm-deploy-artifacts-…/verified/` → the box verifies commit, CI result and SHA-256 → blue/green
switch. `deploy/aws` no longer deploys. `workflow_dispatch` offers `mode: build-only | deploy`. The deploy job takes and
releases the production change lock itself. Main carries migrations 0235 (client exit dates), 0236 (risk-profile expiry)
and 0237 (KYC checks) from its own work, byte-identical in this branch; **this hotfix adds none**, so merging this PR applies
exactly the migrations main already has pending and nothing of ours.

## 1. Operator steps (each needs the named person's own authorization)
1. **Running SHA.** `curl -s https://crm.ainatech.in/api/health` → field `build` is the SHA baked into the running
   image (present on main; if it is null or absent the running image predates it — then use
   `aws ssm send-command` / `docker inspect` on the box as the AinaOpsReadOnly profile). Record it. Expected
   `74dc6c6e` or a newer main commit. Compare with `git rev-parse origin/main`.
2. **Backup.** With `aws sso login --profile aina-ops` (read-only): confirm the latest RDS automated snapshot is < 24 h old
   and point-in-time restore is enabled (`aws rds describe-db-instances` → `LatestRestorableTime`,
   `BackupRetentionPeriod`; `aws rds describe-db-snapshots --snapshot-type automated`). Record both.
   This release changes no data; the backup is the standing safety net.
3. **Impact baseline** (read-only role, never the master): see section 4. Store the output.
4. **Independent PR approval.** A human reviewer (not the author of the change) reads the diff and approves PR #19 on GitHub.
5. **Change lock — DO NOT pre-acquire.** `bash scripts/prod-change.sh status` must say the lock is FREE; if held
   (exit 3), stop and wait. The deploy job takes and releases the lock ITSELF under a session name it generates
   (`github-actions-run-<id>-<sha8>`, `scripts/artifact-deploy.sh`). A lock you hold first makes the deploy abort with
   "another production change holds the lock". Instead: announce a freeze (no other prod change, no manual deploy,
   no RDS/security-group work) for the window.
6. **Merge PR #19** (only after steps 1–5 and the owner's written authorization). The merge push triggers the deploy.
7. **Monitor the run.** GitHub Actions → "Deploy to AWS (EC2)": `verify` (CI) → `build` → `deploy`. The deploy log
   prints the SSM output; success ends with "Deploy OK — active colour … commit <sha>" and a DEPLOY METRICS block.
   A failed deploy leaves the previous colour serving and keeps the lock if health is not 200.
8. **Health + security smoke tests** (designated test firm, data wall ON, two test RMs, one test compliance user; no client data):
   a. `GET /api/health` → 200 and `build` = the merge commit SHA; `SELECT count(*) FROM _applied_migrations` unchanged (no migration).
   b. RM A creates a minor typing a guardian PAN that belongs to a client in RM B's book → 201, `guardianLinked:false`, warning toast; client page shows "Guardian not verified"; no name/risk of RM B's client anywhere.
   c. Same minor retried → 409, still one record.
   d. MF proposal send for that minor → 412 (`field: "guardian"`); marking it sent / accepted in the CRM → 412 too.
   d2. A legacy minor with no guardian on record, or linked to a record that fails today's rules → MF proposal 412 (`field: "guardian"`).
   d3. Risk-profile upload for an unverified minor → 409 (`field: "guardian"`); after a valid link, the upload is recorded on the
       minor's own account and its Expire On drives the minor's expiry (never the guardian's).
   e. No one is offered "Confirm guardian", and `POST /api/investors/<minor>/guardian-verification` answers 405. Linking the guardian's client record (Edit client) is the only resolution; afterwards the MF proposal is allowed once the minor has its own assessment.
   e2. A family proposal covering that minor is refused (412) too.
   f. RM A `GET /api/audit?entityType=investor&entityId=<RM B's client>` → 404.
   g. A linked minor: client page, Risk Profiles and export show the minor's own risk, never the guardian's.
   h. Impact SQL §2 for links made after the deploy → `guardian_outside_actor_book_today` = 0.
9. **Record the release SHA**: from the workflow run + `/api/health` `build`; note in the change log.
10. **Release the lock.** The pipeline releases it itself when health is 200 (check `prod-change.sh history`). If it was kept,
    release only after steps 8 a–h pass: `bash scripts/prod-change.sh release "<session shown in status>" "PASS: …"`.

Optional dry run once integrated: `workflow_dispatch` with `mode: build-only` builds and uploads the verified artifact without
deploying. Not verified whether the `production` environment/OIDC role accepts a non-`main` ref — check before relying on it.

## 2. Containment and recovery if the hotfix deploy fails
Preference order: (1) forward fix; (2) revert only the failing piece; (3) full rollback only with written risk acceptance.
`bash scripts/rollback-bluegreen.sh` (previous colour; the box keeps the newest 2 rollback images) and
`scripts/artifact-deploy.sh` of an older verified artifact both put the vulnerable code back.

If a full rollback is unavoidable, these are the controls that actually exist — none is a feature flag, and none is complete:
| Exposure | Existing control | What stays working | What becomes unavailable |
|---|---|---|---|
| Unauthorized client-history read (`GET /api/audit?entityType=investor`) and AI QRR commentary (`/api/ai/qrr-commentary`) | A path block in the Caddy reverse proxy (repo `Caddyfile`; `respond 403` on those paths). Caddy is in the stack, but I have NOT verified how the live box's Caddyfile is deployed or reloaded; this is a production config change under the change lock. | Everything else, including login, clients, proposals, other audit trails (`entityType` other than investor, if matched by query) | The "Change log" drawer on client pages (entityType=investor) and the QRR AI commentary |
| Guardian linking (`POST/PATCH /api/investors` with a guardian PAN or id) | **None that targets it.** The guardian is in the JSON body, which Caddy cannot match. The only supported lever is per-user custom permissions (employee form → "Customize access permissions": a non-empty list is an allow-list), removing `investor.edit.assigned` / `investor.edit.all` from the users who could link. | Viewing clients; non-edit work | Creating and editing ANY client (not just minors) for those users — broad |
| Guardian's risk copied onto minors' rows | Nothing blocks the 0234 triggers without a migration; the copy is shown by the old code | — | — |
So a rollback cannot be made safe for guardian linking by configuration. Compensating controls are procedural and only detect:
written instruction not to type guardian PANs on minors, daily impact SQL §2 and §7, web-log watch on the two read paths.
Rollback therefore needs the owner's written risk acceptance, a stated end time, and the forward fix started immediately.

## 3. DBA: read-only guardian-impact baseline
`docs/security/g1-guardian-impact.sql` (on the PR branch).
```
PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -v ON_ERROR_STOP=1 -f docs/security/g1-guardian-impact.sql > g1-impact-<date>.txt
```
`$PROD_RO` is a read-only role (never `mfd_master`, never `mfd_app` through the app; no password on the command line or in the file).
It prints aggregates and masked ids (last 6 chars) only. Sections: §1 link anomalies (merged/deleted/minor/non-person/under-18/
non-individual PAN/shared PAN/other RM), §2 links outside the creator's book, §3 and §5 inherited or stale risk, §4 masked examples,
§6 one masked row per MF proposal sent to a minor since 2026-10-13 (own assessment existed at send?), §7 guardian verification counts,
§8 size of the history-read surface. Record in the change log: date, operator, host, and the aggregate counts only.
Not in the database: who read client histories or asked the AI route — search web access logs for `GET /api/audit?entityType=investor`
and `/api/ai/qrr-commentary` before the deploy; join request user to the client's RM/branch. Any read outside the reader's book, any
non-zero §2 "outside the actor's book", and any §6 row with `own_assessment_before_send = false` go to the privacy/compliance
owner as suspected incidents. Nothing is repaired, merged or edited.
