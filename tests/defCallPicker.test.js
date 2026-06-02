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

import {
  buildHeaderText,
  resolveStateToUnix,
  buildPickerPage1,
} from '../src/handlers/defCallPicker.js';

test('buildHeaderText: all unpicked', () => {
  assert.equal(buildHeaderText({}), '____-__-__ __:__:__ UTC');
});

test('buildHeaderText: partial — date + hour', () => {
  const header = buildHeaderText({ dateOffset: 0, hour: 14 });
  assert.match(header, /^\d{4}-\d{2}-\d{2} 14:__:__ UTC$/);
});

test('buildHeaderText: partial — minute tens only renders as __', () => {
  const header = buildHeaderText({ dateOffset: 0, hour: 14, mt: 3 });
  assert.match(header, /^\d{4}-\d{2}-\d{2} 14:__:__ UTC$/);
});

test('buildHeaderText: full minute (mt+mo), no seconds', () => {
  const header = buildHeaderText({ dateOffset: 0, hour: 14, mt: 3, mo: 0 });
  assert.match(header, /^\d{4}-\d{2}-\d{2} 14:30:__ UTC$/);
});

test('buildHeaderText: full — all components', () => {
  const header = buildHeaderText({ dateOffset: 1, hour: 14, mt: 3, mo: 0, st: 4, so: 5 });
  assert.match(header, /^\d{4}-\d{2}-\d{2} 14:30:45 UTC$/);
});

test('resolveStateToUnix: incomplete state returns null', () => {
  assert.equal(resolveStateToUnix({ dateOffset: 0, hour: 14 }), null);
  assert.equal(resolveStateToUnix({ dateOffset: 0, hour: 14, mt: 3 }), null);
  assert.equal(resolveStateToUnix({}), null);
});

test('resolveStateToUnix: defaults seconds to 00 when st/so unset', () => {
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

test('resolveStateToUnix: explicit seconds applied correctly', () => {
  const got = resolveStateToUnix({ dateOffset: 0, hour: 14, mt: 3, mo: 0, st: 1, so: 5 });
  const now = new Date();
  const want = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14, 30, 15) / 1000;
  assert.equal(got, want);
});

test('resolveStateToUnix: partial seconds (st set, so unset) defaults to :00', () => {
  const got = resolveStateToUnix({ dateOffset: 0, hour: 14, mt: 3, mo: 0, st: 4 });
  const now = new Date();
  const want = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14, 30, 0) / 1000;
  assert.equal(got, want);
});

import { handlePickerSelect } from '../src/handlers/defCallPicker.js';

function fakeSelectInteraction(customId, value) {
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
    dateOffset: null, hour: null, minute: null, second: null,
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

import { handlePickerNextButton, handlePickerBackButton } from '../src/handlers/defCallPicker.js';

function fakeButtonInteraction(customId) {
  return {
    customId,
    update: async function (payload) { this._updated = payload; },
    reply: async function (payload) { this._replied = payload; },
  };
}

test('handlePickerNextButton: returns expired message (legacy button)', async () => {
  const interaction = fakeButtonInteraction('combat:newpick:next:msg-N1');
  await handlePickerNextButton(interaction);
  assert.equal(interaction._updated.components.length, 0);
  assert.match(interaction._updated.content, /expired/i);
});

test('handlePickerBackButton: returns expired message (legacy button)', async () => {
  const interaction = fakeButtonInteraction('combat:newpick:back:msg-B1');
  await handlePickerBackButton(interaction);
  assert.equal(interaction._updated.components.length, 0);
  assert.match(interaction._updated.content, /expired/i);
});

test('handlePickerSelect: minute select updates state and re-renders', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-S1', {
    type: 'def_active', dateOffset: 0, hour: 14, minute: null, second: null,
    createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:minute:msg-S1',
    values: ['30'],
    update: async function (payload) { this._updated = payload; },
  };
  await handlePickerSelect(interaction);
  assert.equal(_getPickerStateForTests('msg-S1').minute, 30);
  assert.equal(interaction._updated.components.length, 5);
  assert.match(interaction._updated.content, /Pick impact time/);
});

test('handlePickerSelect: second select updates state', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-S2', {
    type: 'def_active', dateOffset: 0, hour: 14, minute: 30, second: null,
    createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:second:msg-S2',
    values: ['15'],
    update: async function (payload) { this._updated = payload; },
  };
  await handlePickerSelect(interaction);
  assert.equal(_getPickerStateForTests('msg-S2').second, 15);
});

import { handlePickerCreateButton } from '../src/handlers/defCallPicker.js';
import { handlePickerTypeInsteadButton, handlePickerTypeInsteadSubmit } from '../src/handlers/defCallPicker.js';
import { setupTestDb, resetTables } from './helpers/testDb.js';
import { prepare } from '../src/db/client.js';

test('handlePickerCreateButton: rejects incomplete state', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-C1', { type: 'def_active', dateOffset: null, hour: 14, minute: 30, createdAt: Date.now() });
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
  // dateOffset: -1 = yesterday midnight UTC, always in the past.
  _setPickerStateForTests('msg-C2', {
    type: 'def_active', dateOffset: -1, hour: 0, minute: 0, second: 0,
    createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:create:msg-C2',
    reply: async function (p) { this._replied = p; },
    update: async function (p) { this._updated = p; },
  };
  await handlePickerCreateButton(interaction);
  assert.ok(interaction._replied, 'expected a reply for past deadline');
  assert.match(interaction._replied.content, /past/);
});

test('handlePickerCreateButton: creates call on full state', async () => {
  await setupTestDb();
  resetTables();
  _resetPickerStateForTests();
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');

  const state = {
    type: 'def_active',
    x: -12, y: 34, troopsNeeded: 5000, notes: 'pls help', sourceReportId: null,
    dateOffset: 1,   // tomorrow — always in the future
    hour: 12,
    minute: 0,
    second: 0,
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
    _pickerInteraction: { editReply: async () => {} },
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
