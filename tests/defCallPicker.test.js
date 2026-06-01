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
