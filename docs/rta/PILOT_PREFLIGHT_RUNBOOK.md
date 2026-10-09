# KFintech pilot — production preflight runbook

For **authorized operators only**. Nothing here was run against production by the development team. Every step either:
- reads production (diagnostics);
- works on a **copy** of the production database;
- or is a two-person control action that needs explicit written authorization.

**Stop at the first failed step.** Record the evidence for every step in the pilot change ticket. A condition is PASS only when its evidence is in the ticket — never from this document or a development run. Do not start F until A–E are all PASS.

**Roles:**

| Role | Who |
|---|---|
| **Platform operator** (two different people, each `platform_admin`) | Activations, halts and releases, AMC identities, platform scheme mappings |
| **DBA** | Database copy, migration rehearsal, the role, backups |
| **Infra engineer** | S3, SES, Redis, secrets, alerts, worker recovery |
| **Compliance / firm owner** | Reviews the diagnostics; signs the pilot scope |

Commands assume the repository at the release commit, with the pilot host's `.env.production`. `ALLOW_SYSTEM_TX=1` is set only for the commands that say so.

**KFintech report codes** (KFintech Distributor Services manual; verified against the real files' headers):

| Report | What it is | Pilot role |
|---|---|---|
| **MFSD211** | Investor Master Information | required — the folio owners on record, imported **first** |
| **MFSD201** | Transaction Report | required — the transactions, imported **after** MFSD211 |
| MFSD203 | Holdings / AUM | optional — needed only to validate registrar holdings and the KFintech AUM card |
| MFSD243 | SIP / STP / SWP registrations | optional — needed only to validate SIP registration status |

---

## A. Official AMFI file integrity and mapping validation on the pilot host

**Role:** platform operator (two people: one downloads, one checks).

**Steps:**
1. On the pilot host, download `https://portal.amfiindia.com/spages/NAVAll.txt` to a new empty directory. Record the UTC time.
2. The second operator independently downloads the same URL within the same business day.
3. `sha256sum NAVAll.txt` on both. Same business date ⇒ the hashes must match. Different business dates are not a failure; compare step 4's `feedDate` first.
4. `ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --check`
5. `ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --note "downloaded <UTC> by <name>; second download by <name>, sha256 <same | differs, business dates X / Y>"`
6. Mapping validation (after E's dry-run imports on the copy, or on production read-only): the KFintech codes the firm's files use resolve **by ISIN only**:
   ```sql
   SELECT status, reason_code, count(*) FROM scheme_rta_codes
    WHERE tenant_id = '<firm>' AND rta = 'kfintech' GROUP BY 1, 2;
   SELECT basis, status, count(*) FROM registrar_amc_identity WHERE rta = 'kfintech' GROUP BY 1, 2;
   ```

**Evidence required:**
- Source URL, both download times (UTC), both SHA-256 values, both operators' names.
- The `--check` JSON: `layout`, `feedDate`, `schemes`, `withNav`, `errors`.
- The `amfi_feed_imports` row: `SELECT id, sha256, feed_date, schemes, written, status FROM amfi_feed_imports ORDER BY imported_at DESC LIMIT 1`.
- The two mapping-query results.

**PASS when:** `--check` exits 0 with `layout: current8` and `errors: []`; ≥ 1,000 schemes; `feedDate` = the business date and ≤ 7 days old; status `applied`; every `resolved_isin` KFintech code has reason `isin_verified` or `isin_verified_historical`; every KFintech AMC identity has basis `isin`.

**Stop if:** a non-zero exit; a business date older than 7 days; same-date hashes differ; status `rejected`; any KFintech code resolved other than by ISIN.

## B. Every in-scope KFintech scheme verified or explicitly held

**Role:** platform operator; compliance reviews the held list.

**Steps** (on the E copy after its imports, then again on production after F's first batch):
1. List every KFintech code the pilot files carry, with exposure:
   ```sql
   SELECT c.rta_amc_code, c.rta_scheme_code, c.status, c.reason_code, c.amfi_scheme_code,
          (SELECT count(*) FROM rta_staging_economic_txns e WHERE e.tenant_id = c.tenant_id AND e.rta = 'kfintech'
              AND e.amc_code = c.rta_amc_code AND e.scheme_code = c.rta_scheme_code) AS staged_transactions
     FROM scheme_rta_codes c WHERE c.tenant_id = '<firm>' AND c.rta = 'kfintech'
    ORDER BY (c.status IN ('resolved_isin', 'confirmed')), staged_transactions DESC;
   ```
2. Confirm every transaction on an unresolved code is held:
   ```sql
   SELECT count(*) FROM transactions t WHERE t.tenant_id = '<firm>' AND t.source_feed = 'rta_validate_first'
      AND NOT EXISTS (SELECT 1 FROM scheme_rta_codes c WHERE c.tenant_id = t.tenant_id AND c.rta_amc_code = t.amc_code
                        AND c.rta_scheme_code = t.rta_scheme_code AND c.status IN ('resolved_isin', 'confirmed') AND c.amfi_scheme_code = t.scheme_code);
   ```
3. For each unresolved code, the operator records a decision in the ticket: **held** (stays on the Scheme codes screen; its transactions on the Held screen), or approved through the two-operator platform route **with the AMC's own scheme document**. Name similarity is never evidence.

**Evidence required:** both query results; the list of unresolved codes, each with "held" or the approval id and document reference.

**PASS when:** query 2 returns 0, and every unresolved code has a recorded decision.

**Stop if:** query 2 is not 0; an unresolved code has no decision; an approval cites only a name match.

## C. Migration rehearsal on an authorized, isolated copy of production

**Role:** DBA.

**Steps:**
1. Restore the latest production backup into a **new, isolated database** that no application connects to. Record the written authorization for the copy.
2. `DATABASE_URL=<copy, owner role> npx tsx scripts/migrate-all.ts --check`
3. If it reports 0 blockers: `DATABASE_URL=<copy> npx tsx scripts/migrate-all.ts`, then `npm run check:rls` and `npm run check:schema` against the copy.
4. `SELECT filename FROM _applied_migrations ORDER BY applied_at DESC LIMIT 6` must end with `0239_…` through `0242_…`.

**Evidence required:** the authorization reference; backup id and timestamp; the `--check`, apply and both check outputs; `SELECT * FROM _migration_runs ORDER BY started_at DESC LIMIT 5`.

**PASS when:** `--check` prints `0 blockers`; the apply exits 0; both checks pass; 0242 is applied.

**Stop if:** any blocker (an edited or missing applied migration); a partial attempt; any check fails. Never "fix" by editing an applied migration — a correction is a new migration, or a reviewed entry in `drift-acknowledged.json`.

## D. Infrastructure security, worker recovery, tenant isolation, backup and alerts

**Role:** infra engineer and DBA. Record each row PASS / FAIL with its evidence; a row without evidence is NOT VERIFIED, not PASS.

| # | Check | Safe command / method | Expected | Evidence required |
|---|---|---|---|---|
| D1 | S3 RTA file store | With the app's credentials: put, get, delete a synthetic object under the RTA prefix; GET it without credentials | Authenticated round trip works; anonymous GET denied; encryption on; public access block on | Bucket policy JSON, encryption setting, the denied anonymous response |
| D2 | SES registrar mail routing | A test mail from an allowed registrar domain to the firm's alias, and one from a non-registrar domain | Registrar mail reaches the importer with DKIM / DMARC pass; the other is quarantined (`mail-trust.ts`) | Receipt rule, both message ids, both import records |
| D3 | Redis and worker recovery | `CONFIG GET appendonly`; in a quiet window restart Redis, then the worker process, then enqueue a synthetic job; with Redis stopped, try one upload | Persistence on; the worker reconnects and processes the job; with Redis down the upload answers 503 and creates no job | Config output, worker log lines, the 503 response |
| D4 | Postgres restricted role and tenant isolation | `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '<app role>'`; confirm web and worker connection strings use that role; `npm run check:rls` on the copy | Neither superuser nor BYPASSRLS; every tenant table has a policy | Query output, redacted connection-string user, check output |
| D5 | PAN-token key custody | `RTA_STAGING_TOKEN_KEY` (or `ENCRYPTION_KEY`) is in the secret store only; access list; rotation procedure | Present only in the secret store; access ≤ named people | Secret-store path and access policy (never the value) |
| D6 | Backups and restore | PITR / backup schedule; C's restore is the restore test | Restore completed within the agreed time | Schedule, restore duration |
| D7 | Alert delivery | On the copy only: break one ledger row, then `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts reconcile --tenant <copy firm>` | The alert reaches the on-call channel / Sentry | Alert id, time received |

**Stop if:** any row FAILs.

## E. Read-only production diagnostics, reviewed by the operator and compliance

**Role:** DBA runs; the responsible operator and compliance review and sign.

**Steps** (read-only; on a read replica if available):
1. `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-historical-diagnostics.ts --tenant <firm id> --json diag.json`
2. `ALLOW_SYSTEM_TX=1 npx tsx scripts/scheme-master-duplicates.ts --tenant <firm id>`
3. Review with the firm: PAN-less placeholder clients; `MINOR:` keys and guardian folios; HUF rows; folios with two owners; duplicate Scheme Master rows.

**Evidence required:** both outputs (masked); review minutes signed by the operator and compliance, with a decision per finding (accept / fix outside the pilot / exclude the client).

**PASS when:** both scripts exit 0 and write nothing; every finding has a signed decision.

**Stop if:** an unexplained two-owner folio, or a minor / HUF finding on an in-scope folio without a decision.

## F. Clean reconciliation dry run, then written two-person approval of a time-limited pilot

**Role:** DBA plus one platform operator for the dry run; two platform operators plus compliance for the approval. **Only after A–E are PASS, and only with explicit written authorization.**

**Part 1 — dry run on the C copy:**
1. Apply the A file to the copy (same command, the copy's `DATABASE_URL`).
2. Copy environment: `RTA_POSTING_MODE=controlled`, `RTA_PIPELINE_MODE=validate_first`, `RTA_POSTING_DATABASE=<copy name>`.
3. Two operators activate the pilot firm on the copy **with `registrars: ["kfintech"]`** and release the copy's global halt (Part 2's calls, the copy's URL).
4. Import the declared manifest in order: every **MFSD211**, then every **MFSD201** (then, only if in scope, MFSD203 → MFSD243). Record each file's SHA-256 before import.
5. After each import: `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts reconcile --tenant <firm id>` → five zeros.
6. Send one CAMS file to the firm: it must be refused (`covers kfintech only; a cams record is refused`), with no batch, client, folio or transaction written.
7. Re-import the whole manifest once: nothing new is posted.
8. Run B's two queries.

**Part 2 — the approval** (`POST /api/super-admin/rta-pipeline`; operator 1 requests, operator 2 is the signed-in approver):
1. Compliance signs the scope (`PILOT_PREFLIGHT.md` §6, with every field completed).
2. Check that no other firm's latest activation posts: `SELECT DISTINCT ON (tenant_id) tenant_id, mode, posting_enabled, registrars FROM rta_pipeline_activations ORDER BY tenant_id, created_at DESC`.
3. `{ action: "activate", tenantId, mode: "validate_first", postingEnabled: true, registrars: ["kfintech"], reason: "<scope summary>", approvalRef: "<ticket>", requestedBy: <operator 1>, expiresAt: <start + 14 days> }`
4. `{ action: "release", scope: "global", reason: "…", requestedBy: <operator 1> }` — releases validate-first posting **only for firms holding an activation**.
5. `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts status --tenant <firm id>`

**Evidence required:** per file of the manifest, its SHA-256, posted / held / unsupported counts and the reconcile output; the CAMS refusal message; the re-import counts; B's query results; the activation id, both operator ids, the ticket, the compliance signature and the status output.

**PASS when:** every reconcile is 0 / 0 / 0 / 0 / 0; the CAMS file is refused with nothing written; the re-import adds no row; B's query 2 is 0; status shows `validate_first`, posting enabled, `registrars: ["kfintech"]`, expiry 14 days out, approver ≠ requester.

**Stop / halt during the pilot:** any reconcile count ≠ 0, an unexplained held transaction, or an operator's doubt.
- Any one operator: `{ action: "pause", tenantId, reason }`, or `rta-posting-recovery.ts halt --scope <firm id> --by <id> --reason "…"`.
- EMERGENCY for every firm: `halt` with `scope: "emergency"`.
- Recovery: `rta-posting-recovery.ts reverse` (dry run, then `--commit` with two people) → `reconcile`.
