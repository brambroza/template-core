# Operations: backups, uptime and error reporting

Runbook for an installation made with `pnpm erp compose` (GO Along cloud or a customer's own server).
Everything here is already in the generated `docker-compose.yml`; this page says how to switch it on and what to do when it fires.

## 1. Backups

**What runs:** container `backup` (`postgres:16-alpine` + [`erp-backup.sh`](../tools/erp/assets/erp-backup.sh)).
Every night at `BACKUP_AT` (Thai time, default 02:00):

1. `pg_dump -Fc` of every `erp_*` database + `globals.sql` (roles) into `./backups/<UTC stamp>/`, with `SHA256SUMS`.
2. **Restore drill:** checks the checksums, restores each dump into a scratch database `restore_check_*`, counts tables and
   `_migrations` rows, drops the scratch database. A backup that cannot be restored fails here, not on the day it is needed.
3. Deletes backup folders older than `BACKUP_KEEP_DAYS` (default 14). The newest one is never deleted.
4. Calls `BACKUP_PING_URL`, but only if steps 1 and 2 succeeded.

Container `backup-offsite` (rclone) copies `./backups` to a **private** DigitalOcean Spaces bucket every hour when
`BACKUP_S3_BUCKET` is set. It only copies and never deletes anything in the bucket. Set a lifecycle rule on the bucket, for example
expire after 90 days, and turn on Spaces encryption at rest. The backups contain all customer data, so the Spaces key
should only have access to this bucket.

**Switching it on**

```
BACKUP_PING_URL=https://hc-ping.com/<uuid>        # healthchecks.io (free) or an UptimeRobot heartbeat monitor
BACKUP_S3_BUCKET=goalong-erp-backups
BACKUP_S3_PREFIX=<customer or server name>
BACKUP_S3_KEY=…            BACKUP_S3_SECRET=…    # a Spaces key limited to that bucket
```

Make the heartbeat monitor expect one ping every 24 hours, with a grace period of 2 hours. A missing ping means the backup or
the restore drill failed. Read why with `docker compose logs backup`.

**Commands**

```
docker compose exec backup erp-backup now          # back up + restore drill now (before an upgrade, a migration, …)
docker compose exec backup erp-backup list
docker compose exec backup erp-backup check [STAMP]  # restore drill only; touches nothing live
```

**Restoring for real.** This replaces live data. Agree on the backup stamp with the customer in writing (LINE/e-mail) first: every
change made after that stamp is lost.

```
docker compose stop <every module> gateway web     # the exact line is in the installation README
docker compose exec backup erp-backup restore <STAMP> --yes                # every database
docker compose exec backup erp-backup restore <STAMP> --yes erp_sales      # or only some
docker compose start
```

Restoring a single database rolls back only that module. Other modules may then refer to documents it no longer has. Restore
all databases unless you know the change was local to one module.

**New server (the old one is gone):** generate the compose files, use the same `.env` (the same `POSTGRES_PASSWORD` is not
required, but `APP_DB_PASSWORD`, `JWT_SECRET` and `INTERNAL_TOKEN` must match or every user has to sign in again). Copy the newest
folder from Spaces into `./backups/`, then run `docker compose up -d postgres backup`, then `erp-backup restore <STAMP> --yes`, then
`docker compose up -d`.

**Drill record (2026-11-21, on Docker):** `erp-backup now` on a 3-module installation seeded with demo data took about 1 s and
produced 128 KB. The restore drill passed (identity 19 tables / 6 migrations, maintenance 13 / 2, master-data 10 / 1). Next, every
user row was deleted and `restore --yes erp_identity` brought back all 12 users, the 15 row-level-security policies, and table owner
`erp_app`. A damaged dump file was refused by both `check` and `restore` (checksum mismatch). `restore` without `--yes` is refused.

## 2. Uptime (UptimeRobot)

`GET https://<host>/api/_health` (web app, then gateway, then every module's `/_health`, which runs `select 1` on its database):

- `200 {"status":"ok","modules":{"identity":"ok",…}}`: everything answers.
- `503 {"status":"down","modules":{…,"sales":"down"}}`: names the module whose service or database is not answering.
- `502`: the gateway itself is down (answered by the web app).

UptimeRobot setup:

- Monitor type **Keyword**, keyword `"status":"ok"`, interval 5 minutes, one monitor per installation.
- Alert contacts: the on-call LINE group (through UptimeRobot's webhook or e-mail-to-LINE) and the technical lead's e-mail.

The endpoint is public. It shows module ids only: no addresses, versions or error text.

A P1 incident starts when the monitor goes down. Respond within 1 hour, 24/7 (see the SLA). Start with `docker compose ps` and
`docker compose logs --tail 100 <module>`.

## 3. Error reporting (Sentry)

Set `SENTRY_DSN` (one Sentry project per environment, or tell them apart with `SENTRY_ENVIRONMENT=production|staging`). Then run
`docker compose up -d`. Every module and the gateway report:

- every **500** (bug) answer. Expected answers are not reported: 4xx, 502 "module down" and 503 "database busy" (those are outages,
  and UptimeRobot sees them);
- failed outbox dispatches, unhandled promise rejections, and crashes (the error is reported before the process exits and the
  container restarts it).

**What is sent (PDPA):** the error type, message and stack; the module and version; the HTTP method and route *pattern*
(`/orders/:id`, without the query string); and the company and user **ids**. Request bodies, headers, tokens, e-mail addresses and
names are never sent. There is no SDK: [`packages/kernel/src/sentry.ts`](../packages/kernel/src/sentry.ts) posts one envelope per
error, at most 30 per minute per process. If Sentry cannot be reached, the error is logged once and the request is not affected.
GlitchTip, a self-hosted service compatible with Sentry, takes the same DSN format.

Not covered yet: errors in the browser (web app) and in the mobile app.
