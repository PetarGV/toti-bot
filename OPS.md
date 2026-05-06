# Ops Cheatsheet

## Daily commands

```bash
docker compose logs -f bot          # follow live logs
docker compose restart bot          # safe restart
docker compose down                 # stop
docker compose up -d                # start in background
docker compose ps                   # status (health column shows healthy/unhealthy)
```

## Health checks

```bash
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/metrics
```

## Inside Discord (admin only)

| Command | What it does |
|---|---|
| `/admin diag` | uptime, RAM, DB size, open call count, last error |
| `/admin tail-log lines:100` | last N log lines (token/secret keywords redacted) |
| `/admin map-status` | last map.sql fetch time + top alliances |
| `/admin fetch-map` | manual map fetch |
| `/admin set-server url:<>` | change Travian server URL (no restart needed) |
| `/admin reset-round` | wipe map + calls (keeps user profiles) |
| `/admin db-vacuum` | compact DB file |
| `/admin backup-now` | run backup immediately |

## Files

```
data/travian.db                     # main DB
data/backups/travian-YYYY-MM-DD.db  # daily backups (last 7)
data/logs/bot.log                   # live log
data/logs/bot-errors.log            # errors only
data/logs/bot-YYYY-MM-DD.log        # rotated daily (last 14)
```

## Common fixes

**Bot offline / unhealthy** — `docker compose restart bot`. Check `data/logs/bot-errors.log` for the cause.

**"Missing Access" on slash commands** — bot needs to be re-invited with `applications.commands` scope.

**Buttons greyed out / "interaction failed"** — bot is down or restarting. Wait or restart.

**DB size growing** — `/admin db-vacuum` reclaims space after big resets.

**Server reset (new Travian round)** — `/admin set-server url:<new>` then `/admin reset-round`.

## Restoring from backup

```bash
docker compose down
cp data/backups/travian-YYYY-MM-DD.db data/travian.db
docker compose up -d
```