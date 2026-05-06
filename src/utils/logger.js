import { existsSync, mkdirSync, createWriteStream, readdirSync, unlinkSync, statSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.LOG_DIR || join(__dirname, '../../data/logs');
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;
const RETAIN_DAYS = parseInt(process.env.LOG_RETAIN_DAYS || '14', 10);

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

let currentDay = todayKey();
let mainStream = openStream('bot');
let errorStream = openStream('bot-errors');

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function openStream(prefix) {
  return createWriteStream(join(LOG_DIR, `${prefix}.log`), { flags: 'a' });
}

function rotateIfNeeded() {
  const day = todayKey();
  if (day === currentDay) return;
  // Close, rename current, open fresh
  try { mainStream.end(); } catch {}
  try { errorStream.end(); } catch {}
  try {
    const main = join(LOG_DIR, 'bot.log');
    const errs = join(LOG_DIR, 'bot-errors.log');
    if (existsSync(main))  renameSafe(main, join(LOG_DIR, `bot-${currentDay}.log`));
    if (existsSync(errs)) renameSafe(errs, join(LOG_DIR, `bot-errors-${currentDay}.log`));
  } catch {}
  currentDay = day;
  mainStream  = openStream('bot');
  errorStream = openStream('bot-errors');
  pruneOld();
}

function renameSafe(from, to) {
  try { renameSync(from, to); } catch {}
}

function pruneOld() {
  try {
    const cutoff = Date.now() - RETAIN_DAYS * 86400_000;
    for (const f of readdirSync(LOG_DIR)) {
      if (!f.startsWith('bot-') || !f.endsWith('.log')) continue;
      const p = join(LOG_DIR, f);
      if (statSync(p).mtimeMs < cutoff) {
        unlinkSync(p);
      }
    }
  } catch {}
}

function format(level, args) {
  const ts = new Date().toISOString();
  const body = args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
  return `[${ts}] [${level.toUpperCase()}] ${body}\n`;
}

function log(level, ...args) {
  if (LEVELS[level] < MIN) return;
  rotateIfNeeded();
  const line = format(level, args);
  // stdout
  if (level === 'error') process.stderr.write(line);
  else process.stdout.write(line);
  // file
  try { mainStream.write(line); } catch {}
  if (level === 'error' || level === 'warn') {
    try { errorStream.write(line); } catch {}
  }
}

export function flushLogs() {
  return new Promise((resolve) => {
    let pending = 2;
    const done = () => { if (--pending === 0) resolve(); };
    try { mainStream.end(done); }   catch { done(); }
    try { errorStream.end(done); }  catch { done(); }
  });
}

export const logger = {
  debug: (...a) => log('debug', ...a),
  info:  (...a) => log('info',  ...a),
  warn:  (...a) => log('warn',  ...a),
  error: (...a) => log('error', ...a),
};