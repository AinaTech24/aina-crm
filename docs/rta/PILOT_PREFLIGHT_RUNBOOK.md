# KFintech pilot — production preflight runbook

For **authorized operators only**. Nothing here was run against production by the development team. Every step either:
- reads production (diagnostics);
- works on a **copy** of the production database;
- or is a two-person control action that needs explicit authorization.

**Stop at the first failed step.** Record the evidence for every step in the pilot change ticket. Do not continue to F until A–E are all PASS.

**Roles:**

| Role | Who |
|---|---|
| **Platform operator** (two different people, each `platform_admin`) | Activations, halts and releases, AMC identities, platform scheme mappings |
| **DBA** | Database copy, migrations rehearsal, the role, backups |
| **Infra engineer** | S3, SES, Redis, secrets, alerts |
| **Compliance / firm owner** | Reviews the diagnostics; signs the pilot scope |

Commands assume the repository at the release commit, with the pilot host's `.env.production`. `ALLOW_SYSTEM_TX=1` is set only for the commands that say so.

---

## A. Official AMFI source on the pilot host

**Role:** platform operator (two people: one downloads, one checks).

**Steps:**
1. On the pilot host, download `https://portal.amfiindia.com/spages/NAVAll.txt` to a new empty directory. Record the UTC time.
2. The second operator independently downloads the same URL within the same business day (AMFI publishes a new file each business day, so a next-day file may legitimately differ).
3. `sha256sum NAVAll.txt` on both. The hashes must match **if both are the same business date**. If they differ, compare the business date first (step 4); a different date is not a failure, a same-date difference is.
4. `ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --check`
5. `ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --note "downloaded <UTC time> by <name>; second download by <name>, sha256 <same | differs, business dates X / Y>"`

**Expected success:**
- `--check` exits 0 with `layout: current8`, the header exactly AMFI's eight columns, and `errors: []`.
- At least 1,000 schemes; 0 conflicting duplicates.
- `feedDate` is the business date, ≤ 7 days old.
- Apply prints `status: applied`.

**Evidence:**
- Source URL, both download times and both SHA-256 values.
- The `--check` JSON.
- The `amfi_feed_imports` row id: `SELECT id, sha256, feed_date, schemes, written, status FROM amfi_feed_imports ORDER BY imported_at DESC LIMIT 1`.

**Stop if:**
- The `--check` exit code is not 0.
- The business date is more than 7 days old.
- Same-date hashes differ.
- The status is `rejected`.

## B. `migrate:all --check` on a safe production copy

**Role:** DBA.

**Steps:**
1. Restore the latest production backup into a **new, isolated database** that no application connects to.
2. `DATABASE_URL=<copy, owner role> npx tsx scripts/migrate-all.ts --check`
3. If it reports 0 blockers: `DATABASE_URL=<copy> npx tsx scripts/migrate-all.ts`, then `npm run check:rls` and `npm run check:schema` against the copy.
4. `SELECT filename FROM _applied_migrations ORDER BY applied_at DESC LIMIT 5` must end with `0239_…`, `0240_…`, `0241_…`.

**Expected success:**
- `--check` prints `0 blockers`; pending lists only the unapplied files up to 0241.
- The apply exits 0.
- Both checks pass.

**Evidence:**
- Backup id and timestamp.
- The `--check` output, the apply output and the check outputs.
- The run log: `SELECT * FROM _migration_runs ORDER BY started_at DESC LIMIT 5`.

**Stop if:**
- Any blocker (an edited or missing applied migration).
- A partial attempt is detected.
- Any check fails.

Never "fix" by editing an applied migration: a correction is a new migration, or a reviewed entry in `drift-acknowledged.json`.

## C. Infrastructure

**Role:** infra engineer and DBA. Record each item PASS / FAIL with its evidence.

| # | Check | Safe command / method | Expected | Evidence |
|---|---|---|---|---|
| C1 | S3 RTA file store | With the app's credentials: put, get, then delete a synthetic object under the RTA prefix; try a GET without credentials | Authenticated round trip works; anonymous GET is denied; bucket encryption on; public access block on | Bucket policy JSON, encryption setting, the denied anonymous response |
| C2 | SES registrar mail routing | Send a test mail from an allowed registrar domain to the firm's alias; also from a non-registrar domain | Registrar mail reaches the importer with DKIM / DMARC pass; the other is quarantined (`mail-trust.ts`) | Receipt rule, both message ids, both import records |
| C3 | Redis recovery | Check `CONFIG GET appendonly` / snapshot settings; restart Redis during a quiet window, then enqueue a synthetic job | Persistence on; after restart the worker reconnects and processes; with Redis down an upload answers 503 and creates no job | Config output, worker log lines, the 503 response |
| C4 | Postgres restricted role and RLS | `\du` on production; `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '<app role>'`; confirm the web and worker connection strings use that role; `npm run check:rls` on the copy | App role is neither superuser nor BYPASSRLS; every tenant table has a policy | Query output, the redacted connection-string user, the check output |
| C5 | PAN-token key custody | Confirm `RTA_STAGING_TOKEN_KEY` (or `ENCRYPTION_KEY`) is in the secret store, not in a file or repository; who can read it; rotation procedure written | Key present only in the secret store; access list ≤ named people | Secret-store path and access policy (never the value) |
| C6 | Backups and restore | Confirm the PITR / backup schedule; the B restore itself is the restore test | Restore completed within the agreed time | Schedule, restore duration |
| C7 | Alert delivery | Trigger a synthetic reconciliation alert on the copy (`ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts reconcile --tenant <copy firm>` after deliberately breaking one ledger row **on the copy only**) | The alert reaches the on-call channel / Sentry | Alert id, time received |

**Stop if:** any row FAILs.

## D. Read-only historical diagnostics for the pilot firm

**Role:** DBA runs; compliance / firm owner reviews.

**Steps** (read-only; on a read replica if available):
1. `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-historical-diagnostics.ts --tenant <firm id> --json diag.json`
2. `ALLOW_SYSTEM_TX=1 npx tsx scripts/scheme-master-duplicates.ts --tenant <firm id>`
3. Review with the firm:
   - placeholder (PAN-less) clients;
   - `MINOR:` keys and guardian folios;
   - HUF rows;
   - folios with two owners;
   - duplicate Scheme Master rows.

**Expected success:**
- Both scripts exit 0 and write nothing (they have no write path).
- Every finding has an owner and a decision: accept / fix outside the pilot / exclude the client.

**Evidence:** both outputs (masked) and the review minutes, signed by compliance.

**Stop if:** an unexplained two-owner folio, or a minor / HUF finding on a folio in pilot scope without a decision.

## E. Reconciliation dry run on the production copy

**Role:** DBA plus one platform operator.

**Steps** (on the B copy only):
1. Apply the A file to the copy: same command, the copy's `DATABASE_URL`.
2. Set the copy's environment: `RTA_POSTING_MODE=controlled`, `RTA_PIPELINE_MODE=validate_first`, `RTA_POSTING_DATABASE=<copy name>`.
3. Two operators activate the pilot firm on the copy and release the copy's global halt (§F commands, copy URL).
4. Import the pilot files in order: MFSD211 → MFSD201 (and, if used, MFSD203 → MFSD243). Use the latest real files for the firm.
5. After each import: `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts reconcile --tenant <firm id>`
6. Re-import the same files once.

**Expected success:**
- Every reconcile prints five zeros (exit 0).
- The re-import posts nothing new.
- Every posted transaction is on an approved AMFI identity:
  ```sql
  SELECT count(*) FROM transactions t
   WHERE t.tenant_id = '<firm>' AND t.source_feed = 'rta_validate_first'
     AND NOT EXISTS (SELECT 1 FROM scheme_rta_codes c
                      WHERE c.tenant_id = t.tenant_id AND c.rta_amc_code = t.amc_code AND c.rta_scheme_code = t.rta_scheme_code
                        AND c.status IN ('resolved_isin', 'confirmed') AND c.amfi_scheme_code = t.scheme_code)
  ```
  must return 0.
- The Held and Scheme codes screens list every exception.

**Evidence:**
- Reconcile outputs.
- Posted, held and unsupported counts per file.
- The identity query result.
- The list of unresolved scheme codes with their exposure.

**Stop if:**
- Any reconcile count is not 0.
- The identity query is not 0.
- The re-import adds a row.

## F. Two-person approval and the documented 14-day scope

**Role:** two platform operators, plus compliance sign-off. **Only after A–E are PASS, and only with explicit written authorization.**

**Steps:**
1. Compliance signs the scope (§ "Exact 14-day pilot scope" in `PILOT_PREFLIGHT.md`).
2. Operator 1 (requester) and operator 2 (signed-in approver), via `POST /api/super-admin/rta-pipeline`:
   - `{ action: "activate", tenantId, mode: "validate_first", postingEnabled: true, reason: "<scope summary>", approvalRef: "<ticket>", requestedBy: <operator 1>, expiresAt: <now + 14 days> }`
   - `{ action: "release", scope: "global", reason: "…", requestedBy: <operator 1> }` — the global posting halt is installed halted. Releasing it lets validate-first posting run, but **only for firms holding an activation**, which is the pilot firm alone. Check first that no other firm's latest activation is validate-first with posting: `SELECT DISTINCT ON (tenant_id) tenant_id, mode, posting_enabled FROM rta_pipeline_activations ORDER BY tenant_id, created_at DESC`.
3. Confirm: `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts status --tenant <firm id>`

**Expected success:** status shows `validate_first`, posting enabled, expiry in 14 days, approver ≠ requester.

**Evidence:** the activation id, both operator ids, the ticket and the status output.

**Stop / halt during the pilot:** any reconcile count ≠ 0, an unexplained held transaction, or an operator's doubt.
- Any one operator: `{ action: "pause", tenantId, reason }`; or `rta-posting-recovery.ts halt --scope <firm id> --by <id> --reason "…"`.
- EMERGENCY for every firm: `halt` with `scope: "emergency"`.
- Recovery: `rta-posting-recovery.ts reverse` (dry run, then `--commit` with two people) → `reconcile`.
