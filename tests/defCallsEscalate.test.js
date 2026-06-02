import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { routeButton, routeModal } from '../src/handlers/router.js';

function fakeMember(roleNames) {
  return { roles: { cache: { some: pred => roleNames.some(name => pred({ name })) } } };
}

function insertReport(overrides = {}) {
  const row = {
    reporter_id: 'member-1',
    defender_x: -12,
    defender_y: 34,
    attacker_x: 56,
    attacker_y: -78,
    first_eta: 1_900_000_000,
    waves: 4,
    wave_spread_sec: 6,
    notes: null,
    threat_class: 'chief',
    ...overrides,
  };
  const result = prepare(`
    INSERT INTO incoming_reports
      (reporter_id, defender_x, defender_y, attacker_x, attacker_y, first_eta, waves, wave_spread_sec, notes, threat_class)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.reporter_id,
    row.defender_x,
    row.defender_y,
    row.attacker_x,
    row.attacker_y,
    row.first_eta,
    row.waves,
    row.wave_spread_sec,
    row.notes,
    row.threat_class,
  );
  return result.lastInsertRowid;
}

function componentById(modalJson, customId) {
  return modalJson.components
    .flatMap(row => row.components)
    .find(component => component.custom_id === customId);
}

test('report escalate active button opens a pre-filled def call modal', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';

  const reportId = insertReport();
  const interaction = {
    customId: `report:escalate_active:${reportId}`,
    member: fakeMember(['Leadership']),
    user: { id: 'leader-1' },
    showModal: async modal => { interaction.modal = modal; },
    reply: async payload => { interaction.replyPayload = payload; },
  };

  await routeButton(interaction);

  assert.ok(interaction.modal, 'expected router to show an escalation modal');
  const json = interaction.modal.toJSON();
  assert.equal(json.custom_id, `combat:create_def_from_report:def_active:${reportId}`);
  assert.equal(componentById(json, 'coords').value, '(-12|34)');
  assert.match(componentById(json, 'notes').value, /Wave spread 6s/);
  assert.match(componentById(json, 'notes').value, /in-between def possible/);
  // arrival is now present, pre-filled with the report's first_eta as a UTC timestamp.
  const arrival = componentById(json, 'arrival');
  assert.ok(arrival, 'arrival field should be present');
  assert.equal(arrival.required, false);
  assert.equal(arrival.value, '2030-03-17 17:46:40', 'arrival pre-fill should equal formatDeadline(first_eta)');
});

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
          arrival: '',          // ← empty arrival forces the picker
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

test('from-report def call modal with valid future arrival creates call directly', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  delete process.env.DEF_ROLE_NAME;

  const reportId = insertReport();
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');

  const futureIso = new Date(Date.now() + 3600_000).toISOString();
  const guild = { id: 'g', roles: { cache: { find: () => null }, fetch: async () => ({ find: () => null }) } };
  const interaction = {
    customId: `combat:create_def_from_report:def_active:${reportId}`,
    member: fakeMember(['Defense Coordinator']),
    user: { id: 'coord-1' },
    guild,
    fields: {
      getTextInputValue(name) {
        return {
          coords: '(-12|34)',
          troops_needed: '5000',
          notes: '',
          arrival: futureIso,
        }[name] ?? '';
      },
    },
    client: { channels: { fetch: async () => ({ guild, send: async () => ({ id: 'sent-1' }) }) } },
    reply: async (p) => { interaction._replied = p; },
  };

  await routeModal(interaction);

  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  assert.ok(call, 'expected call to be created directly');
  assert.equal(call.x, -12);
  assert.equal(call.y, 34);
  assert.match(interaction._replied.content, /Call #\d+ posted/);
});

test('def_active panel button opens modal with optional arrival field', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';

  const interaction = {
    customId: 'call:def_active',
    member: fakeMember(['Leadership']),
    user: { id: 'leader-1' },
    showModal: async modal => { interaction.modal = modal; },
  };
  await routeButton(interaction);

  assert.ok(interaction.modal, 'expected a modal');
  const json = interaction.modal.toJSON();
  const arrival = componentById(json, 'arrival');
  assert.ok(arrival, 'arrival field should be present for def_active');
  assert.equal(arrival.required, false);
  assert.match(arrival.placeholder, /or just type it here/);
});

test('def_perma panel button modal has no arrival field', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';

  const interaction = {
    customId: 'call:def_perma',
    member: fakeMember(['Leadership']),
    user: { id: 'leader-1' },
    showModal: async modal => { interaction.modal = modal; },
  };
  await routeButton(interaction);

  assert.ok(interaction.modal, 'expected a modal');
  const json = interaction.modal.toJSON();
  assert.equal(componentById(json, 'arrival'), undefined, 'def_perma has no deadline, no arrival field');
});
