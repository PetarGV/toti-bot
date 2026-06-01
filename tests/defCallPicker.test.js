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

test('resolveStateToUnix: explicit seconds applied correctly', () => {
  const got = resolveStateToUnix({ dateOffset: 0, hour: 14, mt: 3, mo: 0, st: 1, so: 5 });
  const now = new Date();
  const want = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14, 30, 15) / 1000;
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

import { handlePickerNextButton, handlePickerBackButton, buildPickerPage2 } from '../src/handlers/defCallPicker.js';

function fakeButtonInteraction(customId) {
  return {
    customId,
    update: async function (payload) { this._updated = payload; },
    reply: async function (payload) { this._replied = payload; },
  };
}

test('buildPickerPage2: emits 3 action rows', () => {
  const payload = buildPickerPage2('msg-1', { st: null, so: null });
  assert.equal(payload.components.length, 3);
  assert.equal(payload.ephemeral, true);
  assert.match(payload.content, /Seconds/);
});

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
