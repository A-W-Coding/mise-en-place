#!/usr/bin/env bash
# scripts/backup.sh: dump the production database into BACKUP_DIR, on the Pi.
#
#   scripts/backup.sh [label]    label defaults to "daily"; deploy.sh uses "pre-deploy"
#
# Cron runs it once a day (see docs/deployment.md). Dumps older than KEEP_DAYS
# (default 7) are removed, but only after a new dump has been checked.
set -euo pipefail
cd "$(dirname "$0")/.."

label="${1:-daily}"
backup_dir="${BACKUP_DIR:-/srv/miseenplace/backups}"
keep_days="${KEEP_DAYS:-7}"
compose() { docker compose -f docker-compose.prod.yml "$@"; }

mkdir -p "$backup_dir"
file="$backup_dir/$label-$(date +%Y%m%d-%H%M%S).dump"

# Write to a .partial file first, so a failed dump never looks like a backup
partial="$file.partial"
trap 'rm -f "$partial"' EXIT

# The single quotes make the variables expand inside the container, where
# they're set, rather than in this shell, where they aren't (T3)
compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$partial"
[ -s "$partial" ] || { echo "Backup is empty; the older dumps are kept" >&2; exit 1; }

# Read the whole dump back without restoring it, so a truncated one fails here
compose exec -T db pg_restore -f /dev/null < "$partial"

mv "$partial" "$file"
echo "Backed up to $file"

find "$backup_dir" -maxdepth 1 -type f -name '*.dump' -mmin "+$((keep_days * 24 * 60))" -print -delete
