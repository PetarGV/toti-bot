// Optional feature gating for running a second, trimmed-down bot instance
// against a different guild. Unset FEATURES = everything enabled (today's
// behavior, unchanged). Set FEATURES=scout,resources,map to expose only
// those command(s)/panel(s)/job(s).

function parseFeatures() {
  const raw = process.env.FEATURES;
  if (raw == null || raw.trim() === '') return null; // null = everything enabled
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

export function isEnabled(feature) {
  if (!feature) return true;
  const enabledSet = parseFeatures();
  if (enabledSet === null) return true;
  return enabledSet.has(feature);
}

// null means "all features enabled" (FEATURES unset)
export function enabledFeatures() {
  const enabledSet = parseFeatures();
  return enabledSet === null ? null : [...enabledSet];
}

// Slash command name -> feature it belongs to. Commands not listed here
// (setup, admin, calls, help, translate) are core and always registered.
export const COMMAND_FEATURES = {
  push: 'resources',
  'report-incoming': 'defense',
  'active-def': 'defense',
  'perma-def': 'defense',
  'sending-def': 'defense',
  intel: 'defense',
  reclassify: 'defense',
  offense: 'offense',
  scout: 'scout',
  whois: 'map',
  nearby: 'map',
  status: 'status',
  profile: 'profile',
  timer: 'timer',
  leaderboard: 'leaderboard',
};

// /setup <panel> subcommand name -> feature it belongs to.
export const PANEL_FEATURES = {
  reports: 'defense',
  leadership: 'defense',
  'leadership-banner': 'defense',
  offense: 'offense',
  scout: 'scout',
  resources: 'resources',
  general: 'general',
  roles: 'roles',
  timer: 'timer',
};

// customId / commandName prefix -> feature, for router-level defense-in-depth.
// Only covers panel entry points (the buttons/commands that CREATE a call or
// open a feature's UI) — once those are blocked, no call of that type can
// ever exist, so the deeper action buttons on its embed are unreachable.
// Matched by exact id or `${prefix}:` startsWith; longest prefix wins.
const ID_FEATURE_PREFIXES = [
  ['push', 'resources'],
  ['pledge', 'resources'],
  ['call:scout', 'scout'],
  ['scout', 'scout'],
  ['call:defense', 'defense'],
  ['call:reinforce', 'defense'],
  ['call:urgent', 'defense'],
  ['call:def_active', 'defense'],
  ['call:def_perma', 'defense'],
  ['call:offense', 'offense'],
  ['offense', 'offense'],
  ['report', 'defense'],
  ['report-incoming', 'defense'],
  ['active-def', 'defense'],
  ['perma-def', 'defense'],
  ['sending-def', 'defense'],
  ['reclassify', 'defense'],
  ['intel:whois', 'map'],
  ['whois', 'map'],
  ['nearby', 'map'],
  ['general:nearby', 'map'],
  ['intel', 'defense'],
  ['timer', 'timer'],
  ['profile', 'profile'],
  ['notify:toggle', 'profile'],
  ['panel:profile', 'profile'],
  ['panel:status', 'status'],
  ['status', 'status'],
  ['leaderboard', 'leaderboard'],
  ['setup:roles', 'roles'],
];

export function featureForId(id) {
  let best = null;
  for (const [prefix, feature] of ID_FEATURE_PREFIXES) {
    if (id === prefix || id.startsWith(`${prefix}:`)) {
      if (!best || prefix.length > best[0].length) best = [prefix, feature];
    }
  }
  return best ? best[1] : null;
}
