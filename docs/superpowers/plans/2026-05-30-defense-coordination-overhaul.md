# Defense Coordination Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing free-text defense flow with a role-tiered system: member-submitted Incoming Attack Reports, leadership-only Active/Perma Def calls, structured Inf/Cav responses with auto-calculated def value, threat detection (fake/real/chief), an Intelligence dashboard with drill-downs, and a leadership-channel archive.

**Architecture:** Hybrid data model — reuse `calls` + `pledges` for def calls (adding `inf`/`cav` columns); add `incoming_reports` table for member reports. Three new panel types (`reports`, `def-calls`, `leadership`). Threat classifier is a pure function (testable). All thresholds in `config` table (tunable without code).

**Tech Stack:** Node 20+, discord.js v14, sql.js, node-cron. Test runner: `node --test`.

**Spec:** [2026-05-30-defense-coordination-overhaul-design.md](../specs/2026-05-30-defense-coordination-overhaul-design.md)

---

## Phase 0: Foundations

Goal: tier helper, pure utility functions, schema migrations. After this phase the schema is in place and helpers are tested; nothing user-facing yet.

### Task 0.1: Tier helper (`getTier`)

**Files:**
- Create: `src/utils/tier.js`
- Test: `tests/tier.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/tier.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getTier } from '../src/utils/tier.js';

function fakeMember(roleNames) {
  return { roles: { cache: { some: pred => roleNames.some(n => pred({ name: n })) } } };
}

test('getTier returns leadership when member has leadership role', () => {
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  const m = fakeMember(['Leadership', 'Member']);
  assert.equal(getTier(m), 'leadership');
});

test('getTier returns def_coord when only def coord role', () => {
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  const m = fakeMember(['Defense Coordinator']);
  assert.equal(getTier(m), 'def_coord');
});

test('getTier returns member when no privileged role', () => {
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  const m = fakeMember(['SomeRandomRole']);
  assert.equal(getTier(m), 'member');
});

test('getTier prefers leadership over def_coord when member has both', () => {
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  const m = fakeMember(['Leadership', 'Defense Coordinator']);
  assert.equal(getTier(m), 'leadership');
});

test('getTier handles null member', () => {
  assert.equal(getTier(null), 'member');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tier.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the helper**

```javascript
// src/utils/tier.js
export function getTier(member) {
  if (!member?.roles?.cache) return 'member';
  const leadName = process.env.LEADERSHIP_ROLE_NAME;
  const coordName = process.env.DEF_COORD_ROLE_NAME;
  const has = name => name && member.roles.cache.some(r => r.name.toLowerCase() === name.toLowerCase());
  if (has(leadName)) return 'leadership';
  if (has(coordName)) return 'def_coord';
  return 'member';
}

export function isLeadershipOrCoord(member) {
  const t = getTier(member);
  return t === 'leadership' || t === 'def_coord';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/tier.test.js`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/utils/tier.js tests/tier.test.js
git commit -m "feat(defense): add getTier helper for role-based access"
```

---

### Task 0.2: Chebyshev distance + def-value pure utilities

**Files:**
- Create: `src/utils/defMath.js`
- Test: `tests/defMath.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/defMath.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chebyshev, defValue, avgWaveGapSec } from '../src/utils/defMath.js';

test('chebyshev: same point = 0', () => assert.equal(chebyshev({x:0,y:0},{x:0,y:0}), 0));
test('chebyshev: (0,0) to (3,4) = 4', () => assert.equal(chebyshev({x:0,y:0},{x:3,y:4}), 4));
test('chebyshev: negative coords', () => assert.equal(chebyshev({x:-12,y:34},{x:-15,y:30}), 4));

test('defValue: inf+2*cav', () => {
  assert.equal(defValue(0, 0), 0);
  assert.equal(defValue(1000, 500), 2000);
  assert.equal(defValue(0, 1500), 3000);
});

test('avgWaveGapSec returns spread/(waves-1)', () => {
  assert.equal(avgWaveGapSec(6, 4), 2);
  assert.equal(avgWaveGapSec(1, 4), 1/3);
});
test('avgWaveGapSec returns null for 1 wave or null spread', () => {
  assert.equal(avgWaveGapSec(null, 4), null);
  assert.equal(avgWaveGapSec(6, 1), null);
  assert.equal(avgWaveGapSec(6, 0), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/defMath.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the helper**

```javascript
// src/utils/defMath.js
export function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function defValue(inf, cav) {
  return (inf | 0) + (cav | 0) * 2;
}

export function avgWaveGapSec(spreadSec, waves) {
  if (spreadSec == null || !Number.isInteger(waves) || waves < 2) return null;
  return spreadSec / (waves - 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/defMath.test.js`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add src/utils/defMath.js tests/defMath.test.js
git commit -m "feat(defense): add chebyshev/defValue/avgWaveGap utilities"
```

---

### Task 0.3: Schema migration — `pledges.inf/cav` + `incoming_reports` + config defaults

**Files:**
- Modify: `src/db/migrations.js`
- Modify: `src/db/schema.sql`
- Test: `tests/defenseSchema.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/defenseSchema.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';

test('pledges has inf and cav integer columns defaulting to 0', async () => {
  await setupTestDb();
  resetTables();
  const cols = prepare('PRAGMA table_info(pledges)').all();
  const names = cols.map(c => c.name);
  assert.ok(names.includes('inf'), 'inf column missing');
  assert.ok(names.includes('cav'), 'cav column missing');
});

test('incoming_reports table exists with required columns', async () => {
  await setupTestDb();
  resetTables();
  const cols = prepare('PRAGMA table_info(incoming_reports)').all();
  const names = cols.map(c => c.name);
  for (const required of [
    'id','reporter_id','defender_x','defender_y','attacker_x','attacker_y',
    'first_eta','waves','wave_spread_sec','notes',
    'threat_class','threat_override','escalated_call_id','status','reports_msg_id','created_at',
  ]) {
    assert.ok(names.includes(required), `column ${required} missing`);
  }
});

test('threat config defaults are seeded', async () => {
  await setupTestDb();
  resetTables();
  const keys = prepare('SELECT key, value FROM config WHERE key LIKE ?').all('threat_%');
  const map = Object.fromEntries(keys.map(k => [k.key, k.value]));
  assert.equal(map.threat_chief_min_waves, '4');
  assert.equal(map.threat_chief_timing_sec, '30');
  assert.equal(map.threat_focus_window_hrs, '6');
  assert.equal(map.threat_scatter_radius, '5');
  assert.equal(map.threat_real_min_waves, '2');
});

test('inbetween_min_gap_sec default is seeded', async () => {
  await setupTestDb();
  resetTables();
  const row = prepare('SELECT value FROM config WHERE key = ?').get('inbetween_min_gap_sec');
  assert.equal(row?.value, '1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/defenseSchema.test.js`
Expected: FAIL on all four (columns/table/keys missing).

- [ ] **Step 3: Extend `schema.sql` (fresh-install path)**

Append to `src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS incoming_reports (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id       TEXT NOT NULL,
  defender_x        INTEGER NOT NULL,
  defender_y        INTEGER NOT NULL,
  attacker_x        INTEGER NOT NULL,
  attacker_y        INTEGER NOT NULL,
  first_eta         INTEGER NOT NULL,
  waves             INTEGER NOT NULL,
  wave_spread_sec   INTEGER,
  notes             TEXT,
  threat_class      TEXT NOT NULL DEFAULT 'unknown',
  threat_override   TEXT,
  escalated_call_id INTEGER REFERENCES calls(id),
  status            TEXT NOT NULL DEFAULT 'open',
  reports_msg_id    TEXT,
  created_at        INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_reports_attacker ON incoming_reports(attacker_x, attacker_y, first_eta);
CREATE INDEX IF NOT EXISTS idx_reports_defender ON incoming_reports(defender_x, defender_y, first_eta);
CREATE INDEX IF NOT EXISTS idx_reports_created  ON incoming_reports(created_at);
```

Also modify the `pledges` table block in `schema.sql` to include `inf INTEGER DEFAULT 0` and `cav INTEGER DEFAULT 0` so fresh installs get them too:

```sql
CREATE TABLE IF NOT EXISTS pledges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id    INTEGER NOT NULL REFERENCES calls(id),
  user_id    TEXT NOT NULL,
  amount     TEXT,
  inf        INTEGER DEFAULT 0,
  cav        INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(call_id, user_id)
);
```

- [ ] **Step 4: Add migrations (existing-install path)**

Append the following to the end of `runMigrations()` in `src/db/migrations.js`:

```javascript
  if (!hasColumn('pledges', 'inf')) {
    try { exec('ALTER TABLE pledges ADD COLUMN inf INTEGER DEFAULT 0'); }
    catch (err) { logger.warn('Migration pledges.inf skipped:', err.message); }
  }
  if (!hasColumn('pledges', 'cav')) {
    try { exec('ALTER TABLE pledges ADD COLUMN cav INTEGER DEFAULT 0'); }
    catch (err) { logger.warn('Migration pledges.cav skipped:', err.message); }
  }

  try {
    exec(`
      CREATE TABLE IF NOT EXISTS incoming_reports (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id       TEXT NOT NULL,
        defender_x        INTEGER NOT NULL,
        defender_y        INTEGER NOT NULL,
        attacker_x        INTEGER NOT NULL,
        attacker_y        INTEGER NOT NULL,
        first_eta         INTEGER NOT NULL,
        waves             INTEGER NOT NULL,
        wave_spread_sec   INTEGER,
        notes             TEXT,
        threat_class      TEXT NOT NULL DEFAULT 'unknown',
        threat_override   TEXT,
        escalated_call_id INTEGER REFERENCES calls(id),
        status            TEXT NOT NULL DEFAULT 'open',
        reports_msg_id    TEXT,
        created_at        INTEGER DEFAULT (unixepoch())
      )
    `);
    exec('CREATE INDEX IF NOT EXISTS idx_reports_attacker ON incoming_reports(attacker_x, attacker_y, first_eta)');
    exec('CREATE INDEX IF NOT EXISTS idx_reports_defender ON incoming_reports(defender_x, defender_y, first_eta)');
    exec('CREATE INDEX IF NOT EXISTS idx_reports_created  ON incoming_reports(created_at)');
  } catch (err) {
    logger.warn('Migration incoming_reports table skipped:', err.message);
  }

  // Seed defense-coordination config defaults (insert-or-ignore).
  const DEFENSE_CONFIG_DEFAULTS = {
    threat_chief_min_waves: '4',
    threat_chief_timing_sec: '30',
    threat_focus_window_hrs: '6',
    threat_scatter_radius: '5',
    threat_real_min_waves: '2',
    inbetween_min_gap_sec: '1',
  };
  for (const [key, value] of Object.entries(DEFENSE_CONFIG_DEFAULTS)) {
    try { prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)').run(key, value); }
    catch (err) { logger.warn(`Migration config seed ${key} skipped:`, err.message); }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/defenseSchema.test.js`
Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations.js src/db/schema.sql tests/defenseSchema.test.js
git commit -m "feat(defense): add pledges.inf/cav, incoming_reports table, config defaults"
```

---

### Task 0.4: Register new panel types (`reports`, `def-calls`, `leadership`)

**Files:**
- Modify: `src/panel/types.js`
- Test: `tests/defensePanels.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/defensePanels.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_TYPES, buildPanel } from '../src/panel/types.js';

test('PANEL_TYPES includes reports, def-calls, leadership', () => {
  assert.ok(PANEL_TYPES.includes('reports'));
  assert.ok(PANEL_TYPES.includes('def-calls'));
  assert.ok(PANEL_TYPES.includes('leadership'));
});

test('reports panel exposes report:choose button', () => {
  const out = buildPanel('reports');
  const ids = out.components.flatMap(row => row.components.map(c => c.data.custom_id));
  assert.ok(ids.includes('report:choose'));
});

test('def-calls panel exposes call:def_active and call:def_perma', () => {
  const out = buildPanel('def-calls');
  const ids = out.components.flatMap(row => row.components.map(c => c.data.custom_id));
  assert.ok(ids.includes('call:def_active'));
  assert.ok(ids.includes('call:def_perma'));
});

test('leadership panel exposes intel:refresh button', () => {
  const out = buildPanel('leadership');
  const ids = out.components.flatMap(row => row.components.map(c => c.data.custom_id));
  assert.ok(ids.includes('intel:refresh'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/defensePanels.test.js`
Expected: FAIL (panel types don't include the new ones; buildPanel throws or returns wrong content).

- [ ] **Step 3: Update `src/panel/types.js`**

Replace `PANEL_TYPES` with:

```javascript
export const PANEL_TYPES = ['defense', 'offense', 'resources', 'scout', 'general', 'roles', 'timer', 'reports', 'def-calls', 'leadership'];
```

Add to the `COLOR` map:

```javascript
const COLOR = {
  defense:     0xe74c3c,
  offense:     0x992d22,
  resources:   0x2ecc71,
  scout:       0x3498db,
  general:     0x9b59b6,
  roles:       0x5865f2,
  timer:       0xf1c40f,
  reports:     0xe67e22,
  'def-calls': 0xe74c3c,
  leadership:  0x1abc9c,
};
```

Add to `titles`:

```javascript
  reports:     '📥 Incoming Attack Reports',
  'def-calls': '🛡️ Defense Calls',
  leadership:  '🧠 Leadership Intel',
```

Add to `descriptions`:

```javascript
  reports:     'Report incoming attacks. Leadership + Defense Coordinator will be pinged automatically.',
  'def-calls': 'Active and Perma Def calls. Members respond with Sending Def. Buttons restricted to Leadership / Defense Coordinator.',
  leadership:  'Pinned intelligence dashboard. Drill down by target or attacker, widen the time window, or refresh.',
```

Add to `rowBuilders`:

```javascript
  reports: () => [
    new ActionRowBuilder().addComponents(
      btn('report:choose', 'Report Incoming', '📢', ButtonStyle.Danger),
    ),
  ],

  'def-calls': () => [
    new ActionRowBuilder().addComponents(
      btn('call:def_active', 'Active Def', '🛡️', ButtonStyle.Danger),
      btn('call:def_perma',  'Perma Def',  '🛡️', ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      btn('panel:calls', 'Active Calls', '📋'),
    ),
  ],

  leadership: () => [
    new ActionRowBuilder().addComponents(
      btn('intel:refresh',  'Refresh',             '🔄', ButtonStyle.Secondary),
      btn('intel:target',   'Target drill-down',   '🎯', ButtonStyle.Secondary),
      btn('intel:attacker', 'Attacker drill-down', '⚔️', ButtonStyle.Secondary),
      btn('intel:window',   'Wider window',        '📅', ButtonStyle.Secondary),
    ),
  ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/defensePanels.test.js`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/panel/types.js tests/defensePanels.test.js
git commit -m "feat(defense): register reports / def-calls / leadership panel types"
```

---

## Phase 1: Incoming Reports (manual path, no classification yet)

Goal: members can submit Report Incoming via the chooser → manual modal. Embed posts to reports channel and pings Leadership + Def Coord. Threat class hardcoded to `'unknown'` for now (Phase 2 wires up the classifier).

### Task 1.1: `incomingReports.js` — core writer + chooser button + manual modal

**Files:**
- Create: `src/handlers/incomingReports.js`

- [ ] **Step 1: Create the handler module**

```javascript
// src/handlers/incomingReports.js
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl } from '../utils/travianUrl.js';
import { discordTimestamp, parseDeadline } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import { inc } from '../utils/metrics.js';
import { getHomeCoordsString } from './profile.js';
import { avgWaveGapSec } from '../utils/defMath.js';

// Stub for future paste-mode (Section 3 of spec). Returns null until implemented.
export function parseRallyPointPaste(/* pastedText */) {
  return null;
}

const BADGE = {
  fake:    '🟢 LIKELY FAKE',
  real:    '🟠 LIKELY REAL',
  chief:   '🔴 CHIEF ATTEMPT',
  unknown: '⚪ UNCLASSIFIED',
};
const BADGE_COLOR = {
  fake:    0x2ecc71,
  real:    0xe67e22,
  chief:   0xe74c3c,
  unknown: 0x95a5a6,
};

function effectiveClass(row) {
  return row.threat_override || row.threat_class || 'unknown';
}

function badgeLabel(row) {
  const cls = effectiveClass(row);
  const base = BADGE[cls] ?? BADGE.unknown;
  return row.threat_override ? `${base} (manual)` : base;
}

function xworldLookup(x, y) {
  try {
    const r = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(x, y);
    if (!r?.player) return '';
    return ` — ${r.player}${r.alliance ? ` [${r.alliance}]` : ''}`;
  } catch { return ''; }
}

export function buildReportEmbed(row) {
  const cls = effectiveClass(row);
  const embed = new EmbedBuilder()
    .setColor(BADGE_COLOR[cls] ?? BADGE_COLOR.unknown)
    .setTitle(`📥 INCOMING ATTACK  ${badgeLabel(row)}`)
    .addFields(
      { name: 'Reporter', value: `<@${row.reporter_id}>`, inline: true },
      { name: 'Defender', value: `[${formatCoords(row.defender_x, row.defender_y)}](${mapUrl(row.defender_x, row.defender_y)})${xworldLookup(row.defender_x, row.defender_y)}`, inline: true },
      { name: 'Attacker', value: `[${formatCoords(row.attacker_x, row.attacker_y)}](${mapUrl(row.attacker_x, row.attacker_y)})${xworldLookup(row.attacker_x, row.attacker_y)}`, inline: true },
      { name: 'Impact',   value: `${discordTimestamp(row.first_eta, 'D')} ${discordTimestamp(row.first_eta, 'T')} (${discordTimestamp(row.first_eta, 'R')})`, inline: false },
      { name: 'Waves',    value: String(row.waves), inline: true },
    );

  const gap = avgWaveGapSec(row.wave_spread_sec, row.waves);
  if (row.wave_spread_sec != null) {
    let line = `⏱️ ${row.waves} waves over ${row.wave_spread_sec}s (avg gap ~${gap.toFixed(1)}s)`;
    const inbetweenMin = Number(prepare('SELECT value FROM config WHERE key=?').get('inbetween_min_gap_sec')?.value ?? '1');
    if (gap != null && gap >= inbetweenMin) line += '  🛡️ IN-BETWEEN DEF POSSIBLE';
    else line += ' — no in-between window';
    embed.addFields({ name: 'Wave timing', value: line, inline: false });
  }

  if (row.notes) embed.addFields({ name: 'Notes', value: row.notes, inline: false });
  if (row.escalated_call_id) embed.addFields({ name: 'Status', value: `✅ Escalated → Call #${row.escalated_call_id}`, inline: false });
  if (row.status === 'dismissed') embed.addFields({ name: 'Status', value: '🔒 Closed', inline: false });

  embed.setFooter({ text: `Report ID: ${row.id}` }).setTimestamp();
  return embed;
}

export function buildReportComponents(row) {
  if (row.status === 'dismissed' || row.escalated_call_id) return [];
  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`report:escalate_active:${row.id}`).setStyle(ButtonStyle.Danger).setLabel('Escalate → Active Def').setEmoji('⚔️'),
    new ButtonBuilder().setCustomId(`report:escalate_perma:${row.id}`).setStyle(ButtonStyle.Primary).setLabel('Escalate → Perma Def').setEmoji('🛡️'),
    new ButtonBuilder().setCustomId(`report:reclassify:${row.id}`).setStyle(ButtonStyle.Secondary).setLabel('Reclassify').setEmoji('🔄'),
    new ButtonBuilder().setCustomId(`report:close:${row.id}`).setStyle(ButtonStyle.Secondary).setLabel('Close').setEmoji('🔒'),
  );
  return [r1];
}

function getReportsChannelId() {
  const row = prepare('SELECT channel_id FROM panels WHERE type = ?').get('reports');
  return row?.channel_id ?? null;
}

async function getRoleMentionByEnv(guild, envKey) {
  const name = process.env[envKey];
  if (!name) return null;
  let role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (!role) {
    try { const fetched = await guild.roles.fetch(); role = fetched.find(r => r.name.toLowerCase() === name.toLowerCase()); }
    catch { /* ignore */ }
  }
  return role ? `<@&${role.id}>` : null;
}

/**
 * Shared writer used by both manual and (future) paste paths.
 * @param {import('discord.js').Interaction} interaction
 * @param {{ defender:{x,y}, attacker:{x,y}, firstEta:number, waves:number, waveSpreadSec?:number|null, notes?:string|null }} fields
 */
export async function createIncomingReport(interaction, fields) {
  const result = prepare(`
    INSERT INTO incoming_reports
      (reporter_id, defender_x, defender_y, attacker_x, attacker_y, first_eta, waves, wave_spread_sec, notes, threat_class)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown')
  `).run(
    interaction.user.id,
    fields.defender.x, fields.defender.y,
    fields.attacker.x, fields.attacker.y,
    fields.firstEta, fields.waves,
    fields.waveSpreadSec ?? null,
    fields.notes ?? null,
  );
  const id = result.lastInsertRowid;
  inc('reportsSubmitted');

  // Phase 2 will replace the line below with classifyAndPersist(id).
  const row = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(id);

  const channelId = getReportsChannelId();
  if (!channelId) {
    await interaction.reply({ content: '✅ Report saved, but no reports channel is configured. Run `/setup reports` in the reports channel.', ephemeral: true });
    return id;
  }

  const channel = await interaction.client.channels.fetch(channelId);
  const leadMention = await getRoleMentionByEnv(channel.guild, 'LEADERSHIP_ROLE_NAME');
  const coordMention = await getRoleMentionByEnv(channel.guild, 'DEF_COORD_ROLE_NAME');
  const content = [leadMention, coordMention].filter(Boolean).join(' ');

  const msg = await channel.send({
    content,
    embeds: [buildReportEmbed(row)],
    components: buildReportComponents(row),
    allowedMentions: { parse: ['roles'] },
  });
  prepare('UPDATE incoming_reports SET reports_msg_id = ? WHERE id = ?').run(msg.id, id);

  await interaction.reply({ content: `✅ Report #${id} submitted.`, ephemeral: true });
  return id;
}

// ── Entry: panel button report:choose ────────────────────────────────────────
export async function handleReportChooseButton(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('report:paste').setStyle(ButtonStyle.Secondary).setLabel('Paste from rally point').setEmoji('📋'),
    new ButtonBuilder().setCustomId('report:manual').setStyle(ButtonStyle.Primary).setLabel('Enter manually').setEmoji('✍️'),
  );
  await interaction.reply({
    content: 'How do you want to file this report?',
    components: [row],
    ephemeral: true,
  });
}

export async function handleReportPasteButton(interaction) {
  await interaction.reply({ content: '🚧 Paste mode coming soon. Use "Enter manually" for now.', ephemeral: true });
}

// ── report:manual → open modal ───────────────────────────────────────────────
export async function handleReportManualButton(interaction) {
  const modal = new ModalBuilder().setCustomId('report:manual_submit').setTitle('Report Incoming Attack');

  const def = new TextInputBuilder().setCustomId('defender').setLabel('Defender coordinates').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('(-12|34)').setMaxLength(20);
  try { const home = getHomeCoordsString(interaction.user.id); if (home) def.setValue(home); } catch { /* no profile */ }

  const atk = new TextInputBuilder().setCustomId('attacker').setLabel('Attacker coordinates').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('(56|-78)').setMaxLength(20);
  const eta = new TextInputBuilder().setCustomId('first_eta').setLabel('First wave ETA (UTC)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('14:30:45 · in 2h30m · 2026-05-30 14:30:45').setMaxLength(30);
  const waves = new TextInputBuilder().setCustomId('waves').setLabel('Number of waves (1-100)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3);
  const spread = new TextInputBuilder().setCustomId('wave_spread_sec').setLabel('Wave spread in seconds (optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('e.g. 6 = first→last wave over 6s').setMaxLength(5);

  modal.addComponents(
    new ActionRowBuilder().addComponents(def),
    new ActionRowBuilder().addComponents(atk),
    new ActionRowBuilder().addComponents(eta),
    new ActionRowBuilder().addComponents(waves),
    new ActionRowBuilder().addComponents(spread),
  );
  await interaction.showModal(modal);
}

// ── report:manual_submit ─────────────────────────────────────────────────────
export async function handleReportManualModal(interaction) {
  const f = name => interaction.fields.getTextInputValue(name);

  const defStr = f('defender'); const atkStr = f('attacker');
  const defender = parseCoords(defStr);
  if (!defender) return interaction.reply({ content: `❌ Invalid defender coords: \`${defStr}\``, ephemeral: true });
  const attacker = parseCoords(atkStr);
  if (!attacker) return interaction.reply({ content: `❌ Invalid attacker coords: \`${atkStr}\``, ephemeral: true });

  const firstEta = parseDeadline(f('first_eta'));
  if (!firstEta) return interaction.reply({ content: '❌ Invalid first wave ETA.', ephemeral: true });

  const waves = parseInt(f('waves'), 10);
  if (!Number.isInteger(waves) || waves < 1 || waves > 100) {
    return interaction.reply({ content: '❌ Waves must be an integer 1–100.', ephemeral: true });
  }

  const spreadStr = f('wave_spread_sec').trim();
  let waveSpreadSec = null;
  if (spreadStr) {
    waveSpreadSec = parseInt(spreadStr, 10);
    if (!Number.isInteger(waveSpreadSec) || waveSpreadSec < 0 || waveSpreadSec > 3600) {
      return interaction.reply({ content: '❌ Wave spread must be an integer 0–3600 seconds (or leave blank).', ephemeral: true });
    }
  }

  await createIncomingReport(interaction, { defender, attacker, firstEta, waves, waveSpreadSec, notes: null });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/handlers/incomingReports.js
git commit -m "feat(defense): add incomingReports handler — chooser + manual modal + writer"
```

---

### Task 1.2: Wire router for `report:*`

**Files:**
- Modify: `src/handlers/router.js`

- [ ] **Step 1: Add the imports**

At the top of `src/handlers/router.js`, add after the existing `combat.js` import block:

```javascript
import {
  handleReportChooseButton,
  handleReportPasteButton,
  handleReportManualButton,
  handleReportManualModal,
} from './incomingReports.js';
```

- [ ] **Step 2: Wire button routes**

In `routeButton`, add inside the `try` block before the `if (ns === 'call')` line:

```javascript
    if (ns === 'report') {
      if (action === 'choose') return await handleReportChooseButton(interaction);
      if (action === 'manual') return await handleReportManualButton(interaction);
      if (action === 'paste')  return await handleReportPasteButton(interaction);
    }
```

- [ ] **Step 3: Wire modal route**

In `routeModal`, add before `return await notImplemented(interaction);`:

```javascript
    if (id === 'report:manual_submit') return await handleReportManualModal(interaction);
```

- [ ] **Step 4: Commit**

```bash
git add src/handlers/router.js
git commit -m "feat(defense): route report:* buttons and manual_submit modal"
```

---

### Task 1.3: Manual smoke test (Phase 1 done)

- [ ] **Step 1: Start the bot locally**

Run: `npm run deploy-commands && npm start`

- [ ] **Step 2: Set env vars and deploy panel**

In `.env` (or shell), set `LEADERSHIP_ROLE_NAME=Leadership` and `DEF_COORD_ROLE_NAME=Defense Coordinator`. Create those Discord roles in your test guild. Restart the bot.

In a test channel, run `/setup reports`. Expect: pinned panel with the `📢 Report Incoming` button.

- [ ] **Step 3: Submit a report**

Click `📢 Report Incoming`. Expect ephemeral chooser. Click `Paste from rally point` → expect "🚧 coming soon". Click `Enter manually` → expect modal with 5 fields. Submit with defender `(-1|2)`, attacker `(3|4)`, ETA `in 1h`, waves `4`, spread `6`.

Expect: ephemeral "✅ Report #N submitted" + embed in channel with badge `⚪ UNCLASSIFIED`, wave timing line showing `4 waves over 6s (avg gap ~2.0s) 🛡️ IN-BETWEEN DEF POSSIBLE`, and `<@&Leadership> <@&Defense Coordinator>` ping content.

- [ ] **Step 4: Commit checkpoint note (if any local config changes)**

Skip if no files changed. Otherwise commit with a chore message.

---

## Phase 2: Threat Detection

### Task 2.1: Pure classifier (`threat.js`) with truth-table tests

**Files:**
- Create: `src/handlers/threat.js`
- Test: `tests/threat.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/threat.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyThreat } from '../src/handlers/threat.js';

const T = { chiefMinWaves: 4, chiefTimingSec: 30, focusWindowHrs: 6, scatterRadius: 5, realMinWaves: 2 };

test('chief: waves >= chiefMinWaves', () => {
  const r = { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 4 };
  assert.equal(classifyThreat(r, [], T), 'chief');
});

test('chief by cascade: 3 related reports against same defender exist', () => {
  const r = { id: 4, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 1 };
  const related = [
    { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 990, waves: 1 },
    { id: 2, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1005, waves: 1 },
    { id: 3, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1020, waves: 1 },
  ];
  assert.equal(classifyThreat(r, related, T), 'chief');
});

test('real: waves >= realMinWaves but < chiefMinWaves', () => {
  const r = { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 2 };
  assert.equal(classifyThreat(r, [], T), 'real');
});

test('fake: single wave with scattered same-attacker defenders in focus window', () => {
  const r = { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 1 };
  const others = [
    // same attacker, different defender far away (> scatter radius 5)
    { id: 2, attacker_x: 0, attacker_y: 0, defender_x: 100, defender_y: 100, first_eta: 1000, waves: 1 },
  ];
  assert.equal(classifyThreat(r, others, T), 'fake');
});

test('real: single wave focused (no scattered defenders in window)', () => {
  const r = { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 1 };
  assert.equal(classifyThreat(r, [], T), 'real');
});

test('real: single wave + same attacker hitting nearby defender (within radius) = focused', () => {
  const r = { id: 1, attacker_x: 0, attacker_y: 0, defender_x: 1, defender_y: 1, first_eta: 1000, waves: 1 };
  const others = [
    { id: 2, attacker_x: 0, attacker_y: 0, defender_x: 3, defender_y: 3, first_eta: 1100, waves: 1 },
  ];
  assert.equal(classifyThreat(r, others, T), 'real');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/threat.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the classifier**

```javascript
// src/handlers/threat.js
import { prepare } from '../db/client.js';
import { chebyshev } from '../utils/defMath.js';

export function loadThresholds() {
  const get = key => Number(prepare('SELECT value FROM config WHERE key=?').get(key)?.value);
  return {
    chiefMinWaves:   get('threat_chief_min_waves')   || 4,
    chiefTimingSec:  get('threat_chief_timing_sec')  || 30,
    focusWindowHrs:  get('threat_focus_window_hrs')  || 6,
    scatterRadius:   get('threat_scatter_radius')    || 5,
    realMinWaves:    get('threat_real_min_waves')    || 2,
  };
}

/**
 * Pure classifier. Does not read from DB.
 * @param {object} report — incoming_reports row being classified
 * @param {object[]} allOtherReports — other rows to consider for cascade/scatter
 * @param {{chiefMinWaves,chiefTimingSec,focusWindowHrs,scatterRadius,realMinWaves}} t
 */
export function classifyThreat(report, allOtherReports, t) {
  const sameAttackerTight = allOtherReports.filter(r =>
    r.id !== report.id
    && r.attacker_x === report.attacker_x && r.attacker_y === report.attacker_y
    && Math.abs(r.first_eta - report.first_eta) <= t.chiefTimingSec
  );
  const sameAttackerTightSameDefender = sameAttackerTight.filter(r =>
    r.defender_x === report.defender_x && r.defender_y === report.defender_y
  );

  if (report.waves >= t.chiefMinWaves || sameAttackerTightSameDefender.length >= t.chiefMinWaves - 1) {
    return 'chief';
  }
  if (report.waves >= t.realMinWaves) {
    return 'real';
  }

  // Single-wave: scatter check across same-attacker in focus window
  const windowSec = t.focusWindowHrs * 3600;
  const focusWindow = allOtherReports.filter(r =>
    r.id !== report.id
    && r.attacker_x === report.attacker_x && r.attacker_y === report.attacker_y
    && Math.abs(r.first_eta - report.first_eta) <= windowSec
  );
  const allDefenders = [{ x: report.defender_x, y: report.defender_y }, ...focusWindow.map(r => ({ x: r.defender_x, y: r.defender_y }))];
  // any pair > scatterRadius
  for (let i = 0; i < allDefenders.length; i++) {
    for (let j = i + 1; j < allDefenders.length; j++) {
      if (chebyshev(allDefenders[i], allDefenders[j]) > t.scatterRadius) return 'fake';
    }
  }
  return 'real';
}

/**
 * Reads the report and all related candidate rows from DB, runs classifier,
 * writes back threat_class. Returns the new class.
 * Honors threat_override: if set, no auto-classification is written.
 */
export function classifyAndPersist(reportId) {
  const report = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!report) return null;
  if (report.threat_override) return report.threat_override;
  const t = loadThresholds();
  const windowSec = t.focusWindowHrs * 3600;
  const candidates = prepare(`
    SELECT * FROM incoming_reports
    WHERE id != ?
      AND attacker_x = ? AND attacker_y = ?
      AND ABS(first_eta - ?) <= ?
  `).all(reportId, report.attacker_x, report.attacker_y, report.first_eta, windowSec);
  const cls = classifyThreat(report, candidates, t);
  prepare('UPDATE incoming_reports SET threat_class = ? WHERE id = ?').run(cls, reportId);
  return cls;
}

/**
 * After classifying report R, upgrade any related reports (same attacker,
 * tight timing) that lack an override to 'chief' if R is 'chief'.
 * Returns the list of report IDs whose class changed.
 */
export function cascadeChiefFrom(reportId) {
  const r = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!r) return [];
  const effective = r.threat_override || r.threat_class;
  if (effective !== 'chief') return [];
  const t = loadThresholds();
  const related = prepare(`
    SELECT id, threat_class FROM incoming_reports
    WHERE id != ?
      AND attacker_x = ? AND attacker_y = ?
      AND ABS(first_eta - ?) <= ?
      AND threat_override IS NULL
      AND threat_class != 'chief'
  `).all(reportId, r.attacker_x, r.attacker_y, r.first_eta, t.chiefTimingSec);
  const changed = [];
  for (const row of related) {
    prepare('UPDATE incoming_reports SET threat_class = ? WHERE id = ?').run('chief', row.id);
    changed.push(row.id);
  }
  return changed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/threat.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/threat.js tests/threat.test.js
git commit -m "feat(defense): pure threat classifier + cascade + persist helpers"
```

---

### Task 2.2: Wire classifier into `createIncomingReport`; re-render cascaded reports

**Files:**
- Modify: `src/handlers/incomingReports.js`

- [ ] **Step 1: Add classification call + cascade refresh**

In `src/handlers/incomingReports.js`, add this import at the top:

```javascript
import { classifyAndPersist, cascadeChiefFrom } from './threat.js';
```

Replace the section in `createIncomingReport` from `// Phase 2 will replace the line below ...` to the channel-fetch with:

```javascript
  classifyAndPersist(id);
  const cascadedIds = cascadeChiefFrom(id);
  const row = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(id);
```

Then after the `await interaction.reply(...)` line at the very end of `createIncomingReport`, add a cascade-rerender block:

```javascript
  // Re-render any reports cascaded to 'chief'.
  for (const cid of cascadedIds) {
    try {
      const cr = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(cid);
      if (!cr?.reports_msg_id) continue;
      const ch = await interaction.client.channels.fetch(channelId);
      const m = await ch.messages.fetch(cr.reports_msg_id);
      await m.edit({ embeds: [buildReportEmbed(cr)], components: buildReportComponents(cr) });
    } catch (err) {
      logger.warn(`cascade re-render skipped for report ${cid}:`, err.message);
    }
  }
```

- [ ] **Step 2: Manual sanity check**

Run: `npm test`
Expected: all existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/handlers/incomingReports.js
git commit -m "feat(defense): wire threat classification + cascade into report writer"
```

---

### Task 2.3: Reclassify button + select menu

**Files:**
- Modify: `src/handlers/incomingReports.js`
- Modify: `src/handlers/router.js`

- [ ] **Step 1: Add reclassify handlers to `incomingReports.js`**

Append to `src/handlers/incomingReports.js`:

```javascript
import { StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { isLeadershipOrCoord } from '../utils/tier.js';
import { classifyAndPersist as reclassifyAuto } from './threat.js';

export async function handleReclassifyButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const reportId = interaction.customId.split(':')[2];
  const select = new StringSelectMenuBuilder()
    .setCustomId(`report:reclassify_pick:${reportId}`)
    .setPlaceholder('New classification')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('🟢 Fake').setValue('fake'),
      new StringSelectMenuOptionBuilder().setLabel('🟠 Real').setValue('real'),
      new StringSelectMenuOptionBuilder().setLabel('🔴 Chief').setValue('chief'),
      new StringSelectMenuOptionBuilder().setLabel('⚙️ Auto (clear override)').setValue('auto'),
    );
  await interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
}

export async function handleReclassifySelect(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.update({ content: '❌ Leadership / Def Coord only.', components: [] });
  }
  const reportId = interaction.customId.split(':')[2];
  const choice = interaction.values[0];

  if (choice === 'auto') {
    prepare('UPDATE incoming_reports SET threat_override = NULL WHERE id = ?').run(reportId);
    reclassifyAuto(reportId);
  } else {
    prepare('UPDATE incoming_reports SET threat_override = ? WHERE id = ?').run(choice, reportId);
  }

  const row = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  const channelId = getReportsChannelId();
  if (row?.reports_msg_id && channelId) {
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      const m = await ch.messages.fetch(row.reports_msg_id);
      await m.edit({ embeds: [buildReportEmbed(row)], components: buildReportComponents(row) });
    } catch (err) {
      logger.warn(`reclassify re-render skipped:`, err.message);
    }
  }
  await interaction.update({ content: `✅ Report #${reportId} reclassified.`, components: [] });
}

export async function handleReportCloseButton(interaction) {
  const reportId = interaction.customId.split(':')[2];
  const row = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!row) return interaction.reply({ content: 'Report not found.', ephemeral: true });
  const isReporter = row.reporter_id === interaction.user.id;
  if (!isReporter && !isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Only the reporter, Leadership, or Def Coord can close this.', ephemeral: true });
  }
  prepare("UPDATE incoming_reports SET status = 'dismissed' WHERE id = ?").run(reportId);
  const after = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  const channelId = getReportsChannelId();
  if (after?.reports_msg_id && channelId) {
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      const m = await ch.messages.fetch(after.reports_msg_id);
      await m.edit({ embeds: [buildReportEmbed(after)], components: buildReportComponents(after) });
    } catch (err) {
      logger.warn(`report close re-render skipped:`, err.message);
    }
  }
  await interaction.reply({ content: `🔒 Report #${reportId} closed.`, ephemeral: true });
}
```

- [ ] **Step 2: Wire router**

In `src/handlers/router.js`, extend imports:

```javascript
import {
  handleReportChooseButton,
  handleReportPasteButton,
  handleReportManualButton,
  handleReportManualModal,
  handleReclassifyButton,
  handleReclassifySelect,
  handleReportCloseButton,
} from './incomingReports.js';
```

In `routeButton`, extend the `ns === 'report'` block:

```javascript
    if (ns === 'report') {
      if (action === 'choose')     return await handleReportChooseButton(interaction);
      if (action === 'manual')     return await handleReportManualButton(interaction);
      if (action === 'paste')      return await handleReportPasteButton(interaction);
      if (action === 'reclassify') return await handleReclassifyButton(interaction);
      if (action === 'close')      return await handleReportCloseButton(interaction);
    }
```

In `routeSelect`, add:

```javascript
    if (id.startsWith('report:reclassify_pick:')) return await handleReclassifySelect(interaction);
```

- [ ] **Step 3: Manual smoke test**

Restart the bot. Submit a 1-wave report → expect 🟠 LIKELY REAL badge (single wave, no scatter context). Submit another 1-wave report from a different attacker but landing within 30s of an earlier 1-wave report against a defender far away → expect 🟢 LIKELY FAKE. Submit a 4-wave report → expect 🔴 CHIEF ATTEMPT.

Click `🔄 Reclassify` on a report → ephemeral select. Pick `🟢 Fake` → embed badge becomes `🟢 LIKELY FAKE (manual)`. Pick `⚙️ Auto` → reverts to the heuristic value.

Click `🔒 Close` as the reporter → embed greys with status "🔒 Closed", buttons removed.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/incomingReports.js src/handlers/router.js
git commit -m "feat(defense): reclassify + close buttons on report embeds"
```

---

## Phase 3: Def Calls (Active / Perma) + Sending Def with Inf/Cav

Goal: Leadership/Coord posts Active or Perma Def; members respond with structured Inf/Cav; embed shows live tally with auto-calculated def value. Edit/Add/Withdraw parity with existing flow.

### Task 3.1: Extend `COMBAT_CONFIG` for `def_active` / `def_perma`

**Files:**
- Modify: `src/handlers/combat.js`

- [ ] **Step 1: Add new types to `COMBAT_CONFIG`**

In `src/handlers/combat.js`, replace the `COMBAT_CONFIG` block with:

```javascript
export const COMBAT_CONFIG = {
  defense:    { label: 'Defense Call',   emoji: '🛡️', color: 0xe74c3c, ping: 'def', joinLabel: "I'm sending" },
  offense:    { label: 'Offense Call',   emoji: '⚔️', color: 0x992d22, ping: null,  joinLabel: 'Joining attack' },
  reinforce:  { label: 'Reinforce',      emoji: '🤝', color: 0xe67e22, ping: 'def', joinLabel: 'Reinforcing' },
  urgent:     { label: '🚨 URGENT 🚨',   emoji: '🚨', color: 0xff0000, ping: 'all', joinLabel: "I'm sending" },
  def_active: { label: 'Active Defense', emoji: '🛡️', color: 0xe74c3c, ping: 'def', joinLabel: 'Sending Def', structured: true },
  def_perma:  { label: 'Perma Defense',  emoji: '🛡️', color: 0x3498db, ping: 'def', joinLabel: 'Sending Def', structured: true, noDeadline: true },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/handlers/combat.js
git commit -m "feat(defense): register def_active and def_perma in COMBAT_CONFIG"
```

---

### Task 3.2: New def-call handler module (`defCalls.js`) — entry + modal + embed

**Files:**
- Create: `src/handlers/defCalls.js`

- [ ] **Step 1: Create the module**

```javascript
// src/handlers/defCalls.js
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { parseCoords, formatCoords } from '../utils/coords.js';
import { mapUrl, rallyUrl } from '../utils/travianUrl.js';
import { discordTimestamp, parseDeadline, formatDeadline } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import { inc } from '../utils/metrics.js';
import { getDefRoleMention } from '../utils/role.js';
import { defValue } from '../utils/defMath.js';
import { isLeadershipOrCoord } from '../utils/tier.js';
import { registerRenderer, refreshCall } from './calls.js';
import { COMBAT_CONFIG } from './combat.js';

function getDefCallsChannelId() {
  const row = prepare('SELECT channel_id FROM panels WHERE type = ?').get('def-calls');
  return row?.channel_id ?? null;
}

function getLeadershipChannelId() {
  const row = prepare('SELECT channel_id FROM panels WHERE type = ?').get('leadership');
  return row?.channel_id ?? null;
}

function progressBar(pct) {
  const filled = Math.max(0, Math.min(8, Math.round(pct * 8)));
  return '█'.repeat(filled) + '░'.repeat(8 - filled);
}

function xworldExtra(x, y) {
  try {
    const r = prepare('SELECT player, alliance FROM x_world WHERE x = ? AND y = ?').get(x, y);
    if (!r?.player) return '';
    return ` — ${r.player}${r.alliance ? ` [${r.alliance}]` : ''}`;
  } catch { return ''; }
}

export function buildDefCallEmbed(call, pledges) {
  const config = COMBAT_CONFIG[call.type];
  const payload = JSON.parse(call.payload || '{}');
  const needed = payload.troops_needed | 0;
  const totalInf = pledges.reduce((s, p) => s + (p.inf || 0), 0);
  const totalCav = pledges.reduce((s, p) => s + (p.cav || 0), 0);
  const totalDef = defValue(totalInf, totalCav);
  const pct = needed > 0 ? Math.min(1, totalDef / needed) : 0;

  let statusPrefix = '';
  let color = config.color;
  if (call.status === 'filled')  { statusPrefix = '✅ FILLED — ';  color = 0x2ecc71; }
  if (call.status === 'expired') { statusPrefix = '⏰ Expired — '; color = 0x95a5a6; }
  if (call.status === 'closed')  { statusPrefix = '🔒 Closed — ';  color = 0x95a5a6; }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${statusPrefix}${config.emoji} ${config.label.toUpperCase()} — needs ${needed} def`)
    .addFields(
      { name: 'Author',   value: `<@${call.author_id}>`, inline: true },
      { name: 'Defender', value: `[${formatCoords(call.x, call.y)}](${mapUrl(call.x, call.y)})${xworldExtra(call.x, call.y)}`, inline: true },
    );

  if (!config.noDeadline) {
    embed.addFields({ name: 'Impact', value: call.deadline ? `${discordTimestamp(call.deadline, 'D')} ${discordTimestamp(call.deadline, 'T')} (${discordTimestamp(call.deadline, 'R')})` : '*Unknown*', inline: true });
  }

  embed.addFields({ name: 'Needed', value: `${needed} def`, inline: true });
  if (payload.notes) embed.addFields({ name: 'Notes', value: payload.notes, inline: false });

  // Responder lines
  const MAX_SHOWN = 15;
  const sorted = [...pledges].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  const shown = sorted.slice(0, MAX_SHOWN);
  const lines = shown.map(p => `<@${p.user_id}> — ${p.inf | 0} inf / ${p.cav | 0} cav = ${defValue(p.inf, p.cav)} def`);
  if (sorted.length > MAX_SHOWN) lines.push(`_... and ${sorted.length - MAX_SHOWN} more_`);

  embed.addFields({
    name: `Responders (${pledges.length})`,
    value: lines.length ? lines.join('\n') : '*No responders yet*',
    inline: false,
  });

  embed.addFields({
    name: 'Total',
    value: `${totalInf} inf / ${totalCav} cav = ${totalDef} def / ${needed} needed (${Math.round(pct * 100)}%)  ${progressBar(pct)}`,
    inline: false,
  });

  if (payload.source_report_id) {
    embed.addFields({ name: 'Source', value: `Report #${payload.source_report_id}`, inline: false });
  }

  embed.setFooter({ text: `Call ID: ${call.id}` }).setTimestamp();
  return embed;
}

export function buildDefCallComponents(call) {
  const id = call.id;
  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Map').setEmoji('🗺️').setURL(mapUrl(call.x, call.y)),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Send Troops').setEmoji('🚀').setURL(rallyUrl(call.x, call.y)),
  );
  if (call.status !== 'open') return [linkRow];

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`combat:send_def:${id}`).setStyle(ButtonStyle.Success).setLabel('Sending Def').setEmoji('🛟'),
    new ButtonBuilder().setCustomId(`combat:withdraw:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Withdraw').setEmoji('❌'),
    new ButtonBuilder().setCustomId(`combat:update:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Update').setEmoji('🔄'),
    new ButtonBuilder().setCustomId(`combat:pick:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Pick time').setEmoji('📅'),
    new ButtonBuilder().setCustomId(`combat:close:${id}`).setStyle(ButtonStyle.Danger).setLabel('Close').setEmoji('🔒'),
  );

  // Perma has no time picker (no deadline at all)
  if (COMBAT_CONFIG[call.type]?.noDeadline) {
    actionRow.components = actionRow.components.filter(c => c.data.custom_id !== `combat:pick:${id}`);
  }
  return [actionRow, linkRow];
}

// Register so refreshCall can re-render def_active / def_perma messages.
for (const type of ['def_active', 'def_perma']) {
  registerRenderer(type, {
    buildEmbed:      (call, pledges) => buildDefCallEmbed(call, pledges),
    buildComponents: (call)          => buildDefCallComponents(call),
  });
}

// ── Panel entry: call:def_active or call:def_perma ───────────────────────────
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

  modal.addComponents(new ActionRowBuilder().addComponents(coords));
  if (!config.noDeadline) {
    const arrival = new TextInputBuilder().setCustomId('arrival').setLabel('Impact time (UTC)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('14:30:45 · in 2h30m · 2026-05-30 14:30:45').setMaxLength(30);
    modal.addComponents(new ActionRowBuilder().addComponents(arrival));
  }
  modal.addComponents(
    new ActionRowBuilder().addComponents(troops),
    new ActionRowBuilder().addComponents(notes),
  );
  await interaction.showModal(modal);
}

// ── Modal submit: combat:create_def:<type> ───────────────────────────────────
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

  let arrival = null;
  if (!config.noDeadline) {
    arrival = parseDeadline(interaction.fields.getTextInputValue('arrival'));
    if (!arrival) return interaction.reply({ content: '❌ Invalid impact time.', ephemeral: true });
  }

  const troopsStr = interaction.fields.getTextInputValue('troops_needed').trim().replace(/[, ]/g, '');
  const troopsNeeded = parseInt(troopsStr, 10);
  if (!Number.isInteger(troopsNeeded) || troopsNeeded < 1 || troopsNeeded > 10_000_000) {
    return interaction.reply({ content: '❌ Troops needed must be a positive integer (1–10,000,000).', ephemeral: true });
  }

  const notes = interaction.fields.getTextInputValue('notes') || null;
  const payload = JSON.stringify({ troops_needed: troopsNeeded, notes, source_report_id: sourceReportId });

  const channelId = getDefCallsChannelId();
  if (!channelId) {
    return interaction.reply({ content: '❌ No def-calls channel configured. Run `/setup def-calls` first.', ephemeral: true });
  }

  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, channel_id, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(type, interaction.user.id, coords.x, coords.y, arrival, channelId, payload);
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
      const reportsPanel = prepare('SELECT channel_id FROM panels WHERE type = ?').get('reports');
      if (reportRow?.reports_msg_id && reportsPanel) {
        const ch = await interaction.client.channels.fetch(reportsPanel.channel_id);
        const rmsg = await ch.messages.fetch(reportRow.reports_msg_id);
        const { buildReportEmbed, buildReportComponents } = await import('./incomingReports.js');
        await rmsg.edit({ embeds: [buildReportEmbed(reportRow)], components: buildReportComponents(reportRow) });
      }
    } catch (err) {
      logger.warn('report → call link re-render skipped:', err.message);
    }
  }

  await interaction.reply({ content: `✅ Call #${callId} posted.`, ephemeral: true });
  return callId;
}

// ── combat:send_def:<callId> — first-time pledge opens modal; repeat shows Edit/Add ─
export async function handleSendDefButton(interaction) {
  const callId = interaction.customId.split(':')[2];
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') {
    return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });
  }
  const existing = prepare('SELECT inf, cav FROM pledges WHERE call_id = ? AND user_id = ?').get(callId, interaction.user.id);
  if (existing && ((existing.inf | 0) > 0 || (existing.cav | 0) > 0)) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`combat:send_def_edit:${callId}`).setStyle(ButtonStyle.Primary).setLabel('Edit pledge').setEmoji('✏️'),
      new ButtonBuilder().setCustomId(`combat:send_def_add:${callId}`).setStyle(ButtonStyle.Success).setLabel('Add to pledge').setEmoji('➕'),
    );
    return interaction.reply({
      content: `You already pledged: **${existing.inf | 0} inf / ${existing.cav | 0} cav**\nEdit replaces; Add appends.`,
      components: [row],
      ephemeral: true,
    });
  }
  await showSendDefModal(interaction, callId, 0, 0, `combat:send_def_submit:${callId}`, 'Sending Def');
}

async function showSendDefModal(interaction, callId, prefillInf, prefillCav, submitId, title) {
  const modal = new ModalBuilder().setCustomId(submitId).setTitle(title);
  const inf = new TextInputBuilder().setCustomId('inf').setLabel('Infantry (integer, 0 if none)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 1000').setMaxLength(10).setValue(String(prefillInf | 0));
  const cav = new TextInputBuilder().setCustomId('cav').setLabel('Cavalry (integer, 0 if none)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 500').setMaxLength(10).setValue(String(prefillCav | 0));
  modal.addComponents(new ActionRowBuilder().addComponents(inf), new ActionRowBuilder().addComponents(cav));
  await interaction.showModal(modal);
}

export async function handleSendDefEditButton(interaction) {
  const callId = interaction.customId.split(':')[2];
  const existing = prepare('SELECT inf, cav FROM pledges WHERE call_id = ? AND user_id = ?').get(callId, interaction.user.id);
  await showSendDefModal(interaction, callId, existing?.inf | 0, existing?.cav | 0, `combat:send_def_submit:${callId}`, 'Edit pledge');
}

export async function handleSendDefAddButton(interaction) {
  const callId = interaction.customId.split(':')[2];
  await showSendDefModal(interaction, callId, 0, 0, `combat:send_def_add_submit:${callId}`, 'Add to pledge');
}

function parseInfCav(interaction) {
  const inf = parseInt(interaction.fields.getTextInputValue('inf'), 10);
  const cav = parseInt(interaction.fields.getTextInputValue('cav'), 10);
  if (!Number.isInteger(inf) || inf < 0 || inf > 10_000_000) return { error: '❌ Inf must be an integer 0–10,000,000.' };
  if (!Number.isInteger(cav) || cav < 0 || cav > 10_000_000) return { error: '❌ Cav must be an integer 0–10,000,000.' };
  if (inf === 0 && cav === 0) return { error: '❌ At least one of Inf or Cav must be > 0.' };
  return { inf, cav };
}

export async function handleSendDefSubmitModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });

  const { inf, cav, error } = parseInfCav(interaction);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const existing = prepare('SELECT id FROM pledges WHERE call_id = ? AND user_id = ?').get(callId, interaction.user.id);
  if (existing) {
    prepare('UPDATE pledges SET inf = ?, cav = ?, amount = NULL WHERE call_id = ? AND user_id = ?').run(inf, cav, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, inf, cav) VALUES (?, ?, ?, ?)').run(callId, interaction.user.id, inf, cav);
  }
  inc('pledgesSubmitted');

  await refreshCall(interaction.client, callId);
  await maybeMarkFilled(interaction, callId);

  await interaction.reply({ content: `✅ Committed: ${inf} inf / ${cav} cav (${defValue(inf, cav)} def).`, ephemeral: true });
}

export async function handleSendDefAddSubmitModal(interaction) {
  const callId = parseInt(interaction.customId.split(':')[2], 10);
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') return interaction.reply({ content: 'This call is no longer open.', ephemeral: true });

  const { inf, cav, error } = parseInfCav(interaction);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const existing = prepare('SELECT inf, cav FROM pledges WHERE call_id = ? AND user_id = ?').get(callId, interaction.user.id);
  if (existing) {
    const newInf = (existing.inf | 0) + inf;
    const newCav = (existing.cav | 0) + cav;
    prepare('UPDATE pledges SET inf = ?, cav = ?, amount = NULL WHERE call_id = ? AND user_id = ?').run(newInf, newCav, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, inf, cav) VALUES (?, ?, ?, ?)').run(callId, interaction.user.id, inf, cav);
  }
  inc('pledgesSubmitted');

  await refreshCall(interaction.client, callId);
  await maybeMarkFilled(interaction, callId);

  await interaction.reply({ content: `✅ Added: +${inf} inf / +${cav} cav.`, ephemeral: true });
}

// ── Mark filled, lock embed, archive to leadership channel ───────────────────
async function maybeMarkFilled(interaction, callId) {
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open') return;
  const payload = JSON.parse(call.payload || '{}');
  const needed = payload.troops_needed | 0;
  const pledges = prepare('SELECT * FROM pledges WHERE call_id = ?').all(callId);
  const totalDef = pledges.reduce((s, p) => s + defValue(p.inf, p.cav), 0);
  if (needed > 0 && totalDef >= needed) {
    prepare("UPDATE calls SET status = 'filled' WHERE id = ?").run(callId);
    await refreshCall(interaction.client, callId);
    await postLeadershipArchive(interaction, callId);
  }
}

async function postLeadershipArchive(interaction, callId) {
  const channelId = getLeadershipChannelId();
  if (!channelId) {
    logger.warn('No leadership channel set; skipping filled archive post.');
    return;
  }
  try {
    const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    const pledges = prepare('SELECT * FROM pledges WHERE call_id = ? ORDER BY created_at ASC').all(callId);
    const channel = await interaction.client.channels.fetch(channelId);

    const embed = buildDefCallEmbed(call, pledges);
    embed.setTitle(`📒 ARCHIVE — ${embed.data.title}`);

    let originLink = '';
    if (call.channel_id && call.message_id) {
      originLink = `https://discord.com/channels/${interaction.guild.id}/${call.channel_id}/${call.message_id}`;
      embed.addFields({ name: 'Original message', value: `[Jump](${originLink})`, inline: false });
    }
    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn('leadership archive post failed:', err.message);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/handlers/defCalls.js
git commit -m "feat(defense): defCalls module — Active/Perma create + Sending Def + filled archive"
```

---

### Task 3.3: Router wiring for def-call buttons + modals

**Files:**
- Modify: `src/handlers/router.js`

- [ ] **Step 1: Add imports**

In `src/handlers/router.js`, add:

```javascript
import {
  handleDefCallButton,
  handleDefCallCreateModal,
  handleSendDefButton,
  handleSendDefEditButton,
  handleSendDefAddButton,
  handleSendDefSubmitModal,
  handleSendDefAddSubmitModal,
} from './defCalls.js';
```

- [ ] **Step 2: Wire button routes**

In `routeButton`, replace the existing `if (ns === 'call')` block with:

```javascript
    if (ns === 'call') {
      if (['defense', 'offense', 'reinforce', 'urgent'].includes(action)) {
        return await handleCombatButton(interaction);
      }
      if (action === 'def_active' || action === 'def_perma') {
        return await handleDefCallButton(interaction);
      }
      if (action === 'scout') return await handleScoutButton(interaction);
    }
```

Inside the existing `if (ns === 'combat')` block, add (after the `pledge_add` line):

```javascript
      if (action === 'send_def')        return await handleSendDefButton(interaction);
      if (action === 'send_def_edit')   return await handleSendDefEditButton(interaction);
      if (action === 'send_def_add')    return await handleSendDefAddButton(interaction);
```

- [ ] **Step 3: Wire modal routes**

In `routeModal`, add:

```javascript
    if (id.startsWith('combat:create_def:'))        return await handleDefCallCreateModal(interaction);
    if (id.startsWith('combat:send_def_submit:'))   return await handleSendDefSubmitModal(interaction);
    if (id.startsWith('combat:send_def_add_submit:')) return await handleSendDefAddSubmitModal(interaction);
```

- [ ] **Step 4: Manual smoke test**

Restart bot. In a test channel: `/setup def-calls`. Click `🛡️ Active Def` as Leadership → modal opens (4 fields: coords, troops, impact, notes). Submit with coords `(-1|2)`, troops `5000`, impact `in 2h`, notes "test".

Expect: ephemeral confirm + def-calls embed showing `🛡️ ACTIVE DEFENSE — needs 5000 def`, `0% (0/5000 def)`, with `<@&def-crew>` ping.

Click `🛟 Sending Def` as a Member → modal with Inf/Cav. Submit `1000` / `500`. Expect responder line `1000 inf / 500 cav = 2000 def`, total `40%`, progress bar.

Click again → ephemeral Edit/Add choice. Pick Add → modal. Submit `0` / `1000`. Expect totals updated; pledge merged.

As Leadership, post a second call needing `1000`. Send `0 inf / 500 cav` as one user (= 1000 def). Embed flips to `✅ FILLED`; archive embed appears in leadership channel (if `/setup leadership` was run).

Click `🛡️ Perma Def` → modal has no Impact field. Submit → embed has no Impact line, no Pick-time button.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/router.js
git commit -m "feat(defense): route def-call + send-def buttons and modals"
```

---

### Task 3.4: Escalate-from-report buttons wire up to def-call modal

**Files:**
- Modify: `src/handlers/defCalls.js`
- Modify: `src/handlers/router.js`

- [ ] **Step 1: Add escalate handlers in `defCalls.js`**

Append to `src/handlers/defCalls.js`:

```javascript
import { discordTimestamp as _ts } from '../utils/time.js'; // re-import OK if not present
import { avgWaveGapSec } from '../utils/defMath.js';

export async function handleEscalateActiveButton(interaction) {
  return showEscalateModal(interaction, 'def_active', interaction.customId.split(':')[2]);
}
export async function handleEscalatePermaButton(interaction) {
  return showEscalateModal(interaction, 'def_perma', interaction.customId.split(':')[2]);
}

async function showEscalateModal(interaction, type, reportId) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const report = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!report) return interaction.reply({ content: 'Report not found.', ephemeral: true });

  const config = COMBAT_CONFIG[type];
  const modal = new ModalBuilder().setCustomId(`combat:create_def_from_report:${type}:${reportId}`).setTitle(`${config.label} (from #${reportId})`);

  const coords = new TextInputBuilder().setCustomId('coords').setLabel('Defender coordinates').setStyle(TextInputStyle.Short).setRequired(true).setValue(formatCoords(report.defender_x, report.defender_y)).setMaxLength(20);
  modal.addComponents(new ActionRowBuilder().addComponents(coords));

  if (!config.noDeadline) {
    const arrival = new TextInputBuilder().setCustomId('arrival').setLabel('Impact time (UTC)').setStyle(TextInputStyle.Short).setRequired(true).setValue(formatDeadline(report.first_eta)).setMaxLength(30);
    modal.addComponents(new ActionRowBuilder().addComponents(arrival));
  }

  const troops = new TextInputBuilder().setCustomId('troops_needed').setLabel('Troops needed (def value)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 15000').setMaxLength(10);
  modal.addComponents(new ActionRowBuilder().addComponents(troops));

  const gap = avgWaveGapSec(report.wave_spread_sec, report.waves);
  const inbetweenMin = Number(prepare('SELECT value FROM config WHERE key=?').get('inbetween_min_gap_sec')?.value ?? '1');
  let notesPrefill = '';
  if (gap != null && gap >= inbetweenMin) notesPrefill = `Wave gap ~${gap.toFixed(1)}s — in-between def possible`;

  const notes = new TextInputBuilder().setCustomId('notes').setLabel('Notes').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
  if (notesPrefill) notes.setValue(notesPrefill);
  modal.addComponents(new ActionRowBuilder().addComponents(notes));

  await interaction.showModal(modal);
}

export async function handleDefCallFromReportModal(interaction) {
  // customId: combat:create_def_from_report:<type>:<reportId>
  const parts = interaction.customId.split(':');
  const type = parts[2];
  const reportId = parseInt(parts[3], 10);
  // Re-use the standard handler with sourceReportId set. The standard handler
  // expects customId 'combat:create_def:<type>'; we synthesize it.
  interaction.customId = `combat:create_def:${type}`;
  return handleDefCallCreateModal(interaction, reportId);
}
```

- [ ] **Step 2: Router wiring**

In `src/handlers/router.js`, extend imports:

```javascript
import {
  handleDefCallButton,
  handleDefCallCreateModal,
  handleSendDefButton,
  handleSendDefEditButton,
  handleSendDefAddButton,
  handleSendDefSubmitModal,
  handleSendDefAddSubmitModal,
  handleEscalateActiveButton,
  handleEscalatePermaButton,
  handleDefCallFromReportModal,
} from './defCalls.js';
```

In `routeButton`, extend the `ns === 'report'` block:

```javascript
    if (ns === 'report') {
      if (action === 'choose')           return await handleReportChooseButton(interaction);
      if (action === 'manual')           return await handleReportManualButton(interaction);
      if (action === 'paste')            return await handleReportPasteButton(interaction);
      if (action === 'reclassify')       return await handleReclassifyButton(interaction);
      if (action === 'close')            return await handleReportCloseButton(interaction);
      if (action === 'escalate_active')  return await handleEscalateActiveButton(interaction);
      if (action === 'escalate_perma')   return await handleEscalatePermaButton(interaction);
    }
```

In `routeModal`, add:

```javascript
    if (id.startsWith('combat:create_def_from_report:')) return await handleDefCallFromReportModal(interaction);
```

- [ ] **Step 3: Manual smoke test**

As Leadership, submit a 4-wave report (becomes 🔴 CHIEF) with wave_spread_sec=6. On the report embed click `⚔️ Escalate → Active Def`. Expect modal pre-filled with defender coords, impact time, notes = "Wave gap ~2.0s — in-between def possible". Submit `5000`. Expect ephemeral confirm, new def call in def-calls channel with source line `Source: Report #N`, and report embed re-rendered with `✅ Escalated → Call #N` + buttons removed.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/defCalls.js src/handlers/router.js
git commit -m "feat(defense): escalate report → Active/Perma Def modal with pre-fill"
```

---

## Phase 4: Intel Dashboard

### Task 4.1: Pure render functions (`intel.js`) — dashboard text builder

**Files:**
- Create: `src/handlers/intel.js`
- Test: `tests/intel.test.js`

- [ ] **Step 1: Write tests for ranking + scatter labeling**

```javascript
// tests/intel.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankHotTargets, focusOrScatter } from '../src/handlers/intel.js';

test('rankHotTargets: chief count weights higher than report count', () => {
  const rows = [
    { defender_x: 1, defender_y: 1, threat_class: 'real' },
    { defender_x: 1, defender_y: 1, threat_class: 'chief' },
    { defender_x: 2, defender_y: 2, threat_class: 'real' },
    { defender_x: 2, defender_y: 2, threat_class: 'real' },
    { defender_x: 2, defender_y: 2, threat_class: 'real' },
  ];
  // (1,1): 2 reports + 1 chief = 4 + 5 = 9
  // (2,2): 3 reports + 0 chief = 6 + 0 = 6
  const out = rankHotTargets(rows);
  assert.equal(out[0].defender_x, 1);
  assert.equal(out[0].score, 9);
  assert.equal(out[1].defender_x, 2);
});

test('focusOrScatter: all defenders within radius → focused', () => {
  const defs = [{x:0,y:0},{x:3,y:3}];
  assert.equal(focusOrScatter(defs, 5), 'focused');
});

test('focusOrScatter: any pair beyond radius → scattered', () => {
  const defs = [{x:0,y:0},{x:10,y:0}];
  assert.equal(focusOrScatter(defs, 5), 'scattered');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/intel.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement pure helpers + dashboard render**

```javascript
// src/handlers/intel.js
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { prepare } from '../db/client.js';
import { formatCoords, parseCoords } from '../utils/coords.js';
import { discordTimestamp } from '../utils/time.js';
import { defValue, chebyshev, avgWaveGapSec } from '../utils/defMath.js';
import { isLeadershipOrCoord } from '../utils/tier.js';
import { logger } from '../utils/logger.js';

const DASHBOARD_MSG_KEY = 'intel_dashboard_msg_id';
const DEFAULT_WINDOW_SEC = 24 * 3600;

function effective(row) { return row.threat_override || row.threat_class || 'unknown'; }

export function rankHotTargets(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.defender_x},${r.defender_y}`;
    const e = map.get(key) || { defender_x: r.defender_x, defender_y: r.defender_y, reports: 0, chief: 0 };
    e.reports++;
    if (effective(r) === 'chief') e.chief++;
    map.set(key, e);
  }
  return [...map.values()]
    .map(e => ({ ...e, score: e.reports * 2 + e.chief * 5 }))
    .sort((a, b) => b.score - a.score);
}

export function focusOrScatter(defenders, radius) {
  for (let i = 0; i < defenders.length; i++)
    for (let j = i + 1; j < defenders.length; j++)
      if (chebyshev(defenders[i], defenders[j]) > radius) return 'scattered';
  return 'focused';
}

function xworldName(x, y) {
  try {
    const r = prepare('SELECT player, alliance FROM x_world WHERE x=? AND y=?').get(x, y);
    if (!r?.player) return '';
    return ` ${r.player}${r.alliance ? ` [${r.alliance}]` : ''}`;
  } catch { return ''; }
}

export function buildDashboardEmbed({ windowSec = DEFAULT_WINDOW_SEC } = {}) {
  const since = Math.floor(Date.now() / 1000) - windowSec;
  const reports = prepare('SELECT * FROM incoming_reports WHERE created_at > ?').all(since);
  const openCalls = prepare("SELECT * FROM calls WHERE status='open' AND type IN ('def_active','def_perma')").all();
  const scatterRadius = Number(prepare('SELECT value FROM config WHERE key=?').get('threat_scatter_radius')?.value ?? '5');
  const inbetweenMin = Number(prepare('SELECT value FROM config WHERE key=?').get('inbetween_min_gap_sec')?.value ?? '1');

  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(`🧠 ALLIANCE INTEL — last ${Math.round(windowSec / 3600)}h`)
    .setTimestamp();

  // Hot targets
  const hot = rankHotTargets(reports).slice(0, 5);
  if (hot.length) {
    const lines = hot.map(h => `(${h.defender_x}|${h.defender_y})${xworldName(h.defender_x, h.defender_y)} — ${h.reports} report${h.reports !== 1 ? 's' : ''}, ${h.chief} chief`);
    embed.addFields({ name: '🔥 Hot targets', value: lines.join('\n'), inline: false });
  }

  // Top attackers
  const atkMap = new Map();
  for (const r of reports) {
    const key = `${r.attacker_x},${r.attacker_y}`;
    const e = atkMap.get(key) || { attacker_x: r.attacker_x, attacker_y: r.attacker_y, count: 0, defenders: new Set() };
    e.count++;
    e.defenders.add(`${r.defender_x},${r.defender_y}`);
    atkMap.set(key, e);
  }
  const topAtk = [...atkMap.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  if (topAtk.length) {
    const lines = topAtk.map(a => {
      const defs = [...a.defenders].map(s => { const [x, y] = s.split(',').map(Number); return { x, y }; });
      const label = defs.length > 1 ? focusOrScatter(defs, scatterRadius) : 'focused';
      return `(${a.attacker_x}|${a.attacker_y})${xworldName(a.attacker_x, a.attacker_y)} — ${a.count} report${a.count !== 1 ? 's' : ''} across ${a.defenders.size} defender${a.defenders.size !== 1 ? 's' : ''} (${label})`;
    });
    embed.addFields({ name: '⚔️ Top attackers', value: lines.join('\n'), inline: false });
  }

  // Open def calls
  if (openCalls.length) {
    const lines = openCalls.slice(0, 5).map(c => {
      const payload = JSON.parse(c.payload || '{}');
      const pledges = prepare('SELECT * FROM pledges WHERE call_id=?').all(c.id);
      const totalDef = pledges.reduce((s, p) => s + defValue(p.inf, p.cav), 0);
      const needed = payload.troops_needed | 0;
      const pct = needed > 0 ? Math.round(100 * Math.min(1, totalDef / needed)) : 0;
      const typeLabel = c.type === 'def_active' ? 'Active Def' : 'Perma Def';
      const etaPart = c.deadline ? ` — ETA ${discordTimestamp(c.deadline, 'R')}` : ' — no ETA';
      return `#${c.id} ${typeLabel} (${c.x}|${c.y}) ${pct}% (${totalDef}/${needed} def)${etaPart}`;
    });
    embed.addFields({ name: '🛡️ Open def calls', value: lines.join('\n'), inline: false });
  }

  // Threat tally
  const tally = { fake: 0, real: 0, chief: 0, unknown: 0 };
  for (const r of reports) tally[effective(r)] = (tally[effective(r)] || 0) + 1;
  embed.addFields({ name: '📊 Threat tally', value: `🟢 Fake ${tally.fake}   🟠 Real ${tally.real}   🔴 Chief ${tally.chief}   ⚪ Unknown ${tally.unknown}`, inline: false });

  // In-between def opportunities
  const inbetween = reports
    .filter(r => r.wave_spread_sec != null && r.waves > 1)
    .map(r => ({ r, gap: avgWaveGapSec(r.wave_spread_sec, r.waves) }))
    .filter(({ gap }) => gap != null && gap >= inbetweenMin)
    .sort((a, b) => a.r.first_eta - b.r.first_eta)
    .slice(0, 5);
  if (inbetween.length) {
    const lines = inbetween.map(({ r, gap }) =>
      `(${r.defender_x}|${r.defender_y}) ← (${r.attacker_x}|${r.attacker_y}): ${r.waves} waves over ${r.wave_spread_sec}s (~${gap.toFixed(1)}s gap) — ${discordTimestamp(r.first_eta, 'R')}`);
    embed.addFields({ name: '⏱️ In-between def opportunities', value: lines.join('\n'), inline: false });
  }

  // Round leaderboard
  const roundStart = Number(prepare('SELECT value FROM config WHERE key=?').get('round_start_at')?.value ?? '0');
  const leader = prepare(`
    SELECT p.user_id AS user_id, SUM((p.inf|0) + (p.cav|0)*2) AS def_sent, COUNT(DISTINCT p.call_id) AS calls
    FROM pledges p JOIN calls c ON p.call_id = c.id
    WHERE c.type IN ('def_active','def_perma') AND c.created_at > ?
    GROUP BY p.user_id ORDER BY def_sent DESC LIMIT 5
  `).all(roundStart);
  if (leader.length) {
    const lines = leader.map(l => `<@${l.user_id}> — ${Math.round(l.def_sent / 1000)}k def sent across ${l.calls} call${l.calls !== 1 ? 's' : ''}`);
    embed.addFields({ name: 'Round leaderboard (top defenders)', value: lines.join('\n'), inline: false });
  }

  return embed;
}

export function buildDashboardComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('intel:refresh').setStyle(ButtonStyle.Secondary).setLabel('Refresh').setEmoji('🔄'),
    new ButtonBuilder().setCustomId('intel:target').setStyle(ButtonStyle.Secondary).setLabel('Target drill-down').setEmoji('🎯'),
    new ButtonBuilder().setCustomId('intel:attacker').setStyle(ButtonStyle.Secondary).setLabel('Attacker drill-down').setEmoji('⚔️'),
    new ButtonBuilder().setCustomId('intel:window').setStyle(ButtonStyle.Secondary).setLabel('Wider window').setEmoji('📅'),
  )];
}

function getLeadershipChannelId() {
  const row = prepare('SELECT channel_id FROM panels WHERE type = ?').get('leadership');
  return row?.channel_id ?? null;
}

export async function rebuildDashboard(client) {
  const channelId = getLeadershipChannelId();
  if (!channelId) return;
  let channel;
  try { channel = await client.channels.fetch(channelId); }
  catch (err) { logger.warn('intel dashboard: leadership channel fetch failed:', err.message); return; }

  const embed = buildDashboardEmbed({});
  const components = buildDashboardComponents();

  const existing = prepare('SELECT value FROM config WHERE key=?').get(DASHBOARD_MSG_KEY);
  if (existing?.value) {
    try {
      const m = await channel.messages.fetch(existing.value);
      await m.edit({ embeds: [embed], components });
      return;
    } catch { /* fall through to post a fresh one */ }
  }

  const msg = await channel.send({ embeds: [embed], components });
  try { await msg.pin(); } catch { /* ignore */ }
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(DASHBOARD_MSG_KEY, msg.id);
}

// ── Drill-down ───────────────────────────────────────────────────────────────

export function buildTargetDrillEmbed(x, y, windowSec) {
  const since = Math.floor(Date.now() / 1000) - windowSec;
  const reports = prepare('SELECT * FROM incoming_reports WHERE defender_x=? AND defender_y=? AND created_at > ? ORDER BY first_eta ASC').all(x, y, since);
  const openCalls = prepare("SELECT * FROM calls WHERE x=? AND y=? AND status='open' AND type IN ('def_active','def_perma')").all(x, y);
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🎯 Target drill-down — (${x}|${y})${xworldName(x, y)}`)
    .setTimestamp();

  if (!reports.length) {
    embed.setDescription('No reports against this defender in the selected window.');
  } else {
    const tally = { fake: 0, real: 0, chief: 0, unknown: 0 };
    for (const r of reports) tally[effective(r)] = (tally[effective(r)] || 0) + 1;
    embed.addFields({ name: 'Threat breakdown', value: `🟢 ${tally.fake}   🟠 ${tally.real}   🔴 ${tally.chief}   ⚪ ${tally.unknown}`, inline: false });
    const lines = reports.slice(0, 15).map(r => `${discordTimestamp(r.first_eta, 'R')} from (${r.attacker_x}|${r.attacker_y}) — ${r.waves}w, ${effective(r)}`);
    embed.addFields({ name: `Reports (${reports.length})`, value: lines.join('\n'), inline: false });
  }

  if (openCalls.length) {
    const lines = openCalls.map(c => `#${c.id} ${c.type === 'def_active' ? 'Active' : 'Perma'} — ${c.deadline ? discordTimestamp(c.deadline, 'R') : 'no ETA'}`);
    embed.addFields({ name: 'Open def calls', value: lines.join('\n'), inline: false });
  }
  return embed;
}

export function buildAttackerDrillEmbed(x, y, windowSec) {
  const since = Math.floor(Date.now() / 1000) - windowSec;
  const reports = prepare('SELECT * FROM incoming_reports WHERE attacker_x=? AND attacker_y=? AND created_at > ? ORDER BY first_eta ASC').all(x, y, since);
  const scatterRadius = Number(prepare('SELECT value FROM config WHERE key=?').get('threat_scatter_radius')?.value ?? '5');
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`⚔️ Attacker drill-down — (${x}|${y})${xworldName(x, y)}`)
    .setTimestamp();

  if (!reports.length) {
    embed.setDescription('No reports from this attacker in the selected window.');
    return embed;
  }

  const defenders = [...new Set(reports.map(r => `${r.defender_x},${r.defender_y}`))]
    .map(s => { const [x, y] = s.split(',').map(Number); return { x, y }; });
  const pattern = defenders.length > 1 ? focusOrScatter(defenders, scatterRadius) : 'focused';

  embed.addFields({ name: 'Pattern', value: `${reports.length} reports across ${defenders.length} defenders (${pattern})`, inline: false });
  const lines = reports.slice(0, 15).map(r => `${discordTimestamp(r.first_eta, 'R')} → (${r.defender_x}|${r.defender_y}) — ${r.waves}w, ${effective(r)}`);
  embed.addFields({ name: `Reports`, value: lines.join('\n'), inline: false });
  return embed;
}

// ── Button + modal + select handlers ─────────────────────────────────────────

export async function handleIntelRefreshButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  await rebuildDashboard(interaction.client);
  await interaction.editReply({ content: '✅ Dashboard refreshed.' });
}

export async function handleIntelTargetButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const modal = new ModalBuilder().setCustomId('intel:target_submit').setTitle('Target drill-down');
  const c = new TextInputBuilder().setCustomId('coords').setLabel('Defender coordinates').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('(-12|34)').setMaxLength(20);
  modal.addComponents(new ActionRowBuilder().addComponents(c));
  await interaction.showModal(modal);
}

export async function handleIntelAttackerButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const modal = new ModalBuilder().setCustomId('intel:attacker_submit').setTitle('Attacker drill-down');
  const c = new TextInputBuilder().setCustomId('coords').setLabel('Attacker coordinates').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('(56|-78)').setMaxLength(20);
  modal.addComponents(new ActionRowBuilder().addComponents(c));
  await interaction.showModal(modal);
}

export async function handleIntelTargetModal(interaction) {
  const c = parseCoords(interaction.fields.getTextInputValue('coords'));
  if (!c) return interaction.reply({ content: '❌ Invalid coords.', ephemeral: true });
  await interaction.reply({ embeds: [buildTargetDrillEmbed(c.x, c.y, DEFAULT_WINDOW_SEC)], ephemeral: true });
}

export async function handleIntelAttackerModal(interaction) {
  const c = parseCoords(interaction.fields.getTextInputValue('coords'));
  if (!c) return interaction.reply({ content: '❌ Invalid coords.', ephemeral: true });
  await interaction.reply({ embeds: [buildAttackerDrillEmbed(c.x, c.y, DEFAULT_WINDOW_SEC)], ephemeral: true });
}

export async function handleIntelWindowButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const select = new StringSelectMenuBuilder()
    .setCustomId('intel:window_pick')
    .setPlaceholder('Pick window')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('1 day').setValue('1'),
      new StringSelectMenuOptionBuilder().setLabel('3 days').setValue('3'),
      new StringSelectMenuOptionBuilder().setLabel('7 days').setValue('7'),
      new StringSelectMenuOptionBuilder().setLabel('14 days').setValue('14'),
      new StringSelectMenuOptionBuilder().setLabel('30 days').setValue('30'),
    );
  await interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
}

export async function handleIntelWindowSelect(interaction) {
  const days = parseInt(interaction.values[0], 10);
  const windowSec = days * 86400;
  await interaction.update({ embeds: [buildDashboardEmbed({ windowSec })], components: [] });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/intel.test.js`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/intel.js tests/intel.test.js
git commit -m "feat(defense): intel dashboard + target/attacker drill-downs"
```

---

### Task 4.2: Router wiring for `intel:*`

**Files:**
- Modify: `src/handlers/router.js`

- [ ] **Step 1: Add imports**

```javascript
import {
  handleIntelRefreshButton,
  handleIntelTargetButton,
  handleIntelAttackerButton,
  handleIntelTargetModal,
  handleIntelAttackerModal,
  handleIntelWindowButton,
  handleIntelWindowSelect,
} from './intel.js';
```

- [ ] **Step 2: Wire button routes**

In `routeButton`, add (before `// Remaining unimplemented`):

```javascript
    if (ns === 'intel') {
      if (action === 'refresh')  return await handleIntelRefreshButton(interaction);
      if (action === 'target')   return await handleIntelTargetButton(interaction);
      if (action === 'attacker') return await handleIntelAttackerButton(interaction);
      if (action === 'window')   return await handleIntelWindowButton(interaction);
    }
```

In `routeSelect`, add:

```javascript
    if (id === 'intel:window_pick') return await handleIntelWindowSelect(interaction);
```

In `routeModal`, add:

```javascript
    if (id === 'intel:target_submit')   return await handleIntelTargetModal(interaction);
    if (id === 'intel:attacker_submit') return await handleIntelAttackerModal(interaction);
```

- [ ] **Step 3: Commit**

```bash
git add src/handlers/router.js
git commit -m "feat(defense): route intel:* buttons / select / modals"
```

---

### Task 4.3: Trigger dashboard rebuild on key events + 5-minute cron

**Files:**
- Modify: `src/handlers/incomingReports.js`
- Modify: `src/handlers/defCalls.js`
- Modify: `src/index.js`
- Modify: `src/jobs/` — locate the cron job file (likely `src/jobs/index.js` or per-job files)

- [ ] **Step 1: Hook the rebuild from incomingReports.js**

In `src/handlers/incomingReports.js`:

```javascript
import { rebuildDashboard } from './intel.js';
```

At the end of `createIncomingReport` (after the cascade re-render loop), add:

```javascript
  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild after report:', err.message));
```

At the end of `handleReclassifySelect` (after the `interaction.update` call) and `handleReportCloseButton` (after the `interaction.reply`), add the same line.

- [ ] **Step 2: Hook the rebuild from defCalls.js**

In `src/handlers/defCalls.js`:

```javascript
import { rebuildDashboard } from './intel.js';
```

After each of the following spots, add `rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));`:
- End of `handleDefCallCreateModal` (after `interaction.reply`)
- End of `handleSendDefSubmitModal` (after `interaction.reply`)
- End of `handleSendDefAddSubmitModal` (after `interaction.reply`)
- End of `maybeMarkFilled` (after `postLeadershipArchive`)

- [ ] **Step 3: Add the 5-minute cron tick**

Find where existing cron jobs are scheduled. Look at `src/index.js` for `cron.schedule(...)` calls or imports from `src/jobs/`. Add a new schedule alongside them:

```javascript
import cron from 'node-cron';
import { rebuildDashboard } from './handlers/intel.js';
// ...somewhere in startup after client.login:
cron.schedule('*/5 * * * *', () => {
  rebuildDashboard(client).catch(err => logger.warn('intel cron rebuild:', err.message));
});
```

(If `src/jobs/` is the established location, add a new file `src/jobs/intelDashboard.js` exporting a `start(client)` function and import it from `src/index.js`. Match the existing project convention.)

- [ ] **Step 4: Manual smoke test**

Restart bot. Run `/setup leadership` in a test channel. Submit a report → expect the leadership channel to receive a pinned dashboard embed. Submit more reports — the same message should auto-edit (not duplicate). Click 🔄 Refresh, 🎯 Target drill-down (enter a defender coord), ⚔️ Attacker drill-down, 📅 Wider window. Verify each.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/incomingReports.js src/handlers/defCalls.js src/index.js src/jobs/intelDashboard.js
git commit -m "feat(defense): rebuild intel dashboard on key events + 5-min cron"
```

---

## Phase 5: Slash commands + Expiry hook + Cleanup

### Task 5.1: Add new slash commands

**Files:**
- Modify: `src/commands/definitions.js`
- Modify: `src/handlers/router.js`

- [ ] **Step 1: Read the existing definitions**

Run: `cat src/commands/definitions.js | head -100`

Observe the existing pattern (likely `SlashCommandBuilder` instances exported as an array). Use the same pattern for new commands.

- [ ] **Step 2: Add the new command definitions**

Add to `src/commands/definitions.js` (where other `SlashCommandBuilder` declarations live):

```javascript
import { SlashCommandBuilder } from 'discord.js';

// Already imported elsewhere in the file; do not duplicate.

const reportIncoming = new SlashCommandBuilder()
  .setName('report-incoming')
  .setDescription('Submit an incoming attack report')
  .addStringOption(o => o.setName('defender').setDescription('Defender coordinates').setRequired(true))
  .addStringOption(o => o.setName('attacker').setDescription('Attacker coordinates').setRequired(true))
  .addStringOption(o => o.setName('first_eta').setDescription('First wave ETA (UTC)').setRequired(true))
  .addIntegerOption(o => o.setName('waves').setDescription('Number of waves (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
  .addIntegerOption(o => o.setName('wave_spread_sec').setDescription('Seconds from first to last wave').setRequired(false).setMinValue(0).setMaxValue(3600))
  .addStringOption(o => o.setName('notes').setDescription('Notes').setRequired(false));

const activeDef = new SlashCommandBuilder()
  .setName('active-def')
  .setDescription('Post an Active Def call (leadership only)')
  .addStringOption(o => o.setName('coords').setDescription('Defender coordinates').setRequired(true))
  .addIntegerOption(o => o.setName('troops_needed').setDescription('Required def value').setRequired(true).setMinValue(1))
  .addStringOption(o => o.setName('arrival').setDescription('Impact time (UTC)').setRequired(true))
  .addStringOption(o => o.setName('notes').setDescription('Notes').setRequired(false));

const permaDef = new SlashCommandBuilder()
  .setName('perma-def')
  .setDescription('Post a Perma Def call (leadership only)')
  .addStringOption(o => o.setName('coords').setDescription('Defender coordinates').setRequired(true))
  .addIntegerOption(o => o.setName('troops_needed').setDescription('Required def value').setRequired(true).setMinValue(1))
  .addStringOption(o => o.setName('notes').setDescription('Notes').setRequired(false));

const sendingDef = new SlashCommandBuilder()
  .setName('sending-def')
  .setDescription('Pledge inf/cav to a def call')
  .addIntegerOption(o => o.setName('call').setDescription('Call ID').setRequired(true))
  .addIntegerOption(o => o.setName('inf').setDescription('Infantry').setRequired(true).setMinValue(0))
  .addIntegerOption(o => o.setName('cav').setDescription('Cavalry').setRequired(true).setMinValue(0));

const intel = new SlashCommandBuilder()
  .setName('intel')
  .setDescription('Intelligence dashboard / drill-down (leadership only)')
  .addIntegerOption(o => o.setName('days').setDescription('Widen window to N days (1-30)').setMinValue(1).setMaxValue(30).setRequired(false))
  .addStringOption(o => o.setName('target').setDescription('Defender coords for drill-down').setRequired(false))
  .addStringOption(o => o.setName('attacker').setDescription('Attacker coords for drill-down').setRequired(false));

const reclassify = new SlashCommandBuilder()
  .setName('reclassify')
  .setDescription('Reclassify a report (leadership only)')
  .addIntegerOption(o => o.setName('report').setDescription('Report ID').setRequired(true))
  .addStringOption(o => o.setName('as').setDescription('Classification').setRequired(true)
    .addChoices(
      { name: 'fake', value: 'fake' },
      { name: 'real', value: 'real' },
      { name: 'chief', value: 'chief' },
      { name: 'auto', value: 'auto' },
    ));
```

Then add them to the exported array of commands. Identify the existing export (likely `export const commands = [...]` or similar) and remove the two dropped entries `/defense` and `/reinforce` from it. Add the six new commands above.

- [ ] **Step 3: Add slash command handlers**

In `src/handlers/incomingReports.js`, append:

```javascript
export async function handleReportIncomingCommand(interaction) {
  const defender = parseCoords(interaction.options.getString('defender'));
  if (!defender) return interaction.reply({ content: '❌ Invalid defender coords.', ephemeral: true });
  const attacker = parseCoords(interaction.options.getString('attacker'));
  if (!attacker) return interaction.reply({ content: '❌ Invalid attacker coords.', ephemeral: true });
  const firstEta = parseDeadline(interaction.options.getString('first_eta'));
  if (!firstEta) return interaction.reply({ content: '❌ Invalid first wave ETA.', ephemeral: true });
  const waves = interaction.options.getInteger('waves');
  const waveSpreadSec = interaction.options.getInteger('wave_spread_sec');
  const notes = interaction.options.getString('notes');
  await createIncomingReport(interaction, { defender, attacker, firstEta, waves, waveSpreadSec, notes });
}
```

In `src/handlers/defCalls.js`, append:

```javascript
export async function handleActiveDefCommand(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const coords = parseCoords(interaction.options.getString('coords'));
  if (!coords) return interaction.reply({ content: '❌ Invalid coords.', ephemeral: true });
  const arrival = parseDeadline(interaction.options.getString('arrival'));
  if (!arrival) return interaction.reply({ content: '❌ Invalid impact time.', ephemeral: true });
  const troopsNeeded = interaction.options.getInteger('troops_needed');
  const notes = interaction.options.getString('notes');
  // Synthesize a modal-like interaction: simpler to insert directly.
  await createDefCallDirect(interaction, 'def_active', coords, arrival, troopsNeeded, notes, null);
}

export async function handlePermaDefCommand(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const coords = parseCoords(interaction.options.getString('coords'));
  if (!coords) return interaction.reply({ content: '❌ Invalid coords.', ephemeral: true });
  const troopsNeeded = interaction.options.getInteger('troops_needed');
  const notes = interaction.options.getString('notes');
  await createDefCallDirect(interaction, 'def_perma', coords, null, troopsNeeded, notes, null);
}

async function createDefCallDirect(interaction, type, coords, arrival, troopsNeeded, notes, sourceReportId) {
  const channelId = getDefCallsChannelId();
  if (!channelId) return interaction.reply({ content: '❌ No def-calls channel configured.', ephemeral: true });
  const payload = JSON.stringify({ troops_needed: troopsNeeded, notes: notes ?? null, source_report_id: sourceReportId });
  const result = prepare(`
    INSERT INTO calls (type, author_id, x, y, deadline, channel_id, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(type, interaction.user.id, coords.x, coords.y, arrival, channelId, payload);
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
  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
  await interaction.reply({ content: `✅ Call #${callId} posted.`, ephemeral: true });
}

export async function handleSendingDefCommand(interaction) {
  const callId = interaction.options.getInteger('call');
  const inf = interaction.options.getInteger('inf');
  const cav = interaction.options.getInteger('cav');
  if (inf === 0 && cav === 0) return interaction.reply({ content: '❌ At least one of Inf or Cav must be > 0.', ephemeral: true });

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status !== 'open' || (call.type !== 'def_active' && call.type !== 'def_perma')) {
    return interaction.reply({ content: '❌ Call not found or not open.', ephemeral: true });
  }
  const existing = prepare('SELECT id FROM pledges WHERE call_id = ? AND user_id = ?').get(callId, interaction.user.id);
  if (existing) {
    prepare('UPDATE pledges SET inf = ?, cav = ?, amount = NULL WHERE call_id = ? AND user_id = ?').run(inf, cav, callId, interaction.user.id);
  } else {
    prepare('INSERT INTO pledges (call_id, user_id, inf, cav) VALUES (?, ?, ?, ?)').run(callId, interaction.user.id, inf, cav);
  }
  inc('pledgesSubmitted');
  await refreshCall(interaction.client, callId);
  await maybeMarkFilled(interaction, callId);
  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
  await interaction.reply({ content: `✅ Pledged ${inf} inf / ${cav} cav (${defValue(inf, cav)} def).`, ephemeral: true });
}
```

Note: `maybeMarkFilled` was declared `async function` (not exported). To call it from this exported function in the same file, no change needed — it's in scope.

In `src/handlers/intel.js`, append:

```javascript
export async function handleIntelCommand(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const days = interaction.options.getInteger('days');
  const targetStr = interaction.options.getString('target');
  const attackerStr = interaction.options.getString('attacker');
  const windowSec = (days ? days : 1) * 86400;

  if (targetStr) {
    const c = parseCoords(targetStr);
    if (!c) return interaction.reply({ content: '❌ Invalid target coords.', ephemeral: true });
    return interaction.reply({ embeds: [buildTargetDrillEmbed(c.x, c.y, windowSec)], ephemeral: true });
  }
  if (attackerStr) {
    const c = parseCoords(attackerStr);
    if (!c) return interaction.reply({ content: '❌ Invalid attacker coords.', ephemeral: true });
    return interaction.reply({ embeds: [buildAttackerDrillEmbed(c.x, c.y, windowSec)], ephemeral: true });
  }
  await interaction.reply({ embeds: [buildDashboardEmbed({ windowSec })], ephemeral: true });
}

export async function handleReclassifyCommand(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  const reportId = interaction.options.getInteger('report');
  const choice = interaction.options.getString('as');
  const row = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!row) return interaction.reply({ content: 'Report not found.', ephemeral: true });

  if (choice === 'auto') {
    prepare('UPDATE incoming_reports SET threat_override = NULL WHERE id = ?').run(reportId);
    const { classifyAndPersist } = await import('./threat.js');
    classifyAndPersist(reportId);
  } else {
    prepare('UPDATE incoming_reports SET threat_override = ? WHERE id = ?').run(choice, reportId);
  }
  const after = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  const reportsPanel = prepare('SELECT channel_id FROM panels WHERE type = ?').get('reports');
  if (after?.reports_msg_id && reportsPanel) {
    try {
      const { buildReportEmbed, buildReportComponents } = await import('./incomingReports.js');
      const ch = await interaction.client.channels.fetch(reportsPanel.channel_id);
      const m = await ch.messages.fetch(after.reports_msg_id);
      await m.edit({ embeds: [buildReportEmbed(after)], components: buildReportComponents(after) });
    } catch (err) { logger.warn('reclassify command re-render skipped:', err.message); }
  }
  rebuildDashboard(interaction.client).catch(err => logger.warn('intel rebuild:', err.message));
  await interaction.reply({ content: `✅ Report #${reportId} reclassified.`, ephemeral: true });
}
```

- [ ] **Step 4: Wire commands in router**

In `src/handlers/router.js`, extend imports:

```javascript
import { handleReportIncomingCommand } from './incomingReports.js';
import { handleActiveDefCommand, handlePermaDefCommand, handleSendingDefCommand } from './defCalls.js';
import { handleIntelCommand, handleReclassifyCommand } from './intel.js';
```

In the `routeCommand` switch, **remove** `case 'defense':` and `case 'reinforce':` lines and **add**:

```javascript
      case 'report-incoming': return await handleReportIncomingCommand(interaction);
      case 'active-def':      return await handleActiveDefCommand(interaction);
      case 'perma-def':       return await handlePermaDefCommand(interaction);
      case 'sending-def':     return await handleSendingDefCommand(interaction);
      case 'intel':           return await handleIntelCommand(interaction);
      case 'reclassify':      return await handleReclassifyCommand(interaction);
```

Also remove the dead imports `handleDefenseCommand` and `handleReinforceCommand` from the existing `combat.js` import block.

- [ ] **Step 5: Re-deploy slash commands**

Run: `npm run deploy-commands`
Expected: Discord registers new commands; `/defense` and `/reinforce` disappear within minutes.

- [ ] **Step 6: Manual smoke test**

Test each new command: `/report-incoming`, `/active-def`, `/perma-def`, `/sending-def call:N inf:100 cav:50`, `/intel`, `/intel target:(-1|2)`, `/reclassify report:1 as:fake`.

- [ ] **Step 7: Commit**

```bash
git add src/commands/definitions.js src/handlers/router.js src/handlers/incomingReports.js src/handlers/defCalls.js src/handlers/intel.js
git commit -m "feat(defense): slash commands for report / def calls / intel / reclassify"
```

---

### Task 5.2: Extend expiry cron to handle `def_active`

**Files:**
- Modify: locate the existing expiry job (search for files in `src/jobs/` matching `expir`)

- [ ] **Step 1: Locate the expiry job**

Run: `grep -rn "expired" src/jobs/ src/index.js`

You should find a place where call types are listed for expiry checks. The change is to add `def_active` (and explicitly NOT `def_perma`, since perma has no deadline) to the type filter.

- [ ] **Step 2: Add `def_active` to the expiry whitelist**

For example, if the existing code is:

```javascript
const open = prepare("SELECT id FROM calls WHERE status='open' AND deadline IS NOT NULL AND deadline < ? AND type IN ('defense','offense','reinforce','urgent')").all(now);
```

change the `IN` list to `('defense','offense','reinforce','urgent','def_active')`.

- [ ] **Step 3: Manual smoke test**

Post an Active Def with an impact time `in 30s`. Wait 30s + 1 cron tick. Expect: call.status flips to `expired`, embed re-renders with `⏰ Expired` prefix.

- [ ] **Step 4: Commit**

```bash
git add src/jobs/<file>
git commit -m "feat(defense): include def_active in expiry cron"
```

---

### Task 5.3: Rename `defense` panel → `def-calls` migration + retire old panel handlers

**Files:**
- Modify: `src/db/migrations.js`
- Modify: `src/panel/types.js`

- [ ] **Step 1: Add the one-shot rename migration**

Append to `runMigrations()` in `src/db/migrations.js`:

```javascript
  // One-shot: rename existing 'defense' panels and open defense calls.
  try {
    const flag = prepare('SELECT value FROM config WHERE key=?').get('migrated_defense_to_def_calls');
    if (!flag) {
      exec("UPDATE panels SET type='def-calls' WHERE type='defense'");
      exec("UPDATE calls  SET type='def_active' WHERE type='defense' AND status='open'");
      prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('migrated_defense_to_def_calls', 'true');
    }
  } catch (err) {
    logger.warn('Migration defense → def-calls skipped:', err.message);
  }
```

- [ ] **Step 2: Remove the old `defense` panel from `PANEL_TYPES`**

In `src/panel/types.js`, change `PANEL_TYPES`:

```javascript
export const PANEL_TYPES = ['offense', 'resources', 'scout', 'general', 'roles', 'timer', 'reports', 'def-calls', 'leadership'];
```

Delete the entire `defense:` block from `titles`, `descriptions`, and `rowBuilders` (it lives in `def-calls` now). Keep the `COLOR.defense` entry (legacy renderers may still reference it via call type).

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass. (The earlier `defensePanels.test.js` still asserts the new types; nothing should break.)

- [ ] **Step 4: Manual smoke test (clean install)**

Delete or rename `data/data.sqlite` to simulate a fresh install. Run the bot. Verify all panel types deploy cleanly via `/setup ...`. Restore your real DB before next test.

For an existing DB, restart the bot. Verify the one-shot migration converted `defense` → `def-calls` panel and any open `defense` calls → `def_active`.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations.js src/panel/types.js
git commit -m "feat(defense): migrate defense panel/calls to def-calls/def_active"
```

---

### Task 5.4: Final integrated smoke test

- [ ] **Step 1: Fresh-install path**

Stop bot. Move `data/data.sqlite` aside. Start bot. Run `/setup reports`, `/setup def-calls`, `/setup leadership` in three test channels. Set `LEADERSHIP_ROLE_NAME`, `DEF_COORD_ROLE_NAME`, `DEF_ROLE_NAME` env vars to existing test guild roles.

- [ ] **Step 2: End-to-end flow**

1. As a Member: click `📢 Report Incoming` → manual → submit 1-wave fake (different coords). Embed: 🟢 LIKELY FAKE.
2. As a Member: submit a 4-wave report with spread=6. Embed: 🔴 CHIEF ATTEMPT + "IN-BETWEEN DEF POSSIBLE".
3. Verify leadership-channel dashboard appears with Hot targets, Top attackers, Threat tally, In-between def list.
4. As Leadership: click ⚔️ Escalate → Active Def on the chief report. Modal pre-fills. Submit `15000` needed.
5. As Member: click `🛟 Sending Def`. Modal. Submit `5000 inf / 2500 cav` = 10000 def.
6. As another Member: `/sending-def call:N inf:5000 cav:0` → 5000 def. Total = 15000 → FILLED. Buttons greyed. Archive embed in leadership channel with "Jump" link.
7. As Def Coord: `/reclassify report:1 as:chief`. Embed badge updates to `🔴 CHIEF ATTEMPT (manual)`.
8. As Leadership: 📅 Wider window → 7 days → ephemeral dashboard.
9. As Leadership: 🎯 Target drill-down with the chief defender coords. Verify report list + open call.
10. As Member without privileged role: click 🛡️ Active Def → expect "❌ Leadership / Def Coord only."

- [ ] **Step 3: Note any defects, file as follow-up tasks (do not commit fixes blindly).**

If you find broken behavior, write a one-line summary per defect and stop. The user reviews before fixes ship.

---

## Self-Review

After the plan is written, I look at it with fresh eyes against the spec. Findings:

**Spec coverage:**
- ✅ Roles & permissions (Task 0.1)
- ✅ Channels & panels (Task 0.4, 5.3)
- ✅ Data model — `pledges.inf/cav`, `incoming_reports`, config defaults (Task 0.3)
- ✅ Incoming Reports — chooser, manual modal, embed, threat detection (Phase 1 + 2)
- ✅ Threat detection with cascade + override (Task 2.1, 2.3)
- ✅ Active/Perma Def with structured Inf/Cav, edit/add/withdraw (Phase 3)
- ✅ Filled lifecycle + leadership archive (Task 3.2's `maybeMarkFilled`)
- ✅ Source-report wiring on escalate (Task 3.4)
- ✅ Intel dashboard + drill-downs + window widen (Phase 4)
- ✅ Dashboard buttons (Task 4.1, 4.2)
- ✅ Rebuild triggers + 5-min cron (Task 4.3)
- ✅ Slash commands (Task 5.1)
- ✅ Expiry hook (Task 5.2)
- ✅ Migration (Task 5.3)
- ✅ Paste-mode architectural stub (Task 1.1 — `parseRallyPointPaste` exported as stub; `report:paste` button replies "coming soon")

**Type consistency check:**
- `getTier` / `isLeadershipOrCoord` defined once (tier.js), imported everywhere.
- `classifyAndPersist` / `cascadeChiefFrom` defined in threat.js, imported in incomingReports.js.
- `buildReportEmbed`, `buildReportComponents`, `createIncomingReport` exported from incomingReports.js, used by defCalls.js via dynamic import (to avoid a circular dep — defCalls also re-renders reports on escalate).
- `buildDefCallEmbed`, `buildDefCallComponents` registered on `calls.js` renderer registry for `def_active`/`def_perma` so existing `refreshCall` works.
- `rebuildDashboard` exported from intel.js, called from incomingReports / defCalls / cron.

**Placeholder scan:** no TBD/TODO/"add validation" patterns. Every step has runnable code or specific commands.

**One known risk:** Task 4.3 Step 3 says "find where existing cron jobs are scheduled." The engineer must discover the project's cron convention. The fallback (new `src/jobs/intelDashboard.js`) is explicit, so this is bounded.

---

## Execution Handoff

Plan complete and saved to [docs/superpowers/plans/2026-05-30-defense-coordination-overhaul.md](docs/superpowers/plans/2026-05-30-defense-coordination-overhaul.md).
