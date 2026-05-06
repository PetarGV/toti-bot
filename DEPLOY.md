# Deployment Guide — VPS / Self-Hosted

## Recommended: Hetzner CX11 (€4.50/mo) or Oracle Cloud Free Tier

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