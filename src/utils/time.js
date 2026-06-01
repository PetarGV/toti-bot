import * as chrono from 'chrono-node';

export function unixNow() {
  return Math.floor(Date.now() / 1000);
}

export function discordTimestamp(unix, style = 'R') {
  // styles: t=short time, T=long time, d=short date, D=long date,
  //         f=short datetime, F=long datetime, R=relative
  return `<t:${unix}:${style}>`;
}

export function parseDeadline(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // 1. Discord <t:N:?> tag — extract unix seconds directly
  const tag = raw.match(/^<t:(\d{9,11})(?::[tTdDfFR])?>$/);
  if (tag) return parseInt(tag[1], 10);

  // 2. Bare unix seconds (post-2001)
  if (/^\d{10,11}$/.test(raw)) return parseInt(raw, 10);

  // 3. '+2h30m' shorthand for 'in 2h30m'
  const normalized = raw.replace(/^\+/, 'in ');

  // 4. chrono-node — parses ISO 8601 (with Z/offset), 'YYYY-MM-DD HH:MM:SS',
  //    'in 2h30m', 'tomorrow 14:30', etc.
  //    Passing reference as { instant, timezone: 'UTC' } (ReferenceWithTimezone)
  //    makes chrono interpret tz-less components as UTC.
  //    forwardDate: true rolls genuinely-ambiguous past times forward
  //    (does not touch explicit dates with year specified).
  const parsed = chrono.parseDate(normalized, { instant: new Date(), timezone: 'UTC' }, { forwardDate: true });
  if (!parsed) return null;
  return Math.floor(parsed.getTime() / 1000);
}

// Format a unix timestamp as "YYYY-MM-DD HH:MM:SS" in UTC
// (round-trips with parseDeadline). Always includes seconds.
export function formatDeadline(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
