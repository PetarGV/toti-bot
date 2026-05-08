# Nearby Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GUI-first nearby village lookup to the General panel, backed by cached Travian `map.sql` data, with a matching `/nearby` slash command.

**Architecture:** Put map search math and row ordering in a pure utility so it can be tested without Discord credentials. Add a thin Discord handler for the General panel button, modal submission, and slash command. Wire the handler into the existing command, button, modal, and panel systems.

**Tech Stack:** Node 20 ESM, discord.js v14, sql.js through the existing `src/db/client.js` shim, built-in `node:test` for focused utility tests.

---

## File Structure

- Create `src/utils/mapSearch.js`: owns nearby option normalization, distance calculation, deterministic sorting, pure row search, and DB-backed search helpers.
- Create `src/handlers/nearby.js`: owns Discord modal, command handling, embed formatting, and user-facing validation for nearby lookups.
- Create `tests/mapSearch.test.js`: tests the pure search behavior without initializing Discord or the SQL database.
- Modify `package.json`: add a `test` script using Node's built-in test runner.
- Modify `src/commands/definitions.js`: register `/nearby`.
- Modify `src/handlers/router.js`: route `/nearby`, `general:nearby`, and `nearby:lookup`.
- Modify `src/panel/types.js`: add `Nearby Map` to the General panel.
- Modify `README.md` and `COMMANDS.md`: document the new GUI and slash command.

---

### Task 1: Add Focused Map Search Tests

**Files:**
- Modify: `package.json`
- Create: `tests/mapSearch.test.js`

- [ ] **Step 1: Add a test script to `package.json`**

Replace the `scripts` block with this block:

```json
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "dev:setup": "node scripts/dev-setup.js",
    "deploy-commands": "node src/commands/deploy.js",
    "test": "node --test"
  },
```

- [ ] **Step 2: Create `tests/mapSearch.test.js` with failing tests**

Create the file with this content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceFields,
  normalizeNearbyOptions,
  searchNearbyRows,
} from '../src/utils/mapSearch.js';

const sampleRows = [
  { id: 1, x: 0, y: 0, tid: 1, village: 'Center', player: 'CenterPlayer', alliance: 'ALLY', population: 900 },
  { id: 2, x: 3, y: 0, tid: 2, village: 'East 3', player: 'EastPlayer', alliance: 'ALLY', population: 100 },
  { id: 3, x: 0, y: 4, tid: 3, village: 'North 4', player: 'NorthPlayer', alliance: 'TAG', population: 500 },
  { id: 4, x: 3, y: 4, tid: 6, village: 'Diagonal 5', player: 'DiagonalPlayer', alliance: 'TAG', population: 700 },
  { id: 5, x: 6, y: 0, tid: 7, village: 'Far 6', player: 'FarPlayer', alliance: 'FAR', population: 1000 },
];

test('normalizeNearbyOptions applies defaults and clamps bounds', () => {
  assert.deepEqual(normalizeNearbyOptions(), { radius: 10, limit: 10 });
  assert.deepEqual(normalizeNearbyOptions({ radius: 0, limit: 0 }), { radius: 1, limit: 1 });
  assert.deepEqual(normalizeNearbyOptions({ radius: 99, limit: 99 }), { radius: 50, limit: 20 });
  assert.deepEqual(normalizeNearbyOptions({ radius: '12', limit: '7' }), { radius: 12, limit: 7 });
});

test('distanceFields returns Euclidean distance in fields', () => {
  assert.equal(distanceFields({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(distanceFields({ x: -2, y: -3 }, { x: -2, y: -3 }), 0);
});

test('searchNearbyRows separates the center village and limits nearby rows', () => {
  const result = searchNearbyRows({ x: 0, y: 0 }, sampleRows, { radius: 5, limit: 2 });

  assert.equal(result.radius, 5);
  assert.equal(result.limit, 2);
  assert.equal(result.totalInRadius, 4);
  assert.equal(result.centerVillage.village, 'Center');
  assert.deepEqual(result.villages.map((row) => row.village), ['East 3', 'North 4']);
  assert.deepEqual(result.villages.map((row) => row.distance), [3, 4]);
});

test('searchNearbyRows sorts ties by population descending and then coordinates', () => {
  const tieRows = [
    { id: 10, x: 3, y: 0, village: 'Lower Pop', population: 100 },
    { id: 11, x: -3, y: 0, village: 'Same Pop Lower X', population: 500 },
    { id: 12, x: 0, y: 3, village: 'Same Pop Higher X', population: 500 },
    { id: 13, x: 0, y: -3, village: 'Highest Pop', population: 900 },
  ];

  const result = searchNearbyRows({ x: 0, y: 0 }, tieRows, { radius: 3, limit: 10 });

  assert.deepEqual(result.villages.map((row) => row.village), [
    'Highest Pop',
    'Same Pop Lower X',
    'Same Pop Higher X',
    'Lower Pop',
  ]);
});

test('searchNearbyRows returns an empty result when nothing is inside the radius', () => {
  const result = searchNearbyRows({ x: 100, y: 100 }, sampleRows, { radius: 1, limit: 10 });

  assert.equal(result.centerVillage, null);
  assert.deepEqual(result.villages, []);
  assert.equal(result.totalInRadius, 0);
  assert.equal(result.totalNearbyInRadius, 0);
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run:

```powershell
npm test -- tests/mapSearch.test.js
```

Expected: FAIL because `src/utils/mapSearch.js` does not exist yet. The failure should include `Cannot find module`.

- [ ] **Step 4: Commit the failing tests**

Run:

```powershell
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' add package.json tests/mapSearch.test.js
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' commit -m "test: add nearby map search coverage"
```

Expected: a commit containing only `package.json` and `tests/mapSearch.test.js`.

---

### Task 2: Implement Map Search Utility

**Files:**
- Create: `src/utils/mapSearch.js`
- Test: `tests/mapSearch.test.js`

- [ ] **Step 1: Create `src/utils/mapSearch.js`**

Create the file with this content:

```js
import { prepare } from '../db/client.js';

const DEFAULT_RADIUS = 10;
const DEFAULT_LIMIT = 10;
const MIN_RADIUS = 1;
const MAX_RADIUS = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 20;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function integerOrFallback(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeNearbyOptions(options = {}) {
  const radius = integerOrFallback(options.radius, DEFAULT_RADIUS);
  const limit = integerOrFallback(options.limit, DEFAULT_LIMIT);

  return {
    radius: clamp(radius, MIN_RADIUS, MAX_RADIUS),
    limit: clamp(limit, MIN_LIMIT, MAX_LIMIT),
  };
}

export function distanceFields(center, row) {
  const dx = numeric(row.x) - numeric(center.x);
  const dy = numeric(row.y) - numeric(center.y);
  return Math.sqrt(dx * dx + dy * dy);
}

function compareNearbyRows(a, b) {
  const distanceDiff = a.distance - b.distance;
  if (distanceDiff !== 0) return distanceDiff;

  const populationDiff = numeric(b.population) - numeric(a.population);
  if (populationDiff !== 0) return populationDiff;

  const xDiff = numeric(a.x) - numeric(b.x);
  if (xDiff !== 0) return xDiff;

  const yDiff = numeric(a.y) - numeric(b.y);
  if (yDiff !== 0) return yDiff;

  return String(a.village ?? '').localeCompare(String(b.village ?? ''));
}

export function searchNearbyRows(center, rows, options = {}) {
  const normalized = normalizeNearbyOptions(options);
  const exactMatches = [];
  const nearby = [];

  for (const row of rows) {
    const distance = distanceFields(center, row);
    if (distance > normalized.radius) continue;

    const enriched = { ...row, distance };
    if (numeric(row.x) === numeric(center.x) && numeric(row.y) === numeric(center.y)) {
      exactMatches.push(enriched);
    } else {
      nearby.push(enriched);
    }
  }

  exactMatches.sort(compareNearbyRows);
  nearby.sort(compareNearbyRows);

  return {
    center: { x: numeric(center.x), y: numeric(center.y) },
    radius: normalized.radius,
    limit: normalized.limit,
    centerVillage: exactMatches[0] ?? null,
    villages: nearby.slice(0, normalized.limit),
    totalInRadius: exactMatches.length + nearby.length,
    totalNearbyInRadius: nearby.length,
  };
}

export function getMapDataCount() {
  return prepare('SELECT COUNT(*) AS c FROM x_world').get()?.c ?? 0;
}

export function getLastMapFetchedAt() {
  const row = prepare('SELECT MAX(fetched_at) AS fetched_at FROM x_world').get();
  const value = Number(row?.fetched_at ?? 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function findNearbyVillages(center, options = {}) {
  const normalized = normalizeNearbyOptions(options);
  const rows = prepare(`
    SELECT id, x, y, tid, vid, village, uid, player, aid, alliance, population, fetched_at
    FROM x_world
    WHERE x BETWEEN ? AND ?
      AND y BETWEEN ? AND ?
  `).all(
    center.x - normalized.radius,
    center.x + normalized.radius,
    center.y - normalized.radius,
    center.y + normalized.radius,
  );

  return searchNearbyRows(center, rows, normalized);
}
```

- [ ] **Step 2: Run the map search tests**

Run:

```powershell
npm test -- tests/mapSearch.test.js
```

Expected: PASS with 5 passing tests.

- [ ] **Step 3: Run syntax check for the new utility**

Run:

```powershell
node --check src/utils/mapSearch.js
```

Expected: output includes `Syntax OK`.

- [ ] **Step 4: Commit the utility implementation**

Run:

```powershell
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' add src/utils/mapSearch.js
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' commit -m "feat: add nearby map search utility"
```

Expected: a commit containing only `src/utils/mapSearch.js`.

---

### Task 3: Add Nearby Discord Handler

**Files:**
- Create: `src/handlers/nearby.js`
- Modify: none in this task

- [ ] **Step 1: Create `src/handlers/nearby.js`**

Create the file with this content:

```js
import {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl } from '../utils/travianUrl.js';
import { getTribe } from '../utils/tribes.js';
import {
  findNearbyVillages,
  getLastMapFetchedAt,
  getMapDataCount,
  normalizeNearbyOptions,
} from '../utils/mapSearch.js';

const MODAL_ID = 'nearby:lookup';

export async function handleNearbyCommand(interaction) {
  const coords = interaction.options.getString('coords');
  const radius = interaction.options.getInteger('radius');
  const limit = interaction.options.getInteger('limit');
  return renderNearby(interaction, coords, { radius, limit });
}

export async function handleNearbyButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Nearby Map');

  const coordsInput = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Coordinates')
    .setPlaceholder('e.g. -10|25')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const radiusInput = new TextInputBuilder()
    .setCustomId('radius')
    .setLabel('Radius in fields')
    .setPlaceholder('Default: 10, max: 50')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2);

  const limitInput = new TextInputBuilder()
    .setCustomId('limit')
    .setLabel('Result limit')
    .setPlaceholder('Default: 10, max: 20')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2);

  modal.addComponents(
    new ActionRowBuilder().addComponents(coordsInput),
    new ActionRowBuilder().addComponents(radiusInput),
    new ActionRowBuilder().addComponents(limitInput),
  );

  return interaction.showModal(modal);
}

export async function handleNearbyModalSubmit(interaction) {
  const coords = interaction.fields.getTextInputValue('coords');
  const radius = parseOptionalInteger('Radius', interaction.fields.getTextInputValue('radius'));
  const limit = parseOptionalInteger('Limit', interaction.fields.getTextInputValue('limit'));

  if (radius.error) {
    return interaction.reply({ content: radius.error, ephemeral: true });
  }
  if (limit.error) {
    return interaction.reply({ content: limit.error, ephemeral: true });
  }

  return renderNearby(interaction, coords, { radius: radius.value, limit: limit.value });
}

function parseOptionalInteger(label, raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { value: null };
  if (!/^\d+$/.test(value)) {
    return { error: `${label} must be a whole number.` };
  }
  return { value: Number(value) };
}

async function renderNearby(interaction, coordsInput, rawOptions = {}) {
  const coords = parseCoords(coordsInput);
  if (!coords) {
    return interaction.reply({
      content: 'Invalid coordinates. Use format like (x|y), x|y, or x/y.',
      ephemeral: true,
    });
  }

  if (getMapDataCount() === 0) {
    return interaction.reply({
      content: 'Map data not yet loaded. Run `/admin fetch-map` to load it.',
      ephemeral: true,
    });
  }

  const options = normalizeNearbyOptions(rawOptions);
  const result = findNearbyVillages(coords, options);

  if (!result.centerVillage && result.villages.length === 0) {
    return interaction.reply({
      content: `No villages found within ${result.radius} fields of ${formatCoords(coords.x, coords.y)}.`,
      ephemeral: true,
    });
  }

  const fetchedAt = getLastMapFetchedAt();
  const embed = buildNearbyEmbed(coords, result, fetchedAt);

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

export function buildNearbyEmbed(center, result, fetchedAt) {
  const shown = (result.centerVillage ? 1 : 0) + result.villages.length;
  const sections = [];

  if (result.centerVillage) {
    sections.push(`**Center village**\n${formatVillageLine(result.centerVillage)}`);
  }

  if (result.villages.length) {
    const nearbyLines = result.villages.map((row, index) => formatVillageLine(row, index + 1));
    sections.push(`**Nearby villages**\n${nearbyLines.join('\n')}`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`Nearby villages around ${formatCoords(center.x, center.y)}`)
    .setDescription(sections.join('\n\n'))
    .addFields(
      { name: 'Search center', value: formatCoords(center.x, center.y), inline: true },
      { name: 'Radius', value: `${result.radius} fields`, inline: true },
      { name: 'Shown', value: String(shown), inline: true },
      { name: 'Found in radius', value: String(result.totalInRadius), inline: true },
    );

  if (fetchedAt) {
    embed.setFooter({ text: 'Map data updated' }).setTimestamp(new Date(fetchedAt * 1000));
  }

  return embed;
}

function formatVillageLine(row, index = null) {
  const prefix = index == null ? '' : `${index}. `;
  const coords = `[${formatCoords(row.x, row.y)}](${mapUrl(row.x, row.y)})`;
  const distance = `${Number(row.distance ?? 0).toFixed(1)} fields`;
  const village = row.village || 'Unnamed village';
  const player = row.player || 'Unoccupied';
  const alliance = row.alliance ? ` [${row.alliance}]` : '';
  const population = Number(row.population ?? 0).toLocaleString();
  const tribe = getTribe(row.tid).name;

  return `${prefix}${coords} ${distance} - ${village} - ${player}${alliance} - ${population} pop - ${tribe}`;
}
```

- [ ] **Step 2: Syntax check the handler**

Run:

```powershell
node --check src/handlers/nearby.js
```

Expected: output includes `Syntax OK`.

- [ ] **Step 3: Commit the handler**

Run:

```powershell
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' add src/handlers/nearby.js
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' commit -m "feat: add nearby map discord handler"
```

Expected: a commit containing only `src/handlers/nearby.js`.

---

### Task 4: Wire Command, Router, and General Panel GUI

**Files:**
- Modify: `src/commands/definitions.js`
- Modify: `src/handlers/router.js`
- Modify: `src/panel/types.js`

- [ ] **Step 1: Add `/nearby` to `src/commands/definitions.js`**

Insert this command definition immediately after the existing `/whois` command definition:

```js
  new SlashCommandBuilder()
    .setName('nearby')
    .setDescription('Find villages near coordinates from map data')
    .addStringOption(o => o.setName('coords').setDescription('Center coords').setRequired(true))
    .addIntegerOption(o =>
      o.setName('radius')
        .setDescription('Search radius in fields, 1-50')
        .setMinValue(1)
        .setMaxValue(50)
        .setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName('limit')
        .setDescription('Max nearby villages, 1-20')
        .setMinValue(1)
        .setMaxValue(20)
        .setRequired(false)
    ),
```

- [ ] **Step 2: Import nearby handlers in `src/handlers/router.js`**

Add this import near the other handler imports:

```js
import { handleNearbyCommand, handleNearbyButton, handleNearbyModalSubmit } from './nearby.js';
```

- [ ] **Step 3: Route the `/nearby` command in `src/handlers/router.js`**

Add this case in `routeCommand` near the `/whois` route:

```js
      case 'nearby':    return await handleNearbyCommand(interaction);
```

- [ ] **Step 4: Route the General panel button in `src/handlers/router.js`**

Add this button route near the other specific single-id buttons:

```js
    if (id === 'general:nearby') return await handleNearbyButton(interaction);
```

- [ ] **Step 5: Route the nearby modal in `src/handlers/router.js`**

Add this modal route near the `whois:lookup` modal route:

```js
    if (id === 'nearby:lookup')                 return await handleNearbyModalSubmit(interaction);
```

- [ ] **Step 6: Add the GUI button to the General panel in `src/panel/types.js`**

Replace the `general` row builder with this version:

```js
  general: () => [
    new ActionRowBuilder().addComponents(
      btn('panel:status', 'My Status',    '📊'),
      btn('panel:calls',  'Active Calls', '📋'),
      btn('panel:profile','My Profile',   '⚙️'),
      btn('general:nearby', 'Nearby Map', '🗺️'),
    ),
  ],
};
```

- [ ] **Step 7: Syntax check the wired files**

Run:

```powershell
node --check src/commands/definitions.js
node --check src/handlers/router.js
node --check src/panel/types.js
```

Expected: each command prints `Syntax OK`.

- [ ] **Step 8: Run the map search tests again**

Run:

```powershell
npm test -- tests/mapSearch.test.js
```

Expected: PASS with 5 passing tests.

- [ ] **Step 9: Commit the wiring**

Run:

```powershell
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' add src/commands/definitions.js src/handlers/router.js src/panel/types.js
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' commit -m "feat: wire nearby map command and panel button"
```

Expected: a commit containing the command definition, router routes, and General panel button.

---

### Task 5: Update User Documentation

**Files:**
- Modify: `README.md`
- Modify: `COMMANDS.md`

- [ ] **Step 1: Update the map feature bullet in `README.md`**

Replace the current `map.sql integration` feature bullet with:

```markdown
- **map.sql integration** - daily fetch, `/whois <coords>` lookup, and nearby village intel from cached map data
```

- [ ] **Step 2: Update the slash command summary in `README.md`**

Replace the lookup command line with:

```markdown
- **Lookup:** `/whois`, `/nearby`, `/calls`, `/status`, `/leaderboard`
```

- [ ] **Step 3: Add `/nearby` to the Scout / Intel slash command table in `COMMANDS.md`**

Add this row after the `/whois` row:

```markdown
| `/nearby` | `coords` `[radius]` `[limit]` | Show nearby villages from cached map data |
```

- [ ] **Step 4: Add the General panel button in `COMMANDS.md`**

Add this row to the General panel button table:

```markdown
| 🗺️ Nearby Map | Open a modal to search villages near coordinates |
```

- [ ] **Step 5: Add a short nearby behavior note to `COMMANDS.md`**

Add this note below the General panel table:

```markdown
**Nearby Map:** defaults to 10 fields and 10 results. Radius is clamped to 1-50 fields, and limit is clamped to 1-20 results.
```

- [ ] **Step 6: Commit the documentation update**

Run:

```powershell
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' add README.md COMMANDS.md
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' commit -m "docs: document nearby map lookup"
```

Expected: a commit containing only `README.md` and `COMMANDS.md`.

---

### Task 6: Final Verification

**Files:**
- Read: all changed source and test files

- [ ] **Step 1: Run the focused tests**

Run:

```powershell
npm test -- tests/mapSearch.test.js
```

Expected: PASS with 5 passing tests.

- [ ] **Step 2: Run syntax checks for all source files**

Run:

```powershell
Get-ChildItem src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Expected: every file prints `Syntax OK`.

- [ ] **Step 3: Check git status**

Run:

```powershell
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' status --short
```

Expected: clean working tree. If the only output is warnings about `C:\Users\2025/.config/git/ignore`, treat those warnings as environment noise because they existed before this feature work.

- [ ] **Step 4: Register the new slash command in a configured bot environment**

Run this only when `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID` are configured:

```powershell
npm run deploy-commands
```

Expected: Discord slash commands are refreshed and `/nearby` appears in the server.

- [ ] **Step 5: Smoke test in Discord**

Use these interactions:

```text
/admin fetch-map
/nearby coords:0|0 radius:10 limit:10
Click General panel -> Nearby Map -> coords 0|0 -> radius 10 -> limit 10
```

Expected:

- `/admin fetch-map` loads villages or returns a clear map fetch error.
- `/nearby` replies ephemerally with nearby village rows or a clear empty-state message.
- The General panel button opens the modal and returns the same style of result.
- Invalid coords such as `abc` return the coordinate validation message.

- [ ] **Step 6: Final commit if verification changed files**

If verification required edits, commit them with:

```powershell
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' add package.json tests/mapSearch.test.js src/utils/mapSearch.js src/handlers/nearby.js src/commands/definitions.js src/handlers/router.js src/panel/types.js README.md COMMANDS.md
git -c safe.directory='C:/Users/2025/OneDrive/Desktop/Travian Bot' commit -m "fix: finish nearby map verification"
```

Expected: no uncommitted source, test, or documentation changes remain.
