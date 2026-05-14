import { prepare } from '../db/client.js';

const DEFAULT_RADIUS = 10;
const DEFAULT_LIMIT = 10;
const MIN_RADIUS = 1;
const MAX_RADIUS = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 40;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function integerOrFallback(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getPlayerPopulationTotal(player, playerPopulationTotals) {
  if (!player || !playerPopulationTotals) return null;
  if (playerPopulationTotals instanceof Map) {
    return playerPopulationTotals.has(player)
      ? numeric(playerPopulationTotals.get(player), 0)
      : null;
  }
  if (Object.hasOwn(playerPopulationTotals, player)) {
    return numeric(playerPopulationTotals[player], 0);
  }
  return null;
}

function getPopulationTag(row, comparisonPlayer, comparisonPopulation, playerPopulation) {
  if (!comparisonPlayer || comparisonPopulation <= 0 || !row.player || playerPopulation == null) return '';
  if (String(row.player) === String(comparisonPlayer)) return '';

  const ratio = playerPopulation / comparisonPopulation;
  if (ratio < 0.2) return 'FARM';
  if (ratio > 0.8) return 'THREAT';
  return '';
}

export function normalizeNearbyOptions(options = {}) {
  const radius = integerOrFallback(options.radius, DEFAULT_RADIUS);
  const limit = integerOrFallback(options.limit, DEFAULT_LIMIT);

  return {
    radius: clamp(radius, MIN_RADIUS, MAX_RADIUS),
    limit: clamp(limit, MIN_LIMIT, MAX_LIMIT),
  };
}

export function distanceFields(center, row) {
  const dx = numeric(row.x) - numeric(center.x);
  const dy = numeric(row.y) - numeric(center.y);
  return Math.sqrt(dx * dx + dy * dy);
}

function compareNearbyRows(a, b) {
  const distanceDiff = a.distance - b.distance;
  if (distanceDiff !== 0) return distanceDiff;

  const populationDiff = numeric(b.population) - numeric(a.population);
  if (populationDiff !== 0) return populationDiff;

  const xDiff = numeric(a.x) - numeric(b.x);
  if (xDiff !== 0) return xDiff;

  const yDiff = numeric(a.y) - numeric(b.y);
  if (yDiff !== 0) return yDiff;

  return String(a.village ?? '').localeCompare(String(b.village ?? ''));
}

export function searchNearbyRows(center, rows, options = {}) {
  const normalized = normalizeNearbyOptions(options);
  const comparisonPlayer = options.comparisonPlayer ?? null;
  const comparisonPopulation = numeric(options.comparisonPopulation, 0);
  const exactMatches = [];
  const nearby = [];

  for (const row of rows) {
    const distance = distanceFields(center, row);
    if (distance > normalized.radius) continue;

    const playerPopulation = getPlayerPopulationTotal(row.player, options.playerPopulationTotals);
    const enriched = {
      ...row,
      distance,
      playerPopulation,
      populationTag: getPopulationTag(row, comparisonPlayer, comparisonPopulation, playerPopulation),
    };
    if (numeric(row.x) === numeric(center.x) && numeric(row.y) === numeric(center.y)) {
      exactMatches.push(enriched);
    } else {
      nearby.push(enriched);
    }
  }

  exactMatches.sort(compareNearbyRows);
  nearby.sort(compareNearbyRows);

  return {
    center: { x: numeric(center.x), y: numeric(center.y) },
    radius: normalized.radius,
    limit: normalized.limit,
    comparisonPlayer,
    comparisonPopulation: comparisonPopulation > 0 ? comparisonPopulation : null,
    centerVillage: exactMatches[0] ?? null,
    villages: nearby.slice(0, normalized.limit),
    totalInRadius: exactMatches.length + nearby.length,
    totalNearbyInRadius: nearby.length,
  };
}

export function getMapDataCount() {
  return prepare('SELECT COUNT(*) AS c FROM x_world').get()?.c ?? 0;
}

export function getLastMapFetchedAt() {
  const row = prepare('SELECT MAX(fetched_at) AS fetched_at FROM x_world').get();
  const value = Number(row?.fetched_at ?? 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function getPlayerPopulationTotals(players) {
  const uniquePlayers = [...new Set(players.filter(Boolean).map(String))];
  if (uniquePlayers.length === 0) return new Map();

  const placeholders = uniquePlayers.map(() => '?').join(', ');
  const rows = prepare(`
    SELECT player, SUM(COALESCE(population, 0)) AS population
    FROM x_world
    WHERE player IN (${placeholders})
    GROUP BY player
  `).all(...uniquePlayers);

  return new Map(rows.map((row) => [row.player, numeric(row.population, 0)]));
}

export function findNearbyVillages(center, options = {}) {
  const normalized = normalizeNearbyOptions(options);
  const comparisonPlayer = options.comparisonPlayer ?? null;
  const rows = prepare(`
    SELECT id, x, y, tid, vid, village, uid, player, aid, alliance, population, fetched_at
    FROM x_world
    WHERE x BETWEEN ? AND ?
      AND y BETWEEN ? AND ?
  `).all(
    center.x - normalized.radius,
    center.x + normalized.radius,
    center.y - normalized.radius,
    center.y + normalized.radius,
  );

  const playerPopulationTotals = getPlayerPopulationTotals([
    comparisonPlayer,
    ...rows.map((row) => row.player),
  ]);
  const comparisonPopulation = comparisonPlayer
    ? playerPopulationTotals.get(String(comparisonPlayer)) ?? 0
    : 0;

  return searchNearbyRows(center, rows, {
    ...normalized,
    comparisonPlayer,
    comparisonPopulation,
    playerPopulationTotals,
  });
}
