#!/usr/bin/env bash
# Starts a throwaway Postgres for local dev/tests (Docker). Tests expect:
#   TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres  (default)
set -euo pipefail
docker run -d --name erp-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16 >/dev/null 2>&1 || docker start erp-pg >/dev/null
echo "waiting for postgres..."; until docker exec erp-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
docker exec erp-pg psql -U postgres -c "do \$\$ begin if not exists (select from pg_roles where rolname='erp_app') then create role erp_app login password 'erp_app' createdb; end if; end \$\$;"
echo "ready"
