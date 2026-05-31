# Scout Report Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build GUI-first scout report channels: each scout request creates a temporary channel, accepts one deliberate screenshot report, archives it to `#scout-reports`, and deletes the temporary channel 24 hours after report submission.

**Architecture:** Keep existing `calls`/`pledges` behavior, but add a `scout_reports` lifecycle table and focused helper modules. `src/handlers/scoutCall.js` remains the user interaction owner; new scout setup/channel helpers handle Discord channel creation, a new upload handler owns pending screenshot capture, and a cleanup job owns delayed temp-channel deletion.

**Tech Stack:** Node.js ESM, discord.js v14, sql.js, node:test, node-cron.

---

## File Structure

- Create `src/utils/scoutReports.js`: pure helpers for constants, code generation, channel-name slugging, commitment parsing, and image attachment validation.
- Create `src/utils/scoutChannels.js`: Discord channel helpers for finding/creating `Scouting`, `scout-reports`, and per-call temporary scout channels.
- Create `src/handlers/scoutReportUpload.js`: pending upload state, `Submit Report` modal completion, attachment message handling, archive posting, and report finalization.
- Create `src/jobs/scoutReportCleanup.js`: periodic cleanup for reported scout temp channels whose `delete_after` timestamp has passed.
- Modify `src/db/schema.sql`: add `scout_reports`.
- Modify `src/db/migrations.js`: create `scout_reports` for existing databases.
- Modify `tests/helpers/testDb.js`: include `scout_reports` in test reset order.
- Modify `src/commands/admin.js`: make `/setup scout` ensure scout infrastructure before deploying the panel.
- Modify `src/commands/definitions.js`: add optional `/scout min-scouts` mirror field.
- Modify `src/handlers/scoutCall.js`: add minimum scouts, temp channel creation, report status rendering, numeric commitment modal, and handoff to upload handler.
- Modify `src/handlers/router.js`: route updated scout report modal submit.
- Modify `src/index.js`: register `messageCreate` handling and start scout cleanup job.
- Modify `COMMANDS.md`: document new scout GUI behavior.
- Test files:
  - Create `tests/scoutReports.test.js`
  - Create `tests/scoutChannels.test.js`
  - Create `tests/handlers/scoutReportUpload.test.js`
  - Create `tests/jobs/scoutReportCleanup.test.js`
  - Extend `tests/migrations.test.js`

## Task 1: Schema and Test Reset

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrations.js`
- Modify: `tests/helpers/testDb.js`
- Modify: `tests/migrations.test.js`

- [ ] **Step 1: Write the failing migration test**

Append this test to `tests/migrations.test.js`:

```js
test('migration creates scout_reports table with lifecycle columns', async () => {
  await setupTestDb();
  resetTables();

  const cols = prepare(`PRAGMA table_info(scout_reports)`).all();
  const byName = Object.fromEntries(cols.map(c => [c.name, c]));

  for (const name of [
    'call_id',
    'scout_code',
    'temp_channel_id',
    'archive_channel_id',
    'archive_message_id',
    'reporter_id',
    'report_note',
    'screenshot_url',
    'reported_at',
    'delete_after',
    'temp_deleted_at',
    'created_at',
  ]) {
    assert.ok(byName[name], `${name} column exists`);
  }

  assert.equal(byName.call_id.pk, 1);
  assert.equal(byName.scout_code.notnull, 1);
  assert.equal(byName.temp_channel_id.notnull, 1);
});
```

- [ ] **Step 2: Run the migration test to verify it fails**

Run: `npm test -- tests/migrations.test.js`

Expected: FAIL with an assertion that `call_id column exists` is missing because `scout_reports` does not exist yet.

- [ ] **Step 3: Add the schema table**

Add this block to `src/db/schema.sql` after the `pledges` table:

```sql
CREATE TABLE IF NOT EXISTS scout_reports (
  call_id             INTEGER PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  scout_code          TEXT NOT NULL,
  temp_channel_id     TEXT NOT NULL,
  archive_channel_id  TEXT,
  archive_message_id  TEXT,
  reporter_id         TEXT,
  report_note         TEXT,
  screenshot_url      TEXT,
  reported_at         INTEGER,
  delete_after        INTEGER,
  temp_deleted_at     INTEGER,
  created_at          INTEGER DEFAULT (unixepoch())
);
```

- [ ] **Step 4: Add the migration**

Add this block in `runMigrations()` after the `pending_message_deletes` table migration:

```js
  try {
    exec(`
      CREATE TABLE IF NOT EXISTS scout_reports (
        call_id             INTEGER PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
        scout_code          TEXT NOT NULL,
        temp_channel_id     TEXT NOT NULL,
        archive_channel_id  TEXT,
        archive_message_id  TEXT,
        reporter_id         TEXT,
        report_note         TEXT,
        screenshot_url      TEXT,
        reported_at         INTEGER,
        delete_after        INTEGER,
        temp_deleted_at     INTEGER,
        created_at          INTEGER DEFAULT (unixepoch())
      )
    `);
  } catch (err) {
    logger.warn('Migration scout_reports table skipped:', err.message);
  }
```

- [ ] **Step 5: Update test reset order**

In `tests/helpers/testDb.js`, add `scout_reports` before `pledges`:

```js
const ALL_TABLES = [
  'user_ign_links',
  'travian_accounts',
  'scout_reports',
  'pledges',
  'calls',
  'panels',
  'timers',
  'x_world',
  'users',
  'config',
];
```

- [ ] **Step 6: Run the migration test to verify it passes**

Run: `npm test -- tests/migrations.test.js`

Expected: PASS for all migration tests.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.sql src/db/migrations.js tests/helpers/testDb.js tests/migrations.test.js
git commit -m "feat(scout): add report lifecycle table"
```

## Task 2: Pure Scout Report Helpers

**Files:**
- Create: `src/utils/scoutReports.js`
- Create: `tests/scoutReports.test.js`

- [ ] **Step 1: Write failing helper tests**

Create `tests/scoutReports.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOUT_CATEGORY_NAME,
  SCOUT_REPORTS_CHANNEL_NAME,
  REPORT_UPLOAD_WINDOW_SEC,
  TEMP_CHANNEL_DELETE_DELAY_SEC,
  buildScoutChannelName,
  generateScoutCode,
  parseScoutCommitmentAmount,
  isValidScoutImageAttachment,
} from '../src/utils/scoutReports.js';

test('scout report constants match approved channel workflow', () => {
  assert.equal(SCOUT_CATEGORY_NAME, 'Scouting');
  assert.equal(SCOUT_REPORTS_CHANNEL_NAME, 'scout-reports');
  assert.equal(REPORT_UPLOAD_WINDOW_SEC, 600);
  assert.equal(TEMP_CHANNEL_DELETE_DELAY_SEC, 86400);
});

test('generateScoutCode returns four lowercase alphanumeric characters', () => {
  const code = generateScoutCode(() => 0.5);
  assert.match(code, /^[a-z0-9]{4}$/);
});

test('buildScoutChannelName keeps negative coordinates unambiguous', () => {
  assert.equal(
    buildScoutChannelName({ code: 'a3f9', x: -50, y: 72, player: 'Enemy Name' }),
    'scout-a3f9-x-50-y72-enemy-name',
  );
  assert.equal(
    buildScoutChannelName({ code: 'k8q2', x: 35, y: -88, player: null }),
    'scout-k8q2-x35-y-88-unknown',
  );
});

test('buildScoutChannelName strips unsafe characters and truncates long names', () => {
  const name = buildScoutChannelName({
    code: 'z9z9',
    x: 1,
    y: 2,
    player: 'Very Long ./ Player_Name That Should Be Truncated After A Reasonable Point',
  });

  assert.match(name, /^scout-z9z9-x1-y2-very-long-player-name-that-should-be/);
  assert.ok(name.length <= 90);
  assert.doesNotMatch(name, /[ ./_]/);
});

test('parseScoutCommitmentAmount returns numeric commitments only', () => {
  assert.equal(parseScoutCommitmentAmount('50'), 50);
  assert.equal(parseScoutCommitmentAmount(' 500+ '), 500);
  assert.equal(parseScoutCommitmentAmount('1,250 scouts'), 1250);
  assert.equal(parseScoutCommitmentAmount('On it'), null);
  assert.equal(parseScoutCommitmentAmount(''), null);
});

test('isValidScoutImageAttachment accepts known image attachments', () => {
  assert.equal(isValidScoutImageAttachment({ contentType: 'image/png', name: 'report.txt' }), true);
  assert.equal(isValidScoutImageAttachment({ contentType: null, name: 'report.webp' }), true);
  assert.equal(isValidScoutImageAttachment({ contentType: 'text/plain', name: 'report.png' }), true);
  assert.equal(isValidScoutImageAttachment({ contentType: 'application/pdf', name: 'report.pdf' }), false);
  assert.equal(isValidScoutImageAttachment({ contentType: null, name: null }), false);
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `npm test -- tests/scoutReports.test.js`

Expected: FAIL because `src/utils/scoutReports.js` does not exist.

- [ ] **Step 3: Add helper implementation**

Create `src/utils/scoutReports.js`:

```js
export const SCOUT_CATEGORY_NAME = 'Scouting';
export const SCOUT_REPORTS_CHANNEL_NAME = 'scout-reports';
export const REPORT_UPLOAD_WINDOW_SEC = 10 * 60;
export const TEMP_CHANNEL_DELETE_DELAY_SEC = 24 * 60 * 60;

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

export function generateScoutCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    const idx = Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length;
    code += CODE_ALPHABET[idx];
  }
  return code;
}

export function slugifyScoutPlayer(player) {
  const raw = String(player || 'unknown').trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42)
    .replace(/-+$/g, '');
  return slug || 'unknown';
}

export function buildScoutChannelName({ code, x, y, player }) {
  const base = `scout-${code}-x${x}-y${y}-${slugifyScoutPlayer(player)}`;
  return base.slice(0, 90).replace(/-+$/g, '');
}

export function parseScoutCommitmentAmount(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const match = raw.replace(/,/g, '').match(/^(\d+)/);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function isValidScoutImageAttachment(attachment) {
  const contentType = String(attachment?.contentType || '').toLowerCase();
  if (contentType.startsWith('image/')) return true;
  const name = String(attachment?.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return IMAGE_EXTENSIONS.has(ext);
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `npm test -- tests/scoutReports.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/scoutReports.js tests/scoutReports.test.js
git commit -m "feat(scout): add report helper utilities"
```

## Task 3: Scout Infrastructure Channel Helpers

**Files:**
- Create: `src/utils/scoutChannels.js`
- Create: `tests/scoutChannels.test.js`

- [ ] **Step 1: Write failing channel helper tests**

Create `tests/scoutChannels.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import {
  findChannelByNameAndType,
  findChildChannelByName,
  ensureScoutInfrastructure,
} from '../src/utils/scoutChannels.js';

function fakeChannel(id, name, type, parentId = null) {
  return { id, name, type, parentId };
}

function fakeGuild(existing = []) {
  const channels = [...existing];
  const cache = {
    values() {
      return channels.values();
    },
  };

  return {
    channels: {
      cache,
      async create(payload) {
        const channel = fakeChannel(`created-${channels.length + 1}`, payload.name, payload.type, payload.parent ?? null);
        channels.push(channel);
        return channel;
      },
    },
    _channels: channels,
  };
}

test('findChannelByNameAndType matches case-insensitive channel name and type', () => {
  const guild = fakeGuild([
    fakeChannel('1', 'Scouting', ChannelType.GuildCategory),
    fakeChannel('2', 'scout-reports', ChannelType.GuildText),
  ]);

  assert.equal(findChannelByNameAndType(guild, 'scouting', ChannelType.GuildCategory).id, '1');
  assert.equal(findChannelByNameAndType(guild, 'SCOUT-REPORTS', ChannelType.GuildText).id, '2');
  assert.equal(findChannelByNameAndType(guild, 'missing', ChannelType.GuildText), null);
});

test('findChildChannelByName requires matching parent id', () => {
  const guild = fakeGuild([
    fakeChannel('1', 'scout-reports', ChannelType.GuildText, 'cat-a'),
    fakeChannel('2', 'scout-reports', ChannelType.GuildText, 'cat-b'),
  ]);

  assert.equal(findChildChannelByName(guild, 'scout-reports', 'cat-b').id, '2');
  assert.equal(findChildChannelByName(guild, 'scout-reports', 'cat-c'), null);
});

test('ensureScoutInfrastructure creates missing Scouting category and archive channel', async () => {
  const guild = fakeGuild();

  const result = await ensureScoutInfrastructure(guild);

  assert.equal(result.category.name, 'Scouting');
  assert.equal(result.archiveChannel.name, 'scout-reports');
  assert.equal(result.archiveChannel.parentId, result.category.id);
  assert.equal(guild._channels.length, 2);
});

test('ensureScoutInfrastructure reuses existing category and archive channel', async () => {
  const guild = fakeGuild([
    fakeChannel('cat-1', 'Scouting', ChannelType.GuildCategory),
    fakeChannel('archive-1', 'scout-reports', ChannelType.GuildText, 'cat-1'),
  ]);

  const result = await ensureScoutInfrastructure(guild);

  assert.equal(result.category.id, 'cat-1');
  assert.equal(result.archiveChannel.id, 'archive-1');
  assert.equal(guild._channels.length, 2);
});
```

- [ ] **Step 2: Run channel helper tests to verify they fail**

Run: `npm test -- tests/scoutChannels.test.js`

Expected: FAIL because `src/utils/scoutChannels.js` does not exist.

- [ ] **Step 3: Add channel helper implementation**

Create `src/utils/scoutChannels.js`:

```js
import { ChannelType } from 'discord.js';
import { setConfig } from '../db/client.js';
import {
  SCOUT_CATEGORY_NAME,
  SCOUT_REPORTS_CHANNEL_NAME,
  buildScoutChannelName,
} from './scoutReports.js';

function sameName(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

export function findChannelByNameAndType(guild, name, type) {
  return Array.from(guild?.channels?.cache?.values?.() ?? [])
    .find(channel => sameName(channel.name, name) && channel.type === type) ?? null;
}

export function findChildChannelByName(guild, name, parentId) {
  return Array.from(guild?.channels?.cache?.values?.() ?? [])
    .find(channel =>
      sameName(channel.name, name)
      && channel.type === ChannelType.GuildText
      && channel.parentId === parentId
    ) ?? null;
}

export async function ensureScoutInfrastructure(guild) {
  if (!guild) throw new Error('Scout setup requires a Discord guild.');

  let category = findChannelByNameAndType(guild, SCOUT_CATEGORY_NAME, ChannelType.GuildCategory);
  if (!category) {
    category = await guild.channels.create({
      name: SCOUT_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
    });
  }

  let archiveChannel = findChildChannelByName(guild, SCOUT_REPORTS_CHANNEL_NAME, category.id)
    ?? findChannelByNameAndType(guild, SCOUT_REPORTS_CHANNEL_NAME, ChannelType.GuildText);

  if (!archiveChannel) {
    archiveChannel = await guild.channels.create({
      name: SCOUT_REPORTS_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      reason: 'Travian scout report archive',
    });
  }

  setConfig('scouting_category_id', category.id);
  setConfig('scout_reports_channel_id', archiveChannel.id);

  return { category, archiveChannel };
}

export async function createScoutTempChannel(guild, { category, code, x, y, player, topic }) {
  const name = buildScoutChannelName({ code, x, y, player });
  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    topic,
    reason: `Travian scout request ${code}`,
  });
}
```

- [ ] **Step 4: Run channel helper tests to verify they pass**

Run: `npm test -- tests/scoutChannels.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/scoutChannels.js tests/scoutChannels.test.js
git commit -m "feat(scout): add channel setup helpers"
```

## Task 4: Setup Scout Infrastructure

**Files:**
- Modify: `src/commands/admin.js`
- Test: `tests/scoutChannels.test.js`

- [ ] **Step 1: Write failing setup handler test**

Append this test to `tests/scoutChannels.test.js`:

```js
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { getConfig } from '../src/db/client.js';
import { handleSetup } from '../src/commands/admin.js';

test('handleSetup scout creates infrastructure before deploying panel', async () => {
  await setupTestDb();
  resetTables();

  const guild = fakeGuild();
  const calls = [];
  const interaction = {
    guild,
    channel: {
      id: 'panel-channel',
      name: 'scout-panel',
      messages: { async fetch() { throw new Error('no old panel'); } },
      async send(payload) {
        calls.push(['send', payload]);
        return { id: 'panel-msg', async pin() {} };
      },
    },
    options: { getSubcommand: () => 'scout' },
    async deferReply(payload) { calls.push(['deferReply', payload]); },
    async editReply(payload) { calls.push(['editReply', payload]); },
  };

  await handleSetup(interaction);

  assert.equal(getConfig('scouting_category_id'), 'created-1');
  assert.equal(getConfig('scout_reports_channel_id'), 'created-2');
  assert.equal(calls.at(-1)[1].content, '✅ scout panel deployed and pinned.');
});
```

- [ ] **Step 2: Run the setup test to verify it fails**

Run: `npm test -- tests/scoutChannels.test.js`

Expected: FAIL because `handleSetup` deploys the panel without creating scout infrastructure.

- [ ] **Step 3: Update setup handler**

Modify the imports at the top of `src/commands/admin.js`:

```js
import { ensureScoutInfrastructure } from '../utils/scoutChannels.js';
```

Replace `handleSetup` with:

```js
export async function handleSetup(interaction) {
  const type = interaction.options.getSubcommand();
  if (type === 'scout') {
    try {
      await ensureScoutInfrastructure(interaction.guild);
    } catch (err) {
      logger.warn('Scout setup infrastructure failed:', err.message);
      return interaction.reply({
        content: `❌ Could not prepare scout channels: ${err.message}`,
        ephemeral: true,
      });
    }
  }
  await deployPanel(interaction, type);
}
```

- [ ] **Step 4: Run setup/channel tests to verify they pass**

Run: `npm test -- tests/scoutChannels.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/admin.js tests/scoutChannels.test.js
git commit -m "feat(scout): prepare archive channels during setup"
```

## Task 5: Scout Request Creates Temporary Channel

**Files:**
- Modify: `src/commands/definitions.js`
- Modify: `src/handlers/scoutCall.js`
- Test: `tests/handlers/scoutCallChannels.test.js`

- [ ] **Step 1: Write failing scout creation tests**

Create `tests/handlers/scoutCallChannels.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import { handleScoutCommand } from '../../src/handlers/scoutCall.js';

function fakeGuild() {
  const channels = [];
  return {
    id: 'guild-1',
    channels: {
      cache: { values: () => channels.values() },
      async create(payload) {
        const channel = {
          id: `chan-${channels.length + 1}`,
          name: payload.name,
          type: payload.type,
          parentId: payload.parent ?? null,
          topic: payload.topic ?? null,
          async send(messagePayload) {
            channel._sent = messagePayload;
            return { id: 'scout-message-1' };
          },
        };
        channels.push(channel);
        return channel;
      },
    },
    _channels: channels,
  };
}

function fakeScoutInteraction(guild) {
  const calls = [];
  return {
    guild,
    guildId: guild.id,
    channel: {
      id: 'source-channel',
      async send() {
        throw new Error('source channel send should not be used directly');
      },
    },
    user: { id: 'requester-1' },
    options: {
      getString(name) {
        return {
          coords: '-50|72',
          notes: 'Need final report',
          'min-scouts': '200',
        }[name] ?? null;
      },
    },
    async deferReply(payload) { calls.push(['deferReply', payload]); this.deferred = true; },
    async editReply(payload) { calls.push(['editReply', payload]); this.replied = true; },
    _calls: calls,
  };
}

test('scout command creates temp channel and stores scout report metadata', async () => {
  await setupTestDb();
  resetTables();
  prepare('INSERT INTO x_world (id, x, y, player, alliance) VALUES (?, ?, ?, ?, ?)')
    .run(1, -50, 72, 'Enemy Name', 'BAD');

  const guild = fakeGuild();
  const interaction = fakeScoutInteraction(guild);

  await handleScoutCommand(interaction);

  const call = prepare('SELECT * FROM calls').get();
  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(call.id);
  const payload = JSON.parse(call.payload);

  assert.equal(call.channel_id, report.temp_channel_id);
  assert.equal(payload.minScouts, '200');
  assert.equal(payload.targetPlayer, 'Enemy Name');
  assert.equal(payload.targetAlliance, 'BAD');
  assert.match(payload.scoutCode, /^[a-z0-9]{4}$/);
  assert.equal(report.scout_code, payload.scoutCode);
  assert.match(guild._channels.find(c => c.id === call.channel_id).name, /^scout-[a-z0-9]{4}-x-50-y72-enemy-name$/);
  assert.match(interaction._calls.at(-1)[1].content, /Scout request created:/);
});
```

- [ ] **Step 2: Run scout creation test to verify it fails**

Run: `npm test -- tests/handlers/scoutCallChannels.test.js`

Expected: FAIL because scout creation still posts the full embed in the current channel and no `scout_reports` row exists.

- [ ] **Step 3: Add `/scout min-scouts` mirror option**

In `src/commands/definitions.js`, update the `/scout` command:

```js
  new SlashCommandBuilder()
    .setName('scout')
    .setDescription('Request a scout on a village')
    .addStringOption(o => o.setName('coords').setDescription('Target coords').setRequired(true))
    .addStringOption(o => o.setName('notes').setDescription('What to look for'))
    .addStringOption(o => o.setName('min-scouts').setDescription('Minimum scouts needed, e.g. 50, 200, 500+')),
```

- [ ] **Step 4: Update scout modal to collect minimum scouts**

In `handleScoutButton`, add a third `TextInputBuilder`:

```js
  const minScoutsInput = new TextInputBuilder()
    .setCustomId('min_scouts')
    .setLabel('Minimum scouts needed (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('50, 200, 500+')
    .setMaxLength(30);
```

Then add it to the modal:

```js
  modal.addComponents(
    new ActionRowBuilder().addComponents(coordsInput),
    new ActionRowBuilder().addComponents(notesInput),
    new ActionRowBuilder().addComponents(minScoutsInput),
  );
```

- [ ] **Step 5: Update `createScoutCall` to create the temp channel**

In `src/handlers/scoutCall.js`, add imports:

```js
import { ensureScoutInfrastructure, createScoutTempChannel } from '../utils/scoutChannels.js';
import { generateScoutCode } from '../utils/scoutReports.js';
```

Replace `createScoutCall` with this implementation:

```js
async function createScoutCall(interaction, { x, y, notes, minScouts }) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  const { category } = await ensureScoutInfrastructure(interaction.guild);
  const target = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(x, y);
  const scoutCode = generateScoutCode();
  const topic = `Scout ${scoutCode.toUpperCase()} | ${formatCoords(x, y)}${target?.player ? ` | ${target.player}` : ''}`;
  const tempChannel = await createScoutTempChannel(interaction.guild, {
    category,
    code: scoutCode,
    x,
    y,
    player: target?.player ?? null,
    topic,
  });

  const payload = JSON.stringify({
    notes: notes || null,
    minScouts: minScouts || null,
    targetPlayer: target?.player ?? null,
    targetAlliance: target?.alliance ?? null,
    tempChannelId: tempChannel.id,
    scoutCode,
  });

  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, channel_id, status, payload)
    VALUES ('scout', ?, ?, ?, NULL, ?, 'open', ?)
  `).run(interaction.user.id, x, y, tempChannel.id, payload);

  const callId = result.lastInsertRowid;
  inc('callsCreated');

  prepare(`
    INSERT INTO scout_reports (call_id, scout_code, temp_channel_id)
    VALUES (?, ?, ?)
  `).run(callId, scoutCode, tempChannel.id);

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  const embed = buildScoutEmbed(call, []);
  const components = buildScoutComponents(call);
  const msg = await tempChannel.send({ embeds: [embed], components });

  prepare('UPDATE calls SET message_id = ? WHERE id = ?').run(msg.id, callId);

  await interaction.editReply({
    content: `Scout request created: <#${tempChannel.id}>`,
    embeds: [],
    components: [],
  });
}
```

- [ ] **Step 6: Read minimum scouts from modal and slash command**

In `handleScoutCreateModal`, read:

```js
  const minScouts = interaction.fields.getTextInputValue('min_scouts') || null;
```

Then call:

```js
  await createScoutCall(interaction, { x: coords.x, y: coords.y, notes, minScouts });
```

In `handleScoutCommand`, read:

```js
  const minScouts = interaction.options.getString('min-scouts') || null;
```

Then call:

```js
  await createScoutCall(interaction, { x: coords.x, y: coords.y, notes, minScouts });
```

- [ ] **Step 7: Run scout creation test to verify it passes**

Run: `npm test -- tests/handlers/scoutCallChannels.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/commands/definitions.js src/handlers/scoutCall.js tests/handlers/scoutCallChannels.test.js
git commit -m "feat(scout): create temporary scout channels"
```

## Task 6: Numeric On It Commitments and Report Status Rendering

**Files:**
- Modify: `src/handlers/scoutCall.js`
- Test: `tests/handlers/scoutCallChannels.test.js`

- [ ] **Step 1: Write failing render and commitment tests**

Append to `tests/handlers/scoutCallChannels.test.js`:

```js
import {
  buildScoutEmbed,
  handleScoutJoinButton,
  handleScoutJoinModal,
} from '../../src/handlers/scoutCall.js';

test('scout embed shows minimum, committed, and remaining scouts', async () => {
  await setupTestDb();
  resetTables();

  const call = {
    id: 77,
    type: 'scout',
    author_id: 'requester-1',
    x: -50,
    y: 72,
    status: 'open',
    payload: JSON.stringify({ minScouts: '200', scoutCode: 'a3f9' }),
  };
  const embed = buildScoutEmbed(call, [
    { user_id: 'u1', amount: '50' },
    { user_id: 'u2', amount: 'On it' },
    { user_id: 'u3', amount: '75 scouts' },
  ]).toJSON();

  const field = embed.fields.find(f => f.name === 'Scout Progress');
  assert.match(field.value, /Needed: 200/);
  assert.match(field.value, /Committed: 125/);
  assert.match(field.value, /Remaining: 75/);
});

test('On it button opens amount modal instead of toggling immediately', async () => {
  await setupTestDb();
  resetTables();
  prepare(`
    INSERT INTO calls (id, type, author_id, x, y, channel_id, status, payload)
    VALUES (?, 'scout', ?, ?, ?, ?, 'open', ?)
  `).run(10, 'requester-1', -50, 72, 'chan-1', '{}');

  const interaction = {
    customId: 'scout:join:10',
    user: { id: 'scout-1' },
    async showModal(modal) { this.modal = modal.toJSON(); },
  };

  await handleScoutJoinButton(interaction);

  assert.equal(interaction.modal.custom_id, 'scout:join_submit:10');
});

test('On it modal stores numeric commitment text', async () => {
  await setupTestDb();
  resetTables();
  prepare(`
    INSERT INTO calls (id, type, author_id, x, y, channel_id, status, payload)
    VALUES (?, 'scout', ?, ?, ?, ?, 'open', ?)
  `).run(11, 'requester-1', -50, 72, 'chan-1', '{}');

  const interaction = {
    customId: 'scout:join_submit:11',
    user: { id: 'scout-1' },
    client: { channels: { fetch: async () => ({ messages: { fetch: async () => ({ edit: async () => {} }) } }) } },
    fields: { getTextInputValue: () => '75' },
    async reply(payload) { this.replyPayload = payload; },
  };

  await handleScoutJoinModal(interaction);

  const pledge = prepare('SELECT amount FROM pledges WHERE call_id = ? AND user_id = ?').get(11, 'scout-1');
  assert.equal(pledge.amount, '75');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/handlers/scoutCallChannels.test.js`

Expected: FAIL because `handleScoutJoinModal` does not exist and the embed lacks progress.

- [ ] **Step 3: Change `On it` button to show modal**

Replace `handleScoutJoinButton` in `src/handlers/scoutCall.js` with:

```js
export async function handleScoutJoinButton(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This scout request is no longer open.', ephemeral: true });
  }

  const existing = prepare('SELECT amount FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);

  const modal = new ModalBuilder()
    .setCustomId(`scout:join_submit:${callId}`)
    .setTitle(existing ? 'Update Scout Commitment' : 'Scout Commitment');

  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('Scouts sending (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('50, 200, or leave blank for On it')
    .setMaxLength(100);

  if (existing?.amount && existing.amount !== 'On it') amountInput.setValue(existing.amount);

  modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
  return interaction.showModal(modal);
}
```

- [ ] **Step 4: Add modal handler**

Add this export below `handleScoutJoinButton`:

```js
export async function handleScoutJoinModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This scout request is no longer open.', ephemeral: true });
  }

  const amount = interaction.fields.getTextInputValue('amount').trim() || 'On it';
  const existing = prepare('SELECT id FROM pledges WHERE call_id = ? AND user_id = ?')
    .get(callId, interaction.user.id);

  if (existing) {
    prepare('UPDATE pledges SET amount = ? WHERE call_id = ? AND user_id = ?')
      .run(amount, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, amount) VALUES (?, ?, ?)')
      .run(callId, interaction.user.id, amount);
    inc('pledgesSubmitted');
  }

  const { refreshCall } = await import('./calls.js');
  await refreshCall(interaction.client, callId);
  await interaction.reply({ content: `✅ Scout commitment recorded: ${amount}`, ephemeral: true });

  if (!existing) {
    notifyAuthorOfPledge(interaction.client, callId, interaction.user.id, amount).catch(err => logger.warn('notify pledge:', err.message));
    notifyAuthorIfMilestone(interaction.client, callId).catch(err => logger.warn('notify milestone:', err.message));
  }
}
```

- [ ] **Step 5: Route the modal**

In `src/handlers/router.js`, import `handleScoutJoinModal` from `./scoutCall.js` and add this before report modal routing:

```js
    if (id.startsWith('scout:join_submit:'))    return await handleScoutJoinModal(interaction);
```

- [ ] **Step 6: Add progress rendering**

In `src/handlers/scoutCall.js`, import:

```js
import { parseScoutCommitmentAmount } from '../utils/scoutReports.js';
```

Inside `buildScoutEmbed`, after notes and before responder fields, add:

```js
  if (payload.minScouts) {
    const needed = parseScoutCommitmentAmount(payload.minScouts);
    const committed = pledges
      .map(p => parseScoutCommitmentAmount(p.amount))
      .filter(n => n != null)
      .reduce((sum, n) => sum + n, 0);
    const remaining = needed == null ? null : Math.max(0, needed - committed);
    const lines = [
      `Needed: ${payload.minScouts}`,
      `Committed: ${committed}`,
    ];
    if (remaining != null) lines.push(`Remaining: ${remaining}`);
    embed.addFields({ name: 'Scout Progress', value: lines.join('\n'), inline: false });
  }
```

- [ ] **Step 7: Run tests**

Run: `npm test -- tests/handlers/scoutCallChannels.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/handlers/scoutCall.js src/handlers/router.js tests/handlers/scoutCallChannels.test.js
git commit -m "feat(scout): collect scout commitment amounts"
```

## Task 7: Deliberate Screenshot Upload and Archive

**Files:**
- Create: `src/handlers/scoutReportUpload.js`
- Modify: `src/handlers/scoutCall.js`
- Modify: `src/handlers/router.js`
- Test: `tests/handlers/scoutReportUpload.test.js`

- [ ] **Step 1: Write failing upload handler tests**

Create `tests/handlers/scoutReportUpload.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import {
  clearPendingScoutReportUploads,
  startPendingScoutReportUpload,
  handleScoutReportMessage,
} from '../../src/handlers/scoutReportUpload.js';

function seedScoutCall() {
  prepare(`
    INSERT INTO calls (id, type, author_id, x, y, channel_id, message_id, status, payload)
    VALUES (?, 'scout', ?, ?, ?, ?, ?, 'open', ?)
  `).run(20, 'requester-1', -50, 72, 'temp-1', 'scout-msg-1', JSON.stringify({
    scoutCode: 'a3f9',
    targetPlayer: 'Enemy Name',
    targetAlliance: 'BAD',
  }));
  prepare(`
    INSERT INTO scout_reports (call_id, scout_code, temp_channel_id)
    VALUES (?, ?, ?)
  `).run(20, 'a3f9', 'temp-1');
}

function fakeMessage({ authorId = 'scout-1', channelId = 'temp-1', attachments = [] } = {}) {
  return {
    author: { id: authorId, bot: false },
    channelId,
    guildId: 'guild-1',
    attachments: {
      values: () => attachments.values(),
    },
    client: {
      channels: {
        async fetch(id) {
          if (id === 'archive-1') {
            return {
              id,
              async send(payload) {
                return {
                  id: 'archive-msg-1',
                  url: 'https://discord.test/archive-msg-1',
                  attachments: { first: () => ({ url: 'https://cdn.test/copied.png' }) },
                };
              },
            };
          }
          if (id === 'temp-1') {
            return {
              id,
              messages: { async fetch() { return { async edit() {} }; } },
            };
          }
          throw new Error(`unexpected channel ${id}`);
        },
      },
    },
    async reply(payload) { this.replyPayload = payload; },
  };
}

test('upload without pending state is ignored', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  seedScoutCall();

  const handled = await handleScoutReportMessage(fakeMessage({
    attachments: [{ name: 'report.png', url: 'https://cdn.test/report.png', contentType: 'image/png' }],
  }));

  assert.equal(handled, false);
  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(20);
  assert.equal(report.reported_at, null);
});

test('upload from wrong user during pending submit is ignored', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  seedScoutCall();
  startPendingScoutReportUpload({ callId: 20, userId: 'scout-1', channelId: 'temp-1', note: 'final', now: 100 });

  const handled = await handleScoutReportMessage(fakeMessage({
    authorId: 'other-user',
    attachments: [{ name: 'report.png', url: 'https://cdn.test/report.png', contentType: 'image/png' }],
  }), 101);

  assert.equal(handled, false);
});

test('pending upload archives one valid image and marks report submitted', async () => {
  await setupTestDb();
  resetTables();
  clearPendingScoutReportUploads();
  seedScoutCall();
  prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('scout_reports_channel_id', 'archive-1');
  startPendingScoutReportUpload({ callId: 20, userId: 'scout-1', channelId: 'temp-1', note: 'final note', now: 100 });

  const message = fakeMessage({
    attachments: [{ name: 'report.png', url: 'https://cdn.test/report.png', contentType: 'image/png' }],
  });
  const handled = await handleScoutReportMessage(message, 101);

  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(20);
  assert.equal(handled, true);
  assert.equal(report.reporter_id, 'scout-1');
  assert.equal(report.report_note, 'final note');
  assert.equal(report.archive_channel_id, 'archive-1');
  assert.equal(report.archive_message_id, 'archive-msg-1');
  assert.equal(report.screenshot_url, 'https://cdn.test/copied.png');
  assert.equal(report.reported_at, 101);
  assert.equal(report.delete_after, 101 + 86400);
  assert.match(message.replyPayload.content, /archived/i);
});
```

- [ ] **Step 2: Run upload tests to verify they fail**

Run: `npm test -- tests/handlers/scoutReportUpload.test.js`

Expected: FAIL because `src/handlers/scoutReportUpload.js` does not exist.

- [ ] **Step 3: Add upload handler implementation**

Create `src/handlers/scoutReportUpload.js`:

```js
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { prepare, getConfig } from '../db/client.js';
import { formatCoords } from '../utils/coords.js';
import { discordTimestamp, unixNow } from '../utils/time.js';
import {
  REPORT_UPLOAD_WINDOW_SEC,
  TEMP_CHANNEL_DELETE_DELAY_SEC,
  isValidScoutImageAttachment,
} from '../utils/scoutReports.js';
import { mapUrl } from '../utils/travianUrl.js';
import { refreshCall } from './calls.js';
import { logger } from '../utils/logger.js';

const pendingUploads = new Map();

function pendingKey(channelId, userId) {
  return `${channelId}:${userId}`;
}

export function clearPendingScoutReportUploads() {
  pendingUploads.clear();
}

export function startPendingScoutReportUpload({ callId, userId, channelId, note, now = unixNow() }) {
  pendingUploads.set(pendingKey(channelId, userId), {
    callId,
    userId,
    channelId,
    note: note || null,
    expiresAt: now + REPORT_UPLOAD_WINDOW_SEC,
  });
}

function activePendingFor(message, now) {
  const key = pendingKey(message.channelId, message.author.id);
  const pending = pendingUploads.get(key);
  if (!pending) return null;
  if (pending.expiresAt < now) {
    pendingUploads.delete(key);
    return null;
  }
  return pending;
}

function archiveEmbed(call, report, attachmentName) {
  const payload = JSON.parse(call.payload || '{}');
  const target = payload.targetPlayer
    ? `${payload.targetPlayer}${payload.targetAlliance ? ` [${payload.targetAlliance}]` : ''}`
    : 'Unknown';

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`Scout Report ${report.scout_code.toUpperCase()} - ${formatCoords(call.x, call.y)}`)
    .setURL(mapUrl(call.x, call.y))
    .addFields(
      { name: 'Coords', value: `[${formatCoords(call.x, call.y)}](${mapUrl(call.x, call.y)})`, inline: true },
      { name: 'Target', value: target, inline: true },
      { name: 'Requester', value: `<@${call.author_id}>`, inline: true },
      { name: 'Reporter', value: `<@${report.reporter_id}>`, inline: true },
      { name: 'Submitted', value: discordTimestamp(report.reported_at), inline: true },
      { name: 'Call ID', value: String(call.id), inline: true },
    )
    .setImage(`attachment://${attachmentName}`)
    .setTimestamp(report.reported_at * 1000);

  if (report.report_note) {
    embed.addFields({ name: 'Note', value: report.report_note, inline: false });
  }

  return embed;
}

export async function handleScoutReportMessage(message, now = unixNow()) {
  if (message.author?.bot) return false;
  const pending = activePendingFor(message, now);
  if (!pending) return false;

  const attachments = Array.from(message.attachments?.values?.() ?? []);
  const images = attachments.filter(isValidScoutImageAttachment);
  if (images.length !== 1) {
    await message.reply({ content: 'Please upload exactly one image for the official scout report.' });
    return true;
  }

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(pending.callId);
  const existing = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(pending.callId);
  if (!call || !existing || existing.reported_at) {
    pendingUploads.delete(pendingKey(message.channelId, message.author.id));
    await message.reply({ content: 'This scout already has an archived report.' });
    return true;
  }

  const archiveChannelId = getConfig('scout_reports_channel_id');
  if (!archiveChannelId) {
    await message.reply({ content: 'Scout archive channel is not configured. Ask an admin to run `/setup scout`.' });
    return true;
  }

  const archiveChannel = await message.client.channels.fetch(archiveChannelId);
  const source = images[0];
  const fileName = source.name || `scout-${existing.scout_code}.png`;
  const file = new AttachmentBuilder(source.url, { name: fileName });
  const archiveMsg = await archiveChannel.send({
    files: [file],
    embeds: [
      archiveEmbed(call, {
        ...existing,
        reporter_id: message.author.id,
        report_note: pending.note,
        reported_at: now,
      }, fileName),
    ],
  });

  const copiedUrl = archiveMsg.attachments?.first?.()?.url ?? source.url;
  prepare(`
    UPDATE scout_reports
    SET archive_channel_id = ?,
        archive_message_id = ?,
        reporter_id = ?,
        report_note = ?,
        screenshot_url = ?,
        reported_at = ?,
        delete_after = ?
    WHERE call_id = ?
  `).run(
    archiveChannelId,
    archiveMsg.id,
    message.author.id,
    pending.note,
    copiedUrl,
    now,
    now + TEMP_CHANNEL_DELETE_DELAY_SEC,
    pending.callId,
  );

  pendingUploads.delete(pendingKey(message.channelId, message.author.id));
  await refreshCall(message.client, pending.callId);
  await message.reply({ content: `Scout report archived in <#${archiveChannelId}>. This channel will be deleted ${discordTimestamp(now + TEMP_CHANNEL_DELETE_DELAY_SEC, 'R')}.` });
  return true;
}
```

- [ ] **Step 4: Change Submit Report button/modal to start pending upload**

In `src/handlers/scoutCall.js`, import:

```js
import { startPendingScoutReportUpload } from './scoutReportUpload.js';
```

Change `handleScoutReportButton` so the modal field is optional note:

```js
  const reportInput = new TextInputBuilder()
    .setCustomId('note')
    .setLabel('Report note (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);
```

Replace `handleScoutReportModal` with:

```js
export async function handleScoutReportModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This scout request is no longer open.', ephemeral: true });
  }
  if (interaction.channelId !== call.channel_id) {
    return interaction.reply({ content: 'Reports must be submitted from the scout channel.', ephemeral: true });
  }

  const existing = prepare('SELECT archive_message_id FROM scout_reports WHERE call_id = ?').get(callId);
  if (existing?.archive_message_id) {
    return interaction.reply({ content: `This scout already has an archived report: https://discord.com/channels/${interaction.guildId}/${getConfig('scout_reports_channel_id')}/${existing.archive_message_id}`, ephemeral: true });
  }

  const note = interaction.fields.getTextInputValue('note').trim() || null;
  startPendingScoutReportUpload({
    callId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    note,
  });

  await interaction.reply({
    content: 'Upload the final screenshot in this channel within 10 minutes. The next image you send becomes the official scout report.',
    ephemeral: true,
  });
}
```

Also add this import to `src/handlers/scoutCall.js` if the existing-report branch uses it:

```js
import { getConfig } from '../db/client.js';
```

- [ ] **Step 5: Run upload tests**

Run: `npm test -- tests/handlers/scoutReportUpload.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/scoutReportUpload.js src/handlers/scoutCall.js tests/handlers/scoutReportUpload.test.js
git commit -m "feat(scout): archive deliberate screenshot reports"
```

## Task 8: Wire Message Create Event

**Files:**
- Modify: `src/index.js`
- Test: `tests/handlers/scoutReportUpload.test.js`

- [ ] **Step 1: Add routing test for bot/irrelevant messages**

Append to `tests/handlers/scoutReportUpload.test.js`:

```js
test('bot messages are ignored by scout report upload handler', async () => {
  clearPendingScoutReportUploads();
  const handled = await handleScoutReportMessage({
    author: { id: 'bot-1', bot: true },
    channelId: 'temp-1',
    attachments: { values: () => [].values() },
  }, 123);

  assert.equal(handled, false);
});
```

- [ ] **Step 2: Run upload tests**

Run: `npm test -- tests/handlers/scoutReportUpload.test.js`

Expected: PASS. This locks handler behavior before wiring.

- [ ] **Step 3: Import and wire handler in `src/index.js`**

Add import:

```js
import { handleScoutReportMessage } from './handlers/scoutReportUpload.js';
```

Add this listener after the reaction listener:

```js
client.on(Events.MessageCreate, async (message) => {
  try {
    await handleScoutReportMessage(message);
  } catch (err) {
    logger.error('messageCreate scout report handler crashed:', err);
    recordError(err);
  }
});
```

- [ ] **Step 4: Run upload tests**

Run: `npm test -- tests/handlers/scoutReportUpload.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.js tests/handlers/scoutReportUpload.test.js
git commit -m "feat(scout): route report screenshot uploads"
```

## Task 9: Reported Embed State and Single Report Guard

**Files:**
- Modify: `src/handlers/scoutCall.js`
- Test: `tests/handlers/scoutCallChannels.test.js`

- [ ] **Step 1: Write failing embed state test**

Append to `tests/handlers/scoutCallChannels.test.js`:

```js
test('scout embed shows archived report state and delete time', async () => {
  await setupTestDb();
  resetTables();
  prepare(`
    INSERT INTO calls (id, type, author_id, x, y, channel_id, status, payload)
    VALUES (?, 'scout', ?, ?, ?, ?, 'open', ?)
  `).run(30, 'requester-1', -50, 72, 'temp-1', JSON.stringify({ scoutCode: 'a3f9', guildId: 'guild-1' }));
  prepare(`
    INSERT INTO scout_reports (
      call_id, scout_code, temp_channel_id, archive_channel_id, archive_message_id,
      reporter_id, reported_at, delete_after
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(30, 'a3f9', 'temp-1', 'archive-1', 'archive-msg-1', 'scout-1', 1000, 1000 + 86400);

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(30);
  const embed = buildScoutEmbed(call, []).toJSON();
  const reportField = embed.fields.find(f => f.name === 'Report');

  assert.match(reportField.value, /<@scout-1>/);
  assert.match(reportField.value, /archive-msg-1/);
  assert.match(reportField.value, /deletes/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/handlers/scoutCallChannels.test.js`

Expected: FAIL because `buildScoutEmbed` does not read `scout_reports`.

- [ ] **Step 3: Add report status rendering**

In `buildScoutEmbed`, before the footer, add:

```js
  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(call.id);
  if (report?.archive_message_id) {
    const archiveLink = payload.guildId && report.archive_channel_id
      ? `https://discord.com/channels/${payload.guildId}/${report.archive_channel_id}/${report.archive_message_id}`
      : `Archive message: ${report.archive_message_id}`;
    embed.addFields({
      name: 'Report',
      value: [
        `Archived by <@${report.reporter_id}> ${discordTimestamp(report.reported_at, 'R')}`,
        `[Open archive](${archiveLink})`,
        report.delete_after ? `Temp channel deletes ${discordTimestamp(report.delete_after, 'R')}` : null,
      ].filter(Boolean).join('\n'),
      inline: false,
    });
  } else {
    embed.addFields({ name: 'Report', value: '*No official report yet*', inline: false });
  }
```

Also import `discordTimestamp` from `../utils/time.js` if not already present.

- [ ] **Step 4: Adjust link generation if guild ID is available**

Because `buildScoutEmbed` currently does not receive the client/guild ID, add `guildId` to `calls.payload` at scout creation:

```js
guildId: interaction.guildId,
```

Then replace the archive link code with:

```js
    const archiveLink = payload.guildId && report.archive_channel_id
      ? `https://discord.com/channels/${payload.guildId}/${report.archive_channel_id}/${report.archive_message_id}`
      : `Archive message: ${report.archive_message_id}`;
```

- [ ] **Step 5: Run scout render tests**

Run: `npm test -- tests/handlers/scoutCallChannels.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/scoutCall.js tests/handlers/scoutCallChannels.test.js
git commit -m "feat(scout): show archived report state"
```

## Task 10: Temp Channel Cleanup Job

**Files:**
- Create: `src/jobs/scoutReportCleanup.js`
- Modify: `src/index.js`
- Test: `tests/jobs/scoutReportCleanup.test.js`

- [ ] **Step 1: Write failing cleanup tests**

Create `tests/jobs/scoutReportCleanup.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from '../helpers/testDb.js';
import { prepare } from '../../src/db/client.js';
import {
  selectDueScoutReportChannels,
  cleanupDueScoutReportChannels,
} from '../../src/jobs/scoutReportCleanup.js';

function seedReport({ callId, tempChannelId, reportedAt = null, deleteAfter = null, deletedAt = null }) {
  prepare(`
    INSERT INTO calls (id, type, author_id, x, y, channel_id, status, payload)
    VALUES (?, 'scout', ?, 1, 2, ?, 'open', '{}')
  `).run(callId, 'requester-1', tempChannelId);
  prepare(`
    INSERT INTO scout_reports (
      call_id, scout_code, temp_channel_id, reported_at, delete_after, temp_deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(callId, `c${callId}`, tempChannelId, reportedAt, deleteAfter, deletedAt);
}

test('selectDueScoutReportChannels returns only reported due undeleted channels', async () => {
  await setupTestDb();
  resetTables();
  seedReport({ callId: 1, tempChannelId: 'due-1', reportedAt: 100, deleteAfter: 200 });
  seedReport({ callId: 2, tempChannelId: 'future-1', reportedAt: 100, deleteAfter: 300 });
  seedReport({ callId: 3, tempChannelId: 'unreported-1', reportedAt: null, deleteAfter: null });
  seedReport({ callId: 4, tempChannelId: 'deleted-1', reportedAt: 100, deleteAfter: 200, deletedAt: 201 });

  const due = selectDueScoutReportChannels(250);

  assert.deepEqual(due.map(r => r.temp_channel_id), ['due-1']);
});

test('cleanupDueScoutReportChannels deletes channel and marks row deleted', async () => {
  await setupTestDb();
  resetTables();
  seedReport({ callId: 5, tempChannelId: 'due-5', reportedAt: 100, deleteAfter: 200 });

  const deleted = [];
  const client = {
    channels: {
      async fetch(id) {
        return {
          id,
          async delete(reason) {
            deleted.push([id, reason]);
          },
        };
      },
    },
  };

  await cleanupDueScoutReportChannels(client, 250);

  assert.equal(deleted[0][0], 'due-5');
  const row = prepare('SELECT temp_deleted_at FROM scout_reports WHERE call_id = ?').get(5);
  assert.equal(row.temp_deleted_at, 250);
});
```

- [ ] **Step 2: Run cleanup tests to verify they fail**

Run: `npm test -- tests/jobs/scoutReportCleanup.test.js`

Expected: FAIL because `src/jobs/scoutReportCleanup.js` does not exist.

- [ ] **Step 3: Add cleanup job implementation**

Create `src/jobs/scoutReportCleanup.js`:

```js
import cron from 'node-cron';
import { prepare } from '../db/client.js';
import { unixNow } from '../utils/time.js';
import { logger } from '../utils/logger.js';

export function selectDueScoutReportChannels(now) {
  return prepare(`
    SELECT call_id, temp_channel_id
    FROM scout_reports
    WHERE reported_at IS NOT NULL
      AND delete_after IS NOT NULL
      AND temp_deleted_at IS NULL
      AND delete_after <= ?
    ORDER BY delete_after ASC
  `).all(now);
}

export async function cleanupDueScoutReportChannels(client, now = unixNow()) {
  const due = selectDueScoutReportChannels(now);

  for (const row of due) {
    try {
      const channel = await client.channels.fetch(row.temp_channel_id).catch(() => null);
      if (channel?.delete) {
        await channel.delete('Scout report archived more than 24 hours ago');
      }
    } catch (err) {
      logger.warn(`Scout report cleanup failed for channel ${row.temp_channel_id}:`, err.message);
      continue;
    }

    prepare('UPDATE scout_reports SET temp_deleted_at = ? WHERE call_id = ?')
      .run(now, row.call_id);
  }
}

export function startScoutReportCleanupJob(client) {
  cron.schedule('*/5 * * * *', () => cleanupDueScoutReportChannels(client));
  logger.info('Scout report cleanup job scheduled every 5 minutes');
}
```

- [ ] **Step 4: Wire cleanup job on startup**

In `src/index.js`, add import:

```js
import { startScoutReportCleanupJob } from './jobs/scoutReportCleanup.js';
```

Inside `client.once('clientReady', ...)`, after `startExpiryJob(client);`, add:

```js
  startScoutReportCleanupJob(client);
```

- [ ] **Step 5: Run cleanup tests**

Run: `npm test -- tests/jobs/scoutReportCleanup.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/jobs/scoutReportCleanup.js src/index.js tests/jobs/scoutReportCleanup.test.js
git commit -m "feat(scout): delete reported scout channels after delay"
```

## Task 11: Documentation and Full Verification

**Files:**
- Modify: `COMMANDS.md`

- [ ] **Step 1: Update command documentation**

In `COMMANDS.md`, update the scout section to include:

```markdown
### Scout request channels

Scout requests create a temporary channel under the **Scouting** category. The channel keeps the familiar buttons:

| Button | Who | Effect |
|--------|-----|--------|
| 👀 On it | Anyone | Record or update how many scouts you will send |
| 📝 Submit Report | Anyone | Start a 10-minute final screenshot upload window |
| 🔒 Close | Author or admin | Close the scout request |
| 🗺️ Map | Anyone | Open the target on the Travian map |

People may chat and paste screenshots freely in the temporary scout channel. The bot archives only the image sent after **Submit Report** is clicked.

Official reports are posted permanently to `#scout-reports`. The temporary scout channel is deleted 24 hours after the official report is submitted.
```

- [ ] **Step 2: Run focused test groups**

Run:

```bash
npm test -- tests/scoutReports.test.js tests/scoutChannels.test.js tests/handlers/scoutCallChannels.test.js tests/handlers/scoutReportUpload.test.js tests/jobs/scoutReportCleanup.test.js tests/migrations.test.js
```

Expected: PASS for all focused tests.

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Manual Discord verification**

Run the bot in a test server and verify:

1. `/setup scout` creates or reuses `Scouting` and `#scout-reports`.
2. Scout panel creates a temp channel named like `scout-a3f9-x-50-y72-enemyname`.
3. The temp channel inherits category permissions.
4. Users can chat and paste non-final screenshots with no archive entry.
5. `On it` opens a modal and updates commitment/progress.
6. `Submit Report` opens a note modal and asks for one screenshot.
7. The next image from that same user archives to `#scout-reports`.
8. A second official report attempt is rejected.
9. The scout embed shows archive status and deletion time.
10. Cleanup deletes the temp channel after `delete_after`.

- [ ] **Step 5: Commit docs**

```bash
git add COMMANDS.md README.md
git commit -m "docs(scout): document report channel workflow"
```

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
```

Expected: no unstaged changes from this implementation. Pre-existing unrelated untracked files may still appear and should remain untouched.
