const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_MS = 60_000;

const buckets = new Map();

export function checkRateLimit(userId, {
  now = Date.now(),
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
} = {}) {
  const cutoff = now - windowMs;
  const timestamps = (buckets.get(userId) ?? []).filter((ts) => ts > cutoff);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    buckets.set(userId, timestamps);
    return { allowed: false, retryAfterSec };
  }

  timestamps.push(now);
  buckets.set(userId, timestamps);
  return { allowed: true, retryAfterSec: 0 };
}

export function _resetRateLimit() {
  buckets.clear();
}
