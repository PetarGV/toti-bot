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
