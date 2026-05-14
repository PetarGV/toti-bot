import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceFields,
  normalizeNearbyOptions,
  searchNearbyRows,
} from '../src/utils/mapSearch.js';

const sampleRows = [
  { id: 1, x: 0, y: 0, tid: 1, village: 'Center', player: 'CenterPlayer', alliance: 'ALLY', population: 900 },
  { id: 2, x: 3, y: 0, tid: 2, village: 'East 3', player: 'EastPlayer', alliance: 'ALLY', population: 100 },
  { id: 3, x: 0, y: 4, tid: 3, village: 'North 4', player: 'NorthPlayer', alliance: 'TAG', population: 500 },
  { id: 4, x: 3, y: 4, tid: 6, village: 'Diagonal 5', player: 'DiagonalPlayer', alliance: 'TAG', population: 700 },
  { id: 5, x: 6, y: 0, tid: 7, village: 'Far 6', player: 'FarPlayer', alliance: 'FAR', population: 1000 },
];

test('normalizeNearbyOptions applies defaults and clamps bounds', () => {
  assert.deepEqual(normalizeNearbyOptions(), { radius: 10, limit: 10 });
  assert.deepEqual(normalizeNearbyOptions({ radius: null, limit: null }), { radius: 10, limit: 10 });
  assert.deepEqual(normalizeNearbyOptions({ radius: 0, limit: 0 }), { radius: 1, limit: 1 });
  assert.deepEqual(normalizeNearbyOptions({ radius: 99, limit: 99 }), { radius: 50, limit: 40 });
  assert.deepEqual(normalizeNearbyOptions({ radius: '12', limit: '7' }), { radius: 12, limit: 7 });
});

test('distanceFields returns Euclidean distance in fields', () => {
  assert.equal(distanceFields({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(distanceFields({ x: -2, y: -3 }, { x: -2, y: -3 }), 0);
});

test('searchNearbyRows separates the center village and limits nearby rows', () => {
  const result = searchNearbyRows({ x: 0, y: 0 }, sampleRows, { radius: 5, limit: 2 });

  assert.equal(result.radius, 5);
  assert.equal(result.limit, 2);
  assert.equal(result.totalInRadius, 4);
  assert.equal(result.centerVillage.village, 'Center');
  assert.deepEqual(result.villages.map((row) => row.village), ['East 3', 'North 4']);
  assert.deepEqual(result.villages.map((row) => row.distance), [3, 4]);
});

test('searchNearbyRows sorts ties by population descending and then coordinates', () => {
  const tieRows = [
    { id: 10, x: 3, y: 0, village: 'Lower Pop', population: 100 },
    { id: 11, x: -3, y: 0, village: 'Same Pop Lower X', population: 500 },
    { id: 12, x: 0, y: 3, village: 'Same Pop Higher X', population: 500 },
    { id: 13, x: 0, y: -3, village: 'Highest Pop', population: 900 },
  ];

  const result = searchNearbyRows({ x: 0, y: 0 }, tieRows, { radius: 3, limit: 10 });

  assert.deepEqual(result.villages.map((row) => row.village), [
    'Highest Pop',
    'Same Pop Lower X',
    'Same Pop Higher X',
    'Lower Pop',
  ]);
});

test('searchNearbyRows returns an empty result when nothing is inside the radius', () => {
  const result = searchNearbyRows({ x: 100, y: 100 }, sampleRows, { radius: 1, limit: 10 });

  assert.equal(result.centerVillage, null);
  assert.deepEqual(result.villages, []);
  assert.equal(result.totalInRadius, 0);
  assert.equal(result.totalNearbyInRadius, 0);
});

test('searchNearbyRows labels players from total population compared to the requester', () => {
  const rows = [
    { id: 1, x: 0, y: 0, tid: 1, village: 'Home', player: 'Me', alliance: 'ALLY', population: 900 },
    { id: 2, x: 1, y: 0, tid: 2, village: 'Small Farm', player: 'Small', alliance: 'FARM', population: 100 },
    { id: 3, x: 2, y: 0, tid: 3, village: 'Middle', player: 'Middle', alliance: 'MID', population: 400 },
    { id: 4, x: 3, y: 0, tid: 6, village: 'Large Threat', player: 'Large', alliance: 'BAD', population: 800 },
  ];

  const result = searchNearbyRows({ x: 0, y: 0 }, rows, {
    radius: 5,
    limit: 10,
    comparisonPlayer: 'Me',
    comparisonPopulation: 10000,
    playerPopulationTotals: new Map([
      ['Me', 10000],
      ['Small', 1900],
      ['Middle', 5000],
      ['Large', 8100],
    ]),
  });

  assert.equal(result.comparisonPlayer, 'Me');
  assert.equal(result.comparisonPopulation, 10000);
  assert.equal(result.centerVillage.populationTag, '');
  assert.equal(result.centerVillage.playerPopulation, 10000);
  assert.deepEqual(
    result.villages.map((row) => [row.player, row.playerPopulation, row.populationTag]),
    [
      ['Small', 1900, 'FARM'],
      ['Middle', 5000, ''],
      ['Large', 8100, 'THREAT'],
    ],
  );
});
