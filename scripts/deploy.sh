#!/usr/bin/env bash
# scripts/deploy.sh: update the Pi to the latest main and restart the API.
#
# Run it on the Pi, from anywhere. It backs up first, builds while the current
# version keeps serving, migrates with the new image before starting it, and
# fails unless the health check passes (T3).
set -euo pipefail

# Everything is inside main(), which bash reads in full before running any of
# it. Otherwise `git pull` could rewrite this file while bash is still reading
# it, and bash would run a mix of the old and new versions.
main() {
    cd "$(dirname "$0")/.."
    compose() { docker compose -f docker-compose.prod.yml "$@"; }

    # 1. Start the database if it isn't running, then back it up
    compose up -d --wait db
    scripts/backup.sh pre-deploy

    # 2. Update the code. --ff-only stops with an error instead of merging if
    #    the histories have diverged
    git pull --ff-only origin main

    # 3. Download the newest postgres:17, then build while the current version
    #    keeps serving (builds on ARM are slow). Without these, the Pi would
    #    keep the images it first downloaded, and never get their security
    #    fixes. The 17 tag only moves through 17.x releases, which keep the
    #    same data format; `up -d` below restarts the database only if its
    #    image changed. --pull does the same for the build's node:22-slim
    compose pull db
    compose build --pull api

    # 4. Run migrations with the new image before the new API starts.
    #    --no makes npx fail rather than download a different Prisma (D3)
    compose run --rm --no-deps api npx --no prisma migrate deploy

    # 5. Start the new version
    compose up -d

    # 6. Retry the health check; if it never passes, fail the deploy
    for _ in $(seq 1 30); do
        if curl -fsS http://127.0.0.1:3000/api/health > /dev/null; then
            echo "Deploy OK"
            return 0
        fi
        sleep 2
    done
    echo "Health check failed" >&2
    compose logs --tail=100 api >&2
    return 1
}

main "$@"
