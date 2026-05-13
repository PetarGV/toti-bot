# Automations

All scheduled / background jobs the bot runs. Each is started from [src/index.js](src/index.js) on `clientReady` and uses `node-cron`. Times are UTC.

## Schedule overview

| Job              | Schedule              | What it does                                    |
|------------------|-----------------------|-------------------------------------------------|
| Map fetch        | Daily 06:00           | Pull fresh `map.sql` into the `x_world` table   |
| Member sync      | Daily 06:30 + 18:30   | Match Discord members to map players, refresh roles, flag stale links |
| Call expiry      | Every 5 min           | Mark `open` calls past deadline as `expired`    |
| Timer tick       | Every 10 sec          | Fire user reminder timers + drain auto-deletes  |
| Backup           | Daily 03:00           | Snapshot the SQLite DB to `data/backups/`       |
| Startup catch-up | Once at boot          | Run map fetch / member sync if data is stale    |

---

## Map fetch — [src/jobs/mapFetch.js](src/jobs/mapFetch.js)

Pulls the `map.sql` export from the configured Travian server, parses every `INSERT INTO x_world ...` tuple, and replaces the `x_world` table inside one transaction. Records `last_fetch_at` and `last_fetch_count` config keys on success.

- **HTTP timeout:** 30 s (`AbortSignal.timeout`)
- **Retry:** 3 attempts total — 1 min then 5 min backoff on transient failures
- **Non-retryable errors:** `PRE_LAUNCH` (404 — server not live yet) and `EMPTY_RESPONSE`
- **On final failure:** sends `⚠️ Map fetch failed: <reason>` to the notifications channel (unless `PRE_LAUNCH`, which is silent)
- **Manual trigger:** `/admin fetch-map`
- **Override hour:** `MAP_FETCH_HOUR=8` env var (defaults to `6`)

## Member sync — [src/jobs/memberSync.js](src/jobs/memberSync.js)

Walks all non-bot Discord members and matches them against the `x_world` map data.

For each member with a confirmed match:
1. Create a `user_ign_links` row if one does not exist
2. Assign the tribe role (Roman / Teuton / Gaul / Egyptian / Hun / Spartan)
3. Assign the alliance role: either the configured "Accepted" role or `TBD` (in-alliance vs out)
4. Rename their private onboarding channel to their Travian IGN
5. If the alliance role flipped to `TBD`, flag the onboarding channel for leadership review
6. If the IGN has disappeared from `x_world` entirely, flag the onboarding channel with a different reason ("account deleted or wiped")

Sends an embed to the notifications channel summarising new links / roles / flagged / ambiguous / unmatched. Records `last_sync_at` on completion.

- **Schedule offset:** runs 30 min after the map fetch to avoid a race on stale data
- **Exclusions:** members in `sync_exclusions` are skipped entirely (`/admin sync-exclude @user`)
- **Manual trigger:** `/admin sync-members`

## Call expiry — [src/jobs/expiry.js](src/jobs/expiry.js)

Every 5 minutes, finds open calls whose `deadline` has passed and marks them `expired`. Updates the panel message so the embed reflects the new status. Errors per-call are logged but don't stop the loop.

## Timer tick — [src/jobs/timerTick.js](src/jobs/timerTick.js)

Two responsibilities, both running every 10 seconds:

1. **Fire due timers** — for each row in `timers` with `next_fire_at <= now`, send a reminder ping in the configured channel, advance `next_fire_at`, increment `fires_count`.
2. **Drain pending deletes** — fire-and-forget delete every message in `pending_message_deletes` whose `delete_at <= now`. Used to auto-clean timer pings after 30 s without leaving them orphaned across bot restarts.

If a timer's channel is gone or unreachable, `next_fire_at` is still advanced so the loop doesn't hammer a broken channel.

## Backup — [src/jobs/backup.js](src/jobs/backup.js)

Daily snapshot of the SQLite DB. Because the project uses `sql.js` (in-memory DB with debounced file persistence), the backup is taken from `db.export()` directly — **not** by copying the live `.db` file, which would race with the debounced writer.

- **Destination:** `data/backups/travian-YYYY-MM-DD.db`
- **Same-day collision:** suffix `-HHMMSS` so a manual `/admin backup-now` and the scheduled run don't overwrite each other
- **Retention:** prune backups older than `BACKUP_RETAIN_DAYS` (default 7)
- **On failure:** logs + sends `⚠️ Backup failed: <reason>` to the notifications channel
- **Manual trigger:** `/admin backup-now`
- **Override hour:** `BACKUP_HOUR=4` env var (defaults to `3`)

## Startup catch-up — [src/index.js](src/index.js)

Runs once on `clientReady` after the cron jobs are scheduled. Checks two staleness windows and runs the relevant job immediately if the bot was offline at the scheduled time:

| Check                  | Threshold | Action                                |
|------------------------|-----------|---------------------------------------|
| `last_fetch_at` age    | > 25h     | Run `fetchMapWithRetry()` immediately |
| `last_sync_at` age     | > 13h     | Run `runMemberSync()` immediately     |

If the map fetch catch-up fails, the member sync catch-up is skipped (it would run against stale data).

---

## Configuration knobs

Stored in the `config` table (`getConfig` / `setConfig`):

| Key                       | Set via                                       | Used by                       |
|---------------------------|-----------------------------------------------|-------------------------------|
| `server_url`              | `/admin set-server`                           | Map fetch                     |
| `last_fetch_at`           | (written by map fetch)                        | Startup catch-up, `/admin map-status` |
| `last_fetch_count`        | (written by map fetch)                        | `/admin map-status`           |
| `last_sync_at`            | (written by member sync)                      | Startup catch-up              |
| `notifications_channel_id`| `/admin set-notifications-channel`            | All failure / sync notifications |
| `primary_guild_id`        | direct DB write (optional)                    | `getPrimaryGuild` — fallback is `client.guilds.cache.first()` |
| `onboarding_category_id`  | `/admin set-onboarding-category`              | Onboarding channel creation   |
| `welcome_channel_id`      | `/admin set-welcome-channel`                  | Onboarding intro              |

Environment variables:

| Var                   | Default | Effect                                 |
|-----------------------|---------|----------------------------------------|
| `MAP_FETCH_HOUR`      | `6`     | Hour of day for the map fetch cron     |
| `BACKUP_HOUR`         | `3`     | Hour of day for the backup cron        |
| `BACKUP_RETAIN_DAYS`  | `7`     | Days to keep `.db` backups             |
| `DB_PATH`             | `data/travian.db` | DB file path                 |
| `BACKUP_DIR`          | `data/backups`    | Where backups are written    |

---

## Notifications channel

Helper: [src/utils/guild.js](src/utils/guild.js) → `getNotificationsChannel(guild)`.

Resolution order:
1. Channel ID stored in the `notifications_channel_id` config key (set by `/admin set-notifications-channel`)
2. Channel literally named `bot-notifications` in the cached channel list

If neither exists, failure notifications are silently dropped (logged only). Set it once with `/admin set-notifications-channel #channel`.

---

## Operational notes

- **Cron jobs are not destroyed on shutdown.** `client.destroy()` ends Discord activity but in-flight cron callbacks may complete after that. All jobs early-out gracefully if the guild / channel is gone.
- **All times are UTC.** `process.env.TZ = 'UTC'` is set at the very top of [src/index.js](src/index.js) before any `Date` is constructed.
- **`/admin diag`** shows uptime, memory usage, DB size, and last-fetch state for a quick snapshot.
- **`/admin tail-log lines:200`** is the fastest way to inspect what a recent cron run did.
