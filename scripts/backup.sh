#!/usr/bin/env bash
# scripts/backup.sh: dump the production database into BACKUP_DIR, with the
# recipe images beside it, on the Pi.
#
#   scripts/backup.sh [label]    label defaults to "daily"; deploy.sh uses "pre-deploy"
#
# Each backup is a pair with the same name: <label>-<stamp>.dump, the database,
# and <label>-<stamp>.media.tar, the image files (3b). Cron runs it once a day
# (see docs/deployment.md). Backups older than KEEP_DAYS (default 7) are
# removed, but only after a new one has been checked.
set -euo pipefail
cd "$(dirname "$0")/.."

label="${1:-daily}"
backup_dir="${BACKUP_DIR:-/srv/miseenplace/backups}"
keep_days="${KEEP_DAYS:-7}"
compose() { docker compose -f docker-compose.prod.yml "$@"; }

mkdir -p "$backup_dir"
stamp="$(date +%Y%m%d-%H%M%S)"
file="$backup_dir/$label-$stamp.dump"
media="$backup_dir/$label-$stamp.media.tar"

# Write to .partial files first, so a failed backup never looks like one
partial="$file.partial"
media_partial="$media.partial"
trap 'rm -f "$partial" "$media_partial"' EXIT

# The single quotes make the variables expand inside the container, where
# they're set, rather than in this shell, where they aren't (T3)
compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$partial"
[ -s "$partial" ] || { echo "Backup is empty; the older dumps are kept" >&2; exit 1; }

# Read the whole dump back without restoring it, so a truncated one fails here
compose exec -T db pg_restore -f /dev/null < "$partial"

mv "$partial" "$file"
echo "Backed up to $file"

# The images: a tar of the media volume, made by a throwaway container of the
# API's own image, so it works whether or not the API is running. It reads the
# volume and changes nothing
compose run --rm --no-deps -T --entrypoint tar api -C /app/media -cf - . > "$media_partial"
# Read the whole archive back, so a truncated one fails here
tar -tf "$media_partial" > /dev/null
mv "$media_partial" "$media"
echo "Images backed up to $media ($(tar -tf "$media" | grep -c '\.webp$' || true) files)"

find "$backup_dir" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.media.tar' \) -mmin "+$((keep_days * 24 * 60))" -print -delete
