# Bot Commands & Functions Reference

All commands and panel buttons, grouped by feature area.

---

## 📦 Resource Push

Coordinate alliance resource pushes with pledge tracking and live progress bars.

### Slash commands
| Command | Args | Description |
|---|---|---|
| `/push` | `resource` `coords` `amount` `[deadline]` | Post a resource request directly |

### Panel buttons (Resources panel)
| Button | Action |
|---|---|
| 🪵 Lumber / 🧱 Clay / 🔩 Iron / 🌾 Crop | Open modal for that resource |
| 📦 All Resources | Request equal amount of all four |
| 📋 Active Calls | List currently open calls |

### Action buttons (on each push embed)
| Button | Who | Action |
|---|---|---|
| ✅ I'll send | Anyone | Add to your pledge (additive) |
| ❌ Withdraw | Anyone | Remove your pledge |
| 🔒 Close | Author only | Mark filled and close |
| 📦 Send resources | Anyone | Open Travian map at coords |
| 🗺️ Map | Anyone | Open Travian map at coords |

**Auto-close** when total pledged ≥ amount needed.
**Auto-expire** after deadline passes.

---

## ⚔️ Combat (Defense / Offense / Reinforce / Urgent)

Rally responders for attacks. Combat calls auto-expire when the arrival time passes.

### Slash commands
| Command | Args | Description |
|---|---|---|
| `/defense` | `coords` `arrival` `[attacker]` `[troops]` | Defense call (pings `@def-crew`) |
| `/offense` | `coords` `arrival` `[notes]` | Offense call (no ping) |
| `/reinforce` | `coords` `arrival` `[notes]` | Reinforcement request (pings `@def-crew`) |

### Panel buttons (Defense panel)
| Button | Action |
|---|---|
| 🛡️ Defense Call | Open modal — pings `@def-crew` |
| ⚔️ Offense Call | Open modal — no ping |
| 🚨 URGENT | Open modal — pings `@everyone` + `@def-crew` |
| 🤝 Reinforce | Open modal — pings `@def-crew` |
| 👀 Scout | Open modal (see Scout section) |

### Action buttons (on each combat embed)
| Button | Who | Action |
|---|---|---|
| ✅ Join (label varies by call type) | Anyone | Add yourself + free-text troop notes |
| ❌ Withdraw | Anyone | Remove yourself |
| 🔄 Update | Author only | Edit coords/arrival/notes |
| 🔒 Close | Author or admin | Close the call |
| 🗺️ Map | Anyone | Open Travian map at coords |
| ⚔️ Rally Point | Anyone | Open rally point with target locked |

---

## 👀 Scout / Intel

Request scouting and lookup village info from cached map data.

### Slash commands
| Command | Args | Description |
|---|---|---|
| `/scout` | `coords` `[notes]` | Request a scout |
| `/whois` | `coords` | Lookup village owner / alliance / population |

### Panel buttons (Intel panel)
| Button | Action |
|---|---|
| 👀 Scout Request | Open scout modal |
| 🔍 Whois Lookup | Open whois modal |
| 📍 Report Sighting | (placeholder, not implemented) |

### Action buttons (on each scout embed)
| Button | Who | Action |
|---|---|---|
| 👀 On it | Anyone | Toggle "I'm scouting" commitment |
| 📝 Submit Report | Anyone | Paste scout report inline |
| 🔒 Close | Author or admin | Close the scout request |
| 🗺️ Map | Anyone | Open Travian map at coords |

---

## 👤 Profile

Per-user settings: in-game name, home coords, tribe, DM notifications.

### Slash commands
| Command | Description |
|---|---|
| `/profile` | Open the profile menu (ephemeral) |

### Profile menu components
| Component | Action |
|---|---|
| ✏️ Set IGN button | One-field modal for in-game name |
| 📍 Set Coords button | One-field modal for home coords |
| 🔔 / 🔕 DMs button | Toggle DM notifications when someone pledges to your call |
| Tribe dropdown | Pick: Romans / Teutons / Gauls / Egyptians / Huns / Spartans |

**Auto-fill:** home coords pre-fill the destination field in push/combat/scout modals.

---

## 📊 Status & Discovery

Personal dashboard, active-call browser, leaderboards.

### Slash commands
| Command | Args | Description |
|---|---|---|
| `/status` | — | Personal dashboard: your profile, your open calls, your pledges, lifetime stats |
| `/calls` | — | Paginated list of all open calls (10/page) |
| `/leaderboard` | `[category]` | Top pushers / defenders / scouts / requesters |

### Panel buttons (General panel)
| Button | Action |
|---|---|
| 📊 My Status | Same as `/status` |
| 📋 Active Calls | Same as `/calls` |
| ⚙️ My Profile | Same as `/profile` |

### Pagination
| Button | Action |
|---|---|
| ⬅️ Previous | Show previous page (disabled on first page) |
| ➡️ Next | Show next page (disabled on last page) |

---

## ⏱️ Personal Timer

Recurring channel-mention reminder. Auto-deletes each tick after 30 seconds.

### Slash commands
| Command | Args | Description |
|---|---|---|
| `/timer set` | `interval` `[label]` | Start or replace your timer (e.g. `7m`, `1h30m`, `90s`) |
| `/timer stop` | — | Stop your timer |
| `/timer status` | — | Show your timer status, fire count, next ping |

**Behavior:** the bot mentions you every `interval` in the channel where you ran `/timer set`. Each tick auto-deletes after 30s — you keep the ping notification, the channel stays clean.

**Limits:** min 60s, max 24h, one timer per user.

---

## 🔧 Admin

All admin commands require Administrator permission.

### Setup
| Command | Args | Description |
|---|---|---|
| `/setup` | `type` | Post + pin a panel in the current channel. Types: `defense`, `resources`, `intel`, `general` |

### Configuration
| Command | Args | Description |
|---|---|---|
| `/admin set-server` | `url` | Update Travian server URL (no restart needed) |

### Map data
| Command | Description |
|---|---|
| `/admin fetch-map` | Manually trigger `map.sql` fetch |
| `/admin map-status` | Last fetch time, total villages, top 5 alliances |

### Round / data management
| Command | Description |
|---|---|
| `/admin reset-round` | Wipe map data + calls + pledges (keeps user profiles) |
| `/admin db-vacuum` | Compact the database file |
| `/admin backup-now` | Run a database backup immediately |

### Diagnostics
| Command | Args | Description |
|---|---|---|
| `/admin diag` | — | Bot uptime, RAM usage, DB size, open call count, last error |
| `/admin tail-log` | `[lines]` | Last N log lines (default 50, max 200; redacts lines with `token`/`password`/`secret`/`api_key`) |

---

## Background Jobs

Run automatically — no user action needed.

| Job | Schedule | Description |
|---|---|---|
| Map fetch | `0 6 * * *` (06:00 daily) | Pulls `map.sql` from Travian, parses, refreshes `x_world` |
| Call expiry | `*/5 * * * *` (every 5 min) | Marks open calls past deadline as `expired`, refreshes embeds |
| Timer ticks | `*/10 * * * * *` (every 10 sec) | Fires due timers, auto-deletes the message after 30s |
| Backup | `0 3 * * *` (03:00 daily) | Copies `data/travian.db` to `data/backups/`, retains last 7 |
| Log rotation | At first log call past midnight | Renames yesterday's log to `bot-YYYY-MM-DD.log`, keeps last 14 days |

---

## HTTP Endpoints

Health server runs on port `8080` (configurable via `HEALTH_PORT`), bound to `127.0.0.1` inside Docker.

| Endpoint | Description |
|---|---|
| `GET /health` | `200 {"status":"ok",...}` if Discord client is ready, `503` otherwise |
| `GET /metrics` | JSON: uptime, calls created, pledges submitted, map fetches, last error |

---

## Customization (`.env`)

| Variable | Default | Description |
|---|---|---|
| `DISCORD_TOKEN` | — | Bot token (required) |
| `CLIENT_ID` | — | Application ID (required for command deploy) |
| `GUILD_ID` | — | Discord server ID (required for command deploy) |
| `TRAVIAN_SERVER_URL` | — | Travian server URL for map.sql + deep links |
| `MAP_FETCH_HOUR` | `6` | Hour of day to run map fetch (0-23) |
| `BACKUP_HOUR` | `3` | Hour of day to run backup (0-23) |
| `BACKUP_RETAIN_DAYS` | `7` | How many daily backups to keep |
| `LOG_RETAIN_DAYS` | `14` | How many daily log files to keep |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `HEALTH_PORT` | `8080` | HTTP healthcheck port |
| `DEF_ROLE_NAME` | `def-crew` | Role name to ping for defense/reinforce/urgent calls |
| `LOCALE` | `en` | UI language (only `en` shipped) |
| `BOT_FOOTER` | `Travian Alliance Bot` | Footer text on embeds |