export function unixNow() {
  return Math.floor(Date.now() / 1000);
}

export function discordTimestamp(unix, style = 'R') {
  // styles: t=short time, T=long time, d=short date, D=long date,
  //         f=short datetime, F=long datetime, R=relative
  return `<t:${unix}:${style}>`;
}

export function parseDeadline(input) {
  // Accepts: "14:30", "14:30:45", "in 2h", "in 30m", "in 1h30m45s",
  //          "YYYY-MM-DD HH:MM[:SS]", "MM-DD HH:MM[:SS]", unix timestamp
  input = String(input).trim().toLowerCase();

  const rel = input.match(/^in\s*(?:(\d+)h)?\s*(?:(\d+)m?)?\s*(?:(\d+)s)?$/);
  if (rel && (rel[1] || rel[2] || rel[3])) {
    const h = parseInt(rel[1] || 0, 10);
    const m = parseInt(rel[2] || 0, 10);
    const s = parseInt(rel[3] || 0, 10);
    return unixNow() + h * 3600 + m * 60 + s;
  }

  // YYYY-MM-DD HH:MM[:SS] (separator may be space or 'T')
  const full = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ t](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (full) {
    const d = new Date(+full[1], +full[2] - 1, +full[3], +full[4], +full[5], +(full[6] || 0), 0);
    return Math.floor(d.getTime() / 1000);
  }

  // MM-DD HH:MM[:SS] — assumes current year, rolls to next year if already past
  const md = input.match(/^(\d{1,2})-(\d{1,2})[ t](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (md) {
    const now = new Date();
    let target = new Date(now.getFullYear(), +md[1] - 1, +md[2], +md[3], +md[4], +(md[5] || 0), 0);
    if (target.getTime() < now.getTime() - 86400_000) target.setFullYear(now.getFullYear() + 1);
    return Math.floor(target.getTime() / 1000);
  }

  // HH:MM[:SS] — today, rolling to tomorrow if already past
  const clock = input.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(parseInt(clock[1], 10), parseInt(clock[2], 10), parseInt(clock[3] || 0, 10), 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return Math.floor(target.getTime() / 1000);
  }

  const ts = parseInt(input, 10);
  if (!isNaN(ts) && ts > 1e9) return ts;

  return null;
}

// Format a unix timestamp as "YYYY-MM-DD HH:MM:SS" in process-local time
// (round-trips with parseDeadline). Always includes seconds.
export function formatDeadline(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
