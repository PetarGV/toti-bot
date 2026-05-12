import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, flushDb, exec } from '../../src/db/client.js';

let initialised = false;

export async function setupTestDb() {
  if (initialised) return;
  const dir = mkdtempSync(join(tmpdir(), 'travian-test-'));
  process.env.DB_PATH = join(dir, 'test.db');
  await initDb();
  initialised = true;
  process.on('exit', () => {
    try { flushDb(); rmSync(dir, { recursive: true, force: true }); } catch {}
  });
}

const ALL_TABLES = [
  'user_ign_links',
  'travian_accounts',
  'pledges',
  'calls',
  'panels',
  'timers',
  'x_world',
  'users',
  'config',
];

export function resetTables() {
  for (const t of ALL_TABLES) {
    try { exec(`DELETE FROM ${t}`); } catch {}
  }
}
