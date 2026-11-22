# Deploying to the Raspberry Pi

How the API runs on the Pi from Phase 2: in Docker, listening on `127.0.0.1:3000` only, published to your own devices by `tailscale serve` over HTTPS. The database has no published port. [`architecture.md`](architecture.md) has the diagram.

Sections 1–7 are a one-time setup. After that, deploying is one command (see [Day to day](#day-to-day)).

| File | What it does |
|---|---|
| `docker-compose.prod.yml` | The API and PostgreSQL 17, with restart policies and healthchecks. Project name `miseenplace-prod` |
| `Dockerfile` | The API image: built on the Pi, runs as the non-root `node` user, includes the Prisma CLI for migrations |
| `scripts/deploy.sh` | Backs up, pulls `main`, builds, migrates, restarts, and waits for the health check |
| `scripts/backup.sh` | Dumps the database into the backups folder, checks the dump, and removes dumps older than 7 days |
| `scripts/restore-check.sh` | Restores a dump into a scratch database and compares row counts with the live one |
| `scripts/offsite.sh` | Keeps an encrypted copy of the backups folder in Backblaze B2, with restic |

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

Then test a restore. This restores the newest dump into a scratch database, `miseenplace_restore_check`, compares row counts with the live database, and drops the scratch database again:

```bash
cd ~/mise-en-place
scripts/backup.sh
scripts/restore-check.sh
```

Section 7 adds an encrypted copy off the Pi.

## 7. Off-site copy

The backups folder is on the same disk as the database, so one dead SD card or SSD would take both. `scripts/offsite.sh` keeps an encrypted copy in Backblaze B2 with restic. restic encrypts on the Pi, so B2 only ever holds encrypted data.

1. **Account:** sign up for B2 Cloud Storage at <https://www.backblaze.com/sign-up/cloud-storage>. When it asks for a region, choose **EU Central**. The first 10 GB are free, and the dumps are far smaller than that.
2. **Bucket:** under **Buckets**, create one with a unique name, for example `miseenplace-` plus a few random characters. Make its files **Private**, and leave Object Lock off. Note its **Endpoint**, such as `s3.eu-central-003.backblazeb2.com`.
3. **Key for the Pi:** under **Application Keys**, add a key named after the Pi, allowed into that bucket only, with **Read and Write** access. If the form offers **Allow List All Bucket Names**, tick it: B2's S3-compatible API needs it. Backblaze shows the key once, so keep the page open until step 5. The account's master key doesn't work with the S3-compatible API.
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
8. **Every night, straight after the backup:** this replaces section 6's cron line with one that runs both, and copies only if the backup succeeded:
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

Each night it keeps 7 daily, 4 weekly and 6 monthly snapshots. On Sundays it also downloads a random tenth of the stored data and checks it.

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
| Deploy the latest `main` | `scripts/deploy.sh` |
| Status and health | `docker compose ps` |
| API logs | `docker compose logs -f api` |
| Back up now | `scripts/backup.sh` |
| Check the newest backup restores | `scripts/restore-check.sh` |
| Copy the backups to B2 now | `scripts/offsite.sh` |
| List the copies in B2 | `scripts/offsite.sh snapshots` |

Backups go to `/srv/miseenplace/backups`. Set `BACKUP_DIR` to use another folder, and `KEEP_DAYS` to keep dumps for longer than 7 days.

Never run `docker compose down -v`: `-v` deletes the database volume.

### Restoring for real

This replaces everything in the live database with the dump. Take a fresh backup first. If the dumps on the Pi are gone, fetch one from B2 first (section 7, step 9). Then:

```bash
docker compose stop api
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error' \
  < /srv/miseenplace/backups/<file>.dump
docker compose start api
```

## Moving to an SSD

Everything on the Pi is in git, in `.env` or in the database, so moving from the SD card to an SSD is a fresh install plus a restore. The SD card stays untouched, as a fallback.

1. On the Pi, take a backup and note the file name it prints, then send it to B2:
   ```bash
   ~/mise-en-place/scripts/backup.sh pre-ssd
   ~/mise-en-place/scripts/offsite.sh
   ```
   Without the off-site copy, copy the dump to your PC instead, with a USB stick or with `scp`, which Windows has built in:
   ```bash
   scp <user>@<pi-lan-ip>:/srv/miseenplace/backups/pre-ssd-<stamp>.dump .
   ```
2. Shut the Pi down with `sudo poweroff`, take the SD card out and keep it.
3. In the Tailscale admin console, under **Machines**, remove the old Pi. The new install can then take the same name, so the `https://<name>.<tailnet>.ts.net` address stays the same.
4. Follow sections 1–4 on the SSD. Give `.env` a new password: `--no-owner` below makes the new database user the owner of everything restored.
5. Before the first deploy, create the backups folder on the Pi:
   ```bash
   sudo mkdir -p /srv/miseenplace/backups
   sudo chown "$USER": /srv/miseenplace/backups
   ```
   Fetch the dump from B2. First install restic and write `~/.config/miseenplace/restic.env` from your password manager, as in section 7, steps 4–6. Don't generate a new password: only the saved one can decrypt the copy.
   ```bash
   ~/mise-en-place/scripts/offsite.sh restore latest --target /tmp/offsite-restore
   cp /tmp/offsite-restore/srv/miseenplace/backups/pre-ssd-<stamp>.dump /srv/miseenplace/backups/
   ```
   Without the off-site copy, copy the dump back from your PC. If `scp` warns that the host key has changed, that's the fresh install: run `ssh-keygen -R <pi-lan-ip>` and try again.
   ```bash
   scp pre-ssd-<stamp>.dump <user>@<pi-lan-ip>:/srv/miseenplace/backups/
   ```
   Then restore it into the new, empty database on the Pi:
   ```bash
   cd ~/mise-en-place
   docker compose up -d --wait db
   docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' \
     < /srv/miseenplace/backups/pre-ssd-<stamp>.dump
   ```
6. Carry on with sections 5 and 6, then section 7 from step 8: the repository already exists. Then run the checks. `deploy.sh` applies any migrations newer than the dump.
