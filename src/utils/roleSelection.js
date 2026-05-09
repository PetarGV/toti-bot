export const ROLE_SELECT_CUSTOM_ID = 'setup:roles';
export const ROLE_BUTTON_PREFIX = 'setup:roles';
export const ROLE_RESET_CUSTOM_ID = `${ROLE_BUTTON_PREFIX}:reset`;

export const ROLE_SELECTIONS = [
  {
    value: 'def',
    label: 'Def Crew',
    description: 'Defense calls and reinforcement coordination.',
    roleNames: ['Def Crew'],
  },
  {
    value: 'off',
    label: 'Off Crew',
    description: 'Offense calls and attack coordination.',
    roleNames: ['Off Crew'],
  },
  {
    value: 'hybrid',
    label: 'Hybrid',
    description: 'Hybrid players also receive Def Crew.',
    roleNames: ['Hybrid', 'Def Crew'],
  },
  {
    value: 'scout',
    label: 'Scout Crew',
    description: 'Scouting and intel coordination.',
    roleNames: ['Scout Crew'],
  },
  {
    value: 'wwk',
    label: 'WWK',
    description: 'World Wonder killer coordination.',
    roleNames: ['WWK'],
  },
];

export const CREW_ROLE_NAMES = [
  ...new Set(ROLE_SELECTIONS.flatMap((selection) => selection.roleNames)),
];

function normalizeRoleName(name) {
  return String(name ?? '').trim().toLowerCase();
}

function hasRoleName(roleNames, wantedName) {
  const wanted = normalizeRoleName(wantedName);
  return roleNames.some((name) => normalizeRoleName(name) === wanted);
}

export function getRoleSelection(value) {
  return ROLE_SELECTIONS.find((selection) => selection.value === value) ?? null;
}

export function buildRoleUpdatePlan(selectedValue, memberRoleNames = [], guildRoleNames = []) {
  const selection = getRoleSelection(selectedValue);
  if (!selection) {
    throw new Error(`Unknown role selection: ${selectedValue}`);
  }

  const targetRoleNames = new Set(selection.roleNames);
  const missingRoleNames = selection.roleNames.filter(
    (roleName) => !hasRoleName(guildRoleNames, roleName),
  );

  const addRoleNames = selection.roleNames.filter(
    (roleName) => !missingRoleNames.includes(roleName) && !hasRoleName(memberRoleNames, roleName),
  );

  const removeRoleNames = CREW_ROLE_NAMES.filter(
    (roleName) => !targetRoleNames.has(roleName) && hasRoleName(memberRoleNames, roleName),
  );

  return {
    selection,
    addRoleNames,
    removeRoleNames,
    missingRoleNames,
  };
}

export function getRoleValueFromButtonId(customId) {
  if (!customId?.startsWith(`${ROLE_BUTTON_PREFIX}:`)) return null;
  const value = customId.slice(ROLE_BUTTON_PREFIX.length + 1);
  if (value === 'reset') return value;
  return getRoleSelection(value) ? value : null;
}

export function buildRoleResetPlan(memberRoleNames = []) {
  const removeRoleNames = CREW_ROLE_NAMES.filter((roleName) =>
    hasRoleName(memberRoleNames, roleName)
  );

  return {
    selection: null,
    addRoleNames: [],
    removeRoleNames,
    missingRoleNames: [],
  };
}
