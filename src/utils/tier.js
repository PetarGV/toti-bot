export function getTier(member) {
  if (!member?.roles?.cache) return 'member';
  const leadName = process.env.LEADERSHIP_ROLE_NAME;
  const coordName = process.env.DEF_COORD_ROLE_NAME;
  const has = name => name && member.roles.cache.some(r => r.name.toLowerCase() === name.toLowerCase());
  if (has(leadName)) return 'leadership';
  if (has(coordName)) return 'def_coord';
  return 'member';
}

export function isLeadershipOrCoord(member) {
  const t = getTier(member);
  return t === 'leadership' || t === 'def_coord';
}
