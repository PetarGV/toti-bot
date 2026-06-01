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
