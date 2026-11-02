# Deploying to the Raspberry Pi

How the API runs on the Pi from Phase 2: in Docker, listening on `127.0.0.1:3000` only, published to your own devices by `tailscale serve` over HTTPS. The database has no published port. [`architecture.md`](architecture.md) has the diagram.

Steps 1–6 are a one-time setup. After that, deploying is one command (see [Day to day](#day-to-day)).

| File | What it does |
|---|---|
| `docker-compose.prod.yml` | The API and PostgreSQL 17, with restart policies and healthchecks. Project name `miseenplace-prod` |
| `Dockerfile` | The API image: built on the Pi, runs as the non-root `node` user, includes the Prisma CLI for migrations |
| `scripts/deploy.sh` | Backs up, pulls `main`, builds, migrates, restarts, and waits for the health check |
| `scripts/backup.sh` | Dumps the database into the backups folder, checks the dump, and removes dumps older than 7 days |
| `scripts/restore-check.sh` | Restores a dump into a scratch database and compares row counts with the live one |

## What you need

- A Raspberry Pi with 64-bit support (Pi 4 or 5), and an SSD to boot from. PostgreSQL on an SD card is the likeliest way to lose data.
- A Tailscale account, and the Tailscale app on your phone, signed in to the same account.

## 1. Operating system

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
openssl rand -hex 24                # a password; copy it into .env below
nano .env
chmod 600 .env
```

`.env` on the Pi (never committed):

```bash
POSTGRES_USER=miseenplace
POSTGRES_PASSWORD=<the hex string from openssl>
POSTGRES_DB=miseenplace
# Plain `docker compose ...` in this folder then uses the production file
COMPOSE_FILE=docker-compose.prod.yml
```

- Use a hex password: it goes into the database URL, where characters such as `@`, `/` or `:` would break it.
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

An encrypted copy off the Pi is still to be set up (Step 8.7 in [`planning/PLAN.md`](../planning/PLAN.md)).

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

Backups go to `/srv/miseenplace/backups`. Set `BACKUP_DIR` to use another folder, and `KEEP_DAYS` to keep dumps for longer than 7 days.

Never run `docker compose down -v`: `-v` deletes the database volume.

### Restoring for real

This replaces everything in the live database with the dump. Take a fresh backup first, then:

```bash
docker compose stop api
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error' \
  < /srv/miseenplace/backups/<file>.dump
docker compose start api
```
