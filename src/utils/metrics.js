const counters = {
  startedAt:        Date.now(),
  callsCreated:     0,
  pledgesSubmitted: 0,
  mapFetches:       0,
  mapFetchErrors:   0,
  lastMapFetchAt:   null,
  lastErrorAt:      null,
  lastErrorMessage: null,
};

export function inc(key, by = 1) {
  if (key in counters && typeof counters[key] === 'number') counters[key] += by;
}

export function set(key, value) {
  counters[key] = value;
}

export function recordError(err) {
  counters.lastErrorAt = Date.now();
  counters.lastErrorMessage = (err && err.message) || String(err);
}

export function snapshot() {
  return {
    ...counters,
    uptimeSec: Math.floor((Date.now() - counters.startedAt) / 1000),
  };
}