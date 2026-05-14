# Discord Translation Command — Design Spec

**Date:** 2026-05-14
**Status:** Approved (pending implementation plan)

## Goal

Give a multi-national Discord alliance the ability to translate messages on demand, cheaply. Optimize for zero or near-zero monthly cost at the bot's scale (alliance-sized server, ad-hoc translation needs).

## Non-goals

- Auto-translating every message in a channel
- Bridging two channels in different languages
- Per-user stored language preferences (Discord locale is good enough)
- Flag-reaction triggers (deferred; can be added later without rework)
- Translating attachments, embeds, or non-text content

## User-facing surface

### Entry points

1. **Message context menu — "Translate"**
   - User right-clicks any message → Apps → Translate
   - Reads text from `interaction.targetMessage.content`
   - No arguments; target language = `interaction.locale`
   - Reply is ephemeral (only the requester sees it)

2. **Slash command — `/translate text:<text> [to:<lang>]`**
   - `text` (required): arbitrary text to translate
   - `to` (optional): target language picker, choices from the supported language list
   - If `to` omitted, target = `interaction.locale`
   - Reply is ephemeral

### Supported languages (initial set)

EN, DE, FR, ES, RU, BG, PL, IT, NL, PT (10 languages). All available on DeepL Free. Easy to add more by editing `src/utils/translation/locales.js`.

### Locale resolution

Target language resolves in this order:
1. Explicit `to:` argument (slash command only)
2. `interaction.locale` mapped to DeepL code via `locales.js`
3. Fallback to `EN`, with a note in the reply: *"Your locale `<x>` isn't supported — showing English. Use `/translate to:de` to pick another."*

### Reply format

Ephemeral embed:

```
🌐 Translation
─────────────────────
<source text>
─────────────────────
<translated text>

🇷🇺 RU → 🇩🇪 DE · cached
```

The `· cached` suffix appears only on cache hits. Source language is whatever DeepL auto-detected.

## Architecture

Six files in total — four new, two edited. Five carry translation responsibilities (table below); the router edit is a single dispatch branch.

```
src/
├── commands/
│   └── definitions.js          [EDIT]
├── handlers/
│   ├── router.js               [EDIT]
│   └── translate.js            [NEW]
└── utils/translation/
    ├── deepl.js                [NEW]
    ├── cache.js                [NEW]
    └── locales.js              [NEW]
```

### Module responsibilities

| Module | Knows | Doesn't know |
|---|---|---|
| `deepl.js` | API key, endpoint, request/response shape, error mapping | Discord, caching, rate limits |
| `cache.js` | LRU eviction, key/value storage | What's being cached or by whom |
| `locales.js` | Supported language list, Discord-locale ↔ DeepL-code mapping | API or Discord internals |
| `translate.js` | Interaction handling, ephemeral replies, orchestration, rate limiting | DeepL request shape, cache internals |
| `definitions.js` | Discord command schemas | Translation logic |

### Configuration

One new environment variable:
- `DEEPL_API_KEY` — DeepL Free API key

**Startup:** if the variable is missing, log one `warn` line at boot (`"DEEPL_API_KEY not set — /translate will be disabled"`). The bot still starts; other features are unaffected.

**At handler invocation:** the translate handler reads `process.env.DEEPL_API_KEY` once at module load. If empty, every invocation responds ephemerally with *"Translation isn't configured on this server. Ask an admin to set it up."* — no per-invocation log spam, no DeepL request attempted.

### Interaction routing

[src/handlers/router.js](../../../src/handlers/router.js) currently dispatches by interaction type and command name. Two new branches:

```js
if (interaction.isChatInputCommand() && interaction.commandName === 'translate') {
  return handleTranslate(interaction, { source: 'slash' });
}
if (interaction.isMessageContextMenuCommand() && interaction.commandName === 'Translate') {
  return handleTranslate(interaction, { source: 'contextMenu' });
}
```

Both paths share the same handler. Source attribution is passed through so the handler reads `text` from the right place.

### Command registration

[src/commands/definitions.js](../../../src/commands/definitions.js) adds two builders:

- `SlashCommandBuilder` for `/translate` with `text` (string, required) and `to` (string with choices from supported langs, optional)
- `ContextMenuCommandBuilder` with name `"Translate"` and type `ApplicationCommandType.Message`

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

Implementation: ~30 lines, no dependency. Backed by a `Map` plus a doubly-linked-list style access order, or simpler: re-insert on access to move to end (Map preserves insertion order), drop oldest on overflow.

## Rate limiting

Per-user, sliding 60-second window, cap **10 translations/min**.

- In-handler `Map<userId, number[]>` of recent invocation timestamps
- On each call: drop timestamps older than 60s, count remaining, accept or reject
- ~15 lines; lives in `handlers/translate.js`

If hit, reply: *"You've hit the translation limit (10/min). Try again in `<X>`s."*

## Data flow

### Slash command

```
1. User runs /translate text:"Привет всем" [to:de]
2. router.js → handlers/translate.js
3. interaction.deferReply({ ephemeral: true })
4. Resolve target lang (explicit > locale > EN fallback)
5. Validate: text non-empty, ≤ 5000 chars
6. Rate-limit check
7. Cache lookup
     HIT  → use cached result
     MISS → deepl.translate() → store in cache
8. interaction.editReply(embed)
```

### Context menu

Identical to slash, except step 1 is "right-click message → Apps → Translate" and step 4 has no explicit `to:` to consider. If `interaction.targetMessage.content` is empty (image-only, embed-only), reply: *"Nothing to translate."*

## Error handling

Every failure has a defined ephemeral user message. No stack traces leak.

| Failure | User sees | Log level |
|---|---|---|
| `DEEPL_API_KEY` missing | "Translation isn't configured on this server. Ask an admin to set it up." | `warn` once at startup |
| Rate limit hit | "You've hit the translation limit (10/min). Try again in `<X>`s." | `debug` |
| Text too long (>5000) | "Text too long (max 5000 chars). Try splitting it." | — |
| Empty / whitespace input | "Nothing to translate." | — |
| Unsupported `to:` | N/A — Discord enforces choices | — |
| Unsupported `interaction.locale` | Falls back to EN, includes note in reply | — |
| DeepL 403 (bad key) | "Translation service rejected the request. Ask an admin to check the API key." | `error` |
| DeepL 456 (quota exceeded) | "Monthly translation quota reached. Resets on the 1st." | `warn` |
| DeepL 5xx / network timeout | "Translation service is down. Try again in a moment." | `error` |
| Uncaught | "Translation failed. Try again." | `error` with full stack |

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

If quota is ever exceeded, the bot surfaces the error to users; no automatic fallback to another provider.

## Testing

Test runner: `node --test` (already used; [package.json:12](../../../package.json#L12)).

| Test file | Covers |
|---|---|
| `test/translation/locales.test.js` | `en-US → EN-US`, `pt-BR → PT-BR`, unsupported `ja` → `null`, all supported langs round-trip |
| `test/translation/cache.test.js` | hit, miss, eviction at 500 entries, LRU order under access |
| `test/translation/deepl.test.js` | success parsing, 403/456/5xx → typed errors, timeout via `AbortSignal`, request body shape (fetch mocked) |
| `test/handlers/translate.test.js` | rate limit sliding window, empty input, oversize input, cache hit vs miss path, fallback to EN, error → ephemeral reply |
| `test/handlers/translate.contextMenu.test.js` | context menu reads `targetMessage.content`, empty message → "Nothing to translate." |

**Explicitly not tested:**
- Discord.js internals (mocked at boundary)
- DeepL translation quality
- `definitions.js` schemas (Discord validates at registration)

**Test doubles:** hand-rolled fakes via node's built-in `mock.fn()`. No external mock library — none currently in the project.

**Rate limiter test:** uses `mock.timers` to advance the clock; the 60s window test runs in <1ms.

**Coverage target:** every error branch in the matrix above hit by at least one test. No coverage tooling.

## Out of scope (deferred, easy to add later)

- Flag-reaction trigger (`react with 🇩🇪 → bot translates`). Re-uses the same handler + cache. Add when there's demand.
- Auto-translate bridge channel. Significantly higher cost; would need char-budget tracking.
- Per-user stored language preference. Adds a `user_locale_prefs` table; not needed until someone asks for it.
- SQLite-backed persistent cache. Promote from in-memory if metrics show same-text-translated-days-apart hit pattern.
- Glossary / custom terminology (DeepL supports this; not needed for casual chat).

## Open questions

None. All design decisions made during brainstorming.
