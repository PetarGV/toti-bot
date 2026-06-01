# Def-Call Time Picker & Parser Rewrite — Design Spec

**Date:** 2026-06-01
**Status:** Approved (pending user review of spec doc)
**Scope:** Replace the free-text `arrival` field in the def-call creation modals with a two-page ephemeral select-menu picker; rewrite `parseDeadline` to be UTC-correct and accept a broad set of input formats; add autocomplete to `/active-def arrival:`.

## Motivation

Two problems, one feature:

1. **UX**: the create-def-call modal asks coords/troops/notes plus a free-text "Impact time (UTC)" field. Typing `14:30:45` or `2026-06-01 10:00:01` is friction-heavy on mobile and unforgiving of format mistakes. Users want click-driven time entry.
2. **Correctness bug**: `process.env.TZ = 'UTC'` in `src/index.js` is a no-op on most Node runtimes (TZ is sampled at process startup, runtime mutation is ignored). The bot runs in host-local TZ. `parseDeadline` then constructs Dates via `new Date(y, m-1, d, h, min, s)` which interprets components as host-local. Result: a user types `2026-06-01 10:00:01` expecting UTC, the bot stores 07:00:01 UTC (Sofia → UTC), and viewers in other timezones see wrong impact times.

## Relationship to existing pickers

[src/handlers/combat.js:535](src/handlers/combat.js#L535) already defines a `combat:newpick:*` customID namespace for an existing "Pick time" feature that **edits the deadline of an open call** (date/hour/5-min select → seconds modal). That flow is unrelated to this spec and stays unchanged. To avoid collision, this spec uses the `combat:newpick:*` customID namespace exclusively.

## Decisions Summary

- **Two-page picker** (Discord 5-row limit forces it for seconds-precision).
- **Date range**: Today / Tomorrow / Day after (UTC).
- **Precision**: full HH:MM:SS via split tens/ones selects.
- **"Type instead" escape hatch** on page 1 — opens a text-input modal, runs the rewritten parser.
- **Escalation pre-fill**: selects start empty; report's `first_eta` shown as a hint in the page header.
- **Slash command** `/active-def arrival:` keeps free-text but gains autocomplete suggestions.
- **Parser rewrite**: adopt `chrono-node`, anchor to UTC explicitly via `Date.UTC(...)`, accept ISO 8601 / Discord tags / `+2h30m` / natural language.
- **Remove** the broken `process.env.TZ = 'UTC'` line — parser is UTC-correct by construction.
- **`def_perma` is untouched** — no deadline, no picker.

## User Flow

### Entry points

1. **Panel button** (`combat:def_active`)
   → modal `combat:create_def:def_active` asks coords / troops / notes (no arrival)
   → on submit, reply ephemerally with picker page 1.
2. **Report escalation button** (`report:escalate_active:<reportId>`)
   → modal `combat:create_def_from_report:def_active:<reportId>` with coords pre-filled from `report.defender_x/y`
   → on submit, reply ephemerally with picker page 1; header shows `Report ETA: <first_eta UTC> — pick impact time` as a non-selecting hint.
3. **Slash command** `/active-def`
   → unchanged structurally; the `arrival` option gains autocomplete suggestions.

### Picker page 1 layout (5 rows)

```
Header: "Pick impact time (UTC) — currently: ____-__-__ __:__:__"
        (escalation variant: "Report ETA: 2026-06-02 14:30:45 UTC — pick impact time")

Row 1: [▼ Date    : Today / Tomorrow / Day after  ]
Row 2: [▼ Hour    : 00 … 23                       ]
Row 3: [▼ Min 10s : 0 1 2 3 4 5                   ]
Row 4: [▼ Min 1s  : 0 1 2 3 4 5 6 7 8 9           ]
Row 5: [⌨️ Type instead] [Next →]
```

Header re-renders on every select change (via `interaction.update()`) so the user sees the time forming. Unpicked slots render as underscores; partial example: after picking Date=Today + Hour=14, header shows `2026-06-01 14:__:__`. Nothing pre-selected on open (including escalation path).

### Picker page 2 layout (3 rows)

```
Header: "Seconds (UTC) — currently: 2026-06-02 14:30:__"

Row 1: [▼ Sec 10s : 0 1 2 3 4 5                   ]
Row 2: [▼ Sec 1s  : 0 1 2 3 4 5 6 7 8 9           ]
Row 3: [← Back] [✅ Create call]
```

Reaching page 2 without picking sec-tens/sec-ones is allowed — Create defaults them to `0`/`0` (i.e. `:00`). Back returns to page 1 preserving picked values.

### "Type instead" modal

Single text field "Impact time (UTC)", uses the rewritten `parseDeadline`. On valid parse, skips the picker entirely and creates the call. On null parse, replies ephemerally with an error; the user re-clicks "Type instead" to retry.

### Cancellation / abandonment

User can dismiss the ephemeral. State entry lingers in the in-memory map until the TTL janitor reaps it (≤ 16 minutes). No DB persistence.

## State Management & Custom-ID Scheme

### Why in-memory state, not customID encoding

CustomIDs are 100-char max, ASCII-safe. `notes` is up to 500 chars with arbitrary characters. There is no robust way to encode `{type, coords, troopsNeeded, notes, reportId?, picked components}` into customIDs across multiple components. Splitting state across component customIDs is fragile to partial updates.

### Why not DB persistence

The picker's lifetime is bounded by Discord's interaction-token TTL (15 minutes). A bot restart mid-pick is rare and the recovery is "user retries the call from scratch". Avoiding a DB migration + cleanup job for transient data is preferable.

### State map

New file `src/handlers/defCallPicker.js`:

```js
const pickerState = new Map();
// key: ephemeral message ID
// value: { type, x, y, troopsNeeded, notes, reportId, date, hour, mt, mo, st, so, createdAt }

const TTL_MS = 16 * 60 * 1000;   // slightly above Discord's 15-min token window

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pickerState) if (now - v.createdAt > TTL_MS) pickerState.delete(k);
}, 60_000).unref();
```

`msgId` is obtained from the first `interaction.reply({ ..., fetchReply: true })` (discord.js 14.14.1 supports this). All subsequent component customIDs bake `msgId` in so the handler can look up state.

### CustomID scheme

```
combat:newpick:date:<msgId>                    string-select  value = '0' | '1' | '2'
combat:newpick:hour:<msgId>                    string-select  value = '0'..'23'
combat:newpick:mt:<msgId>                      string-select  value = '0'..'5'
combat:newpick:mo:<msgId>                      string-select  value = '0'..'9'
combat:newpick:st:<msgId>                      string-select  value = '0'..'5'
combat:newpick:so:<msgId>                      string-select  value = '0'..'9'
combat:newpick:type_instead:<msgId>            button
combat:newpick:next:<msgId>                    button
combat:newpick:back:<msgId>                    button
combat:newpick:create:<msgId>                  button
combat:newpick:type_instead_submit:<msgId>     modal submit
```

All stay well under 100 chars (Discord snowflake IDs are 19 chars; total ≤ ~50 chars).

### Router additions (`src/handlers/router.js`)

The router has three relevant entry points: `routeButton` (handles button clicks), `routeSelect` (handles string-select changes), `routeModal` (handles modal submits). Adds in each:

```js
// routeButton — for button-style customIDs
if (id.startsWith('combat:newpick:type_instead:')) return handlePickerTypeInsteadButton(interaction);
if (id.startsWith('combat:newpick:next:'))         return handlePickerNextButton(interaction);
if (id.startsWith('combat:newpick:back:'))         return handlePickerBackButton(interaction);
if (id.startsWith('combat:newpick:create:'))       return handlePickerCreateButton(interaction);

// routeSelect — for the six string-select components
if (id.startsWith('combat:newpick:date:') || id.startsWith('combat:newpick:hour:') ||
    id.startsWith('combat:newpick:mt:')   || id.startsWith('combat:newpick:mo:')   ||
    id.startsWith('combat:newpick:st:')   || id.startsWith('combat:newpick:so:')) {
  return handlePickerSelect(interaction);
}

// routeModal — for the "Type instead" text modal submit
if (id.startsWith('combat:newpick:type_instead_submit:')) return handlePickerTypeInsteadSubmit(interaction);
```

Autocomplete branch in router (for the slash command) — see §Slash Command Autocomplete.

## Parser Rewrite

### Add dependency

`chrono-node` (MIT, ~50KB minified, zero transitive risk). Added to `package.json` dependencies.

### `src/utils/time.js` rewrite

```js
import * as chrono from 'chrono-node';

export function unixNow() {
  return Math.floor(Date.now() / 1000);
}

export function discordTimestamp(unix, style = 'R') {
  return `<t:${unix}:${style}>`;
}

export function parseDeadline(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // 1. Discord <t:N:?> tag — extract unix seconds directly
  const tag = raw.match(/^<t:(\d{9,11})(?::[tTdDfFR])?>$/);
  if (tag) return parseInt(tag[1], 10);

  // 2. Bare unix seconds (post-2001)
  if (/^\d{9,11}$/.test(raw)) return parseInt(raw, 10);

  // 3. '+2h30m' is shorthand for 'in 2h30m'
  const normalized = raw.replace(/^\+/, 'in ');

  // 4. chrono-node — parses ISO 8601 (with Z/offset), 'YYYY-MM-DD HH:MM:SS',
  //    'in 2h30m', 'tomorrow 14:30', 'next Friday 10am', etc.
  //    timezone: 'UTC' makes chrono interpret tz-less components as UTC.
  //    forwardDate: true rolls ambiguous past times forward.
  const parsed = chrono.parseDate(normalized, new Date(), { timezone: 'UTC', forwardDate: true });
  if (!parsed) return null;
  return Math.floor(parsed.getTime() / 1000);
}

export function formatDeadline(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
```

### Behavioral notes

- **`formatDeadline` is now UTC-correct** (uses `getUTC*`), matching the modal/picker label.
- **`parseDeadline` returns UTC-correct seconds** regardless of host TZ, because every path either (a) reads unix directly, (b) parses ISO with explicit offset, or (c) uses `Date.UTC(...)` from chrono-extracted components.
- **Round-trip stability**: `formatDeadline(parseDeadline(x))` is stable for absolute inputs ≥ 1-second precision.
- **chrono caveats**: natural-language inputs like `today` resolve to today 00:00 UTC, which will be in the past → caller validation catches this (see Edge Cases).

### Remove the broken TZ line

`src/index.js:3` (`process.env.TZ = 'UTC';`) is removed along with its two-line comment. Replacement comment:

```js
// All deadline parsing/formatting is UTC-correct by construction in src/utils/time.js.
// For consistent log timestamps, launch the bot with TZ=UTC in the environment.
```

The README or process supervisor docs SHOULD note "launch with `TZ=UTC` in env for consistent logs" but this is not in scope for this spec.

## Slash Command Autocomplete

Modify `src/commands/definitions.js` for `/active-def`:

```js
.addStringOption(o => o.setName('arrival')
    .setDescription('Impact time (UTC) — type or pick a suggestion')
    .setRequired(true)
    .setAutocomplete(true))
```

New handler `arrivalAutocomplete(interaction)` registered in router's autocomplete branch. Computes up to 8 suggestions on each keystroke:

```js
function arrivalAutocomplete(focusedValue) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmtUtc = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

  const offsets = [
    ['in 30m',  30*60_000],
    ['in 1h',   3_600_000],
    ['in 2h',   2*3_600_000],
    ['in 3h',   3*3_600_000],
    ['in 6h',   6*3_600_000],
    ['in 12h',  12*3_600_000],
    ['in 24h',  24*3_600_000],
  ];
  const suggestions = offsets.map(([label, ms]) => ({
    name: `${label}  →  ${fmtUtc(new Date(now.getTime() + ms))} UTC`,
    value: label,
  }));
  const q = focusedValue?.toLowerCase() ?? '';
  return suggestions.filter(s => !q || s.name.toLowerCase().includes(q)).slice(0, 25);
}
```

`name` is what the user sees in the dropdown (max 100 chars per Discord); `value` is what populates the field if they click it.

## Edge Cases

| Scenario | Behavior |
|---|---|
| Picker reaches page 2 without picking sec-tens/sec-ones | Defaults `:00` on Create |
| Picker reaches Create without picking date/hour/min/m-tens/m-ones | Ephemeral error "Pick date, hour, and minutes first" — page stays open |
| Resulting deadline < now (past) | Ephemeral error "Impact time is in the past" — page stays open |
| Resulting deadline > 7 days out | Allowed; no warning (`def_active` may legitimately stage long calls) |
| Picker state expired (>16 min) on Create | Ephemeral error "Picker session expired — re-open the call" |
| User dismisses ephemeral | State lingers until janitor sweep, then GC'd |
| Bot restart mid-pick | State map empties; next picker click returns "session expired" |
| "Type instead" parser returns null | Ephemeral error; user re-clicks "Type instead" to retry (modal cannot be re-shown over itself) |
| `def_perma` calls | Untouched — modal has no arrival, no picker |
| `/active-def arrival:` with chrono-parsed past time | Validation in `handleActiveDefCommand` rejects (existing path already validates via `parseDeadline` non-null + sanity) |

## Tests

### NEW `tests/parseDeadline.test.js`

- `parseDeadline('2026-06-01 10:00:01')` exactly equals `Date.UTC(2026, 5, 1, 10, 0, 1) / 1000`, regardless of host TZ (test runs `TZ=Europe/Sofia node --test` and `TZ=UTC node --test` and asserts identical output).
- `parseDeadline('2026-06-01T10:00:01Z')` equals the same.
- `parseDeadline('2026-06-01T13:00:01+03:00')` equals the same (`10:00:01 UTC`).
- `parseDeadline('<t:1780308001:T>')` equals `1780308001`.
- `parseDeadline('1780308001')` equals `1780308001`.
- `parseDeadline('+2h30m')` equals `Math.floor(Date.now()/1000) + 2*3600 + 30*60` within 2-second tolerance.
- `parseDeadline('in 1h30m45s')` equals `Math.floor(Date.now()/1000) + 5445` within 2-second tolerance.
- `parseDeadline('tomorrow 14:30')` equals tomorrow 14:30:00 UTC.
- `parseDeadline('garbage input')` returns `null`.
- `formatDeadline(parseDeadline('2026-06-01 10:00:01'))` === `'2026-06-01 10:00:01'`.

### NEW `tests/defCallPicker.test.js`

1. **Modal submit (button path)** replies ephemerally with picker page-1 components (Date / Hour / MinTens / MinOnes selects + TypeInstead/Next buttons).
2. **Each select** updates the in-memory state map and re-renders header.
3. **Next button** with all four page-1 selects picked → renders page 2 (SecTens / SecOnes + Back / Create).
4. **Create with full state** → inserts a `calls` row with correct deadline, posts to channel, edits ephemeral to "✅ Call #N posted".
5. **Create without date/hour/mt/mo picked** → ephemeral error, no DB row inserted.
6. **Create with past deadline** → ephemeral error, no DB row inserted.
7. **State expiry**: manually fast-forward (`pickerState.set(..., {..., createdAt: Date.now() - 17*60*1000})`), then Create returns "session expired".
8. **Type instead** button → opens modal; submit with `'2026-06-01 10:00:01'` creates call with correct deadline.
9. **Escalation path**: page-1 header includes `Report ETA: ...`, no selects pre-selected, `reportId` stored in state.
10. **Escalation Create**: inserts call AND patches `incoming_reports.escalated_call_id`, re-renders report message (existing behavior must be preserved).

### UPDATE `tests/defCallsEscalate.test.js`

- Modal expected components: only `coords` and `troops_needed` and `notes` (no `arrival`).
- After modal submit, expect the picker page-1 response (selects, not a created-call confirmation).

## Files Touched (full inventory)

- **NEW** `src/handlers/defCallPicker.js` — picker state map, TTL janitor, page renderers, all `combat:newpick:*` handlers, `createCallFromPicker(state, deadline)` shared helper.
- **UPDATE** `src/handlers/defCalls.js`
  - Remove `arrival` text input from `handleDefCallButton` and `showEscalateModal`.
  - `handleDefCallCreateModal` and `handleDefCallFromReportModal`: instead of creating the call, build picker state, reply with page 1.
  - Extract `createDefCall({ type, authorId, x, y, deadline, notes, troopsNeeded, sourceReportId, channelId, client })` so the picker's Create handler and "Type instead" submit can share the call-insertion path with the existing `def_perma` modal flow.
- **UPDATE** `src/handlers/router.js` — register `combat:newpick:*` routes for buttons, string-selects, and modal-submit; register `/active-def` autocomplete handler in the autocomplete branch.
- **UPDATE** `src/utils/time.js` — rewrite `parseDeadline`, switch `formatDeadline` to `getUTC*` getters. Keep `unixNow` and `discordTimestamp` as-is.
- **UPDATE** `src/index.js` — remove `process.env.TZ = 'UTC'` and its leading comment; replace with the note in §Parser Rewrite above.
- **UPDATE** `src/commands/definitions.js` — `.setAutocomplete(true)` on `arrival` for `/active-def`.
- **UPDATE** `package.json` — add `chrono-node` to `dependencies`.
- **NEW** `tests/defCallPicker.test.js`
- **NEW** `tests/parseDeadline.test.js`
- **UPDATE** `tests/defCallsEscalate.test.js`

No DB migration. No changes to `def_perma`, scout calls, or any other call type.

## Out of Scope

- Changing process supervision / launcher to inject `TZ=UTC` (documentation note only).
- Calendar surfaces beyond the modal-replacement picker (Discord Scheduled Events, external calendar sync — explicitly considered and deferred).
- Autocomplete for the `arrival` field in any future slash command other than `/active-def`.
- Changing pledge/responder UX or the call embed itself.
