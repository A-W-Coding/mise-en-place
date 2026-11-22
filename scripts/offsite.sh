#!/usr/bin/env bash
# scripts/offsite.sh: keep an encrypted copy of BACKUP_DIR in Backblaze B2, on the Pi.
#
#   scripts/offsite.sh                 back up the folder, then apply the retention rule
#   scripts/offsite.sh <restic args>   any other restic command: init, snapshots, restore...
#
# Cron runs it straight after backup.sh (see docs/deployment.md). restic encrypts
# everything on the Pi, so B2 only ever holds encrypted data. The repository, the
# B2 key and the restic password come from RESTIC_ENV, on the Pi only (never from
# git). Keep a copy of that file off the Pi too: without the password, nobody can
# decrypt the copy.
set -euo pipefail

backup_dir="${BACKUP_DIR:-/srv/miseenplace/backups}"
env_file="${RESTIC_ENV:-$HOME/.config/miseenplace/restic.env}"
# A fixed host name keeps one snapshot history across reinstalls, such as the SSD move
host=miseenplace

[ -r "$env_file" ] || { echo "No restic settings at $env_file (see docs/deployment.md)" >&2; exit 1; }
set -a
# shellcheck source=/dev/null
. "$env_file"
set +a

if [ $# -gt 0 ]; then
    exec restic "$@"
fi

restic backup --host "$host" --exclude '*.partial' "$backup_dir"
restic forget --host "$host" --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

# On Sundays, also download a random tenth of the stored data and check it
if [ "$(date +%u)" = 7 ]; then
    restic check --read-data-subset=10%
fi
