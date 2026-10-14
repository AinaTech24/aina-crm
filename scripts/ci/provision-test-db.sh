#!/usr/bin/env bash
# CI only: a disposable PostgreSQL on the RUNNER (not a service container) and
# Redis, with two distinct roles, for the DB-backed test suites.
#
# Why on the runner: the RTA development posting gate
# (src/lib/rta/posting/gate.ts) posts only to a database server on this
# machine — inet_server_addr() must be loopback. A service container answers
# with its Docker network address, so every posting test was refused there
# (51 failures, 2026-10-14). The gate is not relaxed; the server is moved.
#
# Roles (both created here with random, masked passwords — never a production
# credential, never printed):
#   ci_admin  test administration + migrations (superuser of this throw-away
#             cluster: the runtime-role tests create superuser / BYPASSRLS /
#             owner roles to prove each is refused)
#   mfd_app   the restricted application role (created by provision-app-role)
set -euo pipefail
if [ "${CI:-}" != "true" ] || [ -z "${GITHUB_ENV:-}" ]; then
  echo "provision-test-db: CI only (CI=true and GITHUB_ENV set)" >&2; exit 2
fi
SUDO=""; [ "$(id -u)" = "0" ] || SUDO="sudo"
DB=mfd_ci_test

# PostgreSQL (preinstalled on GitHub's Ubuntu runners, stopped by default).
$SUDO systemctl start postgresql.service 2>/dev/null || $SUDO service postgresql start
for _ in $(seq 1 30); do pg_isready -q -h 127.0.0.1 -p 5432 && break; sleep 1; done
pg_isready -h 127.0.0.1 -p 5432
echo "PostgreSQL: $(sudo -u postgres psql -Atqc 'select version()' | cut -d, -f1)"

# Redis: the queue tests use a running server (TEST_REDIS_URL) and FS-8 starts
# its own redis-server on a free port.
if ! command -v redis-server >/dev/null 2>&1; then
  $SUDO apt-get -qq update >/dev/null
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get -qq install -y --no-install-recommends redis-server >/dev/null
fi
redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1 || redis-server --port 6379 --bind 127.0.0.1 --save "" --appendonly no --daemonize yes
for _ in $(seq 1 20); do [ "$(redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null)" = "PONG" ] && break; sleep 0.5; done
echo "Redis: $(redis-cli -h 127.0.0.1 -p 6379 ping)"

ADMIN_PW="$(openssl rand -hex 24)"; APP_PW="$(openssl rand -hex 24)"
echo "::add-mask::${ADMIN_PW}"; echo "::add-mask::${APP_PW}"

# The bootstrap superuser (peer auth, no password) only creates the test admin
# and the database; nothing else connects as it.
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -X <<SQL
DROP DATABASE IF EXISTS ${DB};
DROP ROLE IF EXISTS ci_admin;
CREATE ROLE ci_admin LOGIN SUPERUSER PASSWORD '${ADMIN_PW}';
CREATE DATABASE ${DB} OWNER ci_admin;
SQL

{
  echo "DATABASE_URL=postgres://ci_admin:${ADMIN_PW}@127.0.0.1:5432/${DB}"
  echo "ADMIN_DATABASE_URL=postgres://ci_admin:${ADMIN_PW}@127.0.0.1:5432/${DB}"
  echo "TEST_DATABASE_URL=postgres://mfd_app:${APP_PW}@127.0.0.1:5432/${DB}"
  echo "APP_DB_PASSWORD=${APP_PW}"
  echo "TEST_REDIS_URL=redis://127.0.0.1:6379"
} >> "$GITHUB_ENV"
echo "provisioned ${DB}: test admin ci_admin, restricted role mfd_app (passwords random and masked)"
