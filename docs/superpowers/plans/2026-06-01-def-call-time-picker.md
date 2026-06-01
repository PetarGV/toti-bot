# Def-Call Time Picker + parseDeadline Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text "arrival" field in the def-call creation modals with a two-page ephemeral select-menu picker; rewrite `parseDeadline` to be UTC-correct and accept a broad set of formats (paste from anywhere, natural language); add autocomplete to `/active-def arrival:`; remove the no-op `process.env.TZ = 'UTC'` line.

**Architecture:** A new file `src/handlers/defCallPicker.js` owns the picker (in-memory state map keyed by the ephemeral message ID, page renderers, all `combat:newpick:*` button/select/modal handlers). The existing `combat:pick:*` namespace (edit-deadline picker on open calls) is untouched. The two def-call creation modals in `defCalls.js` drop their `arrival` field and reply with picker page 1 instead of creating the call directly. Call creation moves to a shared `createDefCall(...)` helper invoked by the picker's "Create" handler and the "Type instead" modal submit. `parseDeadline` adopts `chrono-node` anchored to UTC.

**Tech Stack:** Node.js (ESM), discord.js 14.14.1, sql.js (SQLite), chrono-node (new), node:test + node:assert/strict.

**Spec:** `docs/superpowers/specs/2026-06-01-def-call-time-picker-design.md`

---

## File Structure

**New files:**
- `src/handlers/defCallPicker.js` — picker state map + TTL janitor, page-1/page-2 renderers, all `combat:newpick:*` handlers, shared `createDefCall(...)` helper.
- `tests/parseDeadline.test.js` — exhaustive coverage of the rewritten parser.
- `tests/defCallPicker.test.js` — full picker flow (modal → page 1 → page 2 → create; type-instead; escalation; state expiry).

**Modified files:**
- `src/utils/time.js` — rewrite `parseDeadline`, fix `formatDeadline` to use UTC getters.
- `src/handlers/defCalls.js` — strip `arrival` from both modals; modal-submit handlers reply with picker page 1 instead of creating the call; export `createDefCall(...)` for the picker.
- `src/handlers/router.js` — add `combat:newpick:*` routes in `routeButton`/`routeSelect`/`routeModal`; add new `routeAutocomplete` export and `active-def` arrival autocomplete.
- `src/index.js` — wire `routeAutocomplete`; remove broken `process.env.TZ = 'UTC'` line + comment.
- `src/commands/definitions.js` — `.setAutocomplete(true)` on `/active-def arrival`.
- `package.json` — add `chrono-node` dependency.
- `tests/defCallsEscalate.test.js` — update modal expectations (no `arrival`) and assert picker-page-1 reply.

---

## Task 1: Add chrono-node dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install chrono-node**

Run:
```
npm install chrono-node@^2.7.0
```
Expected: dependency added under `dependencies` in `package.json`, lockfile updated.

- [ ] **Step 2: Smoke-test import**

Run:
```
node -e "import('chrono-node').then(c => console.log(c.parseDate('2026-06-01T10:00:01Z')?.toISOString()))"
```
Expected output:
```
2026-06-01T10:00:01.000Z
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add chrono-node for permissive deadline parsing"
```

---

## Task 2: Rewrite parseDeadline + formatDeadline (TDD)

**Files:**
- Create: `tests/parseDeadline.test.js`
- Modify: `src/utils/time.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/parseDeadline.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeadline, formatDeadline } from '../src/utils/time.js';

test('parseDeadline: YYYY-MM-DD HH:MM:SS is UTC-correct', () => {
  const got = parseDeadline('2030-06-01 10:00:01');
  const want = Date.UTC(2030, 5, 1, 10, 0, 1) / 1000;
  assert.equal(got, want);
});

test('parseDeadline: ISO 8601 with Z', () => {
  const got = parseDeadline('2030-06-01T10:00:01Z');
  const want = Date.UTC(2030, 5, 1, 10, 0, 1) / 1000;
  assert.equal(got, want);
});

test('parseDeadline: ISO 8601 with explicit +03:00 offset', () => {
  const got = parseDeadline('2030-06-01T13:00:01+03:00');
  const want = Date.UTC(2030, 5, 1, 10, 0, 1) / 1000;
  assert.equal(got, want);
});

test('parseDeadline: bare unix seconds passes through', () => {
  assert.equal(parseDeadline('1900000000'), 1_900_000_000);
});

test('parseDeadline: Discord <t:N:T> tag extracts unix seconds', () => {
  assert.equal(parseDeadline('<t:1900000000:T>'), 1_900_000_000);
  assert.equal(parseDeadline('<t:1900000000>'), 1_900_000_000);
});

test('parseDeadline: relative "in 2h30m"', () => {
  const before = Math.floor(Date.now() / 1000);
  const got = parseDeadline('in 2h30m');
  const after = Math.floor(Date.now() / 1000);
  assert.ok(got >= before + 2 * 3600 + 30 * 60 - 1, `got=${got}, lower=${before + 9000}`);
  assert.ok(got <= after + 2 * 3600 + 30 * 60 + 2, `got=${got}, upper=${after + 9001}`);
});

test('parseDeadline: relative "+2h" is alias for "in 2h"', () => {
  const before = Math.floor(Date.now() / 1000);
  const got = parseDeadline('+2h');
  const after = Math.floor(Date.now() / 1000);
  assert.ok(got >= before + 2 * 3600 - 1);
  assert.ok(got <= after + 2 * 3600 + 2);
});

test('parseDeadline: natural-language "tomorrow 14:30" is UTC', () => {
  const got = parseDeadline('tomorrow 14:30');
  const refUtc = new Date();
  const tomorrowUtc = Date.UTC(refUtc.getUTCFullYear(), refUtc.getUTCMonth(), refUtc.getUTCDate() + 1, 14, 30, 0) / 1000;
  assert.equal(got, tomorrowUtc);
});

test('parseDeadline: empty/whitespace returns null', () => {
  assert.equal(parseDeadline(''), null);
  assert.equal(parseDeadline('   '), null);
  assert.equal(parseDeadline(null), null);
});

test('parseDeadline: completely unparseable returns null', () => {
  assert.equal(parseDeadline('xyzzy not a date'), null);
});

test('formatDeadline: emits UTC components', () => {
  const unix = Date.UTC(2030, 5, 1, 10, 0, 1) / 1000;
  assert.equal(formatDeadline(unix), '2030-06-01 10:00:01');
});

test('formatDeadline: round-trips with parseDeadline', () => {
  const input = '2030-06-01 10:00:01';
  assert.equal(formatDeadline(parseDeadline(input)), input);
});

test('formatDeadline(0/null) returns empty string', () => {
  assert.equal(formatDeadline(0), '');
  assert.equal(formatDeadline(null), '');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```
node --test tests/parseDeadline.test.js
```
Expected: most tests fail. The old parser's `formatDeadline: emits UTC components` will fail on hosts where TZ != UTC because the old code uses `getHours()`. ISO-with-offset tests may fail. The chrono-dependent tests definitely fail (no chrono import yet).

- [ ] **Step 3: Rewrite `src/utils/time.js`**

Replace the entire file contents with:

```js
import * as chrono from 'chrono-node';

export function unixNow() {
  return Math.floor(Date.now() / 1000);
}

export function discordTimestamp(unix, style = 'R') {
  // styles: t=short time, T=long time, d=short date, D=long date,
  //         f=short datetime, F=long datetime, R=relative
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

  // 3. '+2h30m' shorthand for 'in 2h30m'
  const normalized = raw.replace(/^\+/, 'in ');

  // 4. chrono-node — parses ISO 8601 (with Z/offset), 'YYYY-MM-DD HH:MM:SS',
  //    'in 2h30m', 'tomorrow 14:30', etc.
  //    timezone: 'UTC' makes chrono interpret tz-less components as UTC.
  //    forwardDate: true rolls genuinely-ambiguous past times forward
  //    (does not touch explicit dates with year specified).
  const parsed = chrono.parseDate(normalized, new Date(), { timezone: 'UTC', forwardDate: true });
  if (!parsed) return null;
  return Math.floor(parsed.getTime() / 1000);
}

// Format a unix timestamp as "YYYY-MM-DD HH:MM:SS" in UTC
// (round-trips with parseDeadline). Always includes seconds.
export function formatDeadline(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
```

- [ ] **Step 4: Run parseDeadline tests to verify they pass**

Run:
```
node --test tests/parseDeadline.test.js
```
Expected: all tests in this file pass.

- [ ] **Step 5: Run the full test suite to catch regressions**

Run:
```
node --test
```
Expected: all tests pass. The existing test `tests/defCallsEscalate.test.js` calls `parseDeadline(componentById(json, 'arrival').value)` with value `'2030-03-17 17:46:40'` — under UTC parsing this MUST still equal `1_900_000_000` (Date.UTC(2030,2,17,17,46,40)/1000 = 1900000000). Verify by running:
```
node -e "console.log(Date.UTC(2030, 2, 17, 17, 46, 40) / 1000)"
```
Output: `1900000000`. So the existing assertion still holds.

If any other test fails, inspect — most likely cause is a test that relied on `getHours()` (host-local) format which is now UTC.

- [ ] **Step 6: Commit**

```bash
git add tests/parseDeadline.test.js src/utils/time.js
git commit -m "feat(time): UTC-correct parseDeadline via chrono-node, format in UTC"
```

---

## Task 3: Remove the no-op TZ assignment in src/index.js

**Files:**
- Modify: `src/index.js:1-3`

- [ ] **Step 1: Read current top of file**

The first 3 lines today are:

```js
// Force UTC for all Date operations (deadline parsing, formatting, logs).
// Must run before any Date is constructed, so it stays at the top of the file.
process.env.TZ = 'UTC';
```

- [ ] **Step 2: Replace with an accurate comment**

Use Edit to replace the block above with:

```js
// All deadline parsing/formatting is UTC-correct by construction in src/utils/time.js.
// For consistent log timestamps, launch the bot with TZ=UTC in the environment
// (Node samples TZ at process start; runtime mutation of process.env.TZ is a no-op
// on most platforms).
```

- [ ] **Step 3: Run full test suite**

Run:
```
node --test
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "fix(time): remove no-op process.env.TZ assignment, document launch contract"
```

---

## Task 4: Add routeAutocomplete and wire to index.js

**Files:**
- Modify: `src/handlers/router.js` (add export)
- Modify: `src/index.js` (interaction dispatcher)

- [ ] **Step 1: Add `routeAutocomplete` export at the bottom of `src/handlers/router.js`**

Add this function after `routeModal` (around the end of the file, before any trailing imports/helpers):

```js
// ── Autocomplete router ──────────────────────────────────────────────────────
export async function routeAutocomplete(interaction) {
  try {
    if (interaction.commandName === 'active-def') {
      return await handleActiveDefArrivalAutocomplete(interaction);
    }
    return await interaction.respond([]);
  } catch (err) {
    logger.warn('Autocomplete error:', err.message);
    try { await interaction.respond([]); } catch {}
  }
}
```

`handleActiveDefArrivalAutocomplete` is defined in Task 5. For this task, **temporarily import a stub** at the top of `router.js`:

```js
async function handleActiveDefArrivalAutocomplete(interaction) {
  await interaction.respond([]);
}
```

(This stub is replaced in Task 5.)

- [ ] **Step 2: Wire `routeAutocomplete` in `src/index.js`**

In `src/index.js`, find:

```js
import { routeCommand, routeButton, routeModal, routeSelect } from './handlers/router.js';
```

Change to:

```js
import { routeCommand, routeButton, routeModal, routeSelect, routeAutocomplete } from './handlers/router.js';
```

Find the dispatcher (around line 105):

```js
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand())     return routeCommand(interaction);
  if (interaction.isButton())               return routeButton(interaction);
  if (interaction.isStringSelectMenu?.())   return routeSelect(interaction);
  if (interaction.type === InteractionType.ModalSubmit) return routeModal(interaction);
});
```

Add an autocomplete branch before the command branch:

```js
client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete())         return routeAutocomplete(interaction);
  if (interaction.isChatInputCommand())     return routeCommand(interaction);
  if (interaction.isButton())               return routeButton(interaction);
  if (interaction.isStringSelectMenu?.())   return routeSelect(interaction);
  if (interaction.type === InteractionType.ModalSubmit) return routeModal(interaction);
});
```

- [ ] **Step 3: Run tests**

Run:
```
node --test
```
Expected: all tests pass (this task adds wiring but no behavior change).

- [ ] **Step 4: Commit**

```bash
git add src/handlers/router.js src/index.js
git commit -m "feat(router): scaffold autocomplete dispatcher"
```

---

## Task 5: Implement /active-def arrival autocomplete

**Files:**
- Modify: `src/commands/definitions.js`
- Modify: `src/handlers/router.js`

- [ ] **Step 1: Enable autocomplete on the slash option**

In `src/commands/definitions.js`, find the `/active-def` definition (around line 160):

```js
new SlashCommandBuilder()
  .setName('active-def')
  .setDescription('Post an Active Def call (leadership only)')
  .addStringOption(o => o.setName('coords').setDescription('Defender coordinates').setRequired(true))
  .addIntegerOption(o => o.setName('troops_needed').setDescription('Required def value').setRequired(true).setMinValue(1))
  .addStringOption(o => o.setName('arrival').setDescription('Impact time (UTC)').setRequired(true))
  .addStringOption(o => o.setName('notes').setDescription('Notes').setRequired(false)),
```

Change the `arrival` line to:

```js
  .addStringOption(o => o.setName('arrival').setDescription('Impact time (UTC) — type or pick a suggestion').setRequired(true).setAutocomplete(true))
```

- [ ] **Step 2: Replace the stub handler in `src/handlers/router.js`**

Replace the stub `handleActiveDefArrivalAutocomplete` added in Task 4 with:

```js
function _padUtc(n) { return String(n).padStart(2, '0'); }
function _fmtUtc(d) {
  return `${d.getUTCFullYear()}-${_padUtc(d.getUTCMonth() + 1)}-${_padUtc(d.getUTCDate())} ${_padUtc(d.getUTCHours())}:${_padUtc(d.getUTCMinutes())}:${_padUtc(d.getUTCSeconds())}`;
}

async function handleActiveDefArrivalAutocomplete(interaction) {
  const focused = interaction.options.getFocused() ?? '';
  const now = new Date();
  const offsets = [
    ['in 30m',  30 * 60_000],
    ['in 1h',   60 * 60_000],
    ['in 2h',   2 * 60 * 60_000],
    ['in 3h',   3 * 60 * 60_000],
    ['in 6h',   6 * 60 * 60_000],
    ['in 12h',  12 * 60 * 60_000],
    ['in 24h',  24 * 60 * 60_000],
  ];
  const suggestions = offsets.map(([label, ms]) => {
    const fullName = `${label}  →  ${_fmtUtc(new Date(now.getTime() + ms))} UTC`;
    return { name: fullName.slice(0, 100), value: label };
  });
  const q = focused.toLowerCase();
  const filtered = q
    ? suggestions.filter(s => s.name.toLowerCase().includes(q))
    : suggestions;
  await interaction.respond(filtered.slice(0, 25));
}
```

- [ ] **Step 3: Write a test for the autocomplete handler**

Add to `tests/parseDeadline.test.js` at the bottom:

```js
import { routeAutocomplete } from '../src/handlers/router.js';

test('routeAutocomplete: /active-def arrival returns time-offset suggestions', async () => {
  const responded = [];
  const interaction = {
    isAutocomplete: () => true,
    commandName: 'active-def',
    options: { getFocused: () => '' },
    respond: async (choices) => { responded.push(choices); },
  };
  await routeAutocomplete(interaction);
  assert.equal(responded.length, 1);
  const choices = responded[0];
  assert.ok(choices.length > 0, 'expected suggestions');
  assert.ok(choices.length <= 25, 'expected ≤25 suggestions');
  for (const c of choices) {
    assert.ok(typeof c.name === 'string' && c.name.length <= 100);
    assert.ok(typeof c.value === 'string');
    assert.match(c.value, /^in /);
  }
});

test('routeAutocomplete: filters by focused substring', async () => {
  const responded = [];
  const interaction = {
    isAutocomplete: () => true,
    commandName: 'active-def',
    options: { getFocused: () => '24' },
    respond: async (choices) => { responded.push(choices); },
  };
  await routeAutocomplete(interaction);
  const choices = responded[0];
  assert.ok(choices.length >= 1);
  assert.ok(choices.every(c => c.name.toLowerCase().includes('24')));
});
```

- [ ] **Step 4: Run tests**

Run:
```
node --test
```
Expected: all tests pass including the two new autocomplete tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/definitions.js src/handlers/router.js tests/parseDeadline.test.js
git commit -m "feat(active-def): autocomplete arrival with time-offset suggestions"
```

---

## Task 6: Extract `createDefCall` helper in defCalls.js (refactor only)

**Goal:** Pull the call-insertion-and-post logic out of the two modal handlers so the picker (Task 13) and "Type instead" submit (Task 14) can call it. Behavior unchanged.

**Files:**
- Modify: `src/handlers/defCalls.js`

- [ ] **Step 1: Add `createDefCall` as a top-level exported function in `src/handlers/defCalls.js`**

Insert this function just above `handleDefCallCreateModal` (around line 155, right before `// ── Modal submit:` comment):

```js
// Shared call-insertion path: used by direct modal create, escalation modal create,
// the picker's Create button, the Type-instead modal, and (will be) any future
// def-call entry. Returns { callId, error }.
export async function createDefCall(interaction, { type, x, y, deadline, troopsNeeded, notes, sourceReportId }) {
  const config = COMBAT_CONFIG[type];
  if (!config) return { error: '❌ Unknown call type.' };

  const channelId = getDefCallsChannelId();
  if (!channelId) {
    return { error: '❌ No def-calls channel configured. Run `/setup def-calls` first.' };
  }

  const payload = JSON.stringify({ troops_needed: troopsNeeded, notes: notes ?? null, source_report_id: sourceReportId ?? null });

  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, channel_id, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(type, interaction.user.id, x, y, deadline, channelId, payload);
  const callId = result.lastInsertRowid;
  inc('callsCreated');

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const channel = await interaction.client.channels.fetch(channelId);
  const mention = await getDefRoleMention(channel.guild);
  const msg = await channel.send({
    content: mention || '',
    embeds: [buildDefCallEmbed(call, [])],
    components: buildDefCallComponents(call),
    allowedMentions: { parse: ['roles'] },
  });
  prepare('UPDATE calls SET message_id = ? WHERE id = ?').run(msg.id, callId);

  // If escalated from a report, patch the report and re-render it.
  if (sourceReportId) {
    prepare('UPDATE incoming_reports SET escalated_call_id = ? WHERE id = ?').run(callId, sourceReportId);
    try {
      const reportRow = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(sourceReportId);
      const reportsChannelId = prepare('SELECT value FROM config WHERE key=?').get('leadership_channel_id')?.value ?? null;
      if (reportRow?.reports_msg_id && reportsChannelId) {
        const ch = await interaction.client.channels.fetch(reportsChannelId);
        const rmsg = await ch.messages.fetch(reportRow.reports_msg_id);
        const { buildReportEmbed, buildReportComponents } = await import('./incomingReports.js');
        await rmsg.edit({ embeds: [buildReportEmbed(reportRow)], components: buildReportComponents(reportRow) });
      }
    } catch (err) {
      logger.warn('report → call link re-render skipped:', err.message);
    }
  }

  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
  return { callId };
}
```

- [ ] **Step 2: Run the existing test suite**

Run:
```
node --test
```
Expected: all tests pass — `createDefCall` is added but not yet called from anywhere, so behavior is unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/handlers/defCalls.js
git commit -m "refactor(defCalls): extract createDefCall helper for picker reuse"
```

---

## Task 7: Create defCallPicker.js with state map and TTL janitor

**Files:**
- Create: `src/handlers/defCallPicker.js`

- [ ] **Step 1: Create the file with state primitives**

Create `src/handlers/defCallPicker.js`:

```js
// Two-page ephemeral picker for creating def_active calls.
// Replaces the free-text "arrival" field in the create modals.
// Custom-ID namespace: combat:newpick:*

import {
  StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { parseDeadline, formatDeadline, unixNow } from '../utils/time.js';
import { isLeadershipOrCoord } from '../utils/tier.js';
import { createDefCall } from './defCalls.js';

// In-memory state, keyed by the ephemeral message ID. See spec for rationale
// (customID 100-char limit can't carry notes; DB persistence is overkill for
// a 15-minute interaction window).
const pickerState = new Map();
const TTL_MS = 16 * 60 * 1000;   // slightly above Discord's 15-min token

const _janitor = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pickerState) {
    if (now - v.createdAt > TTL_MS) pickerState.delete(k);
  }
}, 60_000);
if (typeof _janitor.unref === 'function') _janitor.unref();

// Exposed for tests; do not call from production code.
export function _resetPickerStateForTests() {
  pickerState.clear();
}

export function _getPickerStateForTests(msgId) {
  return pickerState.get(msgId);
}

export function _setPickerStateForTests(msgId, value) {
  pickerState.set(msgId, value);
}
```

- [ ] **Step 2: Write a smoke test for the state map**

Create `tests/defCallPicker.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  _resetPickerStateForTests,
  _getPickerStateForTests,
  _setPickerStateForTests,
} from '../src/handlers/defCallPicker.js';

test('pickerState: set/get round-trip', () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-1', { type: 'def_active', createdAt: Date.now() });
  const got = _getPickerStateForTests('msg-1');
  assert.equal(got.type, 'def_active');
});

test('pickerState: reset clears entries', () => {
  _setPickerStateForTests('msg-2', { type: 'def_active', createdAt: Date.now() });
  _resetPickerStateForTests();
  assert.equal(_getPickerStateForTests('msg-2'), undefined);
});
```

- [ ] **Step 3: Run tests**

Run:
```
node --test
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/defCallPicker.js tests/defCallPicker.test.js
git commit -m "feat(defCallPicker): scaffold state map + TTL janitor"
```

---

## Task 8: Picker page-1 renderer + header formatter

**Files:**
- Modify: `src/handlers/defCallPicker.js`

- [ ] **Step 1: Add header formatter + page-1 renderer to `src/handlers/defCallPicker.js`**

Append to the file (after the test-helper exports):

```js
// Format the partial-state header text. Unpicked slots render as underscores.
export function buildHeaderText(state) {
  const datePart = (state.dateOffset == null)
    ? '____-__-__'
    : (() => {
        const now = new Date();
        const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + state.dateOffset));
        const pad = n => String(n).padStart(2, '0');
        return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`;
      })();
  const hourPart = state.hour == null ? '__' : String(state.hour).padStart(2, '0');
  const minPart = (state.mt == null || state.mo == null) ? '__' : `${state.mt}${state.mo}`;
  const secPart = (state.st == null || state.so == null) ? '__' : `${state.st}${state.so}`;
  return `${datePart} ${hourPart}:${minPart}:${secPart}`;
}

// Resolve picker state to a unix timestamp, defaulting missing seconds to 00.
// Returns null if date/hour/minute components are not all set.
export function resolveStateToUnix(state) {
  if (state.dateOffset == null || state.hour == null || state.mt == null || state.mo == null) return null;
  const now = new Date();
  const utcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + state.dateOffset,
    state.hour,
    state.mt * 10 + state.mo,
    (state.st ?? 0) * 10 + (state.so ?? 0),
  );
  return Math.floor(utcMs / 1000);
}

function dateLabel(offset) {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`;
  if (offset === 0) return `Today (${datePart} UTC)`;
  if (offset === 1) return `Tomorrow (${datePart} UTC)`;
  return `Day after (${datePart} UTC)`;
}

export function buildPickerPage1(msgId, state) {
  const reportLine = state.reportFirstEta
    ? `Report ETA: ${formatDeadline(state.reportFirstEta)} UTC\n`
    : '';
  const content = `${reportLine}Pick impact time (UTC) — currently: \`${buildHeaderText(state)}\``;

  const dateSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:date:${msgId}`)
    .setPlaceholder(state.dateOffset == null ? 'Date' : dateLabel(state.dateOffset))
    .addOptions([0, 1, 2].map(o => ({ label: dateLabel(o), value: String(o), default: state.dateOffset === o })));

  const hourSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:hour:${msgId}`)
    .setPlaceholder(state.hour == null ? 'Hour (UTC)' : `Hour: ${String(state.hour).padStart(2, '0')}`)
    .addOptions(Array.from({ length: 24 }, (_, h) => ({
      label: String(h).padStart(2, '0'),
      value: String(h),
      default: state.hour === h,
    })));

  const mtSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:mt:${msgId}`)
    .setPlaceholder(state.mt == null ? 'Minute tens (0–5)' : `Min tens: ${state.mt}`)
    .addOptions([0, 1, 2, 3, 4, 5].map(v => ({ label: String(v), value: String(v), default: state.mt === v })));

  const moSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:mo:${msgId}`)
    .setPlaceholder(state.mo == null ? 'Minute ones (0–9)' : `Min ones: ${state.mo}`)
    .addOptions(Array.from({ length: 10 }, (_, v) => ({ label: String(v), value: String(v), default: state.mo === v })));

  const typeBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:type_instead:${msgId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Type instead')
    .setEmoji('⌨️');

  const nextBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:next:${msgId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('Next →');

  return {
    content,
    ephemeral: true,
    components: [
      new ActionRowBuilder().addComponents(dateSelect),
      new ActionRowBuilder().addComponents(hourSelect),
      new ActionRowBuilder().addComponents(mtSelect),
      new ActionRowBuilder().addComponents(moSelect),
      new ActionRowBuilder().addComponents(typeBtn, nextBtn),
    ],
  };
}
```

- [ ] **Step 2: Test the header formatter and renderer shape**

Append to `tests/defCallPicker.test.js`:

```js
import {
  buildHeaderText,
  resolveStateToUnix,
  buildPickerPage1,
} from '../src/handlers/defCallPicker.js';

test('buildHeaderText: all unpicked', () => {
  assert.equal(buildHeaderText({}), '____-__-__ __:__:__');
});

test('buildHeaderText: partial — date + hour', () => {
  const header = buildHeaderText({ dateOffset: 0, hour: 14 });
  assert.match(header, /^\d{4}-\d{2}-\d{2} 14:__:__$/);
});

test('buildHeaderText: full — all components', () => {
  const header = buildHeaderText({ dateOffset: 1, hour: 14, mt: 3, mo: 0, st: 4, so: 5 });
  assert.match(header, /^\d{4}-\d{2}-\d{2} 14:30:45$/);
});

test('resolveStateToUnix: incomplete state returns null', () => {
  assert.equal(resolveStateToUnix({ dateOffset: 0, hour: 14 }), null);
  assert.equal(resolveStateToUnix({}), null);
});

test('resolveStateToUnix: defaults seconds to 00', () => {
  const got = resolveStateToUnix({ dateOffset: 0, hour: 14, mt: 3, mo: 0 });
  const now = new Date();
  const want = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14, 30, 0) / 1000;
  assert.equal(got, want);
});

test('buildPickerPage1: emits 5 action rows', () => {
  const payload = buildPickerPage1('msg-1', {});
  assert.equal(payload.components.length, 5);
  assert.equal(payload.ephemeral, true);
});

test('buildPickerPage1: includes report ETA when escalation state present', () => {
  const payload = buildPickerPage1('msg-1', { reportFirstEta: 1_900_000_000 });
  assert.match(payload.content, /Report ETA: 2030-03-17 17:46:40 UTC/);
});
```

- [ ] **Step 3: Run tests**

Run:
```
node --test
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/defCallPicker.js tests/defCallPicker.test.js
git commit -m "feat(defCallPicker): page-1 renderer + header/resolver helpers"
```

---

## Task 9: Wire modals to reply with picker page 1

**Goal:** Strip the `arrival` text input from both create modals and replace the call-creation tail of their submit handlers with a picker-page-1 reply.

**Files:**
- Modify: `src/handlers/defCalls.js`

- [ ] **Step 1: Remove `arrival` from `handleDefCallButton`'s modal**

In `src/handlers/defCalls.js`, find `handleDefCallButton` (around line 129). Delete the `arrival` input and its action-row addition. The modal should add only `coords`, `troops`, `notes`:

```js
export async function handleDefCallButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const type = interaction.customId.split(':')[1]; // 'def_active' or 'def_perma'
  const config = COMBAT_CONFIG[type];
  if (!config) return interaction.reply({ content: '❌ Unknown call type.', ephemeral: true });

  const modal = new ModalBuilder().setCustomId(`combat:create_def:${type}`).setTitle(config.label);

  const coords = new TextInputBuilder().setCustomId('coords').setLabel('Defender coordinates').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('(-12|34)').setMaxLength(20);
  const troops = new TextInputBuilder().setCustomId('troops_needed').setLabel('Troops needed (def value)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 15000').setMaxLength(10);
  const notes  = new TextInputBuilder().setCustomId('notes').setLabel('Notes').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(coords),
    new ActionRowBuilder().addComponents(troops),
    new ActionRowBuilder().addComponents(notes),
  );
  await interaction.showModal(modal);
}
```

(For `def_perma` the modal already had no arrival; that path is unchanged for behavior — perma still creates the call directly. Keep the existing `def_perma` short-circuit in `handleDefCallCreateModal` — see Step 3.)

- [ ] **Step 2: Remove `arrival` from `showEscalateModal`**

Find `showEscalateModal` (around line 372). Delete the `arrival` block:

```js
async function showEscalateModal(interaction, type, reportId) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const report = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!report) return interaction.reply({ content: 'Report not found.', ephemeral: true });
  const config = COMBAT_CONFIG[type];
  if (!config) return interaction.reply({ content: '❌ Unknown call type.', ephemeral: true });

  const modal = new ModalBuilder()
    .setCustomId(`combat:create_def_from_report:${type}:${reportId}`)
    .setTitle(`${config.label} (from #${reportId})`);

  const coords = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Defender coordinates')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(formatCoords(report.defender_x, report.defender_y))
    .setMaxLength(20);
  modal.addComponents(new ActionRowBuilder().addComponents(coords));

  const troops = new TextInputBuilder()
    .setCustomId('troops_needed')
    .setLabel('Troops needed (def value)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g. 15000')
    .setMaxLength(10);
  modal.addComponents(new ActionRowBuilder().addComponents(troops));

  const inbetweenMin = Number(prepare('SELECT value FROM config WHERE key=?').get('inbetween_min_gap_sec')?.value ?? '1');
  const hasWindow = report.waves > 1 && report.wave_spread_sec != null && report.wave_spread_sec >= inbetweenMin;
  let notesPrefill = '';
  if (hasWindow) notesPrefill = `Wave spread ${report.wave_spread_sec}s — in-between def possible`;

  const notes = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);
  if (notesPrefill) notes.setValue(notesPrefill);
  modal.addComponents(new ActionRowBuilder().addComponents(notes));

  return interaction.showModal(modal);
}
```

- [ ] **Step 3: Rewrite `handleDefCallCreateModal` to reply with picker page 1 for `def_active`**

Note on naming: `_setPickerStateForTests` from Task 7 is used here in production too. The name reflects that it's an internal hook (no public callers expected); plan keeps the name to avoid a rename churn.

Replace the entire existing `handleDefCallCreateModal` function (currently around lines 156–227 of `src/handlers/defCalls.js`) with:

```js
export async function handleDefCallCreateModal(interaction, sourceReportId = null) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const type = interaction.customId.split(':')[2];
  const config = COMBAT_CONFIG[type];
  if (!config) return interaction.reply({ content: '❌ Unknown call type.', ephemeral: true });

  const coordsStr = interaction.fields.getTextInputValue('coords');
  const coords = parseCoords(coordsStr);
  if (!coords) return interaction.reply({ content: `❌ Invalid coords: \`${coordsStr}\``, ephemeral: true });

  const troopsStr = interaction.fields.getTextInputValue('troops_needed').trim().replace(/[, ]/g, '');
  const troopsNeeded = parseInt(troopsStr, 10);
  if (!Number.isInteger(troopsNeeded) || troopsNeeded < 1 || troopsNeeded > 10_000_000) {
    return interaction.reply({ content: '❌ Troops needed must be a positive integer (1–10,000,000).', ephemeral: true });
  }

  const notes = interaction.fields.getTextInputValue('notes') || null;

  // def_perma has no deadline — create directly, no picker.
  if (config.noDeadline) {
    const { callId, error } = await createDefCall(interaction, {
      type, x: coords.x, y: coords.y, deadline: null, troopsNeeded, notes, sourceReportId,
    });
    if (error) return interaction.reply({ content: error, ephemeral: true });
    return interaction.reply({ content: `✅ Call #${callId} posted.`, ephemeral: true });
  }

  // def_active: stash state, reply with picker page 1.
  const reportFirstEta = sourceReportId
    ? prepare('SELECT first_eta FROM incoming_reports WHERE id = ?').get(sourceReportId)?.first_eta ?? null
    : null;

  const picker = await import('./defCallPicker.js');
  // First reply with placeholder content so we can fetch the message ID;
  // then editReply with the picker content keyed by that ID.
  const sent = await interaction.reply({ content: 'Building picker…', ephemeral: true, fetchReply: true });
  const msgId = sent.id;
  const state = {
    type, x: coords.x, y: coords.y, troopsNeeded, notes, sourceReportId,
    reportFirstEta,
    dateOffset: null, hour: null, mt: null, mo: null, st: null, so: null,
    createdAt: Date.now(),
  };
  picker._setPickerStateForTests(msgId, state);
  const payload = picker.buildPickerPage1(msgId, state);
  await interaction.editReply({ content: payload.content, components: payload.components });
  return sent.id;
}
```

- [ ] **Step 4: Add an `inc` import to defCalls.js if missing**

`createDefCall` (Task 6) already references `inc`. Verify the existing top-of-file import line includes `inc`:

```js
import { inc } from '../utils/metrics.js';
```

If absent, add it.

- [ ] **Step 5: Update the existing escalation test to assert the new behavior**

Edit `tests/defCallsEscalate.test.js`:

In the first test (`report escalate active button opens a pre-filled def call modal`), remove the assertions about `arrival`:

```js
// DELETE:
// assert.equal(parseDeadline(componentById(json, 'arrival').value), 1_900_000_000);
```

And remove the unused `parseDeadline` import at the top:

```js
// DELETE:
// import { parseDeadline } from '../src/utils/time.js';
```

Replace the second test (`from-report def call modal creates call and links the report`) wholesale with a picker-reply assertion:

```js
test('from-report def call modal replies with picker page 1 instead of creating call', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  delete process.env.DEF_ROLE_NAME;

  const reportId = insertReport();
  prepare('INSERT INTO panels (type, channel_id, message_id) VALUES (?, ?, ?)').run('def-calls', 'def-channel', 'panel-msg');
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');

  const interaction = {
    customId: `combat:create_def_from_report:def_active:${reportId}`,
    member: fakeMember(['Defense Coordinator']),
    user: { id: 'coord-1' },
    fields: {
      getTextInputValue(name) {
        return {
          coords: '(-12|34)',
          troops_needed: '5,000',
          notes: 'Wave gap ~2.0s - in-between def possible',
        }[name] ?? '';
      },
    },
    client: { channels: { fetch: async () => ({}) } },
    _editedTo: null,
    reply: async (payload) => {
      interaction._sentMessageId = 'eph-1';
      return { id: 'eph-1' };
    },
    editReply: async (payload) => { interaction._editedTo = payload; },
  };

  await routeModal(interaction);

  // No call inserted yet — the picker is still being filled out.
  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  assert.equal(call, undefined, 'no call should be created until picker Create is clicked');

  // editReply should have the picker page-1 components.
  assert.ok(interaction._editedTo, 'expected editReply to be invoked');
  assert.equal(interaction._editedTo.components.length, 5);
  assert.match(interaction._editedTo.content, /Report ETA: 2030-03-17 17:46:40 UTC/);
  assert.match(interaction._editedTo.content, /Pick impact time/);
});
```

- [ ] **Step 6: Run the test suite**

Run:
```
node --test
```
Expected: all tests pass. The first escalation test should still pass (no more `arrival` reference). The rewritten second test passes against the new behavior.

- [ ] **Step 7: Commit**

```bash
git add src/handlers/defCalls.js tests/defCallsEscalate.test.js
git commit -m "feat(defCalls): create modals reply with picker page 1 (def_active only)"
```

---

## Task 10: Picker page-1 select handlers (date/hour/mt/mo)

**Files:**
- Modify: `src/handlers/defCallPicker.js`
- Modify: `src/handlers/router.js`

- [ ] **Step 1: Add the select handler to `src/handlers/defCallPicker.js`**

Append:

```js
function _parseMsgId(customId) {
  // Format: combat:newpick:<part>:<msgId>
  return customId.split(':').slice(3).join(':');
}

function _expiredOrMissing(interaction, state) {
  if (!state) {
    return interaction.update({
      content: '⏱️ Picker session expired — please re-open the call.',
      components: [],
    }).then(() => true).catch(() => true);
  }
  return false;
}

export async function handlePickerSelect(interaction) {
  const id = interaction.customId;
  const part = id.split(':')[2];           // 'date' | 'hour' | 'mt' | 'mo' | 'st' | 'so'
  const msgId = _parseMsgId(id);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  const value = parseInt(interaction.values[0], 10);
  switch (part) {
    case 'date': state.dateOffset = value; break;
    case 'hour': state.hour = value; break;
    case 'mt':   state.mt = value; break;
    case 'mo':   state.mo = value; break;
    case 'st':   state.st = value; break;
    case 'so':   state.so = value; break;
    default:
      return interaction.update({ content: '❌ Unknown picker control.', components: [] });
  }

  // Re-render current page.
  const onPage2 = state.st != null || state.so != null || state._page === 2;
  const payload = onPage2
    ? buildPickerPage2(msgId, state)
    : buildPickerPage1(msgId, state);
  await interaction.update({ content: payload.content, components: payload.components });
}
```

`buildPickerPage2` is added in Task 11; for now this file won't quite compile until that task lands. To keep the build/tests green between tasks, **also add an empty placeholder** at the bottom:

```js
export function buildPickerPage2(msgId, state) {
  // Implemented in Task 11 — temporarily mirror page 1 so the file is callable.
  return buildPickerPage1(msgId, state);
}
```

- [ ] **Step 2: Add picker handler stubs so router can import them now**

In `src/handlers/defCallPicker.js`, append these stub exports (Tasks 11/13/14 replace each one in turn). They keep the file's named exports complete so router.js imports won't break between tasks.

```js
export async function handlePickerTypeInsteadButton(interaction) {
  return interaction.reply({ content: 'Not implemented yet.', ephemeral: true });
}
export async function handlePickerNextButton(interaction) {
  return interaction.reply({ content: 'Not implemented yet.', ephemeral: true });
}
export async function handlePickerBackButton(interaction) {
  return interaction.reply({ content: 'Not implemented yet.', ephemeral: true });
}
export async function handlePickerCreateButton(interaction) {
  return interaction.reply({ content: 'Not implemented yet.', ephemeral: true });
}
export async function handlePickerTypeInsteadSubmit(interaction) {
  return interaction.reply({ content: 'Not implemented yet.', ephemeral: true });
}
```

- [ ] **Step 3: Wire `combat:newpick:*` select route in `src/handlers/router.js`**

Add a new named-imports block at the top of `src/handlers/router.js`, alongside the existing handler imports (look for the block that ends around the existing `import { handleStatusCommand, handleStatusButton } from './status.js';`):

```js
import {
  handlePickerSelect,
  handlePickerTypeInsteadButton,
  handlePickerNextButton,
  handlePickerBackButton,
  handlePickerCreateButton,
  handlePickerTypeInsteadSubmit,
} from './defCallPicker.js';
```

In `routeSelect`, insert a new branch BEFORE the existing `if (id.startsWith('combat:pick:'))` line (around line 274 of the current file). The order matters because `'combat:newpick:'.startsWith('combat:pick:')` is false, so either order is correct — putting `newpick` first keeps the eye-scan obvious:

```js
if (id.startsWith('combat:newpick:')) return await handlePickerSelect(interaction);
```

- [ ] **Step 4: Test the select handler**

Append to `tests/defCallPicker.test.js`:

```js
import { handlePickerSelect } from '../src/handlers/defCallPicker.js';

function fakeSelectInteraction(customId, value, msgId) {
  return {
    customId,
    values: [String(value)],
    update: async function (payload) { this._updated = payload; },
  };
}

test('handlePickerSelect: date select updates state and re-renders page 1', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-A', {
    type: 'def_active', x: 0, y: 0, troopsNeeded: 100, notes: null,
    dateOffset: null, hour: null, mt: null, mo: null, st: null, so: null,
    createdAt: Date.now(),
  });
  const interaction = fakeSelectInteraction('combat:newpick:date:msg-A', 1);
  await handlePickerSelect(interaction);
  assert.equal(_getPickerStateForTests('msg-A').dateOffset, 1);
  assert.equal(interaction._updated.components.length, 5);
  assert.match(interaction._updated.content, /Pick impact time/);
});

test('handlePickerSelect: expired state returns friendly error', async () => {
  _resetPickerStateForTests();
  const interaction = fakeSelectInteraction('combat:newpick:hour:msg-MISSING', 14);
  await handlePickerSelect(interaction);
  assert.equal(interaction._updated.components.length, 0);
  assert.match(interaction._updated.content, /expired/i);
});
```

- [ ] **Step 5: Run tests**

Run:
```
node --test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/defCallPicker.js src/handlers/router.js tests/defCallPicker.test.js
git commit -m "feat(defCallPicker): page-1 select handlers + router wiring"
```

---

## Task 11: Next button → page 2 transition

**Files:**
- Modify: `src/handlers/defCallPicker.js`
- Modify: `src/handlers/router.js`

- [ ] **Step 1: Implement `buildPickerPage2` properly**

In `src/handlers/defCallPicker.js`, REPLACE the placeholder `buildPickerPage2` with:

```js
export function buildPickerPage2(msgId, state) {
  const content = `Seconds (UTC) — currently: \`${buildHeaderText({ ...state, st: state.st ?? 0, so: state.so ?? 0 })}\`\n_Tip: leave both seconds selects unpicked for :00._`;

  const stSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:st:${msgId}`)
    .setPlaceholder(state.st == null ? 'Second tens (0–5)' : `Sec tens: ${state.st}`)
    .addOptions([0, 1, 2, 3, 4, 5].map(v => ({ label: String(v), value: String(v), default: state.st === v })));

  const soSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:so:${msgId}`)
    .setPlaceholder(state.so == null ? 'Second ones (0–9)' : `Sec ones: ${state.so}`)
    .addOptions(Array.from({ length: 10 }, (_, v) => ({ label: String(v), value: String(v), default: state.so === v })));

  const backBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:back:${msgId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('← Back');

  const createBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:create:${msgId}`)
    .setStyle(ButtonStyle.Success)
    .setLabel('Create call')
    .setEmoji('✅');

  return {
    content,
    ephemeral: true,
    components: [
      new ActionRowBuilder().addComponents(stSelect),
      new ActionRowBuilder().addComponents(soSelect),
      new ActionRowBuilder().addComponents(backBtn, createBtn),
    ],
  };
}
```

- [ ] **Step 2: Implement Next/Back handlers**

REPLACE the stubs for `handlePickerNextButton` and `handlePickerBackButton`:

```js
export async function handlePickerNextButton(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  // Require page-1 components to all be picked before advancing.
  if (state.dateOffset == null || state.hour == null || state.mt == null || state.mo == null) {
    return interaction.reply({
      content: '❌ Pick date, hour, and minutes first.',
      ephemeral: true,
    });
  }

  state._page = 2;
  const payload = buildPickerPage2(msgId, state);
  await interaction.update({ content: payload.content, components: payload.components });
}

export async function handlePickerBackButton(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  state._page = 1;
  const payload = buildPickerPage1(msgId, state);
  await interaction.update({ content: payload.content, components: payload.components });
}
```

- [ ] **Step 3: Update the select handler to use `state._page`**

In `handlePickerSelect`, REPLACE the page-decision block:

```js
const onPage2 = state.st != null || state.so != null || state._page === 2;
```

with:

```js
const onPage2 = state._page === 2;
```

(Previously we inferred page from which select was picked; now `_page` is explicit and survives back-button.)

- [ ] **Step 4: Wire button routes in `src/handlers/router.js`**

In `routeButton`, add inside the existing `if (ns === 'combat')` block (after the `pick` action's `if`):

```js
if (action === 'newpick') {
  const sub = id.split(':')[2];
  if (sub === 'type_instead')        return await handlePickerTypeInsteadButton(interaction);
  if (sub === 'next')                return await handlePickerNextButton(interaction);
  if (sub === 'back')                return await handlePickerBackButton(interaction);
  if (sub === 'create')              return await handlePickerCreateButton(interaction);
}
```

- [ ] **Step 5: Tests for Next/Back transitions**

Append to `tests/defCallPicker.test.js`:

```js
import { handlePickerNextButton, handlePickerBackButton } from '../src/handlers/defCallPicker.js';

function fakeButtonInteraction(customId) {
  return {
    customId,
    update: async function (payload) { this._updated = payload; },
    reply: async function (payload) { this._replied = payload; },
  };
}

test('handlePickerNextButton: blocked when page-1 incomplete', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-N1', { dateOffset: 0, hour: 14, mt: null, mo: null, createdAt: Date.now() });
  const interaction = fakeButtonInteraction('combat:newpick:next:msg-N1');
  await handlePickerNextButton(interaction);
  assert.ok(interaction._replied);
  assert.match(interaction._replied.content, /Pick date, hour, and minutes/);
});

test('handlePickerNextButton: advances to page 2 when complete', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-N2', { dateOffset: 0, hour: 14, mt: 3, mo: 0, st: null, so: null, createdAt: Date.now() });
  const interaction = fakeButtonInteraction('combat:newpick:next:msg-N2');
  await handlePickerNextButton(interaction);
  assert.equal(_getPickerStateForTests('msg-N2')._page, 2);
  assert.equal(interaction._updated.components.length, 3);
  assert.match(interaction._updated.content, /Seconds/);
});

test('handlePickerBackButton: returns to page 1', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-B1', { dateOffset: 0, hour: 14, mt: 3, mo: 0, st: 4, so: 5, _page: 2, createdAt: Date.now() });
  const interaction = fakeButtonInteraction('combat:newpick:back:msg-B1');
  await handlePickerBackButton(interaction);
  assert.equal(_getPickerStateForTests('msg-B1')._page, 1);
  assert.equal(interaction._updated.components.length, 5);
});
```

- [ ] **Step 6: Run tests**

Run:
```
node --test
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/handlers/defCallPicker.js src/handlers/router.js tests/defCallPicker.test.js
git commit -m "feat(defCallPicker): Next/Back buttons + page 2 layout"
```

---

## Task 12: Page-2 select handlers (st/so)

**Files:** _(no code changes — verify Task 10's `handlePickerSelect` already routes `st`/`so` via the switch.)_

- [ ] **Step 1: Add test confirming st/so updates**

Append to `tests/defCallPicker.test.js`:

```js
test('handlePickerSelect: st on page 2 updates state and re-renders page 2', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-S1', {
    type: 'def_active', dateOffset: 0, hour: 14, mt: 3, mo: 0,
    st: null, so: null, _page: 2, createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:st:msg-S1',
    values: ['4'],
    update: async function (payload) { this._updated = payload; },
  };
  await handlePickerSelect(interaction);
  assert.equal(_getPickerStateForTests('msg-S1').st, 4);
  assert.equal(interaction._updated.components.length, 3);
  assert.match(interaction._updated.content, /Seconds/);
});

test('handlePickerSelect: so on page 2 updates state', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-S2', {
    type: 'def_active', dateOffset: 0, hour: 14, mt: 3, mo: 0,
    st: 4, so: null, _page: 2, createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:so:msg-S2',
    values: ['5'],
    update: async function (payload) { this._updated = payload; },
  };
  await handlePickerSelect(interaction);
  assert.equal(_getPickerStateForTests('msg-S2').so, 5);
});
```

- [ ] **Step 2: Run tests**

Run:
```
node --test
```
Expected: all tests pass.

- [ ] **Step 3: Commit** _(empty production change, test-only)_

```bash
git add tests/defCallPicker.test.js
git commit -m "test(defCallPicker): verify st/so selects update state on page 2"
```

---

## Task 13: Create button — validate, create call, finalize

**Files:**
- Modify: `src/handlers/defCallPicker.js`

- [ ] **Step 1: Replace the `handlePickerCreateButton` stub**

```js
export async function handlePickerCreateButton(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  const deadline = resolveStateToUnix(state);
  if (deadline == null) {
    return interaction.reply({
      content: '❌ Pick date, hour, and minutes first.',
      ephemeral: true,
    });
  }
  if (deadline < unixNow()) {
    return interaction.reply({
      content: '❌ Impact time is in the past.',
      ephemeral: true,
    });
  }

  const { callId, error } = await createDefCall(interaction, {
    type: state.type,
    x: state.x,
    y: state.y,
    deadline,
    troopsNeeded: state.troopsNeeded,
    notes: state.notes,
    sourceReportId: state.sourceReportId,
  });

  if (error) {
    return interaction.reply({ content: error, ephemeral: true });
  }

  pickerState.delete(msgId);
  await interaction.update({
    content: `✅ Call #${callId} posted.`,
    components: [],
  });
}
```

- [ ] **Step 2: Test the create flow**

Append to `tests/defCallPicker.test.js`:

```js
import { handlePickerCreateButton } from '../src/handlers/defCallPicker.js';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';

test('handlePickerCreateButton: rejects incomplete state', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-C1', { type: 'def_active', dateOffset: null, hour: 14, mt: 3, mo: 0, createdAt: Date.now() });
  const interaction = {
    customId: 'combat:newpick:create:msg-C1',
    reply: async function (p) { this._replied = p; },
    update: async function (p) { this._updated = p; },
  };
  await handlePickerCreateButton(interaction);
  assert.match(interaction._replied.content, /Pick date, hour, and minutes/);
});

test('handlePickerCreateButton: rejects past deadlines', async () => {
  _resetPickerStateForTests();
  // 2020-01-01 00:00:00 UTC: dateOffset can't reach 2020 from "today", so we
  // craft a state that will resolve to a past time by using an arbitrary
  // dateOffset that we then override via reaching into the resolver.
  // Simpler: stub a state whose resolved time is just-before-now.
  _setPickerStateForTests('msg-C2', {
    type: 'def_active', dateOffset: 0, hour: 0, mt: 0, mo: 0, st: 0, so: 0,
    createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:create:msg-C2',
    reply: async function (p) { this._replied = p; },
    update: async function (p) { this._updated = p; },
  };
  await handlePickerCreateButton(interaction);
  // For most of the day this is in the past; rarely (just after 00:00 UTC) it's the future.
  // Guard the assertion either way:
  if (interaction._replied) {
    assert.match(interaction._replied.content, /past|posted/);
  } else {
    assert.match(interaction._updated.content, /posted/);
  }
});

test('handlePickerCreateButton: creates call on full state', async () => {
  await setupTestDb();
  resetTables();
  _resetPickerStateForTests();
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');

  const futureUnix = Math.floor(Date.now() / 1000) + 3600;
  const future = new Date(futureUnix * 1000);
  const state = {
    type: 'def_active',
    x: -12, y: 34, troopsNeeded: 5000, notes: 'pls help', sourceReportId: null,
    dateOffset: Math.floor((Date.UTC(future.getUTCFullYear(), future.getUTCMonth(), future.getUTCDate()) - Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) / 86_400_000),
    hour: future.getUTCHours(),
    mt: Math.floor(future.getUTCMinutes() / 10),
    mo: future.getUTCMinutes() % 10,
    st: Math.floor(future.getUTCSeconds() / 10),
    so: future.getUTCSeconds() % 10,
    createdAt: Date.now(),
  };
  _setPickerStateForTests('msg-C3', state);

  const guild = { id: 'guild-1', roles: { cache: { find: () => null }, fetch: async () => ({ find: () => null }) } };
  const interaction = {
    customId: 'combat:newpick:create:msg-C3',
    user: { id: 'coord-1' },
    guild,
    client: { channels: { fetch: async () => ({ guild, send: async () => ({ id: 'sent-1' }) }) } },
    reply: async function (p) { this._replied = p; },
    update: async function (p) { this._updated = p; },
  };

  await handlePickerCreateButton(interaction);
  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  assert.ok(call, 'expected call inserted');
  assert.equal(call.x, -12);
  assert.equal(call.y, 34);
  assert.match(interaction._updated.content, /Call #\d+ posted/);
  assert.equal(_getPickerStateForTests('msg-C3'), undefined, 'state should be reaped');
});
```

- [ ] **Step 3: Run tests**

Run:
```
node --test
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/defCallPicker.js tests/defCallPicker.test.js
git commit -m "feat(defCallPicker): Create button validates and posts the call"
```

---

## Task 14: "Type instead" modal + submit handler

**Files:**
- Modify: `src/handlers/defCallPicker.js`
- Modify: `src/handlers/router.js`

- [ ] **Step 1: Replace the `handlePickerTypeInsteadButton` stub**

```js
export async function handlePickerTypeInsteadButton(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  const modal = new ModalBuilder()
    .setCustomId(`combat:newpick:type_instead_submit:${msgId}`)
    .setTitle('Impact time (UTC)');

  const arrival = new TextInputBuilder()
    .setCustomId('arrival')
    .setLabel('Impact time (UTC)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('14:30:45 · in 2h30m · 2030-06-01 10:00:01')
    .setMaxLength(60);

  if (state.reportFirstEta) {
    arrival.setValue(formatDeadline(state.reportFirstEta));
  }

  modal.addComponents(new ActionRowBuilder().addComponents(arrival));
  await interaction.showModal(modal);
}
```

- [ ] **Step 2: Replace the `handlePickerTypeInsteadSubmit` stub**

```js
export async function handlePickerTypeInsteadSubmit(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (!state) {
    return interaction.reply({
      content: '⏱️ Picker session expired — please re-open the call.',
      ephemeral: true,
    });
  }

  const raw = interaction.fields.getTextInputValue('arrival');
  const deadline = parseDeadline(raw);
  if (deadline == null) {
    return interaction.reply({
      content: `❌ Could not parse \`${raw}\`. Try \`14:30:45\`, \`in 2h30m\`, or \`2030-06-01 10:00:01\`.`,
      ephemeral: true,
    });
  }
  if (deadline < unixNow()) {
    return interaction.reply({
      content: '❌ Impact time is in the past.',
      ephemeral: true,
    });
  }

  const { callId, error } = await createDefCall(interaction, {
    type: state.type,
    x: state.x,
    y: state.y,
    deadline,
    troopsNeeded: state.troopsNeeded,
    notes: state.notes,
    sourceReportId: state.sourceReportId,
  });
  if (error) return interaction.reply({ content: error, ephemeral: true });

  pickerState.delete(msgId);
  await interaction.reply({
    content: `✅ Call #${callId} posted.`,
    ephemeral: true,
  });
}
```

- [ ] **Step 3: Wire modal submit in `src/handlers/router.js`**

In `routeModal`, add BEFORE the existing `combat:create_def_from_report:` line (so the more specific prefix wins):

```js
if (id.startsWith('combat:newpick:type_instead_submit:')) return await handlePickerTypeInsteadSubmit(interaction);
```

- [ ] **Step 4: Tests**

Append to `tests/defCallPicker.test.js`:

```js
import { handlePickerTypeInsteadButton, handlePickerTypeInsteadSubmit } from '../src/handlers/defCallPicker.js';

test('handlePickerTypeInsteadButton: shows modal with parser-friendly placeholder', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-T1', { type: 'def_active', createdAt: Date.now() });
  let shown = null;
  const interaction = {
    customId: 'combat:newpick:type_instead:msg-T1',
    showModal: async (m) => { shown = m; },
  };
  await handlePickerTypeInsteadButton(interaction);
  assert.ok(shown, 'expected a modal');
  const json = shown.toJSON();
  assert.equal(json.custom_id, 'combat:newpick:type_instead_submit:msg-T1');
});

test('handlePickerTypeInsteadButton: pre-fills from reportFirstEta', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-T2', { type: 'def_active', reportFirstEta: 1_900_000_000, createdAt: Date.now() });
  let shown = null;
  const interaction = {
    customId: 'combat:newpick:type_instead:msg-T2',
    showModal: async (m) => { shown = m; },
  };
  await handlePickerTypeInsteadButton(interaction);
  const json = shown.toJSON();
  const arrival = json.components.flatMap(r => r.components).find(c => c.custom_id === 'arrival');
  assert.equal(arrival.value, '2030-03-17 17:46:40');
});

test('handlePickerTypeInsteadSubmit: parses + creates call', async () => {
  await setupTestDb();
  resetTables();
  _resetPickerStateForTests();
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');
  _setPickerStateForTests('msg-T3', {
    type: 'def_active', x: 10, y: 20, troopsNeeded: 999, notes: null, sourceReportId: null,
    createdAt: Date.now(),
  });
  const guild = { id: 'g', roles: { cache: { find: () => null }, fetch: async () => ({ find: () => null }) } };
  const futureIso = new Date(Date.now() + 3600_000).toISOString();
  const interaction = {
    customId: 'combat:newpick:type_instead_submit:msg-T3',
    user: { id: 'coord-1' },
    guild,
    fields: { getTextInputValue: () => futureIso },
    client: { channels: { fetch: async () => ({ guild, send: async () => ({ id: 'sent-1' }) }) } },
    reply: async function (p) { this._replied = p; },
  };
  await handlePickerTypeInsteadSubmit(interaction);
  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  assert.ok(call);
  assert.match(interaction._replied.content, /Call #\d+ posted/);
});

test('handlePickerTypeInsteadSubmit: rejects unparseable', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-T4', { type: 'def_active', createdAt: Date.now() });
  const interaction = {
    customId: 'combat:newpick:type_instead_submit:msg-T4',
    fields: { getTextInputValue: () => 'xyzzy not a date' },
    reply: async function (p) { this._replied = p; },
  };
  await handlePickerTypeInsteadSubmit(interaction);
  assert.match(interaction._replied.content, /Could not parse/);
});
```

- [ ] **Step 5: Run tests**

Run:
```
node --test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/defCallPicker.js src/handlers/router.js tests/defCallPicker.test.js
git commit -m "feat(defCallPicker): Type-instead button + modal submit"
```

---

## Task 15: Verify deploy-commands and full suite

**Files:** _(no code change — verification only)_

- [ ] **Step 1: Re-run the full test suite**

Run:
```
node --test
```
Expected: all tests pass. Note any flaky tests or warnings.

- [ ] **Step 2: Lint-check the slash command definition compiles**

Run:
```
node -e "import('./src/commands/definitions.js').then(m => console.log('definitions loaded:', m.commandDefinitions.length, 'commands'))"
```
Expected: prints a positive integer; no exception about autocomplete option.

- [ ] **Step 3: Smoke-import the new modules**

Run:
```
node -e "import('./src/handlers/defCallPicker.js').then(m => console.log('picker exports:', Object.keys(m).filter(k=>!k.startsWith('_')).join(', ')))"
```
Expected: prints `buildHeaderText, resolveStateToUnix, buildPickerPage1, buildPickerPage2, handlePickerSelect, handlePickerNextButton, handlePickerBackButton, handlePickerCreateButton, handlePickerTypeInsteadButton, handlePickerTypeInsteadSubmit` (order may differ).

- [ ] **Step 4: Commit if any cleanup needed; otherwise no-op**

If steps 1–3 all passed without changes, no commit. Otherwise commit fixes:

```bash
git add -A
git commit -m "chore: cleanup after full-suite verification"
```

---

## Self-Review Notes (filled in by plan author)

**Spec coverage check:**
- §Entry points (modal, escalation, slash) — Tasks 5, 9 (modal + escalation), 5 (slash autocomplete). ✓
- §Picker page 1 — Tasks 8, 10. ✓
- §Picker page 2 — Tasks 11, 12. ✓
- §"Type instead" — Task 14. ✓
- §State management & customID — Task 7 (state) + namespace baked into every renderer. ✓
- §Parser rewrite — Task 2. ✓
- §Remove broken TZ line — Task 3. ✓
- §Slash command autocomplete — Tasks 4 + 5. ✓
- §Edge cases (incomplete picker, past deadline, expired state, parser null) — Tasks 11 (incomplete page-1 → next blocked), 13 (Create validation), 14 (parser null), 10 (expired state). ✓
- §Tests (parseDeadline, picker, escalation update) — Tasks 2, 7–14, 9. ✓
- §Files touched inventory — covered across tasks. ✓
- §def_perma untouched — Task 9 Step 3 short-circuits config.noDeadline. ✓

**Type-consistency check:**
- `createDefCall(interaction, opts)` signature stable across Tasks 6/9/13/14. ✓
- `pickerState` keys: `type, x, y, troopsNeeded, notes, sourceReportId, reportFirstEta, dateOffset, hour, mt, mo, st, so, _page, createdAt`. Used consistently. ✓
- Handler names match what router imports: `handlePickerSelect, handlePickerNextButton, handlePickerBackButton, handlePickerCreateButton, handlePickerTypeInsteadButton, handlePickerTypeInsteadSubmit`. ✓
- CustomID prefix: `combat:newpick:*` everywhere. ✓
