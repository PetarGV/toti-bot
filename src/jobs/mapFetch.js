import cron from 'node-cron';
import { prepare, exec, transaction, getConfig, setConfig } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { unixNow } from '../utils/time.js';
import { inc, set } from '../utils/metrics.js';

// Travian map.sql has changed over time. Older exports had 11 values, while
// current exports include extra fields after population and may use "" strings.
const INSERT_RE = /INSERT\s+INTO\s+`?x_world`?(?:\s*\([^)]*\))?\s+VALUES\s*/gi;

function readParenthesized(text, start) {
  let depth = 0;
  let quote = null;
  let value = '';

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (quote) {
      value += ch;

      if (ch === '\\' && i + 1 < text.length) {
        value += text[++i];
        continue;
      }

      if (ch === quote) {
        if (text[i + 1] === quote) {
          value += text[++i];
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (ch === '\'' || ch === '"') {
      quote = ch;
      value += ch;
      continue;
    }

    if (ch === '(') {
      depth++;
      if (depth > 1) value += ch;
      continue;
    }

    if (ch === ')') {
      depth--;
      if (depth === 0) return { value, end: i + 1 };
      value += ch;
      continue;
    }

    if (depth >= 1) value += ch;
  }

  return null;
}

function extractTuples(text) {
  const tuples = [];
  let match;
  INSERT_RE.lastIndex = 0;

  while ((match = INSERT_RE.exec(text)) !== null) {
    let i = INSERT_RE.lastIndex;

    while (i < text.length) {
      while (/\s/.test(text[i])) i++;
      if (text[i] !== '(') break;

      const tuple = readParenthesized(text, i);
      if (!tuple) break;

      tuples.push(tuple.value);
      i = tuple.end;

      while (/\s/.test(text[i])) i++;
      if (text[i] !== ',') break;
      i++;
    }

    INSERT_RE.lastIndex = i;
  }

  return tuples;
}

function parseSqlToken(raw, quoted) {
  if (quoted) return raw;

  const token = raw.trim();
  if (/^NULL$/i.test(token)) return null;
  if (/^TRUE$/i.test(token)) return true;
  if (/^FALSE$/i.test(token)) return false;
  if (/^-?\d+$/.test(token)) return parseInt(token, 10);
  return token;
}

function parseSqlValues(tuple) {
  const values = [];
  let raw = '';
  let quote = null;
  let quoted = false;

  const push = () => {
    values.push(parseSqlToken(raw, quoted));
    raw = '';
    quoted = false;
  };

  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i];

    if (quote) {
      if (ch === '\\' && i + 1 < tuple.length) {
        raw += tuple[++i];
        continue;
      }

      if (ch === quote) {
        if (tuple[i + 1] === quote) {
          raw += tuple[++i];
        } else {
          quote = null;
        }
        continue;
      }

      raw += ch;
      continue;
    }

    if (ch === '\'' || ch === '"') {
      quote = ch;
      quoted = true;
      continue;
    }

    if (ch === ',') {
      push();
      continue;
    }

    raw += ch;
  }

  if (quote) return null;
  push();
  return values;
}

function toInt(value) {
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function nonZeroIntOrNull(value) {
  const n = toInt(value);
  return n === 0 ? null : n;
}

function nullableString(value) {
  if (value == null) return null;
  const s = String(value);
  return s === '' ? null : s;
}

export function parseMapSqlRows(text) {
  const rows = [];

  for (const tuple of extractTuples(text)) {
    const values = parseSqlValues(tuple);
    if (!values || values.length < 11) continue;

    const row = [
      toInt(values[0]),              // id
      toInt(values[1]),              // x
      toInt(values[2]),              // y
      toInt(values[3]),              // tid
      toInt(values[4]),              // vid
      nullableString(values[5]),     // village
      nonZeroIntOrNull(values[6]),   // uid
      nullableString(values[7]),     // player
      nonZeroIntOrNull(values[8]),   // aid
      nullableString(values[9]),     // alliance
      toInt(values[10]),             // population
    ];

    if (row[0] == null || row[1] == null || row[2] == null || row[10] == null) continue;
    rows.push(row);
  }

  return rows;
}

export async function fetchMap() {
  const serverUrl = getConfig('server_url') || process.env.TRAVIAN_SERVER_URL;
  if (!serverUrl) {
    throw new Error('TRAVIAN_SERVER_URL not set. Run `/admin set-server url:<full-server-url>` or set the env var.');
  }
  const url = `${serverUrl.replace(/\/$/, '')}/map.sql`;

  logger.info('Fetching map.sql from', url);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'TravianAllianceBot/1.0 (Discord)' },
  });

  if (res.status === 404) throw new Error('PRE_LAUNCH');
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

  const text = await res.text();

  if (text.length < 100) throw new Error('EMPTY_RESPONSE');

  const rows = parseMapSqlRows(text);

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
