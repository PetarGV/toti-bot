import { CREW_ROLE_NAMES } from '../utils/roleSelection.js';
import { getPrimaryLinkForUser } from './userIgnLinks.js';

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
