# Deploying to the Raspberry Pi

How the app runs on the Pi from Phase 2: in Docker, listening on `127.0.0.1:3000` only, published to your own devices by `tailscale serve` over HTTPS. The API serves the web client as well, so the app and its data share that one address. The database has no published port. [`architecture.md`](architecture.md) has the diagram.

Sections 1–7 are a one-time setup, section 8 installs the app on your phone, and section 9 sets up alerts. After that, deploying is one command (see [Day to day](#day-to-day)).

| File | What it does |
|---|---|
| `docker-compose.prod.yml` | The API and PostgreSQL 17, with restart policies and healthchecks. Project name `miseenplace-prod` |
| `Dockerfile` | The app's image: built on the Pi, in three stages (the API, the web client, then the image itself, which keeps only the client's built files). Runs as the non-root `node` user, and includes the Prisma CLI for migrations |
| `scripts/deploy.sh` | Backs up, pulls `main`, downloads the newest `postgres:17` and `node:22-slim` images, builds, migrates, restarts, and waits for the health check |
| `scripts/backup.sh` | Dumps the database into the backups folder, checks the dump, and removes dumps older than 7 days |
| `scripts/restore-check.sh` | Restores a dump into a scratch database and compares row counts with the live one |
| `scripts/offsite.sh` | Keeps an encrypted copy of the backups folder in Backblaze B2, with restic |
| `scripts/nightly.sh` | Runs the backup, then the off-site copy, every night, and tells Healthchecks how they went |
| `scripts/monitor.sh` | Every 5 minutes: checks the API, locally and over the `ts.net` address, and the disk, and tells Healthchecks |

## What you need

- A Raspberry Pi with 64-bit support (Pi 4 or 5), and an SSD to boot from. PostgreSQL on an SD card is the likeliest way to lose data. You can start on the SD card and move later: see [Moving to an SSD](#moving-to-an-ssd).
- A Tailscale account, and the Tailscale app on your phone, signed in to the same account.

## 1. Operating system

Starting on the SD card: do the same with the SD card in place of the SSD, skip step 2, and expect `/dev/mmcblk0p2` in step 3.

1. In Raspberry Pi Imager, choose **Raspberry Pi OS Lite (64-bit)** and write it to the SSD. In the OS customisation screen, set a hostname, a username and password, your Wi-Fi if needed, and turn on SSH (a public key is better than a password).
2. Boot the Pi from the SSD with no SD card inserted. Recent bootloaders try USB and NVMe on their own. If yours doesn't, follow the Raspberry Pi documentation on boot order.
3. SSH in, then check:
   ```bash
   uname -m                      # aarch64 (64-bit)
   findmnt -n -o SOURCE /        # /dev/sda2 or /dev/nvme0n1p2, not /dev/mmcblk0p2 (an SD card)
   ```
4. Update, and turn on automatic security updates:
   ```bash
   sudo apt update && sudo apt full-upgrade -y
   sudo apt install -y unattended-upgrades
   sudo dpkg-reconfigure -plow unattended-upgrades    # answer Yes
   ```

## 2. Docker

Install Docker Engine with the Compose plugin by following Docker's instructions for Debian (64-bit Raspberry Pi OS is based on Debian): <https://docs.docker.com/engine/install/debian/>. Then let your user run it without `sudo`, and check it:

```bash
sudo usermod -aG docker "$USER"     # then log out and back in
docker run --rm hello-world
docker compose version
systemctl is-enabled docker         # enabled, so containers come back after a reboot
```

## 3. Tailscale

1. Install Tailscale from <https://tailscale.com/download/linux> and run `sudo tailscale up`. Open the link it prints and sign in.
2. Give the Pi a bland machine name, such as `kitchen-pi`. The name becomes `<name>.<tailnet>.ts.net`, and that appears in public certificate-transparency logs once HTTPS is on.
   ```bash
   sudo tailscale set --hostname=<name>
   ```
3. In the Tailscale admin console:
   - **Machines:** open the Pi's menu and choose **Disable key expiry**. Otherwise the key expires after 180 days and the Pi drops off your tailnet.
   - **DNS:** make sure **MagicDNS** is on, and enable **HTTPS Certificates**.

`tailscale serve` comes after the first deploy, in step 5.

## 4. The code and its settings

```bash
git clone https://github.com/A-W-Coding/mise-en-place.git ~/mise-en-place
cd ~/mise-en-place
```

Then write `.env`, which is never committed. This generates the password inside the file, so it never appears on screen and there's nothing to copy wrong:

```bash
cat > .env <<EOF
POSTGRES_USER=miseenplace
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=miseenplace
# docker compose in this folder uses the production file
COMPOSE_FILE=docker-compose.prod.yml
EOF
chmod 600 .env
docker compose config -q            # prints nothing if .env is right
```

- If `config -q` warns that variables aren't set, Compose didn't find `.env` and fell back to the development file. Check that you're in `~/mise-en-place`.
- The password is hex because it goes into the database URL, where characters such as `@`, `/` or `:` would break it.
- `POSTGRES_DB` has no `_dev` or `_test` suffix, so the seed and the test reset refuse to touch it. The image also sets `NODE_ENV=production`, which they refuse as well.
- `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` only take effect when the database volume is first created. Changing them later doesn't change the database.
- Leave `CORS_ORIGINS` unset. The Phase 3 UI will be served from the same `ts.net` address, so it won't need CORS.

## 5. First deploy

```bash
sudo mkdir -p /srv/miseenplace/backups
sudo chown "$USER": /srv/miseenplace/backups

~/mise-en-place/scripts/deploy.sh   # the first build takes several minutes on a Pi
sudo tailscale serve --bg 3000      # https://<name>.<tailnet>.ts.net → 127.0.0.1:3000, kept across reboots
tailscale serve status
```

The database starts empty: add recipes through the API. The sample data is for development only.

## 6. Daily backups

Run `crontab -e` and add a line to back up at 03:30 every day:

```
30 3 * * * $HOME/mise-en-place/scripts/backup.sh >> $HOME/miseenplace-backup.log 2>&1
```

Each backup is a pair with the same name: `<label>-<stamp>.dump`, the database, and from 3b `<label>-<stamp>.media.tar`, the recipe images, made from the `media` volume at the same moment.

Then test a restore. This restores the newest dump into a scratch database, `miseenplace_restore_check`, compares row counts with the live database, checks the images archive beside it holds both files of every image in the dump, and drops the scratch database again:

```bash
cd ~/mise-en-place
scripts/backup.sh
scripts/restore-check.sh
```

Section 7 adds an encrypted copy off the Pi.

## 7. Off-site copy

The backups folder is on the same disk as the database, so one dead SD card or SSD would take both. `scripts/offsite.sh` keeps an encrypted copy in Backblaze B2 with restic. restic encrypts on the Pi, so B2 only ever holds encrypted data.

1. **Account:** sign up for B2 Cloud Storage at <https://www.backblaze.com/sign-up/cloud-storage>. When it asks for a region, choose **EU Central**. The first 10 GB are free, and the dumps are far smaller than that. So are the images: at most 10 per recipe, a few hundred kilobytes each, and restic stores a file it has seen before only once, however many nightly archives hold it.
2. **Bucket:** under **Buckets**, create one with a unique name, for example `miseenplace-` plus a few random characters. Use **lowercase letters only**: buckets used through B2's S3-compatible API must follow S3's naming rules, and a bucket can't be renamed later. Make its files **Private**, and leave Object Lock off. Note its **Endpoint**, such as `s3.eu-central-003.backblazeb2.com`.
3. **Key for the Pi:** under **Application Keys**, add a key named after the Pi, allowed into that bucket only, with **Read and Write** access.
   - Tick **Allow listing all bucket names including bucket creation dates**: B2's S3-compatible API needs it for a key limited to one bucket.
   - Leave the file name prefix and the duration empty. A key with a duration expires, and the nightly copy would quietly stop.

   Backblaze shows the key once, so keep the page open until step 5. The account's master key doesn't work with the S3-compatible API.
4. **restic on the Pi:**
   ```bash
   sudo apt install -y restic
   restic version
   ```
5. **Settings,** in a file only you can read. This writes a generated restic password and placeholders for the rest:
   ```bash
   mkdir -p ~/.config/miseenplace
   cat > ~/.config/miseenplace/restic.env <<EOF
   RESTIC_REPOSITORY=s3:https://<endpoint>/<bucket>/miseenplace
   AWS_DEFAULT_REGION=<region>
   AWS_ACCESS_KEY_ID=<keyID>
   AWS_SECRET_ACCESS_KEY=<applicationKey>
   RESTIC_PASSWORD=$(openssl rand -hex 32)
   EOF
   chmod 600 ~/.config/miseenplace/restic.env
   nano ~/.config/miseenplace/restic.env
   ```
   In nano, replace the four placeholders in angle brackets:
   - the endpoint and bucket name from step 2
   - the region, which is the middle of the endpoint: `eu-central-003` in `s3.eu-central-003.backblazeb2.com`
   - the key ID and key from step 3

   Typing them in nano rather than on the command line keeps the key out of your shell history.
6. **Save the whole file in your password manager,** for example as a secure note (`cat ~/.config/miseenplace/restic.env` shows it). Without `RESTIC_PASSWORD`, nobody can decrypt the copy, you included. With the file, a new install can reach it.
7. **Create the repository and make the first copy:**
   ```bash
   cd ~/mise-en-place
   scripts/offsite.sh init
   scripts/offsite.sh
   scripts/offsite.sh snapshots
   ```
8. **Every night, straight after the backup:** this replaces section 6's cron line with one that runs both, and copies only if the backup succeeded. Section 9 replaces it again, with `nightly.sh`, which does the same and then tells Healthchecks:
   ```bash
   (crontab -l | grep -v scripts/backup.sh; echo '30 3 * * * ($HOME/mise-en-place/scripts/backup.sh && $HOME/mise-en-place/scripts/offsite.sh) >> $HOME/miseenplace-backup.log 2>&1') | crontab -
   ```
9. **Test a restore from B2.** restic recreates the full path under the target folder:
   ```bash
   scripts/offsite.sh restore latest --target /tmp/offsite-restore
   ls -t /tmp/offsite-restore/srv/miseenplace/backups
   scripts/restore-check.sh /tmp/offsite-restore/srv/miseenplace/backups/<newest>.dump
   rm -rf /tmp/offsite-restore
   ```

Each night it keeps 7 daily, 4 weekly and 6 monthly snapshots. On Sundays it also downloads a random tenth of the stored data and checks it. It copies the whole backups folder, so the images archives go with the dumps.

### The images volume

Recipe images (3b) live in the `media` Docker volume, mounted into the API at `/app/media`. The image creates that folder owned by its `node` user, and Docker gives a new, empty volume the same owner, so the API can write to it. If uploads ever fail with "permission denied" in `docker compose logs api` (a volume made some other way), give it back to `node`:

```bash
docker compose run --rm --no-deps --user root --entrypoint chown api node:node /app/media
```

## 8. Installing the app on your phone

With Tailscale connected on the phone:

1. Open `https://<name>.<tailnet>.ts.net` in Firefox for Android. The recipe list appears.
2. In Firefox's menu (⋮), choose **Install**. On some versions it's **Add app to Home screen**. In Chrome, it's **Install app**.
3. Open it from the Home Screen. It opens in its own window, without the browser's address bar.

Things worth knowing:

- **Starting without a connection:** the service worker keeps the app's files on the phone, so the app opens even with Tailscale off.
- **Offline (3c):** the app keeps a copy of every recipe on the phone, refreshed whenever it opens or comes back to the front with the Pi in reach. Off the tailnet (Proton on, or airplane mode), recipes, search and cooking mode work from that copy, with a banner saying how old it is.
- **Saving offline:** new recipes and edits made off the tailnet wait on the phone, marked "Waiting to upload", and upload by themselves once the Pi can be reached again, with no tap. Deleting a recipe, and renaming or deleting an ingredient, still need the connection.
- **Protect it:** in **Options › Offline copy**, tap **Protect** once and allow it, so Firefox doesn't clear the copy when the phone runs short of space. Chrome and Edge decide for themselves, and allow it for installed apps. In Firefox, leave **Delete browsing data on quit** off: it would erase the copy every time.
- **What clears it:** clearing the site's data in the browser's settings, or removing the app from the Home Screen, deletes the copy and any changes still waiting to upload. The copy comes back at the next refresh; waiting changes don't, so first check that Options shows none waiting.
- **A change that couldn't upload,** because the recipe was changed or deleted on another device meanwhile, or the server refused it, shows a banner on every page. Its recipe page explains, with the choices: Keep mine, Keep theirs or Keep both; Save as a new recipe or Discard; or Edit it.
- **Updates:** after a deploy, the next time you open the app it downloads the new version and reloads into it once. Running timers survive that, since they're kept on the phone.
- **Cooking mode** keeps the screen on in Firefox 126 or later, and in Chrome. Where it can't, it says the screen may sleep.
- **Timers** ring only while the app is on screen. If you switch to another app, one that ends rings when you come back.
- **Options** (the sliders icon) holds the theme, the text size and the timer sound, which are saved on each device.

## 9. Alerts

`scripts/monitor.sh` and `scripts/nightly.sh` tell [Healthchecks.io](https://healthchecks.io) how the Pi is doing, and Healthchecks pushes an alert to the ntfy app on your phone when something is wrong, then another when it's fixed (D16).

**What leaves the Pi:** every 5 minutes, one HTTPS request to `hc-ping.com`, saying "ok, disk 41%" or only what failed, such as "api: 503"; and one each night for the backup, "ok" or which part failed. Nothing connects in. Healthchecks sees the address the requests come from, your home's public IP, as any website you visit does. A watcher outside the Pi is the only way to notice the Pi itself going silent. Healthchecks then sends the alert to `ntfy.sh`, which passes it to the phone.

What each alert means, and what to look at first:

| Alert | What it means | First look |
|---|---|---|
| `health`: `api: 503` | The API is running but can't reach the database | `docker compose ps`, then `docker compose logs --tail=50 db` |
| `health`: `api: no answer` | The API isn't running, or is stuck | `docker compose ps`, then `docker compose logs --tail=50 api`; `docker compose up -d` starts it again |
| `health`: `tailnet: …` alone | The API is fine, but `tailscale serve` isn't passing requests to it | `tailscale status` and `tailscale serve status` |
| `health`: `disk 91%, limit 85%` | The fuller of the disks holding Docker's data and the backups has passed the limit | `df -h` and `docker system df`; `docker image prune` removes the old images that deploys leave behind |
| `health`: `disk: can't read` | `df` couldn't read one of those folders | Does `/srv/miseenplace/backups` still exist? |
| `health` down, with no message | No ping for 10 minutes: the Pi is off or offline, or cron has stopped | The Pi's power and network, then `systemctl status cron` |
| `backup`: `backup failed` | `backup.sh` failed, so the off-site copy was skipped; the older backups are kept | `tail -50 ~/miseenplace-backup.log` |
| `backup`: `offsite failed` | The night's backup is on the Pi, but the copy to B2 failed | The same log, then `scripts/offsite.sh snapshots` |
| `backup` down, with no message | No ping by 05:30: cron didn't start it, or it's still running | The same log, and `crontab -l` |

`monitor.sh` retries a failed health check for 30 seconds before it counts, so a deploy's restart doesn't raise an alert.

1. **The ntfy app** on your phone: from F-Droid, which keeps its own connection to `ntfy.sh` and doesn't use Google's push service, or from the Play Store, which gets its notifications through Google's push service, so Google relays them. Subscribe to a new topic on `ntfy.sh` with a long random name: anyone who knows a topic's name can read it and send to it, so the name is its password. On the Pi, `openssl rand -hex 16` makes one. Keep it in your password manager.
2. **A Healthchecks.io account:** sign up at <https://healthchecks.io>. The free plan is enough. Under **Integrations**, add **ntfy**: server `https://ntfy.sh`, your topic, priority **High** for "down" and **Default** for "up". Its **Test** button should reach the phone.
3. **Two checks,** with plain names that say nothing about your home, and no description:
   - `health`: schedule **Simple**, period 5 minutes, grace time 5 minutes, so it alerts after 10 minutes without a ping
   - `backup`: schedule **Cron**, `30 3 * * *`, in the Pi's time zone (`timedatectl | grep 'Time zone'`), grace time 2 hours

   Make sure each has the ntfy integration ticked. Each shows a ping URL, `https://hc-ping.com/<uuid>`: keep both secret, since anyone with one can ping that check.
4. **Settings,** in a file only you can read, like `restic.env`:
   ```bash
   mkdir -p ~/.config/miseenplace
   cat > ~/.config/miseenplace/alerts.env <<'EOF'
   HEALTH_PING_URL=https://hc-ping.com/<health-uuid>
   BACKUP_PING_URL=https://hc-ping.com/<backup-uuid>
   TAILNET_URL=https://<name>.<tailnet>.ts.net
   DISK_LIMIT=85
   EOF
   chmod 600 ~/.config/miseenplace/alerts.env
   nano ~/.config/miseenplace/alerts.env
   ```
   In nano, put in the two ping URLs from step 3 and the Pi's address, the one in section 8. Keep a copy of the file in your password manager too.
5. **Try both by hand:**
   ```bash
   cd ~/mise-en-place
   scripts/monitor.sh && echo ok
   scripts/nightly.sh
   ```
   `monitor.sh` prints nothing but `ok`, and Healthchecks shows the ping with the disk use. `nightly.sh` makes a real backup and off-site copy, then Healthchecks shows "ok" on `backup`.
6. **Cron:** this replaces section 7's nightly line with `nightly.sh`, which does the same and then tells Healthchecks, and adds `monitor.sh` every 5 minutes. Each logs to a file in your home folder; `monitor.sh` writes only failures, so its log stays small:
   ```bash
   (crontab -l | grep -v -e scripts/backup.sh -e scripts/nightly.sh -e scripts/monitor.sh
    echo '30 3 * * * $HOME/mise-en-place/scripts/nightly.sh >> $HOME/miseenplace-backup.log 2>&1'
    echo '*/5 * * * * $HOME/mise-en-place/scripts/monitor.sh >> $HOME/miseenplace-monitor.log 2>&1') | crontab -
   crontab -l
   ```
7. **Log rotation** for those two logs: weekly, 8 weeks kept, compressed. Docker's own logs already rotate (the `local` log driver). This writes the rule with your home folder and user filled in, then shows what logrotate would do, without doing it:
   ```bash
   sudo tee /etc/logrotate.d/miseenplace > /dev/null <<EOF
   $HOME/miseenplace-backup.log $HOME/miseenplace-monitor.log {
       weekly
       rotate 8
       compress
       delaycompress
       missingok
       notifempty
       su $(id -un) $(id -gn)
   }
   EOF
   sudo logrotate --debug /etc/logrotate.d/miseenplace
   ```
8. **Check that each alert arrives,** then its recovery notice (Step 29's checks):
   - the API stopped: `docker compose stop api`; at `monitor.sh`'s next run, within 5 minutes, `health` goes down with `api: no answer`. Then `docker compose start api`, and the run after brings the recovery notice
   - the disk limit: set `DISK_LIMIT=1` in `alerts.env` and run `scripts/monitor.sh`; then put it back to 85 and run it again
   - a failed backup: `mv ~/.config/miseenplace/restic.env ~/restic.env.away`, run `scripts/nightly.sh` (`offsite failed`), then move it back and run `scripts/offsite.sh`
   - the Pi silent: `sudo systemctl stop cron` for 15 minutes, then `sudo systemctl start cron`

**Pausing for maintenance,** such as a restore or the move to an SSD: pause the `health` check in Healthchecks, and `touch ~/.config/miseenplace/monitor.paused`, which makes `monitor.sh` check and send nothing. Both are needed: any ping, a failed one included, resumes a paused check. Afterwards, `rm ~/.config/miseenplace/monitor.paused`, and the next ping resumes the check. With the Pi switched off, pausing the checks in Healthchecks is enough.

## Checks

These are Step 8's "done when" checks:

1. **HTTPS over Tailscale:** on your phone, with Tailscale connected, open `https://<name>.<tailnet>.ts.net/api/health`. Expect `{"status":"ok"}`.
2. **Nothing on the home network:** from another computer on your home network, using the Pi's LAN address (from `hostname -I` on the Pi, not its `100.x` Tailscale address), both of these must fail to connect:
   ```bash
   curl -m 5 http://<pi-lan-ip>:3000/api/health
   nc -zv -w 5 <pi-lan-ip> 5432
   ```
   On Windows, use `Test-NetConnection <pi-lan-ip> -Port 3000` and `-Port 5432` in PowerShell; expect `TcpTestSucceeded : False`.
3. **Reboots:** run `sudo reboot`. Once the Pi is back, without doing anything else, `docker compose ps` shows both services as healthy and check 1 passes again.
4. **Restores:** `scripts/restore-check.sh` passes.

## Day to day

All of these run in `~/mise-en-place` on the Pi:

| Task | Command |
|---|---|
| Deploy the latest `main` (it builds the web client too, so allow a few minutes) | `scripts/deploy.sh` |
| Status and health | `docker compose ps` |
| API logs | `docker compose logs -f api` |
| Back up now | `scripts/backup.sh` |
| Check the newest backup restores | `scripts/restore-check.sh` |
| Which PostgreSQL the database runs | `docker compose exec db postgres --version` |
| Copy the backups to B2 now | `scripts/offsite.sh` |
| List the copies in B2 | `scripts/offsite.sh snapshots` |
| How much room the images take | `docker compose run --rm --no-deps --entrypoint du api -sh /app/media` |
| Check the API and the disk now, as cron does | `scripts/monitor.sh && echo ok` |
| The last alerts' details | `tail ~/miseenplace-monitor.log` |
| Pause the alerts for maintenance, then resume | [Section 9](#9-alerts): `touch ~/.config/miseenplace/monitor.paused` and pause `health` in Healthchecks; afterwards `rm` the file |

Backups go to `/srv/miseenplace/backups`. Set `BACKUP_DIR` to use another folder, and `KEEP_DAYS` to keep backups for longer than 7 days.

Never run `docker compose down -v`: `-v` deletes the database volume and the images volume.

Each deploy downloads the newest `postgres:17` image and builds from the newest `node:22-slim`, so their security fixes arrive with it. The `17` tag only moves through 17.x releases, which keep the same data format, and the database restarts for a few seconds only when its image has changed, after the deploy's backup. A new major version of PostgreSQL (18) is a task of its own: its data format differs, so it needs a dump and a restore, never just a new tag in the Compose file.

### Restoring for real

This replaces everything in the live database with the dump, and the images with the archive beside it. Take a fresh backup first. If the backups on the Pi are gone, fetch them from B2 first (section 7, step 9). Then, with `<file>` the backup's name without its extension:

```bash
docker compose stop api
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error' \
  < /srv/miseenplace/backups/<file>.dump
# The images: empty the volume, then unpack the archive into it, as the node user, so the API owns the files
docker compose run --rm --no-deps -T --entrypoint sh api -c 'find /app/media -mindepth 1 -delete && tar -C /app/media -xf -' \
  < /srv/miseenplace/backups/<file>.media.tar
docker compose start api
```

A backup from before 3b has no `.media.tar`: skip that line.

## Moving to an SSD

Everything on the Pi is in git, in `.env`, in the database or, from 3b, in the images volume, so moving from the SD card to an SSD is a fresh install plus a restore. The SD card stays untouched, as a fallback.

1. In Healthchecks, pause both checks (section 9), so the Pi's silence during the move raises no alert; the new install's first pings resume them. Then, on the Pi, take a backup and note the file names it prints (a `.dump` and a `.media.tar`), then send them to B2:
   ```bash
   ~/mise-en-place/scripts/backup.sh pre-ssd
   ~/mise-en-place/scripts/offsite.sh
   ```
   Without the off-site copy, copy both files to your PC instead, with a USB stick or with `scp`, which Windows has built in:
   ```bash
   scp <user>@<pi-lan-ip>:/srv/miseenplace/backups/pre-ssd-<stamp>.* .
   ```
2. Shut the Pi down with `sudo poweroff`, take the SD card out and keep it.
3. In the Tailscale admin console, under **Machines**, remove the old Pi. The new install can then take the same name, so the `https://<name>.<tailnet>.ts.net` address stays the same.
4. Follow sections 1–4 on the SSD. Give `.env` a new password: `--no-owner` below makes the new database user the owner of everything restored.
5. Before the first deploy, create the backups folder on the Pi:
   ```bash
   sudo mkdir -p /srv/miseenplace/backups
   sudo chown "$USER": /srv/miseenplace/backups
   ```
   Fetch the backup from B2. First install restic and write `~/.config/miseenplace/restic.env` from your password manager, as in section 7, steps 4–6. Don't generate a new password: only the saved one can decrypt the copy.
   ```bash
   ~/mise-en-place/scripts/offsite.sh restore latest --target /tmp/offsite-restore
   cp /tmp/offsite-restore/srv/miseenplace/backups/pre-ssd-<stamp>.* /srv/miseenplace/backups/
   ```
   Without the off-site copy, copy both files back from your PC. If `scp` warns that the host key has changed, that's the fresh install: run `ssh-keygen -R <pi-lan-ip>` and try again.
   ```bash
   scp pre-ssd-<stamp>.dump pre-ssd-<stamp>.media.tar <user>@<pi-lan-ip>:/srv/miseenplace/backups/
   ```
   Then restore it into the new, empty database on the Pi:
   ```bash
   cd ~/mise-en-place
   docker compose up -d --wait db
   docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' \
     < /srv/miseenplace/backups/pre-ssd-<stamp>.dump
   ```
   And the images, into the new, empty volume. Building the image first makes the folder the volume takes its owner from:
   ```bash
   docker compose build api
   docker compose run --rm --no-deps -T --entrypoint tar api -C /app/media -xf - \
     < /srv/miseenplace/backups/pre-ssd-<stamp>.media.tar
   ```
6. Carry on with sections 5 and 6, then section 7 from step 8: the repository already exists. Then section 9 from step 4, with `alerts.env` from your password manager. Then run the checks. `deploy.sh` applies any migrations newer than the dump.
