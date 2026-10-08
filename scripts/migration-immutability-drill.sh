#!/usr/bin/env bash
# Phase 3H — migration immutability drill on DISPOSABLE local databases.
#
#   ADMIN_URL=postgres://postgres:…@localhost:5432 bash scripts/migration-immutability-drill.sh
#
# Creates mig_drill_empty and mig_drill_old, runs the real runner against them,
# and prints PASS / FAIL per step; exit code = failures. Refuses a non-local URL.
set -u
ADMIN_URL="${ADMIN_URL:?set ADMIN_URL to a local superuser URL without a database name}"
case "$ADMIN_URL" in *@localhost*|*@127.0.0.1*) ;; *) echo "refusing: ADMIN_URL must be local"; exit 2;; esac
LAST_OLD="${LAST_OLD:-0232_physical_rta_route.sql}"
FAIL=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAIL=$((FAIL+1)); }
q() { psql "$ADMIN_URL/$1" -Atqc "$2"; }
migrate() { local db=$1; shift; DATABASE_URL="$ADMIN_URL/$db" ADMIN_DATABASE_URL="$ADMIN_URL/$db" npx tsx scripts/migrate-all.ts "$@" > "/tmp/mig_drill_$db.log" 2>&1; echo $?; }

for db in mig_drill_empty mig_drill_old; do
  psql "$ADMIN_URL/postgres" -qc "DROP DATABASE IF EXISTS $db WITH (FORCE)" -c "CREATE DATABASE $db"
done

# 1. Empty database: the whole chain, then a no-op re-run and a clean --check.
rc=$(migrate mig_drill_empty); [ "$rc" = 0 ] && pass "empty database: full chain applied" || fail "empty database: exit $rc ($(tail -3 /tmp/mig_drill_mig_drill_empty.log))"
rc=$(migrate mig_drill_empty); grep -q "up to date" /tmp/mig_drill_mig_drill_empty.log && [ "$rc" = 0 ] && pass "empty database: re-run applies nothing" || fail "re-run exit $rc"
rc=$(migrate mig_drill_empty --check); [ "$rc" = 0 ] && pass "empty database: --check reports 0 blockers" || fail "--check exit $rc"
[ "$(q mig_drill_empty "select posting_halted from rta_posting_controls where scope='global'")" = t ] && pass "empty database: kill switch installed halted" || fail "kill switch not halted"

# 2. An OLDER database (chain up to $LAST_OLD) holding data.
rc=$(migrate mig_drill_old --until "$LAST_OLD"); [ "$rc" = 0 ] && pass "older database built up to $LAST_OLD" || fail "older build exit $rc"
T=$(q mig_drill_old "select gen_random_uuid()")
q mig_drill_old "set app.is_platform_admin='true'; insert into tenants (id, legal_name, display_name, arn) values ('$T','Drill','Drill','ARN-DRILL');
  insert into investors (tenant_id, pan, name) values ('$T','ZZZPA1111A','Drill Person');
  insert into transactions (tenant_id, investor_id, folio_number, amc_code, scheme_code, type, direction, amount, units, order_id, order_date, status)
    select '$T', id, '1', '117', '117EQGR', 'sip', 'inflow', 1000, 20, 'DRILL1', '2026-04-15', 'processed' from investors where tenant_id='$T';" >/dev/null
before=$(q mig_drill_old "select md5(string_agg(concat_ws(',', t.id, t.tenant_id, t.investor_id, t.order_id, t.amount, t.units, t.order_date, t.status, t.scheme_code), '|')) from transactions t")
[ -n "$before" ] && [ "$(q mig_drill_old "select count(*) from transactions")" = 1 ] && pass "older database holds a client and a transaction" || fail "seed data missing"

# 3. Drift on an applied file BLOCKS and applies nothing.
good=$(q mig_drill_old "select checksum from _applied_migrations where filename='$LAST_OLD'")
q mig_drill_old "update _applied_migrations set checksum='0000000000000000' where filename='$LAST_OLD'"
rc=$(migrate mig_drill_old)
[ "$rc" = 2 ] && grep -q "BLOCKED" /tmp/mig_drill_mig_drill_old.log && [ -z "$(q mig_drill_old "select to_regclass('rta_staging_batches')")" ] \
  && pass "changed applied migration: BLOCKED (exit 2), nothing applied" || fail "drift: exit $rc"
q mig_drill_old "update _applied_migrations set checksum='$good' where filename='$LAST_OLD'"

# 4. An applied file that no longer exists BLOCKS.
q mig_drill_old "insert into _applied_migrations (filename, checksum) values ('0099_renamed_away.sql','abc')"
rc=$(migrate mig_drill_old); [ "$rc" = 2 ] && grep -q "renamed or removed" /tmp/mig_drill_mig_drill_old.log && pass "applied migration missing on disk: BLOCKED" || fail "missing file: exit $rc"
q mig_drill_old "delete from _applied_migrations where filename='0099_renamed_away.sql'"

# 5. A partly-applied no-transaction attempt BLOCKS until --resume.
NEXT=$(ls drizzle/migrations | grep -E '^[0-9].*\.sql$' | sort | awk -v l="$LAST_OLD" '$0 > l' | head -1)
q mig_drill_old "insert into _migration_runs (filename, checksum, no_transaction, status) values ('$NEXT','x',true,'started')"
rc=$(migrate mig_drill_old); [ "$rc" = 2 ] && grep -q -- "--resume $NEXT" /tmp/mig_drill_mig_drill_old.log && pass "partial no-transaction attempt detected: BLOCKED" || fail "partial: exit $rc"
rc=$(migrate mig_drill_old --resume "$NEXT"); [ "$rc" = 0 ] && pass "after inspection, --resume applies the rest of the chain" || fail "resume exit $rc ($(tail -3 /tmp/mig_drill_mig_drill_old.log))"

# 6. The older database's data survived; the new objects exist; RLS and schema guards pass.
[ "$(q mig_drill_old "select md5(string_agg(concat_ws(',', t.id, t.tenant_id, t.investor_id, t.order_id, t.amount, t.units, t.order_date, t.status, t.scheme_code), '|')) from transactions t")" = "$before" ] && pass "older database: existing transaction values unchanged by 0233+ (new columns are added empty)" || fail "transactions changed"
[ "$(q mig_drill_old "select count(*) from _migration_runs where status='done'")" -ge 4 ] && pass "every attempt is logged in _migration_runs" || fail "run log"
DATABASE_URL="$ADMIN_URL/mig_drill_old" npm run -s check:rls >/dev/null 2>&1 && pass "older database: check:rls" || fail "check:rls"
DATABASE_URL="$ADMIN_URL/mig_drill_old" npm run -s check:schema >/dev/null 2>&1 && pass "older database: check:schema" || fail "check:schema"

for db in mig_drill_empty mig_drill_old; do psql "$ADMIN_URL/postgres" -qc "DROP DATABASE IF EXISTS $db WITH (FORCE)"; done
echo "failures: $FAIL"; exit $FAIL
