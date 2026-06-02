import test from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_TYPES, buildPanel } from '../src/panel/types.js';

test('PANEL_TYPES includes reports, leadership, leadership-banner', () => {
  assert.ok(PANEL_TYPES.includes('reports'));
  assert.ok(PANEL_TYPES.includes('leadership'));
  assert.ok(PANEL_TYPES.includes('leadership-banner'));
});

test('reports panel exposes report:choose button', () => {
  const out = buildPanel('reports');
  const ids = out.components.flatMap(row => row.components.map(c => c.data.custom_id));
  assert.ok(ids.includes('report:choose'));
});

test('leadership panel exposes intel buttons and def-call creation buttons', () => {
  const out = buildPanel('leadership');
  const ids = out.components.flatMap(row => row.components.map(c => c.data.custom_id));
  assert.ok(ids.includes('intel:refresh'));
  assert.ok(ids.includes('intel:create_def_active'));
  assert.ok(ids.includes('intel:create_def_perma'));
});

test('leadership-banner panel has no interactive components', () => {
  const out = buildPanel('leadership-banner');
  assert.deepEqual(out.components, []);
});
