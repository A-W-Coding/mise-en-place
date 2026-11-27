#!/usr/bin/env bash
# scripts/nightly.sh: the nightly backup and off-site copy, then tell
# Healthchecks (D16).
#
# Cron runs it at 03:30 on the Pi (see docs/deployment.md, section 9). It runs
# backup.sh, then offsite.sh only if the backup succeeded, as the cron line did
# before. Then it pings the `backup` check, or its /fail address with which part
# failed: "backup failed" or "offsite failed". Healthchecks alerts the phone on
# a /fail ping, and when no ping has come by 05:30. The two scripts' own output
# goes to the cron log as before, never into the ping.
#
# The ping address comes from ALERTS_ENV, on the Pi only. Without it, the backup
# still runs, Healthchecks isn't told, and it alerts on the silence.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "== $(date -Is) nightly"

status=0
failed=''
scripts/backup.sh || { status=$?; failed=backup; }
if [ -z "$failed" ]; then
    scripts/offsite.sh || { status=$?; failed=offsite; }
fi
if [ -n "$failed" ]; then
    echo "$(date -Is) $failed failed (exit $status)"
fi

# Read only now, so the settings never reach the two scripts above
env_file="${ALERTS_ENV:-$HOME/.config/miseenplace/alerts.env}"
if [ -r "$env_file" ]; then
    # shellcheck source=/dev/null
    . "$env_file"
fi
if [ -z "${BACKUP_PING_URL:-}" ]; then
    echo "No BACKUP_PING_URL in $env_file, so Healthchecks wasn't told (see docs/deployment.md)" >&2
    [ "$status" -ne 0 ] || status=1
    exit "$status"
fi

# One ping, over HTTPS: 10 seconds a try, and 3 more tries
notify() {
    curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$2" "$1"
}

if [ -z "$failed" ]; then
    notify "$BACKUP_PING_URL" ok || { echo "$(date -Is) Healthchecks couldn't be reached"; status=1; }
else
    notify "$BACKUP_PING_URL/fail" "$failed failed" || echo "$(date -Is) Healthchecks couldn't be reached"
fi
exit "$status"
