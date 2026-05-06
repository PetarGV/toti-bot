import cron from 'node-cron';
import { prepare, exec, transaction, getConfig, setConfig } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { unixNow } from '../utils/time.js';
import { inc, set } from '../utils/metrics.js';

// map.sql INSERT format (T4.6):
// INSERT INTO `x_world` VALUES (id,x,y,tid,vid,'village',uid,'player',aid,'alliance',population);
const ROW_RE = /INSERT INTO `x_world` VALUES \((\d+),(-?\d+),(-?\d+),(\d+),(\d+),'((?:[^'\\]|\\.)*)',(-?\d+),'((?:[^'\\]|\\.)*)',(-?\d+),'((?:[^'\\]|\\.)*)',(\d+)\);/g;

export async function fetchMap() {
  const serverUrl = getConfig('server_url') || process.env.TRAVIAN_SERVER_URL;
  const url = `${serverUrl}/map.sql`;

  logger.info('Fetching map.sql from', url);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'TravianAllianceBot/1.0 (Discord)' },
  });

  if (res.status === 404) throw new Error('PRE_LAUNCH');
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

  const text = await res.text();

  if (text.length < 100) throw new Error('EMPTY_RESPONSE');

  const rows = [];
  let m;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(text)) !== null) {
    rows.push([
      parseInt(m[1]),        // id
      parseInt(m[2]),        // x
      parseInt(m[3]),        // y
      parseInt(m[4]),        // tid
      parseInt(m[5]),        // vid
      m[6],                  // village
      parseInt(m[7]) || null,// uid
      m[8] || null,          // player
      parseInt(m[9]) || null,// aid
      m[10] || null,         // alliance
      parseInt(m[11]),       // population
    ]);
  }

  if (rows.length === 0) throw new Error('EMPTY_RESPONSE');

  const insertAll = transaction((rows) => {
    exec('DELETE FROM x_world');
    const ins = prepare(`
      INSERT OR REPLACE INTO x_world (id, x, y, tid, vid, village, uid, player, aid, alliance, population, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `);
    for (const r of rows) ins.run(...r);
  });

  insertAll(rows);

  setConfig('last_fetch_at', unixNow());
  setConfig('last_fetch_count', rows.length);

  inc('mapFetches');
  set('lastMapFetchAt', Date.now());
  logger.info(`map.sql: loaded ${rows.length} villages`);
  return rows.length;
}

export function startMapFetchJob() {
  const hour = process.env.MAP_FETCH_HOUR || '6';
  const schedule = `0 ${hour} * * *`;
  cron.schedule(schedule, async () => {
    try {
      await fetchMap();
    } catch (err) {
      inc('mapFetchErrors');
      logger.error('Scheduled map fetch failed:', err.message);
    }
  });
  logger.info(`Map fetch job scheduled at ${schedule}`);
}