import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runMigrations } from './migrations.js';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
let DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/travian.db');
let DATA_DIR = dirname(DB_PATH);

let db;
let SQL;

export async function initDb() {
  // Re-compute paths to support test isolation (process.env.DB_PATH can change per test)
  DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/travian.db');
  DATA_DIR = dirname(DB_PATH);

  SQL = await initSqlJs();

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  if (existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.pragma = (s) => db.run(`PRAGMA ${s}`);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  db.run(schema);

  runMigrations();

  persist();
  flushDb();
  return db;
}

const PERSIST_DEBOUNCE_MS = 100;
let persistTimer = null;
let persistDirty = false;

function persistNow() {
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
  persistDirty = false;
}

function persist() {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistDirty) {
      try { persistNow(); } catch (err) {
        // Logger may not be initialised early; fall back to stderr
        process.stderr.write(`[DB] persist failed: ${err.message}\n`);
      }
    }
  }, PERSIST_DEBOUNCE_MS);
}

export function flushDb() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  if (persistDirty && db) persistNow();
}

export function getDb() {
  if (!db) throw new Error('DB not initialised — await initDb() first');
  return db;
}

// Wrap db so callers can use prepare().run() / prepare().get() / prepare().all()
// sql.js has a different API; we shim the better-sqlite3 style interface.
export function prepare(sql) {
  return {
    run(...params) {
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(params);
      stmt.step();
      stmt.free();
      const lastInsertRowid = db.exec('SELECT last_insert_rowid()')[0]?.values?.[0]?.[0] ?? 0;
      const changes = db.getRowsModified?.() ?? 0;
      persist();
      return { lastInsertRowid, changes };
    },
    get(...params) {
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(params);
      let row;
      if (stmt.step()) row = stmt.getAsObject();
      stmt.free();
      return row;
    },
    all(...params) {
      const results = [];
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(params);
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return results;
    },
  };
}

export function exec(sql) {
  db.run(sql);
  persist();
}

export function transaction(fn) {
  return (...args) => {
    db.run('BEGIN');
    try {
      fn(...args);
      db.run('COMMIT');
      persist();
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }
  };
}

export function getConfig(key) {
  const row = prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row?.value ?? null;
}

export function setConfig(key, value) {
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}
