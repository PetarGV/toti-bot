# Timer Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pinned per-channel `timer` panel with preset/custom Start buttons, Pause-with-resume-where-it-left-off, Stop, and Status. Existing `/timer` slash commands stay unchanged in behavior.

**Architecture:** Reuse the existing panel registry ([src/panel/types.js](../../../src/panel/types.js), [src/panel/deploy.js](../../../src/panel/deploy.js)) and ephemeral-reply pattern. Add two columns to the `timers` table (`paused`, `remaining_sec`) and extract a `startOrReplaceTimer` helper so the panel handlers and the existing `/timer set` share one code path. The tick job gains a `paused = 0` filter.

**Tech Stack:** Node.js (ESM), discord.js v14, sql.js (in-memory SQLite + debounced persist), node-cron, `node --test` (no mocking framework — stub `interaction` objects directly).

**Source spec:** [docs/superpowers/specs/2026-05-15-timer-panel-design.md](../specs/2026-05-15-timer-panel-design.md)

---

## Task 1: DB migration — add `paused` and `remaining_sec` columns

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrations.js`
- Test: `tests/migrations.test.js`

- [ ] **Step 1: Write the failing test**

Append this test block at the bottom of `tests/migrations.test.js`:

```js
test('migration adds paused and remaining_sec columns to timers', async () => {
  await setupTestDb();
  resetTables();

  const cols = prepare(`PRAGMA table_info(timers)`).all();
  const byName = Object.fromEntries(cols.map(c => [c.name, c]));

  assert.ok(byName.paused,        'paused column exists');
  assert.equal(byName.paused.type, 'INTEGER');
  assert.equal(byName.paused.dflt_value, '0');

  assert.ok(byName.remaining_sec, 'remaining_sec column exists');
  assert.equal(byName.remaining_sec.type, 'INTEGER');
});

test('existing running timer rows survive migration unchanged', async () => {
  await setupTestDb();
  resetTables();

  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('user-1', 'chan-1', 600, 9_999_999_999, 0, 'raid');

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('user-1');
  assert.equal(row.paused, 0);
  assert.equal(row.remaining_sec, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/migrations.test.js`
Expected: the two new tests FAIL (`paused column exists` assertion fires).

- [ ] **Step 3: Add the migration**

In `src/db/migrations.js`, add the two blocks **immediately after** the existing `timers` table-creation block (lines 54-68 region), before the `pending_message_deletes` block:

```js
  if (!hasColumn('timers', 'paused')) {
    try {
      exec('ALTER TABLE timers ADD COLUMN paused INTEGER DEFAULT 0');
    } catch (err) {
      logger.warn('Migration timers.paused skipped:', err.message);
    }
  }

  if (!hasColumn('timers', 'remaining_sec')) {
    try {
      exec('ALTER TABLE timers ADD COLUMN remaining_sec INTEGER');
    } catch (err) {
      logger.warn('Migration timers.remaining_sec skipped:', err.message);
    }
  }
```

- [ ] **Step 4: Update schema.sql for fresh installs**

In `src/db/schema.sql`, replace the existing `CREATE TABLE IF NOT EXISTS timers (...)` block (lines 77-85) with:

```sql
CREATE TABLE IF NOT EXISTS timers (
  user_id       TEXT PRIMARY KEY,
  channel_id    TEXT NOT NULL,
  interval_sec  INTEGER NOT NULL,
  next_fire_at  INTEGER NOT NULL,
  fires_count   INTEGER DEFAULT 0,
  label         TEXT,
  paused        INTEGER DEFAULT 0,
  remaining_sec INTEGER,
  created_at    INTEGER DEFAULT (unixepoch())
);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/migrations.test.js`
Expected: all migration tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.sql src/db/migrations.js tests/migrations.test.js
git commit -m "feat(timer): add paused and remaining_sec columns"
```

---

## Task 2: Extract `startOrReplaceTimer` helper

**Files:**
- Modify: `src/handlers/timer.js`
- Test: `tests/handlers/timer.test.js` (new file)

Refactor `/timer set` so its `INSERT OR REPLACE` lives in a reusable helper. No behavior change for `/timer set`; the helper is what panel handlers will call.

- [ ] **Step 1: Write the failing test**

Create `tests/handlers/timer.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import { startOrReplaceTimer } from '../../src/handlers/timer.js';
import { unixNow } from '../../src/utils/time.js';

test('startOrReplaceTimer inserts a new row with correct defaults', async () => {
  await setupTestDb();
  resetTables();

  const before = unixNow();
  startOrReplaceTimer({
    userId: 'u1', channelId: 'c1', intervalSec: 600, label: 'raid',
  });

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.channel_id, 'c1');
  assert.equal(row.interval_sec, 600);
  assert.equal(row.label, 'raid');
  assert.equal(row.fires_count, 0);
  assert.equal(row.paused, 0);
  assert.equal(row.remaining_sec, null);
  assert.ok(row.next_fire_at >= before + 600 && row.next_fire_at <= before + 601);
});

test('startOrReplaceTimer replaces an existing timer and resets fires_count', async () => {
  await setupTestDb();
  resetTables();

  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 60, 100, 7, 'old', 1, 30);

  startOrReplaceTimer({
    userId: 'u1', channelId: 'c2', intervalSec: 420, label: null,
  });

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.channel_id, 'c2');
  assert.equal(row.interval_sec, 420);
  assert.equal(row.label, null);
  assert.equal(row.fires_count, 0);
  assert.equal(row.paused, 0);
  assert.equal(row.remaining_sec, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/handlers/timer.test.js`
Expected: FAIL — `startOrReplaceTimer` is not an export of `timer.js`.

- [ ] **Step 3: Add the helper and refactor `handleSet` to use it**

In `src/handlers/timer.js`, **add** this exported helper just below the existing imports (above `handleTimerCommand`):

```js
export function startOrReplaceTimer({ userId, channelId, intervalSec, label }) {
  const next = unixNow() + intervalSec;
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, 0, ?, 0, NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      channel_id    = excluded.channel_id,
      interval_sec  = excluded.interval_sec,
      next_fire_at  = excluded.next_fire_at,
      fires_count   = 0,
      label         = excluded.label,
      paused        = 0,
      remaining_sec = NULL
  `).run(userId, channelId, intervalSec, label);
  return { nextFireAt: next };
}
```

Then **replace** the `prepare(...).run(...)` block inside `handleSet` (lines 26-36) with a call to the helper:

```js
  const { nextFireAt: next } = startOrReplaceTimer({
    userId:      interaction.user.id,
    channelId:   interaction.channel.id,
    intervalSec: interval,
    label,
  });
```

The `next` constant is already referenced below in the embed; keep that reference unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/handlers/timer.test.js`
Expected: both new tests PASS.

Also run the full suite to confirm no regression:
Run: `node --test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/timer.js tests/handlers/timer.test.js
git commit -m "refactor(timer): extract startOrReplaceTimer helper"
```

---

## Task 3: Add `State` field to status output

**Files:**
- Modify: `src/handlers/timer.js`
- Test: `tests/handlers/timer.test.js`

Status reply gains a `State` field showing `▶️ Running` or `⏸️ Paused (4m 12s left)`. Both `/timer status` and the upcoming panel Status button will use the same renderer.

- [ ] **Step 1: Write the failing test**

Append to `tests/handlers/timer.test.js`:

```js
import { handleTimerCommand } from '../../src/handlers/timer.js';

function makeStatusInteraction(userId) {
  const calls = [];
  return {
    user: { id: userId },
    channel: { id: 'c1' },
    options: { getSubcommand: () => 'status' },
    async reply(payload) { calls.push(payload); this.replied = true; },
    _calls: calls,
  };
}

test('/timer status shows running state with remaining time', async () => {
  await setupTestDb();
  resetTables();

  const now = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, now + 250, 3, 'raid', 0, null);

  const ix = makeStatusInteraction('u1');
  await handleTimerCommand(ix);

  const embed = ix._calls[0].embeds[0].toJSON();
  const stateField = embed.fields.find(f => f.name === 'State');
  assert.ok(stateField, 'State field exists');
  assert.match(stateField.value, /Running/);
});

test('/timer status shows paused state with remaining time', async () => {
  await setupTestDb();
  resetTables();

  const now = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, now + 9999, 3, 'raid', 1, 252);

  const ix = makeStatusInteraction('u1');
  await handleTimerCommand(ix);

  const embed = ix._calls[0].embeds[0].toJSON();
  const stateField = embed.fields.find(f => f.name === 'State');
  assert.ok(stateField, 'State field exists');
  assert.match(stateField.value, /Paused/);
  assert.match(stateField.value, /4m12s|252s/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/handlers/timer.test.js`
Expected: the two new tests FAIL (no `State` field).

- [ ] **Step 3: Implement the State field**

In `src/handlers/timer.js`, replace the entire `handleStatus` function (currently at lines 63-82) with:

```js
async function handleStatus(interaction) {
  const t = prepare('SELECT * FROM timers WHERE user_id = ?').get(interaction.user.id);
  if (!t) {
    return interaction.reply({ content: 'You have no active timer. Start one with `/timer set`.', ephemeral: true });
  }

  await interaction.reply({ embeds: [buildStatusEmbed(t)], ephemeral: true });
}

export function buildStatusEmbed(t) {
  const now = unixNow();
  const stateValue = t.paused
    ? `⏸️ Paused · ${formatDuration(Math.max(0, t.remaining_sec ?? 0))} left`
    : `▶️ Running`;

  const nextPing = t.paused
    ? '*paused — tap Pause to resume*'
    : discordTimestamp(t.next_fire_at, 'R');

  return new EmbedBuilder()
    .setColor(t.paused ? COLORS.brand.warning : COLORS.brand.info)
    .setTitle('⏱️ Your Timer')
    .addFields(
      { name: 'State',     value: stateValue,                          inline: true },
      { name: 'Interval',  value: formatDuration(t.interval_sec),      inline: true },
      { name: 'Label',     value: t.label || '*none*',                 inline: true },
      { name: 'Fires',     value: String(t.fires_count),               inline: true },
      { name: 'Next Ping', value: nextPing,                            inline: false },
      { name: 'Channel',   value: `<#${t.channel_id}>`,                inline: true },
    )
    .setFooter({ text: FOOTER });
}
```

The `buildStatusEmbed` export will be reused by the panel Status handler in Task 11.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/handlers/timer.test.js`
Expected: all tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/timer.js tests/handlers/timer.test.js
git commit -m "feat(timer): add State field to status embed"
```

---

## Task 4: Tick job skips paused timers

**Files:**
- Modify: `src/jobs/timerTick.js`
- Test: `tests/timerTick.test.js` (new file)

Extract the "find due timers" SELECT into a named, exported helper so it can be tested in isolation without mocking the Discord client.

- [ ] **Step 1: Write the failing test**

Create `tests/timerTick.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { selectDueTimers } from '../src/jobs/timerTick.js';
import { unixNow } from '../src/utils/time.js';

test('selectDueTimers returns running due timers and skips paused ones', async () => {
  await setupTestDb();
  resetTables();

  const now = unixNow();

  // Running, due
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u-running', 'c1', 600, now - 1, 0, null, 0, null);

  // Paused, would otherwise be due
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u-paused', 'c1', 600, now - 1, 0, null, 1, 300);

  // Running, not yet due
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u-future', 'c1', 600, now + 9999, 0, null, 0, null);

  const due = selectDueTimers(now);
  assert.equal(due.length, 1);
  assert.equal(due[0].user_id, 'u-running');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/timerTick.test.js`
Expected: FAIL — `selectDueTimers` is not an export of `timerTick.js`.

- [ ] **Step 3: Extract and update the tick query**

In `src/jobs/timerTick.js`, **add** this exported helper above `fireDueTimers`:

```js
export function selectDueTimers(now) {
  return prepare('SELECT * FROM timers WHERE next_fire_at <= ? AND paused = 0').all(now);
}
```

Then **replace** the `const due = ...` line inside `fireDueTimers` (line 11) with:

```js
  const due = selectDueTimers(now);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/timerTick.test.js`
Expected: PASS.

Full suite:
Run: `node --test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/timerTick.js tests/timerTick.test.js
git commit -m "feat(timer): skip paused timers in tick job"
```

---

## Task 5: Add `timer` panel type

**Files:**
- Modify: `src/panel/types.js`
- Test: `tests/timerPanel.test.js` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/timerPanel.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ButtonStyle } from 'discord.js';
import { buildPanel, PANEL_TYPES } from '../src/panel/types.js';

test('timer is a valid panel type', () => {
  assert.ok(PANEL_TYPES.includes('timer'));
});

test('buildPanel("timer") renders correct title and button layout', () => {
  const payload = buildPanel('timer');
  const embed = payload.embeds[0].toJSON();
  const rows = payload.components.map(r => r.toJSON().components);

  assert.equal(embed.title, '⏱️ Timer Control');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.length), [4, 3]);

  assert.deepEqual(
    rows.flat().map(c => c.custom_id),
    [
      'timer:preset:7m',
      'timer:preset:10m',
      'timer:preset:13m',
      'timer:custom',
      'timer:pause',
      'timer:stop',
      'timer:status',
    ],
  );

  // Pause is warning-ish, Stop is danger, others secondary
  const stopBtn = rows.flat().find(c => c.custom_id === 'timer:stop');
  assert.equal(stopBtn.style, ButtonStyle.Danger);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/timerPanel.test.js`
Expected: FAIL — `timer` is not in `PANEL_TYPES`.

- [ ] **Step 3: Add timer to PANEL_TYPES, COLOR, titles, descriptions, footers, rowBuilders**

In `src/panel/types.js`:

(a) Change line 6 from:
```js
export const PANEL_TYPES = ['defense', 'offense', 'resources', 'scout', 'general', 'roles'];
```
to:
```js
export const PANEL_TYPES = ['defense', 'offense', 'resources', 'scout', 'general', 'roles', 'timer'];
```

(b) In the `COLOR` object (lines 8-15), add `timer: 0xf1c40f` as the last entry.

(c) In the `titles` object, add:
```js
  timer:     '⏱️ Timer Control',
```

(d) In the `descriptions` object, add:
```js
  timer: [
    'Personal recurring reminder. Pick a preset to start, or use Custom… for any interval.',
    'Pause keeps the time left in the current cycle; Resume picks up from there. Stop clears your timer.',
    '*Your timer is private — clicks reply only to you.*',
  ].join('\n'),
```

(e) In the `footers` object, add:
```js
  timer: 'Your timer is private — each click replies only to you.',
```

(f) In the `rowBuilders` object, add this entry:
```js
  timer: () => [
    new ActionRowBuilder().addComponents(
      btn('timer:preset:7m',  '7m',         '⏱️'),
      btn('timer:preset:10m', '10m',        '⏱️'),
      btn('timer:preset:13m', '13m',        '⏱️'),
      btn('timer:custom',     'Custom…',    '⚙️', ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      btn('timer:pause',  'Pause',  '⏸️'),
      btn('timer:stop',   'Stop',   '⏹️', ButtonStyle.Danger),
      btn('timer:status', 'Status', '📊'),
    ),
  ],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/timerPanel.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panel/types.js tests/timerPanel.test.js
git commit -m "feat(panel): add timer panel type"
```

---

## Task 6: Add `/setup timer` subcommand

**Files:**
- Modify: `src/commands/definitions.js`
- Test: `tests/timerPanel.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/timerPanel.test.js`:

```js
import { commandDefinitions } from '../src/commands/definitions.js';

test('/setup exposes a timer subcommand', () => {
  const setup = commandDefinitions.find(c => c.name === 'setup');
  assert.ok(setup);
  assert.ok(setup.options.some(o => o.name === 'timer'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/timerPanel.test.js`
Expected: the new test FAILS.

- [ ] **Step 3: Add the subcommand**

In `src/commands/definitions.js`, find the `setup` `SlashCommandBuilder` (lines 6-15) and add a new `.addSubcommand(...)` after the `roles` line:

```js
    .addSubcommand(s => s.setName('roles').setDescription('Crew role selection panel'))
    .addSubcommand(s => s.setName('timer').setDescription('Personal timer control panel')),
```

(Move the closing `,` from after `roles` line to after the new `timer` line — `setup` is a list entry in `commandDefinitions`, so the comma terminates it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/timerPanel.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/definitions.js tests/timerPanel.test.js
git commit -m "feat(setup): add timer panel subcommand"
```

---

## Task 7: Panel preset + custom-modal Start handlers

**Files:**
- Modify: `src/handlers/timer.js`
- Modify: `src/handlers/router.js`
- Test: `tests/handlers/timerPanel.test.js` (new file)

Adds three exports to `timer.js`:
- `handleTimerPanelPreset(interaction)` — `timer:preset:7m` / `:10m` / `:13m`
- `handleTimerPanelCustom(interaction)` — opens the Custom modal
- `handleTimerPanelCustomModal(interaction)` — modal submit, validates, starts timer

- [ ] **Step 1: Write the failing test**

Create `tests/handlers/timerPanel.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import {
  handleTimerPanelPreset,
  handleTimerPanelCustomModal,
} from '../../src/handlers/timer.js';
import { unixNow } from '../../src/utils/time.js';

function makeButtonInteraction({ userId = 'u1', channelId = 'c1', customId }) {
  const calls = [];
  return {
    user: { id: userId },
    channel: { id: channelId },
    customId,
    async reply(payload) { calls.push(['reply', payload]); this.replied = true; },
    _calls: calls,
  };
}

function makeModalInteraction({ userId = 'u1', channelId = 'c1', fields = {} }) {
  const calls = [];
  return {
    user: { id: userId },
    channel: { id: channelId },
    customId: 'timer:custom_submit',
    fields: {
      getTextInputValue(name) { return fields[name] ?? ''; },
    },
    async reply(payload) { calls.push(['reply', payload]); this.replied = true; },
    _calls: calls,
  };
}

test('preset 7m starts a new timer', async () => {
  await setupTestDb();
  resetTables();

  const ix = makeButtonInteraction({ customId: 'timer:preset:7m' });
  await handleTimerPanelPreset(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.interval_sec, 420);
  assert.equal(row.paused, 0);
  assert.equal(row.fires_count, 0);

  const [_, payload] = ix._calls[0];
  assert.equal(payload.ephemeral, true);
  assert.match(payload.content, /started|replaced/i);
});

test('preset replaces existing timer and resets fires', async () => {
  await setupTestDb();
  resetTables();

  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 60, 100, 5, 'old', 0, null);

  const ix = makeButtonInteraction({ customId: 'timer:preset:10m' });
  await handleTimerPanelPreset(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.interval_sec, 600);
  assert.equal(row.fires_count, 0);
});

test('custom modal with valid interval starts timer', async () => {
  await setupTestDb();
  resetTables();

  const ix = makeModalInteraction({ fields: { interval: '15m', label: 'farm' } });
  await handleTimerPanelCustomModal(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.interval_sec, 900);
  assert.equal(row.label, 'farm');
});

test('custom modal with invalid interval replies with error and no DB write', async () => {
  await setupTestDb();
  resetTables();

  const ix = makeModalInteraction({ fields: { interval: 'banana' } });
  await handleTimerPanelCustomModal(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row, undefined);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /invalid interval/i);
  assert.equal(payload.ephemeral, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/handlers/timerPanel.test.js`
Expected: FAIL — the panel handlers don't exist yet.

- [ ] **Step 3: Implement the three handlers**

In `src/handlers/timer.js`, **add** these imports to the existing `import` block at the top:

```js
import {
  EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
```

(That replaces the existing `import { EmbedBuilder } from 'discord.js';` line.)

Then **append** these exports at the bottom of `src/handlers/timer.js`:

```js
const PRESETS = {
  '7m':  7 * 60,
  '10m': 10 * 60,
  '13m': 13 * 60,
};

function startedReply(intervalSec, replaced) {
  const verb = replaced ? 'replaced' : 'started';
  const next = unixNow() + intervalSec;
  return {
    content:
      `▶️ Timer ${verb} — every **${formatDuration(intervalSec)}**, next ping ${discordTimestamp(next, 'R')}.` +
      (replaced ? ' Fires reset.' : ''),
    ephemeral: true,
  };
}

export async function handleTimerPanelPreset(interaction) {
  const key = interaction.customId.split(':')[2];
  const intervalSec = PRESETS[key];
  if (!intervalSec) {
    return interaction.reply({ content: 'Unknown preset.', ephemeral: true });
  }

  const existing = prepare('SELECT user_id FROM timers WHERE user_id = ?').get(interaction.user.id);
  startOrReplaceTimer({
    userId:      interaction.user.id,
    channelId:   interaction.channel.id,
    intervalSec,
    label:       null,
  });
  await interaction.reply(startedReply(intervalSec, !!existing));
}

export async function handleTimerPanelCustom(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('timer:custom_submit')
    .setTitle('Custom Timer');

  const interval = new TextInputBuilder()
    .setCustomId('interval')
    .setLabel('Interval (e.g. 7m, 1h30m, 90s)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('10m')
    .setMaxLength(20);

  const label = new TextInputBuilder()
    .setCustomId('label')
    .setLabel('Label (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(40);

  modal.addComponents(
    new ActionRowBuilder().addComponents(interval),
    new ActionRowBuilder().addComponents(label),
  );

  await interaction.showModal(modal);
}

export async function handleTimerPanelCustomModal(interaction) {
  const intervalRaw = interaction.fields.getTextInputValue('interval');
  const labelRaw    = interaction.fields.getTextInputValue('label');
  const intervalSec = parseDuration(intervalRaw);

  if (!intervalSec) {
    return interaction.reply({
      content: '❌ Invalid interval. Examples: `7m`, `90s`, `1h30m`. Min 60s, max 24h.',
      ephemeral: true,
    });
  }

  const existing = prepare('SELECT user_id FROM timers WHERE user_id = ?').get(interaction.user.id);
  startOrReplaceTimer({
    userId:      interaction.user.id,
    channelId:   interaction.channel.id,
    intervalSec,
    label:       labelRaw?.trim() || null,
  });
  await interaction.reply(startedReply(intervalSec, !!existing));
}
```

- [ ] **Step 4: Wire the handlers into the router**

In `src/handlers/router.js`:

(a) Extend the existing `handleTimerCommand` import to also pull in the three new handlers:

```js
import {
  handleTimerCommand,
  handleTimerPanelPreset,
  handleTimerPanelCustom,
  handleTimerPanelCustomModal,
} from './timer.js';
```

(b) In `routeButton`, **before** the catch-all `return await interaction.reply({ content: 'Unknown button.', ...})` at the bottom, add:

```js
    if (ns === 'timer') {
      if (action === 'preset') return await handleTimerPanelPreset(interaction);
      if (action === 'custom') return await handleTimerPanelCustom(interaction);
    }
```

(c) In `routeModal`, **before** the `return await notImplemented(interaction);` line, add:

```js
    if (id === 'timer:custom_submit')           return await handleTimerPanelCustomModal(interaction);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/handlers/timerPanel.test.js`
Expected: all four tests PASS.

Full suite:
Run: `node --test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/timer.js src/handlers/router.js tests/handlers/timerPanel.test.js
git commit -m "feat(timer): panel preset and custom Start handlers"
```

---

## Task 8: Panel Pause toggle handler

**Files:**
- Modify: `src/handlers/timer.js`
- Modify: `src/handlers/router.js`
- Test: `tests/handlers/timerPanel.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/handlers/timerPanel.test.js`:

```js
import { handleTimerPanelPause } from '../../src/handlers/timer.js';

test('Pause with no timer replies "no active timer"', async () => {
  await setupTestDb();
  resetTables();

  const ix = makeButtonInteraction({ customId: 'timer:pause' });
  await handleTimerPanelPause(ix);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /no active timer/i);
  assert.equal(payload.ephemeral, true);
});

test('Pause on a running timer captures remaining_sec', async () => {
  await setupTestDb();
  resetTables();

  const now = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, now + 250, 4, null, 0, null);

  const ix = makeButtonInteraction({ customId: 'timer:pause' });
  await handleTimerPanelPause(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.paused, 1);
  assert.ok(row.remaining_sec >= 249 && row.remaining_sec <= 250);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /paused/i);
});

test('Pause on a paused timer resumes it', async () => {
  await setupTestDb();
  resetTables();

  const before = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, before - 100, 4, null, 1, 250);

  const ix = makeButtonInteraction({ customId: 'timer:pause' });
  await handleTimerPanelPause(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.paused, 0);
  assert.equal(row.remaining_sec, null);
  assert.ok(row.next_fire_at >= before + 250 && row.next_fire_at <= before + 251);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /resumed/i);
});

test('Pause on a paused timer with 0 remaining resumes and fires immediately', async () => {
  await setupTestDb();
  resetTables();

  const before = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, before - 9999, 4, null, 1, 0);

  const ix = makeButtonInteraction({ customId: 'timer:pause' });
  await handleTimerPanelPause(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row.paused, 0);
  assert.ok(row.next_fire_at <= before + 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/handlers/timerPanel.test.js`
Expected: the four new tests FAIL — `handleTimerPanelPause` doesn't exist.

- [ ] **Step 3: Implement the toggle handler**

Append to `src/handlers/timer.js`:

```js
export async function handleTimerPanelPause(interaction) {
  const userId = interaction.user.id;
  const t = prepare('SELECT * FROM timers WHERE user_id = ?').get(userId);

  if (!t) {
    return interaction.reply({
      content: 'You have no active timer. Pick a preset (7m / 10m / 13m) or Custom… to start one.',
      ephemeral: true,
    });
  }

  if (t.paused) {
    // Resume
    const remaining = Math.max(0, t.remaining_sec ?? 0);
    const next = unixNow() + remaining;
    prepare(`
      UPDATE timers SET paused = 0, remaining_sec = NULL, next_fire_at = ? WHERE user_id = ?
    `).run(next, userId);
    return interaction.reply({
      content: `▶️ Resumed — next ping ${discordTimestamp(next, 'R')}.`,
      ephemeral: true,
    });
  }

  // Pause
  const remaining = Math.max(0, t.next_fire_at - unixNow());
  prepare(`
    UPDATE timers SET paused = 1, remaining_sec = ? WHERE user_id = ?
  `).run(remaining, userId);
  return interaction.reply({
    content: `⏸️ Paused — **${formatDuration(remaining)}** left in this cycle. Tap Pause again to resume.`,
    ephemeral: true,
  });
}
```

- [ ] **Step 4: Wire into router**

In `src/handlers/router.js`, extend the timer import:

```js
import {
  handleTimerCommand,
  handleTimerPanelPreset,
  handleTimerPanelCustom,
  handleTimerPanelCustomModal,
  handleTimerPanelPause,
} from './timer.js';
```

And add a line to the `ns === 'timer'` block in `routeButton`:

```js
    if (ns === 'timer') {
      if (action === 'preset') return await handleTimerPanelPreset(interaction);
      if (action === 'custom') return await handleTimerPanelCustom(interaction);
      if (action === 'pause')  return await handleTimerPanelPause(interaction);
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/handlers/timerPanel.test.js`
Expected: all pause tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/timer.js src/handlers/router.js tests/handlers/timerPanel.test.js
git commit -m "feat(timer): panel Pause/Resume toggle"
```

---

## Task 9: Panel Stop + Status handlers

**Files:**
- Modify: `src/handlers/timer.js`
- Modify: `src/handlers/router.js`
- Test: `tests/handlers/timerPanel.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/handlers/timerPanel.test.js`:

```js
import {
  handleTimerPanelStop,
  handleTimerPanelStatus,
} from '../../src/handlers/timer.js';

test('Stop with no timer replies "no active timer"', async () => {
  await setupTestDb();
  resetTables();

  const ix = makeButtonInteraction({ customId: 'timer:stop' });
  await handleTimerPanelStop(ix);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /no active timer/i);
});

test('Stop deletes the row and reports fires_count', async () => {
  await setupTestDb();
  resetTables();

  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, 9_999_999_999, 7, null, 0, null);

  const ix = makeButtonInteraction({ customId: 'timer:stop' });
  await handleTimerPanelStop(ix);

  const row = prepare('SELECT * FROM timers WHERE user_id = ?').get('u1');
  assert.equal(row, undefined);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /stopped/i);
  assert.match(payload.content, /7/);
});

test('Status with no timer replies "no active timer"', async () => {
  await setupTestDb();
  resetTables();

  const ix = makeButtonInteraction({ customId: 'timer:status' });
  await handleTimerPanelStatus(ix);

  const [_, payload] = ix._calls[0];
  assert.match(payload.content, /no active timer/i);
});

test('Status renders the State-field embed for the calling user', async () => {
  await setupTestDb();
  resetTables();

  const now = unixNow();
  prepare(`
    INSERT INTO timers (user_id, channel_id, interval_sec, next_fire_at, fires_count, label, paused, remaining_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('u1', 'c1', 600, now + 250, 3, 'raid', 0, null);

  const ix = makeButtonInteraction({ customId: 'timer:status' });
  await handleTimerPanelStatus(ix);

  const [_, payload] = ix._calls[0];
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.title, '⏱️ Your Timer');
  assert.ok(embed.fields.some(f => f.name === 'State'));
  assert.equal(payload.ephemeral, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/handlers/timerPanel.test.js`
Expected: the four new tests FAIL — `handleTimerPanelStop` / `handleTimerPanelStatus` don't exist.

- [ ] **Step 3: Implement Stop and Status handlers**

Append to `src/handlers/timer.js`:

```js
export async function handleTimerPanelStop(interaction) {
  const t = prepare('SELECT * FROM timers WHERE user_id = ?').get(interaction.user.id);
  if (!t) {
    return interaction.reply({
      content: 'You have no active timer.',
      ephemeral: true,
    });
  }
  prepare('DELETE FROM timers WHERE user_id = ?').run(interaction.user.id);
  await interaction.reply({
    content: `⏹️ Timer stopped. Fired ${t.fires_count} time(s).`,
    ephemeral: true,
  });
}

export async function handleTimerPanelStatus(interaction) {
  const t = prepare('SELECT * FROM timers WHERE user_id = ?').get(interaction.user.id);
  if (!t) {
    return interaction.reply({
      content: 'You have no active timer. Pick a preset (7m / 10m / 13m) or Custom… to start one.',
      ephemeral: true,
    });
  }
  await interaction.reply({ embeds: [buildStatusEmbed(t)], ephemeral: true });
}
```

- [ ] **Step 4: Wire into router**

In `src/handlers/router.js`, extend the timer import:

```js
import {
  handleTimerCommand,
  handleTimerPanelPreset,
  handleTimerPanelCustom,
  handleTimerPanelCustomModal,
  handleTimerPanelPause,
  handleTimerPanelStop,
  handleTimerPanelStatus,
} from './timer.js';
```

And extend the `ns === 'timer'` block in `routeButton`:

```js
    if (ns === 'timer') {
      if (action === 'preset') return await handleTimerPanelPreset(interaction);
      if (action === 'custom') return await handleTimerPanelCustom(interaction);
      if (action === 'pause')  return await handleTimerPanelPause(interaction);
      if (action === 'stop')   return await handleTimerPanelStop(interaction);
      if (action === 'status') return await handleTimerPanelStatus(interaction);
    }
```

- [ ] **Step 5: Run the full suite to verify everything passes**

Run: `node --test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/timer.js src/handlers/router.js tests/handlers/timerPanel.test.js
git commit -m "feat(timer): panel Stop and Status handlers"
```

---

## Task 10: Documentation update

**Files:**
- Modify: `AUTOMATIONS.md`
- Modify: `COMMANDS.md`

- [ ] **Step 1: Update AUTOMATIONS.md**

In `AUTOMATIONS.md`, find the `## Timer tick` section. Update item 1 of the two-responsibility list to mention the paused filter:

Change:
```
1. **Fire due timers** — for each row in `timers` with `next_fire_at <= now`, send a reminder ping in the configured channel, advance `next_fire_at`, increment `fires_count`.
```

To:
```
1. **Fire due timers** — for each row in `timers` with `next_fire_at <= now AND paused = 0`, send a reminder ping in the configured channel, advance `next_fire_at`, increment `fires_count`. Paused timers are skipped entirely; their `remaining_sec` is preserved until Resume.
```

- [ ] **Step 2: Update COMMANDS.md — add the panel row**

In `COMMANDS.md`, find the `/setup roles` line (around line 176) and add a new row immediately after it:

```
| `/setup timer` | — | Post + pin the **Timer** control panel (7/10/13m presets, Custom…, Pause, Stop, Status) |
```

- [ ] **Step 3: Update COMMANDS.md — add panel reference to the /timer section**

In `COMMANDS.md`, find the Behavior note for `/timer` (the line starting `**Behavior:** the bot mentions you every `interval`...`, around line 158). Append a second sentence:

```
The same operations are reachable via the pinned panel deployed with `/setup timer` — buttons for 7m / 10m / 13m / Custom…, plus Pause (toggle), Stop, and Status. Pause preserves the remaining time and Resume picks up from there.
```

- [ ] **Step 4: Commit**

```bash
git add AUTOMATIONS.md COMMANDS.md
git commit -m "docs(timer): document panel and paused-tick behavior"
```

---

## Done

After Task 10, the panel can be deployed in any channel with `/setup timer` and supports the full Set/Pause/Stop/Status workflow described in [the spec](../specs/2026-05-15-timer-panel-design.md).

Final check before merging:

- [ ] Run the full test suite one more time: `node --test`
- [ ] Manually deploy the panel in a test channel and click every button (preset, custom modal valid + invalid, pause, resume, stop, status, then all buttons again with no timer).
- [ ] Confirm a paused timer survives a bot restart (the `paused` column is persisted; on restart, the tick job continues to skip it).
