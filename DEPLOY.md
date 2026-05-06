# Deployment Guide

Two supported paths:

- **Fly.io** (recommended) — ~$4/mo, public HTTPS URL out of the box, simplest to operate. Jump to [Fly.io](#flyio).
- **VPS / self-hosted** (Hetzner, Oracle, etc.) — full control, slightly cheaper, more setup.

---

## Fly.io

~15 minutes from zero to running.

### 1. Install flyctl + sign in

```powershell
# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```
```bash
# Linux / macOS
curl -L https://fly.io/install.sh | sh
```

```bash
fly auth signup    # or `fly auth login` if you already have an account
```

### 2. Launch the app (uses the bundled fly.toml)

From the repo root:

```bash
fly launch --copy-config --no-deploy
```

- Pick a unique app name (defaults to `toti-bot` — global Fly namespace, may be taken).
- Pick a region close to your alliance: `fra` (Frankfurt), `waw` (Warsaw), `mad` (Madrid), `lhr` (London), etc.
- Postgres / Redis / Sentry: **No** to all.
- Deploy now: **No**.

### 3. Create the persistent volume

```bash
fly volumes create data --size 1 --region fra   # match the region you chose
```

### 4. Set secrets (encrypted, never in fly.toml)

```bash
fly secrets set DISCORD_TOKEN=your_token CLIENT_ID=your_id GUILD_ID=your_id
```

### 5. Deploy

```bash
fly deploy
fly logs                         # tail startup
```

### 6. Register slash commands (one-time)

```bash
fly ssh console -C "node src/commands/deploy.js"
```

### 7. Verify

```bash
curl https://<your-app>.fly.dev/health
```

In Discord: `/admin diag` shows uptime + memory.

### Updating — auto-deploy from GitHub (recommended)

The repo ships with [.github/workflows/fly-deploy.yml](.github/workflows/fly-deploy.yml). Every push to `main` validates syntax then runs `fly deploy` on Fly's builders. One-time setup:

```bash
# Generate a deploy token scoped to this app
fly tokens create deploy -x 999999h
```

Copy the printed token. In GitHub:

1. Go to your repo → **Settings → Secrets and variables → Actions**.
2. **New repository secret**: name `FLY_API_TOKEN`, value = the token from above.

Push to `main` and watch the **Actions** tab. The volume persists across deploys.

### Updating manually

```bash
git pull            # if you cloned; otherwise just edit
fly deploy
```

The volume persists across deploys.

### Notes

- `auto_stop_machines = false` in [fly.toml](fly.toml) is **required** — the bot needs the Discord WebSocket connection always live. Don't change that.
- 512 MB is the sweet spot. 256 MB may OOM under load.
- For backups: `fly volumes snapshots create <vol-id>` (paid, ~$0.005/GB·mo).

---

## VPS / Self-Hosted

### Recommended: Hetzner CX22 (€4.51/mo) or Oracle Cloud Free Tier

Any Linux VPS with Docker works. ~10 minutes from fresh box to running bot.

## 1. Prepare the VPS

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER     # log out + back in after this
```

## 2. Copy the project

Either `git clone` (if you push to a private repo) or `scp -r` from your PC:

```bash
scp -r "Travian Bot" user@your-vps-ip:/home/user/travian-bot
ssh user@your-vps-ip
cd ~/travian-bot
```

## 3. Configure

```bash
cp .env.example .env
nano .env
```

Fill in: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`. Adjust `TRAVIAN_SERVER_URL` if needed.

## 4. Register slash commands (one time)

```bash
docker compose run --rm bot node src/commands/deploy.js
```

## 5. Start

```bash
docker compose up -d
docker compose logs -f bot          # follow startup; Ctrl+C to detach
```

## 6. Verify

```bash
curl http://127.0.0.1:8080/health    # should return {"status":"ok",...}
```

In Discord: run `/admin diag` to see uptime + memory.

## Updating the bot

```bash
# pull latest code (or scp again)
git pull
docker compose build --no-cache
docker compose up -d
```

The DB persists across rebuilds via the `data/` volume.

## Auto-start on reboot

`restart: unless-stopped` in docker-compose handles this — Docker's daemon runs at boot, the container restarts with it. Confirm with:

```bash
sudo systemctl enable docker
sudo systemctl status docker
```

## Firewall

Health endpoint is bound to `127.0.0.1` only via docker-compose (not reachable from internet). No additional firewall config needed for the bot to function. If you want external uptime monitoring, change the port mapping to `8080:8080` (drop the `127.0.0.1:` prefix) and open port 8080 in your VPS firewall.