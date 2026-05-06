export function unixNow() {
  return Math.floor(Date.now() / 1000);
}

export function discordTimestamp(unix, style = 'R') {
  // styles: t=short time, T=long time, d=short date, D=long date,
  //         f=short datetime, F=long datetime, R=relative
  return `<t:${unix}:${style}>`;
}

export function parseDeadline(input) {
  // Accepts: "14:30", "in 2h", "in 30m", "in 1h30m", unix timestamp
  input = String(input).trim().toLowerCase();

  const rel = input.match(/^in\s*(?:(\d+)h)?\s*(?:(\d+)m?)?$/);
  if (rel) {
    const h = parseInt(rel[1] || 0, 10);
    const m = parseInt(rel[2] || 0, 10);
    return unixNow() + h * 3600 + m * 60;
  }

  const clock = input.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(parseInt(clock[1], 10), parseInt(clock[2], 10), 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return Math.floor(target.getTime() / 1000);
  }

  const ts = parseInt(input, 10);
  if (!isNaN(ts) && ts > 1e9) return ts;

  return null;
}
