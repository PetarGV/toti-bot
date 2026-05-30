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
