# Discord Translation Command — Design Spec

**Date:** 2026-05-14
**Status:** Approved (pending implementation plan)

## Goal

Give a multi-national Discord alliance the ability to translate messages on demand, cheaply. Optimize for zero or near-zero monthly cost at the bot's scale (alliance-sized server, ad-hoc translation needs).

## Non-goals

- Auto-translating every message in a channel
- Bridging two channels in different languages
- Per-user stored language preferences (Discord locale is good enough)
- Translating attachments, embeds, or non-text content
- Message context menu trigger (intentionally omitted in favour of flag reactions; see Rationale below)

## Rationale: reactions over context menu

In a multi-national alliance, the common pattern is "one message in language X, several people want it in their language." A context menu produces N private replies for N people — each user clicks through `Apps → Translate`, each receives an ephemeral copy, none of those translations enter the conversation. Flag reactions invert this: one click posts a single shared translation that everyone reading the channel benefits from, and translations live as part of the thread for later reference.

The context menu is dropped, not deferred. Reactions cover the same need with better UX.

## User-facing surface

### Entry points

1. **Flag reaction on any message** (primary path)
   - User adds a flag emoji reaction (e.g. 🇬🇧) to any channel message
   - Bot posts the translation as a regular message inside a thread under that message
   - Translation is visible to everyone with access to the channel
   - Works on any message: from humans, from the bot itself, from other bots

2. **Slash command — `/translate text:<text> [to:<lang>]`** (for translating text you're writing fresh)
   - `text` (required): arbitrary text to translate
   - `to` (optional): target language picker, choices from the supported language list
   - If `to` omitted, target = `interaction.locale`
   - Reply is **ephemeral** (only the requester sees it)

### Supported languages and flag mapping

10 languages, all on DeepL Free. Easy to add more by editing `src/utils/translation/locales.js`.

| Flag | DeepL code | Notes |
|---|---|---|
| 🇬🇧 | `EN-GB` | British English |
| 🇺🇸 | `EN-US` | American English (alias — same source produces near-identical output) |
| 🇩🇪 | `DE` | |
| 🇫🇷 | `FR` | |
| 🇪🇸 | `ES` | |
| 🇷🇺 | `RU` | |
| 🇧🇬 | `BG` | |
| 🇵🇱 | `PL` | |
| 🇮🇹 | `IT` | |
| 🇳🇱 | `NL` | |
| 🇵🇹 | `PT-PT` | European Portuguese |
| 🇧🇷 | `PT-BR` | Brazilian Portuguese (alias) |

Unknown flag reactions are silently ignored.

### Locale resolution (slash command only)

Target language resolves in this order:
1. Explicit `to:` argument
2. `interaction.locale` mapped to DeepL code via `locales.js`
3. Fallback to `EN-GB`, with a note in the reply: *"Your locale `<x>` isn't supported — showing English. Use `/translate to:de` to pick another."*

### Reply formats

**Slash command — ephemeral embed:**

```
🌐 Translation
─────────────────────
<source text>
─────────────────────
<translated text>

🇷🇺 RU → 🇩🇪 DE · cached
```

The `· cached` suffix appears only on cache hits. Source language is whatever DeepL auto-detected.

**Reaction — message inside the thread:**

```
🇩🇪 DE (from RU)
─────────────────────
<translated text>

Triggered by @Alice · cached
```

No source text repeated (the original message is the parent of the thread; quoting it would be noise). `Triggered by @Alice` credits the user who reacted, so others know who asked. `· cached` only appears on cache hits.

## Architecture

Eight files in total — five new, three edited.

```
src/
├── commands/
│   └── definitions.js              [EDIT]
├── handlers/
│   ├── router.js                   [EDIT]
│   ├── translate.js                [NEW] slash command handler
│   └── translateReaction.js        [NEW] flag-reaction handler
├── index.js                        [EDIT] add messageReactionAdd listener
└── utils/translation/
    ├── deepl.js                    [NEW]
    ├── cache.js                    [NEW]
    └── locales.js                  [NEW] languages + locale map + flag→code map
```

### Module responsibilities

| Module | Knows | Doesn't know |
|---|---|---|
| `deepl.js` | API key, endpoint, request/response shape, error mapping | Discord, caching, rate limits |
| `cache.js` | LRU eviction, key/value storage | What's being cached or by whom |
| `locales.js` | Supported languages, Discord-locale ↔ DeepL-code map, flag-emoji ↔ DeepL-code map | API or Discord internals |
| `translate.js` | Slash interaction, ephemeral replies, rate limiting, orchestration | DeepL request shape, cache internals, reactions |
| `translateReaction.js` | Reaction events, thread management, dedup, orchestration | DeepL request shape, cache internals, slash commands |
| `definitions.js` | Slash command schema | Translation logic |
| `index.js` (edit) | Wiring the reaction event listener | Translation logic (delegates) |

Both handlers share a single rate-limit `Map<userId, timestamps[]>` via a small helper exported from one of the two files (cleanest: put it in `translateReaction.js` and import from `translate.js`, or vice versa — minor implementation detail).

### Configuration

One new environment variable:
- `DEEPL_API_KEY` — DeepL Free API key

**Startup:** if the variable is missing, log one `warn` line at boot (`"DEEPL_API_KEY not set — /translate and flag-reaction translation will be disabled"`). The bot still starts; other features are unaffected.

**At runtime:** both handlers check `process.env.DEEPL_API_KEY` once at module load. If empty:
- Slash command responds ephemerally with *"Translation isn't configured on this server. Ask an admin to set it up."*
- Reaction handler silently ignores flag reactions (no error reply — would be public spam)

### Discord intents and permissions

**Intents (added to client in [src/index.js](../../../src/index.js)):**
- `GuildMessageReactions` — receive `messageReactionAdd` events
- `GuildMessages` and `MessageContent` — already required for other features; reused

**Permissions the bot needs in channels where translation should work:**
- `ViewChannel`, `SendMessages` (already needed)
- `ReadMessageHistory` — to fetch the message a reaction was added to
- `CreatePublicThreads` — to start a translation thread on a message that doesn't have one
- `SendMessagesInThreads` — to post the translation
- `AddReactions` — not needed (the bot reads reactions, doesn't add them)

If any permission is missing in a channel, the reaction handler logs a `warn` and exits silently — no user-visible error.

### Interaction routing

Slash command added to [src/handlers/router.js](../../../src/handlers/router.js):

```js
if (interaction.isChatInputCommand() && interaction.commandName === 'translate') {
  return handleTranslate(interaction);
}
```

Context menu branch is **not** added.

### Reaction listener

In [src/index.js](../../../src/index.js), one new event handler:

```js
client.on('messageReactionAdd', (reaction, user) => {
  if (user.bot) return;
  return handleTranslateReaction(reaction, user).catch(err => logger.error(...));
});
```

The handler unwraps partial reactions/messages if needed (Discord delivers partials for old messages), then runs the reaction flow described below.

### Command registration

[src/commands/definitions.js](../../../src/commands/definitions.js) adds one builder:

- `SlashCommandBuilder` for `/translate` with `text` (string, required) and `to` (string with choices from supported langs, optional)

No `ContextMenuCommandBuilder`.

## Caching

**In-memory LRU. No persistence.**

| Aspect | Decision |
|---|---|
| Key | `` `${targetLang}:${sourceText}` `` |
| Value | `{ translation, detectedSourceLang }` |
| Capacity | 500 entries |
| Eviction | LRU |
| TTL | None — translations are deterministic |
| Persistence | None — lost on restart |
| Skip cache when | Text > 5000 chars, or empty/whitespace input |
| Don't cache | Failed API responses |

Rationale: hits cluster in time (one announcement read by several users within an hour). In-memory captures ~90% of the value of a DB cache with ~5% of the code. Can promote to SQLite later if usage shows we'd benefit.

Implementation: ~30 lines, no dependency. Backed by a `Map`; re-insert on access to move to end (Map preserves insertion order), drop oldest on overflow.

## Dedup (reaction path only)

**Goal:** never post two translations of the same message in the same target language in the same thread.

**Two-layer approach:**

1. **In-memory dedup set** — `Set<"${messageId}:${targetLang}">`, capped 1000 entries (FIFO eviction). Populated when the bot posts a translation. Checked at the start of every reaction event. Handles the burst case (Alice and Bob both react 🇬🇧 within seconds — the second one is rejected before any work is done).

2. **Thread message scan** — if the message ID isn't in the dedup set (e.g. bot restarted, or entry evicted), the handler fetches the last 100 messages from the existing thread (if any) and checks for a bot message whose embed title starts with the target flag/code. If found, the reaction is treated as a duplicate and skipped. This adds one `thread.messages.fetch({ limit: 100 })` per "uncertain" reaction — cheap, no quota impact.

After posting a translation, the in-memory set is updated so subsequent reactions on the same message hit the fast path.

The translation cache (separate from the dedup set) still saves the API call cost if the same text appears in two different messages — the dedup set only prevents posting *to the same thread*.

## Rate limiting

Per-user, sliding 60-second window, cap **10 translations/min**, shared bucket across both entry points (slash + reaction).

- `Map<userId, number[]>` of recent invocation timestamps
- On each call: drop timestamps older than 60s, count remaining, accept or reject
- ~15 lines; lives in one of the two handler files, imported by the other

**On hit:**
- Slash path: reply ephemerally *"You've hit the translation limit (10/min). Try again in `<X>`s."*
- Reaction path: log debug and exit silently (no public reply for a private rate limit)

## Threads

### Creation and reuse

- If the parent message already has a thread (`message.thread` is non-null) → post the translation in that thread
- Otherwise → call `message.startThread({ name: '🌐 Translations', autoArchiveDuration: 60 })`, then post the translation
- Thread name is always `🌐 Translations` for consistency and discoverability

### Auto-archive

`autoArchiveDuration: 60` (1 hour). Discord only supports `60 / 1440 / 4320 / 10080` minutes; 1 hour is the closest match to the user's preferred 2 hours. The downside (thread visually collapses sooner) is small because **archive doesn't disable functionality**: posting a new translation auto-unarchives the thread, so flag reactions work identically at hour 5 and day 5 — only the active-threads sidebar visibility differs.

### Reaction on a message already inside a thread

Discord doesn't allow nested threads. The handler posts the translation as a regular reply inside the same thread that contains the parent message (no new thread created, no `startThread` call).

### Edge cases

- **Empty content message** (image-only, embed-only): reaction silently ignored (debug log)
- **Bot message**: translate normally
- **System message** (member joined, boost, etc.): silently ignored — no `.content`
- **Reaction removal**: no-op (translation stays in the thread)
- **Same user reacts with multiple different flags**: each unique `(messageId, targetLang)` produces one translation; same flag again is dedup'd

## Data flow

### Slash command

```
1. User runs /translate text:"Привет всем" [to:de]
2. router.js → handlers/translate.js
3. interaction.deferReply({ ephemeral: true })
4. Resolve target lang (explicit > locale > EN-GB fallback)
5. Validate: text non-empty, ≤ 5000 chars
6. Rate-limit check (shared bucket)
7. Cache lookup
     HIT  → use cached result
     MISS → deepl.translate() → store in cache
8. interaction.editReply(embed)
```

### Reaction

```
1. User adds 🇩🇪 to a message
2. client.messageReactionAdd → handlers/translateReaction.js
3. Resolve partial reaction/message if needed (fetch)
4. Map flag → target lang
     unknown flag → exit silently
5. Validate: parent message has non-empty .content
     empty → exit silently (debug log)
6. Dedup check
     in-memory set hit → exit silently
     miss → fetch thread (if exists), scan last 100 messages for existing translation
     thread-scan hit → add to dedup set, exit silently
7. Permission check (CreatePublicThreads / SendMessagesInThreads)
     missing → warn log, exit silently
8. Rate-limit check (shared bucket)
     hit → debug log, exit silently
9. Translate: cache lookup → deepl.translate() if miss → store
10. Ensure thread:
     parent message's channel is already a thread (reaction was on a message inside an existing thread) → reply in that same thread, no new thread created
     parent message has an attached thread (message.thread is non-null) → reply in that attached thread
     else → message.startThread({ name: '🌐 Translations', autoArchiveDuration: 60 }) and reply in the new thread
11. Post embed in thread
12. Add (messageId, targetLang) to in-memory dedup set
```

## Error handling

| Failure | User sees | Log level |
|---|---|---|
| `DEEPL_API_KEY` missing (slash) | "Translation isn't configured on this server. Ask an admin to set it up." | `warn` once at startup |
| `DEEPL_API_KEY` missing (reaction) | Silent | `warn` once at startup only |
| Rate limit hit (slash) | "You've hit the translation limit (10/min). Try again in `<X>`s." | `debug` |
| Rate limit hit (reaction) | Silent | `debug` |
| Text too long (>5000) — slash | "Text too long (max 5000 chars). Try splitting it." | — |
| Text too long (>5000) — reaction | Silent | `debug` |
| Empty / whitespace input | Silent (reaction) / "Nothing to translate." (slash) | — |
| Unsupported `to:` | N/A — Discord enforces choices | — |
| Unsupported `interaction.locale` (slash) | Falls back to EN-GB, includes note in reply | — |
| Unknown flag reaction | Silent | — |
| Missing channel permission (reaction) | Silent | `warn` |
| DeepL 403 (bad key) — slash | "Translation service rejected the request. Ask an admin to check the API key." | `error` |
| DeepL 403 (bad key) — reaction | Silent | `error` |
| DeepL 456 (quota exceeded) — slash | "Monthly translation quota reached. Resets on the 1st." | `warn` |
| DeepL 456 (quota exceeded) — reaction | Silent | `warn` |
| DeepL 5xx / network timeout — slash | "Translation service is down. Try again in a moment." | `error` |
| DeepL 5xx / network timeout — reaction | Silent | `error` |
| Uncaught — slash | "Translation failed. Try again." | `error` with full stack |
| Uncaught — reaction | Silent | `error` with full stack |

**Principle:** the reaction path never posts an error message into the channel. The user requested a quiet translation; failing loudly with red embeds would be worse than no reply at all. The slash path is private and explicit, so it surfaces errors.

**Timeouts:** DeepL call wrapped in `AbortSignal.timeout(8000)`.

**Retries:** none. Re-invocation by the user is clearer and cheaper than silent loops that eat quota.

## Provider choice

**DeepL Free API.**

- 500,000 chars/month free
- Hard-stops at the limit instead of billing (matches "we target cheapness")
- Best-in-class quality for the supported European language set
- Single HTTP endpoint, simple JSON, no SDK needed

Endpoint: `https://api-free.deepl.com/v2/translate`
Auth header: `Authorization: DeepL-Auth-Key <key>`

If quota is ever exceeded, the bot surfaces the error to slash users and silently no-ops on reactions; no automatic fallback to another provider.

## Testing

Test runner: `node --test` (already used; [package.json:12](../../../package.json#L12)).

| Test file | Covers |
|---|---|
| `test/translation/locales.test.js` | `en-US → EN-US`, `pt-BR → PT-BR`, unsupported `ja` → `null`, 🇩🇪 → `DE`, 🇧🇷 → `PT-BR`, all supported langs round-trip |
| `test/translation/cache.test.js` | hit, miss, eviction at 500 entries, LRU order under access |
| `test/translation/deepl.test.js` | success parsing, 403/456/5xx → typed errors, timeout via `AbortSignal`, request body shape (fetch mocked) |
| `test/handlers/translate.test.js` | rate limit sliding window, empty input, oversize input, cache hit vs miss path, fallback to EN-GB, error → ephemeral reply |
| `test/handlers/translateReaction.test.js` | flag mapping, unknown-flag silent ignore, empty-content ignore, missing-permission silent exit, rate limit silent, cache hit/miss path, thread reuse vs create, in-memory dedup, thread-scan dedup |

**Explicitly not tested:**
- Discord.js internals (mocked at boundary)
- DeepL translation quality
- `definitions.js` schemas (Discord validates at registration)
- Actual thread creation against real Discord (mocked)

**Test doubles:** hand-rolled fakes via node's built-in `mock.fn()`. No external mock library.

**Rate limiter test:** uses `mock.timers` to advance the clock; the 60s window test runs in <1ms.

**Coverage target:** every error branch in the matrix above hit by at least one test. No coverage tooling.

## Out of scope (deferred, easy to add later)

- Message context menu trigger. Dropped (not deferred) — reactions cover the same need better
- Auto-translate bridge channel. Significantly higher cost; would need char-budget tracking
- Per-user stored language preference. Adds a `user_locale_prefs` table; not needed until someone asks for it
- SQLite-backed persistent cache. Promote from in-memory if metrics show same-text-translated-days-apart hit pattern
- SQLite-backed dedup (survives restarts). Promote if duplicate translations after restarts become a real complaint
- Glossary / custom terminology (DeepL supports this; not needed for casual chat)
- More flag aliases per language (🇦🇹 → DE, 🇲🇽 → ES, etc.)

## Open questions

None. All design decisions made during brainstorming.
