import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNearbyEmbed } from '../src/handlers/nearby.js';
import { setupTestDb, resetTables } from './helpers/testDb.js';

test('buildNearbyEmbed renders nearby rows as a code-block table with population tags', async () => {
  await setupTestDb();
  resetTables();

  const embed = buildNearbyEmbed(
    { x: 0, y: 0 },
    {
      radius: 5,
      limit: 50,
      comparisonPlayer: 'Me',
      comparisonPopulation: 10000,
      centerVillage: {
        x: 0,
        y: 0,
        distance: 0,
        tid: 1,
        village: 'Home',
        player: 'Me',
        alliance: 'ALLY',
        population: 900,
        playerPopulation: 10000,
        populationTag: '',
      },
      villages: [
        {
          x: 1,
          y: 0,
          distance: 1,
          tid: 3,
          village: 'Small Farm',
          player: 'Small',
          alliance: 'FARM',
          population: 100,
          playerPopulation: 1900,
          populationTag: 'FARM',
        },
        {
          x: 2,
          y: 0,
          distance: 2,
          tid: 2,
          village: 'Large Threat',
          player: 'Large',
          alliance: 'BAD',
          population: 800,
          playerPopulation: 8100,
          populationTag: 'THREAT',
        },
      ],
      totalInRadius: 3,
      totalNearbyInRadius: 2,
    },
    null,
  );

  const json = embed.toJSON();

  assert.match(json.description, /^```text\n/);
  assert.match(json.description, /Tag/);
  assert.match(json.description, /VPop/);
  assert.match(json.description, /PPop/);
  assert.match(json.description, /Tribe/);
  assert.match(json.description, /FARM/);
  assert.match(json.description, /THREAT/);
  // Village name column dropped to keep the table from wrapping on a
  // typical Discord viewport.
  assert.doesNotMatch(json.description, /Small Farm|Large Threat/);
});
