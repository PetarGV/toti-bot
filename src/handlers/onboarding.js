import { CREW_ROLE_NAMES } from '../utils/roleSelection.js';
import { getPrimaryLinkForUser } from './userIgnLinks.js';
import { prepare } from '../db/client.js';
import { parseCoords } from '../utils/coords.js';
import { setAccountCoords, setAccountTribe } from './travianAccounts.js';
import { buildTribeRolePlan } from '../utils/tribeRoles.js';
import { getTribe } from '../utils/tribes.js';
import { logger } from '../utils/logger.js';

function hasCrewRole(memberRoleNames) {
  const lowered = new Set((memberRoleNames ?? []).map(n => String(n).trim().toLowerCase()));
  return CREW_ROLE_NAMES.some(name => lowered.has(name.toLowerCase()));
}

export function getNextStep({ discordId, memberRoleNames }) {
  const primary = getPrimaryLinkForUser(discordId);
  if (!primary) return 'ign';
  if (!hasCrewRole(memberRoleNames)) return 'role';
  if (primary.home_x == null) return 'coords';
  return 'done';
}

async function assignTribeRole({ member, plan }) {
  const guildRoles = member.guild.roles.cache;
  const findByName = (name) => {
    if (typeof guildRoles.find === 'function') return guildRoles.find(r => r.name === name);
    return Array.from(guildRoles.values()).find(r => r.name === name);
  };

  const targetRole = findByName(plan.targetName);
  if (plan.addRoleNames.length > 0 && !targetRole) {
    logger.warn(`tribe role '${plan.targetName}' missing on guild — skipping assignment`);
    return false;
  }

  const toAdd = plan.addRoleNames.map(findByName).filter(Boolean);
  const toRemove = plan.removeRoleNames.map(findByName).filter(Boolean);

  if (toAdd.length) await member.roles.add(toAdd);
  if (toRemove.length) await member.roles.remove(toRemove);
  return true;
}

export async function applyCoordsAndDeriveTribe({ discordId, coordsString, member }) {
  const parsed = parseCoords(coordsString);
  if (!parsed) return { ok: false, reason: 'invalid_coords' };

  const village = prepare('SELECT player, tid FROM x_world WHERE x = ? AND y = ? LIMIT 1').get(parsed.x, parsed.y);
  if (!village) return { ok: false, reason: 'no_village' };
  if (village.tid === 4 || village.tid === 5) return { ok: false, reason: 'npc_village' };

  const primary = getPrimaryLinkForUser(discordId);
  if (!primary) return { ok: false, reason: 'no_primary' };

  const normalize = (s) => String(s ?? '').trim().toLowerCase();
  if (normalize(village.player) !== normalize(primary.ign)) {
    return { ok: false, reason: 'wrong_owner', villageOwner: village.player, primaryIgn: primary.ign };
  }

  setAccountCoords(primary.ign, parsed.x, parsed.y);
  setAccountTribe(primary.ign, village.tid);

  const memberRoleNames = Array.from(member.roles.cache.values()).map(r => r.name);
  const plan = buildTribeRolePlan({ tid: village.tid, memberRoleNames });
  let roleAssigned = true;
  if (plan && (plan.addRoleNames.length || plan.removeRoleNames.length)) {
    roleAssigned = await assignTribeRole({ member, plan });
  }

  return { ok: true, tribeName: getTribe(village.tid).name, roleAssigned };
}
