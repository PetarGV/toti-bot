import { prepare } from '../db/client.js';

function asText(value) {
  return value == null ? '' : String(value);
}

export function normalizeNameForMatch(value) {
  return asText(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

export function memberDisplayName(member) {
  return asText(
    member?.displayName
      ?? member?.nickname
      ?? member?.user?.globalName
      ?? member?.user?.username
      ?? member?.username,
  );
}

function normalizePlayer(player) {
  const name = asText(player?.player).trim();
  const normalizedName = normalizeNameForMatch(name);
  if (!name || !normalizedName) return null;

  return {
    ...player,
    player: name,
    normalizedName,
    normalizedLength: normalizedName.length,
  };
}

export function normalizePlayersForMatch(players) {
  return players
    .map(normalizePlayer)
    .filter(Boolean)
    .sort((a, b) => {
      const lengthDiff = b.normalizedLength - a.normalizedLength;
      if (lengthDiff !== 0) return lengthDiff;

      const populationDiff = Number(b.population ?? 0) - Number(a.population ?? 0);
      if (populationDiff !== 0) return populationDiff;

      return a.player.localeCompare(b.player);
    });
}

export function matchMemberToPlayer(member, players) {
  const normalizedMemberName = normalizeNameForMatch(memberDisplayName(member));
  if (!normalizedMemberName) {
    return { status: 'unmatched', normalizedMemberName };
  }

  const matches = normalizePlayersForMatch(players)
    .filter((player) => normalizedMemberName.includes(player.normalizedName));

  if (matches.length === 0) {
    return { status: 'unmatched', normalizedMemberName };
  }

  const bestLength = matches[0].normalizedLength;
  const best = matches.filter((player) => player.normalizedLength === bestLength);

  if (best.length > 1) {
    return { status: 'ambiguous', normalizedMemberName, players: best };
  }

  return { status: 'matched', normalizedMemberName, player: best[0] };
}

export function buildMemberMapAudit(members, players) {
  const normalizedPlayers = normalizePlayersForMatch(players);
  const audit = {
    totalMembers: members.length,
    totalPlayers: normalizedPlayers.length,
    matched: [],
    ambiguous: [],
    unmatched: [],
  };

  for (const member of members) {
    const result = matchMemberToPlayer(member, normalizedPlayers);
    const row = { member, displayName: memberDisplayName(member), ...result };

    if (result.status === 'matched') {
      audit.matched.push(row);
    } else if (result.status === 'ambiguous') {
      audit.ambiguous.push(row);
    } else {
      audit.unmatched.push(row);
    }
  }

  return audit;
}

export function getTravianPlayersFromMap() {
  return prepare(`
    SELECT
      uid,
      player,
      COUNT(*) AS villages,
      SUM(population) AS population
    FROM x_world
    WHERE uid IS NOT NULL
      AND uid != 0
      AND player IS NOT NULL
      AND player != ''
    GROUP BY uid, player
    ORDER BY LOWER(player)
  `).all();
}
