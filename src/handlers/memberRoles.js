import { prepare, getConfig } from '../db/client.js';
import { setAccountTribe } from './travianAccounts.js';
import { buildTribeRolePlan } from '../utils/tribeRoles.js';
import { getTribe } from '../utils/tribes.js';
import { logger } from '../utils/logger.js';

const ACCEPTED_ROLE = 'Accepted';
const IMPOSTER_ROLE = 'Imposter';

function findRole(member, name) {
  const roles = member.guild.roles.cache;
  if (typeof roles.find === 'function') return roles.find(r => r.name === name);
  return Array.from(roles.values()).find(r => r.name === name);
}

export async function assignRolesFromIgn({ member, ign }) {
  const village = prepare(
    `SELECT tid, alliance FROM x_world WHERE player = ? AND tid NOT IN (4, 5) LIMIT 1`,
  ).get(ign);
  if (!village) return { tribeAssigned: false, allianceAssigned: false };

  setAccountTribe(ign, village.tid);

  const memberRoleNames = Array.from(member.roles.cache.values()).map(r => r.name);
  const tribeName = getTribe(village.tid).name;

  // Tribe roles
  const plan = buildTribeRolePlan({ tid: village.tid, memberRoleNames });
  let tribeAssigned = false;
  if (plan) {
    const toAdd = plan.addRoleNames.map(n => findRole(member, n)).filter(Boolean);
    const toRemove = plan.removeRoleNames.map(n => findRole(member, n)).filter(Boolean);
    try {
      if (toAdd.length) await member.roles.add(toAdd);
      if (toRemove.length) await member.roles.remove(toRemove);
      tribeAssigned = plan.addRoleNames.length === 0 || toAdd.length > 0;
    } catch (err) {
      logger.warn(`assignRolesFromIgn: tribe role failed for ${ign}: ${err.message}`);
    }
  }

  // Alliance roles (Accepted vs Imposter)
  const acceptedAlliance = getConfig('accepted_alliance') ?? 'Invictus';
  const villageAlliance = village.alliance ?? '';
  const isAccepted = villageAlliance.toLowerCase() === acceptedAlliance.toLowerCase();
  logger.info(`assignRolesFromIgn: ${ign} alliance='${villageAlliance}' expected='${acceptedAlliance}' isAccepted=${isAccepted}`);
  const addRoleName = isAccepted ? ACCEPTED_ROLE : IMPOSTER_ROLE;
  const removeRoleName = isAccepted ? IMPOSTER_ROLE : ACCEPTED_ROLE;
  const addRole = findRole(member, addRoleName);
  const removeRole = findRole(member, removeRoleName);
  let allianceAssigned = false;
  try {
    const needsAdd = addRole && !member.roles.cache.has(addRole.id);
    const needsRemove = removeRole && member.roles.cache.has(removeRole.id);
    if (needsAdd) await member.roles.add(addRole);
    if (needsRemove) await member.roles.remove(removeRole);
    allianceAssigned = needsAdd || needsRemove;
  } catch (err) {
    logger.warn(`assignRolesFromIgn: alliance role failed for ${ign}: ${err.message}`);
  }

  return { tribeAssigned, tribeName, allianceAssigned, allianceRoleName: addRoleName };
}
