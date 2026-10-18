#!/usr/bin/env bash
# B-3009: Postgres 17 for CI from the PostgreSQL project's own apt repository,
# on the runner itself. The service container this replaces was pulled from a
# registry (Docker Hub, then the ECR public mirror — B-2965), and both started
# refusing anonymous pulls ("toomanyrequests: Data limit exceeded"), which
# failed every job at "Initialize containers" before a line of code ran.
#
# Same server major, credentials and database as the container had, and as the
# recipe test/support/dialects.ts prints for a laptop.
set -euo pipefail

sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends postgresql-common
# The runner may already have the PGDG repository; adding it may fail then.
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y || true

# The image ships its own PostgreSQL (16), whose cluster owns port 5432 in its
# config even while stopped. Drop it so 17 is created on 5432.
for version in $(ls /etc/postgresql 2>/dev/null); do
  [ "$version" = 17 ] || sudo pg_dropcluster --stop "$version" main || true
done

sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends postgresql-17 postgresql-client-17
sudo pg_ctlcluster 17 main start 2>/dev/null || true
sudo pg_lsclusters
sudo pg_lsclusters --no-header | grep -qE '^17 +main +5432 +online' \
  || { echo "Postgres 17 is not online on 5432"; exit 1; }

sudo -u postgres psql -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE fernscout LOGIN SUPERUSER PASSWORD 'fernscout'" \
  -c "CREATE DATABASE fernscout_test OWNER fernscout"

# pg_dump and pg_restore 17 first on PATH (the backup drill reads them).
echo "/usr/lib/postgresql/17/bin" >> "$GITHUB_PATH"
pg_isready -h localhost -p 5432
