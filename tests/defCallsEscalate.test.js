import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';
import { parseDeadline } from '../src/utils/time.js';
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
  assert.equal(parseDeadline(componentById(json, 'arrival').value), 1_900_000_000);
  assert.match(componentById(json, 'notes').value, /Wave gap ~2\.0s/);
  assert.match(componentById(json, 'notes').value, /in-between def possible/);
});

test('from-report def call modal creates call and links the report', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  delete process.env.DEF_ROLE_NAME;

  const reportId = insertReport();
  prepare('INSERT INTO panels (type, channel_id, message_id) VALUES (?, ?, ?)').run('def-calls', 'def-channel', 'panel-msg');

  const sent = [];
  const guild = {
    id: 'guild-1',
    name: 'Test Guild',
    roles: {
      cache: { find: () => null },
      fetch: async () => ({ find: () => null }),
    },
  };
  const interaction = {
    customId: `combat:create_def_from_report:def_active:${reportId}`,
    member: fakeMember(['Defense Coordinator']),
    user: { id: 'coord-1' },
    guild,
    fields: {
      getTextInputValue(name) {
        return {
          coords: '(-12|34)',
          arrival: '2030-03-17 17:46:40',
          troops_needed: '5,000',
          notes: 'Wave gap ~2.0s - in-between def possible',
        }[name] ?? '';
      },
    },
    client: {
      channels: {
        fetch: async id => ({
          id,
          guild,
          send: async payload => {
            sent.push(payload);
            return { id: `msg-${sent.length}` };
          },
        }),
      },
    },
    reply: async payload => { interaction.replyPayload = payload; },
  };

  await routeModal(interaction);

  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  assert.ok(call, 'expected a def_active call to be inserted');
  assert.equal(call.x, -12);
  assert.equal(call.y, 34);
  assert.equal(call.message_id, 'msg-1');
  assert.deepEqual(JSON.parse(call.payload), {
    troops_needed: 5000,
    notes: 'Wave gap ~2.0s - in-between def possible',
    source_report_id: reportId,
  });

  const report = prepare('SELECT escalated_call_id FROM incoming_reports WHERE id = ?').get(reportId);
  assert.equal(report.escalated_call_id, call.id);
  assert.equal(sent.length, 1);
  assert.match(interaction.replyPayload.content, new RegExp(`Call #${call.id} posted`));
});
