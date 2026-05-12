import { getTribe } from './tribes.js';

export const PLAYABLE_TRIBE_IDS = [1, 2, 3, 6, 7, 8];
export const TRIBE_ROLE_NAMES = PLAYABLE_TRIBE_IDS.map(id => getTribe(id).name);

function normalize(name) {
  return String(name ?? '').trim().toLowerCase();
}

export function buildTribeRolePlan({ tid, memberRoleNames }) {
  if (!PLAYABLE_TRIBE_IDS.includes(tid)) return null;
  const targetName = getTribe(tid).name;
  const targetLower = normalize(targetName);
  const current = (memberRoleNames ?? []).map(normalize);

  const addRoleNames = current.includes(targetLower) ? [] : [targetName];
  const removeRoleNames = TRIBE_ROLE_NAMES.filter(name => {
    const lower = normalize(name);
    return lower !== targetLower && current.includes(lower);
  });

  return { targetName, addRoleNames, removeRoleNames };
}
