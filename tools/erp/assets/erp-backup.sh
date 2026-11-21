#!/bin/sh
# ERP database backups — runs in the `backup` container of a `pnpm erp compose` installation (image postgres:16-alpine).
#
#   erp-backup loop             wait for BACKUP_AT every day, back up, restore-test, ping BACKUP_PING_URL (the container's command)
#   erp-backup now              one backup + restore test right away
#   erp-backup list             backups on disk, newest last
#   erp-backup check [STAMP]    restore drill: verify checksums and restore every database of a backup (default: newest) into
#                               scratch databases, check the tables are there, drop the scratch databases. Touches nothing live.
#   erp-backup restore STAMP --yes [DB...]
#                               REAL restore: replaces the live databases (all erp_*, or only the ones named) with the backup.
#                               Stop the ERP services first: docker compose stop  (then: docker compose start)
#
# One backup = one folder BACKUP_DIR/<UTC stamp>/ holding one `pg_dump -Fc` file per erp_* database, globals.sql (roles) and
# SHA256SUMS. Folders older than BACKUP_KEEP_DAYS are deleted after a successful backup. Copying them off the server (Spaces /
# S3) is the `backup-offsite` container's job.
#
# Environment: PGHOST PGUSER PGPASSWORD (the postgres superuser), BACKUP_DIR (/backups), BACKUP_AT (HHMM local time, 0200),
# BACKUP_KEEP_DAYS (14), BACKUP_VERIFY (1 = restore-test every backup), BACKUP_PING_URL (optional heartbeat, e.g. healthchecks.io
# or an UptimeRobot heartbeat monitor: it is called only when backup AND restore test succeeded, so a missing ping = alert).
set -eu
umask 077
# keep the output to our own lines (no "database does not exist, skipping" notices)
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
AT="${BACKUP_AT:-0200}"
VERIFY="${BACKUP_VERIFY:-1}"

log() { echo "[erp-backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
die() { log "ERROR: $*"; exit 1; }

databases() {
  psql -d postgres -Atqc "select datname from pg_database where datname like 'erp\_%' and not datistemplate order by 1"
}

# newest backup folder name (stamps sort as text)
latest() {
  ls -1 "$DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -n 1
}

backup_now() {
  mkdir -p "$DIR"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  work="$DIR/.partial-$stamp"
  mkdir "$work"
  # a half-written backup must never look like a good one
  trap 'rm -r -- "$work" 2>/dev/null || true' EXIT
  dbs="$(databases)"
  [ -n "$dbs" ] || die "no erp_* databases found on $PGHOST"
  pg_dumpall --globals-only > "$work/globals.sql"
  for db in $dbs; do
    pg_dump -Fc -Z 6 -d "$db" -f "$work/$db.dump" || die "pg_dump $db failed"
  done
  (cd "$work" && sha256sum ./*.dump globals.sql > SHA256SUMS)
  mv "$work" "$DIR/$stamp"
  trap - EXIT
  size="$(du -sh "$DIR/$stamp" | cut -f1)"
  log "backup $stamp done: $(echo "$dbs" | wc -l | tr -d ' ') databases, $size"
  if [ "$VERIFY" = "1" ]; then check "$stamp"; fi
  prune
  if [ -n "${BACKUP_PING_URL:-}" ]; then
    wget -q -T 10 -O /dev/null "$BACKUP_PING_URL" || log "warning: heartbeat ping failed"
  fi
}

prune() {
  # only folders named like a stamp, only after a good backup; the newest is never removed
  newest="$(latest)"
  find "$DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP" | while read -r old; do
    name="$(basename "$old")"
    echo "$name" | grep -Eq '^[0-9]{8}T[0-9]{6}Z$' || continue
    [ "$name" = "$newest" ] && continue
    rm -r -- "$old" && log "removed old backup $name"
  done
}

check() {
  stamp="${1:-$(latest)}"
  [ -n "$stamp" ] || die "no backups in $DIR"
  src="$DIR/$stamp"
  [ -d "$src" ] || die "backup $stamp not found"
  (cd "$src" && sha256sum -c SHA256SUMS >/dev/null) || die "checksum mismatch in $stamp — the files are damaged"
  n=0
  for f in "$src"/*.dump; do
    db="$(basename "$f" .dump)"
    scratch="restore_check_${db#erp_}"
    psql -d postgres -qc "drop database if exists $scratch with (force)" >/dev/null
    psql -d postgres -qc "create database $scratch" >/dev/null
    if ! pg_restore --exit-on-error -d "$scratch" "$f" 2>"$DIR/.restore-$db.log"; then
      psql -d postgres -qc "drop database if exists $scratch with (force)" >/dev/null
      die "restore test of $db failed: $(tail -n 3 "$DIR/.restore-$db.log")"
    fi
    rm -f -- "$DIR/.restore-$db.log"
    migrations="$(psql -d "$scratch" -Atqc "select count(*) from _migrations")"
    tables="$(psql -d "$scratch" -Atqc "select count(*) from pg_tables where schemaname = 'public'")"
    psql -d postgres -qc "drop database $scratch with (force)" >/dev/null
    [ "$migrations" -gt 0 ] || die "restore test of $db: no migrations recorded"
    log "restore test $db: $tables tables, $migrations migrations — ok"
    n=$((n + 1))
  done
  [ "$n" -gt 0 ] || die "backup $stamp has no database dumps"
  log "restore drill of $stamp passed ($n databases)"
}

restore() {
  stamp="${1:-}"
  [ -n "$stamp" ] || die "usage: erp-backup restore STAMP --yes [DB...]"
  shift
  [ "${1:-}" = "--yes" ] || die "this REPLACES live data. Stop the ERP services (docker compose stop), then repeat with --yes"
  shift
  src="$DIR/$stamp"
  [ -d "$src" ] || die "backup $stamp not found"
  (cd "$src" && sha256sum -c SHA256SUMS >/dev/null) || die "checksum mismatch in $stamp — not restoring damaged files"
  targets="$*"
  [ -n "$targets" ] || targets="$(cd "$src" && ls -1 ./*.dump | sed 's|^\./||; s|\.dump$||')"
  for db in $targets; do
    [ -f "$src/$db.dump" ] || die "$db is not in backup $stamp"
  done
  for db in $targets; do
    psql -d postgres -qc "drop database if exists $db with (force)" >/dev/null
    psql -d postgres -qc "create database $db owner erp_app" >/dev/null
    pg_restore --exit-on-error -d "$db" "$src/$db.dump" || die "restore of $db failed — the database is incomplete, run the restore again"
    log "restored $db from $stamp"
  done
  log "restore finished. Start the services again: docker compose start"
}

loop() {
  log "daily backup at $AT (TZ=${TZ:-UTC}), keeping $KEEP days in $DIR"
  last=""
  while true; do
    today="$(date +%Y%m%d)"
    if [ "$(date +%H%M)" = "$AT" ] && [ "$last" != "$today" ]; then
      last="$today"
      # own process so `set -e` holds inside it; a failed night is logged, retried tomorrow, and the missing heartbeat raises the alarm
      sh "$0" now || log "backup FAILED — see the lines above"
    fi
    sleep 30
  done
}

cmd="${1:-loop}"
[ $# -gt 0 ] && shift
case "$cmd" in
  loop) loop ;;
  now) backup_now ;;
  list) ls -1 "$DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | while read -r b; do echo "$b  $(du -sh "$DIR/$b" | cut -f1)"; done ;;
  check) check "${1:-}" ;;
  restore) restore "$@" ;;
  *) die "unknown command $cmd (loop | now | list | check [STAMP] | restore STAMP --yes [DB...])" ;;
esac
