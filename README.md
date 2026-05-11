# Travian Alliance Discord Bot

Discord bot for Travian T4.6 alliance coordination. Pinned button panels for resource pushes, defense calls, scouting, and more. Built with discord.js v14 + sql.js (no native deps).

## Features

- **Pinned panels per channel** — separate panels for defense / offense / scout / resources / general
- **Resource push** — pledge tracking, progress bars, auto-fill on delivery
- **Combat calls** — defense, offense, reinforce, urgent (`@def-crew` ping), responder tally, auto-expiry on arrival
- **Scout requests** — inline reports visible to channel
- **map.sql integration** - daily fetch, `/whois <coords>` lookup, and nearby village intel from cached map data
- **Discord/member map sync** - admin scan matches Discord display names to Travian players while ignoring case and symbols
- **User profiles** — IGN, home coords, tribe, opt-in DM notifications, auto-fill in modals
- **Status & leaderboards** — personal dashboard, top pushers / defenders / scouts
- **Personal timer** — recurring channel-mention reminder (auto-deletes after 30s)
- **Slash commands** mirror every panel button for keyboard users
- **Health endpoint + JSON metrics** at `:8080/health` and `:8080/metrics`
- **Daily DB backups**, log rotation, graceful shutdown

## Quick start

```bash
git clone <repo>
cd travian-bot
cp .env.example .env
# fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID
npm install
npm run deploy-commands
npm start
```

Or via Docker:

```bash
cp .env.example .env
docker compose up -d --build
```

## Setup checklist

1. Create the bot at https://discord.com/developers/applications
2. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`, permissions: Send Messages, Manage Messages, Embed Links, Mention Everyone, Read Message History
3. Enable the **Server Members Intent** in the bot settings; `/admin sync-members` needs full member fetch access
4. Invite the bot using that URL
5. Fill `.env` with `DISCORD_TOKEN`, `CLIENT_ID` (Application ID), `GUILD_ID`
6. `npm install && npm run deploy-commands`
7. `npm start` (or `docker compose up -d`)
8. In each channel, run `/setup <defense|offense|scout|resources|general>` to post a pinned panel
9. (Optional) Create a role named `def-crew` so combat calls can ping defenders

## Slash commands

- **Calls:** `/push`, `/defense`, `/offense`, `/reinforce`, `/scout`
- **Lookup:** `/whois`, `/nearby`, `/calls`, `/status`, `/leaderboard`
- **Personal:** `/profile`, `/timer set|stop|status`
- **Admin:** `/setup`, `/admin set-server|reset-round|fetch-map|map-status|sync-members|diag|tail-log|db-vacuum|backup-now`

See [OPS.md](OPS.md) for the admin cheatsheet, [DEPLOY.md](DEPLOY.md) for VPS deployment.

## Project layout

```
src/
  index.js          entry — login, shutdown handlers
  commands/         slash command definitions + admin handlers
  handlers/         per-feature button + modal + slash logic
  panel/            pinned-panel builder + restore
  db/               sql.js shim + schema + idempotent migrations
  jobs/             cron jobs (map fetch, expiry, backup, timer tick)
  server/           health HTTP server
  utils/            shared helpers (coords, time, i18n, metrics, …)
data/               DB + logs + backups (gitignored)
Dockerfile / docker-compose.yml
```

## Stack

- Node 20+, ESM modules
- [discord.js](https://discord.js.org/) v14
- [sql.js](https://sql.js.org/) — pure-JS SQLite, no native build required
- [node-cron](https://github.com/node-cron/node-cron)

## Contributing

PRs welcome. Keep it minimal and focused — no new dependencies without a clear reason.

## License

MIT — see [LICENSE](LICENSE).
