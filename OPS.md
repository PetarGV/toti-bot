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

**Server / map**

| Command | What it does |
|---|---|
| `/admin set-server url:<>` | Change Travian server URL (no restart needed) |
| `/admin fetch-map` | Manually fetch the latest map.sql |
| `/admin map-status` | Last fetch time, total villages, top alliances |
| `/admin reset-round` | Wipe map + calls for a new round (user profiles kept) |

**Member & IGN management**

| Command | What it does |
|---|---|
| `/admin sync-members` | Match Discord names against Travian map — auto-links unique matches, assigns tribe + alliance roles, flags conflicts/ambiguous for manual resolution |
| `/admin link discord:@ ign:<name>` | Manually link a Discord user to a Travian IGN (added as secondary) |
| `/admin unlink discord:@ ign:<name>` | Remove a Discord ↔ IGN link |
| `/admin set-primary discord:@ ign:<name>` | Change which of a user's IGNs is their primary |
| `/admin set-coords discord:@ coords:<x\|y>` | Set home village coords for a user — auto-assigns tribe + alliance Discord roles |
| `/admin set-welcome-channel channel:#` | Set the channel where new members get the onboarding greeting |

**Diagnostics / maintenance**

| Command | What it does |
|---|---|
| `/admin diag` | Uptime, RAM, DB size, open call count, last error |
| `/admin tail-log lines:100` | Last N log lines (token/secret keywords redacted) |
| `/admin db-vacuum` | Compact the database file |
| `/admin backup-now` | Run a database backup immediately |

**Setup panels** *(requires Manage Channels)*

| Command | What it does |
|---|---|
| `/setup roles` | Post the crew role selection panel |
| `/setup defense` / `offense` / `scout` / `resources` / `general` | Post the matching operations panel |

---

## Member commands

| Command | What it does |
|---|---|
| `/profile` | View your profile (IGN, tribe, coords, crew role) and set/edit your info |
| `/status` | Your profile + all active calls you're involved in |
| `/calls` | List all active calls |
| `/whois coords:<x\|y>` | Look up who owns a village |
| `/nearby coords:<x\|y>` | Find villages near a location (radius + limit optional) |
| `/defense` / `/offense` / `/scout` / `/reinforce` | Post a call |
| `/push resource:<> coords:<> amount:<>` | Request a resource push |
| `/timer set interval:<7m>` | Personal recurring reminder |
| `/leaderboard` | Alliance leaderboards (pushers, defenders, scouts, requesters) |
| `/help` | Interactive guide |

---

## Automatic role assignment

Tribe and alliance roles are assigned automatically whenever an IGN is linked — on join, via sync-members, when setting IGN in the wizard, or via the resolve flows.

| Discord role | Assigned when |
|---|---|
| `Romans` / `Teutons` / `Gauls` / `Egyptians` / `Huns` / `Spartans` | Player's tribe derived from Travian map |
| `Accepted` | Player is in the configured alliance (default: `Invictus`) |
| `Imposter` | Player is **not** in the configured alliance |

To change the alliance name: update `accepted_alliance` in the `config` DB table.

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