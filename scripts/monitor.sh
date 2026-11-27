#!/usr/bin/env bash
# scripts/monitor.sh: check the API and the disk, then tell Healthchecks (D16).
#
# Cron runs it every 5 minutes on the Pi (see docs/deployment.md, section 9).
# It asks the API's health check twice: on 127.0.0.1:3000, which checks the
# API and its database, then on the ts.net address, which checks `tailscale
# serve` too. It reads how full the disks holding Docker's data and the
# backups are. Then it pings the `health` check with "ok, disk 41%", or its
# /fail address with only what failed, such as "api: 503" or "disk 91%, limit
# 85%". Healthchecks alerts the phone on a /fail ping, and when no ping has
# come for 10 minutes, so the Pi going silent is noticed as well.
#
# The settings come from ALERTS_ENV, on the Pi only (never from git). It prints
# nothing when all is well, so its cron log holds only the failures.
set -euo pipefail

# During maintenance: while this file exists, it checks and pings nothing. Pause
# the check in Healthchecks as well, or the silence raises an alert. Pausing
# there alone isn't enough: any ping, a /fail one included, resumes the check
pause_file="${PAUSE_FILE:-$HOME/.config/miseenplace/monitor.paused}"
if [ -e "$pause_file" ]; then
    exit 0
fi

env_file="${ALERTS_ENV:-$HOME/.config/miseenplace/alerts.env}"
[ -r "$env_file" ] || { echo "No alert settings at $env_file (see docs/deployment.md)" >&2; exit 1; }
# shellcheck source=/dev/null
. "$env_file"
: "${HEALTH_PING_URL:?must be set in $env_file}"
: "${TAILNET_URL:?must be set in $env_file}"
disk_limit="${DISK_LIMIT:-85}"
local_url="${LOCAL_URL:-http://127.0.0.1:3000}"
disks=("${DOCKER_DIR:-/var/lib/docker}" "${BACKUP_DIR:-/srv/miseenplace/backups}")

# One ping to Healthchecks, over HTTPS: 10 seconds a try, and 3 more tries. If
# the internet is down, the ping just fails, and Healthchecks alerts on the
# silence instead
notify() {
    curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$2" "$1"
}

# Prints "<name>: <what came back>", unless the health check answers 200
check() {
    local code
    code="$(curl -sS -o /dev/null -m 10 -w '%{http_code}' "$2/api/health" 2> /dev/null)" || true
    case "$code" in
        200) ;;
        '' | 000) echo "$1: no answer" ;;
        *) echo "$1: $code" ;;
    esac
}

api_problems() {
    check api "$local_url"
    check tailnet "$TAILNET_URL"
}

# A deploy restarts the API, and the database when its image has changed, so
# a failed check gets 30 seconds to recover before it counts
mapfile -t problems < <(api_problems)
deadline=$((SECONDS + 30))
while [ "${#problems[@]}" -gt 0 ] && [ "$SECONDS" -lt "$deadline" ]; do
    sleep 5
    mapfile -t problems < <(api_problems)
done

# The fullest of the disks holding Docker's data (the database and the images)
# and the backups. On the Pi they're usually one and the same
use=0
unreadable=''
for dir in "${disks[@]}"; do
    pct="$(df --output=pcent "$dir" 2> /dev/null | tail -n 1 | tr -dc '0-9')" || pct=''
    if [ -z "$pct" ]; then
        unreadable=yes
    elif [ "$pct" -gt "$use" ]; then
        use="$pct"
    fi
done
if [ -n "$unreadable" ]; then
    problems+=("disk: can't read")
fi
if [ "$use" -ge "$disk_limit" ]; then
    problems+=("disk ${use}%, limit ${disk_limit}%")
fi

if [ "${#problems[@]}" -eq 0 ]; then
    if ! notify "$HEALTH_PING_URL" "ok, disk ${use}%"; then
        echo "$(date -Is) all well, but Healthchecks couldn't be reached"
        exit 1
    fi
    exit 0
fi

message="$(printf '%s; ' "${problems[@]}")"
message="${message%; }"
echo "$(date -Is) $message"
notify "$HEALTH_PING_URL/fail" "$message" || echo "$(date -Is) Healthchecks couldn't be reached"
exit 1
