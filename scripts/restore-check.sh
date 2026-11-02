#!/usr/bin/env bash
# scripts/restore-check.sh: prove that a backup can be restored, on the Pi.
#
#   scripts/restore-check.sh [dump]    defaults to the newest dump in BACKUP_DIR
#
# Restores the dump into a scratch database, compares its row counts with the
# live database, then drops the scratch database. The live database is only read.
set -euo pipefail
cd "$(dirname "$0")/.."

backup_dir="${BACKUP_DIR:-/srv/miseenplace/backups}"
scratch=miseenplace_restore_check
compose() { docker compose -f docker-compose.prod.yml "$@"; }

# Runs SQL in the container as POSTGRES_USER: in_db <database> <sql>
in_db() {
    compose exec -T -e PGOPTIONS='-c client_min_messages=warning' db \
        sh -c 'psql -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 -qAt -c "$2"' sh "$@"
}

dump="${1:-$(ls -t "$backup_dir"/*.dump 2> /dev/null | sed -n 1p)}"
[ -s "$dump" ] || { echo "No dump found in $backup_dir" >&2; exit 1; }

live=$(compose exec -T db sh -c 'printf %s "$POSTGRES_DB"')
[ "$live" != "$scratch" ] || { echo "The live database is called $scratch; refusing" >&2; exit 1; }

drop_scratch() { in_db postgres "DROP DATABASE IF EXISTS $scratch" > /dev/null; }
drop_scratch
in_db postgres "CREATE DATABASE $scratch" > /dev/null
trap drop_scratch EXIT

echo "Restoring $dump into $scratch"
compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --exit-on-error' sh "$scratch" < "$dump"

counts='SELECT format($$%-20s %s$$, t, n) FROM (
    SELECT $$Recipe$$ AS t, count(*) AS n FROM "Recipe"
    UNION ALL SELECT $$Ingredient$$, count(*) FROM "Ingredient"
    UNION ALL SELECT $$RecipeIngredient$$, count(*) FROM "RecipeIngredient"
    UNION ALL SELECT $$_prisma_migrations$$, count(*) FROM "_prisma_migrations"
) c'
restored=$(in_db "$scratch" "$counts")
current=$(in_db "$live" "$counts")

echo "Rows in the restored copy:"
echo "$restored"
if [ "$restored" = "$current" ]; then
    echo "Restore check passed: the row counts match the live database"
else
    echo "Restore check failed. Rows in the live database:" >&2
    echo "$current" >&2
    echo "If the data changed after this dump, run scripts/backup.sh and check the new dump." >&2
    exit 1
fi
