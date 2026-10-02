#!/bin/sh
set -eu

# ── Restore an encrypted backup — SQL restore only ─────────────
# Usage: ./restore.sh <backup_file.sql.gz.gpg>
#
# This script runs in the backup image (postgres-client + gnupg) and
# performs ONLY the database restore. It is reachable inside the
# ``backup`` service at ``/backups/restore.sh`` via the bind mount.
#
# The whole procedure, from the repo root on the host:
#
#   1. docker compose stop backend huey
#      Nothing may write to the database or serve from it while it is
#      replaced, and nothing may serve the personal data the restore brings
#      back before step 3 has erased it again.
#   2. docker compose exec backup /backups/restore.sh /backups/<file>.sql.gz.gpg
#      Refreshes the GDPR deletion ledger from the live database first, then
#      restores.
#   3. Re-apply the erasures made after the backup — printed at the end.
#   4. docker compose up -d backend huey
#
# GDPR: the restore rolls every tenant's ``gdpr_deletionlog`` back with the
# data, so the replay reads the copy kept outside the database,
# /backups/gdpr-deletion-ledger.jsonl (``backup.sh ledger``). It runs in a
# Python/Django container, because this image has none. After losing the host,
# fetch the off-host copy first and decrypt it into place:
#   rclone copyto <remote>/gdpr-deletion-ledger.jsonl.gpg /backups/gdpr-deletion-ledger.jsonl.gpg
#   gpg --batch --decrypt --passphrase "$BACKUP_ENCRYPTION_KEY" \
#       --output /backups/gdpr-deletion-ledger.jsonl /backups/gdpr-deletion-ledger.jsonl.gpg
# ───────────────────────────────────────────────────────────────

BACKUP_FILE="${1:?Usage: restore.sh <backup_file.sql.gz.gpg>}"

DB_HOST="${POSTGRES_HOST:-postgres}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB}"
DB_USER="${POSTGRES_USER}"

export PGPASSWORD="${POSTGRES_PASSWORD}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY must be set}"

LEDGER_FILE="/backups/gdpr-deletion-ledger.jsonl"

# Capture the erasures made since the last ledger run while the live database
# still has them. A database too broken to read leaves the ledger as it was.
echo "[$(date)] Refreshing the GDPR deletion ledger from the live database..."
/usr/local/bin/backup.sh ledger \
    || echo "[$(date)] WARN: could not refresh the ledger; using the last copy" >&2

if [ ! -f "$LEDGER_FILE" ] && [ "${ALLOW_MISSING_GDPR_LEDGER:-0}" != "1" ]; then
    echo "[$(date)] ERROR: ${LEDGER_FILE} is missing. Without it, erasures made after" >&2
    echo "  this backup can't be re-applied. Restore it from the off-host copy (see the" >&2
    echo "  header of this script), or set ALLOW_MISSING_GDPR_LEDGER=1 if this" >&2
    echo "  deployment has never erased anyone." >&2
    exit 1
fi
if [ -f "$LEDGER_FILE" ]; then
    echo "[$(date)] GDPR deletion ledger: $(wc -l < "$LEDGER_FILE") entries"
fi

echo "[$(date)] Decrypting and restoring ${BACKUP_FILE}..."

# ash has no ``pipefail``: piping gpg | gunzip | psql would let a failed
# decrypt feed EMPTY input to psql, which then exits 0 and we'd print
# "Database restored." over a no-op. Stage each step as its own command so
# ``set -e`` catches a failure at the point it happens, and make psql abort on
# the first SQL error (``ON_ERROR_STOP=1``) instead of committing a partial
# restore. The temp files live in the backup volume and are removed on exit.
TMP_GZ="${BACKUP_FILE}.dec.gz"
TMP_SQL="${BACKUP_FILE}.dec.sql"
cleanup() { rm -f "$TMP_GZ" "$TMP_SQL"; }
trap cleanup EXIT

gpg --batch --yes --quiet --decrypt \
    --passphrase "$BACKUP_ENCRYPTION_KEY" \
    --output "$TMP_GZ" \
    "$BACKUP_FILE"

gunzip -c "$TMP_GZ" > "$TMP_SQL"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --single-transaction \
    -v ON_ERROR_STOP=1 \
    -f "$TMP_SQL"

echo "[$(date)] Database restored."
echo ""
echo "============================================================"
echo " ACTION REQUIRED — re-apply the GDPR erasures, THEN start"
echo "============================================================"
echo " This was a SQL-only restore. Personal data that was lawfully"
echo " erased AFTER this backup was taken has just been"
echo " re-materialised. With backend and huey still stopped, run"
echo " from the repo root (migrates first, then replays the ledger):"
echo ""
echo "     docker compose exec -T backup cat ${LEDGER_FILE} \\"
echo "       | docker compose run --rm --no-deps -T -e SKIP_MIGRATIONS=0 \\"
echo "           huey manage replay_gdpr_deletions --ledger -"
echo ""
echo " Only then start the app again:"
echo ""
echo "     docker compose up -d backend huey"
echo ""
echo " Starting it first serves the re-materialised personal data."
echo "============================================================"
