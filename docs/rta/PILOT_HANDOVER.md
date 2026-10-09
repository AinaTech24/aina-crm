# KFintech transaction pilot — operational handover package

**For:** the authorized infrastructure engineer, DBA, the two platform operators and the compliance reviewer.

**Authorization status:** **there is NO authorization for production deployment, migration, activation or financial posting.** This package lets authorized people decide whether the restricted 14-day KFintech pilot may begin. Nothing in it has been run against production, and no condition below is marked PASS.

**This is the single operational document.** Supporting material:
- `docs/rta/handover/kfintech-pilot-scheme-codes.csv` — the 118 pilot-scope KFintech scheme codes, with processed and rejected business kept apart.
- `docs/rta/handover/kfintech-pilot-totals.csv` — the reconciliation totals the CSV must add up to (checked by `tests/pilot-handover-csv.test.ts`).
- `scripts/rta-file-manifest.ts` — read-only, no database: the per-file manifest and the daily MFSD201 calendar (§1.3, §5.9).
- `docs/rta/PILOT_PREFLIGHT.md` — the development evidence report.

**Development results are not production outcomes.** Every count in §1 and §4 comes from the real sample files, imported into **isolated development databases** (`rta_handover`, then `rta_final` for this corrections round, each built from empty at migration 0242 with the authentic AMFI file of 07-Oct-2026). Production files, dates and counts will differ; the pilot is judged on its own evidence.

**How to use this package:**
1. Open one change ticket.
2. For every step, paste the command, its output and the operator's name into the ticket.
3. A condition is PASS only when that evidence is in the ticket.
4. Stop at the first stop condition.

---

## 1. Pilot file manifest

### 1.1 Report codes (KFintech Distributor Services manual; checked against the files' own headers)

| Report | What it is | Pilot role | Import order |
|---|---|---|---|
| **MFSD211** | Investor Master Information | **required** — folio owners on record | **first** |
| **MFSD201** | Transaction Report | **required** — the transactions | **second** |
| MFSD203 | Holdings / AUM | **not in pilot scope** | — |
| MFSD243 | SIP / STP / SWP registrations | **not in pilot scope** | — |

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
| **No CAMS file and no other report type** | CAMS is refused by the activation's registrar scope. **MFSD203, MFSD243 and MFSD230 are NOT refused by the software** (the scope is per registrar, not per report — §7, gap 2): if one reaches the pilot firm it posts holdings legs or verified SIP registrations. Controls: the firm's mail alias is inactive for the pilot, uploads are MFSD211 / MFSD201 only, and the daily report-code check (§5.9) must show nothing else |
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

| Purpose | Command | Expected |
|---|---|---|
| AMFI file integrity | `sha256sum NAVAll.txt` (on each of the two downloads) | same business date ⇒ same hash |
| AMFI file validation | `DATABASE_URL=$COPY_ADMIN ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --check` | exit 0; `layout: current8`; `errors: []`; `feedDate` = the business date, ≤ 7 days old; `conflictingDuplicates: 0`. Rehearsal: feedDate 2026-10-07, 14,357 schemes, 14,116 with NAV, errors [] |
| Applied AMFI file | `psql "$PROD_RO" -Atc "SELECT feed_date, sha256, schemes, written, status FROM amfi_feed_imports ORDER BY imported_at DESC LIMIT 1"` | the hash recorded at A |
| KFintech mapping | `psql "$PROD_RO" -Atc "SELECT status, reason_code, count(*) FROM scheme_rta_codes WHERE tenant_id = '<firm>' AND rta = 'kfintech' GROUP BY 1, 2"` | every resolved code is `isin_verified` / `isin_verified_historical` |
| KFintech AMC identities | `psql "$PROD_RO" -Atc "SELECT basis, status, count(*) FROM registrar_amc_identity WHERE rta = 'kfintech' GROUP BY 1, 2"` | basis `isin` only |
| Migration file checksums | `node scripts/check-migration-lock.mjs` | `✓ 280 migrations match checksums.lock.json.` |
| Migration ledger vs files | `DATABASE_URL=$COPY_ADMIN npx tsx scripts/migrate-all.ts --check` | `0 blockers`; lists pending files. Rehearsal: `280 applied, 0 pending, 0 acknowledged drift, 0 blockers` |
| RLS coverage | `DATABASE_URL=$COPY_ADMIN npm run -s check:rls` | `✓ all 187 tenant-scoped table(s) have RLS enabled + forced + tenant_isolation policy` |
| Schema parity | `DATABASE_URL=$COPY_ADMIN npm run -s check:schema` | `✓ Schema guard: 194 ORM tables, every modelled column present in the DB.` |
| Application role | `psql "$PROD_RO" -Atc "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '<app role>'"` | `<app role>\|f\|f` |
| Role owns nothing | `psql "$PROD_RO" -Atc "SELECT count(*) FROM pg_tables WHERE tableowner = '<app role>'"` | `0` |
| Web and worker connect as that role | on each host: `node -e 'const u=new URL(process.env.APP_DATABASE_URL\|\|process.env.DATABASE_URL);console.log(u.username,u.hostname,u.pathname)'` | `<app role>`, the production host and database; no password printed |
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
| Alert sink configured | on the worker host: `env \| grep -cE '^(OBSERVABILITY_WEBHOOK_URL\|ERROR_WEBHOOK_URL)='` | `1` or more. **With none set, a reconciliation alert reaches only the firm's audit log** |
| Alerts already raised | `psql "$PROD_RO" -Atc "SELECT at, after FROM audit_log WHERE tenant_id = '<firm>' AND action = 'rta.posting.reconcile_alert' ORDER BY at DESC LIMIT 5"` | none before the pilot |
| Backups (RDS example; use the provider's equivalent) | `aws rds describe-db-instances --db-instance-identifier <id> --query 'DBInstances[0].{Retention:BackupRetentionPeriod,LatestRestorable:LatestRestorableTime}'` | retention ≥ the agreed period; latest restorable within minutes |

### 2.2 ISOLATED COPY ONLY — these write, but only to the authorized copy

Each was rehearsed on `rta_handover`. Run them only with `DATABASE_URL` / `ADMIN_DATABASE_URL` naming the copy, and `RTA_POSTING_DATABASE=<copy name>`.

| Purpose | Command |
|---|---|
| Apply pending migrations | `DATABASE_URL=$COPY_ADMIN npx tsx scripts/migrate-all.ts` |
| Apply the AMFI file | `DATABASE_URL=$COPY_ADMIN ALLOW_SYSTEM_TX=1 npx tsx scripts/amfi-import.ts --file NAVAll.txt --note "downloaded <UTC> by <name>; second download by <name>, sha256 <…>"` |
| Activate the pilot firm on the copy | the §5.1 activation call against the copy's app |
| Import the manifest | upload through the copy's app (`/dashboard/rta-imports`), with the copy's web and worker processes, a **non-production** S3 bucket and Redis. Order: MFSD211, then MFSD201 |
| Deliberate failure, for the alert test | break one ledger row on the copy only, then run `reconcile` (§2.1) and confirm the alert arrives |

### 2.3 MODIFIES AN ENVIRONMENT — not part of the preflight; only with written authorization

| Action | Who | Where |
|---|---|---|
| `migrate-all.ts` (apply), `amfi-import.ts` (apply) on production | DBA / operator | production — after F only |
| Activation, release of a kill switch | two platform operators | production — F only |
| Halt, pause, emergency (§5) | one platform operator | production — at any time, to stop |
| `reverse --commit`, `undo` (§5.6) | two platform operators | production — recovery only |
| S3 synthetic put / get / delete under `tenants/<firm>/rta/preflight-…` | infra engineer | production bucket — D1 |
| Test mails from a registrar domain and from a non-registrar domain | infra engineer | the live inbox — D2 (creates import records) |
| Redis and worker restart | infra engineer | production — D3, in an agreed quiet window |
| Point-in-time restore into a NEW instance | DBA | production account — C (creates a resource; never restore over production) |
| Removing an unapproved parked import job (EC-2) | platform operator, with the firm halted | production Redis — only for a job NOT on the approved inventory |
| Stopping RTA mail for the pilot firm (EC-4 / §7 gap 2) | the firm pauses its own mailbox forwarding rule; or the DBA, under the ticket, runs `UPDATE rta_forward_addresses SET is_active = false WHERE tenant_id = '<firm>' AND is_active` (the app has no "deactivate" button; re-enabling after the pilot is "regenerate address" in Settings) | production — before F part 2 |

### 2.4 Evidence checks added in the corrections round (EC-1 – EC-6)

Each is part of a release condition (named in brackets). Every SQL here is read-only. Run it with `PGOPTIONS='-c default_transaction_read_only=on'`.

**EC-1 — Existing legacy-imported transactions: idempotent matching and collision handling** *(E, and F part 1 on the production copy)*

Before activation, a firm's existing transactions came from the legacy importer. When validate-first meets the same registrar transaction number, it either **links** the existing row (`matched_existing`: same folio, date, direction, amount, units, or for a refusal the same rejected status) or **holds** it (`quarantined`, `identity_conflict`). Neither row is ever changed.

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
   -- every matched legacy row: the registrar's scheme code agrees (matching itself does NOT compare the scheme — §7 gap 4)
   SELECT count(*) FILTER (WHERE t.scheme_code IS DISTINCT FROM e.scheme_code AND t.scheme_code IS DISTINCT FROM c.amfi_scheme_code) AS scheme_differs,
          count(*) FILTER (WHERE c.status IS DISTINCT FROM 'resolved_isin') AS on_unresolved_code
     FROM rta_posted_transactions p JOIN transactions t ON t.id = p.transaction_id JOIN rta_staging_economic_txns e ON e.id = p.economic_txn_id
     LEFT JOIN scheme_rta_codes c ON c.tenant_id = p.tenant_id AND c.rta = 'kfintech' AND c.rta_amc_code = e.amc_code AND c.rta_scheme_code = e.scheme_code
    WHERE p.tenant_id = '<firm>' AND p.kind = 'matched_existing';
   ```
3. Re-run the §5.7 fingerprint over the legacy rows (`source_feed IS NULL`) before and after: it must not change.

**Expected:**
- `matched_existing` + `posted` + `rejected_recorded` + held = the copy's economic records.
- `scheme_differs` = 0 and `on_unresolved_code` = 0.
- Every `identity_conflict` has a written decision, investigated against the registrar file — never "fixed" by editing either row.
- The legacy fingerprint is unchanged.
- No registrar number appears twice.

**Rehearsed (rta_final), legacy then validate-first on the same four files:**
- The legacy importer wrote 1,061 rows (1,058 processed + 3 rejected). It held the 15 lot-by-lot redemptions.
- Validate-first then linked **1,061** as `matched_existing` and posted only the **15** multi-lot redemptions the legacy importer never wrote. It held the same 18 corrections and 6 unknown codes.
- Ledger 1,076; 0 numbers twice; `scheme_differs` 0; reconcile 0; a second pass posted nothing (`already_posted`).
- **Collision drill:** two legacy rows altered on the copy (one amount + ₹1, one date − 1 day). Both were held as `identity_conflict`; the legacy rows were byte-identical afterwards (hash unchanged); nothing was duplicated; reconcile 0.
- **Note:** matched legacy rows keep their legacy scheme code (the registrar product code) and get no AMFI code — no historical repair is done. They are legacy records, not pilot outcomes. B's query (ii) counts only `source_feed = 'rta_validate_first'`.

**Stop if:** any number appears twice; `scheme_differs` or `on_unresolved_code` ≠ 0; the legacy fingerprint changes; an `identity_conflict` without a decision.

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
3. **Every parked job must be on that list.** A job not on it is removed while the firm is still halted (§2.3; see the command below), and its removal is recorded. Removing a job does not delete the file or the import row. With the queue idle, the reaper later marks that row `failed` — it never posts.
   ```bash
   node --input-type=module -e "import { Queue } from 'bullmq'; const q = new Queue('rta.import', { connection: { url: process.env.REDIS_URL } }); const j = await q.getJob(process.argv[1]); console.log(j ? 'removing ' + j.id + ' ' + j.data.filename : 'no such job'); if (j) await j.remove(); await q.close();" <job id>
   ```
4. Re-run the inventory: only approved files remain. Then resume (two operators).

**Rehearsed** against a local Redis with real BullMQ delayed jobs: the inventory listed both jobs with firm, import and file; the removal command removed exactly the named job.

**Stop if:** any parked or queued job for the firm is not on the signed inventory; a CAMS, MFSD203, MFSD243 or MFSD230 file is in the backlog.

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
4. **For the pilot itself, no mail is imported for the firm** (§7 gap 2). Either the firm's forwarding rule is paused, or the alias is deactivated (§2.3). `SELECT count(*) FROM rta_forward_addresses WHERE tenant_id = '<firm>' AND is_active` is recorded, and from the pilot start the step-3 query shows no `imported` row. Every pilot file is uploaded from the signed inventory (EC-2).

**Stop if:** no authenticated header can be shown; a signing domain outside `REGISTRAR_DOMAINS`; an `imported` row without an authenticated domain; any mail imported for the pilot firm after F part 2.

**EC-5 — Alert delivery to a real on-call destination** *(D7)*

1. `OBSERVABILITY_WEBHOOK_URL` (or `ERROR_WEBHOOK_URL`) is set on the **worker** host (§2.1). The infra engineer names the system and rota it posts to.
2. On the copy: break one ledger row, then run `reconcile` (§2.2). Also let the nightly scan run, which writes `rta.posting.reconcile_alert`.
3. **A named on-call person acknowledges the alert** in the on-call tool. A message in an unwatched channel does not count.

**Evidence:**
- the incident or alert id;
- time sent, time acknowledged and by whom;
- the audit-log row: `SELECT at, after FROM audit_log WHERE action = 'rta.posting.reconcile_alert' ORDER BY at DESC LIMIT 1`.

**Stop if:** no acknowledgement within the agreed response time; the webhook is unset; the alert reaches only the audit log.

**EC-6 — Server-verified identities and separate approvals of the two platform operators** *(F)*

**What the software verifies today:**
- **On the API** (`/api/super-admin/rta-pipeline`), the **approver** is the signed-in platform session (server-verified; needs `platform.settings.manage`).
- The **requester** is only an id in the request body. The server checks it is an active platform operator other than the approver, but **does not authenticate them**.
- **On the CLI** (`rta-posting-recovery.ts release / reverse / undo`), `--by` and `--approver` are both just flags, with no authentication at all (§7 gap 3).

**Controls until that is changed:**
1. Both operators have active platform accounts with two-factor authentication on:
   ```sql
   SELECT id, status, roles, two_fa_enabled FROM users WHERE id IN ('<op 1>', '<op 2>');
   ```
2. Operator 1's request is a written, signed entry in the change ticket, made from operator 1's own ticket-system identity, before operator 2 acts.
3. **Starts (activation, release) are done only through the API by operator 2, signed in.** CLI `release` is not used in production.
4. A CLI `reverse --commit` / `undo` runs only on a DBA's terminal, with both operators present and both signatures in the ticket.
5. After every two-person action:
   ```sql
   SELECT a.id, a.requested_by, a.approved_by, a.requested_by <> a.approved_by AS two_people,
          EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id = a.approved_by AND s.created_at <= a.created_at
                    AND (s.revoked_at IS NULL OR s.revoked_at > a.created_at)) AS approver_had_live_session,
          (SELECT count(*) FROM audit_log l WHERE l.action = 'rta.pipeline.activate' AND l.entity_id = a.id AND l.actor_user_id = a.approved_by) AS audit_rows
     FROM rta_pipeline_activations a WHERE a.tenant_id = '<firm>' ORDER BY a.created_at DESC LIMIT 1;
   ```
   Expected: `two_people` true; `approver_had_live_session` true; `audit_rows` 1; the ids match the ticket.

**Rehearsed:** the query runs. In the rehearsal `approver_had_live_session` is false, because the library was called directly. **This is exactly why the requester cannot be proven from the database and needs the ticket control.**

**Stop if:**
- either account lacks two-factor authentication;
- the requester's signed request is missing or dated after the action;
- the approver had no live session;
- a production start was done through the CLI.

---

## 3. Six release conditions

**Current status: none is PASS. Every production-dependent condition is NOT VERIFIED; F is NOT DONE.**

| Condition | GO / NO-GO today | What would make it PASS |
|---|---|---|
| A. AMFI integrity and mapping | **NO-GO** (not verified) | the two-download evidence and mapping queries on the pilot host |
| B. Schemes verified or held | **NO-GO** (not verified) | B (ii) = 0 on the copy; a decision for each unresolved code |
| C. Migration rehearsal | **NO-GO** (not verified) | 0 blockers and both checks on an authorized copy |
| D. Infrastructure, isolation, backups, alerts | **NO-GO** (not verified) | D1–D7, including EC-4 (authenticated mail) and EC-5 (acknowledged alert) |
| E. Diagnostics reviewed | **NO-GO** (not verified) | signed review, including EC-1 step 1 (legacy transactions) |
| F. Dry run + two-person approval | **NO-GO** (not done) | the clean dry run including EC-1 – EC-3, then EC-2, EC-4 step 4 and EC-6 before a signed approval |

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
| Expected | `0 blockers`; the apply exits 0; both checks pass; the newest is `0242_activation_registrar_scope.sql` |
| Evidence | Authorization reference; backup id and time; restore duration; every output; `SELECT * FROM _migration_runs ORDER BY started_at DESC LIMIT 5` |
| Status | **NOT VERIFIED** (development: 280 applied from empty, 0 blockers, RLS 187 tables, schema 194 tables; immutability drill 14 / 14) |
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
| Exact test | **Part 1 — on the C copy** (it holds the firm's real legacy transactions): env `RTA_POSTING_MODE=controlled`, `RTA_PIPELINE_MODE=validate_first`, `RTA_POSTING_DATABASE=<copy>`. Run `rta-file-manifest.ts --arn` on every file (EC-3). Activate the firm on the copy with `registrars: ["kfintech"]` (§5.1); release the copy's global halt (two operators). Import the signed manifest: every MFSD211, then every MFSD201. After each file, `reconcile`. Then **EC-1 step 2–3** (legacy matching and collisions). Send one CAMS file: it must be refused. Re-import the whole manifest once. Run B. **Part 2 — approval:** **EC-2** inventory of the production queue and import rows (nothing unapproved), **EC-4 step 4** (no mail for the firm), **EC-6** controls; compliance signs §6 with every field complete; operator 2, signed in, makes the §5.1 activation and release through the API; then `status` and the EC-6 query |
| Expected | Every `reconcile` exit 0. EC-1 as stated (matched legacy rows linked, not duplicated; every collision held with a decision; legacy fingerprint unchanged). CAMS: `covers kfintech only; a cams record is refused — nothing is posted`, no batch written. Re-import: `already_posted` only, transaction count unchanged. B (ii) = 0. The production queue holds no unapproved job for the firm. `status`: `validate_first`, `postingEnabled: true`, `registrars: ["kfintech"]`, expiry = start + 14 days; the EC-6 query: two people, the approver's live session, one audit row |
| Evidence | Per file: the manifest output, posted / rejected_recorded / matched_existing / held / unsupported counts, the reconcile output; the EC-1 query results and collision decisions; the CAMS refusal; the re-import counts; the EC-2 inventory and any removals; the EC-4 alias / forwarding state; operator 1's signed request; the activation id, both operator ids, the ticket, the compliance signature, the `status` and EC-6 outputs |
| Status | **NOT DONE** — needs explicit written authorization |
| Stop if | Any reconcile ≠ 0; an EC-1, EC-2, EC-4 or EC-6 stop; the CAMS file is not refused; the re-import adds a row; an unexplained held transaction; any operator's doubt |

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
       count(DISTINCT CASE WHEN t.status = 'rejected' THEN coalesce(nullif(t.raw_feed_row->>'switchRef', ''), t.order_id) END) AS rejected_instructions,
       count(*) FILTER (WHERE t.status NOT IN ('processed', 'rejected')) AS other_status
  FROM rta_posted_transactions p JOIN transactions t ON t.id = p.transaction_id WHERE p.tenant_id = '<firm>';
```
Result: 1,076 · 1,073 · 10227740.48 · 3 · 12000.00 · 2 · 0. The scheme CSV's column sums equal these figures (`tests/pilot-handover-csv.test.ts`).

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

The pause, activate and revoke actions exist only on the API. The operator's platform session is the `aina_session` cookie. Never paste it into the ticket.

```bash
API=https://<app host>/api/super-admin/rta-pipeline
call() { curl -sS -X POST "$API" -H 'content-type: application/json' -b "aina_session=$AINA_SESSION" -d "$1"; echo; }
# Activate (operator 2 signed in = approver; operator 1 = requester):
call '{"action":"activate","tenantId":"<firm>","mode":"validate_first","postingEnabled":true,"registrars":["kfintech"],"reason":"<scope summary>","approvalRef":"<ticket>","requestedBy":"<operator 1 id>","expiresAt":"<start + 14 days, ISO 8601>"}'
```

Halts and releases also have the CLI:
- `ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts halt --scope <firm>|global|emergency --by <operator id> --reason "…"`
- `… release --scope … --by <operator 1> --approver <operator 2> --reason "…"`

### 5.2 Pausing the pilot (one operator)

1. `call '{"action":"pause","tenantId":"<firm>","reason":"<why, ≥ 10 characters>"}'` — or halt the firm with the CLI (`halt --scope <firm>`).
2. Confirm: `rta-posting-recovery.ts status --tenant <firm>` shows the paused activation or the firm halt.
3. Resume (two operators): a new `activate` call (§5.1), or `release --scope <firm>` with a different approver.

**Rehearsed:** paused → mode `held`; resumed by two operators → `validate_first`; a one-person release was refused.

### 5.3 Emergency global halt (one operator)

- Every RTA write for every firm, legacy importer included: `rta-posting-recovery.ts halt --scope emergency --by <id> --reason "…"`.
- Posting only, all firms: `--scope global`.
- A running batch finishes first; the halt waits for it, then stops every later one.
- Release (two operators): `release --scope emergency --by <op 1> --approver <op 2> --reason "…"`.

**Rehearsed:** emergency → `held` ("EMERGENCY SHUTDOWN of all RTA imports"); a one-person release was refused; a two-person release → `validate_first`.

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
3. remove each job not on it, with the firm still halted, using the BullMQ command in EC-2 — not a bare `ZREM`, which leaves the job record behind;
4. re-inventory, then resume (two operators).

**Do not:**
- re-upload a parked file — the same file posts once anyway;
- import parked files with `import-rta-local.ts`, which refuses a validate-first firm;
- resume with a CAMS, MFSD203, MFSD243 or MFSD230 job in the backlog. CAMS would be refused; the others would post (§7 gap 2).

`failed` jobs: read the row's `remarks`. `validate_first_refused` is a configuration error — fix the configuration and re-upload. It never falls back to the legacy importer.

### 5.5 Investigating a failed reconciliation

**Trigger:** `reconcile` exits 3, or a `rta.posting.reconcile_alert` appears.

1. **Halt the firm immediately:** `halt --scope <firm>`.
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
6. **Resume only** when `reconcile` exits 0, and only with two operators.

### 5.6 Reversing a bad batch (two people)

The firm must be halted first. Reversal goes newest first; a batch others depend on is refused.

1. **Dry run:**
   ```bash
   ALLOW_SYSTEM_TX=1 npx tsx scripts/rta-posting-recovery.ts reverse --tenant <firm> --batch <batch id> --by <op 1> --approver <op 2> --reason "…"
   ```
   Check `blocked: false`, the counts, and every `dependencies` value = 0.
2. **Commit:** the same command with `--commit`. Every removed row is archived whole in the append-only `rta_posting_reversals`, with an audit-log row.
3. **Confirm:** `reconcile` exits 0. The transaction and ledger counts fall by exactly the dry run's counts.
4. **If the reversal itself was wrong:**
   ```bash
   … undo --tenant <firm> --reversal <reversal id> --by <id> --reason "…"
   ```
   The firm must still be halted. Then `reconcile`.
5. **Resume:** release with two operators, then re-import the corrected file.

**Rehearsed on the October MFSD201 batch:**
- a one-person approval was refused;
- the dry run showed 391 transactions and 391 ledger entries, `blocked: false`;
- `--commit` left 685 transactions, reconcile 0;
- undo while released was refused ("halt posting for this firm first");
- undo while halted restored 391 + 391, with the fingerprint identical to before (`f8a87458…`), reconcile 0.

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
- Extending, widening or returning to the legacy importer (`mode: "off"`) are each a new two-person decision. Returning to legacy is NOT a rollback of what was posted.

**Rehearsed:** an activation set to expire in 4 seconds read `validate_first` before and `held` after; the explicit pause record read `held`.

### 5.9 Daily pilot controls (every business day of the 14 days)

| # | Check | Command | Expected | Stop if |
|---|---|---|---|---|
| 1 | Yesterday's MFSD201 arrived | `npx tsx scripts/rta-file-manifest.ts <all pilot MFSD201 files> --calendar <start> <today> --arn <pilot ARN>` (EC-3) | every weekday `present`, or answered in the ticket | an unanswered `MISSING` business day for more than one business day; exit 2 for an ARN |
| 2 | Only approved report types reached the firm | `SELECT report_code, rta, count(*) FROM rta_staging_batches WHERE tenant_id = '<firm>' AND created_at >= '<start>' GROUP BY 1, 2` | only `MFSD211`, `MFSD201` (`kfintech`) | any other report code or registrar → halt the firm (§5.2), then investigate with §5.5 |
| 3 | No mail imported for the firm | the EC-4 step 3 query since `<start>` | no `imported` row | any `imported` row |
| 4 | Every batch reconciles | `rta-posting-recovery.ts reconcile --tenant <firm>` | exit 0 | exit 3 → §5.5 |
| 5 | Processed vs rejected, from the ledger | the §4.1 ledger query | `other_status` 0; rejected legs carry 0 units | `other_status` ≠ 0 or a rejection with units |
| 6 | Held items are actionable | the Held screen (`/dashboard/rta-imports/held`); the four unresolved codes still listed on the Scheme codes screen | each held item has an owner and a next step | a held item nobody owns for two business days |
| 7 | Backlog | EC-2 inventory | nothing unapproved | any unapproved job |

---

## 6. GO / NO-GO sign-off sheet

Every field is blank on purpose. Complete it in ink or in the ticket; do not pre-fill from development values.

| Field | Entry |
|---|---|
| Pilot organization (legal name) | |
| Tenant id | |
| ARN (must equal the Agent / Broker Code in every file) | |
| Registrar scope | KFintech only — `registrars: ["kfintech"]` |
| Pilot start (date, time IST) | |
| Pilot end = `expiresAt` (start + 14 days) | |
| Approved file scope: per file, report code (MFSD211 / MFSD201 only), file name, SHA-256, data rows, Report Date (`rta-file-manifest.ts` output reference) | |
| Approved backlog inventory before activation (EC-2): reference, and jobs removed | |
| RTA mail for the firm stopped for the pilot (EC-4 step 4): how, and by whom | |
| On-call destination that acknowledged the test alert (EC-5): system, rota, alert id | |
| Operator 1's signed request (EC-6): ticket reference and time | |
| First platform operator (requester): name, user id | |
| Second platform operator (approver): name, user id | |
| DBA: name | |
| Infrastructure engineer: name | |
| Compliance reviewer: name | |

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

**Final authorization:**
- ☐ **GO** for the 14-day KFintech transaction-only pilot. Every condition above is PASS with evidence.
- ☐ **NO-GO.** Reason: ________

The pilot validates verified KFintech transactions only. It makes no claim about AUM, holdings, the SIP Book, the SIP Master, CAMS or any other module.

| Signature | Name | Date |
|---|---|---|
| Platform operator 1 | | |
| Platform operator 2 | | |
| Compliance reviewer | | |

**Recommendation from development:** **NO-GO until A–E are PASS with production evidence, EC-1 – EC-6 are evidenced, and F is signed.** The software gaps in §7 are not fixed; for the 14-day pilot they are held by the stated operator controls. Without those controls, gaps 2 and 3 would block GO.

---

## 7. Software gaps found in the corrections round (not fixed — no new development phase)

| # | Gap | Effect on the pilot | Control for the pilot | Proposed fix (for a later, approved change) |
|---|---|---|---|---|
| 1 | The Operations Dashboard's Rejections figures (`lib/dashboard/ops/exceptions.ts`, `flow.ts`, `people.ts`) count each STP **leg** as a rejection and add both legs' amounts. A failed STP shows as 2 rejections of ₹10,000, not 1 of ₹5,000 | Reporting only; no financial record is wrong. Business figures exclude rejections | Read pilot rejections from the §4.1 ledger query (instructions by switch reference), not from that card | Count rejected STP legs by the shared `raw_feed_row->>'switchRef'` and take the amount once |
| 2 | The activation is scoped by **registrar**, not by **report type**. An MFSD203, MFSD243 or MFSD230 file for the pilot firm — by upload or by forwarded mail — posts holdings legs or verified SIP registrations | Would take the pilot outside "transactions only" | Mail for the firm stopped (EC-4 step 4); uploads only from the signed inventory (EC-2); daily report-code check (§5.9 #2); halt on any other report | An activation `report_codes` allow-list, enforced like the registrar scope of migration 0242 |
| 3 | Two-person approval verifies only the **approver** (the signed-in API session). The requester is an id in the request; the CLI's `--by` / `--approver` are unauthenticated | The "two people" rule rests partly on process | EC-6: signed request in the ticket before the action; starts only through the API by the signed-in approver; CLI recovery only with both present; 2FA on both accounts | A request object the requester creates in their own session, approved in a second, different session |
| 4 | Matching an existing legacy row (`matched_existing`) compares folio, date, direction, amount and units, but **not the scheme**. A matched legacy row keeps its legacy scheme code and gets no AMFI code | None in the rehearsal (1,061 matched, `scheme_differs` 0); the risk is a legacy row filed under a wrong scheme being linked as-is | EC-1 step 2: `scheme_differs` must be 0 on the production copy | Compare the registrar scheme (or its AMFI mapping) before linking; hold a mismatch as `identity_conflict` |
| 5 | When a parked job is removed (EC-2), the stuck-import reaper later marks its row `failed` with the text "the worker restarted mid-parse" | Cosmetic; the file is never posted | Record the removal in the ticket | A distinct remark for a job removed by an operator |


---

## Appendix — rehearsal notes

- All rehearsal steps ran on `rta_handover` and then `rta_final`, isolated databases dropped afterwards.
- Corrections round (`rta_final`): ledger-based CSV export; the §4.1 ledger query; the legacy-then-validate-first rehearsal and the collision drill (EC-1); the operator-identity query (EC-6). The queue inventory and removal commands (EC-2) ran against a local Redis with real BullMQ jobs, and `rta-file-manifest.ts` against the four sample files (EC-3).
- One code change in this round: `lib/rta/posting/gate.ts` now loads its database controls inside the posting check rather than at module load. This lets the read-only `rta-file-manifest.ts` run without a database; posting behaviour is unchanged.
- The rehearsal firm's activation and operators were synthetic.
- **Observation (not a defect in the production path):** calling the import library directly while a firm is paused still writes a staging batch (staging tables only) before the gate refuses posting. The worker, the only production path, checks the regime first and parks the job without reading the file.
- **Operator items found while preparing this package:**
  1. The owner must confirm the DKIM `d=` domains the registrars sign with (D2).
  2. An alert sink (`OBSERVABILITY_WEBHOOK_URL` / `ERROR_WEBHOOK_URL`) must be set, or alerts reach only the audit log (D7).
  3. Pause and activation exist only on the API, so operators need a platform session (§5.1).
